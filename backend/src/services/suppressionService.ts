import { and, eq, inArray, desc, sql } from 'drizzle-orm';
import { db } from '../config/database.js';
import { redis } from '../config/redis.js';
import { suppressions, type SuppressionReason } from '../db/schema.js';
import { log } from '../config/logger.js';

const logger = log('suppression');

/**
 * The suppression list is the single most important safety mechanism in a bulk
 * sender. Unsubscribes, hard bounces and spam complaints all land here, and the
 * worker consults it immediately before every send — not at schedule time,
 * because a campaign queued on Monday may still be sending on Wednesday, well
 * after someone opted out.
 *
 * Lookups are cached in Redis: this runs once per message, and it must not
 * become a per-send database round trip.
 */

const CACHE_TTL_SECONDS = 300;
const cacheKey = (userId: string, email: string) => `suppressed:${userId}:${email.toLowerCase()}`;

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** True when this address must not be contacted. */
export const isSuppressed = async (userId: string, email: string): Promise<boolean> => {
    const normalized = normalizeEmail(email);
    const key = cacheKey(userId, normalized);

    const cached = await redis.get(key).catch(() => null);
    if (cached !== null) return cached === '1';

    const [row] = await db
        .select({ id: suppressions.id })
        .from(suppressions)
        .where(and(eq(suppressions.userId, userId), eq(suppressions.email, normalized)))
        .limit(1);

    const suppressed = Boolean(row);
    await redis.setex(key, CACHE_TTL_SECONDS, suppressed ? '1' : '0').catch(() => {});
    return suppressed;
};

/** Bulk variant used at campaign creation to filter the recipient list up front. */
export const filterSuppressed = async (
    userId: string,
    emails: string[]
): Promise<{ allowed: string[]; suppressed: string[] }> => {
    const normalized = [...new Set(emails.map(normalizeEmail))];
    if (normalized.length === 0) return { allowed: [], suppressed: [] };

    const rows = await db
        .select({ email: suppressions.email })
        .from(suppressions)
        .where(and(eq(suppressions.userId, userId), inArray(suppressions.email, normalized)));

    const blocked = new Set(rows.map((r) => r.email));
    return {
        allowed: normalized.filter((e) => !blocked.has(e)),
        suppressed: [...blocked],
    };
};

/**
 * Adds an address to the list. Idempotent — a repeat suppression keeps the
 * original reason rather than overwriting the audit trail.
 */
export const suppress = async (
    userId: string,
    email: string,
    reason: SuppressionReason,
    detail?: string
): Promise<void> => {
    const normalized = normalizeEmail(email);

    await db
        .insert(suppressions)
        .values({ userId, email: normalized, reason, detail })
        .onConflictDoNothing({ target: [suppressions.userId, suppressions.email] });

    await redis.setex(cacheKey(userId, normalized), CACHE_TTL_SECONDS, '1').catch(() => {});
    logger.info({ userId, reason }, 'address suppressed');
};

/** Manual removal. Only ever appropriate for addresses suppressed in error. */
export const unsuppress = async (userId: string, email: string): Promise<boolean> => {
    const normalized = normalizeEmail(email);

    const deleted = await db
        .delete(suppressions)
        .where(and(eq(suppressions.userId, userId), eq(suppressions.email, normalized)))
        .returning({ id: suppressions.id });

    await redis.del(cacheKey(userId, normalized)).catch(() => {});
    return deleted.length > 0;
};

export const listSuppressions = async (
    userId: string,
    opts: { limit: number; offset: number; reason?: SuppressionReason; search?: string }
) => {
    const conditions = [eq(suppressions.userId, userId)];
    if (opts.reason) conditions.push(eq(suppressions.reason, opts.reason));
    if (opts.search) {
        conditions.push(sql`${suppressions.email} ILIKE ${'%' + opts.search + '%'}`);
    }

    const where = and(...conditions);

    const [rows, [{ count }]] = await Promise.all([
        db
            .select()
            .from(suppressions)
            .where(where)
            .orderBy(desc(suppressions.createdAt))
            .limit(opts.limit)
            .offset(opts.offset),
        db.select({ count: sql<number>`count(*)::int` }).from(suppressions).where(where),
    ]);

    return { rows, total: count };
};

/**
 * Soft bounces are tolerated until they repeat — a full mailbox or a temporary
 * server problem should not permanently disqualify an address.
 */
export const recordSoftBounce = async (
    userId: string,
    email: string,
    threshold: number,
    detail?: string
): Promise<boolean> => {
    const key = `softbounce:${userId}:${normalizeEmail(email)}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 30 * 24 * 60 * 60);

    if (count >= threshold) {
        await suppress(userId, email, 'soft_bounce_threshold', detail);
        await redis.del(key).catch(() => {});
        return true;
    }
    return false;
};
