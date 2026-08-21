import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import crypto from 'node:crypto';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { pingDatabase } from './config/database.js';
import { pingRedis } from './config/redis.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import routes from './routes/index.js';

export const createApp = (): Express => {
    const app = express();

    // Render/Vercel terminate TLS upstream; without this the client IP seen by
    // the rate limiter is the proxy's, so every user shares one bucket.
    app.set('trust proxy', 1);
    app.disable('x-powered-by');

    app.use(
        helmet({
            // The API serves only JSON plus a couple of tiny HTML pages.
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'none'"],
                    styleSrc: ["'unsafe-inline'"],
                    imgSrc: ["'self'", 'data:'],
                    frameAncestors: ["'none'"],
                },
            },
            crossOriginResourcePolicy: { policy: 'cross-origin' },
        })
    );

    app.use(
        pinoHttp({
            logger,
            genReqId: (req, res) => {
                const existing = req.headers['x-request-id'];
                const id = typeof existing === 'string' ? existing : crypto.randomUUID();
                res.setHeader('x-request-id', id);
                return id;
            },
            // Tracking pixels are high-volume and uninteresting.
            autoLogging: {
                ignore: (req) => req.url?.startsWith('/api/public/open/') ?? false,
            },
            customLogLevel: (_req, res, err) => {
                if (err || res.statusCode >= 500) return 'error';
                if (res.statusCode >= 400) return 'warn';
                return 'info';
            },
        })
    );

    app.use(compression());

    /**
     * Explicit allowlist rather than a single origin string, so Vercel preview
     * deployments work without redeploying the API.
     */
    app.use(
        cors({
            origin: (origin, callback) => {
                // Same-origin, curl and server-to-server requests carry no Origin.
                if (!origin) return callback(null, true);

                const allowed =
                    env.CORS_ORIGINS.includes(origin) ||
                    (!env.IS_PROD && /^http:\/\/localhost:\d+$/.test(origin));

                if (allowed) return callback(null, true);
                logger.warn({ origin }, 'blocked by CORS');
                return callback(new Error('Not allowed by CORS'));
            },
            credentials: true,
            exposedHeaders: ['x-request-id', 'Idempotent-Replay'],
        })
    );

    // Webhook routes need the raw body, so they are mounted before this and
    // opt into their own parser.
    app.use('/api/webhooks', routes);

    app.use(express.json({ limit: '25mb' }));
    app.use(express.urlencoded({ extended: false, limit: '1mb' }));
    app.use(cookieParser());

    // ---- Health ----------------------------------------------------------
    // Mounted BEFORE the rate limiter deliberately. The limiter's store talks
    // to Redis, so putting it first meant a Redis outage hung every request
    // including these — the platform would fail the health check and never
    // route traffic to an instance that was otherwise fine.

    // Liveness: is the process up.
    app.get('/health', (_req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    /**
     * Readiness: are the dependencies actually usable. The previous `/health`
     * returned a static `ok` while Postgres or Redis was down, so the platform
     * kept routing traffic to an instance that could not serve a single request.
     */
    app.get('/ready', async (_req, res) => {
        const [database, redis] = await Promise.all([pingDatabase(), pingRedis()]);
        const ready = database && redis;

        res.status(ready ? 200 : 503).json({
            status: ready ? 'ready' : 'degraded',
            checks: { database, redis },
            timestamp: new Date().toISOString(),
        });
    });

    app.use(globalLimiter);
    app.use('/api', routes);

    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
};
