import { env } from '../config/env.js';
import { log } from '../config/logger.js';
import { decryptNullable } from '../services/cryptoService.js';
import type { Sender } from '../db/schema.js';
import { SmtpProvider } from './smtpProvider.js';
import { ResendProvider } from './resendProvider.js';
import { SesProvider } from './sesProvider.js';
import type { EmailProvider } from './types.js';

export * from './types.js';
export { createEtherealAccount } from './smtpProvider.js';

const logger = log('providers');

/**
 * Providers hold pooled connections, so they are cached per sender. The cache
 * is bounded — the previous unbounded Map leaked a transport per distinct
 * credential pair and never released the sockets.
 */
const MAX_CACHED = 50;
const cache = new Map<string, EmailProvider>();

const remember = (key: string, provider: EmailProvider): EmailProvider => {
    if (cache.size >= MAX_CACHED) {
        // Map preserves insertion order, so the first key is the oldest.
        const oldestKey = cache.keys().next().value;
        if (oldestKey) {
            const evicted = cache.get(oldestKey);
            cache.delete(oldestKey);
            void evicted?.close().catch(() => {});
        }
    }
    cache.set(key, provider);
    return provider;
};

const cacheKey = (sender: Pick<Sender, 'id' | 'provider'>) => `${sender.provider}:${sender.id}`;

/**
 * Builds (or reuses) the provider a given sender should deliver through.
 *
 * Account-level providers (Resend, SES) are shared across senders; SMTP is
 * per-sender because the credentials differ.
 */
export const getProviderForSender = (sender: Sender): EmailProvider => {
    const key = cacheKey(sender);
    const existing = cache.get(key);
    if (existing) return existing;

    switch (sender.provider) {
        case 'resend': {
            if (!env.RESEND_API_KEY) {
                throw new Error('RESEND_API_KEY is not configured');
            }
            return remember(key, new ResendProvider(env.RESEND_API_KEY));
        }

        case 'ses': {
            if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
                throw new Error('AWS credentials are not configured');
            }
            return remember(
                key,
                new SesProvider({
                    region: env.AWS_REGION,
                    accessKeyId: env.AWS_ACCESS_KEY_ID,
                    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
                    configurationSet: env.SES_CONFIGURATION_SET,
                })
            );
        }

        case 'smtp':
        case 'ethereal':
        default: {
            const pass = decryptNullable(sender.smtpPassEncrypted) ?? env.SMTP_PASS;
            const user = sender.smtpUser ?? env.SMTP_USER;

            if (!user || !pass) {
                throw new Error(`Sender ${sender.id} has no usable SMTP credentials`);
            }

            const host = sender.smtpHost ?? env.SMTP_HOST;
            const port = sender.smtpPort ?? env.SMTP_PORT;

            return remember(
                key,
                new SmtpProvider({
                    host,
                    port,
                    secure: port === 465 ? true : env.SMTP_SECURE,
                    user,
                    pass,
                    ethereal: sender.provider === 'ethereal',
                })
            );
        }
    }
};

/** Invalidate a cached provider after its sender's credentials change. */
export const invalidateProvider = async (sender: Pick<Sender, 'id' | 'provider'>): Promise<void> => {
    const key = cacheKey(sender);
    const provider = cache.get(key);
    if (provider) {
        cache.delete(key);
        await provider.close().catch(() => {});
    }
};

export const closeAllProviders = async (): Promise<void> => {
    const providers = [...cache.values()];
    cache.clear();
    await Promise.allSettled(providers.map((p) => p.close()));
    logger.debug({ count: providers.length }, 'closed cached providers');
};
