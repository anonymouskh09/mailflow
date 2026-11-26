# MailFlow — Claude Code se poora tool ek saath banwana

## Setup (ek dafa)

1. GitHub par naya **private** repo banayein, naam `mailflow`.
2. Is package ki saari files repo mein daal kar push karein (GitHub par "Add file → Upload files" se bhi ho jata hai):
   ```
   CLAUDE.md
   docs/SPEC.md
   docs/PROMPTS.md
   docs/designs/  (9 screens + README)
   ```
3. Claude Code kholein:
   - **Browser se (sab se aasaan):** claude.ai/code par jayein, apna `mailflow` repo chunein.
   - **Ya apne computer par:** repo clone karein, folder mein `claude` chalayein.
4. Neeche wala **BUILD prompt** copy kar ke paste karein.

---

## BUILD prompt — sab kuch ek saath

```
Read CLAUDE.md, the whole of docs/SPEC.md, and every file in docs/designs/ (start with docs/designs/README.md).

Build the complete MailFlow application described there, end to end, in this repo. Work through all five phases from SPEC section 18 in order, without stopping to ask me between phases:

Phase 1 – Foundation + email accounts: npm-workspaces monorepo (apps/web, apps/api, apps/worker, packages/db), docker-compose for dev (postgres, redis, mailpit), .env.example, Prisma schema and migrations, admin login, accounts CRUD, SMTP/IMAP test (separate results), AES-256-GCM secrets, Gmail/Outlook presets on port 587, Connect with Google with the keep-adding loop, Google Workspace domain-wide connect, CSV bulk import with template and report, bulk edit, account health. Web: login, sidebar layout, Email accounts, Add accounts modal, Account detail.

Phase 2 – Leads, campaigns, sending engine: lead lists and CSV import with mapping, suppression list, variables with fallbacks and spintax, preview; campaigns list; editor with tabs Leads · Sequence · Settings exactly as the designs; send test email; launch/pause/resume; BullMQ worker implementing SPEC section 9 exactly (windows, limits, random gaps, rotation, same-account follow-ups, threading, retries, bounces, auth failures, idempotency, locks); campaign detail page. Thorough tests for the engine with a fake clock.

Phase 3 – Tracking, reply detection, Unibox, Analytics: open pixel, click redirect, unsubscribe + List-Unsubscribe; IMAP worker for replies, auto-replies and bounces (IDLE or 2-minute polling), stop-on-reply; Unibox with labels, filters, search, notes, read/unread sync, in-thread replies saved to Sent, templates; Analytics home with KPI cards, daily chart, campaigns and account-health tables, daily_stats roll-up.

Phase 4 – Warmup: per-account ramp-up plan, random cross-domain pairing, content library with spintax, X-MF-Warmup header, receiver-side spam rescue / mark read / important / in-thread replies at the reply rate / move to MF-Warmup folder, warmup score and stats in the UI, shared daily cap with campaigns, minimum 3 accounts.

Phase 5 – Deploy: production docker-compose (web+api, worker, postgres, redis, caddy), Dockerfiles, Caddyfile for app + tracking domains, daily backup script, health checks, DEPLOY.md for an Ubuntu 24.04 VPS including Google Cloud OAuth setup and DNS (SPF/DKIM/DMARC).

Rules:
- Follow the UI designs closely: one primary button per page, secondary actions in ⋯ menus, filters behind one Filter button, rare settings under Advanced.
- After every phase: typecheck, lint, run tests, start the stack and verify the main flow against Mailpit, fix failures, commit, and update docs/PROGRESS.md.
- Add a dev setting so follow-up delays can be minutes instead of days for testing.
- Keep README.md complete: setup, env vars, commands, how to test each feature locally.
- At the end, give me a summary: what works, how to run it locally step by step, what I must set up myself (Google Cloud OAuth app, domain, VPS), and any known limitations.
```

---

## Agar beech mein ruk jaye

Claude Code ka session lamba kaam karte karte ruk sakta hai. Aisa ho to naye session mein yeh paste karein:

```
Read CLAUDE.md, docs/SPEC.md and docs/PROGRESS.md. Continue building MailFlow from where docs/PROGRESS.md says we stopped. Keep the same rules: verify, commit and update PROGRESS.md after each phase.
```

## Kuch theek na ho to

Error ya galat cheez ka screenshot ya text paste kar ke likhein, maslan:

```
On the Email accounts page the warmup switch doesn't save. Find the cause, fix it, add a test, and commit.
```
