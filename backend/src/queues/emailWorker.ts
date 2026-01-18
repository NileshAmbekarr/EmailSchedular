import { Worker, Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { getRedisConnectionOptions } from '../config/redis.js';
import { db } from '../config/database.js';
import { emails } from '../db/schema.js';
import { env } from '../config/env.js';
import { sendEmail } from '../services/smtpService.js';
import { checkRateLimit, incrementRateLimit } from '../services/rateLimitService.js';
import { emailQueue } from './emailQueue.js';
import type { EmailJobData } from '../types/index.js';

/**
 * Process a single email job
 */
const processEmailJob = async (job: Job<EmailJobData>): Promise<void> => {
    const { emailId, recipientEmail, subject, body, senderId, senderEmail, senderName, smtpUser, smtpPass } = job.data;

    console.log(`📨 Processing job ${job.id} for email ${emailId}`);

    try {
        // Check rate limit before processing
        const rateInfo = await checkRateLimit(senderId);

        if (rateInfo.remaining === 0) {
            // Rate limit exceeded - reschedule to next hour
            const delayMs = rateInfo.resetAt.getTime() - Date.now();
            console.log(`⏳ Rate limit reached for sender ${senderId}, rescheduling in ${delayMs}ms`);

            // Remove this job and add a new one with delay
            await emailQueue.add('send-email', job.data, {
                delay: delayMs,
                jobId: `${emailId}-retry-${Date.now()}`,
            });

            // Update status to pending (will be re-queued)
            await db.update(emails)
                .set({ status: 'pending', updatedAt: new Date() })
                .where(eq(emails.id, emailId));

            return;
        }

        // Update status to processing
        await db.update(emails)
            .set({ status: 'processing', updatedAt: new Date() })
            .where(eq(emails.id, emailId));

        // Increment rate limit counter
        await incrementRateLimit(senderId);

        // Send the email
        const result = await sendEmail({
            from: `"${senderName}" <${senderEmail}>`,
            to: recipientEmail,
            subject,
            html: body,
            smtpUser,
            smtpPass,
        });

        if (result.success) {
            // Update email as sent
            await db.update(emails)
                .set({
                    status: 'sent',
                    sentAt: new Date(),
                    previewUrl: result.previewUrl,
                    updatedAt: new Date(),
                })
                .where(eq(emails.id, emailId));

            console.log(`✅ Email ${emailId} sent successfully`);
        } else {
            throw new Error(result.error || 'Failed to send email');
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ Failed to process email ${emailId}:`, errorMessage);

        // Update email as failed
        await db.update(emails)
            .set({
                status: 'failed',
                errorMessage,
                updatedAt: new Date(),
            })
            .where(eq(emails.id, emailId));

        throw error; // Re-throw for BullMQ retry logic
    }
};

/**
 * Create and start the email worker
 */
export const createEmailWorker = (): Worker<EmailJobData> => {
    const worker = new Worker<EmailJobData>('email-queue', processEmailJob, {
        connection: getRedisConnectionOptions(),
        concurrency: env.WORKER_CONCURRENCY,
        limiter: {
            max: 1,
            duration: env.DELAY_BETWEEN_EMAILS_MS,
        },
    });

    worker.on('completed', (job) => {
        console.log(`✅ Job ${job.id} completed`);
    });

    worker.on('failed', (job, error) => {
        console.error(`❌ Job ${job?.id} failed:`, error.message);
    });

    worker.on('error', (error) => {
        console.error('Worker error:', error);
    });

    console.log(`✅ Email worker started with concurrency: ${env.WORKER_CONCURRENCY}`);
    console.log(`   Delay between emails: ${env.DELAY_BETWEEN_EMAILS_MS}ms`);
    console.log(`   Max emails per hour per sender: ${env.MAX_EMAILS_PER_HOUR_PER_SENDER}`);

    return worker;
};
