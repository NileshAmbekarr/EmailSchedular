import { Resend } from 'resend';
import type { EmailProviderName } from '../db/schema.js';
import {
    ProviderError,
    type EmailProvider,
    type OutboundMessage,
    type SendResult,
} from './types.js';

/**
 * Resend over HTTPS. Preferred over SMTP at volume: no per-message TLS
 * handshake, no blocked outbound ports on PaaS hosts, and the response carries
 * a message id that webhook events reference directly.
 */
export class ResendProvider implements EmailProvider {
    readonly name: EmailProviderName = 'resend';
    private client: Resend;

    constructor(apiKey: string) {
        this.client = new Resend(apiKey);
    }

    async send(message: OutboundMessage): Promise<SendResult> {
        const { data, error } = await this.client.emails.send({
            from: `${message.from.name} <${message.from.email}>`,
            to: message.to,
            replyTo: message.replyTo,
            subject: message.subject,
            html: message.html,
            text: message.text,
            headers: message.headers,
            tags: message.tags
                ? Object.entries(message.tags).map(([name, value]) => ({ name, value }))
                : undefined,
        });

        if (error) {
            // `validation_error` and `invalid_parameter` mean the address or
            // payload will never be accepted — retrying just burns reputation.
            const permanent =
                error.name === 'validation_error' ||
                error.name === 'invalid_parameter' ||
                /invalid.*(email|recipient)/i.test(error.message ?? '');

            throw new ProviderError(error.message || 'Resend send failed', {
                permanent,
                code: error.name,
            });
        }

        if (!data?.id) {
            throw new ProviderError('Resend returned no message id', { permanent: false });
        }

        return { messageId: data.id };
    }

    async verify(): Promise<boolean> {
        try {
            // Cheapest authenticated call available.
            const { error } = await this.client.domains.list();
            return !error;
        } catch {
            return false;
        }
    }

    async close(): Promise<void> {
        // Stateless HTTP client.
    }
}
