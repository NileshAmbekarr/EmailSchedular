import type { Request, Response } from 'express';
import { z } from 'zod';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../config/database.js';
import {
    apiKeys,
    contactLists,
    contacts,
    domains,
    senders,
    templates,
} from '../db/schema.js';
import { requireUser } from '../middleware/auth.js';
import { HttpError } from '../middleware/errorHandler.js';
import {
    emailSchema,
    paginationSchema,
    timezoneSchema,
    uuidSchema,
} from '../middleware/validate.js';
import { encrypt, generateApiKey } from '../services/cryptoService.js';
import { createEtherealAccount, invalidateProvider, getProviderForSender } from '../providers/index.js';
import {
    getRateLimitStatus,
    resolveSenderLimits,
} from '../services/rateLimitService.js';
import * as domainService from '../services/domainService.js';
import * as suppressionService from '../services/suppressionService.js';
import { extractVariables, sanitizeBody } from '../services/templateService.js';
import { COMMON_TIMEZONES } from '../services/timezoneService.js';

// ===========================================================================
// SENDERS
// ===========================================================================

const senderFields = z.object({
    name: z.string().trim().min(1).max(255),
    email: emailSchema.optional(),
    replyTo: emailSchema.optional(),
    provider: z.enum(['ethereal', 'smtp', 'resend', 'ses']).default('ethereal'),
    domainId: uuidSchema.nullish(),
    smtpHost: z.string().trim().max(255).optional(),
    smtpPort: z.number().int().min(1).max(65535).optional(),
    smtpUser: z.string().trim().max(255).optional(),
    smtpPass: z.string().max(500).optional(),
    hourlyLimit: z.number().int().min(1).max(1_000_000).nullish(),
    dailyLimit: z.number().int().min(1).max(10_000_000).nullish(),
    warmupEnabled: z.boolean().optional(),
});

export const createSenderSchema = senderFields
    .refine((s) => s.provider === 'ethereal' || !!s.email, {
        message: 'An email address is required for this provider',
        path: ['email'],
    })
    .refine((s) => s.provider !== 'smtp' || (!!s.smtpHost && !!s.smtpUser && !!s.smtpPass), {
        message: 'Custom SMTP requires host, user and password',
        path: ['smtpHost'],
    });

export const updateSenderSchema = senderFields.partial();

/** Never return credentials, even encrypted. */
const publicSender = (sender: typeof senders.$inferSelect) => ({
    id: sender.id,
    email: sender.email,
    name: sender.name,
    replyTo: sender.replyTo,
    provider: sender.provider,
    domainId: sender.domainId,
    hourlyLimit: sender.hourlyLimit,
    dailyLimit: sender.dailyLimit,
    warmupEnabled: sender.warmupEnabled,
    warmupStartedAt: sender.warmupStartedAt,
    isDefault: sender.isDefault,
    hasSmtpCredentials: Boolean(sender.smtpPassEncrypted),
    createdAt: sender.createdAt,
});

export const listSenders = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const rows = await db.query.senders.findMany({
        where: eq(senders.userId, user.id),
        orderBy: [desc(senders.isDefault), desc(senders.createdAt)],
    });

    res.json({ success: true, data: rows.map(publicSender) });
};

export const createSender = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const input = req.body as z.infer<typeof createSenderSchema>;

    // A sender may only use a domain the account has proven it controls.
    if (input.domainId) {
        const domain = await db.query.domains.findFirst({
            where: and(eq(domains.id, input.domainId), eq(domains.userId, user.id)),
        });
        if (!domain) throw new HttpError(404, 'Domain not found');
        if (domain.status !== 'verified') {
            throw new HttpError(400, 'Verify this domain before sending from it');
        }
        if (input.email && !input.email.endsWith(`@${domain.domain}`)) {
            throw new HttpError(400, `Address must belong to ${domain.domain}`);
        }
    }

    let values: typeof senders.$inferInsert;

    if (input.provider === 'ethereal') {
        const account = await createEtherealAccount();
        values = {
            userId: user.id,
            name: input.name,
            email: account.user,
            provider: 'ethereal',
            smtpHost: account.host,
            smtpPort: account.port,
            smtpUser: account.user,
            smtpPassEncrypted: encrypt(account.pass),
        };
    } else {
        values = {
            userId: user.id,
            name: input.name,
            email: input.email!,
            replyTo: input.replyTo,
            provider: input.provider,
            domainId: input.domainId ?? null,
            smtpHost: input.smtpHost,
            smtpPort: input.smtpPort,
            smtpUser: input.smtpUser,
            smtpPassEncrypted: input.smtpPass ? encrypt(input.smtpPass) : null,
            hourlyLimit: input.hourlyLimit ?? null,
            dailyLimit: input.dailyLimit ?? null,
            warmupEnabled: input.warmupEnabled ?? false,
            warmupStartedAt: input.warmupEnabled ? new Date() : null,
        };
    }

    const [sender] = await db.insert(senders).values(values).returning();
    res.status(201).json({ success: true, data: publicSender(sender) });
};

export const updateSender = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const input = req.body as z.infer<typeof updateSenderSchema>;

    const existing = await db.query.senders.findFirst({
        where: and(eq(senders.id, req.params.id), eq(senders.userId, user.id)),
    });
    if (!existing) throw new HttpError(404, 'Sender not found');

    const { smtpPass, ...rest } = input;

    const [sender] = await db
        .update(senders)
        .set({
            ...rest,
            ...(smtpPass ? { smtpPassEncrypted: encrypt(smtpPass) } : {}),
            ...(input.warmupEnabled && !existing.warmupStartedAt
                ? { warmupStartedAt: new Date() }
                : {}),
            updatedAt: new Date(),
        })
        .where(eq(senders.id, req.params.id))
        .returning();

    // Cached transports hold the old credentials.
    await invalidateProvider(existing);

    res.json({ success: true, data: publicSender(sender) });
};

export const deleteSender = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);

    const deleted = await db
        .delete(senders)
        .where(and(eq(senders.id, req.params.id), eq(senders.userId, user.id)))
        .returning({ id: senders.id });

    if (deleted.length === 0) throw new HttpError(404, 'Sender not found');
    res.json({ success: true, message: 'Sender deleted' });
};

export const verifySender = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const sender = await db.query.senders.findFirst({
        where: and(eq(senders.id, req.params.id), eq(senders.userId, user.id)),
    });
    if (!sender) throw new HttpError(404, 'Sender not found');

    const ok = await getProviderForSender(sender).verify();
    res.json({ success: true, data: { verified: ok } });
};

/**
 * Current quota consumption. Ownership is checked here — the original endpoint
 * read `:senderId` straight from the URL and returned any account's counters.
 */
export const getSenderRateLimit = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);

    const sender = await db.query.senders.findFirst({
        where: and(eq(senders.id, req.params.id), eq(senders.userId, user.id)),
    });
    if (!sender) throw new HttpError(404, 'Sender not found');

    const status = await getRateLimitStatus(sender.id, resolveSenderLimits(sender));
    res.json({ success: true, data: status });
};

// ===========================================================================
// TEMPLATES
// ===========================================================================

export const templateSchema = z.object({
    name: z.string().trim().min(1).max(255),
    subject: z.string().trim().min(1).max(500),
    body: z.string().min(1).max(500_000),
});

export const listTemplates = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const rows = await db.query.templates.findMany({
        where: eq(templates.userId, user.id),
        orderBy: [desc(templates.updatedAt)],
    });
    res.json({ success: true, data: rows });
};

export const createTemplate = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const input = req.body as z.infer<typeof templateSchema>;

    const [template] = await db
        .insert(templates)
        .values({
            userId: user.id,
            name: input.name,
            subject: input.subject,
            body: sanitizeBody(input.body),
            variables: extractVariables(input.subject, input.body),
        })
        .returning();

    res.status(201).json({ success: true, data: template });
};

export const updateTemplate = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const input = req.body as z.infer<typeof templateSchema>;

    const [template] = await db
        .update(templates)
        .set({
            name: input.name,
            subject: input.subject,
            body: sanitizeBody(input.body),
            variables: extractVariables(input.subject, input.body),
            updatedAt: new Date(),
        })
        .where(and(eq(templates.id, req.params.id), eq(templates.userId, user.id)))
        .returning();

    if (!template) throw new HttpError(404, 'Template not found');
    res.json({ success: true, data: template });
};

export const deleteTemplate = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const deleted = await db
        .delete(templates)
        .where(and(eq(templates.id, req.params.id), eq(templates.userId, user.id)))
        .returning({ id: templates.id });

    if (deleted.length === 0) throw new HttpError(404, 'Template not found');
    res.json({ success: true, message: 'Template deleted' });
};

// ===========================================================================
// CONTACT LISTS
// ===========================================================================

export const createListSchema = z.object({
    name: z.string().trim().min(1).max(255),
    description: z.string().trim().max(1000).optional(),
});

export const addContactsSchema = z.object({
    contacts: z
        .array(
            z.object({
                email: emailSchema,
                fields: z.record(z.string(), z.string().max(1000)).optional(),
            })
        )
        .min(1)
        .max(50_000),
    source: z.string().trim().max(128).optional(),
});

export const listContactLists = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const rows = await db.query.contactLists.findMany({
        where: eq(contactLists.userId, user.id),
        orderBy: [desc(contactLists.updatedAt)],
    });
    res.json({ success: true, data: rows });
};

export const createContactList = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const input = req.body as z.infer<typeof createListSchema>;

    const [list] = await db
        .insert(contactLists)
        .values({ userId: user.id, name: input.name, description: input.description })
        .returning();

    res.status(201).json({ success: true, data: list });
};

export const addContacts = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const input = req.body as z.infer<typeof addContactsSchema>;

    const list = await db.query.contactLists.findFirst({
        where: and(eq(contactLists.id, req.params.id), eq(contactLists.userId, user.id)),
    });
    if (!list) throw new HttpError(404, 'List not found');

    // Re-uploading the same CSV is a normal thing to do; conflicts on
    // (list, email) are ignored rather than treated as an error.
    const rows = input.contacts.map((c) => ({
        listId: list.id,
        userId: user.id,
        email: c.email,
        fields: c.fields ?? {},
        source: input.source,
    }));

    let inserted = 0;
    for (let i = 0; i < rows.length; i += 1000) {
        const result = await db
            .insert(contacts)
            .values(rows.slice(i, i + 1000))
            .onConflictDoNothing({ target: [contacts.listId, contacts.email] })
            .returning({ id: contacts.id });
        inserted += result.length;
    }

    const [{ total }] = await db
        .select({ total: count() })
        .from(contacts)
        .where(eq(contacts.listId, list.id));

    await db
        .update(contactLists)
        .set({ contactCount: total, updatedAt: new Date() })
        .where(eq(contactLists.id, list.id));

    res.json({
        success: true,
        data: { added: inserted, duplicates: rows.length - inserted, total },
    });
};

export const listContacts = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const query = req.query as unknown as z.infer<typeof paginationSchema>;

    const conditions = [eq(contacts.listId, req.params.id), eq(contacts.userId, user.id)];
    if (query.search) {
        conditions.push(sql`${contacts.email} ILIKE ${'%' + query.search + '%'}`);
    }
    const where = and(...conditions);

    const [rows, [total]] = await Promise.all([
        db.select().from(contacts).where(where).limit(query.limit).offset(query.offset),
        db.select({ count: count() }).from(contacts).where(where),
    ]);

    res.json({
        success: true,
        data: rows,
        pagination: { total: total.count, limit: query.limit, offset: query.offset },
    });
};

export const deleteContactList = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const deleted = await db
        .delete(contactLists)
        .where(and(eq(contactLists.id, req.params.id), eq(contactLists.userId, user.id)))
        .returning({ id: contactLists.id });

    if (deleted.length === 0) throw new HttpError(404, 'List not found');
    res.json({ success: true, message: 'List deleted' });
};

// ===========================================================================
// SUPPRESSIONS
// ===========================================================================

export const addSuppressionSchema = z.object({
    email: emailSchema,
    reason: z.enum(['unsubscribed', 'hard_bounce', 'complaint', 'manual', 'invalid']).default('manual'),
    detail: z.string().max(1000).optional(),
});

export const listSuppressionsQuery = paginationSchema.extend({
    reason: z
        .enum(['unsubscribed', 'hard_bounce', 'soft_bounce_threshold', 'complaint', 'manual', 'invalid'])
        .optional(),
});

export const listSuppressions = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const query = req.query as unknown as z.infer<typeof listSuppressionsQuery>;

    const { rows, total } = await suppressionService.listSuppressions(user.id, query);

    res.json({
        success: true,
        data: rows,
        pagination: { total, limit: query.limit, offset: query.offset },
    });
};

export const addSuppression = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const input = req.body as z.infer<typeof addSuppressionSchema>;

    await suppressionService.suppress(user.id, input.email, input.reason, input.detail);
    res.status(201).json({ success: true, message: 'Address suppressed' });
};

export const removeSuppression = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const removed = await suppressionService.unsuppress(user.id, req.params.email);

    if (!removed) throw new HttpError(404, 'Address is not suppressed');
    res.json({ success: true, message: 'Address removed from the suppression list' });
};

// ===========================================================================
// DOMAINS
// ===========================================================================

export const createDomainSchema = z.object({
    domain: z.string().trim().toLowerCase().min(3).max(253),
});

export const listDomains = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const rows = await domainService.listDomains(user.id);

    res.json({
        success: true,
        data: rows.map((d) => ({
            id: d.id,
            domain: d.domain,
            status: d.status,
            spfVerified: d.spfVerified,
            dkimVerified: d.dkimVerified,
            dmarcVerified: d.dmarcVerified,
            lastCheckedAt: d.lastCheckedAt,
            verifiedAt: d.verifiedAt,
            createdAt: d.createdAt,
            dnsRecords: domainService.buildDnsRecords(d),
        })),
    });
};

export const createDomain = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const { domain } = req.body as z.infer<typeof createDomainSchema>;

    if (!domainService.isValidDomain(domain)) {
        throw new HttpError(400, 'Not a valid domain name');
    }

    const created = await domainService.createDomain(user.id, domain);
    res.status(201).json({
        success: true,
        data: { ...created, dkimPrivateKey: undefined, dnsRecords: domainService.buildDnsRecords(created) },
    });
};

export const verifyDomain = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const result = await domainService.verifyDomain(user.id, req.params.id);
    res.json({ success: true, data: result });
};

export const deleteDomain = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    await domainService.deleteDomain(user.id, req.params.id);
    res.json({ success: true, message: 'Domain removed' });
};

// ===========================================================================
// API KEYS
// ===========================================================================

export const createApiKeySchema = z.object({
    name: z.string().trim().min(1).max(255),
});

export const listApiKeys = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const rows = await db
        .select({
            id: apiKeys.id,
            name: apiKeys.name,
            keyPrefix: apiKeys.keyPrefix,
            lastUsedAt: apiKeys.lastUsedAt,
            createdAt: apiKeys.createdAt,
        })
        .from(apiKeys)
        .where(and(eq(apiKeys.userId, user.id), isNull(apiKeys.revokedAt)))
        .orderBy(desc(apiKeys.createdAt));

    res.json({ success: true, data: rows });
};

export const createApiKey = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const { name } = req.body as z.infer<typeof createApiKeySchema>;

    const { key, hash, prefix } = generateApiKey();

    const [record] = await db
        .insert(apiKeys)
        .values({ userId: user.id, name, keyHash: hash, keyPrefix: prefix })
        .returning({ id: apiKeys.id, name: apiKeys.name, createdAt: apiKeys.createdAt });

    // The only time the plaintext is ever available.
    res.status(201).json({
        success: true,
        data: { ...record, key },
        message: 'Copy this key now — it cannot be shown again',
    });
};

export const revokeApiKey = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);

    const [revoked] = await db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, req.params.id), eq(apiKeys.userId, user.id), isNull(apiKeys.revokedAt)))
        .returning({ id: apiKeys.id });

    if (!revoked) throw new HttpError(404, 'API key not found');
    res.json({ success: true, message: 'API key revoked' });
};

// ===========================================================================
// MISC
// ===========================================================================

export const listTimezones = async (_req: Request, res: Response): Promise<void> => {
    res.json({ success: true, data: COMMON_TIMEZONES });
};
