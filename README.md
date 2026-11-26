# MailFlow

Self-hosted, single-user cold email platform: connect many mailboxes, warm them up against each other, run multi-step personalised campaigns that rotate across mailboxes, read and answer replies in a Unibox, and see results on an Analytics page.

- **Spec:** [`docs/SPEC.md`](docs/SPEC.md) · **Project rules:** [`CLAUDE.md`](CLAUDE.md) · **Build log:** [`docs/PROGRESS.md`](docs/PROGRESS.md)
- **Deploying to a VPS:** [`DEPLOY.md`](DEPLOY.md)

## Features

| Area | What it does |
| --- | --- |
| Email accounts | Connect with Google (OAuth, "keep adding" loop), whole Google Workspace domain (service account), Outlook / Microsoft 365 and any SMTP/IMAP server, CSV bulk import with per-row report. SMTP and IMAP tested separately. Passwords, tokens and keys encrypted with AES-256-GCM. Health status, bulk edit. |
| Warmup | Private pool of your own accounts: daily ramp-up, random cross-domain pairing, spintax content, spam rescue, mark read / starred, in-thread replies, hidden `MF-Warmup` folder, warmup score. |
| Campaigns | Lead CSV import with column mapping, `{{variables | fallbacks}}`, `{spin: a | b}`, unlimited steps, follow-ups N days later in the same thread from the same account, rotation, schedule windows per timezone, random gaps, daily limits, open / click tracking, unsubscribe footer + one-click `List-Unsubscribe`, stop on reply. |
| Unibox | Every lead reply from every mailbox: labels, filters, search, notes, read/unread synced to the mailbox, saved replies, scheduled send, forward. Replies go out in the same thread and are saved to Sent. |
| Analytics | Sent, open, click, reply, bounce and unsubscribe rates vs the previous period, daily chart, campaign and account-health tables, per-step stats. |

## Stack

TypeScript everywhere · npm workspaces · React + Vite + Tailwind + TanStack Query + Recharts (`apps/web`) · Fastify + Zod (`apps/api`) · BullMQ worker (`apps/worker`) · Prisma + PostgreSQL 16 (`packages/db`) · Redis 7 · Nodemailer, ImapFlow, mailparser, google-auth-library (`packages/core`).

```
apps/web       dashboard (React)
apps/api       REST API, auth, tracking routes (/o /c /u); serves the built dashboard in production
apps/worker    sending engine, IMAP sync + IDLE, warmup, stats roll-up, health checks
packages/db    Prisma schema, migrations, client
packages/core  shared code: encryption, templates, timezone math, SMTP/IMAP, Google auth, detection
```

## Run it locally

You need **Node.js 20+** and **Docker** (for Postgres, Redis and the test mail servers).

1. Start the services:

   ```bash
   docker compose up -d
   ```

   This starts Postgres, Redis and **Mailpit** (a fake SMTP server with a web inbox at <http://localhost:8025>).

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create `.env`:

   ```bash
   cp .env.example .env
   ```

   Then fill in the two secrets (paste the output into `.env`):

   ```bash
   echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"; echo "SESSION_SECRET=$(openssl rand -hex 32)"
   ```

4. Create the database tables:

   ```bash
   npm run db:deploy
   ```

5. Start the API, worker and dashboard together:

   ```bash
   npm run dev
   ```

6. Open <http://localhost:5173> and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env` (default `admin@example.com` / `change-me-please`).

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string. Only this changes to move to a managed Postgres (e.g. Supabase). |
| `REDIS_URL` | yes | Redis for BullMQ jobs and locks. |
| `ENCRYPTION_KEY` | yes | 64 hex chars (`openssl rand -hex 32`). Encrypts mailbox passwords, OAuth refresh tokens and service-account keys. Losing it means reconnecting every mailbox. |
| `SESSION_SECRET` | yes | Signs the admin session cookie and click-tracking links. |
| `APP_URL` | yes | Public dashboard URL (OAuth redirect base). Local: `http://localhost:5173`. |
| `TRACKING_URL` | yes | Base for pixel / click / unsubscribe links when no tracking domain is set in Settings. Local: `http://localhost:3000`. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | yes | The single admin login. The password is bcrypt-hashed into the database on start. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | for Google | OAuth client for "Connect with Google" (see DEPLOY.md §6). |
| `PORT` | no | API port (default 3000). |
| `DELAY_UNIT` | no | `minutes` makes "wait N days" mean N minutes (testing only). Also available in Settings → Advanced. |
| `DEV_SMTP_OVERRIDE` | no | e.g. `smtp://localhost:1025`: every outgoing email goes to Mailpit instead of the account's server. Never set in production. |
| `DEV_IGNORE_SCHEDULE` | no | `true` ignores campaign schedule windows, to test outside working hours. Never in production. |
| `LOG_LEVEL` | no | `info` (default), `debug`, `warn`. |
| `APP_DOMAIN`, `TRACKING_DOMAIN`, `POSTGRES_PASSWORD` | production | Used by `docker-compose.prod.yml` and Caddy. |

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API (`:3000`), worker and dashboard (`:5173`) with reload |
| `npm run build` | Build the dashboard into `apps/web/dist` (served by the API in production) |
| `npm start` / `npm run start:worker` | Run the API / worker without reload |
| `npm run db:deploy` | Apply migrations |
| `npm run db:migrate -- --name <name>` | Create a new migration after changing `schema.prisma` (dev) |
| `npm run typecheck` | TypeScript in every workspace |
| `npm run lint` | ESLint |
| `npm test` | Vitest (needs Postgres; uses the `mailflow_test` database, see below) |

### Tests

Tests run against a separate database so they never touch your data. Create it once:

```bash
docker compose exec postgres createdb -U mailflow mailflow_test
```

```bash
DATABASE_URL=postgresql://mailflow:mailflow@localhost:5432/mailflow_test npm run db:deploy
```

```bash
npm test
```

(Override with `TEST_DATABASE_URL`.) The suite covers the sending engine with a fake clock (rotation, gaps, windows, timezones, follow-up timing and threading, limits, new-leads cap, priority, stop on reply, parallel workers, retries, bounces, auth failures, rate limits, suppression), inbound mail classification, warmup, the API (auth, tracking, unsubscribe, import, launch) and the template/time/detection helpers.

## How to test each feature locally

Two local mail servers are available:

- **Mailpit** (always on): catches mail at <http://localhost:8025>. It has no IMAP, so it cannot be used as a connected account. Set `DEV_SMTP_OVERRIDE=smtp://localhost:1025` to see every campaign email there.
- **GreenMail** (optional, real SMTP + IMAP, any username/password accepted, mailboxes created on first use):

  ```bash
  docker compose --profile imap up -d greenmail
  ```

### 1. Accounts

Add accounts with **Email accounts → Add accounts → Any provider (SMTP / IMAP)**: email e.g. `ali@growth.test`, any password, SMTP host `localhost` port `3025`, IMAP host `localhost` port `3143` (SSL is switched off automatically for non-standard ports). Add at least 3 (e.g. `ali@growth.test`, `sara@growth.test`, `team@reachly.test`) so warmup can start.

Or import them all at once with **Bulk import from CSV** (download the template; use `localhost`, `3025`, `3143`). A row with an invalid email shows up as failed in the report. Use **⋯ → Send test email** on an account to try sending.

### 2. Campaign + sending engine

1. Set `DELAY_UNIT=minutes` and `DEV_IGNORE_SCHEDULE=true` in `.env` and restart `npm run dev`.
2. **Campaigns → New campaign**, import a CSV of leads such as `james@lead.test` (column mapping step), write Step 1 and a follow-up with an empty subject (same thread), pick 2–3 accounts in **Settings**, **Launch**.
3. Within 30 seconds Step 1 goes out, one account per lead (rotation). Follow-ups wait for the step delay *and* the account's minimum gap (default 10 minutes; lower it on the account page to go faster).
4. See them in the lead's mailbox: `python3 scripts/dev/lead.py list james@lead.test` (or in Mailpit if you set `DEV_SMTP_OVERRIDE`).

### 3. Replies, Unibox, auto-replies, bounces

```bash
python3 scripts/dev/lead.py reply james@lead.test "Quick question" "Thursday works, send the deck"
```

Within seconds (IMAP IDLE; at most 2 minutes by polling) the conversation appears in the **Unibox**, the lead is marked Replied and its remaining steps are cancelled. Answer from the Unibox: the reply arrives in the lead's inbox in the same thread and a copy is saved to the sender's Sent folder.

Out-of-office (does not stop the sequence unless the campaign's Advanced setting says so):

```bash
python3 scripts/dev/lead.py ooo james@lead.test "Quick question"
```

### 4. Tracking

Open the campaign email's HTML in the lead's mailbox (or Mailpit) and load the pixel / click the link, or simply `curl` the `/o/<token>.gif` and `/c/<token>?...` URLs from the email. Clicks within 15 seconds of sending are ignored as scanner clicks. The unsubscribe link shows a confirmation page; confirming adds the address to the suppression list. Analytics update within 2 minutes (roll-up interval).

### 5. Warmup

With 3+ accounts with warmup on, the worker plans today's warmup sends within 10 minutes, spread between 08:00 and 20:00 (app timezone). Each email is marked read + starred and moved to `MF-Warmup` by the receiving account, and some get replies. Scores appear on the accounts page once emails have been checked. To simulate a spam placement, create a `Junk` folder on a GreenMail account and move a warmup email into it with any IMAP client; the next sync rescues it and the sender's score drops.

## Security

- Single admin; bcrypt password; signed HttpOnly, SameSite=Lax session cookie (Secure in production); login rate limit (10 tries / 15 min per IP).
- Every request body validated with Zod. Secrets are never logged or returned by the API.
- Click links are HMAC-signed, so the redirect cannot be abused as an open redirect.
- Lead email HTML is sanitised before it is shown in the Unibox (no scripts, handlers or remote images).

## Dependencies beyond the base stack

`@fastify/cookie`, `@fastify/static` (cookie + serving the dashboard), `bcryptjs` (password hash, pure JS), `papaparse` (CSV), `clsx` + `tailwind-merge` (class names), `ioredis` (BullMQ connection + locks), `tsx` (runs TypeScript directly in dev and production), `vitest`, `eslint`, `concurrently`. UI components are hand-written in the shadcn/ui style (no Radix dependency).

## Known limitations

- "Connect with Google" and Workspace domain-wide connect are implemented to Google's documented flows but could not be tested here without real Google credentials; test them after setting up the OAuth client (DEPLOY.md §6).
- Open tracking is approximate (Apple Mail Privacy Protection and corporate scanners pre-load images).
- Read/unread sync goes from MailFlow to the mailbox; reading a reply in Gmail does not mark it read in MailFlow.
- DKIM is detected only for common selectors (`google`, `selector1/2`, `default`, …).
- Warmup uses only your own accounts (no shared network), so with few accounts or one domain the signal is weaker; 5–10 accounts on different domains are recommended.
- The engine sends at most one email per account per tick (every 30 s), so very short gaps are effectively ≥ 30 s.
