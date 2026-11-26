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
