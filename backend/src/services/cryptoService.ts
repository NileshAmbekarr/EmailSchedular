import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Encryption of secrets at rest (SMTP passwords, DKIM private keys) and
 * signed, tamper-evident tokens for unsubscribe / tracking links.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce, the recommended size for GCM
const VERSION = 'v1';

/** Accepts a 64-char hex key, a base64 key, or any passphrase (hashed to 32 bytes). */
const deriveKey = (raw: string): Buffer => {
    if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');

    const b64 = Buffer.from(raw, 'base64');
    if (b64.length === 32) return b64;

    // Fallback: stretch an arbitrary passphrase into 32 bytes.
    return crypto.createHash('sha256').update(raw, 'utf8').digest();
};

const KEY = deriveKey(env.ENCRYPTION_KEY);

/**
 * Encrypts a UTF-8 string.
 * Output: `v1:<iv-b64>:<authTag-b64>:<ciphertext-b64>` — self-describing so the
 * format can be rotated later without ambiguity.
 */
export const encrypt = (plaintext: string): string => {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);

    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
        VERSION,
        iv.toString('base64'),
        authTag.toString('base64'),
        ciphertext.toString('base64'),
    ].join(':');
};

/** Reverses {@link encrypt}. Throws if the payload was tampered with. */
export const decrypt = (payload: string): string => {
    const parts = payload.split(':');
    if (parts.length !== 4 || parts[0] !== VERSION) {
        throw new Error('Malformed ciphertext');
    }

    const [, ivB64, tagB64, dataB64] = parts;
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

    return Buffer.concat([
        decipher.update(Buffer.from(dataB64, 'base64')),
        decipher.final(),
    ]).toString('utf8');
};

/** Convenience wrappers for nullable database columns. */
export const encryptNullable = (value?: string | null): string | null =>
    value ? encrypt(value) : null;

export const decryptNullable = (value?: string | null): string | null => {
    if (!value) return null;
    try {
        return decrypt(value);
    } catch {
        return null;
    }
};

// ---------------------------------------------------------------------------
// Signed link tokens
// ---------------------------------------------------------------------------

const b64url = (buf: Buffer): string => buf.toString('base64url');

/**
 * Builds `<payload>.<signature>` where payload is base64url JSON.
 * Used for unsubscribe and click-tracking links, which must be valid without a
 * session and must not be forgeable across recipients.
 */
export const signPayload = (data: Record<string, unknown>): string => {
    const payload = b64url(Buffer.from(JSON.stringify(data), 'utf8'));
    const signature = crypto
        .createHmac('sha256', env.LINK_SECRET)
        .update(payload)
        .digest('base64url');
    return `${payload}.${signature}`;
};

/** Verifies and decodes a token from {@link signPayload}. Returns null if invalid. */
export const verifyPayload = <T = Record<string, unknown>>(token: string): T | null => {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;

    const expected = crypto
        .createHmac('sha256', env.LINK_SECRET)
        .update(payload)
        .digest('base64url');

    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    try {
        return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T;
    } catch {
        return null;
    }
};

// ---------------------------------------------------------------------------
// Hashing / random tokens
// ---------------------------------------------------------------------------

export const sha256 = (value: string): string =>
    crypto.createHash('sha256').update(value).digest('hex');

export const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('hex');

/** Stable hash of a request body, for idempotency-key conflict detection. */
export const hashRequest = (body: unknown): string => sha256(JSON.stringify(body ?? null));

/**
 * Generates an API key. The plaintext is returned once and never stored;
 * only the hash and a display prefix are persisted.
 */
export const generateApiKey = (): { key: string; hash: string; prefix: string } => {
    const secret = crypto.randomBytes(24).toString('base64url');
    const key = `esk_${env.IS_PROD ? 'live' : 'test'}_${secret}`;
    return { key, hash: sha256(key), prefix: key.slice(0, 16) };
};

/** DKIM keypair for a sending domain. */
export const generateDkimKeyPair = (): { publicKey: string; privateKey: string } => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    return {
        // DNS TXT records carry the base64 body without the PEM armour.
        publicKey: publicKey
            .replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '')
            .replace(/\s/g, ''),
        privateKey,
    };
};
