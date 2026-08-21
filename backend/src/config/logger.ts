import pino from 'pino';
import { env } from './env.js';

/**
 * Structured logging. Every log line is JSON in production so it can be
 * queried by field (emailId, campaignId, jobId) instead of grepped.
 */
export const logger = pino({
    level: env.LOG_LEVEL,
    base: { service: 'email-scheduler' },
    redact: {
        paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'password',
            '*.password',
            'smtpPass',
            '*.smtpPass',
            'smtpPassEncrypted',
            '*.smtpPassEncrypted',
            'credential',
            '*.credential',
            'apiKey',
            '*.apiKey',
        ],
        censor: '[redacted]',
    },
    transport: env.IS_PROD
        ? undefined
        : {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
          },
});

/** Child logger bound to a subsystem, e.g. `log('worker')`. */
export const log = (component: string) => logger.child({ component });
