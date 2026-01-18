import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '../config/database.js';
import { users } from '../db/schema.js';
import { env } from '../config/env.js';
import type { UserPayload } from '../types/index.js';

// Extend Express Request type
declare global {
    namespace Express {
        interface Request {
            user?: UserPayload;
        }
    }
}

/**
 * Verify JWT token and attach user to request
 */
export const authMiddleware = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        // Get token from cookie or Authorization header
        const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');

        if (!token) {
            res.status(401).json({ success: false, error: 'Authentication required' });
            return;
        }

        // Verify token
        const decoded = jwt.verify(token, env.JWT_SECRET) as UserPayload;

        // Check if user exists
        const user = await db.query.users.findFirst({
            where: eq(users.id, decoded.id),
        });

        if (!user) {
            res.status(401).json({ success: false, error: 'User not found' });
            return;
        }

        // Attach user to request
        req.user = {
            id: user.id,
            email: user.email,
            name: user.name,
        };

        next();
    } catch (error) {
        console.error('Auth error:', error);
        res.status(401).json({ success: false, error: 'Invalid token' });
    }
};

/**
 * Generate JWT token for a user
 */
export const generateToken = (user: UserPayload): string => {
    return jwt.sign(user, env.JWT_SECRET, { expiresIn: '7d' });
};
