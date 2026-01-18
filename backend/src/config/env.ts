import { z } from 'zod';

const envSchema = z.object({
    // Database
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    // Redis (use standard URL from Upstash, NOT the REST URL)
    UPSTASH_REDIS_URL: z.string().min(1, 'UPSTASH_REDIS_URL is required'),

    // JWT
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),

    // Google OAuth
    GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
    GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),

    // Rate Limiting
    MAX_EMAILS_PER_HOUR_PER_SENDER: z.string().transform(Number).default('200'),
    DELAY_BETWEEN_EMAILS_MS: z.string().transform(Number).default('2000'),
    WORKER_CONCURRENCY: z.string().transform(Number).default('5'),

    // SMTP (Ethereal)
    SMTP_HOST: z.string().default('smtp.ethereal.email'),
    SMTP_PORT: z.string().transform(Number).default('587'),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),

    // Server
    PORT: z.string().transform(Number).default('3001'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    // Frontend
    FRONTEND_URL: z.string().default('http://localhost:3000'),
});

// Parse and validate environment variables
const parseEnv = () => {
    const result = envSchema.safeParse(process.env);

    if (!result.success) {
        console.error('❌ Invalid environment variables:');
        console.error(result.error.flatten().fieldErrors);
        process.exit(1);
    }

    return result.data;
};

export const env = parseEnv();

export type Env = z.infer<typeof envSchema>;
