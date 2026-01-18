import { env } from './env.js';
import Redis from 'ioredis';

// Redis connection options for Upstash
const redisOptions = {
    maxRetriesPerRequest: null as null, // Required for BullMQ
    enableReadyCheck: false,
    lazyConnect: false,
};

// Main Redis instance for general use (rate limiting, etc.)
export const redis = new Redis(env.UPSTASH_REDIS_URL, redisOptions);

redis.on('connect', () => {
    console.log('✅ Redis connected');
});

redis.on('error', (err) => {
    console.error('❌ Redis connection error:', err);
});

// Get connection options for BullMQ
// BullMQ works better with connection options object rather than Redis instance
export const getRedisConnectionOptions = () => {
    // Parse the URL to extract components
    const url = new URL(env.UPSTASH_REDIS_URL);

    return {
        host: url.hostname,
        port: parseInt(url.port) || 6379,
        password: url.password || undefined,
        username: url.username || 'default',
        tls: url.protocol === 'rediss:' ? {} : undefined,
        maxRetriesPerRequest: null as null,
        enableReadyCheck: false,
    };
};
