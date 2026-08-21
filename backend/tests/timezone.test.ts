import { describe, expect, it } from 'vitest';
import {
    clampToBusinessHours,
    formatInZone,
    hourInZone,
    isValidTimezone,
    normalizeTimezone,
    resolveScheduleInstant,
    shiftWallClockToZone,
    wallClockToUtc,
} from '../src/services/timezoneService.js';

describe('timezone validation', () => {
    it('accepts IANA zone names', () => {
        expect(isValidTimezone('Asia/Kolkata')).toBe(true);
        expect(isValidTimezone('UTC')).toBe(true);
    });

    it('rejects nonsense', () => {
        expect(isValidTimezone('Mars/Olympus')).toBe(false);
        expect(isValidTimezone('GMT+5')).toBe(false);
    });

    it('falls back to UTC rather than throwing', () => {
        expect(normalizeTimezone('Mars/Olympus')).toBe('UTC');
        expect(normalizeTimezone(null)).toBe('UTC');
        expect(normalizeTimezone('Europe/Berlin')).toBe('Europe/Berlin');
    });
});

describe('resolveScheduleInstant', () => {
    it('preserves an absolute instant', () => {
        const instant = resolveScheduleInstant('2026-08-01T09:00:00.000Z', 'Asia/Kolkata');
        expect(instant.toISOString()).toBe('2026-08-01T09:00:00.000Z');
    });

    it('honours an explicit offset', () => {
        const instant = resolveScheduleInstant('2026-08-01T09:00:00+05:30', 'Asia/Kolkata');
        expect(instant.toISOString()).toBe('2026-08-01T03:30:00.000Z');
    });

    it('rejects an unparseable value', () => {
        expect(() => resolveScheduleInstant('not a date')).toThrow('Invalid scheduledAt');
    });
});

describe('wallClockToUtc', () => {
    it('interprets a naive local time in the given zone', () => {
        // IST is UTC+5:30 year-round.
        expect(wallClockToUtc('2026-08-01T09:00:00', 'Asia/Kolkata').toISOString()).toBe(
            '2026-08-01T03:30:00.000Z'
        );
    });

    it('accounts for daylight saving', () => {
        // New York is UTC-4 in August, UTC-5 in January.
        expect(wallClockToUtc('2026-08-01T09:00:00', 'America/New_York').toISOString()).toBe(
            '2026-08-01T13:00:00.000Z'
        );
        expect(wallClockToUtc('2026-01-01T09:00:00', 'America/New_York').toISOString()).toBe(
            '2026-01-01T14:00:00.000Z'
        );
    });
});

describe('shiftWallClockToZone', () => {
    it('keeps the wall clock and moves the instant', () => {
        // 09:00 in London becomes 09:00 in New York — a different instant.
        const london9am = wallClockToUtc('2026-08-01T09:00:00', 'Europe/London');
        const shifted = shiftWallClockToZone(london9am, 'Europe/London', 'America/New_York');

        expect(hourInZone(shifted, 'America/New_York')).toBe(9);
        expect(shifted.getTime()).not.toBe(london9am.getTime());
    });

    it('is a no-op for the same zone', () => {
        const instant = new Date('2026-08-01T09:00:00.000Z');
        expect(shiftWallClockToZone(instant, 'UTC', 'UTC').getTime()).toBe(instant.getTime());
    });

    it('treats an unknown target zone as UTC instead of failing', () => {
        const instant = new Date('2026-08-01T09:00:00.000Z');
        expect(() => shiftWallClockToZone(instant, 'UTC', 'Mars/Olympus')).not.toThrow();
    });
});

describe('clampToBusinessHours', () => {
    it('leaves a time already inside the window alone', () => {
        const instant = wallClockToUtc('2026-08-03T11:00:00', 'Europe/London');
        expect(clampToBusinessHours(instant, 'Europe/London').getTime()).toBe(instant.getTime());
    });

    it('moves an early-morning send forward to opening time', () => {
        const instant = wallClockToUtc('2026-08-03T03:00:00', 'Europe/London');
        const clamped = clampToBusinessHours(instant, 'Europe/London');

        expect(hourInZone(clamped, 'Europe/London')).toBe(9);
    });

    it('pushes an evening send to the next morning', () => {
        const instant = wallClockToUtc('2026-08-03T22:00:00', 'Europe/London');
        const clamped = clampToBusinessHours(instant, 'Europe/London');

        expect(hourInZone(clamped, 'Europe/London')).toBe(9);
        expect(clamped.getTime()).toBeGreaterThan(instant.getTime());
    });
});

describe('formatInZone', () => {
    it('renders an instant in the requested zone', () => {
        const instant = new Date('2026-08-01T03:30:00.000Z');
        expect(formatInZone(instant, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm')).toBe('2026-08-01 09:00');
    });
});
