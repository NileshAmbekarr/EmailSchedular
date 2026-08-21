CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'scheduled', 'sending', 'paused', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."domain_status" AS ENUM('pending', 'verified', 'failed');--> statement-breakpoint
CREATE TYPE "public"."email_event_type" AS ENUM('queued', 'sent', 'delivered', 'deferred', 'opened', 'clicked', 'bounced', 'complained', 'unsubscribed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('pending', 'queued', 'processing', 'retrying', 'sent', 'delivered', 'bounced', 'failed', 'cancelled', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."email_provider" AS ENUM('ethereal', 'smtp', 'resend', 'ses');--> statement-breakpoint
CREATE TYPE "public"."suppression_reason" AS ENUM('unsubscribed', 'hard_bounce', 'soft_bounce_threshold', 'complaint', 'manual', 'invalid');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"key_prefix" varchar(16) NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"template_id" uuid,
	"name" varchar(255) NOT NULL,
	"subject" varchar(500) NOT NULL,
	"body" text NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"per_recipient_timezone" boolean DEFAULT false NOT NULL,
	"delay_between_emails_ms" integer,
	"max_emails_per_hour" integer,
	"track_opens" boolean DEFAULT true NOT NULL,
	"track_clicks" boolean DEFAULT true NOT NULL,
	"total_recipients" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"delivered_count" integer DEFAULT 0 NOT NULL,
	"opened_count" integer DEFAULT 0 NOT NULL,
	"clicked_count" integer DEFAULT 0 NOT NULL,
	"bounced_count" integer DEFAULT 0 NOT NULL,
	"complained_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"contact_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"domain" varchar(253) NOT NULL,
	"status" "domain_status" DEFAULT 'pending' NOT NULL,
	"dkim_selector" varchar(63) NOT NULL,
	"dkim_public_key" text,
	"dkim_private_key" text,
	"verification_token" varchar(128) NOT NULL,
	"spf_verified" boolean DEFAULT false NOT NULL,
	"dkim_verified" boolean DEFAULT false NOT NULL,
	"dmarc_verified" boolean DEFAULT false NOT NULL,
	"last_checked_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_id" uuid NOT NULL,
	"campaign_id" uuid,
	"type" "email_event_type" NOT NULL,
	"payload" jsonb,
	"provider_event_id" varchar(255),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"campaign_id" uuid,
	"sender_id" uuid NOT NULL,
	"recipient_email" varchar(255) NOT NULL,
	"merge_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rendered_subject" varchar(500),
	"scheduled_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"status" "email_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"bullmq_job_id" varchar(255),
	"provider_message_id" varchar(512),
	"error_message" text,
	"preview_url" varchar(500),
	"unsubscribe_token" varchar(128),
	"opened_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key" varchar(255) NOT NULL,
	"endpoint" varchar(255) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"response_body" jsonb,
	"status_code" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "senders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"domain_id" uuid,
	"email" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"reply_to" varchar(255),
	"provider" "email_provider" DEFAULT 'ethereal' NOT NULL,
	"smtp_host" varchar(255),
	"smtp_port" integer,
	"smtp_user" varchar(255),
	"smtp_pass_encrypted" text,
	"hourly_limit" integer,
	"daily_limit" integer,
	"warmup_enabled" boolean DEFAULT false NOT NULL,
	"warmup_started_at" timestamp with time zone,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"reason" "suppression_reason" NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"subject" varchar(500) NOT NULL,
	"body" text NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"avatar" varchar(500),
	"google_id" varchar(255),
	"password" varchar(255),
	"email_verified" boolean DEFAULT false NOT NULL,
	"verification_token" varchar(128),
	"verification_expires_at" timestamp with time zone,
	"reset_token" varchar(128),
	"reset_expires_at" timestamp with time zone,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"company_name" varchar(255),
	"postal_address" text,
	"tokens_valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_lists" ADD CONSTRAINT "contact_lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_list_id_contact_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."contact_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senders" ADD CONSTRAINT "senders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senders" ADD CONSTRAINT "senders_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_user_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "campaigns_user_status_idx" ON "campaigns" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "campaigns_scheduled_idx" ON "campaigns" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "contact_lists_user_idx" ON "contact_lists" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_list_email_unique" ON "contacts" USING btree ("list_id","email");--> statement-breakpoint
CREATE INDEX "contacts_user_idx" ON "contacts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "domains_user_domain_unique" ON "domains" USING btree ("user_id","domain");--> statement-breakpoint
CREATE INDEX "email_events_email_idx" ON "email_events" USING btree ("email_id");--> statement-breakpoint
CREATE INDEX "email_events_campaign_type_idx" ON "email_events" USING btree ("campaign_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "email_events_provider_event_unique" ON "email_events" USING btree ("provider_event_id");--> statement-breakpoint
CREATE INDEX "emails_user_status_scheduled_idx" ON "emails" USING btree ("user_id","status","scheduled_at");--> statement-breakpoint
CREATE INDEX "emails_campaign_idx" ON "emails" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "emails_status_scheduled_idx" ON "emails" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "emails_provider_message_idx" ON "emails" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "emails_sender_status_idx" ON "emails" USING btree ("sender_id","status");--> statement-breakpoint
CREATE INDEX "emails_unsubscribe_token_idx" ON "emails" USING btree ("unsubscribe_token");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_user_key_unique" ON "idempotency_keys" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX "idempotency_expires_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "senders_user_idx" ON "senders" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_user_email_unique" ON "suppressions" USING btree ("user_id","email");--> statement-breakpoint
CREATE INDEX "templates_user_idx" ON "templates" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_verification_token_idx" ON "users" USING btree ("verification_token");--> statement-breakpoint
CREATE INDEX "users_reset_token_idx" ON "users" USING btree ("reset_token");