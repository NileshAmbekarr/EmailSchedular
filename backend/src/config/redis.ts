import Redis from 'ioredis';
import { env } from './env.js';

// Create Redis connection for BullMQ
// Upstash requires TLS, which is handled by the 'rediss://' protocol
export const redis = new Redis(env.UPSTASH_REDIS_URL, {
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false,
});

redis.on('connect', () => {
    console.log('✅ Redis connected');
});

redis.on('error', (err) => {
    console.error('❌ Redis connection error:', err);
});

// Create a duplicate connection for BullMQ subscriber
// BullMQ requires separate connections for pub/sub
export const createRedisConnection = () => {
    return new Redis(env.UPSTASH_REDIS_URL, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
    });
};
