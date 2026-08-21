import { describe, expect, it } from 'vitest';
import {
    computeSendTimes,
    getDayWindow,
    getHourWindow,
    nextDayBoundary,
    nextHourBoundary,
    resolveSenderLimits,
    warmupLimitForDay,
} from '../src/services/rateLimitService.js';

describe('rate limit windows', () => {
    it('derives hour windows in UTC, not server local time', () => {
        // 23:30 UTC on 5 July. In any timezone east or west of UTC the local
        // calendar date or hour differs — the key must not.
        const instant = new Date('2026-07-05T23:30:00.000Z');

        expect(getHourWindow(instant)).toBe('2026-07-05-23');
        expect(getDayWindow(instant)).toBe('2026-07-05');
    });

    it('rolls the hour window over at the UTC boundary', () => {
        expect(getHourWindow(new Date('2026-07-05T23:59:59.999Z'))).toBe('2026-07-05-23');
        expect(getHourWindow(new Date('2026-07-06T00:00:00.000Z'))).toBe('2026-07-06-00');
    });

    it('computes the next hour boundary in UTC', () => {
        const next = nextHourBoundary(new Date('2026-07-05T14:37:12.000Z'));
        expect(next.toISOString()).toBe('2026-07-05T15:00:00.000Z');
    });

    it('computes the next day boundary in UTC', () => {
        const next = nextDayBoundary(new Date('2026-07-05T14:37:12.000Z'));
        expect(next.toISOString()).toBe('2026-07-06T00:00:00.000Z');
    });

    it('does not skip or duplicate an hour across a DST transition', () => {
        // US DST ends 1 Nov 2026; local clocks repeat 01:00-02:00.
        // UTC-derived windows are unaffected.
        const before = new Date('2026-11-01T05:30:00.000Z');
        const after = new Date('2026-11-01T06:30:00.000Z');

        expect(getHourWindow(before)).toBe('2026-11-01-05');
        expect(getHourWindow(after)).toBe('2026-11-01-06');
        expect(getHourWindow(before)).not.toBe(getHourWindow(after));
    });
});

describe('sender limits', () => {
    it('falls back to the global hourly cap', () => {
        const limits = resolveSenderLimits({
            hourlyLimit: null,
            dailyLimit: null,
            warmupEnabled: false,
            warmupStartedAt: null,
        });

        expect(limits.hourly).toBe(200);
        expect(limits.daily).toBe(200 * 24);
    });

    it('prefers explicit per-sender overrides', () => {
        const limits = resolveSenderLimits({
            hourlyLimit: 50,
            dailyLimit: 500,
            warmupEnabled: false,
            warmupStartedAt: null,
        });

        expect(limits).toEqual({ hourly: 50, daily: 500 });
    });

    it('clamps the daily cap while a domain is warming up', () => {
        const startedAt = new Date('2026-07-01T00:00:00.000Z');
        const dayThree = new Date('2026-07-03T12:00:00.000Z');

        const limits = resolveSenderLimits(
            {
                hourlyLimit: 1000,
                dailyLimit: 100_000,
                warmupEnabled: true,
                warmupStartedAt: startedAt,
            },
            dayThree
        );

        // Day index 2 of the ramp, far below the configured ceiling.
        expect(limits.daily).toBe(warmupLimitForDay(2));
        expect(limits.daily).toBeLessThan(100_000);
    });

    it('never lets warmup raise a limit above the configured value', () => {
        const limits = resolveSenderLimits(
            {
                hourlyLimit: 10,
                dailyLimit: 100,
                warmupEnabled: true,
                warmupStartedAt: new Date('2020-01-01T00:00:00.000Z'),
            },
            new Date('2026-07-01T00:00:00.000Z')
        );

        expect(limits.daily).toBe(100);
    });
});

describe('computeSendTimes', () => {
    const start = new Date('2026-07-05T10:00:00.000Z');

    it('spreads messages by the configured delay', () => {
        const times = computeSendTimes(start, 3, { delayMs: 2000, hourlyLimit: 100 });

        expect(times[0].toISOString()).toBe('2026-07-05T10:00:00.000Z');
        expect(times[1].toISOString()).toBe('2026-07-05T10:00:02.000Z');
        expect(times[2].toISOString()).toBe('2026-07-05T10:00:04.000Z');
    });

    it('rolls overflow past the hourly cap into the next hour', () => {
        const times = computeSendTimes(start, 5, { delayMs: 1000, hourlyLimit: 2 });

        // First two in hour 0, next two in hour 1, fifth in hour 2.
        expect(times[0].getTime()).toBe(start.getTime());
        expect(times[2].getTime()).toBe(start.getTime() + 3_600_000);
        expect(times[4].getTime()).toBe(start.getTime() + 2 * 3_600_000);
    });

    it('never lets the intra-hour spread overflow its own window', () => {
        // 500 messages × 30s of delay would be 4h660 of spread inside one hour.
        const times = computeSendTimes(start, 500, { delayMs: 30_000, hourlyLimit: 500 });
        const last = times[times.length - 1].getTime() - start.getTime();

        expect(last).toBeLessThan(3_600_000);
    });

    it('produces a monotonically non-decreasing schedule', () => {
        const times = computeSendTimes(start, 250, { delayMs: 1500, hourlyLimit: 60 });

        for (let i = 1; i < times.length; i++) {
            expect(times[i].getTime()).toBeGreaterThanOrEqual(times[i - 1].getTime());
        }
    });

    it('returns an empty schedule for an empty batch', () => {
        expect(computeSendTimes(start, 0, { delayMs: 1000, hourlyLimit: 10 })).toEqual([]);
    });
});
