# MailFlow — build progress

Newest entry last. Each phase is verified (typecheck, lint, tests, manual run against local mail servers) before it is committed.

## Phase 1 – Foundation + email accounts ✅

- npm-workspaces monorepo: `apps/web`, `apps/api`, `apps/worker`, `packages/db` (Prisma), `packages/core` (shared mail/crypto/render/time code).
- `docker-compose.yml` for dev: Postgres 16, Redis 7, Mailpit, optional GreenMail (SMTP + IMAP test server, `--profile imap`).
- Prisma schema for the full data model (SPEC §14) + initial migration.
- Admin login (bcrypt hash synced from `ADMIN_EMAIL` / `ADMIN_PASSWORD`), signed HttpOnly session cookie, login rate limit.
- Accounts CRUD, SMTP and IMAP tested separately with readable errors, AES-256-GCM secrets, Gmail/Outlook presets on port 587.
- Connect with Google (OAuth, XOAUTH2) with the keep-adding loop; Google Workspace domain-wide delegation (list users, connect selected).
- CSV bulk import with template download and per-row pass/fail report; bulk edit (limit, gap, signature, warmup, tags, pause/resume, remove).
- Account health: status (Active / Limit reached / Error / Paused), last error, periodic re-checks in the worker.
- Web: login, sidebar layout, Email accounts list (selection bar, ⋯ menus, Filter), Add accounts modal, Account detail.
- Verified: 4 of 6 CSV rows connected against a local SMTP/IMAP server; bad password and bad email rows reported with reasons; test email sent.
- Google OAuth / Workspace flows are implemented but need real Google Cloud credentials to verify (see DEPLOY.md).

## Phase 2 – Leads, campaigns, sending engine ✅

- Lead lists, CSV import with column mapping (custom variables), duplicate handling (in list / in active campaigns), invalid-email report; suppression list (emails and domains) honoured at send time.
- Variables with fallbacks (`{{firstName | there}}`), spintax (`{spin: a | b}`), `{{signature}}`, `{{senderName}}`, `{{unsubscribeLink}}`; preview as any lead with missing-variable warnings; send test email.
- Campaigns list with status tabs; editor with Leads · Sequence · Settings tabs (autosave), launch / pause / resume, duplicate, delete; campaign detail with KPIs, by-step table, lead table.
- Sending engine (`apps/worker/src/engine/sender.ts`, SPEC §9): schedule windows per timezone, start date, account + campaign + new-leads-per-day limits (warmup shares the account cap), random gap (account minimum wins), rotation by fewest sends, follow-ups from the Step 1 account in the same thread, priority, retries 5/15/60 min, hard bounces → suppression, auth failure → account Error + Step 1 re-routed / follow-ups held, rate limit → 1 h pause, row locks + idempotent messages.
- 19 engine tests with a fake clock (`sender.test.ts`), including three workers ticking in parallel.
- Verified end to end: a 3-step campaign over 3 accounts sent Step 1 from three different accounts in one tick, then the follow-ups from the same accounts, in thread (`In-Reply-To`/`References`), after the delay plus the account gap (Mailpit).
- Dev setting: `DELAY_UNIT=minutes` (or Settings → Advanced) turns step delays into minutes.
- Phase 3 work started in the same commit: tracking routes, IMAP inbound processor, Unibox and analytics APIs (not yet verified end to end).

## Phase 3 – Tracking, reply detection, Unibox, Analytics ✅

- Public tracking routes: `/o/<token>.gif` open pixel, `/c/<token>?u=&s=` signed click redirect (forged links rejected, scanner clicks within 15 s / known bot user-agents ignored), `/u/<token>` unsubscribe page + RFC 8058 one-click POST, `List-Unsubscribe` header on every campaign email.
- IMAP worker (`apps/worker/src/imap`): IDLE watcher (one leader process) for near-instant pickup plus 2-minute polling; per-account Redis lock; first sync only reads mail since the account was connected.
- Inbound classification: warmup (header/code) → warmup receiver; bounces (DSN parsing, Message-ID or recipient match) → bounced + suppressed; replies matched by `In-Reply-To`/`References`, then sender address; auto-replies (headers + phrases) labelled "Out of office" and do not stop the sequence unless the campaign says so; emails from any known lead are kept; newsletters ignored.
- Unibox: conversation list (search incl. message text, Filter by label/campaign/account/date, All/Unread/Interested), thread with campaign emails + replies, label dropdown, ⋯ actions (unread, not a lead, move to campaign, suppress), lead panel with notes, reply box with variables, signature, saved templates, schedule send and forward. Replies go from the same account in the same thread and a copy is appended to the mailbox's Sent folder (Gmail does this itself). Read/unread is synced back to the mailbox (`\Seen`).
- Analytics home: KPI cards with change vs the previous period and "tracking off" handling, daily chart (Recharts), campaigns table, account-health table; custom date range and Filter (campaign, account). `daily_stats` roll-up every 2 minutes.
- Settings page: tracking domain, timezone, password, SPF/DKIM/DMARC DNS check, suppression list, labels, saved replies, testing delay toggle under Advanced.
- Tests: 9 inbound tests, 11 API tests (auth, rate limit, tracking, unsubscribe, import, launch validation, preview).
- Verified against a real SMTP/IMAP server (GreenMail): campaign email delivered; open + click recorded; lead's reply detected 6 s later via IDLE, lead stopped, shown in the Unibox; reply sent from the Unibox arrived in the lead's inbox with the right `In-Reply-To` (same thread) and was saved to Sent; events visible on Analytics within the roll-up interval.

## Phase 4 – Warmup ✅

- Planner (`apps/worker/src/warmup/planner.ts`): once a day per account, target = start volume + increase × days (capped at max, weekends reduced, working days honoured), spread at random times over 08:00–20:00 in the app timezone; recipients are random other pool accounts, cross-domain preferred (same domain gets ¼ weight), never the same pair twice in a row; nothing runs with fewer than 3 accounts in the pool.
- Shared daily cap: while an account is in an active campaign, warmup uses at most 30 % of its daily limit (or stops if "keep running during campaigns" is off), and campaign sends get the rest.
- Sender: neutral content from a built-in spintax library (no links or images), hidden `X-MF-Warmup` header + code in the body, replies in the same thread.
- Receiver (`receiver.ts`, runs inside the IMAP sync): warmup mail in Inbox is marked read + starred and moved to a hidden `MF-Warmup` folder; warmup mail in Spam/Junk is recorded as a spam hit, marked, and moved back to the Inbox ("not spam"); an in-thread reply is scheduled at the reply rate after a random 10–120 min delay. Warmup mail never reaches campaigns, analytics or the Unibox.
- Score = share of the account's warmup emails in the last 7 days that landed in the recipient's Inbox; shown with sent / received / saved from spam / replies and a 14-day inbox-vs-spam chart; below 80 shows a warning; campaign Settings shows each account's score.
- Tests: 6 warmup tests (pool minimum, ramp-up plan and spacing, campaign cap, cross-domain preference, send/receive/reply/score, idempotent receipt).
- Verified with 5 accounts on a real IMAP server, with today's full plan pulled forward: 15 warmup emails sent and received, all marked read + starred and filed in MF-Warmup; one email placed in Junk was rescued and counted as spam; 2 replies sent in thread; every account shows a score. A real 7-day unattended run still has to happen on the VPS.

## Phase 5 – Deploy ✅ (files ready; needs a real VPS to run)

- `Dockerfile` (one image for web + worker, non-root user), `docker-compose.prod.yml` (web, worker, postgres, redis, caddy) with health checks: `/api/health` for web, a heartbeat file touched by the send loop for the worker, `pg_isready`, `redis-cli ping`. Migrations run when `web` starts.
- `deploy/Caddyfile`: automatic HTTPS for the app domain; the tracking domain only serves `/o/*`, `/c/*`, `/u/*`.
- `scripts/backup.sh` (daily `pg_dump`, 14-day retention, optional rclone off-server copy) and `scripts/restore.sh`.
- `DEPLOY.md`: Ubuntu 24.04 VPS (port 587 note), Docker, DNS for app + tracking domains, SPF/DKIM/DMARC per sending domain, `.env`, Google Cloud OAuth client (Internal vs External "In production"), Workspace domain-wide delegation, Microsoft 365 SMTP AUTH, backups, updates, troubleshooting.
- `README.md`: setup, env vars, commands, tests, how to test every feature locally (Mailpit + GreenMail + `scripts/dev/lead.py`), security notes, known limitations.
- The API and worker load `.env` themselves; optional browser notifications for new replies.
- Verified here: the production build of the dashboard is served by the API with SPA fallback and `/api/health`. Not verifiable here (no Docker daemon, no domain): `docker compose -f docker-compose.prod.yml up`, Caddy certificates, Google OAuth with real credentials, a 7-day unattended warmup run.

## What is next (for the owner)

1. Create the Google Cloud OAuth client (DEPLOY.md §6) and try Connect with Google with 2–3 real mailboxes.
2. Deploy to a VPS with outbound 587 open, point `app.` and `track.` DNS at it, set SPF/DKIM/DMARC on sending domains.
3. Let warmup run 2–3 weeks before the first real campaign.

## Changes after phase 5 (owner requests)

- Email account page has tabs: **Warmup · Settings · Campaigns**. Settings holds from name, daily limit, minimum gap, tags, connection status and, at the bottom, the **signature** with a live preview. Campaigns lists every campaign the email is connected to or has sent for (status, sent today / total, leads in progress, replies, last sent) plus recent activity (sent, opened, clicked, replied, bounced, unsubscribed). New endpoint `GET /api/accounts/:id/campaigns`.
- The signature is now added automatically to every campaign email (new campaign option "Add signature", on by default; migration `campaign_auto_signature`). If a step contains `{{signature}}`, it is placed there instead.
- Campaign page merged into one page with tabs **Analytics · Leads · Sequence · Settings**; launched campaigns open on Analytics (KPIs, daily chart for the campaign, by-step table, leads). Old `/campaigns/:id/edit/...` links redirect.
- Sidebar: the overall analytics page is now **Dashboard**, at the bottom of the sidebar.
- Campaign Settings starts with **Sending speed**: wait between emails (minutes, per account) and emails per day for the campaign, with an estimate.
- Sidebar can be hidden to an icon strip (button next to the logo or Ctrl/Cmd + B); remembered per browser.
- Unibox: ⋯ → **Edit lead** (or "Edit" in the lead panel) opens a side panel pre-filled with first name, last name, company and all custom fields; fields can be changed, added or removed and saved. Email stays read-only so reply matching keeps working. New endpoints `GET/PATCH /api/leads/:id`.
