import axios from 'axios';
import type {
    ApiResponse,
    User,
    Sender,
    ScheduledEmail,
    SentEmail,
    ScheduleEmailRequest,
    ScheduleEmailResponse,
    RateLimitInfo
} from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const api = axios.create({
    baseURL: API_URL,
    withCredentials: true,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Add token to requests if available
api.interceptors.request.use((config) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Auth API
export const authApi = {
    googleLogin: async (credential: string): Promise<ApiResponse<{ user: User; token: string }>> => {
        const response = await api.post('/api/auth/google', { credential });
        return response.data;
    },

    register: async (email: string, password: string, name: string): Promise<ApiResponse<{ user: User; token: string }>> => {
        const response = await api.post('/api/auth/register', { email, password, name });
        return response.data;
    },

    login: async (email: string, password: string): Promise<ApiResponse<{ user: User; token: string }>> => {
        const response = await api.post('/api/auth/login', { email, password });
        return response.data;
    },

    getMe: async (): Promise<ApiResponse<User>> => {
        const response = await api.get('/api/auth/me');
        return response.data;
    },

    logout: async (): Promise<ApiResponse<void>> => {
        const response = await api.post('/api/auth/logout');
        return response.data;
    },
};

// Email API
export const emailApi = {
    scheduleEmails: async (request: ScheduleEmailRequest): Promise<ApiResponse<ScheduleEmailResponse>> => {
        const response = await api.post('/api/emails/schedule', request);
        return response.data;
    },

    getScheduledEmails: async (): Promise<ApiResponse<ScheduledEmail[]>> => {
        const response = await api.get('/api/emails/scheduled');
        return response.data;
    },

    getSentEmails: async (): Promise<ApiResponse<SentEmail[]>> => {
        const response = await api.get('/api/emails/sent');
        return response.data;
    },

    getSenders: async (): Promise<ApiResponse<Sender[]>> => {
        const response = await api.get('/api/emails/senders');
        return response.data;
    },

    createSender: async (name: string): Promise<ApiResponse<Sender>> => {
        const response = await api.post('/api/emails/senders', { name });
        return response.data;
    },

    getRateLimit: async (senderId: string): Promise<ApiResponse<RateLimitInfo>> => {
        const response = await api.get(`/api/emails/rate-limit/${senderId}`);
        return response.data;
    },
};

export default api;
