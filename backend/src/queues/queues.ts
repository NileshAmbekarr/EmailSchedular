import { Queue, QueueEvents } from 'bullmq';
import { getRedisConnectionOptions } from '../config/redis.js';
import { log } from '../config/logger.js';

const logger = log('queue');

export const EMAIL_QUEUE = 'email-queue';
export const CAMPAIGN_QUEUE = 'campaign-queue';

/** Maximum send attempts per message. Mirrored in the DB as `attempt_count`. */
export const MAX_SEND_ATTEMPTS = 4;

export interface EmailJobData {
    emailId: string;
    userId: string;
    senderId: string;
    campaignId: string | null;
}

export type CampaignJobData =
    | { type: 'fanout'; campaignId: string; userId: string; offset: number }
    | { type: 'finalize'; campaignId: string; userId: string };

const connection = getRedisConnectionOptions();

/**
 * One job per recipient. `jobId` is always the email row's uuid — that identity
 * is the idempotency guarantee, so nothing in the system may enqueue a send
 * under any other id.
 */
export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE, {
    connection,
    defaultJobOptions: {
        attempts: MAX_SEND_ATTEMPTS,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { count: 5_000, age: 7 * 24 * 60 * 60 },
        // Failures are kept longer — they are the ones worth inspecting.
        removeOnFail: { count: 10_000, age: 30 * 24 * 60 * 60 },
    },
});

/**
 * Expanding a large recipient list happens in the background so the API can
 * answer immediately instead of holding a request open for tens of thousands
 * of inserts.
 */
export const campaignQueue = new Queue<CampaignJobData>(CAMPAIGN_QUEUE, {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 500 },
    },
});

emailQueue.on('error', (err) => logger.error({ err }, 'email queue error'));
campaignQueue.on('error', (err) => logger.error({ err }, 'campaign queue error'));

export const emailQueueEvents = new QueueEvents(EMAIL_QUEUE, { connection });

/** Queue depth, for the dashboard and the readiness probe. */
export const getQueueStats = async () => {
    const [counts, campaignCounts] = await Promise.all([
        emailQueue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'),
        campaignQueue.getJobCounts('waiting', 'active', 'failed'),
    ]);

    return {
        email: counts,
        campaign: campaignCounts,
    };
};

export const closeQueues = async (): Promise<void> => {
    await Promise.allSettled([
        emailQueue.close(),
        campaignQueue.close(),
        emailQueueEvents.close(),
    ]);
    logger.info('queues closed');
};
