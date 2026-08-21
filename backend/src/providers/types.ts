import type { EmailProviderName } from '../db/schema.js';

export interface OutboundMessage {
    from: { email: string; name: string };
    to: string;
    replyTo?: string;
    subject: string;
    html: string;
    text?: string;
    /** Extra SMTP headers — List-Unsubscribe lives here. */
    headers?: Record<string, string>;
    /** Provider-side metadata for correlating webhooks. */
    tags?: Record<string, string>;
}

export interface SendResult {
    /** Provider message id. Webhook events are matched back on this. */
    messageId: string;
    /** Ethereal only — a URL where the captured message can be viewed. */
    previewUrl?: string;
}

export interface EmailProvider {
    readonly name: EmailProviderName;
    send(message: OutboundMessage): Promise<SendResult>;
    /** Confirms credentials/connectivity. Used by the readiness probe. */
    verify(): Promise<boolean>;
    close(): Promise<void>;
}

/**
 * Send failures split into two kinds, and the distinction matters:
 *
 *  - **permanent** (bad mailbox, blocked address): retrying is pointless and
 *    repeatedly hitting the same dead address damages sender reputation. The
 *    worker suppresses the recipient and stops.
 *  - **transient** (connection reset, throttle, 4xx): retry with backoff.
 */
export class ProviderError extends Error {
    readonly permanent: boolean;
    readonly providerCode?: string;

    constructor(message: string, opts: { permanent?: boolean; code?: string; cause?: unknown } = {}) {
        super(message, { cause: opts.cause });
        this.name = 'ProviderError';
        this.permanent = opts.permanent ?? false;
        this.providerCode = opts.code;
    }
}

/** SMTP 5xx is permanent, 4xx is worth retrying. */
export const isPermanentSmtpCode = (code?: string | number): boolean => {
    const n = Number(code);
    return Number.isFinite(n) && n >= 500 && n < 600;
};
