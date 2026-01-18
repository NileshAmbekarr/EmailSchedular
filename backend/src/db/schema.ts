import { pgTable, uuid, varchar, text, timestamp, boolean, pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Email status enum
export const emailStatusEnum = pgEnum('email_status', ['pending', 'queued', 'processing', 'sent', 'failed']);

// ============ USERS TABLE ============
export const users = pgTable('users', {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    avatar: varchar('avatar', { length: 500 }),

    // Google OAuth
    googleId: varchar('google_id', { length: 255 }).unique(),

    // Email/Password auth
    password: varchar('password', { length: 255 }),
    emailVerified: boolean('email_verified').default(false),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============ SENDERS TABLE ============
// For per-sender rate limiting - users can have multiple sender identities
export const senders = pgTable('senders', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 255 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),

    // Ethereal SMTP credentials for this sender (auto-generated)
    smtpUser: varchar('smtp_user', { length: 255 }),
    smtpPass: varchar('smtp_pass', { length: 255 }),

    createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============ EMAILS TABLE ============
export const emails = pgTable('emails', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id').notNull().references(() => senders.id, { onDelete: 'cascade' }),

    // Email content
    recipientEmail: varchar('recipient_email', { length: 255 }).notNull(),
    subject: varchar('subject', { length: 500 }).notNull(),
    body: text('body').notNull(),

    // Scheduling
    scheduledAt: timestamp('scheduled_at').notNull(),
    sentAt: timestamp('sent_at'),

    // Status tracking
    status: emailStatusEnum('status').default('pending').notNull(),
    bullmqJobId: varchar('bullmq_job_id', { length: 255 }),
    errorMessage: text('error_message'),

    // Ethereal preview URL (for viewing sent emails)
    previewUrl: varchar('preview_url', { length: 500 }),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============ RELATIONS ============
export const usersRelations = relations(users, ({ many }) => ({
    senders: many(senders),
    emails: many(emails),
}));

export const sendersRelations = relations(senders, ({ one, many }) => ({
    user: one(users, {
        fields: [senders.userId],
        references: [users.id],
    }),
    emails: many(emails),
}));

export const emailsRelations = relations(emails, ({ one }) => ({
    user: one(users, {
        fields: [emails.userId],
        references: [users.id],
    }),
    sender: one(senders, {
        fields: [emails.senderId],
        references: [senders.id],
    }),
}));

// ============ Types ============
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Sender = typeof senders.$inferSelect;
export type NewSender = typeof senders.$inferInsert;

export type Email = typeof emails.$inferSelect;
export type NewEmail = typeof emails.$inferInsert;

export type EmailStatus = 'pending' | 'queued' | 'processing' | 'sent' | 'failed';
