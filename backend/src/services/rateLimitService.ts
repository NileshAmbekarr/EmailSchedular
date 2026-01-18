import { redis } from '../config/redis.js';
import { env } from '../config/env.js';
import type { RateLimitInfo } from '../types/index.js';

/**
 * Get the current hour window key (e.g., "2024-01-17-14" for 2-3 PM)
 */
const getHourWindow = (date: Date = new Date()): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    return `${year}-${month}-${day}-${hour}`;
};

/**
 * Get the Redis key for a sender's rate limit counter
 */
const getRateLimitKey = (senderId: string, hourWindow: string): string => {
    return `ratelimit:${senderId}:${hourWindow}`;
};

/**
 * Check if a sender can send an email (under rate limit)
 * Returns remaining count and whether allowed
 */
export const checkRateLimit = async (senderId: string): Promise<RateLimitInfo> => {
    const hourWindow = getHourWindow();
    const key = getRateLimitKey(senderId, hourWindow);
    const limit = env.MAX_EMAILS_PER_HOUR_PER_SENDER;

    const currentCount = await redis.get(key);
    const count = currentCount ? parseInt(currentCount, 10) : 0;

    // Calculate when the rate limit resets (next hour)
    const now = new Date();
    const resetAt = new Date(now);
    resetAt.setHours(resetAt.getHours() + 1, 0, 0, 0);

    return {
        senderId,
        hourWindow,
        count,
        limit,
        remaining: Math.max(0, limit - count),
        resetAt,
    };
};

/**
 * Increment the rate limit counter for a sender
 * Returns the new count
 */
export const incrementRateLimit = async (senderId: string): Promise<number> => {
    const hourWindow = getHourWindow();
    const key = getRateLimitKey(senderId, hourWindow);

    // Increment and set TTL to 1 hour (auto-cleanup)
    const newCount = await redis.incr(key);

    // Set TTL if this is the first increment
    if (newCount === 1) {
        await redis.expire(key, 3600); // 1 hour TTL
    }

    return newCount;
};

/**
 * Get the delay in milliseconds until the next available send slot
 * If under limit, returns 0
 * If at limit, returns delay until next hour window
 */
export const getDelayUntilNextSlot = async (senderId: string): Promise<number> => {
    const rateInfo = await checkRateLimit(senderId);

    if (rateInfo.remaining > 0) {
        return 0;
    }

    // Calculate delay until next hour
    const now = new Date();
    const delayMs = rateInfo.resetAt.getTime() - now.getTime();

    return Math.max(0, delayMs);
};

/**
 * Calculate the scheduled time for an email considering rate limits
 * This is used when scheduling bulk emails to spread them out
 */
export const calculateScheduledTime = async (
    senderId: string,
    baseScheduledTime: Date,
    positionInBatch: number
): Promise<Date> => {
    const rateInfo = await checkRateLimit(senderId);
    const delayBetweenEmails = env.DELAY_BETWEEN_EMAILS_MS;
    const limit = env.MAX_EMAILS_PER_HOUR_PER_SENDER;

    // Calculate which hour window this email will be in
    const emailsAlreadySent = rateInfo.count;
    const emailPosition = emailsAlreadySent + positionInBatch;

    // If within limit for current hour
    if (emailPosition < limit) {
        const additionalDelay = positionInBatch * delayBetweenEmails;
        return new Date(baseScheduledTime.getTime() + additionalDelay);
    }

    // Calculate how many hours to delay
    const hoursToDelay = Math.floor(emailPosition / limit);
    const positionInNewHour = emailPosition % limit;

    const scheduledTime = new Date(baseScheduledTime);
    scheduledTime.setHours(scheduledTime.getHours() + hoursToDelay);
    scheduledTime.setMinutes(0, 0, 0); // Start of the hour

    // Add position-based delay within that hour
    const additionalDelay = positionInNewHour * delayBetweenEmails;
    return new Date(scheduledTime.getTime() + additionalDelay);
};

/**
 * Reset rate limit for a sender (for testing purposes)
 */
export const resetRateLimit = async (senderId: string): Promise<void> => {
    const hourWindow = getHourWindow();
    const key = getRateLimitKey(senderId, hourWindow);
    await redis.del(key);
};
