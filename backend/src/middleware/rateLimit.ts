import rateLimit, { type Options } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { RequestHandler } from 'express';
import { redis } from '../config/redis.js';
import { env } from '../config/env.js';
import { log } from '../config/logger.js';

const logger = log('rate-limit');

/**
 * Wraps a limiter so that a Redis outage lets the request through instead of
 * turning into a 500.
 *
 * The trade-off is deliberate: losing Redis should degrade abuse protection,
 * not take the whole API down with it. Sending quotas are enforced separately
 * in the worker, where failing closed is the safe direction.
 */
const failOpen = (limiter: RequestHandler): RequestHandler => (req, res, next) => {
    limiter(req, res, (err?: unknown) => {
        if (err) {
            logger.warn({ err }, 'rate limit store unavailable, allowing request');
            next();
            return;
        }
        next();
    });
};

/**
 * HTTP-level abuse protection.
 *
 * There was previously nothing between an attacker and unlimited attempts at
 * `/api/auth/login`, which is all credential stuffing needs. Counters live in
 * Redis so the limit is shared across replicas rather than reset per instance.
 */

const store = () =>
    new RedisStore({
        // node-redis style call signature expected by rate-limit-redis.
        sendCommand: (...args: string[]) => redis.call(...(args as [string, ...string[]])) as Promise<never>,
        prefix: 'httprl:',
    });

const base: Partial<Options> = {
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Skip limiting in tests so suites are not order-dependent.
    skip: () => env.IS_TEST,
    message: { success: false, error: 'Too many requests, please slow down' },
};

/** Broad ceiling applied to the whole API. */
export const globalLimiter = failOpen(
    rateLimit({
        ...base,
        store: store(),
        windowMs: 60_000,
        limit: 300,
    })
);

/**
 * Login and registration. Keyed by IP *and* the submitted email so one
 * attacker cannot lock out a victim by hammering their address from elsewhere.
 */
export const authLimiter = failOpen(
    rateLimit({
        ...base,
        store: store(),
        windowMs: 15 * 60_000,
        limit: 10,
        keyGenerator: (req) => {
            const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : '';
            return `${req.ip}:${email}`;
        },
        message: {
            success: false,
            error: 'Too many attempts. Try again in 15 minutes.',
        },
    })
);

/** Password reset and verification resends — expensive and abusable. */
export const sensitiveLimiter = failOpen(
    rateLimit({
        ...base,
        store: store(),
        windowMs: 60 * 60_000,
        limit: 5,
    })
);

/** Campaign creation, which fans out into real sending volume. */
export const sendLimiter = failOpen(
    rateLimit({
        ...base,
        store: store(),
        windowMs: 60_000,
        limit: 30,
        keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anonymous',
    })
);

/** Public tracking endpoints, which are unauthenticated by necessity. */
export const publicLimiter = failOpen(
    rateLimit({
        ...base,
        store: store(),
        windowMs: 60_000,
        limit: 120,
    })
);
