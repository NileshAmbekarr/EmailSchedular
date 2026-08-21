import type { Request, Response } from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../config/database.js';
import { senders, users } from '../db/schema.js';
import { requireUser } from '../middleware/auth.js';
import { HttpError } from '../middleware/errorHandler.js';
import {
    emailSchema,
    futureDateSchema,
    paginationSchema,
    recipientSchema,
    timezoneSchema,
    uuidSchema,
} from '../middleware/validate.js';
import * as campaignService from '../services/campaignService.js';
import { getProviderForSender } from '../providers/index.js';
import {
    htmlToText,
    lintContent,
    render,
    sanitizeBody,
    extractVariables,
} from '../services/templateService.js';
import { buildComplianceHeaders, buildUnsubscribeUrl, buildFooter } from '../services/complianceService.js';
import { getQueueStats } from '../queues/queues.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const createCampaignSchema = z
    .object({
        name: z.string().trim().min(1).max(255),
        senderId: uuidSchema,
        subject: z.string().trim().min(1, 'Subject is required').max(500),
        body: z.string().min(1, 'Body is required').max(500_000),
        scheduledAt: futureDateSchema,
        timezone: timezoneSchema.optional(),
        perRecipientTimezone: z.boolean().optional(),
        templateId: uuidSchema.nullish(),
        recipients: z.array(recipientSchema).max(100_000).optional(),
        listId: uuidSchema.nullish(),
        delayBetweenEmailsMs: z.number().int().min(0).max(3_600_000).nullish(),
        maxEmailsPerHour: z.number().int().min(1).max(1_000_000).nullish(),
        trackOpens: z.boolean().optional(),
        trackClicks: z.boolean().optional(),
        draft: z.boolean().optional(),
    })
    .refine(
        (input) => (input.recipients?.length ?? 0) > 0 || !!input.listId,
        { message: 'Provide either recipients or a listId', path: ['recipients'] }
    );

export const rescheduleSchema = z.object({
    scheduledAt: futureDateSchema,
    timezone: timezoneSchema.optional(),
});

export const testSendSchema = z.object({
    senderId: uuidSchema,
    to: emailSchema,
    subject: z.string().trim().min(1).max(500),
    body: z.string().min(1).max(500_000),
    mergeData: z.record(z.string(), z.string()).optional(),
});

export const previewSchema = z.object({
    subject: z.string().max(500),
    body: z.string().max(500_000),
    mergeData: z.record(z.string(), z.string()).optional(),
});

export const listCampaignsQuery = paginationSchema.extend({
    status: z
        .enum(['draft', 'scheduled', 'sending', 'paused', 'completed', 'cancelled'])
        .optional(),
});

export const listEmailsQuery = paginationSchema.extend({
    bucket: z.enum(['scheduled', 'sent', 'failed', 'all']).default('all'),
    campaignId: uuidSchema.optional(),
});

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export const createCampaign = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const input = req.body as z.infer<typeof createCampaignSchema>;

    const result = await campaignService.createCampaign(user.id, {
        ...input,
        scheduledAt: new Date(input.scheduledAt),
        timezone: input.timezone ?? user.timezone,
    });

    if (result.totalRecipients === 0) {
        throw new HttpError(
            400,
            'No sendable recipients remain — every address was a duplicate or is on your suppression list',
            { suppressed: result.suppressedCount, duplicates: result.duplicateCount }
        );
    }

    res.status(201).json({
        success: true,
        data: {
            campaign: result.campaign,
            totalRecipients: result.totalRecipients,
            suppressedCount: result.suppressedCount,
            duplicateCount: result.duplicateCount,
            warnings: lintContent(input.subject, input.body),
        },
    });
};

export const listCampaigns = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const query = req.query as unknown as z.infer<typeof listCampaignsQuery>;

    const { rows, total } = await campaignService.listCampaigns(user.id, query);

    res.json({
        success: true,
        data: rows,
        pagination: { total, limit: query.limit, offset: query.offset },
    });
};

export const getCampaign = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const campaign = await campaignService.getCampaign(user.id, req.params.id);
    const breakdown = await campaignService.getCampaignBreakdown(user.id, req.params.id);

    res.json({ success: true, data: { ...campaign, breakdown } });
};

export const cancelCampaign = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const cancelled = await campaignService.cancelCampaign(user.id, req.params.id);
    res.json({ success: true, data: { cancelled } });
};

export const pauseCampaign = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    await campaignService.pauseCampaign(user.id, req.params.id);
    res.json({ success: true, message: 'Campaign paused' });
};

export const resumeCampaign = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    await campaignService.resumeCampaign(user.id, req.params.id);
    res.json({ success: true, message: 'Campaign resumed' });
};

export const rescheduleCampaign = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const { scheduledAt, timezone } = req.body as z.infer<typeof rescheduleSchema>;

    const rescheduled = await campaignService.rescheduleCampaign(
        user.id,
        req.params.id,
        new Date(scheduledAt),
        timezone
    );

    res.json({ success: true, data: { rescheduled } });
};

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const listEmails = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const query = req.query as unknown as z.infer<typeof listEmailsQuery>;

    const { rows, total } = await campaignService.listEmails(user.id, query);

    res.json({
        success: true,
        data: rows,
        pagination: { total, limit: query.limit, offset: query.offset },
    });
};

/**
 * Full detail for one message, including the rendered body and its event
 * timeline. The dashboard previously fetched the entire sent list and searched
 * it client-side because no endpoint like this existed.
 */
export const getEmail = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const email = await campaignService.getEmail(user.id, req.params.id);

    const mergeData = { email: email.recipientEmail, ...email.mergeData };
    const campaign = email.campaign;

    const renderedSubject =
        email.renderedSubject ??
        (campaign ? render(campaign.subject, mergeData, { escape: false }) : null);
    const renderedBody = campaign ? sanitizeBody(render(campaign.body, mergeData)) : null;

    res.json({
        success: true,
        data: {
            ...email,
            renderedSubject,
            renderedBody,
        },
    });
};

export const cancelEmail = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    await campaignService.cancelEmail(user.id, req.params.id);
    res.json({ success: true, message: 'Message cancelled' });
};

// ---------------------------------------------------------------------------
// Composer helpers
// ---------------------------------------------------------------------------

/**
 * Renders a campaign exactly as a recipient would see it, including the
 * compliance footer, without sending anything.
 */
export const preview = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const { subject, body, mergeData = {} } = req.body as z.infer<typeof previewSchema>;

    const profile = await db.query.users.findFirst({
        where: eq(users.id, user.id),
        columns: { companyName: true, postalAddress: true, name: true },
    });

    const data = { email: user.email, ...mergeData };
    const renderedBody = sanitizeBody(render(body, data));

    const footer = buildFooter({
        unsubscribeUrl: '#preview-unsubscribe-link',
        companyName: profile?.companyName,
        postalAddress: profile?.postalAddress,
        senderName: profile?.name ?? user.name,
    });

    res.json({
        success: true,
        data: {
            subject: render(subject, data, { escape: false }),
            html: renderedBody + footer,
            text: htmlToText(renderedBody),
            variables: extractVariables(subject, body),
            warnings: lintContent(subject, body),
        },
    });
};

/**
 * Sends a single message immediately to the caller's own choice of address.
 * Deliberately bypasses the campaign pipeline: it must not create rows,
 * consume campaign quota, or appear in analytics.
 */
export const testSend = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const { senderId, to, subject, body, mergeData = {} } = req.body as z.infer<
        typeof testSendSchema
    >;

    const sender = await db.query.senders.findFirst({
        where: and(eq(senders.id, senderId), eq(senders.userId, user.id)),
    });
    if (!sender) throw new HttpError(404, 'Sender not found');

    const profile = await db.query.users.findFirst({
        where: eq(users.id, user.id),
        columns: { companyName: true, postalAddress: true },
    });

    const data = { email: to, ...mergeData };
    const ctx = { emailId: `test-${Date.now()}`, userId: user.id, campaignId: null };

    const html =
        sanitizeBody(render(body, data)) +
        buildFooter({
            unsubscribeUrl: buildUnsubscribeUrl(ctx),
            companyName: profile?.companyName,
            postalAddress: profile?.postalAddress,
            senderName: sender.name,
        });

    const provider = getProviderForSender(sender);
    const result = await provider.send({
        from: { email: sender.email, name: sender.name },
        to,
        replyTo: sender.replyTo ?? undefined,
        subject: `[TEST] ${render(subject, data, { escape: false })}`,
        html,
        text: htmlToText(html),
        headers: buildComplianceHeaders(ctx, sender.replyTo ?? undefined),
    });

    res.json({
        success: true,
        data: { messageId: result.messageId, previewUrl: result.previewUrl },
    });
};

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export const getStats = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const days = Math.min(Number(req.query.days ?? 30) || 30, 365);

    const stats = await campaignService.getAccountStats(user.id, days);
    res.json({ success: true, data: stats });
};

/** Queue depth — useful in the UI and when diagnosing a backlog. */
export const getQueueHealth = async (_req: Request, res: Response): Promise<void> => {
    res.json({ success: true, data: await getQueueStats() });
};
