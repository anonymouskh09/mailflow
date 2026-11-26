-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('google', 'outlook', 'custom');

-- CreateEnum
CREATE TYPE "AuthType" AS ENUM ('password', 'google_oauth', 'google_dwd');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('active', 'error', 'paused');

-- CreateEnum
CREATE TYPE "WarmupLanded" AS ENUM ('inbox', 'spam', 'unknown');

-- CreateEnum
CREATE TYPE "WarmupStatus" AS ENUM ('planned', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('not_contacted', 'in_sequence', 'replied', 'completed', 'bounced', 'unsubscribed');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'active', 'paused', 'completed');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('followups_first', 'new_first');

-- CreateEnum
CREATE TYPE "CampaignLeadState" AS ENUM ('active', 'replied', 'bounced', 'unsubscribed', 'completed');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('queued', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('sent', 'open', 'click', 'reply', 'auto_reply', 'bounce', 'unsubscribe');

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "from_name" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "smtp_host" TEXT NOT NULL,
    "smtp_port" INTEGER NOT NULL,
    "smtp_secure" BOOLEAN NOT NULL DEFAULT false,
    "imap_host" TEXT NOT NULL,
    "imap_port" INTEGER NOT NULL,
    "imap_secure" BOOLEAN NOT NULL DEFAULT true,
    "username" TEXT NOT NULL,
    "auth_type" "AuthType" NOT NULL,
    "password_enc" TEXT,
    "oauth_refresh_token_enc" TEXT,
    "oauth_expires_at" TIMESTAMP(3),
    "workspace_id" TEXT,
    "daily_limit" INTEGER NOT NULL DEFAULT 30,
    "gap_min_minutes" INTEGER NOT NULL DEFAULT 10,
    "signature_html" TEXT NOT NULL DEFAULT '',
    "status" "AccountStatus" NOT NULL DEFAULT 'active',
    "smtp_ok" BOOLEAN,
    "imap_ok" BOOLEAN,
    "last_error" TEXT,
    "last_checked_at" TIMESTAMP(3),
    "next_send_at" TIMESTAMP(3),
    "paused_until" TIMESTAMP(3),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "imap_inbox_uid" INTEGER,
    "imap_inbox_validity" TEXT,
    "imap_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warmup_settings" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "start_volume" INTEGER NOT NULL DEFAULT 3,
    "increase_per_day" INTEGER NOT NULL DEFAULT 2,
    "max_volume" INTEGER NOT NULL DEFAULT 40,
    "reply_rate" INTEGER NOT NULL DEFAULT 30,
    "working_days" INTEGER[] DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[],
    "weekend_factor" INTEGER NOT NULL DEFAULT 50,
    "keep_during_campaigns" BOOLEAN NOT NULL DEFAULT true,
    "started_on" TIMESTAMP(3),
    "planned_for" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warmup_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warmup_messages" (
    "id" TEXT NOT NULL,
    "from_account_id" TEXT NOT NULL,
    "to_account_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "message_id" TEXT,
    "code" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "status" "WarmupStatus" NOT NULL DEFAULT 'planned',
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "landed" "WarmupLanded" NOT NULL DEFAULT 'unknown',
    "processed_at" TIMESTAMP(3),
    "rescued_at" TIMESTAMP(3),
    "reply_due_at" TIMESTAMP(3),
    "replied_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warmup_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_workspaces" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "service_account_json_enc" TEXT NOT NULL,
    "admin_email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_imports" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "succeeded" INTEGER NOT NULL,
    "failed" INTEGER NOT NULL,
    "report" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_lists" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "list_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "first_name" TEXT NOT NULL DEFAULT '',
    "last_name" TEXT NOT NULL DEFAULT '',
    "company" TEXT NOT NULL DEFAULT '',
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "status" "LeadStatus" NOT NULL DEFAULT 'not_contacted',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppression" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "list_id" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "window_start" TEXT NOT NULL DEFAULT '09:00',
    "window_end" TEXT NOT NULL DEFAULT '17:00',
    "start_at" TIMESTAMP(3),
    "gap_min" INTEGER NOT NULL DEFAULT 8,
    "gap_max" INTEGER NOT NULL DEFAULT 15,
    "daily_limit" INTEGER NOT NULL DEFAULT 100,
    "new_leads_per_day" INTEGER,
    "priority" "Priority" NOT NULL DEFAULT 'followups_first',
    "track_opens" BOOLEAN NOT NULL DEFAULT true,
    "track_clicks" BOOLEAN NOT NULL DEFAULT false,
    "stop_on_reply" BOOLEAN NOT NULL DEFAULT true,
    "stop_on_auto_reply" BOOLEAN NOT NULL DEFAULT false,
    "stop_on_domain_reply" BOOLEAN NOT NULL DEFAULT false,
    "plain_text" BOOLEAN NOT NULL DEFAULT false,
    "unsubscribe_footer" BOOLEAN NOT NULL DEFAULT true,
    "launched_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_accounts" (
    "campaign_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_accounts_pkey" PRIMARY KEY ("campaign_id","account_id")
);

-- CreateTable
CREATE TABLE "sequence_steps" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "delay_days" INTEGER NOT NULL DEFAULT 0,
    "subject" TEXT NOT NULL DEFAULT '',
    "body_html" TEXT NOT NULL DEFAULT '',
    "body_text" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sequence_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_leads" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "account_id" TEXT,
    "current_step" INTEGER NOT NULL DEFAULT 0,
    "next_due_at" TIMESTAMP(3),
    "state" "CampaignLeadState" NOT NULL DEFAULT 'active',
    "thread_message_id" TEXT,
    "thread_references" TEXT,
    "thread_subject" TEXT,
    "locked_until" TIMESTAMP(3),
    "held_reason" TEXT,
    "last_activity" TEXT,
    "last_activity_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "campaign_lead_id" TEXT NOT NULL,
    "account_id" TEXT,
    "step_position" INTEGER NOT NULL,
    "message_id" TEXT,
    "token" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'queued',
    "subject" TEXT NOT NULL DEFAULT '',
    "body_html" TEXT NOT NULL DEFAULT '',
    "body_text" TEXT NOT NULL DEFAULT '',
    "to_email" TEXT NOT NULL DEFAULT '',
    "sent_at" TIMESTAMP(3),
    "error" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "account_id" TEXT,
    "step_id" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "url" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_stats" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "opens" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "replies" INTEGER NOT NULL DEFAULT 0,
    "bounces" INTEGER NOT NULL DEFAULT 0,
    "unsubscribes" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "admin_email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "tracking_domain" TEXT NOT NULL DEFAULT '',
    "default_timezone" TEXT NOT NULL DEFAULT 'UTC',
    "delay_unit" TEXT NOT NULL DEFAULT 'days',
    "notify_email" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_labels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3F3F46',
    "bg" TEXT NOT NULL DEFAULT '#F4F4F5',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "threads" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "campaign_id" TEXT,
    "campaign_lead_id" TEXT,
    "lead_email" TEXT NOT NULL,
    "lead_name" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL DEFAULT '',
    "snippet" TEXT NOT NULL DEFAULT '',
    "last_message_at" TIMESTAMP(3) NOT NULL,
    "unread" BOOLEAN NOT NULL DEFAULT true,
    "label_id" TEXT,
    "is_lead" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox_messages" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "message_id" TEXT,
    "in_reply_to" TEXT,
    "references" TEXT,
    "from_email" TEXT NOT NULL,
    "from_name" TEXT NOT NULL DEFAULT '',
    "to_email" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "body_html" TEXT NOT NULL DEFAULT '',
    "body_text" TEXT NOT NULL DEFAULT '',
    "is_auto_reply" BOOLEAN NOT NULL DEFAULT false,
    "received_at" TIMESTAMP(3) NOT NULL,
    "scheduled_at" TIMESTAMP(3),
    "imap_uid" INTEGER,
    "imap_folder" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reply_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "body_html" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reply_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_email_key" ON "accounts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "warmup_settings_account_id_key" ON "warmup_settings"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "warmup_messages_message_id_key" ON "warmup_messages"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "warmup_messages_code_key" ON "warmup_messages"("code");

-- CreateIndex
CREATE INDEX "warmup_messages_status_scheduled_at_idx" ON "warmup_messages"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "warmup_messages_from_account_id_sent_at_idx" ON "warmup_messages"("from_account_id", "sent_at");

-- CreateIndex
CREATE INDEX "warmup_messages_to_account_id_sent_at_idx" ON "warmup_messages"("to_account_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "google_workspaces_domain_key" ON "google_workspaces"("domain");

-- CreateIndex
CREATE INDEX "leads_email_idx" ON "leads"("email");

-- CreateIndex
CREATE UNIQUE INDEX "leads_list_id_email_key" ON "leads"("list_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "suppression_value_key" ON "suppression"("value");

-- CreateIndex
CREATE INDEX "sequence_steps_campaign_id_position_idx" ON "sequence_steps"("campaign_id", "position");

-- CreateIndex
CREATE INDEX "campaign_leads_state_next_due_at_idx" ON "campaign_leads"("state", "next_due_at");

-- CreateIndex
CREATE INDEX "campaign_leads_campaign_id_state_idx" ON "campaign_leads"("campaign_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_leads_campaign_id_lead_id_key" ON "campaign_leads"("campaign_id", "lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_message_id_key" ON "messages"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_token_key" ON "messages"("token");

-- CreateIndex
CREATE INDEX "messages_account_id_sent_at_idx" ON "messages"("account_id", "sent_at");

-- CreateIndex
CREATE INDEX "messages_campaign_id_sent_at_idx" ON "messages"("campaign_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "messages_campaign_id_lead_id_step_id_key" ON "messages"("campaign_id", "lead_id", "step_id");

-- CreateIndex
CREATE INDEX "events_message_id_type_idx" ON "events"("message_id", "type");

-- CreateIndex
CREATE INDEX "events_campaign_id_type_at_idx" ON "events"("campaign_id", "type", "at");

-- CreateIndex
CREATE INDEX "events_type_at_idx" ON "events"("type", "at");

-- CreateIndex
CREATE INDEX "daily_stats_date_idx" ON "daily_stats"("date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_stats_date_campaign_id_account_id_key" ON "daily_stats"("date", "campaign_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_labels_name_key" ON "lead_labels"("name");

-- CreateIndex
CREATE INDEX "threads_last_message_at_idx" ON "threads"("last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "threads_account_id_lead_email_key" ON "threads"("account_id", "lead_email");

-- CreateIndex
CREATE INDEX "inbox_messages_thread_id_received_at_idx" ON "inbox_messages"("thread_id", "received_at");

-- CreateIndex
CREATE INDEX "inbox_messages_status_scheduled_at_idx" ON "inbox_messages"("status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "inbox_messages_account_id_message_id_key" ON "inbox_messages"("account_id", "message_id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "google_workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warmup_settings" ADD CONSTRAINT "warmup_settings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warmup_messages" ADD CONSTRAINT "warmup_messages_from_account_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warmup_messages" ADD CONSTRAINT "warmup_messages_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "lead_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "lead_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_accounts" ADD CONSTRAINT "campaign_accounts_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_accounts" ADD CONSTRAINT "campaign_accounts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "sequence_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_campaign_lead_id_fkey" FOREIGN KEY ("campaign_lead_id") REFERENCES "campaign_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_campaign_lead_id_fkey" FOREIGN KEY ("campaign_lead_id") REFERENCES "campaign_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "lead_labels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
