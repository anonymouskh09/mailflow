# Deploying MailFlow on a VPS (Ubuntu 24.04)

MailFlow runs as five containers on one server: `web` (API + dashboard), `worker` (sending, warmup, inbox reading, stats), `postgres`, `redis` and `caddy` (HTTPS). 2 vCPU / 4 GB RAM is enough for dozens of mailboxes.

The worker must run 24/7. A laptop that sleeps pauses sending and warmup.

---

## 1. Pick a VPS that allows outbound port 587

MailFlow sends over SMTP port **587** (STARTTLS) by default. Some providers block outbound mail ports on new accounts:

| Provider | Outbound 587 |
| --- | --- |
| Hetzner | Open (25 and 465 are blocked on new accounts; 587 works) |
| DigitalOcean, Linode/Akamai, Vultr | Often blocked by default; open a support ticket to unblock |

Check from the server once it is running:

```bash
nc -vz smtp.gmail.com 587
```

## 2. DNS

You need two hostnames pointing at the server's IP address (A records, or AAAA for IPv6):

| Record | Example | Purpose |
| --- | --- | --- |
| `A app` | `app.yourdomain.com → 203.0.113.10` | Dashboard |
| `A track` | `track.yourdomain.com → 203.0.113.10` | Open pixel, click and unsubscribe links |

Use a domain you do not send cold email from for the dashboard if you can. The tracking domain can be a subdomain of a sending domain, which helps links look consistent.

### Sending domains: SPF, DKIM, DMARC

Set these on **every domain you send from** (at your DNS host). MailFlow checks them in **Settings → Deliverability → Check DNS**.

| Record | Google Workspace | Microsoft 365 | Other host |
| --- | --- | --- | --- |
| SPF (TXT on `@`) | `v=spf1 include:_spf.google.com ~all` | `v=spf1 include:spf.protection.outlook.com ~all` | Your host's include |
| DKIM | Admin console → Apps → Gmail → Authenticate email → generate, add the `google._domainkey` TXT, then click **Start authentication** | Defender portal → Email authentication → DKIM → enable, add the two `selector1/selector2` CNAMEs | Enable in your host's panel |
| DMARC (TXT on `_dmarc`) | `v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com` | same | same |

Only one SPF record per domain; merge includes if you use several providers.

## 3. Install Docker

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl git
```

```bash
curl -fsSL https://get.docker.com | sudo sh
```

```bash
sudo usermod -aG docker $USER && newgrp docker
```

Open the firewall for web traffic if you use `ufw`:

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw enable
```

## 4. Get the code and configure

```bash
git clone https://github.com/<you>/mailflow.git && cd mailflow
```

```bash
cp .env.example .env
```

Generate secrets:

```bash
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"; echo "SESSION_SECRET=$(openssl rand -hex 32)"; echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
```

Edit `.env` (`nano .env`) and set at least:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `ENCRYPTION_KEY` | 64 hex characters from above. **Back this up.** Without it, stored mailbox passwords and tokens cannot be decrypted. |
| `SESSION_SECRET` | from above |
| `POSTGRES_PASSWORD` | from above |
| `APP_URL` | `https://app.yourdomain.com` |
| `TRACKING_URL` | `https://track.yourdomain.com` |
| `APP_DOMAIN` | `app.yourdomain.com` |
| `TRACKING_DOMAIN` | `track.yourdomain.com` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | your login (password ≥ 10 characters) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | from step 6 (optional) |
| `DELAY_UNIT` | `days` |
| `DEV_SMTP_OVERRIDE` | empty |
| `DEV_IGNORE_SCHEDULE` | `false` |

Remove or leave `DATABASE_URL` and `REDIS_URL` as they are: `docker-compose.prod.yml` points them at the internal containers.

## 5. Start

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Migrations run automatically when `web` starts. Caddy requests HTTPS certificates on first visit (ports 80 and 443 must reach the server, and DNS must already point at it).

Check:

```bash
docker compose -f docker-compose.prod.yml ps
```

```bash
docker compose -f docker-compose.prod.yml logs -f web worker
```

Open `https://app.yourdomain.com`, sign in, then in **Settings** set the tracking domain to `track.yourdomain.com` and your timezone.

After the first successful login you can remove `ADMIN_PASSWORD` from `.env` and change the password in Settings instead (otherwise the `.env` value is applied again on every restart).

## 6. Google Cloud: "Connect with Google" (optional but recommended for Gmail)

1. Go to <https://console.cloud.google.com/>, create a project (e.g. "MailFlow").
2. **APIs & Services → Library**: enable **Gmail API** (and **Admin SDK API** if you will use domain-wide connect).
3. **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding / Audience):
   - **Internal** if all mailboxes are in your own Google Workspace organisation. No verification needed.
   - **External** for personal @gmail.com or other organisations' mailboxes. Then **publish the app ("In production")**: an app left in *Testing* loses its tokens after 7 days. Without Google verification users see an "unverified app" warning (click *Advanced → Go to MailFlow*) and the app is capped at 100 users, which is fine for your own use. A public launch would need verification and a yearly security assessment because `https://mail.google.com/` is a restricted scope.
   - Scopes (Data access): `https://mail.google.com/`, `openid`, `email`, `profile`.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorised redirect URI: `https://app.yourdomain.com/api/oauth/google/callback`
5. Copy the client ID and secret into `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, then restart:

```bash
docker compose -f docker-compose.prod.yml up -d
```

In MailFlow: **Email accounts → Add accounts → Connect with Google**. With *Keep adding* ticked, the Google account chooser reopens after each mailbox so you can connect 10–20 in a row.

### Google Workspace domain-wide connect (many mailboxes on domains you own)

1. In the same Cloud project: **IAM & Admin → Service accounts → Create**. No roles needed. Open it → **Keys → Add key → JSON** and download the file.
2. Note the service account's **Client ID** (numeric, on its details page).
3. In the Workspace **Admin console** (<https://admin.google.com>) → **Security → Access and data control → API controls → Manage domain-wide delegation → Add new**:
   - Client ID: the numeric ID from step 2
   - Scopes: `https://mail.google.com/,https://www.googleapis.com/auth/admin.directory.user.readonly`
4. In MailFlow: **Add accounts → Whole Google Workspace domain**, enter the domain, a Workspace admin email and paste the JSON key. MailFlow lists the domain's mailboxes; select and connect them in one step.

The JSON key is stored encrypted (AES-256-GCM) and never shown again.

## 7. Outlook / Microsoft 365

Use **Add accounts → Outlook / Microsoft 365** with the mailbox address and an app password (if MFA is on). The tenant must allow **SMTP AUTH** for the mailbox: Microsoft 365 admin center → Users → select user → Mail → *Manage email apps* → tick **Authenticated SMTP**. Security defaults in Entra ID can block it; see Microsoft's "Enable or disable SMTP AUTH" guide.

## 8. Backups

`scripts/backup.sh` writes a compressed `pg_dump` to `./backups` and keeps 14 days. Copy it off the server with [rclone](https://rclone.org/) by setting `RCLONE_REMOTE` (e.g. a Backblaze B2 or S3 bucket configured with `rclone config`).

Run it daily at 03:15 with cron (`crontab -e`):

```
15 3 * * * cd /home/<you>/mailflow && RCLONE_REMOTE=b2:mailflow-backups ./scripts/backup.sh >> backups/backup.log 2>&1
```

Restore:

```bash
./scripts/restore.sh backups/mailflow-20261126-031500.sql.gz
```

Also keep a copy of `.env` (especially `ENCRYPTION_KEY`) somewhere safe and off the server.

## 9. Updating

```bash
git pull && docker compose -f docker-compose.prod.yml up -d --build
```

Migrations run on start. Take a backup first.

## 10. Health and troubleshooting

- `web` health: `GET /api/health` (checks the database). `worker` health: the send loop touches a heartbeat file every 30 s; Docker marks the container unhealthy if it stops.
- Logs never contain passwords, tokens or keys.
- **Emails not sending**: check the campaign is Active, inside its schedule window and timezone, the accounts are Active and under their daily limit (Email accounts page), and `docker compose logs worker`.
- **"SMTP server unreachable (ETIMEDOUT)"**: the VPS blocks port 587 (see step 1).
- **Google account goes to Error**: the user revoked access or changed the password; click **Reconnect**. An External OAuth app still in *Testing* also expires tokens after 7 days.
- **Tracking links 404**: `TRACKING_DOMAIN` DNS must point at the server and Settings → Tracking domain must match.
- **Certificates fail**: DNS not yet pointing at the server, or ports 80/443 blocked. `docker compose -f docker-compose.prod.yml logs caddy`.
