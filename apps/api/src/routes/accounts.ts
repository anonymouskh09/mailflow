import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import Papa from 'papaparse';
import { prisma, type Prisma } from '@mailflow/db';
import {
  accountInputSchema,
  createPasswordAccount,
  testAccountInput,
  publicAccount,
  checkAccount,
  usageToday,
  warmupStats,
  warmupDaily,
  warmupTarget,
  warmupDayIndex,
  getSettings,
  encrypt,
  zonedParts,
  isValidEmail,
} from '@mailflow/core';
import { notFound, badRequest, mapLimit, sendCsv } from '../util.js';

export const CSV_TEMPLATE_HEADERS = ['email', 'from_name', 'password', 'smtp_host', 'smtp_port', 'imap_host', 'imap_port', 'daily_limit', 'warmup', 'username'];

export function displayStatus(a: { status: string; dailyLimit: number; pausedUntil: Date | null }, sentCampaign: number, now = new Date()) {
  if (a.status === 'paused') return 'paused';
  if (a.status === 'error') return 'error';
  if (a.pausedUntil && a.pausedUntil > now) return 'limit';
  if (sentCampaign >= a.dailyLimit) return 'limit';
  return 'active';
}

const patchSchema = z.object({
  fromName: z.string().trim().min(1).max(120).optional(),
  dailyLimit: z.coerce.number().int().min(1).max(2000).optional(),
  gapMinMinutes: z.coerce.number().int().min(0).max(1440).optional(),
  signatureHtml: z.string().max(20000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  status: z.enum(['active', 'paused']).optional(),
  password: z.string().min(1).max(500).optional(),
  smtpHost: z.string().trim().min(1).max(255).optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  imapHost: z.string().trim().min(1).max(255).optional(),
  imapPort: z.coerce.number().int().min(1).max(65535).optional(),
  imapSecure: z.boolean().optional(),
  username: z.string().trim().min(1).max(320).optional(),
  warmup: z
    .object({
      enabled: z.boolean().optional(),
      startVolume: z.coerce.number().int().min(1).max(100).optional(),
      increasePerDay: z.coerce.number().int().min(0).max(50).optional(),
      maxVolume: z.coerce.number().int().min(1).max(200).optional(),
      replyRate: z.coerce.number().int().min(0).max(100).optional(),
      workingDays: z.array(z.number().int().min(0).max(6)).optional(),
      weekendFactor: z.coerce.number().int().min(0).max(100).optional(),
      keepDuringCampaigns: z.boolean().optional(),
    })
    .optional(),
});

const bulkSchema = z.object({
  ids: z.array(z.string()).min(1).max(1000),
  dailyLimit: z.coerce.number().int().min(1).max(2000).optional(),
  gapMinMinutes: z.coerce.number().int().min(0).max(1440).optional(),
  signatureHtml: z.string().max(20000).optional(),
  warmup: z.boolean().optional(),
  addTags: z.array(z.string().trim().min(1).max(40)).optional(),
  removeTags: z.array(z.string().trim().min(1).max(40)).optional(),
  status: z.enum(['active', 'paused']).optional(),
  delete: z.boolean().optional(),
});

async function warmupInfo(accountId: string) {
  const now = new Date();
  const s = await getSettings();
  const a = await prisma.account.findUniqueOrThrow({ where: { id: accountId }, include: { warmup: true } });
  const stats = (await warmupStats([accountId], now)).get(accountId)!;
  const daily = await warmupDaily(accountId, now, s.defaultTimezone, 14);
  const w = a.warmup;
  const target = w?.enabled ? warmupTarget(w, warmupDayIndex(w.startedOn, now, s.defaultTimezone), zonedParts(now, s.defaultTimezone).weekday) : 0;
  return { settings: publicAccount(a).warmup, stats, daily, todayTarget: target };
}

export async function accountRoutes(app: FastifyInstance) {
  app.get('/api/accounts', async (req) => {
    const q = z.object({ q: z.string().optional(), status: z.string().optional(), tag: z.string().optional() }).parse(req.query);
    const where: Prisma.AccountWhereInput = {};
    if (q.q) where.OR = [{ email: { contains: q.q, mode: 'insensitive' } }, { fromName: { contains: q.q, mode: 'insensitive' } }, { tags: { has: q.q } }];
    if (q.tag) where.tags = { has: q.tag };
    const accounts = await prisma.account.findMany({ where, include: { warmup: true }, orderBy: { createdAt: 'asc' } });
    const now = new Date();
    const s = await getSettings();
    const ids = accounts.map((a) => a.id);
    const [usage, scores] = await Promise.all([usageToday(ids, now, s.defaultTimezone), warmupStats(ids, now)]);
    let rows = accounts.map((a) => {
      const u = usage.get(a.id)!;
      return {
        ...publicAccount(a),
        sentToday: u.campaign,
        warmupSentToday: u.warmup,
        warmupScore: scores.get(a.id)?.score ?? null,
        displayStatus: displayStatus(a, u.campaign, now),
      };
    });
    if (q.status) rows = rows.filter((r) => r.displayStatus === q.status);
    const tags = [...new Set(accounts.flatMap((a) => a.tags))].sort();
    return { accounts: rows, tags };
  });

  app.post('/api/accounts/test', async (req) => {
    const input = accountInputSchema.parse(req.body);
    return testAccountInput(input);
  });

  app.post('/api/accounts', async (req, reply) => {
    const input = accountInputSchema.parse(req.body);
    const res = await createPasswordAccount(input);
    if (!res.account) return reply.code(422).send({ error: 'Connection test failed', test: res.test });
    return { test: res.test, account: publicAccount({ ...res.account, warmup: null }) };
  });

  app.get('/api/accounts/csv-template', async (_req, reply) => {
    const sample = ['jane@yourdomain.com', 'Jane Doe', 'app-password', 'smtp.office365.com', '587', 'outlook.office365.com', '993', '30', 'yes', ''];
    return sendCsv(reply, 'mailflow-accounts-template.csv', `${CSV_TEMPLATE_HEADERS.join(',')}\n${sample.join(',')}\n`);
  });

  app.post('/api/accounts/import-csv', async (req) => {
    const body = z.object({ csv: z.string().min(1).max(5_000_000) }).parse(req.body);
    const parsed = Papa.parse<Record<string, string>>(body.csv.trim(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_') });
    if (!parsed.data.length) throw badRequest('The CSV has no rows');
    if (!parsed.meta.fields?.includes('email')) throw badRequest('The CSV needs an "email" column — download the template');
    if (parsed.data.length > 500) throw badRequest('Import at most 500 accounts at a time');
    const rows = await mapLimit(parsed.data, 5, async (r, i) => {
      const email = (r.email ?? '').trim().toLowerCase();
      const base = { row: i + 2, email };
      try {
        if (!isValidEmail(email)) return { ...base, ok: false, smtp: null, imap: null, error: 'Invalid email address' };
        const host = (r.smtp_host ?? '').toLowerCase();
        const provider = host.includes('office365') || host.includes('outlook') ? 'outlook' : host.includes('gmail') ? 'google' : 'custom';
        const input = accountInputSchema.parse({
          provider,
          email,
          fromName: r.from_name?.trim() || email.split('@')[0],
          password: r.password ?? '',
          username: r.username?.trim() || undefined,
          smtpHost: r.smtp_host?.trim() || undefined,
          smtpPort: r.smtp_port?.trim() || undefined,
          imapHost: r.imap_host?.trim() || undefined,
          imapPort: r.imap_port?.trim() || undefined,
          dailyLimit: r.daily_limit?.trim() || undefined,
          warmup: r.warmup ? /^(y|yes|true|1|on)$/i.test(r.warmup.trim()) : true,
        });
        const res = await createPasswordAccount(input);
        return { ...base, ok: !!res.account, id: res.account?.id, smtp: res.test.smtp, imap: res.test.imap, error: res.account ? undefined : [res.test.smtp.error, res.test.imap.error].filter(Boolean).join(' · ') };
      } catch (err: any) {
        const msg = err?.issues ? err.issues.map((x: any) => `${x.path.join('.')}: ${x.message}`).join('; ') : err.message;
        return { ...base, ok: false, smtp: null, imap: null, error: msg };
      }
    });
    const succeeded = rows.filter((r) => r.ok).length;
    const imp = await prisma.accountImport.create({ data: { source: 'csv', total: rows.length, succeeded, failed: rows.length - succeeded, report: rows as any } });
    return { id: imp.id, total: rows.length, succeeded, failed: rows.length - succeeded, rows };
  });

  app.patch('/api/accounts/bulk', async (req) => {
    const b = bulkSchema.parse(req.body);
    if (b.delete) {
      const r = await prisma.account.deleteMany({ where: { id: { in: b.ids } } });
      return { updated: r.count };
    }
    const data: Prisma.AccountUpdateManyMutationInput = {};
    if (b.dailyLimit !== undefined) data.dailyLimit = b.dailyLimit;
    if (b.gapMinMinutes !== undefined) data.gapMinMinutes = b.gapMinMinutes;
    if (b.signatureHtml !== undefined) data.signatureHtml = b.signatureHtml;
    if (b.status) data.status = b.status;
    await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length) {
        if (b.status === 'active') {
          // resuming must not hide connection errors: only un-pause paused accounts
          await tx.account.updateMany({ where: { id: { in: b.ids }, status: 'paused' }, data: { ...data, status: 'active' } });
          const { status: _s, ...rest } = data;
          if (Object.keys(rest).length) await tx.account.updateMany({ where: { id: { in: b.ids } }, data: rest });
        } else await tx.account.updateMany({ where: { id: { in: b.ids } }, data });
      }
      if (b.addTags?.length || b.removeTags?.length) {
        const accts = await tx.account.findMany({ where: { id: { in: b.ids } }, select: { id: true, tags: true } });
        for (const a of accts) {
          const set = new Set(a.tags);
          b.addTags?.forEach((t) => set.add(t));
          b.removeTags?.forEach((t) => set.delete(t));
          await tx.account.update({ where: { id: a.id }, data: { tags: [...set] } });
        }
      }
      if (b.warmup !== undefined) {
        for (const id of b.ids) {
          const existing = await tx.warmupSettings.findUnique({ where: { accountId: id } });
          await tx.warmupSettings.upsert({
            where: { accountId: id },
            update: { enabled: b.warmup, startedOn: b.warmup ? (existing?.startedOn ?? new Date()) : existing?.startedOn },
            create: { accountId: id, enabled: b.warmup, startedOn: b.warmup ? new Date() : null },
          });
        }
      }
    });
    return { updated: b.ids.length };
  });

  app.get('/api/accounts/:id', async (req) => {
    const { id } = req.params as { id: string };
    const a = await prisma.account.findUnique({ where: { id }, include: { warmup: true } });
    if (!a) throw notFound('Account not found');
    const s = await getSettings();
    const u = (await usageToday([id], new Date(), s.defaultTimezone)).get(id)!;
    const campaigns = await prisma.campaignAccount.findMany({ where: { accountId: id }, include: { campaign: { select: { id: true, name: true, status: true } } } });
    return {
      account: { ...publicAccount(a), sentToday: u.campaign, warmupSentToday: u.warmup, displayStatus: displayStatus(a, u.campaign) },
      warmup: await warmupInfo(id),
      campaigns: campaigns.map((c) => c.campaign),
    };
  });

  app.patch('/api/accounts/:id', async (req) => {
    const { id } = req.params as { id: string };
    const b = patchSchema.parse(req.body);
    const a = await prisma.account.findUnique({ where: { id }, include: { warmup: true } });
    if (!a) throw notFound('Account not found');
    const { warmup, password, status, ...rest } = b;
    const data: Prisma.AccountUpdateInput = { ...rest };
    if (password) {
      if (a.authType !== 'password') throw badRequest('This account signs in with Google; use Reconnect instead');
      data.passwordEnc = encrypt(password);
    }
    if (status === 'paused') data.status = 'paused';
    if (status === 'active' && a.status === 'paused') data.status = a.smtpOk === false || a.imapOk === false ? 'error' : 'active';
    await prisma.account.update({ where: { id }, data });
    if (warmup) {
      const startedOn = warmup.enabled && !a.warmup?.enabled ? new Date() : undefined;
      await prisma.warmupSettings.upsert({
        where: { accountId: id },
        update: { ...warmup, ...(startedOn ? { startedOn } : {}) },
        create: { accountId: id, ...warmup, startedOn: warmup.enabled === false ? null : new Date() },
      });
    }
    if (password || b.smtpHost || b.imapHost || b.smtpPort || b.imapPort || b.username || b.smtpSecure !== undefined || b.imapSecure !== undefined) {
      const res = await checkAccount(id);
      return { account: publicAccount(res.account), test: res.test };
    }
    const updated = await prisma.account.findUniqueOrThrow({ where: { id }, include: { warmup: true } });
    return { account: publicAccount(updated) };
  });

  app.delete('/api/accounts/:id', async (req) => {
    const { id } = req.params as { id: string };
    await prisma.account.delete({ where: { id } }).catch(() => {
      throw notFound('Account not found');
    });
    return { ok: true };
  });

  app.post('/api/accounts/:id/check', async (req) => {
    const { id } = req.params as { id: string };
    const res = await checkAccount(id);
    return { account: publicAccount(res.account), test: res.test };
  });

  app.post('/api/accounts/:id/test-email', async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ to: z.string().email().optional() }).parse(req.body ?? {});
    const a = await prisma.account.findUnique({ where: { id }, include: { workspace: true } });
    if (!a) throw notFound('Account not found');
    const s = await getSettings();
    const to = body.to ?? (s.notifyEmail || s.adminEmail);
    const { sendEmail } = await import('@mailflow/core');
    const res = await sendEmail(a, {
      to,
      subject: `MailFlow test from ${a.email}`,
      text: `This is a test email sent by MailFlow from ${a.email}.\n\nIf you can read this, sending works.`,
    });
    return { ok: true, to, messageId: res.messageId };
  });

  app.get('/api/accounts/:id/warmup', async (req) => {
    const { id } = req.params as { id: string };
    return warmupInfo(id);
  });

  app.patch('/api/accounts/:id/warmup', async (req) => {
    const { id } = req.params as { id: string };
    const w = patchSchema.shape.warmup.unwrap().parse(req.body);
    const existing = await prisma.warmupSettings.findUnique({ where: { accountId: id } });
    await prisma.warmupSettings.upsert({
      where: { accountId: id },
      update: { ...w, ...(w.enabled && !existing?.enabled ? { startedOn: new Date() } : {}) },
      create: { accountId: id, ...w, startedOn: w.enabled === false ? null : new Date() },
    });
    return warmupInfo(id);
  });
}
