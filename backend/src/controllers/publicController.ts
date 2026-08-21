import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../config/database.js';
import { emails } from '../db/schema.js';
import { env } from '../config/env.js';
import { log } from '../config/logger.js';
import {
    TRANSPARENT_GIF,
    verifyClickToken,
    verifyOpenToken,
    verifyUnsubscribeToken,
} from '../services/complianceService.js';
import { suppress } from '../services/suppressionService.js';
import {
    applyEvent,
    normalizeResendEvent,
    normalizeSesEvent,
    recordLocalEvent,
    verifyResendSignature,
} from '../services/webhookService.js';

const logger = log('public');

/**
 * Unauthenticated endpoints reached from inside delivered email: unsubscribe,
 * open tracking, click tracking, and provider webhooks. Every one of them is
 * authorised by a signature rather than a session.
 */

// ---------------------------------------------------------------------------
// Unsubscribe
// ---------------------------------------------------------------------------

const unsubscribePage = (message: string, detail: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${message}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;
       color:#212529;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{background:#fff;border:1px solid #e9ecef;border-radius:12px;padding:40px;max-width:440px;
        text-align:center;box-shadow:0 4px 6px rgba(0,0,0,.05)}
  h1{font-size:20px;margin:0 0 8px}
  p{color:#6c757d;font-size:14px;line-height:1.6;margin:0}
  .mark{width:44px;height:44px;border-radius:50%;background:#22c55e1a;color:#22c55e;
        display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:22px}
</style></head>
<body><div class="card"><div class="mark">✓</div><h1>${message}</h1><p>${detail}</p></div></body></html>`;

/**
 * `List-Unsubscribe-Post` makes mailbox providers send a POST here when the
 * user clicks their native unsubscribe button, so both verbs must work. GET is
 * the human-visible path.
 */
export const unsubscribe = async (req: Request, res: Response): Promise<void> => {
    const payload = verifyUnsubscribeToken(req.params.token);

    if (!payload) {
        res.status(400).send(
            unsubscribePage('Invalid link', 'This unsubscribe link is not valid or has expired.')
        );
        return;
    }

    const email = await db.query.emails.findFirst({ where: eq(emails.id, payload.emailId) });
    const recipient = email?.recipientEmail;

    if (recipient) {
        await suppress(payload.userId, recipient, 'unsubscribed', 'One-click unsubscribe');
        await recordLocalEvent(payload.emailId, 'unsubscribed');
        logger.info({ campaignId: payload.campaignId }, 'recipient unsubscribed');
    }

    // Providers expect a bare 200 for the one-click POST.
    if (req.method === 'POST') {
        res.status(200).json({ success: true });
        return;
    }

    res.status(200).send(
        unsubscribePage(
            'You have been unsubscribed',
            recipient
                ? `${recipient} will no longer receive these emails.`
                : 'You will no longer receive these emails.'
        )
    );
};

// ---------------------------------------------------------------------------
// Open / click tracking
// ---------------------------------------------------------------------------

export const trackOpen = async (req: Request, res: Response): Promise<void> => {
    const token = req.params.token.replace(/\.gif$/, '');
    const payload = verifyOpenToken(token);

    if (payload) {
        // Never let tracking failures delay or break image loading.
        void recordLocalEvent(payload.emailId, 'opened', {
            userAgent: req.headers['user-agent'],
        }).catch((err) => logger.warn({ err }, 'failed to record open'));
    }

    res.set({
        'Content-Type': 'image/gif',
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        Pragma: 'no-cache',
    });
    res.send(TRANSPARENT_GIF);
};

export const trackClick = async (req: Request, res: Response): Promise<void> => {
    const payload = verifyClickToken(req.params.token);

    if (!payload) {
        res.redirect(302, env.FRONTEND_URL);
        return;
    }

    void recordLocalEvent(payload.emailId, 'clicked', {
        url: payload.target,
        userAgent: req.headers['user-agent'],
    }).catch((err) => logger.warn({ err }, 'failed to record click'));

    // The target came out of a signed token, so it cannot have been tampered
    // with — but restrict the scheme anyway to avoid becoming a javascript:
    // redirector if a signing key ever leaks.
    let destination = env.FRONTEND_URL;
    try {
        const url = new URL(payload.target);
        if (url.protocol === 'http:' || url.protocol === 'https:') destination = url.toString();
    } catch {
        // fall through to the default
    }

    res.redirect(302, destination);
};

// ---------------------------------------------------------------------------
// Provider webhooks
// ---------------------------------------------------------------------------

/**
 * Resend delivery events. The raw body is required for signature verification,
 * so this route is mounted with `express.raw`.
 */
export const resendWebhook = async (req: Request, res: Response): Promise<void> => {
    const rawBody = req.body as Buffer;

    if (!verifyResendSignature(rawBody, req.headers)) {
        logger.warn('rejected Resend webhook with an invalid signature');
        res.status(401).json({ success: false, error: 'Invalid signature' });
        return;
    }

    let payload: Record<string, unknown>;
    try {
        payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
        res.status(400).json({ success: false, error: 'Malformed JSON' });
        return;
    }

    const event = normalizeResendEvent(payload);
    if (event) await applyEvent(event);

    // Always 200 on a well-formed, authentic event — a non-2xx makes the
    // provider retry, and retries of an event we simply do not model are noise.
    res.json({ success: true });
};

/**
 * SES events arrive via SNS. Subscription confirmations must be handled or the
 * topic never starts delivering.
 */
export const sesWebhook = async (req: Request, res: Response): Promise<void> => {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    if (body.Type === 'SubscriptionConfirmation') {
        logger.info({ subscribeUrl: body.SubscribeURL }, 'SNS subscription confirmation received');
        res.json({ success: true, message: 'Confirm the subscription using the logged URL' });
        return;
    }

    if (body.Type !== 'Notification') {
        res.json({ success: true });
        return;
    }

    let message: Record<string, unknown>;
    try {
        message = JSON.parse(body.Message);
    } catch {
        res.status(400).json({ success: false, error: 'Malformed SNS message' });
        return;
    }

    const event = normalizeSesEvent(message);
    if (event) await applyEvent(event);

    res.json({ success: true });
};
