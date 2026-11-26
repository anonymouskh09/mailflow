/**
 * Warmup planner (SPEC §5). Once per day per account: work out today's target from the ramp-up settings
 * and spread that many sends over the working hours at random times, each to a random other pool account.
 */
import { prisma } from '@mailflow/db';
import { getSettings, dayKey, zonedParts, zonedToUtc, warmupTarget, warmupDayIndex, emailDomain, randomToken } from '@mailflow/core';
import { log } from '../log.js';

export const MIN_POOL = 3;
const WORK_START_H = 8;
const WORK_END_H = 20;

/** Share of the account's daily cap that warmup may use while the account is in an active campaign. */
export function warmupCapInCampaign(dailyLimit: number): number {
  return Math.max(2, Math.floor(dailyLimit * 0.3));
}

type PoolAccount = { id: string; email: string };

/** Pick a recipient: other pool account, cross-domain preferred, never the same as last time. */
export function pickRecipient(sender: PoolAccount, pool: PoolAccount[], last: string | undefined, rnd: () => number = Math.random): PoolAccount | null {
  const others = pool.filter((p) => p.id !== sender.id);
  if (!others.length) return null;
  const candidates = others.length > 1 ? others.filter((p) => p.id !== last) : others;
  const domain = emailDomain(sender.email);
  // same-domain recipients get a quarter of the weight
  const weights = candidates.map((c) => (emailDomain(c.email) === domain ? 0.25 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rnd() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

export async function planWarmup(now = new Date(), rnd: () => number = Math.random) {
  const s = await getSettings();
  const tz = s.defaultTimezone;
  const today = dayKey(now, tz);
  const pool = await prisma.account.findMany({
    where: { status: 'active', warmup: { enabled: true } },
    include: { warmup: true, campaignAccounts: { where: { campaign: { status: 'active' } }, select: { campaignId: true } } },
  });
  if (pool.length < MIN_POOL) return { planned: 0, reason: `Warmup needs at least ${MIN_POOL} accounts with warmup on (have ${pool.length})` };

  const p = zonedParts(now, tz);
  const dayStart = zonedToUtc(p.year, p.month, p.day, WORK_START_H, 0, tz).getTime();
  const dayEnd = zonedToUtc(p.year, p.month, p.day, WORK_END_H, 0, tz).getTime();
  const from = Math.max(dayStart, now.getTime() + 60_000);
  if (from >= dayEnd) return { planned: 0, reason: 'Working hours are over for today' };

  let planned = 0;
  for (const a of pool) {
    const w = a.warmup!;
    if (w.plannedFor === today) continue;
    let target = warmupTarget(w, warmupDayIndex(w.startedOn ?? now, now, tz), p.weekday);
    if (a.campaignAccounts.length) target = w.keepDuringCampaigns ? Math.min(target, warmupCapInCampaign(a.dailyLimit)) : 0;
    // planning late in the day: scale down to the remaining hours
    const share = (dayEnd - from) / (dayEnd - dayStart);
    target = Math.round(target * Math.min(1, share));
    const lastSent = await prisma.warmupMessage.findFirst({ where: { fromAccountId: a.id, parentId: null }, orderBy: { scheduledAt: 'desc' }, select: { toAccountId: true } });
    let last = lastSent?.toAccountId;
    const times = Array.from({ length: target }, () => from + rnd() * (dayEnd - from)).sort((x, y) => x - y);
    const rows = [];
    for (const t of times) {
      const to = pickRecipient(a, pool, last, rnd);
      if (!to) break;
      last = to.id;
      rows.push({ fromAccountId: a.id, toAccountId: to.id, code: `mfw-${randomToken(9).replace(/[^A-Za-z0-9]/g, 'x').toLowerCase()}`, scheduledAt: new Date(t) });
    }
    await prisma.$transaction([
      prisma.warmupMessage.createMany({ data: rows }),
      prisma.warmupSettings.update({ where: { id: w.id }, data: { plannedFor: today, ...(w.startedOn ? {} : { startedOn: now }) } }),
    ]);
    planned += rows.length;
  }
  if (planned) log('info', 'warmup planned', { planned, pool: pool.length });
  return { planned };
}
