import { z } from 'zod';

/** Comma-separated list -> trimmed string[] */
const csv = z
    .string()
    .default('')
    .transform((s) =>
        s
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)
    );

/**
 * `KEY=` in a .env file yields an empty string, not an absent value — and
 * `Number('')` is 0, which then fails `.positive()` and kills the process at
 * boot. Treat empty as "not set" so a blank line falls back to the default.
 */
const blankAsUndefined = (value: unknown) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value;

const numeric = (fallback: number) =>
    z.preprocess(blankAsUndefined, z.coerce.number().int().positive().default(fallback));

const optionalNumeric = () =>
    z.preprocess(blankAsUndefined, z.coerce.number().int().positive().optional());

const optionalString = () =>
    z.preprocess(blankAsUndefined, z.string().optional());

const envSchema = z
    .object({
        // ---- Core infrastructure -------------------------------------------------
        DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
        /** Standard redis:// or rediss:// URL — NOT the Upstash REST URL. */
        REDIS_URL: z.preprocess(blankAsUndefined, z.string().min(1).optional()),
        UPSTASH_REDIS_URL: z.preprocess(blankAsUndefined, z.string().min(1).optional()),

        // ---- Auth ----------------------------------------------------------------
        JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
        JWT_EXPIRES_IN: z.string().default('7d'),
        REFRESH_TOKEN_EXPIRES_IN: z.string().default('30d'),

        GOOGLE_CLIENT_ID: z.string().default(''),
        GOOGLE_CLIENT_SECRET: z.string().default(''),

        /**
         * 32-byte key, hex or base64, used for AES-256-GCM encryption of SMTP
         * credentials and DKIM private keys at rest.
         * Generate with: openssl rand -hex 32
         */
        ENCRYPTION_KEY: z
            .string()
            .min(32, 'ENCRYPTION_KEY must be at least 32 characters (use `openssl rand -hex 32`)'),

        /** Separate secret for unsubscribe/tracking link HMACs. */
        LINK_SECRET: z.preprocess(blankAsUndefined, z.string().min(16).optional()),

        // ---- Sending -------------------------------------------------------------
        EMAIL_PROVIDER: z.enum(['ethereal', 'smtp', 'resend', 'ses']).default('ethereal'),

        SMTP_HOST: z.string().default('smtp.ethereal.email'),
        SMTP_PORT: numeric(587),
        SMTP_SECURE: z
            .enum(['true', 'false'])
            .default('false')
            .transform((v) => v === 'true'),
        SMTP_USER: optionalString(),
        SMTP_PASS: optionalString(),

        RESEND_API_KEY: optionalString(),
        RESEND_WEBHOOK_SECRET: optionalString(),

        AWS_REGION: z.string().default('us-east-1'),
        AWS_ACCESS_KEY_ID: optionalString(),
        AWS_SECRET_ACCESS_KEY: optionalString(),
        SES_CONFIGURATION_SET: optionalString(),

        // ---- Throttling ----------------------------------------------------------
        MAX_EMAILS_PER_HOUR_PER_SENDER: numeric(200),
        DELAY_BETWEEN_EMAILS_MS: numeric(2000),
        WORKER_CONCURRENCY: numeric(5),
        /** Rows enqueued per fan-out batch when a campaign is scheduled. */
        FANOUT_BATCH_SIZE: numeric(500),
        /** A `processing` row older than this is considered stuck and recovered. */
        STUCK_JOB_TIMEOUT_MS: numeric(10 * 60 * 1000),
        /**
         * How late a past-due email may be and still get sent on recovery.
         * Older than this and it is marked failed rather than surprising the
         * recipient with a stale message.
         */
        MAX_RECOVERY_LATENESS_MS: numeric(24 * 60 * 60 * 1000),

        // ---- Compliance ----------------------------------------------------------
        /** Pause a campaign if the complaint rate exceeds this fraction. */
        MAX_COMPLAINT_RATE: z.coerce.number().min(0).max(1).default(0.001),
        MAX_BOUNCE_RATE: z.coerce.number().min(0).max(1).default(0.05),
        /** Soft bounces before the address is suppressed. */
        SOFT_BOUNCE_THRESHOLD: numeric(3),

        // ---- Server --------------------------------------------------------------
        PORT: numeric(3001),
        /**
         * Port the standalone worker's health endpoint binds to. Defaults to
         * PORT+1 so the API and worker can run side by side on one machine.
         * Platforms that require a service to bind their injected $PORT (Render
         * web services) need this set to the same value as PORT.
         */
        WORKER_PORT: optionalNumeric(),
        NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
        LOG_LEVEL: z
            .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
            .default('info'),

        /** Public URL of THIS api — used to build unsubscribe/tracking links. */
        API_URL: z.string().default('http://localhost:3001'),
        FRONTEND_URL: z.string().default('http://localhost:3000'),
        /** Extra allowed CORS origins (e.g. Vercel preview deployments). */
        ALLOWED_ORIGINS: csv,

        /** Set false on the API service when workers run separately. */
        RUN_WORKER_IN_API: z
            .enum(['true', 'false'])
            .default('true')
            .transform((v) => v === 'true'),
    })
    .transform((e) => ({
        ...e,
        REDIS_URL: e.REDIS_URL ?? e.UPSTASH_REDIS_URL ?? '',
        WORKER_PORT: e.WORKER_PORT ?? e.PORT + 1,
        LINK_SECRET: e.LINK_SECRET ?? e.JWT_SECRET,
        /** Every origin permitted by CORS. */
        /**
         * Browsers send `Origin` with no trailing slash and no path, so a
         * configured value like `https://app.vercel.app/` would never match and
         * every request would be blocked. Normalise to scheme://host[:port].
         */
        CORS_ORIGINS: [e.FRONTEND_URL, ...e.ALLOWED_ORIGINS]
            .filter(Boolean)
            .map((value) => {
                try {
                    return new URL(value).origin;
                } catch {
                    // Not a URL (bad config) — strip trailing slashes and let
                    // the comparison fail loudly rather than throwing at boot.
                    return value.replace(/\/+$/, '');
                }
            }),
        IS_PROD: e.NODE_ENV === 'production',
        IS_TEST: e.NODE_ENV === 'test',
    }))
    .refine((e) => e.REDIS_URL.length > 0, {
        message: 'REDIS_URL (or UPSTASH_REDIS_URL) is required',
        path: ['REDIS_URL'],
    })
    .refine((e) => e.EMAIL_PROVIDER !== 'resend' || !!e.RESEND_API_KEY, {
        message: 'RESEND_API_KEY is required when EMAIL_PROVIDER=resend',
        path: ['RESEND_API_KEY'],
    })
    .refine(
        (e) =>
            e.EMAIL_PROVIDER !== 'ses' || (!!e.AWS_ACCESS_KEY_ID && !!e.AWS_SECRET_ACCESS_KEY),
        {
            message: 'AWS credentials are required when EMAIL_PROVIDER=ses',
            path: ['AWS_ACCESS_KEY_ID'],
        }
    );

const parseEnv = () => {
    const result = envSchema.safeParse(process.env);

    if (!result.success) {
        // Logger depends on env, so this one place uses console directly.
        console.error('Invalid environment variables:');
        for (const [key, messages] of Object.entries(result.error.flatten().fieldErrors)) {
            console.error(`  ${key}: ${(messages as string[]).join(', ')}`);
        }
        process.exit(1);
    }

    return result.data;
};

export const env = parseEnv();
export type Env = typeof env;
