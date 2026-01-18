import { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/database.js';
import { users, senders } from '../db/schema.js';
import { env } from '../config/env.js';
import { generateToken } from '../middleware/auth.js';
import { createEtherealAccount } from '../services/smtpService.js';
import type { GoogleUserInfo } from '../types/index.js';

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

/**
 * Google OAuth login/signup
 */
export const googleAuth = async (req: Request, res: Response): Promise<void> => {
    try {
        const { credential } = req.body;

        if (!credential) {
            res.status(400).json({ success: false, error: 'Credential is required' });
            return;
        }

        // Verify the Google token
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        if (!payload) {
            res.status(400).json({ success: false, error: 'Invalid token payload' });
            return;
        }

        const googleUser: GoogleUserInfo = {
            id: payload.sub,
            email: payload.email!,
            name: payload.name || payload.email!,
            picture: payload.picture,
        };

        // Check if user exists
        let user = await db.query.users.findFirst({
            where: eq(users.googleId, googleUser.id),
        });

        if (!user) {
            // Check if email already exists (registered with password)
            const existingUser = await db.query.users.findFirst({
                where: eq(users.email, googleUser.email),
            });

            if (existingUser) {
                // Link Google account to existing user
                [user] = await db.update(users)
                    .set({ googleId: googleUser.id, avatar: googleUser.picture })
                    .where(eq(users.id, existingUser.id))
                    .returning();
            } else {
                // Create new user
                [user] = await db.insert(users).values({
                    id: uuidv4(),
                    email: googleUser.email,
                    name: googleUser.name,
                    avatar: googleUser.picture,
                    googleId: googleUser.id,
                    emailVerified: true, // Google accounts are pre-verified
                }).returning();

                // Create a default sender with Ethereal credentials
                const etherealAccount = await createEtherealAccount();
                await db.insert(senders).values({
                    id: uuidv4(),
                    userId: user.id,
                    email: etherealAccount.user,
                    name: user.name,
                    smtpUser: etherealAccount.user,
                    smtpPass: etherealAccount.pass,
                });
            }
        }

        // Generate JWT
        const token = generateToken({
            id: user.id,
            email: user.email,
            name: user.name,
        });

        // Set cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        });

        res.json({
            success: true,
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    avatar: user.avatar,
                },
                token,
            },
        });
    } catch (error) {
        console.error('Google auth error:', error);
        res.status(500).json({ success: false, error: 'Authentication failed' });
    }
};

/**
 * Email/Password registration
 */
export const register = async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, password, name } = req.body;

        if (!email || !password || !name) {
            res.status(400).json({ success: false, error: 'Email, password, and name are required' });
            return;
        }

        // Check if email already exists
        const existingUser = await db.query.users.findFirst({
            where: eq(users.email, email),
        });

        if (existingUser) {
            res.status(400).json({ success: false, error: 'Email already registered' });
            return;
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const [user] = await db.insert(users).values({
            id: uuidv4(),
            email,
            name,
            password: hashedPassword,
            emailVerified: false,
        }).returning();

        // Create a default sender with Ethereal credentials
        const etherealAccount = await createEtherealAccount();
        await db.insert(senders).values({
            id: uuidv4(),
            userId: user.id,
            email: etherealAccount.user,
            name: user.name,
            smtpUser: etherealAccount.user,
            smtpPass: etherealAccount.pass,
        });

        // Generate JWT
        const token = generateToken({
            id: user.id,
            email: user.email,
            name: user.name,
        });

        res.cookie('token', token, {
            httpOnly: true,
            secure: env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        res.json({
            success: true,
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    avatar: user.avatar,
                },
                token,
            },
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, error: 'Registration failed' });
    }
};

/**
 * Email/Password login
 */
export const login = async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            res.status(400).json({ success: false, error: 'Email and password are required' });
            return;
        }

        // Find user
        const user = await db.query.users.findFirst({
            where: eq(users.email, email),
        });

        if (!user || !user.password) {
            res.status(401).json({ success: false, error: 'Invalid credentials' });
            return;
        }

        // Verify password
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            res.status(401).json({ success: false, error: 'Invalid credentials' });
            return;
        }

        // Generate JWT
        const token = generateToken({
            id: user.id,
            email: user.email,
            name: user.name,
        });

        res.cookie('token', token, {
            httpOnly: true,
            secure: env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        res.json({
            success: true,
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    avatar: user.avatar,
                },
                token,
            },
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, error: 'Login failed' });
    }
};

/**
 * Get current user
 */
export const getMe = async (req: Request, res: Response): Promise<void> => {
    try {
        const user = await db.query.users.findFirst({
            where: eq(users.id, req.user!.id),
        });

        if (!user) {
            res.status(404).json({ success: false, error: 'User not found' });
            return;
        }

        res.json({
            success: true,
            data: {
                id: user.id,
                email: user.email,
                name: user.name,
                avatar: user.avatar,
            },
        });
    } catch (error) {
        console.error('Get me error:', error);
        res.status(500).json({ success: false, error: 'Failed to get user' });
    }
};

/**
 * Logout
 */
export const logout = async (req: Request, res: Response): Promise<void> => {
    res.clearCookie('token');
    res.json({ success: true, message: 'Logged out successfully' });
};
