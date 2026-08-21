import { describe, expect, it } from 'vitest';
import {
    buildComplianceHeaders,
    buildFooter,
    buildUnsubscribeToken,
    decorateBody,
    rewriteLinksForTracking,
    verifyClickToken,
    verifyOpenToken,
    verifyUnsubscribeToken,
    buildClickUrl,
    buildOpenPixelUrl,
} from '../src/services/complianceService.js';
import { decrypt, encrypt, generateApiKey, sha256 } from '../src/services/cryptoService.js';

const ctx = {
    emailId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    campaignId: '33333333-3333-4333-8333-333333333333',
};

describe('signed link tokens', () => {
    it('round-trips an unsubscribe token', () => {
        const token = buildUnsubscribeToken(ctx);
        expect(verifyUnsubscribeToken(token)).toEqual({
            emailId: ctx.emailId,
            userId: ctx.userId,
            campaignId: ctx.campaignId,
        });
    });

    it('rejects a tampered token', () => {
        const token = buildUnsubscribeToken(ctx);
        const [payload, signature] = token.split('.');
        const forged = `${Buffer.from(
            JSON.stringify({ e: 'other', u: 'attacker', c: null, t: 'unsub' })
        ).toString('base64url')}.${signature}`;

        expect(verifyUnsubscribeToken(forged)).toBeNull();
        expect(payload).toBeTruthy();
    });

    it('rejects a token with no signature', () => {
        expect(verifyUnsubscribeToken('justpayload')).toBeNull();
    });

    it('does not accept an open token on the unsubscribe endpoint', () => {
        // Token types are namespaced so one link cannot be replayed as another.
        const openToken = buildOpenPixelUrl(ctx).split('/').pop()!.replace('.gif', '');
        expect(verifyUnsubscribeToken(openToken)).toBeNull();
        expect(verifyOpenToken(openToken)).toEqual({ emailId: ctx.emailId });
    });

    it('carries the click destination inside the signature', () => {
        const url = buildClickUrl(ctx, 'https://example.com/pricing');
        const token = url.split('/').pop()!;

        expect(verifyClickToken(token)).toEqual({
            emailId: ctx.emailId,
            target: 'https://example.com/pricing',
        });
    });
});

describe('compliance headers', () => {
    it('includes one-click unsubscribe headers', () => {
        const headers = buildComplianceHeaders(ctx);

        expect(headers['List-Unsubscribe']).toMatch(/^<http/);
        expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
        expect(headers.Precedence).toBe('bulk');
    });

    it('adds a mailto fallback when a reply-to exists', () => {
        const headers = buildComplianceHeaders(ctx, 'hello@example.com');
        expect(headers['List-Unsubscribe']).toContain('mailto:hello@example.com');
    });
});

describe('footer', () => {
    it('names the organisation and links to unsubscribe', () => {
        const footer = buildFooter({
            unsubscribeUrl: 'https://api.test/unsub/abc',
            companyName: 'Acme Inc',
            postalAddress: '1 Example Way, London',
            senderName: 'Ada',
        });

        expect(footer).toContain('Acme Inc');
        expect(footer).toContain('1 Example Way, London');
        expect(footer).toContain('https://api.test/unsub/abc');
        expect(footer).toContain('Unsubscribe');
    });

    it('escapes organisation details', () => {
        const footer = buildFooter({
            unsubscribeUrl: '#',
            companyName: '<script>alert(1)</script>',
            senderName: 'Ada',
        });

        expect(footer).not.toContain('<script>');
    });
});

describe('link tracking', () => {
    it('rewrites outbound links through the redirector', () => {
        const html = '<a href="https://example.com/pricing">Pricing</a>';
        const output = rewriteLinksForTracking(html, ctx);

        expect(output).toContain('/api/public/click/');
        expect(output).not.toContain('href="https://example.com/pricing"');
    });

    it('leaves the unsubscribe link alone', () => {
        // Routing an opt-out through click tracking would record a "click" for
        // someone leaving, and some clients pre-fetch it.
        const html = '<a href="https://api.test/api/public/unsubscribe/xyz">Unsubscribe</a>';
        expect(rewriteLinksForTracking(html, ctx)).toBe(html);
    });

    it('ignores non-http schemes', () => {
        const html = '<a href="mailto:hi@example.com">Mail us</a>';
        expect(rewriteLinksForTracking(html, ctx)).toBe(html);
    });
});

describe('decorateBody', () => {
    it('appends the footer and the tracking pixel', () => {
        const output = decorateBody('<p>Hello</p>', {
            ctx,
            trackOpens: true,
            trackClicks: true,
            unsubscribeUrl: 'https://api.test/unsub/abc',
            senderName: 'Ada',
            companyName: 'Acme',
            postalAddress: null,
        });

        expect(output).toContain('<p>Hello</p>');
        expect(output).toContain('Unsubscribe');
        expect(output).toContain('/api/public/open/');
    });

    it('omits the pixel when open tracking is off', () => {
        const output = decorateBody('<p>Hello</p>', {
            ctx,
            trackOpens: false,
            trackClicks: false,
            unsubscribeUrl: 'https://api.test/unsub/abc',
            senderName: 'Ada',
            companyName: null,
            postalAddress: null,
        });

        expect(output).not.toContain('/api/public/open/');
    });

    it('always includes an unsubscribe link, even with tracking disabled', () => {
        const output = decorateBody('<p>Hello</p>', {
            ctx,
            trackOpens: false,
            trackClicks: false,
            unsubscribeUrl: 'https://api.test/unsub/abc',
            senderName: 'Ada',
            companyName: null,
            postalAddress: null,
        });

        expect(output).toContain('https://api.test/unsub/abc');
    });
});

describe('encryption', () => {
    it('round-trips a secret', () => {
        const secret = 'super-secret-smtp-password';
        expect(decrypt(encrypt(secret))).toBe(secret);
    });

    it('produces a different ciphertext each time', () => {
        // A fresh nonce per encryption; identical passwords must not collide.
        expect(encrypt('same')).not.toBe(encrypt('same'));
    });

    it('rejects tampered ciphertext', () => {
        const payload = encrypt('secret');
        const parts = payload.split(':');
        parts[3] = Buffer.from('tampered').toString('base64');

        expect(() => decrypt(parts.join(':'))).toThrow();
    });

    it('rejects a malformed payload', () => {
        expect(() => decrypt('not-a-ciphertext')).toThrow('Malformed ciphertext');
    });
});

describe('api keys', () => {
    it('stores only a hash of the key', () => {
        const { key, hash, prefix } = generateApiKey();

        expect(key.startsWith('esk_')).toBe(true);
        expect(hash).toBe(sha256(key));
        expect(hash).not.toContain(key);
        expect(key.startsWith(prefix)).toBe(true);
    });
});
