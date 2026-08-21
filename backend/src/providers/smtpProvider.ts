import nodemailer, { type Transporter } from 'nodemailer';
import { log } from '../config/logger.js';
import type { EmailProviderName } from '../db/schema.js';
import {
    ProviderError,
    isPermanentSmtpCode,
    type EmailProvider,
    type OutboundMessage,
    type SendResult,
} from './types.js';

const logger = log('smtp');

export interface SmtpConfig {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    /** Ethereal captures mail and exposes a preview URL instead of delivering. */
    ethereal?: boolean;
}

/**
 * Nodemailer-backed provider. Covers both a user's own SMTP server and
 * Ethereal (the development sink).
 *
 * Connections are pooled: opening a fresh TCP+TLS session per message is the
 * dominant cost at volume, and most servers penalise it.
 */
export class SmtpProvider implements EmailProvider {
    readonly name: EmailProviderName;
    private transporter: Transporter;

    constructor(private config: SmtpConfig) {
        this.name = config.ethereal ? 'ethereal' : 'smtp';
        this.transporter = nodemailer.createTransport({
            host: config.host,
            port: config.port,
            secure: config.secure,
            auth: { user: config.user, pass: config.pass },
            pool: true,
            maxConnections: 5,
            maxMessages: 100,
            connectionTimeout: 15_000,
            socketTimeout: 30_000,
        });
    }

    async send(message: OutboundMessage): Promise<SendResult> {
        try {
            const info = await this.transporter.sendMail({
                from: { address: message.from.email, name: message.from.name },
                to: message.to,
                replyTo: message.replyTo,
                subject: message.subject,
                html: message.html,
                text: message.text,
                headers: message.headers,
            });

            const previewUrl = this.config.ethereal
                ? nodemailer.getTestMessageUrl(info) || undefined
                : undefined;

            return { messageId: info.messageId, previewUrl: previewUrl || undefined };
        } catch (err) {
            const code = (err as { responseCode?: number; code?: string }).responseCode;
            throw new ProviderError(err instanceof Error ? err.message : 'SMTP send failed', {
                permanent: isPermanentSmtpCode(code),
                code: code ? String(code) : (err as { code?: string }).code,
                cause: err,
            });
        }
    }

    async verify(): Promise<boolean> {
        try {
            await this.transporter.verify();
            return true;
        } catch (err) {
            logger.warn({ err, host: this.config.host }, 'SMTP verification failed');
            return false;
        }
    }

    async close(): Promise<void> {
        this.transporter.close();
    }
}

/**
 * Provisions a throwaway Ethereal mailbox. Used for local development and for
 * the demo sender created on signup, so a new account can exercise the whole
 * pipeline without owning a domain.
 */
export const createEtherealAccount = async (): Promise<{
    user: string;
    pass: string;
    host: string;
    port: number;
}> => {
    const account = await nodemailer.createTestAccount();
    return {
        user: account.user,
        pass: account.pass,
        host: account.smtp.host,
        port: account.smtp.port,
    };
};
