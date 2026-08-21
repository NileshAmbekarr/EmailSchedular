import 'dotenv/config';
import type { Server } from 'node:http';
import type { Worker } from 'bullmq';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { closeDatabase } from './config/database.js';
import { closeRedis } from './config/redis.js';
import { closeQueues } from './queues/queues.js';
import { createEmailWorker } from './queues/emailWorker.js';
import { createCampaignWorker, startDueCampaignSweeper } from './queues/campaignWorker.js';
import { recoverOrphanedJobs, startRecoverySweeper } from './services/recoveryService.js';
import { closeAllProviders } from './providers/index.js';
import { purgeExpiredIdempotencyKeys } from './middleware/idempotency.js';

const workers: Worker[] = [];
const timers: NodeJS.Timeout[] = [];
let server: Server | undefined;
let shuttingDown = false;

const start = async (): Promise<void> => {
    // Reconcile the database against the queue before accepting traffic, so a
    // restart cannot leave scheduled mail stranded.
    await recoverOrphanedJobs();

    /**
     * Running the worker inside the API process is convenient for local
     * development and small deployments, but it means scaling the API also
     * multiplies the number of workers. Set RUN_WORKER_IN_API=false and run
     * `npm run start:worker` as its own service to scale them independently.
     */
    if (env.RUN_WORKER_IN_API) {
        workers.push(createEmailWorker(), createCampaignWorker());
        timers.push(startDueCampaignSweeper(), startRecoverySweeper());
        logger.info('workers running in-process');
    }

    timers.push(
        setInterval(
            () => void purgeExpiredIdempotencyKeys().catch(() => {}),
            60 * 60 * 1000
        ).unref()
    );

    const app = createApp();

    server = app.listen(env.PORT, () => {
        logger.info(
            {
                port: env.PORT,
                env: env.NODE_ENV,
                provider: env.EMAIL_PROVIDER,
                workersInProcess: env.RUN_WORKER_IN_API,
                corsOrigins: env.CORS_ORIGINS,
            },
            'API listening'
        );
    });
};

/**
 * Graceful shutdown.
 *
 * Render sends SIGTERM on every deploy. Without this, in-flight sends were
 * killed mid-flight and left rows stuck in `processing` — which, combined with
 * a recovery pass that ignored `processing`, meant a routine deploy could both
 * drop and duplicate messages. Workers are closed first so they finish the job
 * they hold before the connections go away.
 */
const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'shutting down');

    // Stop accepting new HTTP connections.
    if (server) {
        await new Promise<void>((resolve) => server!.close(() => resolve()));
    }

    for (const timer of timers) clearInterval(timer);

    // `close()` waits for active jobs to finish rather than killing them.
    await Promise.allSettled(workers.map((worker) => worker.close()));

    await closeAllProviders();
    await closeQueues();
    await closeRedis();
    await closeDatabase();

    logger.info('shutdown complete');
    process.exit(0);
};

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => void shutdown(signal));
}

process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception, shutting down');
    void shutdown('uncaughtException');
});

start().catch((err) => {
    logger.fatal({ err }, 'failed to start');
    process.exit(1);
});
