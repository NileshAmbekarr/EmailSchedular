import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env } from '../config/env.js';

interface EtherealAccount {
    user: string;
    pass: string;
}

interface SendEmailOptions {
    from: string;
    to: string;
    subject: string;
    html: string;
    smtpUser?: string;
    smtpPass?: string;
}

interface SendEmailResult {
    success: boolean;
    messageId?: string;
    previewUrl?: string;
    error?: string;
}

// Cache for transporters by SMTP credentials
const transporterCache = new Map<string, Transporter>();

/**
 * Create or retrieve a cached Nodemailer transporter
 */
const getTransporter = (smtpUser: string, smtpPass: string): Transporter => {
    const cacheKey = `${smtpUser}:${smtpPass}`;

    if (transporterCache.has(cacheKey)) {
        return transporterCache.get(cacheKey)!;
    }

    const transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: false,
        auth: {
            user: smtpUser,
            pass: smtpPass,
        },
    });

    transporterCache.set(cacheKey, transporter);
    return transporter;
};

/**
 * Create a new Ethereal test account
 * Used when no SMTP credentials are provided
 */
export const createEtherealAccount = async (): Promise<EtherealAccount> => {
    const testAccount = await nodemailer.createTestAccount();
    return {
        user: testAccount.user,
        pass: testAccount.pass,
    };
};

/**
 * Send an email using Ethereal SMTP
 * Returns the preview URL where the email can be viewed
 */
export const sendEmail = async (options: SendEmailOptions): Promise<SendEmailResult> => {
    try {
        // Use provided credentials or fall back to env
        const smtpUser = options.smtpUser || env.SMTP_USER;
        const smtpPass = options.smtpPass || env.SMTP_PASS;

        if (!smtpUser || !smtpPass) {
            throw new Error('SMTP credentials not configured');
        }

        const transporter = getTransporter(smtpUser, smtpPass);

        const info = await transporter.sendMail({
            from: options.from,
            to: options.to,
            subject: options.subject,
            html: options.html,
        });

        // Get Ethereal preview URL
        const previewUrl = nodemailer.getTestMessageUrl(info);

        console.log(`📧 Email sent to ${options.to}`);
        console.log(`   Preview: ${previewUrl}`);

        return {
            success: true,
            messageId: info.messageId,
            previewUrl: previewUrl ? String(previewUrl) : undefined,
        };
    } catch (error) {
        console.error('Failed to send email:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
};

/**
 * Verify SMTP connection
 */
export const verifySmtpConnection = async (smtpUser: string, smtpPass: string): Promise<boolean> => {
    try {
        const transporter = getTransporter(smtpUser, smtpPass);
        await transporter.verify();
        return true;
    } catch {
        return false;
    }
};
