import crypto from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { log } from '../config/logger.js';
import {
    campaigns,
    emailEvents,
    emails,
    type EmailEventType,
    type Email,
} from '../db/schema.js';
import { recordSoftBounce, suppress } from './suppressionService.js';

const logger = log('webhook');

/**
 * Provider feedback ingestion.
 *
 * Without this, "sent" only ever meant "handed to SMTP" — which says nothing
 * about whether a human received anything. Bounces and complaints arriving here
 * are what keep the suppression list accurate and the sending domain healthy.
 */

export interface NormalizedEvent {
    type: EmailEventType;
    providerMessageId?: string;
    /** Set when the provider echoes our own tag back. */
    emailId?: string;
    recipient?: string;
    /** hard/soft, for bounces. */
    bounceType?: 'hard' | 'soft';
    detail?: string;
    providerEventId?: string;
    occurredAt: Date;
    raw: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Resend signs with Svix headers. Verifying is mandatory: the endpoint is
 * public, and forged events could suppress a customer's entire list.
 */
export const verifyResendSignature = (
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>
): boolean => {
    const secret = env.RESEND_WEBHOOK_SECRET;
    if (!secret) {
        logger.warn('RESEND_WEBHOOK_SECRET not set — rejecting webhook');
        return false;
    }

    const id = headers['svix-id'];
    const timestamp = headers['svix-timestamp'];
    const signatureHeader = headers['svix-signature'];

    if (typeof id !== 'string' || typeof timestamp !== 'string' || typeof signatureHeader !== 'string') {
        return false;
    }

    // Reject replays of old payloads.
    const age = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(age) || age > 300) return false;

    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    const signed = `${id}.${timestamp}.${rawBody.toString('utf8')}`;
    const expected = crypto.createHmac('sha256', key).update(signed).digest('base64');

    // Header may carry several space-separated `v1,<sig>` values.
    return signatureHeader
        .split(' ')
        .map((part) => part.split(',')[1])
        .filter(Boolean)
        .some((candidate) => {
            const a = Buffer.from(candidate);
            const b = Buffer.from(expected);
            return a.length === b.length && crypto.timingSafeEqual(a, b);
        });
};

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

const RESEND_EVENT_MAP: Record<string, EmailEventType> = {
    'email.sent': 'sent',
    'email.delivered': 'delivered',
    'email.delivery_delayed': 'deferred',
    'email.opened': 'opened',
    'email.clicked': 'clicked',
    'email.bounced': 'bounced',
    'email.complained': 'complained',
};

export const normalizeResendEvent = (payload: Record<string, any>): NormalizedEvent | null => {
    const type = RESEND_EVENT_MAP[payload.type];
    if (!type) return null;

    const data = payload.data ?? {};
    const tags: Record<string, string> = Array.isArray(data.tags)
        ? Object.fromEntries(data.tags.map((t: any) => [t.name, t.value]))
        : (data.tags ?? {});

    return {
        type,
        providerMessageId: data.email_id ?? data.id,
        emailId: tags.email_id,
        recipient: Array.isArray(data.to) ? data.to[0] : data.to,
        bounceType: data.bounce?.type === 'Permanent' ? 'hard' : data.bounce ? 'soft' : undefined,
        detail: data.bounce?.message ?? data.reason,
        providerEventId: payload.id ?? data.email_id,
        occurredAt: data.created_at ? new Date(data.created_at) : new Date(),
        raw: payload,
    };
};

const SES_EVENT_MAP: Record<string, EmailEventType> = {
    Send: 'sent',
    Delivery: 'delivered',
    Bounce: 'bounced',
    Complaint: 'complained',
    Open: 'opened',
    Click: 'clicked',
    DeliveryDelay: 'deferred',
    Reject: 'failed',
};

export const normalizeSesEvent = (payload: Record<string, any>): NormalizedEvent | null => {
    const eventType = payload.eventType ?? payload.notificationType;
    const type = SES_EVENT_MAP[eventType];
    if (!type) return null;

    const mail = payload.mail ?? {};
    const tags: Record<string, string[]> = mail.tags ?? {};

    const recipient =
        payload.bounce?.bouncedRecipients?.[0]?.emailAddress ??
        payload.complaint?.complainedRecipients?.[0]?.emailAddress ??
        mail.destination?.[0];

    return {
        type,
        providerMessageId: mail.messageId,
        emailId: tags.email_id?.[0],
        recipient,
        bounceType:
            payload.bounce?.bounceType === 'Permanent'
                ? 'hard'
                : payload.bounce
                  ? 'soft'
                  : undefined,
        detail:
            payload.bounce?.bouncedRecipients?.[0]?.diagnosticCode ??
            payload.complaint?.complaintFeedbackType,
        providerEventId: `${mail.messageId}:${eventType}:${payload.mail?.timestamp ?? ''}`,
        occurredAt: mail.timestamp ? new Date(mail.timestamp) : new Date(),
        raw: payload,
    };
};

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

const findEmail = async (event: NormalizedEvent): Promise<Email | undefined> => {
    if (event.emailId) {
        const byId = await db.query.emails.findFirst({ where: eq(emails.id, event.emailId) });
        if (byId) return byId;
    }
    if (event.providerMessageId) {
        return db.query.emails.findFirst({
            where: eq(emails.providerMessageId, event.providerMessageId),
        });
    }
    return undefined;
};

const CAMPAIGN_COUNTER: Partial<Record<EmailEventType, keyof typeof campaigns.$inferSelect>> = {
    delivered: 'deliveredCount',
    opened: 'openedCount',
    clicked: 'clickedCount',
    bounced: 'bouncedCount',
    complained: 'complainedCount',
};

/**
 * Applies one normalised event: appends it to the timeline, advances the
 * message's status, updates campaign counters, and suppresses the recipient
 * when the event says the address should never be used again.
 */
export const applyEvent = async (event: NormalizedEvent): Promise<boolean> => {
    const email = await findEmail(event);
    if (!email) {
        logger.warn(
            { providerMessageId: event.providerMessageId, type: event.type },
            'no matching email for event'
        );
        return false;
    }

    // Providers retry webhooks; the unique index on providerEventId makes
    // re-delivery a no-op rather than a double count.
    const inserted = await db
        .insert(emailEvents)
        .values({
            emailId: email.id,
            campaignId: email.campaignId,
            type: event.type,
            payload: event.raw,
            providerEventId: event.providerEventId ?? null,
            occurredAt: event.occurredAt,
        })
        .onConflictDoNothing({ target: emailEvents.providerEventId })
        .returning({ id: emailEvents.id });

    if (inserted.length === 0) {
        logger.debug({ providerEventId: event.providerEventId }, 'duplicate event ignored');
        return true;
    }

    const updates: Partial<typeof emails.$inferInsert> = { updatedAt: new Date() };

    switch (event.type) {
        case 'delivered':
            // Never move a message backwards out of a terminal bad state.
            if (email.status === 'sent') updates.status = 'delivered';
            break;
        case 'opened':
            if (!email.openedAt) updates.openedAt = event.occurredAt;
            break;
        case 'clicked':
            if (!email.clickedAt) updates.clickedAt = event.occurredAt;
            // A click implies an open even if the pixel was blocked.
            if (!email.openedAt) updates.openedAt = event.occurredAt;
            break;
        case 'bounced':
            updates.status = 'bounced';
            updates.errorMessage = event.detail ?? 'Bounced';
            break;
        case 'failed':
            updates.status = 'failed';
            updates.errorMessage = event.detail ?? 'Rejected by provider';
            break;
        default:
            break;
    }

    await db.update(emails).set(updates).where(eq(emails.id, email.id));

    const counter = CAMPAIGN_COUNTER[event.type];
    if (counter && email.campaignId) {
        await db
            .update(campaigns)
            .set({ [counter]: sql`${campaigns[counter as 'deliveredCount']} + 1`, updatedAt: new Date() })
            .where(eq(campaigns.id, email.campaignId));
    }

    const recipient = event.recipient ?? email.recipientEmail;

    if (event.type === 'bounced') {
        if (event.bounceType === 'hard') {
            await suppress(email.userId, recipient, 'hard_bounce', event.detail);
        } else {
            await recordSoftBounce(
                email.userId,
                recipient,
                env.SOFT_BOUNCE_THRESHOLD,
                event.detail
            );
        }
    }

    if (event.type === 'complained') {
        // A spam complaint is the strongest possible signal to stop.
        await suppress(email.userId, recipient, 'complaint', event.detail);
    }

    if (email.campaignId && (event.type === 'bounced' || event.type === 'complained')) {
        await enforceReputationGuards(email.campaignId);
    }

    return true;
};

/**
 * Auto-pauses a campaign whose bounce or complaint rate crosses the threshold
 * mailbox providers act on. Continuing to send past that point risks the
 * account, so stopping automatically is the safe default.
 */
const enforceReputationGuards = async (campaignId: string): Promise<void> => {
    const campaign = await db.query.campaigns.findFirst({ where: eq(campaigns.id, campaignId) });
    if (!campaign || campaign.status !== 'sending') return;

    // Only meaningful once there is a sample worth reacting to.
    if (campaign.sentCount < 100) return;

    const complaintRate = campaign.complainedCount / campaign.sentCount;
    const bounceRate = campaign.bouncedCount / campaign.sentCount;

    if (complaintRate > env.MAX_COMPLAINT_RATE || bounceRate > env.MAX_BOUNCE_RATE) {
        await db
            .update(campaigns)
            .set({ status: 'paused', updatedAt: new Date() })
            .where(eq(campaigns.id, campaignId));

        logger.error(
            { campaignId, complaintRate, bounceRate },
            'campaign auto-paused: reputation threshold exceeded'
        );
    }
};

/** Records an open recorded by the tracking pixel rather than the provider. */
export const recordLocalEvent = async (
    emailId: string,
    type: 'opened' | 'clicked' | 'unsubscribed',
    payload?: Record<string, unknown>
): Promise<void> => {
    const email = await db.query.emails.findFirst({ where: eq(emails.id, emailId) });
    if (!email) return;

    await db.insert(emailEvents).values({
        emailId,
        campaignId: email.campaignId,
        type,
        payload,
    });

    const updates: Partial<typeof emails.$inferInsert> = { updatedAt: new Date() };
    if (type === 'opened' && !email.openedAt) updates.openedAt = new Date();
    if (type === 'clicked') {
        if (!email.clickedAt) updates.clickedAt = new Date();
        if (!email.openedAt) updates.openedAt = new Date();
    }

    await db.update(emails).set(updates).where(eq(emails.id, emailId));

    if (email.campaignId) {
        const counter = type === 'clicked' ? 'clickedCount' : type === 'opened' ? 'openedCount' : null;
        if (counter) {
            await db
                .update(campaigns)
                .set({ [counter]: sql`${campaigns[counter]} + 1`, updatedAt: new Date() })
                .where(eq(campaigns.id, email.campaignId));
        }
    }
};
