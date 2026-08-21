import { Worker, DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getRedisConnectionOptions } from '../config/redis.js';
import { db } from '../config/database.js';
import { campaigns, emailEvents, emails, senders, users } from '../db/schema.js';
import { env } from '../config/env.js';
import { log } from '../config/logger.js';
import { getProviderForSender, ProviderError } from '../providers/index.js';
import { isSuppressed, suppress } from '../services/suppressionService.js';
import { releaseSlot, reserveSlot, resolveSenderLimits } from '../services/rateLimitService.js';
import { decorateBody, buildComplianceHeaders, buildUnsubscribeUrl } from '../services/complianceService.js';
import { htmlToText, render, sanitizeBody } from '../services/templateService.js';
import { EMAIL_QUEUE, MAX_SEND_ATTEMPTS, type EmailJobData } from './queues.js';

const logger = log('worker');

/**
 * Statuses a job may legitimately start from. Anything else means the message
 * was already handled — cancelled, sent, or claimed by another worker.
 */
const CLAIMABLE = ['pending', 'queued', 'retrying'] as const;

/**
 * Atomically claims a message for sending.
 *
 * This compare-and-set is what actually prevents double sends. Job-id
 * uniqueness only holds while a job exists in Redis; the database row is the
 * durable arbiter, so a duplicate or recovered job simply loses the race here
 * and exits without sending.
 */
const claimEmail = async (emailId: string): Promise<number | null> => {
    const [claimed] = await db
        .update(emails)
        .set({
            status: 'processing',
            attemptCount: sql`${emails.attemptCount} + 1`,
            updatedAt: new Date(),
        })
        .where(and(eq(emails.id, emailId), inArray(emails.status, [...CLAIMABLE])))
        .returning({ attemptCount: emails.attemptCount });

    return claimed?.attemptCount ?? null;
};

const bumpCampaign = async (
    campaignId: string | null,
    column: 'sentCount' | 'failedCount',
): Promise<void> => {
    if (!campaignId) return;

    await db
        .update(campaigns)
        .set(
            column === 'sentCount'
                ? { sentCount: sql`${campaigns.sentCount} + 1`, updatedAt: new Date() }
                : { failedCount: sql`${campaigns.failedCount} + 1`, updatedAt: new Date() }
        )
        .where(eq(campaigns.id, campaignId));
};

const recordEvent = async (
    emailId: string,
    campaignId: string | null,
    type: 'sent' | 'failed' | 'queued',
    payload?: Record<string, unknown>
): Promise<void> => {
    await db.insert(emailEvents).values({ emailId, campaignId, type, payload });
};

/**
 * Sends one message.
 *
 * The `token` parameter is required for `moveToDelayed` — it proves this worker
 * still holds the job's lock.
 */
const processEmailJob = async (job: Job<EmailJobData>, token?: string): Promise<void> => {
    const { emailId } = job.data;
    const jobLogger = logger.child({ emailId, jobId: job.id });

    // ---- Load the full context in one query --------------------------------
    const row = await db.query.emails.findFirst({
        where: eq(emails.id, emailId),
        with: {
            sender: true,
            campaign: true,
            user: {
                columns: { id: true, companyName: true, postalAddress: true, name: true },
            },
        },
    });

    if (!row) {
        // The row was deleted (campaign removed). Nothing to do.
        jobLogger.warn('email row no longer exists, dropping job');
        return;
    }

    // ---- Terminal states ---------------------------------------------------
    if (['sent', 'delivered', 'cancelled', 'suppressed'].includes(row.status)) {
        jobLogger.debug({ status: row.status }, 'already resolved, skipping');
        return;
    }

    if (row.campaign && ['cancelled', 'paused'].includes(row.campaign.status)) {
        jobLogger.info({ campaignStatus: row.campaign.status }, 'campaign not sending, skipping');
        return;
    }

    // ---- Suppression -------------------------------------------------------
    // Checked here rather than at schedule time: a campaign queued days ago may
    // still be sending after the recipient opted out.
    if (await isSuppressed(row.userId, row.recipientEmail)) {
        await db
            .update(emails)
            .set({ status: 'suppressed', updatedAt: new Date() })
            .where(eq(emails.id, emailId));
        jobLogger.info('recipient suppressed, not sending');
        return;
    }

    const sender = row.sender;
    const limits = resolveSenderLimits(sender);

    // ---- Rate limit --------------------------------------------------------
    const decision = await reserveSlot(sender.id, limits);
    if (!decision.allowed) {
        const delayUntil = decision.resetAt.getTime();
        jobLogger.info(
            { limitedBy: decision.limitedBy, resetAt: decision.resetAt },
            'rate limited, deferring'
        );

        // Reschedules THIS job, preserving its id. The previous implementation
        // enqueued a new job under `${emailId}-retry-${Date.now()}`, which broke
        // the id-based idempotency guarantee and could produce duplicate sends.
        await job.moveToDelayed(delayUntil, token);
        throw new DelayedError();
    }

    // ---- Claim -------------------------------------------------------------
    const attemptCount = await claimEmail(emailId);
    if (attemptCount === null) {
        // Lost the race, or the message was cancelled between load and claim.
        await releaseSlot(sender.id);
        jobLogger.debug('could not claim, another worker owns this message');
        return;
    }

    const isFinalAttempt = attemptCount >= MAX_SEND_ATTEMPTS;

    try {
        // ---- Render --------------------------------------------------------
        const campaign = row.campaign;
        const subjectSource = campaign?.subject ?? row.renderedSubject ?? '';
        const bodySource = campaign?.body ?? '';

        const mergeData = { email: row.recipientEmail, ...row.mergeData };
        const subject = render(subjectSource, mergeData, { escape: false });
        const renderedBody = sanitizeBody(render(bodySource, mergeData));

        const linkCtx = {
            emailId: row.id,
            userId: row.userId,
            campaignId: row.campaignId,
        };

        const html = decorateBody(renderedBody, {
            ctx: linkCtx,
            trackOpens: campaign?.trackOpens ?? false,
            trackClicks: campaign?.trackClicks ?? false,
            unsubscribeUrl: buildUnsubscribeUrl(linkCtx),
            companyName: row.user.companyName,
            postalAddress: row.user.postalAddress,
            senderName: sender.name,
        });

        // ---- Send ----------------------------------------------------------
        const provider = getProviderForSender(sender);
        const result = await provider.send({
            from: { email: sender.email, name: sender.name },
            to: row.recipientEmail,
            replyTo: sender.replyTo ?? undefined,
            subject,
            html,
            text: htmlToText(html),
            headers: buildComplianceHeaders(linkCtx, sender.replyTo ?? undefined),
            tags: {
                email_id: row.id,
                ...(row.campaignId ? { campaign_id: row.campaignId } : {}),
            },
        });

        await db
            .update(emails)
            .set({
                status: 'sent',
                sentAt: new Date(),
                renderedSubject: subject,
                providerMessageId: result.messageId,
                previewUrl: result.previewUrl ?? null,
                errorMessage: null,
                updatedAt: new Date(),
            })
            .where(eq(emails.id, emailId));

        await Promise.all([
            recordEvent(emailId, row.campaignId, 'sent', { provider: provider.name }),
            bumpCampaign(row.campaignId, 'sentCount'),
        ]);

        jobLogger.info({ provider: provider.name, to: row.recipientEmail }, 'sent');
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown send error';
        const permanent = err instanceof ProviderError && err.permanent;

        // A permanent rejection means this address will never accept mail.
        // Retrying it repeatedly is what gets a sending domain blocklisted.
        if (permanent) {
            await suppress(row.userId, row.recipientEmail, 'invalid', message);
            await db
                .update(emails)
                .set({ status: 'failed', errorMessage: message, updatedAt: new Date() })
                .where(eq(emails.id, emailId));
            await Promise.all([
                recordEvent(emailId, row.campaignId, 'failed', { message, permanent: true }),
                bumpCampaign(row.campaignId, 'failedCount'),
            ]);

            jobLogger.warn({ err }, 'permanent failure, recipient suppressed');
            // Tells BullMQ not to retry.
            throw new UnrecoverableError(message);
        }

        // Transient: the message never reached the provider, so give the
        // reserved quota slot back rather than charging it to the sender.
        await releaseSlot(sender.id);

        if (isFinalAttempt) {
            await db
                .update(emails)
                .set({ status: 'failed', errorMessage: message, updatedAt: new Date() })
                .where(eq(emails.id, emailId));
            await Promise.all([
                recordEvent(emailId, row.campaignId, 'failed', { message, attempts: attemptCount }),
                bumpCampaign(row.campaignId, 'failedCount'),
            ]);
            jobLogger.error({ err, attemptCount }, 'send failed permanently after retries');
        } else {
            // Stays visible as in-flight. The previous implementation wrote
            // `failed` on every attempt, so a message that succeeded on retry
            // still showed up as failed in the dashboard in between.
            await db
                .update(emails)
                .set({ status: 'retrying', errorMessage: message, updatedAt: new Date() })
                .where(eq(emails.id, emailId));
            jobLogger.warn({ err, attemptCount }, 'send failed, will retry');
        }

        throw err;
    }
};

export const createEmailWorker = (): Worker<EmailJobData> => {
    const worker = new Worker<EmailJobData>(EMAIL_QUEUE, processEmailJob, {
        connection: getRedisConnectionOptions(),
        concurrency: env.WORKER_CONCURRENCY,
        // No queue-wide limiter here. The old `{ max: 1, duration: 2000 }`
        // throttled the entire deployment to one message every two seconds
        // regardless of how many senders were active. Pacing now comes from
        // per-sender reservation plus schedule spreading, which is per-sender
        // and survives horizontal scaling.
    });

    worker.on('failed', (job, err) => {
        if (err instanceof DelayedError) return; // deliberate deferral
        logger.warn({ jobId: job?.id, err: err.message }, 'job failed');
    });

    worker.on('error', (err) => logger.error({ err }, 'worker error'));

    logger.info(
        { concurrency: env.WORKER_CONCURRENCY, maxAttempts: MAX_SEND_ATTEMPTS },
        'email worker started'
    );

    return worker;
};

export { processEmailJob };
