import { fromZonedTime, toZonedTime, formatInTimeZone } from 'date-fns-tz';

/**
 * Timezone handling.
 *
 * Contract: `scheduledAt` crossing the API is always an ISO-8601 instant (with
 * an offset or `Z`), so it is unambiguous on arrival. The separate `timezone`
 * field records the zone the user *chose* the time in — needed to display it
 * back correctly and to support "9am in each recipient's local time".
 *
 * Everything is stored in UTC. Deriving windows or boundaries from server local
 * time is what made the original rate limiter disagree between replicas.
 */

/** Validates an IANA zone name using the platform's own tz database. */
export const isValidTimezone = (timezone: string): boolean => {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone });
        return true;
    } catch {
        return false;
    }
};

/** Falls back to UTC rather than throwing on an unknown zone. */
export const normalizeTimezone = (timezone?: string | null): string =>
    timezone && isValidTimezone(timezone) ? timezone : 'UTC';

/**
 * Accepts the instant supplied by the client and validates the accompanying
 * zone. The instant is already absolute, so no conversion is applied — this
 * exists so callers get a single, checked entry point.
 */
export const resolveScheduleInstant = (scheduledAt: Date | string, timezone?: string): Date => {
    const date = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
    if (Number.isNaN(date.getTime())) throw new Error('Invalid scheduledAt');
    normalizeTimezone(timezone); // surfaces nothing, but keeps validation in one place
    return date;
};

/** Backwards-compatible alias used by the campaign service. */
export const zonedTimeToUtcSafe = resolveScheduleInstant;

/**
 * Converts a wall-clock string like `2026-08-01T09:00` in `timezone` to the
 * corresponding UTC instant. Used when a client sends a naive local time.
 */
export const wallClockToUtc = (wallClock: string, timezone: string): Date =>
    fromZonedTime(wallClock, normalizeTimezone(timezone));

/**
 * Re-anchors an instant so it lands at the same wall-clock time in a different
 * zone. "Send at 9am local" for a list spanning continents means a different
 * absolute instant per recipient.
 */
export const shiftWallClockToZone = (
    instant: Date,
    fromTimezone: string,
    toTimezone: string
): Date => {
    const from = normalizeTimezone(fromTimezone);
    const to = normalizeTimezone(toTimezone);
    if (from === to) return instant;

    // Read the wall clock in the source zone, then reinterpret it in the target.
    const wallClock = formatInTimeZone(instant, from, "yyyy-MM-dd'T'HH:mm:ss");
    return fromZonedTime(wallClock, to);
};

/** Formats an instant for display in a given zone. */
export const formatInZone = (
    instant: Date,
    timezone: string,
    pattern = "yyyy-MM-dd HH:mm 'UTC'XXX"
): string => formatInTimeZone(instant, normalizeTimezone(timezone), pattern);

/** Local hour-of-day in a zone — used for business-hours windows. */
export const hourInZone = (instant: Date, timezone: string): number =>
    toZonedTime(instant, normalizeTimezone(timezone)).getHours();

/**
 * Nudges an instant into a business-hours window in the target zone, so a
 * campaign never lands at 3am.
 */
export const clampToBusinessHours = (
    instant: Date,
    timezone: string,
    opts: { startHour?: number; endHour?: number } = {}
): Date => {
    const startHour = opts.startHour ?? 9;
    const endHour = opts.endHour ?? 17;
    const zone = normalizeTimezone(timezone);

    const local = toZonedTime(instant, zone);
    const hour = local.getHours();

    if (hour >= startHour && hour < endHour) return instant;

    const shifted = new Date(local);
    if (hour < startHour) {
        shifted.setHours(startHour, 0, 0, 0);
    } else {
        shifted.setDate(shifted.getDate() + 1);
        shifted.setHours(startHour, 0, 0, 0);
    }

    return fromZonedTime(shifted, zone);
};

/** A reasonable picker list for the settings screen. */
export const COMMON_TIMEZONES = [
    'UTC',
    'America/Los_Angeles',
    'America/Denver',
    'America/Chicago',
    'America/New_York',
    'America/Sao_Paulo',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Moscow',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Singapore',
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Australia/Sydney',
    'Pacific/Auckland',
] as const;
