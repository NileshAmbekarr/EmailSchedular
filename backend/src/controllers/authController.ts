import type { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import bcrypt from 'bcryptjs';
import { and, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../config/database.js';
import { senders, users, type User } from '../db/schema.js';
import { env } from '../config/env.js';
import { log } from '../config/logger.js';
import { generateToken, requireUser } from '../middleware/auth.js';
import { HttpError } from '../middleware/errorHandler.js';
import { createEtherealAccount } from '../providers/index.js';
import { encrypt, randomToken, sha256 } from '../services/cryptoService.js';
import {
    emailSchema,
    passwordSchema,
    timezoneSchema,
} from '../middleware/validate.js';

const logger = log('auth-controller');
const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

const BCRYPT_ROUNDS = 12;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const registerSchema = z.object({
    email: emailSchema,
    password: passwordSchema,
    name: z.string().trim().min(1, 'Name is required').max(255),
    timezone: timezoneSchema.optional(),
});

export const loginSchema = z.object({
    email: emailSchema,
    password: z.string().min(1, 'Password is required'),
});

export const googleSchema = z.object({
    credential: z.string().min(1),
});

export const updateProfileSchema = z.object({
    name: z.string().trim().min(1).max(255).optional(),
    timezone: timezoneSchema.optional(),
    companyName: z.string().trim().max(255).optional(),
    postalAddress: z.string().trim().max(500).optional(),
});

export const requestResetSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
    token: z.string().min(16),
    password: passwordSchema,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The SPA and the API sit on different sites in production (Vercel and Render),
 * so the cookie must be `SameSite=None; Secure` to be sent at all. The previous
 * `lax` cookie was silently dropped on every cross-site request, which is why
 * the app fell back to a `localStorage` copy of the token — and that copy
 * defeated the point of `httpOnly`, since any XSS could read it.
 */
const setSessionCookie = (res: Response, token: string): void => {
    res.cookie('token', token, {
        httpOnly: true,
        secure: env.IS_PROD,
        sameSite: env.IS_PROD ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
    });
};

const publicUser = (user: User) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatar,
    timezone: user.timezone,
    emailVerified: user.emailVerified,
    companyName: user.companyName,
    postalAddress: user.postalAddress,
});

/**
 * Every new account gets a working sender backed by a throwaway Ethereal
 * mailbox, so the whole pipeline can be exercised before anyone owns a
 * verified domain.
 */
const createDefaultSender = async (userId: string, name: string): Promise<void> => {
    const account = await createEtherealAccount();
    await db.insert(senders).values({
        userId,
        email: account.user,
        name,
        provider: 'ethereal',
        smtpHost: account.host,
        smtpPort: account.port,
        smtpUser: account.user,
        smtpPassEncrypted: encrypt(account.pass),
        isDefault: true,
    });
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const register = async (req: Request, res: Response): Promise<void> => {
    const { email, password, name, timezone } = req.body as z.infer<typeof registerSchema>;

    const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (existing) {
        throw new HttpError(409, 'An account with this email already exists');
    }

    const [user] = await db
        .insert(users)
        .values({
            email,
            name,
            password: await bcrypt.hash(password, BCRYPT_ROUNDS),
            timezone: timezone ?? 'UTC',
            emailVerified: false,
            verificationToken: randomToken(),
            verificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .returning();

    await createDefaultSender(user.id, name);

    const token = generateToken(user);
    setSessionCookie(res, token);

    logger.info({ userId: user.id }, 'user registered');
    res.status(201).json({ success: true, data: { user: publicUser(user), token } });
};

export const login = async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;

    const user = await db.query.users.findFirst({ where: eq(users.email, email) });

    // Compare against a dummy hash when the account does not exist so the
    // response time does not reveal which emails are registered.
    const hash = user?.password ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
    const valid = await bcrypt.compare(password, hash);

    if (!user || !user.password || !valid) {
        throw new HttpError(401, 'Invalid email or password');
    }

    const token = generateToken(user);
    setSessionCookie(res, token);

    res.json({ success: true, data: { user: publicUser(user), token } });
};

export const googleAuth = async (req: Request, res: Response): Promise<void> => {
    if (!env.GOOGLE_CLIENT_ID) {
        throw new HttpError(501, 'Google sign-in is not configured on this deployment');
    }

    const { credential } = req.body as z.infer<typeof googleSchema>;

    const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload?.email) throw new HttpError(401, 'Google token did not include an email');

    let user = await db.query.users.findFirst({ where: eq(users.googleId, payload.sub) });

    if (!user) {
        const byEmail = await db.query.users.findFirst({
            where: eq(users.email, payload.email.toLowerCase()),
        });

        if (byEmail) {
            [user] = await db
                .update(users)
                .set({
                    googleId: payload.sub,
                    avatar: payload.picture ?? byEmail.avatar,
                    emailVerified: true,
                    updatedAt: new Date(),
                })
                .where(eq(users.id, byEmail.id))
                .returning();
        } else {
            [user] = await db
                .insert(users)
                .values({
                    email: payload.email.toLowerCase(),
                    name: payload.name ?? payload.email,
                    avatar: payload.picture,
                    googleId: payload.sub,
                    emailVerified: true,
                })
                .returning();

            await createDefaultSender(user.id, user.name);
        }
    }

    const token = generateToken(user);
    setSessionCookie(res, token);

    res.json({ success: true, data: { user: publicUser(user), token } });
};

export const getMe = async (req: Request, res: Response): Promise<void> => {
    const { id } = requireUser(req);
    const user = await db.query.users.findFirst({ where: eq(users.id, id) });
    if (!user) throw new HttpError(404, 'User not found');

    res.json({ success: true, data: publicUser(user) });
};

export const updateProfile = async (req: Request, res: Response): Promise<void> => {
    const { id } = requireUser(req);
    const updates = req.body as z.infer<typeof updateProfileSchema>;

    const [user] = await db
        .update(users)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning();

    res.json({ success: true, data: publicUser(user) });
};

export const logout = async (_req: Request, res: Response): Promise<void> => {
    res.clearCookie('token', { path: '/' });
    res.json({ success: true, message: 'Signed out' });
};

/**
 * Invalidates every token issued so far by moving `tokensValidFrom` forward.
 * This is what makes logout meaningful for a stolen token.
 */
export const logoutEverywhere = async (req: Request, res: Response): Promise<void> => {
    const { id } = requireUser(req);

    await db
        .update(users)
        .set({ tokensValidFrom: new Date(), updatedAt: new Date() })
        .where(eq(users.id, id));

    res.clearCookie('token', { path: '/' });
    res.json({ success: true, message: 'Signed out of all sessions' });
};

/**
 * Always reports success. Confirming whether an address is registered turns
 * this endpoint into an account-enumeration oracle.
 */
export const requestPasswordReset = async (req: Request, res: Response): Promise<void> => {
    const { email } = req.body as z.infer<typeof requestResetSchema>;

    const user = await db.query.users.findFirst({ where: eq(users.email, email) });

    if (user) {
        const token = randomToken();
        await db
            .update(users)
            .set({
                resetToken: sha256(token),
                resetExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
                updatedAt: new Date(),
            })
            .where(eq(users.id, user.id));

        // Delivering this email is intentionally out of scope here — it should
        // go through a transactional provider, not the campaign pipeline.
        logger.info(
            { userId: user.id, resetUrl: `${env.FRONTEND_URL}/reset-password?token=${token}` },
            'password reset requested'
        );
    }

    res.json({
        success: true,
        message: 'If an account exists for that address, a reset link has been sent',
    });
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
    const { token, password } = req.body as z.infer<typeof resetPasswordSchema>;

    const user = await db.query.users.findFirst({
        where: and(eq(users.resetToken, sha256(token)), gt(users.resetExpiresAt, new Date())),
    });

    if (!user) throw new HttpError(400, 'This reset link is invalid or has expired');

    await db
        .update(users)
        .set({
            password: await bcrypt.hash(password, BCRYPT_ROUNDS),
            resetToken: null,
            resetExpiresAt: null,
            // Force every existing session to re-authenticate.
            tokensValidFrom: new Date(),
            updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

    logger.info({ userId: user.id }, 'password reset completed');
    res.json({ success: true, message: 'Password updated. Please sign in again.' });
};
