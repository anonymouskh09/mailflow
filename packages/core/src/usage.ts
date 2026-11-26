import { prisma } from '@mailflow/db';
import { dayBounds } from './time.js';

export interface Usage {
  campaign: number;
  warmup: number;
  total: number;
}

/** Emails sent today (campaign + warmup) per account, "today" in the app timezone. */
export async function usageToday(accountIds: string[], now: Date, tz: string): Promise<Map<string, Usage>> {
  const { start, end } = dayBounds(now, tz);
  const out = new Map<string, Usage>(accountIds.map((id) => [id, { campaign: 0, warmup: 0, total: 0 }]));
  if (!accountIds.length) return out;
  const [camp, warm] = await Promise.all([
    prisma.message.groupBy({
      by: ['accountId'],
      where: { accountId: { in: accountIds }, status: 'sent', sentAt: { gte: start, lt: end } },
      _count: { _all: true },
    }),
    prisma.warmupMessage.groupBy({
      by: ['fromAccountId'],
      where: { fromAccountId: { in: accountIds }, status: 'sent', sentAt: { gte: start, lt: end } },
      _count: { _all: true },
    }),
  ]);
  for (const r of camp) if (r.accountId) out.get(r.accountId)!.campaign = r._count._all;
  for (const r of warm) out.get(r.fromAccountId)!.warmup = r._count._all;
  for (const u of out.values()) u.total = u.campaign + u.warmup;
  return out;
}
