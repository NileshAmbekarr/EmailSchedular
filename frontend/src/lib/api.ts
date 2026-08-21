import axios, { AxiosError } from 'axios';
import type {
    AccountStats,
    ApiKey,
    ApiResponse,
    Campaign,
    CampaignStatus,
    Contact,
    ContactList,
    CreateCampaignRequest,
    CreateCampaignResult,
    EmailMessage,
    Paginated,
    PreviewResult,
    QueueStats,
    RateLimitStatus,
    SendingDomain,
    Sender,
    Suppression,
    Template,
    User,
} from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/**
 * The session cookie is httpOnly and set by the API, so `withCredentials` is
 * what actually authenticates. The token is no longer mirrored into
 * localStorage — keeping a readable copy there defeated the point of httpOnly,
 * since any XSS on the page could exfiltrate it.
 */
const api = axios.create({
    baseURL: API_URL,
    withCredentials: true,
    headers: { 'Content-Type': 'application/json' },
    timeout: 30_000,
});

/** Surfaces the API's own error message instead of "Request failed with 400". */
export class ApiError extends Error {
    constructor(
        message: string,
        readonly status?: number,
        readonly details?: unknown
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (handler: () => void) => {
    onUnauthorized = handler;
};

api.interceptors.response.use(
    (response) => response,
    (error: AxiosError<ApiResponse>) => {
        const status = error.response?.status;
        const payload = error.response?.data;

        if (status === 401 && typeof window !== 'undefined') {
            onUnauthorized?.();
        }

        const details = payload?.details;
        const fieldMessage =
            Array.isArray(details) && details.length > 0
                ? (details as Array<{ message?: string }>)[0]?.message
                : undefined;

        throw new ApiError(
            fieldMessage ?? payload?.error ?? error.message ?? 'Request failed',
            status,
            details
        );
    }
);

const unwrap = <T>(response: { data: ApiResponse<T> }): T => {
    if (!response.data.success || response.data.data === undefined) {
        throw new ApiError(response.data.error ?? 'Request failed');
    }
    return response.data.data;
};

const unwrapPaginated = <T>(response: { data: ApiResponse<T[]> }): Paginated<T> => ({
    items: response.data.data ?? [],
    pagination: response.data.pagination ?? { total: 0, limit: 0, offset: 0 },
});

/** Lets the API dedupe a retried mutation instead of doing the work twice. */
const idempotent = () => ({
    headers: { 'Idempotency-Key': crypto.randomUUID() },
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const authApi = {
    register: (payload: { email: string; password: string; name: string; timezone?: string }) =>
        api.post<ApiResponse<{ user: User }>>('/api/auth/register', payload).then(unwrap),

    login: (email: string, password: string) =>
        api.post<ApiResponse<{ user: User }>>('/api/auth/login', { email, password }).then(unwrap),

    googleLogin: (credential: string) =>
        api.post<ApiResponse<{ user: User }>>('/api/auth/google', { credential }).then(unwrap),

    me: () => api.get<ApiResponse<User>>('/api/auth/me').then(unwrap),

    updateProfile: (payload: Partial<Pick<User, 'name' | 'timezone' | 'companyName' | 'postalAddress'>>) =>
        api.patch<ApiResponse<User>>('/api/auth/me', payload).then(unwrap),

    logout: () => api.post('/api/auth/logout').then(() => undefined),

    logoutEverywhere: () => api.post('/api/auth/logout-all').then(() => undefined),

    forgotPassword: (email: string) =>
        api.post('/api/auth/forgot-password', { email }).then(() => undefined),

    resetPassword: (token: string, password: string) =>
        api.post('/api/auth/reset-password', { token, password }).then(() => undefined),
};

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export const campaignApi = {
    create: (payload: CreateCampaignRequest) =>
        api
            .post<ApiResponse<CreateCampaignResult>>('/api/campaigns', payload, idempotent())
            .then(unwrap),

    list: (params: { limit?: number; offset?: number; status?: CampaignStatus; search?: string } = {}) =>
        api.get<ApiResponse<Campaign[]>>('/api/campaigns', { params }).then(unwrapPaginated),

    get: (id: string) => api.get<ApiResponse<Campaign>>(`/api/campaigns/${id}`).then(unwrap),

    cancel: (id: string) =>
        api.post<ApiResponse<{ cancelled: number }>>(`/api/campaigns/${id}/cancel`).then(unwrap),

    pause: (id: string) => api.post(`/api/campaigns/${id}/pause`).then(() => undefined),

    resume: (id: string) => api.post(`/api/campaigns/${id}/resume`).then(() => undefined),

    reschedule: (id: string, scheduledAt: string, timezone?: string) =>
        api
            .patch<ApiResponse<{ rescheduled: number }>>(`/api/campaigns/${id}/schedule`, {
                scheduledAt,
                timezone,
            })
            .then(unwrap),
};

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const emailApi = {
    list: (
        params: {
            bucket?: 'scheduled' | 'sent' | 'failed' | 'all';
            campaignId?: string;
            limit?: number;
            offset?: number;
            search?: string;
        } = {}
    ) => api.get<ApiResponse<EmailMessage[]>>('/api/emails', { params }).then(unwrapPaginated),

    get: (id: string) => api.get<ApiResponse<EmailMessage>>(`/api/emails/${id}`).then(unwrap),

    cancel: (id: string) => api.post(`/api/emails/${id}/cancel`).then(() => undefined),
};

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

export const composerApi = {
    preview: (payload: { subject: string; body: string; mergeData?: Record<string, string> }) =>
        api.post<ApiResponse<PreviewResult>>('/api/preview', payload).then(unwrap),

    testSend: (payload: {
        senderId: string;
        to: string;
        subject: string;
        body: string;
        mergeData?: Record<string, string>;
    }) =>
        api
            .post<ApiResponse<{ messageId: string; previewUrl?: string }>>('/api/test-send', payload)
            .then(unwrap),
};

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export const senderApi = {
    list: () => api.get<ApiResponse<Sender[]>>('/api/senders').then(unwrap),

    create: (payload: Record<string, unknown>) =>
        api.post<ApiResponse<Sender>>('/api/senders', payload).then(unwrap),

    update: (id: string, payload: Record<string, unknown>) =>
        api.patch<ApiResponse<Sender>>(`/api/senders/${id}`, payload).then(unwrap),

    remove: (id: string) => api.delete(`/api/senders/${id}`).then(() => undefined),

    verify: (id: string) =>
        api.post<ApiResponse<{ verified: boolean }>>(`/api/senders/${id}/verify`).then(unwrap),

    rateLimit: (id: string) =>
        api.get<ApiResponse<RateLimitStatus>>(`/api/senders/${id}/rate-limit`).then(unwrap),
};

export const templateApi = {
    list: () => api.get<ApiResponse<Template[]>>('/api/templates').then(unwrap),

    create: (payload: { name: string; subject: string; body: string }) =>
        api.post<ApiResponse<Template>>('/api/templates', payload).then(unwrap),

    update: (id: string, payload: { name: string; subject: string; body: string }) =>
        api.put<ApiResponse<Template>>(`/api/templates/${id}`, payload).then(unwrap),

    remove: (id: string) => api.delete(`/api/templates/${id}`).then(() => undefined),
};

export const listApi = {
    list: () => api.get<ApiResponse<ContactList[]>>('/api/lists').then(unwrap),

    create: (payload: { name: string; description?: string }) =>
        api.post<ApiResponse<ContactList>>('/api/lists', payload).then(unwrap),

    contacts: (id: string, params: { limit?: number; offset?: number; search?: string } = {}) =>
        api.get<ApiResponse<Contact[]>>(`/api/lists/${id}/contacts`, { params }).then(unwrapPaginated),

    addContacts: (
        id: string,
        contacts: Array<{ email: string; fields?: Record<string, string> }>,
        source?: string
    ) =>
        api
            .post<ApiResponse<{ added: number; duplicates: number; total: number }>>(
                `/api/lists/${id}/contacts`,
                { contacts, source }
            )
            .then(unwrap),

    remove: (id: string) => api.delete(`/api/lists/${id}`).then(() => undefined),
};

export const suppressionApi = {
    list: (params: { limit?: number; offset?: number; reason?: string; search?: string } = {}) =>
        api.get<ApiResponse<Suppression[]>>('/api/suppressions', { params }).then(unwrapPaginated),

    add: (email: string, reason = 'manual', detail?: string) =>
        api.post('/api/suppressions', { email, reason, detail }).then(() => undefined),

    remove: (email: string) =>
        api.delete(`/api/suppressions/${encodeURIComponent(email)}`).then(() => undefined),
};

export const domainApi = {
    list: () => api.get<ApiResponse<SendingDomain[]>>('/api/domains').then(unwrap),

    create: (domain: string) =>
        api.post<ApiResponse<SendingDomain>>('/api/domains', { domain }).then(unwrap),

    verify: (id: string) =>
        api
            .post<ApiResponse<{ verified: boolean; spf: boolean; dkim: boolean; dmarc: boolean }>>(
                `/api/domains/${id}/verify`
            )
            .then(unwrap),

    remove: (id: string) => api.delete(`/api/domains/${id}`).then(() => undefined),
};

export const apiKeyApi = {
    list: () => api.get<ApiResponse<ApiKey[]>>('/api/api-keys').then(unwrap),

    create: (name: string) => api.post<ApiResponse<ApiKey>>('/api/api-keys', { name }).then(unwrap),

    revoke: (id: string) => api.delete(`/api/api-keys/${id}`).then(() => undefined),
};

export const statsApi = {
    account: (days = 30) =>
        api.get<ApiResponse<AccountStats>>('/api/stats', { params: { days } }).then(unwrap),

    queue: () => api.get<ApiResponse<QueueStats>>('/api/queue').then(unwrap),
};

export default api;
