/**
 * Shared HTTP types. Domain types are inferred from the Drizzle schema in
 * `db/schema.ts` rather than restated here — a hand-maintained parallel copy
 * only drifts.
 */

export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
    details?: unknown;
    pagination?: PaginationMeta;
}

export interface PaginationMeta {
    total: number;
    limit: number;
    offset: number;
}

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            /** Correlation id attached by pino-http; echoed as `x-request-id`. */
            id?: string;
        }
    }
}

export {};
