// User types
export interface UserPayload {
    id: string;
    email: string;
    name: string;
}

export interface GoogleUserInfo {
    id: string;
    email: string;
    name: string;
    picture?: string;
}

// Email types
export interface ScheduleEmailRequest {
    senderId: string;
    recipients: string[];
    subject: string;
    body: string;
    scheduledAt: string; // ISO date string
    delayBetweenEmailsMs?: number;
    maxEmailsPerHour?: number;
}

export interface EmailJobData {
    emailId: string;
    recipientEmail: string;
    subject: string;
    body: string;
    senderId: string;
    senderEmail: string;
    senderName: string;
    smtpUser?: string;
    smtpPass?: string;
}

export interface ScheduledEmailResponse {
    id: string;
    recipientEmail: string;
    subject: string;
    scheduledAt: string;
    status: 'pending' | 'queued' | 'processing' | 'sent' | 'failed';
}

export interface SentEmailResponse {
    id: string;
    recipientEmail: string;
    subject: string;
    sentAt: string;
    status: 'sent' | 'failed';
    previewUrl?: string;
    errorMessage?: string;
}

// API response types
export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
}

// Rate limiting
export interface RateLimitInfo {
    senderId: string;
    hourWindow: string;
    count: number;
    limit: number;
    remaining: number;
    resetAt: Date;
}
