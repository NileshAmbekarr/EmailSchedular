import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { ConflictError, NotFoundError } from '../services/campaignService.js';

/** Thrown by handlers that want to control the status code directly. */
export class HttpError extends Error {
    constructor(
        readonly status: number,
        message: string,
        readonly details?: unknown
    ) {
        super(message);
        this.name = 'HttpError';
    }
}

export const notFoundHandler = (req: Request, res: Response): void => {
    res.status(404).json({
        success: false,
        error: `No route for ${req.method} ${req.path}`,
    });
};

/**
 * Single place where an exception becomes an HTTP response.
 *
 * Internal error text is never echoed to the client in production — messages
 * from a database driver routinely contain schema details and occasionally
 * fragments of the query's parameters.
 */
export const errorHandler = (
    err: unknown,
    req: Request,
    res: Response,
    _next: NextFunction
): void => {
    if (res.headersSent) return;

    if (err instanceof HttpError) {
        res.status(err.status).json({ success: false, error: err.message, details: err.details });
        return;
    }

    if (err instanceof NotFoundError) {
        res.status(404).json({ success: false, error: err.message });
        return;
    }

    if (err instanceof ConflictError) {
        res.status(409).json({ success: false, error: err.message });
        return;
    }

    if (err instanceof ZodError) {
        res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        });
        return;
    }

    // Postgres unique violation.
    if ((err as { code?: string }).code === '23505') {
        res.status(409).json({ success: false, error: 'That record already exists' });
        return;
    }

    logger.error(
        { err, method: req.method, path: req.path, requestId: req.id },
        'unhandled error'
    );

    res.status(500).json({
        success: false,
        error: env.IS_PROD
            ? 'Internal server error'
            : err instanceof Error
              ? err.message
              : 'Internal server error',
        requestId: req.id,
    });
};

/** Wraps an async handler so rejections reach {@link errorHandler}. */
export const asyncHandler =
    <T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(fn: T) =>
    (req: Request, res: Response, next: NextFunction): void => {
        void fn(req, res, next).catch(next);
    };
