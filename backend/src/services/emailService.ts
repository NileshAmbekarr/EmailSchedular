import { eq, and, or, gte, desc, asc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/database.js';
import { emails, senders, type Email, type Sender } from '../db/schema.js';
import { emailQueue } from '../queues/emailQueue.js';
import { calculateScheduledTime } from './rateLimitService.js';
import type { ScheduleEmailRequest, EmailJobData } from '../types/index.js';

/**
 * Schedule emails for a list of recipients
 */
export const scheduleEmails = async (
    userId: string,
    request: ScheduleEmailRequest
): Promise<Email[]> => {
    const { senderId, recipients, subject, body, scheduledAt } = request;

    // Get sender details
    const sender = await db.query.senders.findFirst({
        where: and(eq(senders.id, senderId), eq(senders.userId, userId)),
    });

    if (!sender) {
        throw new Error('Sender not found');
    }

    const baseScheduledTime = new Date(scheduledAt);
    const scheduledEmails: Email[] = [];

    // Schedule each email with calculated delay
    for (let i = 0; i < recipients.length; i++) {
        const recipientEmail = recipients[i].trim();
        if (!recipientEmail) continue;

        // Calculate when this email should be sent (considering rate limits)
        const emailScheduledTime = await calculateScheduledTime(senderId, baseScheduledTime, i);

        // Create email record in database
        const [email] = await db.insert(emails).values({
            id: uuidv4(),
            userId,
            senderId,
            recipientEmail,
            subject,
            body,
            scheduledAt: emailScheduledTime,
            status: 'pending',
        }).returning();

        // Calculate delay from now
        const delayMs = Math.max(0, emailScheduledTime.getTime() - Date.now());

        // Create job data
        const jobData: EmailJobData = {
            emailId: email.id,
            recipientEmail,
            subject,
            body,
            senderId,
            senderEmail: sender.email,
            senderName: sender.name,
            smtpUser: sender.smtpUser || undefined,
            smtpPass: sender.smtpPass || undefined,
        };

        // Add to BullMQ queue
        const job = await emailQueue.add('send-email', jobData, {
            delay: delayMs,
            jobId: email.id, // Use email ID for idempotency
        });

        // Update email with job ID
        const jobId = job.id ?? null;
        await db.update(emails)
            .set({ bullmqJobId: jobId, status: 'queued' })
            .where(eq(emails.id, email.id));

        email.bullmqJobId = jobId;
        email.status = 'queued';
        scheduledEmails.push(email);
    }

    console.log(`📅 Scheduled ${scheduledEmails.length} emails for sender ${sender.email}`);

    return scheduledEmails;
};

/**
 * Get all scheduled (pending/queued) emails for a user
 */
export const getScheduledEmails = async (userId: string): Promise<Email[]> => {
    return db.query.emails.findMany({
        where: and(
            eq(emails.userId, userId),
            or(
                eq(emails.status, 'pending'),
                eq(emails.status, 'queued'),
                eq(emails.status, 'processing')
            )
        ),
        orderBy: [asc(emails.scheduledAt)],
        with: {
            sender: true,
        },
    });
};

/**
 * Get all sent emails for a user
 */
export const getSentEmails = async (userId: string): Promise<Email[]> => {
    return db.query.emails.findMany({
        where: and(
            eq(emails.userId, userId),
            or(eq(emails.status, 'sent'), eq(emails.status, 'failed'))
        ),
        orderBy: [desc(emails.sentAt)],
        with: {
            sender: true,
        },
    });
};

/**
 * Recover orphaned jobs on server restart
 * This ensures emails scheduled before a restart are still sent
 */
export const recoverOrphanedJobs = async (): Promise<number> => {
    console.log('🔄 Checking for orphaned email jobs...');

    // Find emails that are pending/queued but might have lost their BullMQ job
    const orphanedEmails = await db.query.emails.findMany({
        where: and(
            or(eq(emails.status, 'pending'), eq(emails.status, 'queued')),
            gte(emails.scheduledAt, new Date()) // Only future emails
        ),
        with: {
            sender: true,
        },
    });

    let recoveredCount = 0;

    for (const email of orphanedEmails) {
        try {
            // Check if job exists in queue
            const existingJob = await emailQueue.getJob(email.id);

            if (!existingJob) {
                // Job is missing, recreate it
                const sender = email.sender as Sender;
                const delayMs = Math.max(0, new Date(email.scheduledAt).getTime() - Date.now());

                const jobData: EmailJobData = {
                    emailId: email.id,
                    recipientEmail: email.recipientEmail,
                    subject: email.subject,
                    body: email.body,
                    senderId: email.senderId,
                    senderEmail: sender.email,
                    senderName: sender.name,
                    smtpUser: sender.smtpUser || undefined,
                    smtpPass: sender.smtpPass || undefined,
                };

                await emailQueue.add('send-email', jobData, {
                    delay: delayMs,
                    jobId: email.id,
                });

                await db.update(emails)
                    .set({ status: 'queued', updatedAt: new Date() })
                    .where(eq(emails.id, email.id));

                console.log(`✅ Recovered job for email ${email.id}`);
                recoveredCount++;
            }
        } catch (error) {
            console.error(`Failed to recover job for email ${email.id}:`, error);
        }
    }

    console.log(`🔄 Recovery complete. Recovered ${recoveredCount} orphaned jobs.`);
    return recoveredCount;
};
