import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { log } from '../config/logger.js';
import { campaigns, emails } from '../db/schema.js';
import { emailQueue, MAX_SEND_ATTEMPTS } from '../queues/queues.js';

const logger = log('recovery');

export interface RecoveryReport {
    unstuck: number;
    requeued: number;
    lateRequeued: number;
    expired: number;
    campaignsResumed: number;
}

/** Read in pages so a large backlog does not load entirely into memory. */
const SCAN_BATCH = 500;

/**
 * Reconciles the database against the queue on startup.
 *
 * The database is the source of truth; Redis is a scheduling index that can be
 * lost. Three failure modes are repaired here:
 *
 *  1. **Stuck `processing` rows** — the process died mid-send. The old
 *     implementation never looked at `processing`, so these were orphaned
 *     permanently.
 *  2. **Missing jobs for future messages** — the ordinary restart case.
 *  3. **Past-due messages** — anything whose slot elapsed while the service was
 *     down. The old filter was `scheduledAt >= now()`, which silently dropped
 *     exactly the messages restart recovery is supposed to protect.
 */
export const recoverOrphanedJobs = async (): Promise<RecoveryReport> => {
    const startedAt = Date.now();
    const report: RecoveryReport = {
        unstuck: 0,
        requeued: 0,
        lateRequeued: 0,
        expired: 0,
        campaignsResumed: 0,
    };

    report.unstuck = await releaseStuckProcessing();

    const { requeued, lateRequeued, expired } = await requeueMissingJobs();
    report.requeued = requeued;
    report.lateRequeued = lateRequeued;
    report.expired = expired;

    report.campaignsResumed = await resumeIncompleteCampaigns();

    logger.info({ ...report, durationMs: Date.now() - startedAt }, 'recovery complete');
    return report;
};

/**
 * A row left in `processing` means a worker claimed it and then died. After the
 * visibility timeout it is safe to reclaim: the send either never happened, or
 * it did and the provider will dedupe on message id.
 */
const releaseStuckProcessing = async (): Promise<number> => {
    const cutoff = new Date(Date.now() - env.STUCK_JOB_TIMEOUT_MS);

    const released = await db
        .update(emails)
        .set({ status: 'pending', updatedAt: new Date() })
        .where(and(eq(emails.status, 'processing'), lt(emails.updatedAt, cutoff)))
        .returning({ id: emails.id });

    if (released.length > 0) {
        logger.warn({ count: released.length }, 'released stuck processing rows');
    }
    return released.length;
};

const requeueMissingJobs = async (): Promise<{
    requeued: number;
    lateRequeued: number;
    expired: number;
}> => {
    let requeued = 0;
    let lateRequeued = 0;
    let expired = 0;
    let offset = 0;

    for (;;) {
        const batch = await db
            .select({
                id: emails.id,
                userId: emails.userId,
                senderId: emails.senderId,
                campaignId: emails.campaignId,
                scheduledAt: emails.scheduledAt,
                attemptCount: emails.attemptCount,
            })
            .from(emails)
            .where(inArray(emails.status, ['pending', 'queued', 'retrying']))
            .orderBy(emails.scheduledAt)
            .limit(SCAN_BATCH)
            .offset(offset);

        if (batch.length === 0) break;

        const now = Date.now();
        const toExpire: string[] = [];
        const toEnqueue: Array<{ id: string; userId: string; senderId: string; campaignId: string | null; delay: number }> = [];

        for (const row of batch) {
            // A live job means the queue already knows about this message.
            const existing = await emailQueue.getJob(row.id);
            if (existing) continue;

            const dueAt = new Date(row.scheduledAt).getTime();
            const lateness = now - dueAt;

            if (lateness > env.MAX_RECOVERY_LATENESS_MS) {
                // Delivering a days-late message is worse than not delivering
                // it — a "your meeting starts in 10 minutes" email arriving
                // tomorrow is actively harmful.
                toExpire.push(row.id);
                continue;
            }

            if (row.attemptCount >= MAX_SEND_ATTEMPTS) {
                toExpire.push(row.id);
                continue;
            }

            toEnqueue.push({
                id: row.id,
                userId: row.userId,
                senderId: row.senderId,
                campaignId: row.campaignId,
                delay: Math.max(0, dueAt - now),
            });

            if (lateness > 0) lateRequeued++;
            else requeued++;
        }

        if (toEnqueue.length > 0) {
            await emailQueue.addBulk(
                toEnqueue.map((row) => ({
                    name: 'send-email',
                    data: {
                        emailId: row.id,
                        userId: row.userId,
                        senderId: row.senderId,
                        campaignId: row.campaignId,
                    },
                    opts: { jobId: row.id, delay: row.delay, attempts: MAX_SEND_ATTEMPTS },
                }))
            );

            await db
                .update(emails)
                .set({ status: 'queued', updatedAt: new Date() })
                .where(
                    and(
                        inArray(
                            emails.id,
                            toEnqueue.map((r) => r.id)
                        ),
                        inArray(emails.status, ['pending', 'queued', 'retrying'])
                    )
                );
        }

        if (toExpire.length > 0) {
            await db
                .update(emails)
                .set({
                    status: 'failed',
                    errorMessage: 'Expired: scheduled time passed while the service was unavailable',
                    updatedAt: new Date(),
                })
                .where(inArray(emails.id, toExpire));
            expired += toExpire.length;
        }

        if (batch.length < SCAN_BATCH) break;
        offset += SCAN_BATCH;
    }

    return { requeued, lateRequeued, expired };
};

/**
 * A campaign whose fan-out was interrupted still has `pending` rows but no
 * fan-out job. Marking it `sending` and re-triggering fan-out picks up where it
 * stopped.
 */
const resumeIncompleteCampaigns = async (): Promise<number> => {
    const stalled = await db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(
            and(
                inArray(campaigns.status, ['scheduled', 'sending']),
                sql`exists (
                    select 1 from ${emails}
                    where ${emails.campaignId} = ${campaigns.id}
                      and ${emails.status} = 'pending'
                )`
            )
        )
        .limit(100);

    for (const campaign of stalled) {
        const { campaignQueue } = await import('../queues/queues.js');
        await campaignQueue.add(
            'fanout',
            { type: 'fanout', campaignId: campaign.id, userId: '', offset: 0 },
            { jobId: `fanout:${campaign.id}:recovery:${Date.now()}` }
        );
    }

    if (stalled.length > 0) {
        logger.info({ count: stalled.length }, 'resumed stalled campaign fan-outs');
    }
    return stalled.length;
};

/**
 * Periodic sweeper. Recovery on boot is not enough on its own — a job can be
 * lost mid-run if Redis is flushed or fails over, and this catches that within
 * one interval instead of at the next deploy.
 */
export const startRecoverySweeper = (intervalMs = 5 * 60 * 1000): NodeJS.Timeout => {
    const timer = setInterval(() => {
        recoverOrphanedJobs().catch((err) => logger.error({ err }, 'sweeper failed'));
    }, intervalMs);

    timer.unref();
    return timer;
};
