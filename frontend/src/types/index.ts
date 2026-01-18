// User types
export interface User {
    id: string;
    email: string;
    name: string;
    avatar?: string;
}

// Sender types
export interface Sender {
    id: string;
    email: string;
    name: string;
}

// Email types
export type EmailStatus = 'pending' | 'queued' | 'processing' | 'sent' | 'failed';

export interface ScheduledEmail {
    id: string;
    recipientEmail: string;
    subject: string;
    scheduledAt: string;
    status: EmailStatus;
    sender?: Sender;
}

export interface SentEmail {
    id: string;
    recipientEmail: string;
    senderEmail?: string;
    subject: string;
    body?: string;
    sentAt: string;
    status: 'sent' | 'failed';
    previewUrl?: string;
    errorMessage?: string;
    sender?: Sender;
}

// API request types
export interface ScheduleEmailRequest {
    senderId: string;
    recipients: string[];
    subject: string;
    body: string;
    scheduledAt: string;
}

// API response types
export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
}

export interface ScheduleEmailResponse {
    count: number;
    emails: {
        id: string;
        recipientEmail: string;
        scheduledAt: string;
        status: EmailStatus;
    }[];
}

export interface RateLimitInfo {
    senderId: string;
    hourWindow: string;
    count: number;
    limit: number;
    remaining: number;
    resetAt: string;
}
