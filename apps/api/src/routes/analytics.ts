import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, Prisma } from '@mailflow/db';
import { getSettings, dayKey, zonedToUtc, usageToday, warmupStats } from '@mailflow/core';
import { campaignStats } from './campaigns.js';
import { pct } from '../util.js';

const rangeSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  campaign: z.string().optional(),
  account: z.string().optional(),
});

function addDays(key: string, n: number) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function keyToUtc(key: string, tz: string) {
  const [y, m, d] = key.split('-').map(Number);
  return zonedToUtc(y, m, d, 0, 0, tz);
}

interface Kpis {
  sent: number;
  emailed: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
}

async function kpis(start: Date, end: Date, campaign?: string, account?: string): Promise<Kpis> {
  const mf = Prisma.sql`m.status = 'sent' AND m.sent_at >= ${start} AND m.sent_at < ${end}
    ${campaign ? Prisma.sql`AND m.campaign_id = ${campaign}` : Prisma.empty}
    ${account ? Prisma.sql`AND m.account_id = ${account}` : Prisma.empty}`;
  const ef = Prisma.sql`e.at >= ${start} AND e.at < ${end}
    ${campaign ? Prisma.sql`AND e.campaign_id = ${campaign}` : Prisma.empty}
    ${account ? Prisma.sql`AND e.account_id = ${account}` : Prisma.empty}`;
  const [m] = await prisma.$queryRaw<{ sent: bigint; emailed: bigint }[]>`SELECT COUNT(*) AS sent, COUNT(DISTINCT m.lead_id) AS emailed FROM messages m WHERE ${mf}`;
  const ev = await prisma.$queryRaw<{ type: string; leads: bigint; n: bigint }[]>`
    SELECT e.type::text AS type, COUNT(DISTINCT e.lead_id) AS leads, COUNT(DISTINCT e.message_id) AS n FROM events e
    WHERE ${ef} AND e.type IN ('open','click','reply','bounce','unsubscribe') GROUP BY e.type`;
  const get = (t: string, k: 'leads' | 'n' = 'leads') => Number(ev.find((x) => x.type === t)?.[k] ?? 0);
  return { sent: Number(m.sent), emailed: Number(m.emailed), opened: get('open'), clicked: get('click'), replied: get('reply'), bounced: get('bounce', 'n'), unsubscribed: get('unsubscribe') };
}

export async function analyticsRoutes(app: FastifyInstance) {
  app.get('/api/analytics/overview', async (req) => {
    const q = rangeSchema.parse(req.query);
    const s = await getSettings();
    const tz = s.defaultTimezone;
    const today = dayKey(new Date(), tz);
    const toKey = q.to ?? today;
    const fromKey = q.from ?? addDays(toKey, -((q.days ?? 7) - 1));
    const len = Math.round((Date.parse(toKey) - Date.parse(fromKey)) / 86_400_000) + 1;
    const start = keyToUtc(fromKey, tz);
    const end = keyToUtc(addDays(toKey, 1), tz);
    const prevStart = keyToUtc(addDays(fromKey, -len), tz);
    const [cur, prev] = await Promise.all([kpis(start, end, q.campaign, q.account), kpis(prevStart, start, q.campaign, q.account)]);

    const rows = await prisma.dailyStat.groupBy({
      by: ['date'],
      where: { date: { gte: fromKey, lte: toKey }, ...(q.campaign ? { campaignId: q.campaign } : {}), ...(q.account ? { accountId: q.account } : {}) },
      _sum: { sent: true, opens: true, replies: true, clicks: true },
    });
    const series = Array.from({ length: len }, (_, i) => {
      const date = addDays(fromKey, i);
      const r = rows.find((x) => x.date === date);
      return { date, sent: r?._sum.sent ?? 0, opened: r?._sum.opens ?? 0, replied: r?._sum.replies ?? 0, clicked: r?._sum.clicks ?? 0 };
    });

    // "tracking off" when every relevant campaign has it disabled
    const camps = await prisma.campaign.findMany({ where: q.campaign ? { id: q.campaign } : { status: { not: 'draft' } }, select: { trackOpens: true, trackClicks: true, plainText: true } });
    const openOff = camps.length > 0 && camps.every((c) => !c.trackOpens || c.plainText);
    const clickOff = camps.length > 0 && camps.every((c) => !c.trackClicks || c.plainText);

    const rate = (k: Kpis) => ({
      sent: k.sent,
      openRate: pct(k.opened, k.emailed),
      clickRate: pct(k.clicked, k.emailed),
      replyRate: pct(k.replied, k.emailed),
      bounceRate: pct(k.bounced, k.sent),
      unsubscribes: k.unsubscribed,
      emailed: k.emailed,
      opened: k.opened,
      clicked: k.clicked,
      replied: k.replied,
      bounced: k.bounced,
    });
    return { from: fromKey, to: toKey, days: len, current: rate(cur), previous: rate(prev), series, trackingOff: { opens: openOff, clicks: clickOff } };
  });

  app.get('/api/analytics/campaigns', async () => {
    const list = await prisma.campaign.findMany({ where: { status: { not: 'draft' } }, orderBy: [{ status: 'asc' }, { launchedAt: 'desc' }], take: 8 });
    const stats = await campaignStats(list.map((c) => c.id));
    return {
      campaigns: list.map((c) => {
        const st = stats.get(c.id)!;
        return { id: c.id, name: c.name, status: c.status, progress: st.leads ? Math.round((st.contacted / st.leads) * 100) : 0, sent: st.sent, openRate: c.trackOpens && !c.plainText ? pct(st.opened, st.contacted) : null, replyRate: pct(st.replied, st.contacted) };
      }),
    };
  });

  app.get('/api/analytics/accounts', async () => {
    const accounts = await prisma.account.findMany({ orderBy: { email: 'asc' }, select: { id: true, email: true, dailyLimit: true, status: true } });
    const s = await getSettings();
    const ids = accounts.map((a) => a.id);
    const [usage, scores] = await Promise.all([usageToday(ids, new Date(), s.defaultTimezone), warmupStats(ids, new Date())]);
    return {
      accounts: accounts
        .map((a) => ({ id: a.id, email: a.email, status: a.status, warmupScore: scores.get(a.id)!.score, sentToday: usage.get(a.id)!.campaign, dailyLimit: a.dailyLimit }))
        .sort((x, y) => (y.warmupScore ?? -1) - (x.warmupScore ?? -1)),
    };
  });

  app.get('/api/analytics/steps', async (req, reply) => {
    const q = z.object({ campaign: z.string() }).parse(req.query);
    return reply.redirect(`/api/campaigns/${q.campaign}/stats`);
  });
}
