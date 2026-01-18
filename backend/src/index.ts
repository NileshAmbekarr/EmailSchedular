import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';



import { env } from './config/env.js';
import authRoutes from './routes/auth.js';
import emailRoutes from './routes/emails.js';
import { createEmailWorker } from './queues/emailWorker.js';
import { recoverOrphanedJobs } from './services/emailService.js';

const app = express();

// Middleware
app.use(helmet());
app.use(compression());
console.log("CORS origin:", env.FRONTEND_URL);
app.use(cors({
    origin: env.FRONTEND_URL,
    credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/emails', emailRoutes);

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
});

// Start server
const startServer = async () => {
    try {
        // Start the email worker
        createEmailWorker();

        // Recover any orphaned jobs from previous runs
        await recoverOrphanedJobs();

        app.listen(env.PORT, () => {
            console.log(`
🚀 Email Scheduler Backend running!
   
   Port: ${env.PORT}
   Environment: ${env.NODE_ENV}
   Frontend: ${env.FRONTEND_URL}
   
   Rate Limits:
   - Max emails/hour/sender: ${env.MAX_EMAILS_PER_HOUR_PER_SENDER}
   - Delay between emails: ${env.DELAY_BETWEEN_EMAILS_MS}ms
   - Worker concurrency: ${env.WORKER_CONCURRENCY}
`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();
