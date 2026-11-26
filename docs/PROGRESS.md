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
