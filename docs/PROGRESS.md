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
