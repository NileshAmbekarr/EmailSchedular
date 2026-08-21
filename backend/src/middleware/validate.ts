import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { z, type ZodTypeAny } from 'zod';

/**
 * Boundary validation.
 *
 * Zod was already a dependency but only guarded environment variables — every
 * request body was checked by hand, and recipient addresses were accepted if
 * they merely contained an `@`. Invalid addresses reaching the provider are a
 * direct hit to sender reputation, so this is a deliverability control as much
 * as an input-safety one.
 */

type Source = 'body' | 'query' | 'params';

export const validate =
    (schemas: Partial<Record<Source, ZodTypeAny>>): RequestHandler =>
    (req: Request, res: Response, next: NextFunction) => {
        for (const source of ['body', 'query', 'params'] as const) {
            const schema = schemas[source];
            if (!schema) continue;

            const result = schema.safeParse(req[source]);
            if (!result.success) {
                res.status(400).json({
                    success: false,
                    error: 'Validation failed',
                    details: result.error.issues.map((issue) => ({
                        field: issue.path.join('.') || source,
                        message: issue.message,
                    })),
                });
                return;
            }

            // Query and params are getter-only on newer Express versions.
            if (source === 'body') {
                req.body = result.data;
            } else {
                Object.defineProperty(req, source, {
                    value: result.data,
                    writable: true,
                    configurable: true,
                });
            }
        }

        next();
    };

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

/**
 * Stricter than `z.string().email()` in the ways that matter for deliverability:
 * no consecutive dots, a real TLD, and a length within the RFC limit.
 */
export const emailSchema = z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(254)
    .email('Not a valid email address')
    .refine((value) => !value.includes('..'), 'Email address contains consecutive dots')
    .refine((value) => /\.[a-z]{2,}$/i.test(value.split('@')[1] ?? ''), 'Email domain is not valid');

export const uuidSchema = z.string().uuid('Must be a valid id');

export const idParamSchema = z.object({ id: uuidSchema });

export const paginationSchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    search: z.string().trim().max(200).optional(),
});

/**
 * Password policy. Length dominates composition rules for real-world strength,
 * so the floor is 10 characters with a light mixed-content requirement.
 */
export const passwordSchema = z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .max(200, 'Password is too long')
    .refine((v) => /[a-zA-Z]/.test(v), 'Password must contain a letter')
    .refine((v) => /[0-9]|[^a-zA-Z0-9]/.test(v), 'Password must contain a number or symbol');

export const timezoneSchema = z
    .string()
    .max(64)
    .refine((tz) => {
        try {
            new Intl.DateTimeFormat('en-US', { timeZone: tz });
            return true;
        } catch {
            return false;
        }
    }, 'Not a recognised IANA timezone');

/** ISO-8601 instant that is not in the past (allowing a minute of clock skew). */
export const futureDateSchema = z
    .string()
    .datetime({ offset: true })
    .refine(
        (value) => new Date(value).getTime() > Date.now() - 60_000,
        'Scheduled time must be in the future'
    );

export const recipientSchema = z.object({
    email: emailSchema,
    fields: z.record(z.string(), z.string().max(1000)).optional(),
});
