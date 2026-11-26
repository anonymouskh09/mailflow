import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@mailflow/db';
import {
  env,
  encrypt,
  decrypt,
  oauthClient,
  googleConfigured,
  GOOGLE_SCOPES,
  PRESETS,
  testConnection,
  parseServiceAccount,
  dwdClient,
  clearTokenCache,
  publicAccount,
} from '@mailflow/core';
import { sign, safeEqual } from '../auth.js';
import { badRequest, notFound, mapLimit } from '../util.js';

function makeState(data: object): string {
  const p = Buffer.from(JSON.stringify({ ...data, exp: Date.now() + 15 * 60_000 })).toString('base64url');
  return `${p}.${sign(p)}`;
}

function readState(state: string): { again?: boolean; exp: number } | null {
  const [p, s] = state.split('.');
  if (!p || !s || !safeEqual(s, sign(p))) return null;
  const data = JSON.parse(Buffer.from(p, 'base64url').toString());
  return data.exp > Date.now() ? data : null;
}

const appUrl = () => env().APP_URL.replace(/\/$/, '');

export async function googleRoutes(app: FastifyInstance) {
  app.get('/api/oauth/google/status', async () => ({ configured: googleConfigured() }));

  app.get('/api/oauth/google/start', async (req, reply) => {
    const q = z.object({ again: z.string().optional(), hint: z.string().optional() }).parse(req.query);
    if (!googleConfigured()) return reply.redirect(`${appUrl()}/accounts?google=error&message=${encodeURIComponent('Google OAuth is not configured: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET')}`);
    const url = oauthClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent select_account',
      scope: GOOGLE_SCOPES,
      include_granted_scopes: true,
      login_hint: q.hint,
      state: makeState({ again: q.again === '1' }),
    });
    return reply.redirect(url);
  });

  app.get('/api/oauth/google/callback', async (req, reply) => {
    const q = z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }).parse(req.query);
    const fail = (msg: string) => reply.redirect(`${appUrl()}/accounts?google=error&message=${encodeURIComponent(msg)}`);
    if (q.error) return fail(q.error === 'access_denied' ? 'Google sign-in was cancelled' : `Google returned: ${q.error}`);
    const state = q.state ? readState(q.state) : null;
    if (!q.code || !state) return fail('Sign-in link expired, please try again');
    try {
      const client = oauthClient();
      const { tokens } = await client.getToken(q.code);
      if (!tokens.id_token || !tokens.access_token) return fail('Google did not return the expected tokens');
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env().GOOGLE_CLIENT_ID });
      const profile = ticket.getPayload();
      const email = profile?.email?.toLowerCase();
      if (!email) return fail('Could not read the email address from Google');
      const existing = await prisma.account.findUnique({ where: { email } });
      const refresh = tokens.refresh_token ? encrypt(tokens.refresh_token) : existing?.oauthRefreshTokenEnc;
      if (!refresh) return fail('Google did not return a refresh token. Remove MailFlow at myaccount.google.com/permissions and try again.');
      const p = PRESETS.google;
      const draft = {
        id: existing?.id ?? 'draft',
        email,
        fromName: existing?.fromName ?? profile?.name ?? email,
        ...p,
        username: email,
        authType: 'google_oauth',
        passwordEnc: null,
        oauthRefreshTokenEnc: refresh,
      };
      const test = await testConnection(draft, { accessToken: tokens.access_token });
      const data = {
        provider: 'google' as const,
        ...p,
        username: email,
        authType: 'google_oauth' as const,
        oauthRefreshTokenEnc: refresh,
        oauthExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        smtpOk: test.smtp.ok,
        imapOk: test.imap.ok,
        lastError: [test.smtp.error, test.imap.error].filter(Boolean).join(' · ') || null,
        lastCheckedAt: new Date(),
        status: test.ok ? ('active' as const) : ('error' as const),
      };
      const acct = await prisma.account.upsert({
        where: { email },
        update: { ...data, status: existing?.status === 'paused' ? 'paused' : data.status },
        create: { email, fromName: profile?.name ?? email, ...data, warmup: { create: { enabled: true, startedOn: new Date() } } },
      });
      clearTokenCache(acct.id);
      await prisma.accountImport.create({ data: { source: 'google', total: 1, succeeded: test.ok ? 1 : 0, failed: test.ok ? 0 : 1, report: [{ email, smtp: test.smtp, imap: test.imap }] as any } });
      const params = new URLSearchParams({ google: test.ok ? 'ok' : 'error', email });
      if (!test.ok) params.set('message', data.lastError ?? 'Connection test failed');
      if (state.again) params.set('again', '1');
      return reply.redirect(`${appUrl()}/accounts?${params}`);
    } catch (err: any) {
      req.log.warn({ err: err?.message }, 'google oauth callback failed');
      return fail(`Google sign-in failed: ${err?.response?.data?.error_description ?? err?.message ?? 'unknown error'}`);
    }
  });

  // ---- Google Workspace domain-wide delegation ----

  async function listDomainUsers(ws: { domain: string; adminEmail: string; serviceAccountJsonEnc: string }) {
    const key = parseServiceAccount(decrypt(ws.serviceAccountJsonEnc));
    const jwt = dwdClient(key, ws.adminEmail, ['https://www.googleapis.com/auth/admin.directory.user.readonly']);
    const users: { email: string; name: string; suspended: boolean }[] = [];
    let pageToken: string | undefined;
    do {
      const res = await jwt.request<{ users?: any[]; nextPageToken?: string }>({
        url: 'https://admin.googleapis.com/admin/directory/v1/users',
        params: { domain: ws.domain, maxResults: 500, pageToken, orderBy: 'email' },
      });
      for (const u of res.data.users ?? []) users.push({ email: String(u.primaryEmail).toLowerCase(), name: u.name?.fullName ?? '', suspended: !!u.suspended });
      pageToken = res.data.nextPageToken;
    } while (pageToken);
    return users;
  }

  const wsErr = (err: any) => err?.response?.data?.error_description ?? err?.response?.data?.error?.message ?? err?.message ?? 'unknown error';

  app.get('/api/google-workspaces', async () => {
    const list = await prisma.googleWorkspace.findMany({ orderBy: { createdAt: 'asc' }, include: { _count: { select: { accounts: true } } } });
    return { workspaces: list.map((w) => ({ id: w.id, domain: w.domain, adminEmail: w.adminEmail, accounts: w._count.accounts })) };
  });

  app.post('/api/google-workspaces', async (req) => {
    const b = z
      .object({
        domain: z.string().trim().toLowerCase().min(3).max(255),
        adminEmail: z.string().trim().toLowerCase().email(),
        serviceAccountJson: z.string().min(20).max(20000),
      })
      .parse(req.body);
    try {
      parseServiceAccount(b.serviceAccountJson);
    } catch (e: any) {
      throw badRequest(`Invalid service account JSON: ${e.message}`);
    }
    const enc = encrypt(b.serviceAccountJson);
    try {
      await listDomainUsers({ domain: b.domain, adminEmail: b.adminEmail, serviceAccountJsonEnc: enc });
    } catch (err) {
      throw badRequest(`Could not list users of ${b.domain}: ${wsErr(err)}. Check domain-wide delegation scopes (mail.google.com and admin.directory.user.readonly).`);
    }
    const ws = await prisma.googleWorkspace.upsert({
      where: { domain: b.domain },
      update: { adminEmail: b.adminEmail, serviceAccountJsonEnc: enc },
      create: { domain: b.domain, adminEmail: b.adminEmail, serviceAccountJsonEnc: enc },
    });
    return { id: ws.id, domain: ws.domain, adminEmail: ws.adminEmail };
  });

  app.get('/api/google-workspaces/:id/users', async (req) => {
    const { id } = req.params as { id: string };
    const ws = await prisma.googleWorkspace.findUnique({ where: { id } });
    if (!ws) throw notFound('Workspace not found');
    let users;
    try {
      users = await listDomainUsers(ws);
    } catch (err) {
      throw badRequest(`Could not list users: ${wsErr(err)}`);
    }
    const existing = new Set((await prisma.account.findMany({ where: { email: { in: users.map((u) => u.email) } }, select: { email: true } })).map((a) => a.email));
    return { users: users.map((u) => ({ ...u, connected: existing.has(u.email) })) };
  });

  app.post('/api/google-workspaces/:id/connect', async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ emails: z.array(z.string().email()).min(1).max(500), warmup: z.boolean().default(true), dailyLimit: z.number().int().min(1).max(2000).optional() }).parse(req.body);
    const ws = await prisma.googleWorkspace.findUnique({ where: { id } });
    if (!ws) throw notFound('Workspace not found');
    const p = PRESETS.google;
    const rows = await mapLimit(b.emails, 5, async (raw) => {
      const email = raw.toLowerCase();
      try {
        const jwt = dwdClient(parseServiceAccount(decrypt(ws.serviceAccountJsonEnc)), email);
        const tok = await jwt.authorize();
        const draft = { id: 'draft', email, fromName: email, ...p, username: email, authType: 'google_dwd', passwordEnc: null, oauthRefreshTokenEnc: null };
        const test = await testConnection(draft, { accessToken: tok.access_token ?? '' });
        const data = {
          provider: 'google' as const,
          ...p,
          username: email,
          authType: 'google_dwd' as const,
          workspaceId: ws.id,
          smtpOk: test.smtp.ok,
          imapOk: test.imap.ok,
          lastError: [test.smtp.error, test.imap.error].filter(Boolean).join(' · ') || null,
          lastCheckedAt: new Date(),
          status: test.ok ? ('active' as const) : ('error' as const),
        };
        const acct = await prisma.account.upsert({
          where: { email },
          update: data,
          create: {
            email,
            fromName: email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
            ...data,
            dailyLimit: b.dailyLimit ?? 30,
            warmup: { create: { enabled: b.warmup, startedOn: b.warmup ? new Date() : null } },
          },
          include: { warmup: true },
        });
        clearTokenCache(acct.id);
        return { email, ok: test.ok, smtp: test.smtp, imap: test.imap, account: publicAccount(acct) };
      } catch (err) {
        return { email, ok: false, error: wsErr(err) };
      }
    });
    const succeeded = rows.filter((r) => r.ok).length;
    await prisma.accountImport.create({ data: { source: 'dwd', total: rows.length, succeeded, failed: rows.length - succeeded, report: rows.map(({ account: _a, ...r }) => r) as any } });
    return { total: rows.length, succeeded, failed: rows.length - succeeded, rows };
  });
}
