import type { Request, Response, NextFunction } from 'express';
import { and, eq, lt } from 'drizzle-orm';
import { db } from '../config/database.js';
import { idempotencyKeys } from '../db/schema.js';
import { hashRequest } from '../services/cryptoService.js';
import { log } from '../config/logger.js';
import { requireUser } from './auth.js';

const logger = log('idempotency');

/**
 * Makes retrying a mutating request safe.
 *
 * Without this, a double-clicked "Schedule" button or an axios retry created a
 * whole second campaign: every call inserted fresh rows with fresh uuids, so
 * the job-id dedup in the queue could never fire.
 *
 * Clients send `Idempotency-Key`. The first request executes and its response
 * is stored; replays return that stored response. Reusing a key with a
 * different body is rejected — that is a client bug, not a retry.
 */
export const idempotency = (endpoint: string) =>
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const key = req.headers['idempotency-key'];
        if (typeof key !== 'string' || key.length === 0) {
            next();
            return;
        }

        if (key.length > 255) {
            res.status(400).json({ success: false, error: 'Idempotency-Key is too long' });
            return;
        }

        const user = requireUser(req);
        const requestHash = hashRequest(req.body);

        const existing = await db.query.idempotencyKeys.findFirst({
            where: and(eq(idempotencyKeys.userId, user.id), eq(idempotencyKeys.key, key)),
        });

        if (existing) {
            if (existing.requestHash !== requestHash) {
                res.status(422).json({
                    success: false,
                    error: 'This Idempotency-Key was already used with a different request body',
                });
                return;
            }

            if (existing.responseBody) {
                logger.info({ key }, 'replaying stored response');
                res.status(existing.statusCode ?? 200)
                    .set('Idempotent-Replay', 'true')
                    .json(existing.responseBody);
                return;
            }

            // Reserved but not yet finished — the original request is still
            // running. Telling the client to retry is safer than racing it.
            res.status(409).json({
                success: false,
                error: 'A request with this Idempotency-Key is still in progress',
            });
            return;
        }

        // Reserve the key. The unique constraint makes this the arbiter if two
        // identical requests arrive simultaneously.
        try {
            await db.insert(idempotencyKeys).values({
                userId: user.id,
                key,
                endpoint,
                requestHash,
            });
        } catch {
            res.status(409).json({
                success: false,
                error: 'A request with this Idempotency-Key is already in progress',
            });
            return;
        }

        // Capture the response body so a later replay can return it verbatim.
        const originalJson = res.json.bind(res);
        res.json = ((body: Record<string, unknown>) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                void db
                    .update(idempotencyKeys)
                    .set({ responseBody: body, statusCode: res.statusCode })
                    .where(
                        and(eq(idempotencyKeys.userId, user.id), eq(idempotencyKeys.key, key))
                    )
                    .catch((err) => logger.warn({ err }, 'failed to persist response'));
            } else {
                // Failures should not be replayed — let the client retry properly.
                void db
                    .delete(idempotencyKeys)
                    .where(and(eq(idempotencyKeys.userId, user.id), eq(idempotencyKeys.key, key)))
                    .catch(() => {});
            }
            return originalJson(body);
        }) as Response['json'];

        next();
    };

/** Removes expired reservations. Called by the maintenance sweeper. */
export const purgeExpiredIdempotencyKeys = async (): Promise<number> => {
    const deleted = await db
        .delete(idempotencyKeys)
        .where(lt(idempotencyKeys.expiresAt, new Date()))
        .returning({ id: idempotencyKeys.id });
    return deleted.length;
};
