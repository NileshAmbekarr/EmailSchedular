import { Queue } from 'bullmq';
import { getRedisConnectionOptions } from '../config/redis.js';
import type { EmailJobData } from '../types/index.js';

// Define job names for type safety
type EmailJobName = 'send-email';

// Create the email queue with proper typing
export const emailQueue = new Queue<EmailJobData, void, EmailJobName>('email-queue', {
    connection: getRedisConnectionOptions(),
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 5000,
        },
        removeOnComplete: {
            count: 1000, // Keep last 1000 completed jobs
            age: 24 * 60 * 60, // Keep for 24 hours
        },
        removeOnFail: {
            count: 500, // Keep last 500 failed jobs
        },
    },
});

emailQueue.on('error', (error) => {
    console.error('Queue error:', error);
});

console.log('✅ Email queue initialized');
