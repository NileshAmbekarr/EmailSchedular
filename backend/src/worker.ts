import 'dotenv/config';
import http from 'node:http';
import type { Worker } from 'bullmq';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { installRejectionHandlers } from './config/rejections.js';
import { closeDatabase, pingDatabase } from './config/database.js';
import { closeRedis, pingRedis } from './config/redis.js';
import { closeQueues } from './queues/queues.js';
import { createEmailWorker } from './queues/emailWorker.js';
import { createCampaignWorker, startDueCampaignSweeper } from './queues/campaignWorker.js';
import { recoverOrphanedJobs, startRecoverySweeper } from './services/recoveryService.js';
import { closeAllProviders } from './providers/index.js';

/**
 * Standalone worker process.
 *
 * Sending and serving have completely different scaling curves: the API is
 * bound by request concurrency, the worker by provider throughput. Running them
 * together meant adding an API replica silently doubled the send rate. Deploy
 * this as its own service with RUN_WORKER_IN_API=false on the API.
 */

const workers: Worker[] = [];
const timers: NodeJS.Timeout[] = [];
let shuttingDown = false;

const start = async (): Promise<void> => {
    await recoverOrphanedJobs();

    workers.push(createEmailWorker(), createCampaignWorker());
    timers.push(startDueCampaignSweeper(), startRecoverySweeper());

    // Most platforms require a listening port to consider a service healthy.
    // Render web services in particular fail the deploy outright if nothing
    // binds their injected $PORT — set WORKER_PORT equal to PORT there.
    const port = env.WORKER_PORT;
    http
        .createServer(async (req, res) => {
            if (req.url === '/ready') {
                const [database, redis] = await Promise.all([pingDatabase(), pingRedis()]);
                const ready = database && redis;
                res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: ready ? 'ready' : 'degraded', database, redis }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', role: 'worker' }));
        })
        .listen(port, () => logger.info({ port }, 'worker health endpoint listening'));

    logger.info({ concurrency: env.WORKER_CONCURRENCY }, 'worker process started');
};

const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'worker shutting down');

    for (const timer of timers) clearInterval(timer);

    // Lets in-flight sends finish instead of orphaning them mid-delivery.
    await Promise.allSettled(workers.map((worker) => worker.close()));

    await closeAllProviders();
    await closeQueues();
    await closeRedis();
    await closeDatabase();

    logger.info('worker shutdown complete');
    process.exit(0);
};

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => void shutdown(signal));
}

installRejectionHandlers(logger);

start().catch((err) => {
    logger.fatal({ err }, 'worker failed to start');
    process.exit(1);
});
