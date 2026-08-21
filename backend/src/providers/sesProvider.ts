import {
    SESv2Client,
    SendEmailCommand,
    GetAccountCommand,
} from '@aws-sdk/client-sesv2';
import type { EmailProviderName } from '../db/schema.js';
import {
    ProviderError,
    type EmailProvider,
    type OutboundMessage,
    type SendResult,
} from './types.js';

export interface SesConfig {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    /** Configuration set that publishes delivery events to SNS. */
    configurationSet?: string;
}

/** Errors where the message will never be accepted, however many times we try. */
const PERMANENT_ERRORS = new Set([
    'MessageRejected',
    'MailFromDomainNotVerifiedException',
    'AccountSuspendedException',
    'InvalidParameterValue',
]);

export class SesProvider implements EmailProvider {
    readonly name: EmailProviderName = 'ses';
    private client: SESv2Client;

    constructor(private config: SesConfig) {
        this.client = new SESv2Client({
            region: config.region,
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
            },
        });
    }

    async send(message: OutboundMessage): Promise<SendResult> {
        try {
            const response = await this.client.send(
                new SendEmailCommand({
                    FromEmailAddress: `${message.from.name} <${message.from.email}>`,
                    Destination: { ToAddresses: [message.to] },
                    ReplyToAddresses: message.replyTo ? [message.replyTo] : undefined,
                    ConfigurationSetName: this.config.configurationSet,
                    EmailTags: message.tags
                        ? Object.entries(message.tags).map(([Name, Value]) => ({ Name, Value }))
                        : undefined,
                    Content: {
                        Simple: {
                            Subject: { Data: message.subject, Charset: 'UTF-8' },
                            Body: {
                                Html: { Data: message.html, Charset: 'UTF-8' },
                                ...(message.text
                                    ? { Text: { Data: message.text, Charset: 'UTF-8' } }
                                    : {}),
                            },
                            Headers: message.headers
                                ? Object.entries(message.headers).map(([Name, Value]) => ({
                                      Name,
                                      Value,
                                  }))
                                : undefined,
                        },
                    },
                })
            );

            if (!response.MessageId) {
                throw new ProviderError('SES returned no message id');
            }

            return { messageId: response.MessageId };
        } catch (err) {
            if (err instanceof ProviderError) throw err;

            const name = (err as { name?: string }).name ?? '';
            throw new ProviderError(err instanceof Error ? err.message : 'SES send failed', {
                permanent: PERMANENT_ERRORS.has(name),
                code: name,
                cause: err,
            });
        }
    }

    async verify(): Promise<boolean> {
        try {
            const account = await this.client.send(new GetAccountCommand({}));
            return account.SendingEnabled === true;
        } catch {
            return false;
        }
    }

    async close(): Promise<void> {
        this.client.destroy();
    }
}
