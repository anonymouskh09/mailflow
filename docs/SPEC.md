# MailFlow — Email Automation Tool Documentation

## 1. Overview

MailFlow is a self-hosted, single-user cold email platform modelled on Instantly: connect any number of mailboxes, warm them up against each other, and run multi-step personalised campaigns that rotate across those mailboxes on a schedule.

**Goals**

- Connect any mailbox over SMTP + IMAP, with presets for Gmail / Google Workspace and Outlook / Microsoft 365.
- Warm up every connected mailbox automatically, using the other connected mailboxes as the warmup pool.
- Build campaigns with unlimited sequence steps, `{{variables}}`, and follow-ups that fire N days after the previous step.
- Choose per campaign which mailboxes send it, the gap between emails, the sending schedule, and whether open / click tracking is on.
- Land on an Analytics page that shows sent, opens, clicks, replies and bounces at a glance.

**Working name:** MailFlow (placeholder, can be renamed).

## 2. Scope

Version 1 is a single-user tool covering accounts (including Google sign-in and bulk connect), warmup, campaigns, Unibox and analytics; SaaS features are deferred.

| Area | v1 (build now) | Later |
| --- | --- | --- |
| Users | One admin login | Multi-user, workspaces, billing (SaaS) |
| Mailbox connection | Connect with Google (OAuth) for Gmail / Workspace; SMTP + IMAP for Outlook and any other provider; bulk connect 10–20+ accounts at once | Connect with Microsoft (OAuth) |
| Warmup | Pool made of the user's own connected mailboxes | Shared pool across customers (needs SaaS) |
| Campaigns | Leads CSV, variables, unlimited steps, follow-ups, rotation, schedule, tracking toggles | A/B subject variants, AI writing |
| Inbox | Unibox: read and reply to every lead reply from inside MailFlow | AI reply suggestions, CRM sync |
| Analytics | Overview page + per-campaign and per-account stats | Exports, scheduled reports |

**Out of scope for v1:** buying domains or mailboxes, DNS automation, CRM sync, WhatsApp / LinkedIn channels.

## 3. Core concepts

| Term | Meaning |
| --- | --- |
| Account | One connected mailbox (e.g. ali@brand-mail.com) with its SMTP and IMAP credentials. |
| Warmup pool | All accounts with warmup switched on; they send to and reply to each other. |
| Warmup email | An auto-generated email between two pool accounts, tagged so it never appears in campaign stats. |
| Lead | One recipient row from a CSV: email plus any custom columns. |
| Lead list | A named set of leads, attached to a campaign. |
| Variable | A placeholder such as `{{firstName}}` replaced with the lead's column value at send time. |
| Campaign | Leads + sequence + settings; can be Draft, Active, Paused or Completed. |
| Sequence | Ordered steps: Step 1 (first email) and any number of follow-ups. |
| Step delay | Days to wait after the previous step before sending this one (e.g. 2, 3, 4 days). |
| Sending gap | Minimum minutes between two emails from the same account, with a random spread. |
| Rotation | Spreading one campaign's emails across several selected accounts. |
| Schedule | Days of week, time window and timezone in which a campaign may send. |
| Event | Anything that happens to a message: sent, opened, clicked, replied, bounced, unsubscribed. |

## 4. Email accounts

Any mailbox that speaks SMTP and IMAP can be connected; Gmail and Outlook are presets that pre-fill the server settings.

**Connection types**

| Provider | SMTP | IMAP | Login |
| --- | --- | --- | --- |
| Gmail / Google Workspace | smtp.gmail.com : 587 (STARTTLS) | imap.gmail.com : 993 | Connect with Google (OAuth, recommended), or email + App Password |
| Outlook / Microsoft 365 | smtp.office365.com : 587 (STARTTLS) | outlook.office365.com : 993 | Email + App Password; tenant must allow SMTP AUTH |
| Custom SMTP (Zoho, cPanel, etc.) | Host, port, security entered by user | Host, port entered by user | Username + password |

Port 587 is the default because many VPS providers block outbound ports 25 and 465.

**Connect with Google (OAuth)**

Gmail and Google Workspace mailboxes connect with one click and no password; MailFlow then sends and reads mail over SMTP and IMAP using XOAUTH2 tokens.

1. User clicks **Connect with Google**; Google's account chooser opens.
2. User picks the mailbox and approves the scope `https://mail.google.com/` (send, read, move and label mail — needed for sending, Unibox and warmup spam rescue).
3. Google redirects back to `/api/oauth/google/callback`; MailFlow stores the refresh token encrypted and reads the email address and name from the profile.
4. MailFlow tests SMTP and IMAP with the token and marks the account Active.
5. Tokens refresh automatically; if the user revokes access or changes the password, the account goes to Error with a **Reconnect** button.

**Google Cloud setup (one time)**

| Mailboxes are on | OAuth app type | Verification needed |
| --- | --- | --- |
| Your own Google Workspace domain(s) | Internal | None |
| Personal @gmail.com or other people's Workspace | External, published "In production" | No for own use: users see an "unverified app" warning and the app is capped at 100 users. Public launch needs Google verification + a yearly security assessment, because `mail.google.com` is a restricted scope |

An External app left in "Testing" status loses its tokens after 7 days, so it must be set to In production.

**Bulk connect (10–20+ accounts at once)**

| Method | How it works | Best for |
| --- | --- | --- |
| Google, one after another | "Keep adding" loop: after each account the Google chooser reopens; about 20 seconds per mailbox, no typing | Up to ~20 Gmail / Workspace mailboxes |
| Google Workspace domain-wide | Workspace admin creates a service account with domain-wide delegation once; MailFlow lists the domain's users and connects all selected mailboxes in one step | Many mailboxes on domains you own |
| CSV import (SMTP / IMAP) | Upload a CSV: email, from_name, password, smtp_host, smtp_port, imap_host, imap_port, daily_limit, warmup (yes / no); MailFlow tests every row and shows a pass / fail report | Outlook, Zoho, cPanel and other providers |

After a bulk connect, the user can apply settings to all new accounts at once: daily limit, gap, signature template, warmup on, tags.

**Add-account flow (manual)**

1. User picks a provider preset or Custom.
2. Enters from-name, email, password / app password (and hosts for Custom).
3. The app tests SMTP login and IMAP login separately and shows which one failed and why.
4. On success the account is saved with status Active; passwords are stored encrypted.

**Per-account settings**

- Daily campaign limit (default 30 / day for a new mailbox).
- Minimum gap between campaign emails (default 10 minutes; campaigns can only make it longer).
- Signature (HTML), available to templates as `{{signature}}`.
- Warmup on / off and warmup settings (section 5).
- Tags, for grouping accounts when selecting them in a campaign.

**Account health**

| Status | Meaning | What happens |
| --- | --- | --- |
| Active | Logins work | Sends normally |
| Limit reached | Daily limit hit | Resumes next day |
| Error | SMTP or IMAP failing (e.g. password changed) | Paused; red badge; campaigns rotate to other accounts |
| Paused | Turned off by user | Not used |

The accounts list shows each mailbox's status, warmup score, emails sent today vs limit, and last error.

## 5. Warmup

Every account with warmup on joins a private pool and exchanges realistic emails with the other pool accounts; the receiving side opens them, rescues them from spam, marks them important and sometimes replies. With 5–10 accounts on different domains, each one sees mail from several "random" senders, as on Instantly.

**Daily cycle (worker, per pool account)**

1. Work out today's warmup target from the ramp-up settings.
2. Spread that many sends across the account's working hours at random times.
3. For each send, pick a random other pool account as recipient (never the same pair twice in a row) and generate a subject + body from the content library.
4. Add the hidden header `X-MF-Warmup: <code>` and a short code in the body so the receiver can recognise it.
5. On the receiving account, the IMAP worker (every 5–15 min):
   - searches Inbox and Spam / Junk for warmup emails;
   - if found in Spam: moves it to Inbox ("not spam") and records a spam hit;
   - marks it read, flags it important / starred;
   - replies to it in-thread at the configured reply rate, after a random delay;
   - archives or moves it to a hidden `MF-Warmup` folder so it does not clutter the inbox.

**Warmup settings (per account)**

| Setting | Default | Notes |
| --- | --- | --- |
| Warmup on / off | On for new accounts | |
| Start volume | 3 emails / day | |
| Increase per day | +2 / day | |
| Max warmup volume | 40 / day | |
| Reply rate | 30% | Share of received warmup emails answered |
| Working days | Mon–Sun | Weekends at reduced volume |
| Keep running during campaigns | Yes | Recommended; campaign + warmup share the daily cap |

**Warmup score (0–100)**

Score = share of this account's warmup emails from the last 7 days that were found in the recipient's Inbox rather than Spam, shown with: sent, received, saved from spam, replies. Below 80 shows a warning; the campaign setup screen shows each account's score when selecting senders.

**Content library**

A built-in set of neutral business-style subjects and bodies (scheduling, quick questions, thank-yous), combined at random with spintax so no two emails are identical. No links or images, to avoid spam triggers.

**Pool rules and limits**

- Minimum 3 accounts in the pool before warmup starts; 5–10+ on different domains recommended.
- Accounts on the same domain are paired less often, so most traffic crosses domains.
- New mailboxes: 2–3 weeks of warmup before campaigns.
- Warmup emails are excluded from every campaign metric, analytics chart and Unibox.

## 6. Leads and variables

Leads come from a CSV upload; every column becomes a variable usable in subjects and bodies.

**Import flow**

1. Upload CSV (tested up to 100,000 rows).
2. Map columns: the email column is required; others keep their header as the variable name (`First Name` → `{{firstName}}`).
3. Choose duplicate handling: skip leads already in this list / already in any active campaign.
4. Invalid emails (bad format) are rejected and listed in an import report.

**Variables**

| Syntax | Result |
| --- | --- |
| `{{firstName}}` | Lead's value for that column |
| `{{firstName \| there}}` | Fallback "there" when the value is empty |
| `{{senderName}}`, `{{signature}}` | From the sending account |
| `{{unsubscribeLink}}` | Per-lead unsubscribe URL |
| `{spin: Hi \| Hello \| Hey}` | Picks one option at random per email |

Before launch, a preview shows the rendered email for any lead, and warns if a lead is missing a variable that has no fallback.

**Lead statuses:** Not contacted, In sequence, Replied, Completed (all steps sent), Bounced, Unsubscribed. A global suppression list (unsubscribed + bounced + manually blocked emails / domains) is never emailed again.

## 7. Campaigns and sequences

A campaign sends Step 1 to every lead, then each follow-up after its own delay, until the lead replies, bounces, unsubscribes or runs out of steps.

**Campaign editor tabs:** Leads · Sequence · Settings (see `docs/designs/CampaignSequence.dc.html` and `CampaignOptions.dc.html`). Launch button in the header.

**Sequence editor**

- Step 1: subject + body (rich text or plain text), with variable picker.
- "Add follow-up" adds a step with: wait N days after the previous step (any whole number, e.g. 2, 3, 4), subject, body.
- Unlimited steps; steps can be reordered or deleted until the campaign launches.
- Empty follow-up subject = sent as a reply in the same thread (`Re: <Step 1 subject>`, with `In-Reply-To` / `References` headers).
- Each follow-up goes from the same account that sent Step 1 to that lead, so the thread stays consistent.
- Send test email: renders a step for a chosen lead and sends it to the user's own address.
- Preview as any lead.

**Example**

| Step | Wait | Subject |
| --- | --- | --- |
| 1 | — | Quick question, {{firstName}} |
| 2 | 2 days | (same thread) |
| 3 | 3 days | (same thread) |
| 4 | 4 days | Should I close your file? |

**Stop rules**

- Reply received → lead marked Replied, remaining steps cancelled (toggle, default on).
- Auto-replies (out-of-office) are detected and do not stop the sequence (toggle).
- Bounce or unsubscribe → lead stopped and added to suppression list.
- Optional: stop for the whole company domain when anyone at it replies.

**Campaign states:** Draft → Active ⇄ Paused → Completed. Editing a step while Active affects only emails not yet sent.

## 8. Campaign settings

Each campaign has its own Settings tab where the user chooses the sending accounts, pacing, schedule and tracking.

| Setting | Options | Default |
| --- | --- | --- |
| Sending accounts | Multi-select from connected accounts (search, filter by tag, "select all"); shows status, warmup score and today's usage | None (required) |
| Gap between emails | Min and max minutes per account; each send waits a random value in that range | 8–15 min |
| Daily limit for this campaign | Max emails / day across all its accounts (per-account limits still apply) | 100 |
| Schedule days | Any of Mon–Sun | Mon–Fri |
| Schedule time window | From–to time | 09:00–17:00 |
| Timezone | Any IANA timezone (e.g. Asia/Tashkent, America/New_York) | Browser timezone |
| Start date | Now or a future date/time | Now |
| Open tracking | On / Off | On |
| Click tracking | On / Off (rewrites links through tracking domain) | Off |
| Stop on reply | On / Off | On |
| Unsubscribe link | Auto-append footer + `List-Unsubscribe` header | On |
| Advanced → New leads per day | Cap on Step 1 sends, so follow-ups get room | No cap |
| Advanced → Priority | Follow-ups first, or new leads first | Follow-ups first |
| Advanced → Plain-text only | Send without HTML (better deliverability, disables open tracking) | Off |
| Advanced → Stop on auto-reply | On / Off | Off |

Show an estimate under pacing ("About N emails a day with X accounts; all leads get Step 1 in about D working days"). Settings can be changed while a campaign is Active; changes apply from the next scheduled send.

## 9. Sending engine

A background worker runs every 30 seconds, picks due emails, and sends each through an account that is inside its schedule, under its limits and past its gap.

**Per tick**

1. Load Active campaigns whose schedule window is open now (in the campaign's timezone).
2. For each campaign, list due items: leads whose next step's `due_at` has passed, follow-ups first.
3. For each due item, choose the account:
   - follow-up → the same account that sent Step 1;
   - Step 1 → the selected account with the fewest sends today that is Active, under its daily limit and past its `next_send_at` (round-robin).
4. Render subject and body (variables, spintax, signature, unsubscribe link, tracking pixel / links if on).
5. Send over SMTP; store `Message-ID`; write a Sent event.
6. Set the account's `next_send_at` = now + random(gap min, gap max).
7. Schedule the lead's next step: `due_at` = sent time + step delay days, then shifted into the next open schedule window.

**Limits applied (all must pass):** account daily limit (campaign + warmup combined), account gap, campaign daily limit, new-leads-per-day, schedule window.

**Errors and retries**

| Error | Action |
| --- | --- |
| Temporary (4xx, timeout) | Retry up to 3 times with 5 / 15 / 60 min back-off |
| Hard bounce (5xx recipient) | Lead → Bounced, suppression list |
| Auth failure | Account → Error, its leads re-routed (Step 1) or held (follow-ups) |
| Provider rate limit | Account paused for 1 hour |

Jobs are taken with a database lock so two workers never send the same email; every send is idempotent on (campaign, lead, step).

## 10. Tracking and reply detection

Opens and clicks are tracked through a custom tracking domain; replies and bounces are found by reading each account's inbox over IMAP.

| Event | How it is detected | Toggle |
| --- | --- | --- |
| Open | 1×1 pixel `https://track.<domain>/o/<token>.gif` in HTML emails | Open tracking |
| Click | Links rewritten to `https://track.<domain>/c/<token>?u=<url>`, then redirected | Click tracking |
| Reply | IMAP worker: new Inbox messages matched by `In-Reply-To` / `References` to a sent `Message-ID`, else by sender email | Always on |
| Auto-reply | Headers such as `Auto-Submitted`, `X-Autoreply`, or out-of-office phrases | Always on |
| Bounce | IMAP: delivery-failure reports from mailer-daemon matched to the original message; plus SMTP 5xx at send time | Always on |
| Unsubscribe | Click on `{{unsubscribeLink}}` or one-click `List-Unsubscribe` | Unsubscribe link |

- The tracking domain is a CNAME (e.g. `track.yourdomain.com`) pointing at the server, so emails never show the app's own hostname.
- Opens are approximate: Apple Mail Privacy Protection and some corporate scanners pre-load images, so opens can be inflated; bot clicks within seconds of delivery are filtered out.
- Each message gets a random `token` so tracking URLs reveal nothing about the lead.

## 11. Unibox

Unibox is one inbox for every lead reply across all connected accounts, where the user reads the thread and replies without leaving MailFlow.

**Layout:** left = conversation list (search, Filter button, All / Unread / Interested tabs); middle = full thread (campaign emails + replies, oldest first) with label dropdown and ⋯ menu; right = lead panel (variables, campaign, step reached, status, notes).

**What it shows:** only replies from campaign leads, plus any new email from an address in a lead list. Warmup emails and newsletters are never shown.

**Replying**

- Reply box with rich text, variables, signature, and saved reply templates.
- The reply is sent from the same account that the lead wrote to, in the same thread (`In-Reply-To` / `References`), and a copy is saved to that mailbox's Sent folder over IMAP so it also shows in Gmail / Outlook.
- Schedule send, and forward to another address.
- Replying never restarts the sequence; the lead stays Replied.

**Organising**

| Feature | Detail |
| --- | --- |
| Lead labels | Interested, Meeting booked, Not interested, Out of office, Wrong person, Do not contact (editable list) |
| Filters | By label, campaign, account, unread, date |
| Search | Lead name, email, company, text in the thread |
| Read / unread | Synced back to the real mailbox |
| Actions | Mark as lead / not a lead, add to suppression, move lead to another campaign |
| Notifications | Unread count in the sidebar; optional email or browser notification for new replies |

**Sync:** the worker uses IMAP IDLE where the server supports it (near-instant), otherwise polls each account's Inbox every 2 minutes, and stores new lead messages; analytics reply counts come from the same data.

## 12. Analytics page

Analytics is the home page after login; it answers "how are my campaigns and mailboxes doing" for a chosen date range (default last 7 days).

**Top bar:** date range button (today, 7d, 30d, custom) + one Filter button (campaign, account).

**KPI cards**

| Card | Formula |
| --- | --- |
| Emails sent | Count of Sent events |
| Open rate | Unique opened leads ÷ leads emailed |
| Click rate | Unique clicked leads ÷ leads emailed |
| Reply rate | Replied leads ÷ leads emailed (auto-replies excluded) |
| Bounce rate | Bounced ÷ emails sent |
| Unsubscribes | Count in range |

Each card shows the change vs the previous period. Open and click cards show "tracking off" when the selected campaigns have tracking disabled.

**Charts and tables**

- Daily line chart: sent, opened, replied per day.
- Campaigns table: name, status, progress bar, sent, open %, reply %.
- Account health table: email, warmup score, sent today / limit.
- Step breakdown (per campaign, on campaign detail): sent, opens, replies for each sequence step.

**Campaign detail page:** KPIs for one campaign (leads contacted, opened, clicked, replied, bounced), a by-step table, and a lead table with status tabs (All, In sequence, Replied, Completed, Bounced), search, last activity and sending account. Pause button + ⋯ menu.

## 13. Architecture and tech stack

MailFlow is two Node.js processes sharing one PostgreSQL database and one Redis queue: a web/API process for the dashboard and tracking, and a worker that does all sending, warmup and inbox reading.

```
Admin dashboard (React) ──REST──▶ Web + API (Node.js) ◀──tracking hits── Lead's mail app
                                     │            │
                               read/write    enqueue jobs
                                     ▼            ▼
                                PostgreSQL     Redis + BullMQ
                                     ▲            ▲
                                     └── Worker (Node.js) ──┘
                                            │  scheduler, rotation, warmup, IMAP polling
                                            ▼
                      Mailbox providers: Gmail, Outlook, custom SMTP / IMAP
```

The dashboard only talks to the API; everything that touches a mailbox goes through the worker (except account connection tests and Unibox replies, which the API may run directly), so the web app stays fast while sends are throttled in the background.

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React + Vite + TypeScript, Tailwind + shadcn/ui, Recharts | Fast, clean Instantly-style UI; charts for analytics |
| API | Node.js + Fastify, TypeScript, Zod validation | One language across the stack |
| Database | PostgreSQL + Prisma ORM | Reliable at 100k+ leads, JSONB for custom fields |
| Queue | Redis + BullMQ | Delayed jobs, retries, per-account rate limits |
| Email | Nodemailer (SMTP), ImapFlow (IMAP, IDLE), XOAUTH2 via google-auth-library for Google accounts, mailparser | Works with any provider |
| Hosting | Docker Compose on a VPS, Caddy for HTTPS | Runs 24/7, simple to move |

## 14. Data model

PostgreSQL tables (main columns only; every table also has `id`, `created_at`, `updated_at`).

| Table | Key columns |
| --- | --- |
| `accounts` | email, from_name, provider, smtp_host, smtp_port, smtp_secure, imap_host, imap_port, username, auth_type (password / google_oauth / google_dwd), password_enc, oauth_refresh_token_enc, oauth_expires_at, workspace_id, daily_limit, gap_min_minutes, signature_html, status, last_error, last_checked_at, next_send_at, tags[] |
| `warmup_settings` | account_id, enabled, start_volume, increase_per_day, max_volume, reply_rate, started_on |
| `warmup_messages` | from_account_id, to_account_id, message_id, code, sent_at, landed (inbox / spam / unknown), rescued_at, replied_at |
| `lead_lists` | name |
| `leads` | list_id, email, first_name, last_name, company, custom_fields (JSONB), status |
| `suppression` | email or domain, reason (unsubscribed / bounced / manual) |
| `campaigns` | name, status, list_id, timezone, days[], window_start, window_end, start_at, gap_min, gap_max, daily_limit, new_leads_per_day, priority, track_opens, track_clicks, stop_on_reply, stop_on_auto_reply, plain_text, unsubscribe_footer |
| `campaign_accounts` | campaign_id, account_id |
| `sequence_steps` | campaign_id, position, delay_days, subject, body_html, body_text |
| `campaign_leads` | campaign_id, lead_id, account_id (assigned sender), current_step, next_due_at, state (active / replied / bounced / unsubscribed / completed), thread_message_id |
| `messages` | campaign_id, lead_id, step_id, account_id, message_id, token, status (queued / sent / failed), sent_at, error, retry_count |
| `events` | message_id, type (open / click / reply / auto_reply / bounce / unsubscribe), url, ip, user_agent, at |
| `daily_stats` | date, campaign_id, account_id, sent, opens, clicks, replies, bounces (rolled up for fast analytics) |
| `settings` | admin email, password hash, tracking domain, default timezone |
| `threads` | account_id, lead_id, campaign_id, subject, last_message_at, unread, label, is_lead, notes |
| `inbox_messages` | thread_id, account_id, direction (in / out), message_id, in_reply_to, from_email, to_email, subject, body_html, body_text, received_at, imap_uid |
| `reply_templates` | name, subject, body_html |
| `lead_labels` | name, color, position |
| `google_workspaces` | domain, service_account_json_enc, admin_email (for domain-wide connect) |
| `account_imports` | source (csv / google / dwd), total, succeeded, failed, report (JSONB) |

Indexes: `campaign_leads (state, next_due_at)` for the scheduler, `messages (message_id)` and `messages (token)` for reply and tracking lookups, `events (message_id, type)`.

## 15. API endpoints

REST JSON API under `/api`, protected by a session cookie; tracking routes are public.

| Method + path | Purpose |
| --- | --- |
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` | Admin session |
| `GET / POST /api/accounts` | List / add account |
| `POST /api/accounts/test` | Test SMTP + IMAP before saving |
| `GET / PATCH / DELETE /api/accounts/:id` | Detail, edit settings, pause, remove |
| `POST /api/accounts/:id/check` | Re-test connection, update status |
| `PATCH /api/accounts/bulk` | Apply limit, gap, signature, warmup, tags, pause/resume to many accounts |
| `POST /api/accounts/import-csv`, `GET /api/accounts/csv-template` | Bulk SMTP / IMAP import; per-row pass / fail |
| `GET /api/oauth/google/start` | Redirect to Google consent (`?again=1` reopens the chooser for the next mailbox) |
| `GET /api/oauth/google/callback` | Save tokens, create or reconnect the account |
| `POST /api/google-workspaces` | Save service account for domain-wide connect |
| `GET /api/google-workspaces/:id/users` | List mailboxes in the domain |
| `POST /api/google-workspaces/:id/connect` | Connect selected mailboxes in one step |
| `GET / PATCH /api/accounts/:id/warmup` | Warmup settings + score + history |
| `POST /api/lists`, `POST /api/lists/:id/import` | Create list, upload CSV with column mapping |
| `GET /api/lists/:id/leads` | Paginated leads with filters |
| `GET / POST /api/campaigns` | List / create draft |
| `GET / PATCH /api/campaigns/:id` | Detail, update settings |
| `PUT /api/campaigns/:id/steps` | Save full sequence |
| `PUT /api/campaigns/:id/accounts` | Set sending accounts |
| `POST /api/campaigns/:id/preview` | Render a step for a given lead |
| `POST /api/campaigns/:id/test-email` | Send a test to the admin |
| `POST /api/campaigns/:id/launch` / `pause` / `resume` | State changes |
| `GET /api/campaigns/:id/leads` | Lead table with per-lead status |
| `GET /api/analytics/overview?from&to&campaign&account` | KPI cards + daily series |
| `GET /api/analytics/campaigns`, `/accounts`, `/steps?campaign=` | Tables |
| `GET / POST / DELETE /api/suppression` | Manage block list |
| `GET /api/unibox/threads?label&campaign&account&unread&q` | Conversation list |
| `GET /api/unibox/threads/:id` | Full thread + lead panel data |
| `POST /api/unibox/threads/:id/reply` | Send reply from the right account, in thread |
| `PATCH /api/unibox/threads/:id` | Label, read / unread, is_lead, notes |
| `GET / POST /api/reply-templates` | Saved replies |
| `GET /o/:token.gif` | Open pixel (public) |
| `GET /c/:token?u=` | Click redirect (public) |
| `GET / POST /u/:token` | Unsubscribe page and one-click (public) |

## 16. Security and deliverability

**Security**

- Single admin login; password hashed with bcrypt / argon2; session cookie HttpOnly + Secure; login rate-limited.
- Mailbox passwords, Google refresh tokens and service-account keys encrypted at rest (AES-256-GCM) with a key from the `ENCRYPTION_KEY` environment variable, never returned by the API.
- HTTPS everywhere (Let's Encrypt via Caddy).
- Daily database backup to off-server storage.

**Deliverability checklist (shown in-app per domain)**

| Check | Requirement |
| --- | --- |
| SPF | TXT record authorising the mail provider |
| DKIM | Signing enabled at the provider (Google / Microsoft / host) |
| DMARC | `v=DMARC1; p=none` at minimum, with reporting address |
| Separate domains | Send campaigns from secondary domains, not the main company domain |
| Volume | 30–50 campaign emails / mailbox / day; scale by adding mailboxes |
| Warmup | 2–3 weeks before first campaign; keep running |
| Content | Few links, no attachments, plain text preferred for Step 1 |
| List hygiene | Verify emails before import; keep bounce rate under 2% |

The app can check SPF, DKIM and DMARC by DNS lookup and show green / red per sending domain.

**Compliance:** every campaign email carries an unsubscribe option and the suppression list is honoured; the user is responsible for following CAN-SPAM, GDPR and local laws for the countries they email.

## 17. Deployment and setup

MailFlow runs on one Linux VPS (2 vCPU, 4 GB RAM is enough for dozens of mailboxes) using Docker Compose. The VPS must allow outbound port 587 (Hetzner does; DigitalOcean and Linode block it by default).

**Services**

| Container | Role |
| --- | --- |
| `web` | Node.js API + built React dashboard |
| `worker` | Sending engine, warmup, IMAP polling, stats roll-up |
| `postgres` | Database |
| `redis` | Job queue (BullMQ) and locks |
| `caddy` | HTTPS reverse proxy for the app and tracking domain |

**Setup steps**

1. Rent a VPS (Ubuntu 24.04) and point `app.yourdomain.com` and `track.yourdomain.com` at its IP.
2. Install Docker; copy the project; fill `.env` (`DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_KEY`, `SESSION_SECRET`, `APP_URL`, `TRACKING_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).
3. `docker compose up -d`; migrations run on start.
4. Log in, connect mailboxes, switch on warmup.
5. After 2–3 weeks of warmup, import leads and launch the first campaign.

The worker must run 24/7; a laptop that sleeps will pause sending and warmup.

## 18. Roadmap and acceptance criteria

| Phase | Delivers | Done when |
| --- | --- | --- |
| 1. Foundation + accounts | Login, accounts CRUD, Connect with Google, bulk connect (Google loop, domain-wide, CSV), SMTP/IMAP test, encryption, health status | 20 mailboxes (Google + CSV) connect in one session and each sends a test email |
| 2. Campaigns | Lead import, variables, sequence editor, settings, sending engine, rotation, stop rules | A 3-step campaign over 3 accounts respects gap, window and delays; a reply stops the lead |
| 3. Tracking + Unibox + analytics | Pixel, click redirect, unsubscribe, reply / bounce detection, Unibox with in-thread replies, analytics page | Test events appear in analytics within 5 minutes; a reply shows in Unibox and an answer sent from Unibox lands in the same Gmail thread |
| 4. Warmup | Pool, ramp-up, spam rescue, replies, score | With 5 accounts, warmup runs 7 days unattended and every account shows a score |
| 5. Deploy | Production compose, Caddy, backups, DEPLOY.md | App runs on a VPS over HTTPS with tracking domain |
