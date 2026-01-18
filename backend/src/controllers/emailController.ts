import { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/database.js';
import { senders } from '../db/schema.js';
import { scheduleEmails, getScheduledEmails, getSentEmails } from '../services/emailService.js';
import { checkRateLimit } from '../services/rateLimitService.js';
import { createEtherealAccount } from '../services/smtpService.js';
import type { ScheduleEmailRequest } from '../types/index.js';

/**
 * Schedule new emails
 */
export const scheduleEmailsHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user!.id;
        const request: ScheduleEmailRequest = req.body;

        if (!request.senderId || !request.recipients || !request.subject || !request.body || !request.scheduledAt) {
            res.status(400).json({
                success: false,
                error: 'senderId, recipients, subject, body, and scheduledAt are required'
            });
            return;
        }

        if (!Array.isArray(request.recipients) || request.recipients.length === 0) {
            res.status(400).json({ success: false, error: 'recipients must be a non-empty array' });
            return;
        }

        const scheduledAt = new Date(request.scheduledAt);
        if (isNaN(scheduledAt.getTime())) {
            res.status(400).json({ success: false, error: 'Invalid scheduledAt date' });
            return;
        }

        const emails = await scheduleEmails(userId, request);

        res.json({
            success: true,
            data: {
                count: emails.length,
                emails: emails.map(e => ({
                    id: e.id,
                    recipientEmail: e.recipientEmail,
                    scheduledAt: e.scheduledAt,
                    status: e.status,
                })),
            },
        });
    } catch (error) {
        console.error('Schedule emails error:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to schedule emails'
        });
    }
};

/**
 * Get scheduled emails for current user
 */
export const getScheduledEmailsHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user!.id;
        const emails = await getScheduledEmails(userId);

        res.json({
            success: true,
            data: emails.map(e => ({
                id: e.id,
                recipientEmail: e.recipientEmail,
                subject: e.subject,
                scheduledAt: e.scheduledAt,
                status: e.status,
                sender: (e as any).sender ? {
                    id: (e as any).sender.id,
                    email: (e as any).sender.email,
                    name: (e as any).sender.name,
                } : null,
            })),
        });
    } catch (error) {
        console.error('Get scheduled emails error:', error);
        res.status(500).json({ success: false, error: 'Failed to get scheduled emails' });
    }
};

/**
 * Get sent emails for current user
 */
export const getSentEmailsHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user!.id;
        const emails = await getSentEmails(userId);

        res.json({
            success: true,
            data: emails.map(e => ({
                id: e.id,
                recipientEmail: e.recipientEmail,
                subject: e.subject,
                sentAt: e.sentAt,
                status: e.status,
                previewUrl: e.previewUrl,
                errorMessage: e.errorMessage,
                sender: (e as any).sender ? {
                    id: (e as any).sender.id,
                    email: (e as any).sender.email,
                    name: (e as any).sender.name,
                } : null,
            })),
        });
    } catch (error) {
        console.error('Get sent emails error:', error);
        res.status(500).json({ success: false, error: 'Failed to get sent emails' });
    }
};

/**
 * Get senders for current user
 */
export const getSendersHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user!.id;

        const userSenders = await db.query.senders.findMany({
            where: eq(senders.userId, userId),
        });

        res.json({
            success: true,
            data: userSenders.map(s => ({
                id: s.id,
                email: s.email,
                name: s.name,
            })),
        });
    } catch (error) {
        console.error('Get senders error:', error);
        res.status(500).json({ success: false, error: 'Failed to get senders' });
    }
};

/**
 * Create a new sender
 */
export const createSenderHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user!.id;
        const { name } = req.body;

        if (!name) {
            res.status(400).json({ success: false, error: 'name is required' });
            return;
        }

        // Create Ethereal account for this sender
        const etherealAccount = await createEtherealAccount();

        const [sender] = await db.insert(senders).values({
            id: uuidv4(),
            userId,
            email: etherealAccount.user,
            name,
            smtpUser: etherealAccount.user,
            smtpPass: etherealAccount.pass,
        }).returning();

        res.json({
            success: true,
            data: {
                id: sender.id,
                email: sender.email,
                name: sender.name,
            },
        });
    } catch (error) {
        console.error('Create sender error:', error);
        res.status(500).json({ success: false, error: 'Failed to create sender' });
    }
};

/**
 * Get rate limit info for a sender
 */
export const getRateLimitHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const { senderId } = req.params;

        if (!senderId) {
            res.status(400).json({ success: false, error: 'senderId is required' });
            return;
        }

        const rateInfo = await checkRateLimit(senderId);

        res.json({
            success: true,
            data: rateInfo,
        });
    } catch (error) {
        console.error('Get rate limit error:', error);
        res.status(500).json({ success: false, error: 'Failed to get rate limit info' });
    }
};
