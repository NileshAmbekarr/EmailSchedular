import { Worker, type Job } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
import { getRedisConnectionOptions } from '../config/redis.js';
import { db } from '../config/database.js';
import { campaigns } from '../db/schema.js';
import { env } from '../config/env.js';
import { log } from '../config/logger.js';
import { fanoutBatch, finalizeCampaign } from '../services/campaignService.js';
import { CAMPAIGN_QUEUE, campaignQueue, type CampaignJobData } from './queues.js';

const logger = log('campaign-worker');

/**
 * Expands campaigns into individual send jobs, one page at a time.
 *
 * Paging keeps a hundred-thousand-recipient campaign from occupying a worker
 * for minutes and from building a single enormous Redis pipeline.
 */
const processCampaignJob = async (job: Job<CampaignJobData>): Promise<void> => {
    const { campaignId } = job.data;
    const jobLogger = logger.child({ campaignId, jobId: job.id });

    if (job.data.type === 'finalize') {
        const completed = await finalizeCampaign(campaignId);
        jobLogger.info({ completed }, 'finalize checked');
        return;
    }

    const campaign = await db.query.campaigns.findFirst({ where: eq(campaigns.id, campaignId) });
    if (!campaign) {
        jobLogger.warn('campaign no longer exists');
        return;
    }

    if (['cancelled', 'completed', 'draft', 'paused'].includes(campaign.status)) {
        jobLogger.info({ status: campaign.status }, 'campaign not sending, stopping fan-out');
        return;
    }

    // First page flips the campaign into `sending`.
    if (campaign.status === 'scheduled') {
        await db
            .update(campaigns)
            .set({ status: 'sending', startedAt: new Date(), updatedAt: new Date() })
            .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'scheduled')));
    }

    const hasMore = await fanoutBatch(campaignId, env.FANOUT_BATCH_SIZE);

    if (hasMore) {
        const nextOffset = job.data.offset + env.FANOUT_BATCH_SIZE;
        await campaignQueue.add(
            'fanout',
            { type: 'fanout', campaignId, userId: job.data.userId, offset: nextOffset },
            { jobId: `fanout:${campaignId}:${nextOffset}` }
        );
        jobLogger.debug({ nextOffset }, 'queued next fan-out page');
    } else {
        // Nothing left to enqueue. Schedule a completion check far enough out
        // that the last messages have had a chance to send.
        await campaignQueue.add(
            'finalize',
            { type: 'finalize', campaignId, userId: job.data.userId },
            {
                jobId: `finalize:${campaignId}:${Date.now()}`,
                delay: 60_000,
            }
        );
        jobLogger.info('fan-out complete');
    }
};

export const createCampaignWorker = (): Worker<CampaignJobData> => {
    const worker = new Worker<CampaignJobData>(CAMPAIGN_QUEUE, processCampaignJob, {
        connection: getRedisConnectionOptions(),
        // Fan-out is database-bound; a couple of concurrent pages is plenty.
        concurrency: 2,
    });

    worker.on('error', (err) => logger.error({ err }, 'campaign worker error'));
    worker.on('failed', (job, err) =>
        logger.warn({ jobId: job?.id, err: err.message }, 'campaign job failed')
    );

    logger.info('campaign worker started');
    return worker;
};

/**
 * Catches campaigns whose scheduled time arrived while nothing was listening —
 * for example one created during an outage, or a draft scheduled far in advance
 * whose fan-out job was evicted.
 */
export const startDueCampaignSweeper = (intervalMs = 60_000): NodeJS.Timeout => {
    const timer = setInterval(async () => {
        try {
            const due = await db.query.campaigns.findMany({
                where: and(
                    inArray(campaigns.status, ['scheduled']),
                    // Postgres comparison, not JS — avoids clock skew between
                    // the app process and the database.
                    eq(campaigns.status, 'scheduled')
                ),
                limit: 50,
            });

            const now = Date.now();
            for (const campaign of due) {
                if (new Date(campaign.scheduledAt).getTime() > now) continue;
                await campaignQueue.add(
                    'fanout',
                    {
                        type: 'fanout',
                        campaignId: campaign.id,
                        userId: campaign.userId,
                        offset: 0,
                    },
                    { jobId: `fanout:${campaign.id}:sweep:${Math.floor(now / 60_000)}` }
                );
            }
        } catch (err) {
            logger.error({ err }, 'due campaign sweeper failed');
        }
    }, intervalMs);

    timer.unref();
    return timer;
};
