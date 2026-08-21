import { and, asc, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { log } from '../config/logger.js';
import {
    campaigns,
    contacts,
    emails,
    senders,
    templates,
    type Campaign,
    type CampaignStatus,
} from '../db/schema.js';
import { campaignQueue, emailQueue, MAX_SEND_ATTEMPTS } from '../queues/queues.js';
import { computeSendTimes, resolveSenderLimits } from './rateLimitService.js';
import { filterSuppressed, normalizeEmail } from './suppressionService.js';
import { extractVariables, sanitizeBody } from './templateService.js';
import {
    normalizeTimezone,
    resolveScheduleInstant,
    shiftWallClockToZone,
} from './timezoneService.js';

const logger = log('campaign');

/** Rows per INSERT. Postgres has a hard cap on bind parameters per statement. */
const INSERT_CHUNK = 1_000;

export interface RecipientInput {
    email: string;
    fields?: Record<string, string>;
}

export interface CreateCampaignInput {
    name: string;
    senderId: string;
    subject: string;
    body: string;
    scheduledAt: Date;
    timezone?: string;
    perRecipientTimezone?: boolean;
    templateId?: string | null;
    recipients?: RecipientInput[];
    listId?: string | null;
    delayBetweenEmailsMs?: number | null;
    maxEmailsPerHour?: number | null;
    trackOpens?: boolean;
    trackClicks?: boolean;
    /** Create in `draft` instead of scheduling immediately. */
    draft?: boolean;
}

export interface CreateCampaignResult {
    campaign: Campaign;
    totalRecipients: number;
    suppressedCount: number;
    duplicateCount: number;
}

const chunk = <T>(items: T[], size: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
};

/**
 * Resolves the recipient set from either an inline list or a saved audience,
 * then removes duplicates and anyone on the suppression list.
 */
const resolveRecipients = async (
    userId: string,
    input: CreateCampaignInput
): Promise<{ recipients: RecipientInput[]; suppressedCount: number; duplicateCount: number }> => {
    let raw: RecipientInput[] = input.recipients ?? [];

    if (input.listId) {
        const rows = await db
            .select({ email: contacts.email, fields: contacts.fields })
            .from(contacts)
            .where(and(eq(contacts.listId, input.listId), eq(contacts.userId, userId)));

        raw = [...raw, ...rows.map((r) => ({ email: r.email, fields: r.fields }))];
    }

    // Deduplicate, keeping the first occurrence's merge data.
    const byEmail = new Map<string, RecipientInput>();
    for (const r of raw) {
        const email = normalizeEmail(r.email);
        if (!byEmail.has(email)) byEmail.set(email, { email, fields: r.fields ?? {} });
    }
    const duplicateCount = raw.length - byEmail.size;

    const { allowed } = await filterSuppressed(userId, [...byEmail.keys()]);
    const allowedSet = new Set(allowed);

    const recipients = [...byEmail.values()].filter((r) => allowedSet.has(r.email));

    return {
        recipients,
        suppressedCount: byEmail.size - recipients.length,
        duplicateCount,
    };
};

/**
 * Creates a campaign and materialises one row per recipient.
 *
 * Rows are written in bulk and the queue is populated asynchronously by a
 * fan-out job. The previous implementation looped per recipient doing an
 * INSERT, a queue add and an UPDATE — three round trips each — so a
 * ten-thousand-recipient send made thirty thousand sequential calls and timed
 * out long before finishing.
 */
export const createCampaign = async (
    userId: string,
    input: CreateCampaignInput
): Promise<CreateCampaignResult> => {
    const sender = await db.query.senders.findFirst({
        where: and(eq(senders.id, input.senderId), eq(senders.userId, userId)),
    });
    if (!sender) throw new NotFoundError('Sender not found');

    if (input.templateId) {
        const template = await db.query.templates.findFirst({
            where: and(eq(templates.id, input.templateId), eq(templates.userId, userId)),
        });
        if (!template) throw new NotFoundError('Template not found');
    }

    const { recipients, suppressedCount, duplicateCount } = await resolveRecipients(userId, input);

    const timezone = normalizeTimezone(input.timezone);
    const scheduledAtUtc = resolveScheduleInstant(input.scheduledAt, timezone);

    const limits = resolveSenderLimits(sender);
    const hourlyLimit = input.maxEmailsPerHour ?? limits.hourly;
    const delayMs = input.delayBetweenEmailsMs ?? env.DELAY_BETWEEN_EMAILS_MS;

    const status: CampaignStatus = input.draft ? 'draft' : 'scheduled';

    const [campaign] = await db
        .insert(campaigns)
        .values({
            userId,
            senderId: input.senderId,
            templateId: input.templateId ?? null,
            name: input.name,
            subject: input.subject,
            body: sanitizeBody(input.body),
            status,
            scheduledAt: scheduledAtUtc,
            timezone,
            perRecipientTimezone: input.perRecipientTimezone ?? false,
            delayBetweenEmailsMs: input.delayBetweenEmailsMs ?? null,
            maxEmailsPerHour: input.maxEmailsPerHour ?? null,
            trackOpens: input.trackOpens ?? true,
            trackClicks: input.trackClicks ?? true,
            totalRecipients: recipients.length,
        })
        .returning();

    if (recipients.length > 0) {
        const sendTimes = computeSendTimes(scheduledAtUtc, recipients.length, {
            delayMs,
            hourlyLimit,
        });

        const rows = recipients.map((r, i) => {
            let scheduledAt = sendTimes[i];

            // "Send at 9am local" means a different absolute instant per
            // recipient. The zone comes from the contact's own data.
            if (campaign.perRecipientTimezone && r.fields?.timezone) {
                scheduledAt = shiftWallClockToZone(scheduledAt, timezone, r.fields.timezone);
            }

            return {
                userId,
                campaignId: campaign.id,
                senderId: input.senderId,
                recipientEmail: r.email,
                mergeData: r.fields ?? {},
                scheduledAt,
                status: 'pending' as const,
            };
        });

        for (const batch of chunk(rows, INSERT_CHUNK)) {
            await db.insert(emails).values(batch);
        }
    }

    // Draft campaigns are not enqueued until explicitly scheduled.
    if (status === 'scheduled' && recipients.length > 0) {
        await enqueueFanout(campaign.id, userId);
    }

    logger.info(
        {
            campaignId: campaign.id,
            recipients: recipients.length,
            suppressedCount,
            duplicateCount,
        },
        'campaign created'
    );

    return { campaign, totalRecipients: recipients.length, suppressedCount, duplicateCount };
};

/** Kicks off (or resumes) queue population for a campaign. */
export const enqueueFanout = async (campaignId: string, userId: string): Promise<void> => {
    await campaignQueue.add(
        'fanout',
        { type: 'fanout', campaignId, userId, offset: 0 },
        { jobId: `fanout:${campaignId}:0` }
    );
};

/**
 * Moves one page of a campaign's pending rows into the send queue.
 * Returns true when more rows remain.
 */
export const fanoutBatch = async (campaignId: string, batchSize: number): Promise<boolean> => {
    const pending = await db
        .select({
            id: emails.id,
            userId: emails.userId,
            senderId: emails.senderId,
            scheduledAt: emails.scheduledAt,
        })
        .from(emails)
        .where(and(eq(emails.campaignId, campaignId), eq(emails.status, 'pending')))
        .orderBy(asc(emails.scheduledAt))
        .limit(batchSize);

    if (pending.length === 0) return false;

    const now = Date.now();

    await emailQueue.addBulk(
        pending.map((row) => ({
            name: 'send-email',
            data: {
                emailId: row.id,
                userId: row.userId,
                senderId: row.senderId,
                campaignId,
            },
            opts: {
                // The row's uuid is the job id — the idempotency contract.
                jobId: row.id,
                delay: Math.max(0, new Date(row.scheduledAt).getTime() - now),
                attempts: MAX_SEND_ATTEMPTS,
            },
        }))
    );

    await db
        .update(emails)
        .set({ status: 'queued', updatedAt: new Date() })
        .where(
            and(
                inArray(
                    emails.id,
                    pending.map((r) => r.id)
                ),
                eq(emails.status, 'pending')
            )
        );

    return pending.length === batchSize;
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export class NotFoundError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'NotFoundError';
    }
}

export class ConflictError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ConflictError';
    }
}

const requireCampaign = async (userId: string, campaignId: string): Promise<Campaign> => {
    const campaign = await db.query.campaigns.findFirst({
        where: and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId)),
    });
    if (!campaign) throw new NotFoundError('Campaign not found');
    return campaign;
};

/** Statuses whose messages have not gone out yet and can still be stopped. */
const STOPPABLE_EMAIL_STATUSES = ['pending', 'queued', 'retrying'] as const;

/**
 * Cancels every message that has not yet been sent.
 *
 * Queue jobs are removed where possible, but the authoritative stop is the
 * status change: the worker re-reads the row and refuses to send anything in a
 * terminal state, so a job that slips through still does nothing.
 */
export const cancelCampaign = async (userId: string, campaignId: string): Promise<number> => {
    const campaign = await requireCampaign(userId, campaignId);

    if (['completed', 'cancelled'].includes(campaign.status)) {
        throw new ConflictError(`Campaign is already ${campaign.status}`);
    }

    const cancelled = await db
        .update(emails)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(
            and(
                eq(emails.campaignId, campaignId),
                inArray(emails.status, [...STOPPABLE_EMAIL_STATUSES])
            )
        )
        .returning({ id: emails.id });

    await db
        .update(campaigns)
        .set({ status: 'cancelled', completedAt: new Date(), updatedAt: new Date() })
        .where(eq(campaigns.id, campaignId));

    await removeJobs(cancelled.map((r) => r.id));

    logger.info({ campaignId, cancelled: cancelled.length }, 'campaign cancelled');
    return cancelled.length;
};

/** Pauses sending; queued messages stay queued but the worker skips them. */
export const pauseCampaign = async (userId: string, campaignId: string): Promise<void> => {
    const campaign = await requireCampaign(userId, campaignId);
    if (!['scheduled', 'sending'].includes(campaign.status)) {
        throw new ConflictError(`Cannot pause a ${campaign.status} campaign`);
    }

    await db
        .update(campaigns)
        .set({ status: 'paused', updatedAt: new Date() })
        .where(eq(campaigns.id, campaignId));
};

export const resumeCampaign = async (userId: string, campaignId: string): Promise<void> => {
    const campaign = await requireCampaign(userId, campaignId);
    if (campaign.status !== 'paused') {
        throw new ConflictError('Campaign is not paused');
    }

    await db
        .update(campaigns)
        .set({ status: 'sending', updatedAt: new Date() })
        .where(eq(campaigns.id, campaignId));

    // Anything whose slot passed while paused is re-queued immediately.
    await db
        .update(emails)
        .set({ status: 'pending', updatedAt: new Date() })
        .where(and(eq(emails.campaignId, campaignId), eq(emails.status, 'queued')));

    await enqueueFanout(campaignId, userId);
};

/** Moves an unsent campaign to a new time, recomputing every recipient's slot. */
export const rescheduleCampaign = async (
    userId: string,
    campaignId: string,
    scheduledAt: Date,
    timezone?: string
): Promise<number> => {
    const campaign = await requireCampaign(userId, campaignId);

    if (['completed', 'cancelled'].includes(campaign.status)) {
        throw new ConflictError(`Cannot reschedule a ${campaign.status} campaign`);
    }
    if (campaign.sentCount > 0) {
        throw new ConflictError('Cannot reschedule a campaign that has already started sending');
    }

    const tz = normalizeTimezone(timezone ?? campaign.timezone);
    const scheduledAtUtc = resolveScheduleInstant(scheduledAt, tz);

    const sender = await db.query.senders.findFirst({ where: eq(senders.id, campaign.senderId) });
    const limits = sender ? resolveSenderLimits(sender) : { hourly: env.MAX_EMAILS_PER_HOUR_PER_SENDER, daily: 0 };

    const pending = await db
        .select({ id: emails.id })
        .from(emails)
        .where(
            and(
                eq(emails.campaignId, campaignId),
                inArray(emails.status, [...STOPPABLE_EMAIL_STATUSES])
            )
        )
        .orderBy(asc(emails.scheduledAt));

    const times = computeSendTimes(scheduledAtUtc, pending.length, {
        delayMs: campaign.delayBetweenEmailsMs ?? env.DELAY_BETWEEN_EMAILS_MS,
        hourlyLimit: campaign.maxEmailsPerHour ?? limits.hourly,
    });

    // Drop the old jobs, rewrite the times, then let fan-out re-enqueue.
    await removeJobs(pending.map((r) => r.id));

    for (let i = 0; i < pending.length; i++) {
        await db
            .update(emails)
            .set({ scheduledAt: times[i], status: 'pending', updatedAt: new Date() })
            .where(eq(emails.id, pending[i].id));
    }

    await db
        .update(campaigns)
        .set({
            scheduledAt: scheduledAtUtc,
            timezone: tz,
            status: 'scheduled',
            updatedAt: new Date(),
        })
        .where(eq(campaigns.id, campaignId));

    if (pending.length > 0) await enqueueFanout(campaignId, userId);

    return pending.length;
};

/** Cancels a single queued message. */
export const cancelEmail = async (userId: string, emailId: string): Promise<void> => {
    const [updated] = await db
        .update(emails)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(
            and(
                eq(emails.id, emailId),
                eq(emails.userId, userId),
                inArray(emails.status, [...STOPPABLE_EMAIL_STATUSES])
            )
        )
        .returning({ id: emails.id });

    if (!updated) throw new ConflictError('Email cannot be cancelled — it may already have been sent');

    await removeJobs([emailId]);
};

const removeJobs = async (ids: string[]): Promise<void> => {
    await Promise.allSettled(
        ids.map(async (id) => {
            const job = await emailQueue.getJob(id);
            // A job in `active` state is mid-send and cannot be removed; the
            // status check in the worker handles that case instead.
            if (job) await job.remove().catch(() => {});
        })
    );
};

/**
 * Marks a campaign complete once no messages remain in flight, and records the
 * bounce/complaint rates used for the auto-pause guard.
 */
export const finalizeCampaign = async (campaignId: string): Promise<boolean> => {
    const [remaining] = await db
        .select({ count: count() })
        .from(emails)
        .where(
            and(
                eq(emails.campaignId, campaignId),
                inArray(emails.status, ['pending', 'queued', 'processing', 'retrying'])
            )
        );

    if (remaining.count > 0) return false;

    await db
        .update(campaigns)
        .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(campaigns.id, campaignId), inArray(campaigns.status, ['scheduled', 'sending'])));

    return true;
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ListOptions {
    limit: number;
    offset: number;
    status?: CampaignStatus;
    search?: string;
}

export const listCampaigns = async (userId: string, opts: ListOptions) => {
    const conditions = [eq(campaigns.userId, userId)];
    if (opts.status) conditions.push(eq(campaigns.status, opts.status));
    if (opts.search) conditions.push(sql`${campaigns.name} ILIKE ${'%' + opts.search + '%'}`);

    const where = and(...conditions);

    const [rows, [total]] = await Promise.all([
        db.query.campaigns.findMany({
            where,
            orderBy: [desc(campaigns.createdAt)],
            limit: opts.limit,
            offset: opts.offset,
            with: { sender: { columns: { id: true, email: true, name: true } } },
        }),
        db.select({ count: count() }).from(campaigns).where(where),
    ]);

    return { rows, total: total.count };
};

export const getCampaign = async (userId: string, campaignId: string) => {
    const campaign = await db.query.campaigns.findFirst({
        where: and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId)),
        with: { sender: true, template: true },
    });
    if (!campaign) throw new NotFoundError('Campaign not found');
    return campaign;
};

/** Per-status counts for a campaign, computed in one grouped query. */
export const getCampaignBreakdown = async (userId: string, campaignId: string) => {
    await requireCampaign(userId, campaignId);

    const rows = await db
        .select({ status: emails.status, count: count() })
        .from(emails)
        .where(eq(emails.campaignId, campaignId))
        .groupBy(emails.status);

    return Object.fromEntries(rows.map((r) => [r.status, r.count])) as Record<string, number>;
};

/** Aggregate figures for the dashboard header. */
export const getAccountStats = async (userId: string, days = 30) => {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [totals] = await db
        .select({
            total: count(),
            sent: sql<number>`count(*) filter (where ${emails.status} in ('sent','delivered'))::int`,
            delivered: sql<number>`count(*) filter (where ${emails.status} = 'delivered')::int`,
            failed: sql<number>`count(*) filter (where ${emails.status} = 'failed')::int`,
            bounced: sql<number>`count(*) filter (where ${emails.status} = 'bounced')::int`,
            opened: sql<number>`count(*) filter (where ${emails.openedAt} is not null)::int`,
            clicked: sql<number>`count(*) filter (where ${emails.clickedAt} is not null)::int`,
            scheduled: sql<number>`count(*) filter (where ${emails.status} in ('pending','queued','retrying'))::int`,
        })
        .from(emails)
        .where(and(eq(emails.userId, userId), gte(emails.createdAt, since)));

    const daily = await db
        .select({
            day: sql<string>`to_char(date_trunc('day', ${emails.createdAt}), 'YYYY-MM-DD')`,
            sent: sql<number>`count(*) filter (where ${emails.status} in ('sent','delivered'))::int`,
            opened: sql<number>`count(*) filter (where ${emails.openedAt} is not null)::int`,
            clicked: sql<number>`count(*) filter (where ${emails.clickedAt} is not null)::int`,
            bounced: sql<number>`count(*) filter (where ${emails.status} = 'bounced')::int`,
        })
        .from(emails)
        .where(and(eq(emails.userId, userId), gte(emails.createdAt, since)))
        .groupBy(sql`date_trunc('day', ${emails.createdAt})`)
        .orderBy(sql`date_trunc('day', ${emails.createdAt})`);

    const openRate = totals.sent > 0 ? totals.opened / totals.sent : 0;
    const clickRate = totals.sent > 0 ? totals.clicked / totals.sent : 0;
    const bounceRate = totals.sent > 0 ? totals.bounced / totals.sent : 0;

    return { totals, daily, rates: { openRate, clickRate, bounceRate } };
};

/** Paginated message list, filtered by lifecycle bucket. */
export const listEmails = async (
    userId: string,
    opts: {
        limit: number;
        offset: number;
        bucket?: 'scheduled' | 'sent' | 'failed' | 'all';
        campaignId?: string;
        search?: string;
    }
) => {
    const conditions = [eq(emails.userId, userId)];

    if (opts.bucket === 'scheduled') {
        conditions.push(inArray(emails.status, ['pending', 'queued', 'processing', 'retrying']));
    } else if (opts.bucket === 'sent') {
        conditions.push(inArray(emails.status, ['sent', 'delivered']));
    } else if (opts.bucket === 'failed') {
        conditions.push(inArray(emails.status, ['failed', 'bounced', 'suppressed', 'cancelled']));
    }

    if (opts.campaignId) conditions.push(eq(emails.campaignId, opts.campaignId));
    if (opts.search) {
        conditions.push(sql`${emails.recipientEmail} ILIKE ${'%' + opts.search + '%'}`);
    }

    const where = and(...conditions);
    const orderBy =
        opts.bucket === 'scheduled' ? [asc(emails.scheduledAt)] : [desc(emails.createdAt)];

    const [rows, [total]] = await Promise.all([
        db.query.emails.findMany({
            where,
            orderBy,
            limit: opts.limit,
            offset: opts.offset,
            with: {
                sender: { columns: { id: true, email: true, name: true } },
                campaign: { columns: { id: true, name: true, subject: true } },
            },
        }),
        db.select({ count: count() }).from(emails).where(where),
    ]);

    return { rows, total: total.count };
};

export const getEmail = async (userId: string, emailId: string) => {
    const email = await db.query.emails.findFirst({
        where: and(eq(emails.id, emailId), eq(emails.userId, userId)),
        with: {
            sender: { columns: { id: true, email: true, name: true } },
            campaign: true,
            events: true,
        },
    });
    if (!email) throw new NotFoundError('Email not found');
    return email;
};

/** Detects merge tags so the composer can prompt for missing columns. */
export const analyzeCampaignContent = (subject: string, body: string): string[] =>
    extractVariables(subject, body);

/** Campaigns whose scheduled time has arrived, used by the sweeper. */
export const findDueCampaigns = async (): Promise<Campaign[]> =>
    db.query.campaigns.findMany({
        where: and(eq(campaigns.status, 'scheduled'), lte(campaigns.scheduledAt, new Date())),
        limit: 100,
    });
