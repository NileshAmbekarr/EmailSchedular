import { Redis, type RedisOptions } from 'ioredis';
import { env } from './env.js';
import { log } from './logger.js';

const logger = log('redis');

/**
 * BullMQ requires `maxRetriesPerRequest: null` so commands queue rather than
 * throw while the connection is re-establishing.
 */
export const getRedisConnectionOptions = (): RedisOptions => {
    const url = new URL(env.REDIS_URL);

    return {
        host: url.hostname,
        port: Number(url.port) || 6379,
        username: url.username || 'default',
        password: url.password || undefined,
        tls: url.protocol === 'rediss:' ? {} : undefined,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        // Prevents unbounded memory growth if Redis is unavailable for a long time.
        enableOfflineQueue: true,
        retryStrategy: (times) => Math.min(times * 200, 5000),
    };
};

/**
 * Shared client for rate limiting, caching and locks (not for BullMQ).
 *
 * Unlike the BullMQ connections this one **fails fast**: with the offline queue
 * enabled, a command issued while Redis is unreachable waits indefinitely
 * instead of erroring, which turned a Redis outage into every HTTP request
 * hanging. Callers here either tolerate a miss (the suppression cache) or
 * should fail closed (rate limiting) — both are better than a hang.
 */
export const redis = new Redis(env.REDIS_URL, {
    ...getRedisConnectionOptions(),
    enableOfflineQueue: false,
    commandTimeout: 5_000,
});

redis.on('connect', () => logger.info('connected'));

// Without a listener ioredis treats connection errors as unhandled and crashes
// the process. Log once per transition rather than per retry.
let lastErrorMessage: string | undefined;
redis.on('error', (err: Error) => {
    if (err.message === lastErrorMessage) return;
    lastErrorMessage = err.message;
    logger.error({ err }, 'connection error');
});
redis.on('ready', () => {
    lastErrorMessage = undefined;
});

export const closeRedis = async (): Promise<void> => {
    try {
        await redis.quit();
    } catch {
        redis.disconnect();
    }
};

/** Used by the readiness probe. */
export const pingRedis = async (): Promise<boolean> => {
    try {
        return (await redis.ping()) === 'PONG';
    } catch {
        return false;
    }
};
