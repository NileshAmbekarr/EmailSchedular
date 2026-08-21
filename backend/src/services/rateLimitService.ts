import { redis } from '../config/redis.js';
import { env } from '../config/env.js';
import type { Sender } from '../db/schema.js';

/**
 * Per-sender throughput control.
 *
 * The previous implementation did GET -> compare -> INCR as three round trips,
 * so N concurrent workers could all read `limit - 1` and all proceed. Here the
 * read, the comparison and both increments happen inside a single Lua script,
 * which Redis executes atomically. That is what actually makes the limit hold
 * across concurrent workers and multiple replicas.
 *
 * Windows are keyed in **UTC**. Deriving them from server local time meant two
 * replicas in different regions disagreed about the current bucket, and DST
 * shifts produced a doubled or missing hour.
 */

export interface RateLimitDecision {
    allowed: boolean;
    /** Which cap was hit, when not allowed. */
    limitedBy?: 'hour' | 'day';
    hourCount: number;
    dayCount: number;
    hourLimit: number;
    dayLimit: number;
    /** When the blocking window rolls over. */
    resetAt: Date;
}

export interface SenderLimits {
    hourly: number;
    daily: number;
}

const HOUR_TTL_SECONDS = 3600;
const DAY_TTL_SECONDS = 86400;

// ---------------------------------------------------------------------------
// Window keys (UTC)
// ---------------------------------------------------------------------------

export const getHourWindow = (date: Date = new Date()): string =>
    `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
        date.getUTCDate()
    ).padStart(2, '0')}-${String(date.getUTCHours()).padStart(2, '0')}`;

export const getDayWindow = (date: Date = new Date()): string =>
    `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
        date.getUTCDate()
    ).padStart(2, '0')}`;

const hourKey = (senderId: string, window = getHourWindow()) =>
    `ratelimit:h:${senderId}:${window}`;
const dayKey = (senderId: string, window = getDayWindow()) => `ratelimit:d:${senderId}:${window}`;

/** Start of the next UTC hour. */
export const nextHourBoundary = (from: Date = new Date()): Date => {
    const d = new Date(from);
    d.setUTCMinutes(0, 0, 0);
    d.setUTCHours(d.getUTCHours() + 1);
    return d;
};

/** Start of the next UTC day. */
export const nextDayBoundary = (from: Date = new Date()): Date => {
    const d = new Date(from);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + 1);
    return d;
};

// ---------------------------------------------------------------------------
// Warmup
// ---------------------------------------------------------------------------

/**
 * A brand-new sending domain that suddenly emits thousands of messages is the
 * fastest route to a blocklist. Warmup ramps the daily allowance over ~3 weeks.
 */
const WARMUP_SCHEDULE = [
    50, 100, 200, 350, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000, 7500, 10000, 15000, 20000,
    30000, 40000, 50000, 75000, 100000,
];

export const warmupLimitForDay = (dayIndex: number): number =>
    WARMUP_SCHEDULE[Math.min(Math.max(dayIndex, 0), WARMUP_SCHEDULE.length - 1)];

/**
 * Effective caps for a sender: explicit overrides win, warmup clamps the daily
 * figure, and the global env value is the fallback.
 */
export const resolveSenderLimits = (
    sender: Pick<Sender, 'hourlyLimit' | 'dailyLimit' | 'warmupEnabled' | 'warmupStartedAt'>,
    now: Date = new Date()
): SenderLimits => {
    const hourly = sender.hourlyLimit ?? env.MAX_EMAILS_PER_HOUR_PER_SENDER;
    let daily = sender.dailyLimit ?? hourly * 24;

    if (sender.warmupEnabled && sender.warmupStartedAt) {
        const elapsedDays = Math.floor(
            (now.getTime() - new Date(sender.warmupStartedAt).getTime()) / DAY_TTL_SECONDS / 1000
        );
        daily = Math.min(daily, warmupLimitForDay(elapsedDays));
    }

    return { hourly, daily };
};

// ---------------------------------------------------------------------------
// Atomic reservation
// ---------------------------------------------------------------------------

/**
 * Reads both counters, compares them against their caps and increments both —
 * atomically. Returns 1/0 plus the resulting counts.
 *
 * KEYS[1] hour counter, KEYS[2] day counter
 * ARGV[1] hour limit, ARGV[2] day limit, ARGV[3] hour ttl, ARGV[4] day ttl
 */
const RESERVE_SCRIPT = `
local hourCount = tonumber(redis.call('GET', KEYS[1]) or '0')
local dayCount  = tonumber(redis.call('GET', KEYS[2]) or '0')
local hourLimit = tonumber(ARGV[1])
local dayLimit  = tonumber(ARGV[2])

if hourCount >= hourLimit then
  return {0, 'hour', hourCount, dayCount}
end

if dayLimit > 0 and dayCount >= dayLimit then
  return {0, 'day', hourCount, dayCount}
end

hourCount = redis.call('INCR', KEYS[1])
if hourCount == 1 then redis.call('EXPIRE', KEYS[1], ARGV[3]) end

dayCount = redis.call('INCR', KEYS[2])
if dayCount == 1 then redis.call('EXPIRE', KEYS[2], ARGV[4]) end

return {1, '', hourCount, dayCount}
`;

type ReserveResult = [number, string, number, number];

/**
 * Attempts to consume one send slot for a sender.
 *
 * Call this immediately before handing the message to the provider — it is the
 * authoritative check. Scheduling-time spreading is only an optimisation.
 */
export const reserveSlot = async (
    senderId: string,
    limits: SenderLimits,
    now: Date = new Date()
): Promise<RateLimitDecision> => {
    const result = (await redis.eval(
        RESERVE_SCRIPT,
        2,
        hourKey(senderId, getHourWindow(now)),
        dayKey(senderId, getDayWindow(now)),
        String(limits.hourly),
        String(limits.daily),
        String(HOUR_TTL_SECONDS),
        String(DAY_TTL_SECONDS)
    )) as ReserveResult;

    const [allowed, limitedBy, hourCount, dayCount] = result;

    return {
        allowed: allowed === 1,
        limitedBy: allowed === 1 ? undefined : (limitedBy as 'hour' | 'day'),
        hourCount,
        dayCount,
        hourLimit: limits.hourly,
        dayLimit: limits.daily,
        resetAt: limitedBy === 'day' ? nextDayBoundary(now) : nextHourBoundary(now),
    };
};

/**
 * Returns a previously reserved slot. Used when a send fails in a way that will
 * be retried — the attempt never reached the provider, so it should not count
 * against the sender's quota.
 */
export const releaseSlot = async (senderId: string, now: Date = new Date()): Promise<void> => {
    const h = hourKey(senderId, getHourWindow(now));
    const d = dayKey(senderId, getDayWindow(now));

    // Guard against dropping below zero if the window rolled over in between.
    await redis
        .multi()
        .eval(`if tonumber(redis.call('GET', KEYS[1]) or '0') > 0 then return redis.call('DECR', KEYS[1]) end return 0`, 1, h)
        .eval(`if tonumber(redis.call('GET', KEYS[1]) or '0') > 0 then return redis.call('DECR', KEYS[1]) end return 0`, 1, d)
        .exec();
};

/** Read-only view of the current counters, for the dashboard. */
export const getRateLimitStatus = async (
    senderId: string,
    limits: SenderLimits,
    now: Date = new Date()
): Promise<RateLimitDecision> => {
    const [hourRaw, dayRaw] = await redis.mget(
        hourKey(senderId, getHourWindow(now)),
        dayKey(senderId, getDayWindow(now))
    );

    const hourCount = Number(hourRaw ?? 0);
    const dayCount = Number(dayRaw ?? 0);
    const hourExhausted = hourCount >= limits.hourly;
    const dayExhausted = limits.daily > 0 && dayCount >= limits.daily;

    return {
        allowed: !hourExhausted && !dayExhausted,
        limitedBy: hourExhausted ? 'hour' : dayExhausted ? 'day' : undefined,
        hourCount,
        dayCount,
        hourLimit: limits.hourly,
        dayLimit: limits.daily,
        resetAt: dayExhausted ? nextDayBoundary(now) : nextHourBoundary(now),
    };
};

export const resetRateLimit = async (senderId: string): Promise<void> => {
    await redis.del(hourKey(senderId), dayKey(senderId));
};

// ---------------------------------------------------------------------------
// Schedule spreading
// ---------------------------------------------------------------------------

/**
 * Spreads a batch of `total` messages starting at `startAt`, honouring the
 * inter-send delay and the hourly cap.
 *
 * This is pure arithmetic over the batch. The old version consulted the
 * *current* hour's Redis counter to place messages destined for a future hour,
 * which produced meaningless offsets, and did one Redis round trip per
 * recipient.
 */
export const computeSendTimes = (
    startAt: Date,
    total: number,
    opts: { delayMs: number; hourlyLimit: number }
): Date[] => {
    const { delayMs, hourlyLimit } = opts;
    const base = startAt.getTime();
    const times: Date[] = new Array(total);

    // Messages beyond the hourly cap roll into subsequent hour windows.
    for (let i = 0; i < total; i++) {
        const hourOffset = hourlyLimit > 0 ? Math.floor(i / hourlyLimit) : 0;
        const indexInHour = hourlyLimit > 0 ? i % hourlyLimit : i;

        // Never let the intra-hour spread overflow into the next window.
        const spread = Math.min(indexInHour * delayMs, HOUR_TTL_SECONDS * 1000 - 1000);
        times[i] = new Date(base + hourOffset * HOUR_TTL_SECONDS * 1000 + spread);
    }

    return times;
};
