import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../config/database.js';
import { apiKeys, users } from '../db/schema.js';
import { env } from '../config/env.js';
import { sha256 } from '../services/cryptoService.js';
import { log } from '../config/logger.js';

const logger = log('auth');

export interface AuthUser {
    id: string;
    email: string;
    name: string;
    timezone: string;
}

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            user?: AuthUser;
            authMethod?: 'jwt' | 'api_key';
        }
    }
}

interface JwtClaims {
    sub: string;
    email: string;
    name: string;
    /** Issued-at, compared against the user's `tokensValidFrom`. */
    iat: number;
}

export const generateToken = (user: { id: string; email: string; name: string }): string =>
    jwt.sign({ sub: user.id, email: user.email, name: user.name }, env.JWT_SECRET, {
        expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    });

const extractBearer = (req: Request): string | undefined => {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    return undefined;
};

/**
 * Resolves an API key to its owner. Keys are stored as SHA-256 digests, so a
 * database leak does not hand out working credentials.
 */
const authenticateApiKey = async (rawKey: string): Promise<AuthUser | null> => {
    const [record] = await db
        .select({ id: apiKeys.id, userId: apiKeys.userId })
        .from(apiKeys)
        .where(and(eq(apiKeys.keyHash, sha256(rawKey)), isNull(apiKeys.revokedAt)))
        .limit(1);

    if (!record) return null;

    const user = await db.query.users.findFirst({
        where: eq(users.id, record.userId),
        columns: { id: true, email: true, name: true, timezone: true },
    });
    if (!user) return null;

    // Best-effort usage timestamp; never block the request on it.
    void db
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, record.id))
        .catch(() => {});

    return user;
};

/**
 * Accepts either a session JWT or an `X-API-Key`.
 *
 * JWTs are additionally checked against the user's `tokensValidFrom`, which
 * gives us real revocation: logging out everywhere bumps that timestamp and
 * every previously issued token stops working. Statelessness alone left tokens
 * valid for their full 7-day life after logout.
 */
export const authenticate = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const apiKey = req.headers['x-api-key'];
        if (typeof apiKey === 'string' && apiKey.length > 0) {
            const user = await authenticateApiKey(apiKey);
            if (!user) {
                res.status(401).json({ success: false, error: 'Invalid API key' });
                return;
            }
            req.user = user;
            req.authMethod = 'api_key';
            next();
            return;
        }

        const token = req.cookies?.token ?? extractBearer(req);
        if (!token) {
            res.status(401).json({ success: false, error: 'Authentication required' });
            return;
        }

        const claims = jwt.verify(token, env.JWT_SECRET) as JwtClaims;

        const user = await db.query.users.findFirst({
            where: eq(users.id, claims.sub),
            columns: {
                id: true,
                email: true,
                name: true,
                timezone: true,
                tokensValidFrom: true,
            },
        });

        if (!user) {
            res.status(401).json({ success: false, error: 'User no longer exists' });
            return;
        }

        if (claims.iat * 1000 < new Date(user.tokensValidFrom).getTime()) {
            res.status(401).json({ success: false, error: 'Session expired, please sign in again' });
            return;
        }

        req.user = {
            id: user.id,
            email: user.email,
            name: user.name,
            timezone: user.timezone,
        };
        req.authMethod = 'jwt';
        next();
    } catch (err) {
        if (err instanceof jwt.TokenExpiredError) {
            res.status(401).json({ success: false, error: 'Session expired' });
            return;
        }
        logger.debug({ err }, 'authentication failed');
        res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
};

/** Convenience accessor for handlers that run behind {@link authenticate}. */
export const requireUser = (req: Request): AuthUser => {
    if (!req.user) throw new Error('requireUser called on an unauthenticated request');
    return req.user;
};
