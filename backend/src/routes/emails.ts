import { Router } from 'express';
import {
    scheduleEmailsHandler,
    getScheduledEmailsHandler,
    getSentEmailsHandler,
    getSendersHandler,
    createSenderHandler,
    getRateLimitHandler,
} from '../controllers/emailController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// All email routes require authentication
router.use(authMiddleware);

// Email scheduling
router.post('/schedule', scheduleEmailsHandler);
router.get('/scheduled', getScheduledEmailsHandler);
router.get('/sent', getSentEmailsHandler);

// Senders
router.get('/senders', getSendersHandler);
router.post('/senders', createSenderHandler);

// Rate limiting info
router.get('/rate-limit/:senderId', getRateLimitHandler);

export default router;
