import {
    pgTable,
    uuid,
    varchar,
    text,
    timestamp,
    boolean,
    integer,
    jsonb,
    pgEnum,
    index,
    uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Lifecycle of a single outbound message.
 *
 *   pending    -> row created, not yet enqueued
 *   queued     -> a BullMQ job exists for it
 *   processing -> a worker has claimed it and is sending
 *   retrying   -> a send attempt failed, BullMQ will try again
 *   sent       -> handed to the provider successfully
 *   delivered  -> provider confirmed delivery via webhook
 *   bounced    -> provider reported a bounce
 *   failed     -> all retry attempts exhausted
 *   cancelled  -> cancelled by the user before sending
 *   suppressed -> skipped because the recipient is on the suppression list
 */
export const emailStatusEnum = pgEnum('email_status', [
    'pending',
    'queued',
    'processing',
    'retrying',
    'sent',
    'delivered',
    'bounced',
    'failed',
    'cancelled',
    'suppressed',
]);

export const campaignStatusEnum = pgEnum('campaign_status', [
    'draft',
    'scheduled',
    'sending',
    'paused',
    'completed',
    'cancelled',
]);

/** Append-only delivery events, mostly sourced from provider webhooks. */
export const emailEventTypeEnum = pgEnum('email_event_type', [
    'queued',
    'sent',
    'delivered',
    'deferred',
    'opened',
    'clicked',
    'bounced',
    'complained',
    'unsubscribed',
    'failed',
]);

export const suppressionReasonEnum = pgEnum('suppression_reason', [
    'unsubscribed',
    'hard_bounce',
    'soft_bounce_threshold',
    'complaint',
    'manual',
    'invalid',
]);

export const domainStatusEnum = pgEnum('domain_status', ['pending', 'verified', 'failed']);

export const providerEnum = pgEnum('email_provider', ['ethereal', 'smtp', 'resend', 'ses']);

// ============================================================================
// USERS
// ============================================================================

export const users = pgTable(
    'users',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        email: varchar('email', { length: 255 }).notNull().unique(),
        name: varchar('name', { length: 255 }).notNull(),
        avatar: varchar('avatar', { length: 500 }),

        // Google OAuth
        googleId: varchar('google_id', { length: 255 }).unique(),

        // Email/password auth
        password: varchar('password', { length: 255 }),
        emailVerified: boolean('email_verified').default(false).notNull(),
        verificationToken: varchar('verification_token', { length: 128 }),
        verificationExpiresAt: timestamp('verification_expires_at', { withTimezone: true }),
        resetToken: varchar('reset_token', { length: 128 }),
        resetExpiresAt: timestamp('reset_expires_at', { withTimezone: true }),

        /** IANA timezone, e.g. "Asia/Kolkata". Drives timezone-aware scheduling. */
        timezone: varchar('timezone', { length: 64 }).default('UTC').notNull(),

        /** Postal address required in the footer of bulk commercial email. */
        companyName: varchar('company_name', { length: 255 }),
        postalAddress: text('postal_address'),

        /** Invalidates every JWT issued before this instant (logout-everywhere). */
        tokensValidFrom: timestamp('tokens_valid_from', { withTimezone: true })
            .defaultNow()
            .notNull(),

        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    },
    (t) => ({
        verificationTokenIdx: index('users_verification_token_idx').on(t.verificationToken),
        resetTokenIdx: index('users_reset_token_idx').on(t.resetToken),
    })
);

// ============================================================================
// DOMAINS — sending domains with SPF/DKIM/DMARC verification
// ============================================================================

export const domains = pgTable(
    'domains',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),

        domain: varchar('domain', { length: 253 }).notNull(),
        status: domainStatusEnum('status').default('pending').notNull(),

        /** Random selector so several apps can sign for the same domain. */
        dkimSelector: varchar('dkim_selector', { length: 63 }).notNull(),
        dkimPublicKey: text('dkim_public_key'),
        /** Encrypted at rest — see services/crypto.ts */
        dkimPrivateKey: text('dkim_private_key'),

        /** Token published as a TXT record to prove ownership. */
        verificationToken: varchar('verification_token', { length: 128 }).notNull(),

        spfVerified: boolean('spf_verified').default(false).notNull(),
        dkimVerified: boolean('dkim_verified').default(false).notNull(),
        dmarcVerified: boolean('dmarc_verified').default(false).notNull(),

        lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
        verifiedAt: timestamp('verified_at', { withTimezone: true }),

        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    },
    (t) => ({
        userDomainUnique: uniqueIndex('domains_user_domain_unique').on(t.userId, t.domain),
    })
);

// ============================================================================
// SENDERS — a sending identity ("Nilesh <hi@acme.com>")
// ============================================================================

export const senders = pgTable(
    'senders',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        domainId: uuid('domain_id').references(() => domains.id, { onDelete: 'set null' }),

        email: varchar('email', { length: 255 }).notNull(),
        name: varchar('name', { length: 255 }).notNull(),
        replyTo: varchar('reply_to', { length: 255 }),

        provider: providerEnum('provider').default('ethereal').notNull(),

        // Custom SMTP (only when provider = 'smtp' or 'ethereal').
        smtpHost: varchar('smtp_host', { length: 255 }),
        smtpPort: integer('smtp_port'),
        smtpUser: varchar('smtp_user', { length: 255 }),
        /** AES-256-GCM ciphertext. Never store plaintext credentials. */
        smtpPassEncrypted: text('smtp_pass_encrypted'),

        /** Per-sender override of the global hourly cap. */
        hourlyLimit: integer('hourly_limit'),
        /** Daily cap used by warmup ramping. */
        dailyLimit: integer('daily_limit'),

        /** Gradually raises the daily cap on a fresh domain. */
        warmupEnabled: boolean('warmup_enabled').default(false).notNull(),
        warmupStartedAt: timestamp('warmup_started_at', { withTimezone: true }),

        isDefault: boolean('is_default').default(false).notNull(),

        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    },
    (t) => ({
        userIdx: index('senders_user_idx').on(t.userId),
    })
);

// ============================================================================
// TEMPLATES — reusable subject/body with {{merge_tags}}
// ============================================================================

export const templates = pgTable(
    'templates',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),

        name: varchar('name', { length: 255 }).notNull(),
        subject: varchar('subject', { length: 500 }).notNull(),
        body: text('body').notNull(),

        /** Merge tags detected in subject+body, cached for the UI. */
        variables: jsonb('variables').$type<string[]>().default([]).notNull(),

        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    },
    (t) => ({
        userIdx: index('templates_user_idx').on(t.userId),
    })
);

// ============================================================================
// CONTACT LISTS — persistent audiences, so a CSV is uploaded once
// ============================================================================

export const contactLists = pgTable(
    'contact_lists',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),

        name: varchar('name', { length: 255 }).notNull(),
        description: text('description'),
        contactCount: integer('contact_count').default(0).notNull(),

        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    },
    (t) => ({
        userIdx: index('contact_lists_user_idx').on(t.userId),
    })
);

export const contacts = pgTable(
    'contacts',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        listId: uuid('list_id')
            .notNull()
            .references(() => contactLists.id, { onDelete: 'cascade' }),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),

        email: varchar('email', { length: 255 }).notNull(),
        /** Every non-email CSV column lands here and becomes a merge tag. */
        fields: jsonb('fields').$type<Record<string, string>>().default({}).notNull(),

        /** Where this contact came from — consent provenance for GDPR. */
        source: varchar('source', { length: 128 }),

        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    },
    (t) => ({
        listEmailUnique: uniqueIndex('contacts_list_email_unique').on(t.listId, t.email),
        userIdx: index('contacts_user_idx').on(t.userId),
    })
);

// ============================================================================
// SUPPRESSIONS — never send to these addresses again
// ============================================================================

export const suppressions = pgTable(
    'suppressions',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),

        email: varchar('email', { length: 255 }).notNull(),
        reason: suppressionReasonEnum('reason').notNull(),
        /** Free-form detail, e.g. the provider's bounce diagnostic code. */
        detail: text('detail'),

        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    },
    (t) => ({
        userEmailUnique: uniqueIndex('suppressions_user_email_unique').on(t.userId, t.email),
    })
);

// ============================================================================
// CAMPAIGNS — one row per send, N emails beneath it
// ============================================================================

export const campaigns = pgTable(
    'campaigns',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        senderId: uuid('sender_id')
            .notNull()
            .references(() => senders.id, { onDelete: 'restrict' }),
        templateId: uuid('template_id').references(() => templates.id, { onDelete: 'set null' }),

        name: varchar('name', { length: 255 }).notNull(),
        /** Body/subject are stored once here, not duplicated per recipient. */
        subject: varchar('subject', { length: 500 }).notNull(),
        body: text('body').notNull(),

        status: campaignStatusEnum('status').default('draft').notNull(),

        scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
        /** IANA zone the user picked the time in. */
        timezone: varchar('timezone', { length: 64 }).default('UTC').notNull(),
        /** Send at scheduledAt's wall-clock time in each recipient's own zone. */
        perRecipientTimezone: boolean('per_recipient_timezone').default(false).notNull(),

        // Throttling overrides (fall back to sender/global config when null).
        delayBetweenEmailsMs: integer('delay_between_emails_ms'),
        maxEmailsPerHour: integer('max_emails_per_hour'),

        trackOpens: boolean('track_opens').default(true).notNull(),
        trackClicks: boolean('track_clicks').default(true).notNull(),

        // Denormalized counters kept current by the worker + webhooks.
        totalRecipients: integer('total_recipients').default(0).notNull(),
        sentCount: integer('sent_count').default(0).notNull(),
        deliveredCount: integer('delivered_count').default(0).notNull(),
        openedCount: integer('opened_count').default(0).notNull(),
        clickedCount: integer('clicked_count').default(0).notNull(),
        bouncedCount: integer('bounced_count').default(0).notNull(),
        complainedCount: integer('complained_count').default(0).notNull(),
        failedCount: integer('failed_count').default(0).notNull(),

        startedAt: timestamp('started_at', { withTimezone: true }),
        completedAt: timestamp('completed_at', { withTimezone: true }),

        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    },
    (t) => ({
        userStatusIdx: index('campaigns_user_status_idx').on(t.userId, t.status),
        scheduledIdx: index('campaigns_scheduled_idx').on(t.scheduledAt),
    })
);

// ============================================================================
// EMAILS — one row per recipient
// ============================================================================

export const emails = pgTable(
    'emails',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }),
        senderId: uuid('sender_id')
            .notNull()
            .references(() => senders.id, { onDelete: 'restrict' }),

        recipientEmail: varchar('recipient_email', { length: 255 }).notNull(),
        /** Merge-tag values for this recipient; rendered at send time. */
        mergeData: jsonb('merge_data').$type<Record<string, string>>().default({}).notNull(),

        /**
         * Snapshot of the rendered subject, written at send time. The template
         * lives on the campaign; this is what actually went out.
         */
        renderedSubject: varchar('rendered_subject', { length: 500 }),

        scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
        sentAt: timestamp('sent_at', { withTimezone: true }),

        status: emailStatusEnum('status').default('pending').notNull(),
        attemptCount: integer('attempt_count').default(0).notNull(),

        bullmqJobId: varchar('bullmq_job_id', { length: 255 }),
        /** Provider-side id, used to correlate webhook events back to this row. */
        providerMessageId: varchar('provider_message_id', { length: 512 }),
        errorMessage: text('error_message'),
        previewUrl: varchar('preview_url', { length: 500 }),

        /** HMAC token embedded in the unsubscribe link for this recipient. */
        unsubscribeToken: varchar('unsubscribe_token', { length: 128 }),

        openedAt: timestamp('opened_at', { withTimezone: true }),
        clickedAt: timestamp('clicked_at', { withTimezone: true }),

        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    },
    (t) => ({
        // Drives the dashboard's scheduled/sent queries.
        userStatusScheduledIdx: index('emails_user_status_scheduled_idx').on(
            t.userId,
            t.status,
            t.scheduledAt
        ),
        campaignIdx: index('emails_campaign_idx').on(t.campaignId),
        // Drives restart recovery (status + scheduled_at scan).
        statusScheduledIdx: index('emails_status_scheduled_idx').on(t.status, t.scheduledAt),
        // Webhook lookups by provider message id.
        providerMessageIdx: index('emails_provider_message_idx').on(t.providerMessageId),
        senderIdx: index('emails_sender_status_idx').on(t.senderId, t.status),
        unsubscribeTokenIdx: index('emails_unsubscribe_token_idx').on(t.unsubscribeToken),
    })
);

// ============================================================================
// EMAIL EVENTS — append-only delivery timeline
// ============================================================================

export const emailEvents = pgTable(
    'email_events',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        emailId: uuid('email_id')
            .notNull()
            .references(() => emails.id, { onDelete: 'cascade' }),
        campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }),

        type: emailEventTypeEnum('type').notNull(),
        /** Raw provider payload, kept for debugging and replay. */
        payload: jsonb('payload').$type<Record<string, unknown>>(),

        /** Deduplicates webhook retries: provider event id when available. */
        providerEventId: varchar('provider_event_id', { length: 255 }),

        occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    },
    (t) => ({
        emailIdx: index('email_events_email_idx').on(t.emailId),
        campaignTypeIdx: index('email_events_campaign_type_idx').on(t.campaignId, t.type),
        providerEventUnique: uniqueIndex('email_events_provider_event_unique').on(
            t.providerEventId
        ),
    })
);

// ============================================================================
// API KEYS — programmatic access
// ============================================================================

export const apiKeys = pgTable(
    'api_keys',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),

        name: varchar('name', { length: 255 }).notNull(),
        /** SHA-256 of the key. The plaintext is shown once at creation. */
        keyHash: varchar('key_hash', { length: 64 }).notNull().unique(),
        /** e.g. "esk_live_a1b2" — enough to recognise it in a list. */
        keyPrefix: varchar('key_prefix', { length: 16 }).notNull(),

        lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
        revokedAt: timestamp('revoked_at', { withTimezone: true }),

        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    },
    (t) => ({
        userIdx: index('api_keys_user_idx').on(t.userId),
    })
);

// ============================================================================
// IDEMPOTENCY KEYS — safe retries of mutating requests
// ============================================================================

export const idempotencyKeys = pgTable(
    'idempotency_keys',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),

        key: varchar('key', { length: 255 }).notNull(),
        endpoint: varchar('endpoint', { length: 255 }).notNull(),
        /** Hash of the request body — a reused key with a different body is an error. */
        requestHash: varchar('request_hash', { length: 64 }).notNull(),
        /** Stored response, replayed verbatim on a duplicate request. */
        responseBody: jsonb('response_body').$type<Record<string, unknown>>(),
        statusCode: integer('status_code'),

        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        expiresAt: timestamp('expires_at', { withTimezone: true })
            .default(sql`now() + interval '24 hours'`)
            .notNull(),
    },
    (t) => ({
        userKeyUnique: uniqueIndex('idempotency_user_key_unique').on(t.userId, t.key),
        expiresIdx: index('idempotency_expires_idx').on(t.expiresAt),
    })
);

// ============================================================================
// RELATIONS
// ============================================================================

export const usersRelations = relations(users, ({ many }) => ({
    senders: many(senders),
    domains: many(domains),
    campaigns: many(campaigns),
    emails: many(emails),
    templates: many(templates),
    contactLists: many(contactLists),
    suppressions: many(suppressions),
    apiKeys: many(apiKeys),
}));

export const domainsRelations = relations(domains, ({ one, many }) => ({
    user: one(users, { fields: [domains.userId], references: [users.id] }),
    senders: many(senders),
}));

export const sendersRelations = relations(senders, ({ one, many }) => ({
    user: one(users, { fields: [senders.userId], references: [users.id] }),
    domain: one(domains, { fields: [senders.domainId], references: [domains.id] }),
    campaigns: many(campaigns),
    emails: many(emails),
}));

export const templatesRelations = relations(templates, ({ one, many }) => ({
    user: one(users, { fields: [templates.userId], references: [users.id] }),
    campaigns: many(campaigns),
}));

export const contactListsRelations = relations(contactLists, ({ one, many }) => ({
    user: one(users, { fields: [contactLists.userId], references: [users.id] }),
    contacts: many(contacts),
}));

export const contactsRelations = relations(contacts, ({ one }) => ({
    list: one(contactLists, { fields: [contacts.listId], references: [contactLists.id] }),
    user: one(users, { fields: [contacts.userId], references: [users.id] }),
}));

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
    user: one(users, { fields: [campaigns.userId], references: [users.id] }),
    sender: one(senders, { fields: [campaigns.senderId], references: [senders.id] }),
    template: one(templates, { fields: [campaigns.templateId], references: [templates.id] }),
    emails: many(emails),
    events: many(emailEvents),
}));

export const emailsRelations = relations(emails, ({ one, many }) => ({
    user: one(users, { fields: [emails.userId], references: [users.id] }),
    campaign: one(campaigns, { fields: [emails.campaignId], references: [campaigns.id] }),
    sender: one(senders, { fields: [emails.senderId], references: [senders.id] }),
    events: many(emailEvents),
}));

export const emailEventsRelations = relations(emailEvents, ({ one }) => ({
    email: one(emails, { fields: [emailEvents.emailId], references: [emails.id] }),
    campaign: one(campaigns, { fields: [emailEvents.campaignId], references: [campaigns.id] }),
}));

export const suppressionsRelations = relations(suppressions, ({ one }) => ({
    user: one(users, { fields: [suppressions.userId], references: [users.id] }),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
    user: one(users, { fields: [apiKeys.userId], references: [users.id] }),
}));

// ============================================================================
// INFERRED TYPES
// ============================================================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Domain = typeof domains.$inferSelect;
export type NewDomain = typeof domains.$inferInsert;

export type Sender = typeof senders.$inferSelect;
export type NewSender = typeof senders.$inferInsert;

export type Template = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;

export type ContactList = typeof contactLists.$inferSelect;
export type NewContactList = typeof contactLists.$inferInsert;

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;

export type Email = typeof emails.$inferSelect;
export type NewEmail = typeof emails.$inferInsert;

export type EmailEvent = typeof emailEvents.$inferSelect;
export type NewEmailEvent = typeof emailEvents.$inferInsert;

export type Suppression = typeof suppressions.$inferSelect;
export type NewSuppression = typeof suppressions.$inferInsert;

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export type EmailStatus = (typeof emailStatusEnum.enumValues)[number];
export type CampaignStatus = (typeof campaignStatusEnum.enumValues)[number];
export type EmailEventType = (typeof emailEventTypeEnum.enumValues)[number];
export type SuppressionReason = (typeof suppressionReasonEnum.enumValues)[number];
export type DomainStatus = (typeof domainStatusEnum.enumValues)[number];
export type EmailProviderName = (typeof providerEnum.enumValues)[number];
