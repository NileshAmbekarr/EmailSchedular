import { env } from '../config/env.js';
import { signPayload, verifyPayload } from './cryptoService.js';

/**
 * Everything legally or operationally required to sit on an outbound bulk
 * message: a working unsubscribe path, sender identification, and the headers
 * mailbox providers look for.
 *
 * CAN-SPAM, GDPR and CASL all require a functioning opt-out; Gmail and Yahoo
 * additionally require one-click unsubscribe headers for bulk senders. Missing
 * any of it is both a legal problem and a deliverability one.
 */

export interface LinkContext {
    emailId: string;
    userId: string;
    campaignId?: string | null;
}

// ---------------------------------------------------------------------------
// Signed links
// ---------------------------------------------------------------------------

/** Recipient-specific, tamper-evident, and valid without a session. */
export const buildUnsubscribeToken = (ctx: LinkContext): string =>
    signPayload({ e: ctx.emailId, u: ctx.userId, c: ctx.campaignId ?? null, t: 'unsub' });

export const verifyUnsubscribeToken = (
    token: string
): { emailId: string; userId: string; campaignId: string | null } | null => {
    const payload = verifyPayload<{ e: string; u: string; c: string | null; t: string }>(token);
    if (!payload || payload.t !== 'unsub') return null;
    return { emailId: payload.e, userId: payload.u, campaignId: payload.c };
};

export const buildUnsubscribeUrl = (ctx: LinkContext): string =>
    `${env.API_URL}/api/public/unsubscribe/${buildUnsubscribeToken(ctx)}`;

export const buildOpenPixelUrl = (ctx: LinkContext): string => {
    const token = signPayload({ e: ctx.emailId, t: 'open' });
    return `${env.API_URL}/api/public/open/${token}.gif`;
};

export const buildClickUrl = (ctx: LinkContext, target: string): string => {
    const token = signPayload({ e: ctx.emailId, t: 'click', d: target });
    return `${env.API_URL}/api/public/click/${token}`;
};

export const verifyOpenToken = (token: string): { emailId: string } | null => {
    const payload = verifyPayload<{ e: string; t: string }>(token);
    if (!payload || payload.t !== 'open') return null;
    return { emailId: payload.e };
};

export const verifyClickToken = (token: string): { emailId: string; target: string } | null => {
    const payload = verifyPayload<{ e: string; t: string; d: string }>(token);
    if (!payload || payload.t !== 'click') return null;
    return { emailId: payload.e, target: payload.d };
};

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

/**
 * `List-Unsubscribe` plus `List-Unsubscribe-Post` is what enables the native
 * "Unsubscribe" button in Gmail and Apple Mail. Offering it measurably reduces
 * spam complaints, because the alternative users reach for is "Report spam".
 */
export const buildComplianceHeaders = (
    ctx: LinkContext,
    replyToEmail?: string
): Record<string, string> => {
    const url = buildUnsubscribeUrl(ctx);
    const mailto = replyToEmail ? `, <mailto:${replyToEmail}?subject=unsubscribe>` : '';

    return {
        'List-Unsubscribe': `<${url}>${mailto}`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        // Marks the message as bulk so vacation responders stay quiet.
        Precedence: 'bulk',
        'Auto-Submitted': 'auto-generated',
    };
};

// ---------------------------------------------------------------------------
// Body decoration
// ---------------------------------------------------------------------------

export interface FooterOptions {
    unsubscribeUrl: string;
    companyName?: string | null;
    postalAddress?: string | null;
    senderName: string;
}

/**
 * Visible unsubscribe link and physical address. The header alone is not
 * sufficient — CAN-SPAM requires a conspicuous opt-out in the message body and
 * a valid postal address.
 */
export const buildFooter = (opts: FooterOptions): string => {
    const org = opts.companyName || opts.senderName;
    const address = opts.postalAddress
        ? `<div style="margin-bottom:8px;">${escapeText(opts.postalAddress)}</div>`
        : '';

    return `
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e9ecef;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#6c757d;">
  <div style="margin-bottom:8px;">You received this email because you subscribed to updates from ${escapeText(org)}.</div>
  ${address}
  <div><a href="${opts.unsubscribeUrl}" style="color:#6c757d;text-decoration:underline;">Unsubscribe</a> from these emails.</div>
</div>`.trim();
};

const escapeText = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 1×1 transparent GIF request; fires when the client loads remote images. */
export const buildTrackingPixel = (ctx: LinkContext): string =>
    `<img src="${buildOpenPixelUrl(ctx)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;" />`;

const HREF_PATTERN = /(<a\b[^>]*\bhref=)(["'])(https?:\/\/[^"']+)\2/gi;

/**
 * Rewrites outbound links through the click redirector.
 *
 * Deliberately skips the unsubscribe link — routing an opt-out through click
 * tracking would record a "click" for someone leaving, and some clients
 * pre-fetch it.
 */
export const rewriteLinksForTracking = (html: string, ctx: LinkContext): string =>
    html.replace(HREF_PATTERN, (full, prefix, quote, url) => {
        if (url.includes('/api/public/unsubscribe/')) return full;
        return `${prefix}${quote}${buildClickUrl(ctx, url)}${quote}`;
    });

/** A 1×1 transparent GIF, served by the open-tracking endpoint. */
export const TRANSPARENT_GIF = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
);

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export interface DecorateOptions extends FooterOptions {
    trackOpens: boolean;
    trackClicks: boolean;
    ctx: LinkContext;
}

/** Applies tracking and the compliance footer, in the order that keeps both valid. */
export const decorateBody = (html: string, opts: DecorateOptions): string => {
    let output = html;

    // Rewrite links before the footer is appended so the unsubscribe link,
    // which is added last, is never rewritten.
    if (opts.trackClicks) {
        output = rewriteLinksForTracking(output, opts.ctx);
    }

    output += buildFooter(opts);

    if (opts.trackOpens) {
        output += buildTrackingPixel(opts.ctx);
    }

    return output;
};
