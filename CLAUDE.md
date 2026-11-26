# MailFlow — project guide for Claude Code

MailFlow is a self-hosted, single-user cold email platform modelled on Instantly:
connect many mailboxes, warm them up against each other, run multi-step personalised
campaigns that rotate across mailboxes, read and answer replies in a Unibox, and see
results on an Analytics page.

The full product spec is in `docs/SPEC.md`. Read the relevant section before building
any feature. If this file and the spec disagree, this file wins.

## Stack (do not change without asking)

- Language: TypeScript everywhere (strict mode).
- Monorepo: npm workspaces.
  - `apps/web` — React + Vite + Tailwind CSS + shadcn/ui, React Router, TanStack Query, Recharts, lucide-react icons.
  - `apps/api` — Node.js 20+, Fastify, Zod validation. Also serves tracking routes (`/o`, `/c`, `/u`) and, in production, the built web app.
  - `apps/worker` — background processes: sending engine, warmup, IMAP polling, stats roll-up.
  - `packages/db` — Prisma schema + client shared by api and worker.
- Database: PostgreSQL 16 (self-hosted in Docker). Keep it portable: only `DATABASE_URL` should need to change to move to a managed Postgres (e.g. Supabase).
- Queue / locks: Redis 7 + BullMQ.
- Email: Nodemailer (SMTP), ImapFlow (IMAP, IDLE), mailparser. Google accounts use XOAUTH2 via `google-auth-library`.
- Local dev: `docker-compose.yml` with postgres, redis and **Mailpit** (fake SMTP inbox, so no real email leaves during development).
- Production: Docker Compose on one VPS + Caddy for HTTPS.

## Key product decisions

- Single admin user (email + password from env, bcrypt hash). No signup, no multi-tenant.
- Mailbox connection:
  - Gmail / Google Workspace: **Connect with Google** (OAuth, scope `https://mail.google.com/` + `openid email profile`), refresh token stored encrypted. "Keep adding" loop reopens the Google chooser after each account so 10–20 accounts can be connected in a row.
  - Google Workspace domain-wide: service account with domain-wide delegation; list domain users and connect selected mailboxes in one step.
  - Outlook / Microsoft 365 and any other provider: SMTP + IMAP with (app) password.
  - Bulk CSV import for SMTP/IMAP accounts, each row tested, pass/fail report.
- **SMTP port 587 (STARTTLS) by default** for Gmail and Outlook presets, not 465 — many VPS providers block outbound 25/465.
- Warmup pool = the user's own connected accounts only (no external network). Warmup emails carry header `X-MF-Warmup` and are excluded from all campaign stats and from Unibox.
- Follow-ups go from the same account that sent Step 1, in the same thread (`In-Reply-To` / `References`). Empty follow-up subject = reply in thread.
- Reply stops the sequence (toggle). Auto-replies (out-of-office) detected and do not stop it (toggle).
- Every send idempotent on (campaign, lead, step); jobs locked so two workers never send the same email.
- Unsubscribe link + `List-Unsubscribe` header on every campaign email; global suppression list always honoured.

## Security rules

- Never log or return passwords, refresh tokens, service-account keys or session secrets.
- Encrypt mailbox passwords, OAuth refresh tokens and service-account JSON with AES-256-GCM using `ENCRYPTION_KEY` from env.
- Session cookie: HttpOnly, Secure in production, SameSite=Lax. Rate-limit login.
- Validate every request body with Zod.
- Never commit `.env`; keep `.env.example` up to date.

## UI rules (match the approved designs)

- Clean, Instantly-style: white surfaces on a light grey ground (#F7F7F8), borders #E4E4E7, text #18181B, muted text #52525B, one accent indigo #4F46E5. Font: Inter.
- Left sidebar: Analytics, Email accounts, Campaigns, Unibox (unread badge), Settings at the bottom.
- **No unnecessary buttons.** At most one primary button per page (e.g. "Add accounts", "New campaign", "Launch", "Send"). Put secondary and rare actions in a "⋯" menu. Group filters (campaign, account, label) behind one "Filter" button; use segmented tabs for status.
- Rare settings go inside a collapsed "Advanced" section.
- Bulk actions appear in a bar only when rows are selected (main actions + "⋯").
- Campaign editor tabs: Leads · Sequence · Settings.
- Status colours: Active green, Paused/limit amber, Error red, Draft indigo, Completed grey.
- Accessible: real buttons/links/labels, aria-label on icon-only buttons, text contrast ≥ 4.5:1.

## How to work

- UI reference: `docs/designs/` (see its README). Match those screens.
- Work through the phases in `docs/SPEC.md` section 18 in order (1 → 5). Finish and verify each phase before starting the next, even when asked to build everything in one go.
- After each phase: run typecheck, lint and tests; start the app and check the main flow end to end against Mailpit; fix what fails; commit with a clear message (e.g. `feat: phase 2 – campaigns and sending engine`); add a short entry to `docs/PROGRESS.md`.
- If you stop before finishing, `docs/PROGRESS.md` must say exactly what is done and what is next, so a new session can continue.
- Write tests for the sending engine (scheduling, gap, limits, rotation, follow-up timing, stop on reply) — it is the riskiest part.
- Keep migrations small and named; never edit an applied migration.
- Keep `README.md` current: setup, env vars, commands, deploy steps.
- Ask before adding a new dependency that is not in the stack above.
