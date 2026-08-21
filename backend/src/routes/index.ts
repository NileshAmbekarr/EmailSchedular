import { Router, raw, json } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { idempotency } from '../middleware/idempotency.js';
import {
    authLimiter,
    publicLimiter,
    sendLimiter,
    sensitiveLimiter,
} from '../middleware/rateLimit.js';
import {
    idParamSchema,
    paginationSchema,
    validate,
    emailSchema,
} from '../middleware/validate.js';
import * as auth from '../controllers/authController.js';
import * as campaign from '../controllers/campaignController.js';
import * as resource from '../controllers/resourceController.js';
import * as pub from '../controllers/publicController.js';

const router = Router();

// ===========================================================================
// PUBLIC — reached from inside delivered email. No session.
// ===========================================================================

const publicRouter = Router();

publicRouter.get('/unsubscribe/:token', publicLimiter, asyncHandler(pub.unsubscribe));
// Required by List-Unsubscribe-Post for one-click unsubscribe.
publicRouter.post('/unsubscribe/:token', publicLimiter, asyncHandler(pub.unsubscribe));
publicRouter.get('/open/:token', asyncHandler(pub.trackOpen));
publicRouter.get('/click/:token', asyncHandler(pub.trackClick));

router.use('/public', publicRouter);

// ===========================================================================
// WEBHOOKS — authenticated by provider signature, not by session.
// ===========================================================================

const webhookRouter = Router();

// Signature verification needs the exact bytes, so JSON parsing is bypassed.
webhookRouter.post(
    '/resend',
    raw({ type: 'application/json', limit: '1mb' }),
    asyncHandler(pub.resendWebhook)
);
webhookRouter.post(
    '/ses',
    json({ type: ['application/json', 'text/plain'], limit: '1mb' }),
    asyncHandler(pub.sesWebhook)
);

router.use('/webhooks', webhookRouter);

// ===========================================================================
// AUTH
// ===========================================================================

const authRouter = Router();

authRouter.post(
    '/register',
    authLimiter,
    validate({ body: auth.registerSchema }),
    asyncHandler(auth.register)
);
authRouter.post(
    '/login',
    authLimiter,
    validate({ body: auth.loginSchema }),
    asyncHandler(auth.login)
);
authRouter.post(
    '/google',
    authLimiter,
    validate({ body: auth.googleSchema }),
    asyncHandler(auth.googleAuth)
);
authRouter.post(
    '/forgot-password',
    sensitiveLimiter,
    validate({ body: auth.requestResetSchema }),
    asyncHandler(auth.requestPasswordReset)
);
authRouter.post(
    '/reset-password',
    sensitiveLimiter,
    validate({ body: auth.resetPasswordSchema }),
    asyncHandler(auth.resetPassword)
);

authRouter.get('/me', authenticate, asyncHandler(auth.getMe));
authRouter.patch(
    '/me',
    authenticate,
    validate({ body: auth.updateProfileSchema }),
    asyncHandler(auth.updateProfile)
);
authRouter.post('/logout', authenticate, asyncHandler(auth.logout));
authRouter.post('/logout-all', authenticate, asyncHandler(auth.logoutEverywhere));

router.use('/auth', authRouter);

// ===========================================================================
// AUTHENTICATED API
// ===========================================================================

const api = Router();
api.use(authenticate);

// ---- Campaigns ------------------------------------------------------------

api.post(
    '/campaigns',
    sendLimiter,
    validate({ body: campaign.createCampaignSchema }),
    idempotency('POST /campaigns'),
    asyncHandler(campaign.createCampaign)
);
api.get(
    '/campaigns',
    validate({ query: campaign.listCampaignsQuery }),
    asyncHandler(campaign.listCampaigns)
);
api.get(
    '/campaigns/:id',
    validate({ params: idParamSchema }),
    asyncHandler(campaign.getCampaign)
);
api.post(
    '/campaigns/:id/cancel',
    validate({ params: idParamSchema }),
    asyncHandler(campaign.cancelCampaign)
);
api.post(
    '/campaigns/:id/pause',
    validate({ params: idParamSchema }),
    asyncHandler(campaign.pauseCampaign)
);
api.post(
    '/campaigns/:id/resume',
    validate({ params: idParamSchema }),
    asyncHandler(campaign.resumeCampaign)
);
api.patch(
    '/campaigns/:id/schedule',
    validate({ params: idParamSchema, body: campaign.rescheduleSchema }),
    asyncHandler(campaign.rescheduleCampaign)
);

// ---- Messages -------------------------------------------------------------

api.get('/emails', validate({ query: campaign.listEmailsQuery }), asyncHandler(campaign.listEmails));
api.get('/emails/:id', validate({ params: idParamSchema }), asyncHandler(campaign.getEmail));
api.post(
    '/emails/:id/cancel',
    validate({ params: idParamSchema }),
    asyncHandler(campaign.cancelEmail)
);

// ---- Composer -------------------------------------------------------------

api.post('/preview', validate({ body: campaign.previewSchema }), asyncHandler(campaign.preview));
api.post(
    '/test-send',
    sendLimiter,
    validate({ body: campaign.testSendSchema }),
    asyncHandler(campaign.testSend)
);

// ---- Analytics ------------------------------------------------------------

api.get('/stats', asyncHandler(campaign.getStats));
api.get('/queue', asyncHandler(campaign.getQueueHealth));

// ---- Senders --------------------------------------------------------------

api.get('/senders', asyncHandler(resource.listSenders));
api.post(
    '/senders',
    validate({ body: resource.createSenderSchema }),
    asyncHandler(resource.createSender)
);
api.patch(
    '/senders/:id',
    validate({ params: idParamSchema, body: resource.updateSenderSchema }),
    asyncHandler(resource.updateSender)
);
api.delete('/senders/:id', validate({ params: idParamSchema }), asyncHandler(resource.deleteSender));
api.post(
    '/senders/:id/verify',
    validate({ params: idParamSchema }),
    asyncHandler(resource.verifySender)
);
api.get(
    '/senders/:id/rate-limit',
    validate({ params: idParamSchema }),
    asyncHandler(resource.getSenderRateLimit)
);

// ---- Templates ------------------------------------------------------------

api.get('/templates', asyncHandler(resource.listTemplates));
api.post(
    '/templates',
    validate({ body: resource.templateSchema }),
    asyncHandler(resource.createTemplate)
);
api.put(
    '/templates/:id',
    validate({ params: idParamSchema, body: resource.templateSchema }),
    asyncHandler(resource.updateTemplate)
);
api.delete(
    '/templates/:id',
    validate({ params: idParamSchema }),
    asyncHandler(resource.deleteTemplate)
);

// ---- Contact lists --------------------------------------------------------

api.get('/lists', asyncHandler(resource.listContactLists));
api.post(
    '/lists',
    validate({ body: resource.createListSchema }),
    asyncHandler(resource.createContactList)
);
api.get(
    '/lists/:id/contacts',
    validate({ params: idParamSchema, query: paginationSchema }),
    asyncHandler(resource.listContacts)
);
api.post(
    '/lists/:id/contacts',
    validate({ params: idParamSchema, body: resource.addContactsSchema }),
    asyncHandler(resource.addContacts)
);
api.delete(
    '/lists/:id',
    validate({ params: idParamSchema }),
    asyncHandler(resource.deleteContactList)
);

// ---- Suppressions ---------------------------------------------------------

api.get(
    '/suppressions',
    validate({ query: resource.listSuppressionsQuery }),
    asyncHandler(resource.listSuppressions)
);
api.post(
    '/suppressions',
    validate({ body: resource.addSuppressionSchema }),
    asyncHandler(resource.addSuppression)
);
api.delete(
    '/suppressions/:email',
    validate({ params: z.object({ email: emailSchema }) }),
    asyncHandler(resource.removeSuppression)
);

// ---- Domains --------------------------------------------------------------

api.get('/domains', asyncHandler(resource.listDomains));
api.post(
    '/domains',
    validate({ body: resource.createDomainSchema }),
    asyncHandler(resource.createDomain)
);
api.post(
    '/domains/:id/verify',
    validate({ params: idParamSchema }),
    asyncHandler(resource.verifyDomain)
);
api.delete('/domains/:id', validate({ params: idParamSchema }), asyncHandler(resource.deleteDomain));

// ---- API keys -------------------------------------------------------------

api.get('/api-keys', asyncHandler(resource.listApiKeys));
api.post(
    '/api-keys',
    validate({ body: resource.createApiKeySchema }),
    asyncHandler(resource.createApiKey)
);
api.delete(
    '/api-keys/:id',
    validate({ params: idParamSchema }),
    asyncHandler(resource.revokeApiKey)
);

// ---- Misc -----------------------------------------------------------------

api.get('/timezones', asyncHandler(resource.listTimezones));

router.use('/', api);

export default router;
