import dns from 'node:dns/promises';
import { and, eq } from 'drizzle-orm';
import { db } from '../config/database.js';
import { log } from '../config/logger.js';
import { domains, type Domain } from '../db/schema.js';
import { encrypt, generateDkimKeyPair, randomToken } from './cryptoService.js';
import { NotFoundError } from './campaignService.js';

const logger = log('domain');

/**
 * Sending-domain authentication.
 *
 * SPF, DKIM and DMARC are the difference between landing in the inbox and
 * landing in spam — an unauthenticated domain is treated as suspicious by
 * every major provider, and Gmail and Yahoo now reject bulk mail without them
 * outright. Senders are not allowed to use a domain until it verifies.
 */

export interface DnsRecord {
    type: 'TXT' | 'CNAME' | 'MX';
    name: string;
    value: string;
    purpose: 'verification' | 'spf' | 'dkim' | 'dmarc';
    description: string;
}

const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;

export const isValidDomain = (value: string): boolean =>
    DOMAIN_PATTERN.test(value) && value.length <= 253;

/** Registers a domain and generates the DKIM keypair it will sign with. */
export const createDomain = async (userId: string, domainName: string): Promise<Domain> => {
    const normalized = domainName.trim().toLowerCase();
    if (!isValidDomain(normalized)) {
        throw new Error('Not a valid domain name');
    }

    const { publicKey, privateKey } = generateDkimKeyPair();
    const selector = `es${randomToken(4)}`;

    const [domain] = await db
        .insert(domains)
        .values({
            userId,
            domain: normalized,
            dkimSelector: selector,
            dkimPublicKey: publicKey,
            // The private key signs outbound mail; a leak lets anyone forge it.
            dkimPrivateKey: encrypt(privateKey),
            verificationToken: randomToken(16),
        })
        .returning();

    logger.info({ domainId: domain.id, domain: normalized }, 'domain registered');
    return domain;
};

/** The exact DNS records the user must publish. */
export const buildDnsRecords = (domain: Domain): DnsRecord[] => [
    {
        type: 'TXT',
        name: `_emailscheduler.${domain.domain}`,
        value: `es-verification=${domain.verificationToken}`,
        purpose: 'verification',
        description: 'Proves you control this domain.',
    },
    {
        type: 'TXT',
        name: domain.domain,
        value: 'v=spf1 include:amazonses.com ~all',
        purpose: 'spf',
        description:
            'Authorises our servers to send on your behalf. Merge this into an existing SPF record rather than adding a second one — a domain may only have one.',
    },
    {
        type: 'TXT',
        name: `${domain.dkimSelector}._domainkey.${domain.domain}`,
        value: `v=DKIM1; k=rsa; p=${domain.dkimPublicKey}`,
        purpose: 'dkim',
        description: 'Lets receivers cryptographically verify your messages were not altered.',
    },
    {
        type: 'TXT',
        name: `_dmarc.${domain.domain}`,
        value: `v=DMARC1; p=none; rua=mailto:dmarc@${domain.domain}`,
        purpose: 'dmarc',
        description:
            'Tells receivers what to do when authentication fails and where to send reports. Start at p=none and tighten once reports look clean.',
    },
];

const resolveTxt = async (name: string): Promise<string[]> => {
    try {
        const records = await dns.resolveTxt(name);
        // Long TXT values arrive split into 255-byte chunks.
        return records.map((chunks) => chunks.join(''));
    } catch {
        return [];
    }
};

export interface VerificationResult {
    verified: boolean;
    ownership: boolean;
    spf: boolean;
    dkim: boolean;
    dmarc: boolean;
    checkedAt: Date;
}

/**
 * Queries live DNS and records the outcome.
 *
 * Ownership plus DKIM is the minimum bar to send; SPF and DMARC are reported
 * separately so the UI can nudge without blocking.
 */
export const verifyDomain = async (
    userId: string,
    domainId: string
): Promise<VerificationResult> => {
    const domain = await db.query.domains.findFirst({
        where: and(eq(domains.id, domainId), eq(domains.userId, userId)),
    });
    if (!domain) throw new NotFoundError('Domain not found');

    const [verificationTxt, rootTxt, dkimTxt, dmarcTxt] = await Promise.all([
        resolveTxt(`_emailscheduler.${domain.domain}`),
        resolveTxt(domain.domain),
        resolveTxt(`${domain.dkimSelector}._domainkey.${domain.domain}`),
        resolveTxt(`_dmarc.${domain.domain}`),
    ]);

    const ownership = verificationTxt.some((v) =>
        v.includes(`es-verification=${domain.verificationToken}`)
    );
    const spf = rootTxt.some((v) => v.startsWith('v=spf1'));
    const dkim = dkimTxt.some(
        (v) => v.includes('v=DKIM1') && !!domain.dkimPublicKey && v.includes(domain.dkimPublicKey.slice(0, 40))
    );
    const dmarc = dmarcTxt.some((v) => v.startsWith('v=DMARC1'));

    const verified = ownership && dkim;
    const checkedAt = new Date();

    await db
        .update(domains)
        .set({
            status: verified ? 'verified' : 'pending',
            spfVerified: spf,
            dkimVerified: dkim,
            dmarcVerified: dmarc,
            lastCheckedAt: checkedAt,
            verifiedAt: verified ? (domain.verifiedAt ?? checkedAt) : null,
        })
        .where(eq(domains.id, domainId));

    logger.info({ domainId, verified, spf, dkim, dmarc }, 'domain verification checked');

    return { verified, ownership, spf, dkim, dmarc, checkedAt };
};

export const listDomains = async (userId: string): Promise<Domain[]> =>
    db.query.domains.findMany({ where: eq(domains.userId, userId) });

export const getDomain = async (userId: string, domainId: string): Promise<Domain> => {
    const domain = await db.query.domains.findFirst({
        where: and(eq(domains.id, domainId), eq(domains.userId, userId)),
    });
    if (!domain) throw new NotFoundError('Domain not found');
    return domain;
};

export const deleteDomain = async (userId: string, domainId: string): Promise<void> => {
    const deleted = await db
        .delete(domains)
        .where(and(eq(domains.id, domainId), eq(domains.userId, userId)))
        .returning({ id: domains.id });

    if (deleted.length === 0) throw new NotFoundError('Domain not found');
};
