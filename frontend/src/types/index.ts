// ---------------------------------------------------------------------------
// API envelope
// ---------------------------------------------------------------------------

export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
    details?: unknown;
    pagination?: PaginationMeta;
}

export interface PaginationMeta {
    total: number;
    limit: number;
    offset: number;
}

export interface Paginated<T> {
    items: T[];
    pagination: PaginationMeta;
}

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

export interface User {
    id: string;
    email: string;
    name: string;
    avatar?: string | null;
    timezone: string;
    emailVerified: boolean;
    companyName?: string | null;
    postalAddress?: string | null;
}

export type EmailProviderName = 'ethereal' | 'smtp' | 'resend' | 'ses';

export interface Sender {
    id: string;
    email: string;
    name: string;
    replyTo?: string | null;
    provider: EmailProviderName;
    domainId?: string | null;
    hourlyLimit?: number | null;
    dailyLimit?: number | null;
    warmupEnabled: boolean;
    warmupStartedAt?: string | null;
    isDefault: boolean;
    hasSmtpCredentials: boolean;
    createdAt: string;
}

export type CampaignStatus =
    | 'draft'
    | 'scheduled'
    | 'sending'
    | 'paused'
    | 'completed'
    | 'cancelled';

export type EmailStatus =
    | 'pending'
    | 'queued'
    | 'processing'
    | 'retrying'
    | 'sent'
    | 'delivered'
    | 'bounced'
    | 'failed'
    | 'cancelled'
    | 'suppressed';

export interface Campaign {
    id: string;
    name: string;
    subject: string;
    body: string;
    status: CampaignStatus;
    senderId: string;
    sender?: Pick<Sender, 'id' | 'email' | 'name'>;
    templateId?: string | null;
    scheduledAt: string;
    timezone: string;
    perRecipientTimezone: boolean;
    delayBetweenEmailsMs?: number | null;
    maxEmailsPerHour?: number | null;
    trackOpens: boolean;
    trackClicks: boolean;
    totalRecipients: number;
    sentCount: number;
    deliveredCount: number;
    openedCount: number;
    clickedCount: number;
    bouncedCount: number;
    complainedCount: number;
    failedCount: number;
    startedAt?: string | null;
    completedAt?: string | null;
    createdAt: string;
    updatedAt: string;
    breakdown?: Record<string, number>;
}

export interface EmailEvent {
    id: string;
    type: string;
    occurredAt: string;
    payload?: Record<string, unknown> | null;
}

export interface EmailMessage {
    id: string;
    recipientEmail: string;
    mergeData: Record<string, string>;
    renderedSubject?: string | null;
    renderedBody?: string | null;
    scheduledAt: string;
    sentAt?: string | null;
    status: EmailStatus;
    attemptCount: number;
    errorMessage?: string | null;
    previewUrl?: string | null;
    openedAt?: string | null;
    clickedAt?: string | null;
    createdAt: string;
    sender?: Pick<Sender, 'id' | 'email' | 'name'>;
    campaign?: Pick<Campaign, 'id' | 'name' | 'subject'> | null;
    events?: EmailEvent[];
}

export interface Template {
    id: string;
    name: string;
    subject: string;
    body: string;
    variables: string[];
    createdAt: string;
    updatedAt: string;
}

export interface ContactList {
    id: string;
    name: string;
    description?: string | null;
    contactCount: number;
    createdAt: string;
    updatedAt: string;
}

export interface Contact {
    id: string;
    email: string;
    fields: Record<string, string>;
    source?: string | null;
    createdAt: string;
}

export type SuppressionReason =
    | 'unsubscribed'
    | 'hard_bounce'
    | 'soft_bounce_threshold'
    | 'complaint'
    | 'manual'
    | 'invalid';

export interface Suppression {
    id: string;
    email: string;
    reason: SuppressionReason;
    detail?: string | null;
    createdAt: string;
}

export interface DnsRecord {
    type: 'TXT' | 'CNAME' | 'MX';
    name: string;
    value: string;
    purpose: 'verification' | 'spf' | 'dkim' | 'dmarc';
    description: string;
}

export interface SendingDomain {
    id: string;
    domain: string;
    status: 'pending' | 'verified' | 'failed';
    spfVerified: boolean;
    dkimVerified: boolean;
    dmarcVerified: boolean;
    lastCheckedAt?: string | null;
    verifiedAt?: string | null;
    createdAt: string;
    dnsRecords: DnsRecord[];
}

export interface ApiKey {
    id: string;
    name: string;
    keyPrefix: string;
    lastUsedAt?: string | null;
    createdAt: string;
    /** Only present in the create response — never retrievable again. */
    key?: string;
}

export interface RateLimitStatus {
    allowed: boolean;
    limitedBy?: 'hour' | 'day';
    hourCount: number;
    dayCount: number;
    hourLimit: number;
    dayLimit: number;
    resetAt: string;
}

export interface ContentWarning {
    severity: 'low' | 'medium' | 'high';
    message: string;
}

export interface AccountStats {
    totals: {
        total: number;
        sent: number;
        delivered: number;
        failed: number;
        bounced: number;
        opened: number;
        clicked: number;
        scheduled: number;
    };
    daily: Array<{
        day: string;
        sent: number;
        opened: number;
        clicked: number;
        bounced: number;
    }>;
    rates: { openRate: number; clickRate: number; bounceRate: number };
}

export interface QueueStats {
    email: Record<string, number>;
    campaign: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface RecipientInput {
    email: string;
    fields?: Record<string, string>;
}

export interface CreateCampaignRequest {
    name: string;
    senderId: string;
    subject: string;
    body: string;
    scheduledAt: string;
    timezone?: string;
    perRecipientTimezone?: boolean;
    templateId?: string | null;
    recipients?: RecipientInput[];
    listId?: string | null;
    delayBetweenEmailsMs?: number | null;
    maxEmailsPerHour?: number | null;
    trackOpens?: boolean;
    trackClicks?: boolean;
    draft?: boolean;
}

export interface CreateCampaignResult {
    campaign: Campaign;
    totalRecipients: number;
    suppressedCount: number;
    duplicateCount: number;
    warnings: ContentWarning[];
}

export interface PreviewResult {
    subject: string;
    html: string;
    text: string;
    variables: string[];
    warnings: ContentWarning[];
}
