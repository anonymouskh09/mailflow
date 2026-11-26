import { prisma, type WarmupSettings } from '@mailflow/db';
import { dayKey } from './time.js';

/** Today's warmup target from the ramp-up plan. `dayIndex` is 0 on the first warmup day. */
export function warmupTarget(s: Pick<WarmupSettings, 'startVolume' | 'increasePerDay' | 'maxVolume' | 'workingDays' | 'weekendFactor'>, dayIndex: number, weekday: number): number {
  if (!s.workingDays.includes(weekday)) return 0;
  let v = Math.min(s.maxVolume, s.startVolume + Math.max(0, dayIndex) * s.increasePerDay);
  if (weekday === 0 || weekday === 6) v = Math.round((v * s.weekendFactor) / 100);
  return Math.max(0, v);
}

export function daysBetween(fromKey: string, toKey: string): number {
  const a = Date.parse(`${fromKey}T00:00:00Z`);
  const b = Date.parse(`${toKey}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function warmupDayIndex(startedOn: Date | null, now: Date, tz: string): number {
  if (!startedOn) return 0;
  return Math.max(0, daysBetween(dayKey(startedOn, tz), dayKey(now, tz)));
}

export interface WarmupStats {
  score: number | null; // null until there is data
  sent: number;
  received: number;
  savedFromSpam: number;
  replies: number;
}

/** Score = share of this account's warmup emails (last 7 days) that landed in the recipient's inbox. */
export async function warmupStats(accountIds: string[], now: Date): Promise<Map<string, WarmupStats>> {
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const out = new Map<string, WarmupStats>(accountIds.map((id) => [id, { score: null, sent: 0, received: 0, savedFromSpam: 0, replies: 0 }]));
  if (!accountIds.length) return out;
  const [sentRows, recvRows] = await Promise.all([
    prisma.warmupMessage.groupBy({
      by: ['fromAccountId', 'landed'],
      where: { fromAccountId: { in: accountIds }, status: 'sent', sentAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.warmupMessage.groupBy({
      by: ['toAccountId'],
      where: { toAccountId: { in: accountIds }, status: 'sent', processedAt: { gte: since } },
      _count: { _all: true, rescuedAt: true, repliedAt: true },
    }),
  ]);
  const landed = new Map<string, { inbox: number; spam: number }>();
  for (const r of sentRows) {
    const s = out.get(r.fromAccountId)!;
    s.sent += r._count._all;
    const l = landed.get(r.fromAccountId) ?? { inbox: 0, spam: 0 };
    if (r.landed === 'inbox') l.inbox += r._count._all;
    if (r.landed === 'spam') l.spam += r._count._all;
    landed.set(r.fromAccountId, l);
  }
  for (const r of recvRows) {
    const s = out.get(r.toAccountId)!;
    s.received += r._count._all;
    s.savedFromSpam += r._count.rescuedAt;
    s.replies += r._count.repliedAt;
  }
  for (const [id, l] of landed) {
    const total = l.inbox + l.spam;
    if (total > 0) out.get(id)!.score = Math.round((l.inbox / total) * 100);
  }
  return out;
}

/** Inbox vs spam per day for the last N days (warmup emails sent by this account). */
export async function warmupDaily(accountId: string, now: Date, tz: string, days = 14) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const rows = await prisma.warmupMessage.findMany({
    where: { fromAccountId: accountId, status: 'sent', sentAt: { gte: since } },
    select: { sentAt: true, landed: true },
  });
  const map = new Map<string, { inbox: number; spam: number }>();
  for (let i = days - 1; i >= 0; i--) map.set(dayKey(new Date(now.getTime() - i * 86_400_000), tz), { inbox: 0, spam: 0 });
  for (const r of rows) {
    const k = dayKey(r.sentAt!, tz);
    const v = map.get(k);
    if (!v) continue;
    if (r.landed === 'spam') v.spam++;
    else v.inbox++; // unknown counted as delivered until the receiver checks
  }
  return [...map.entries()].map(([date, v]) => ({ date, ...v }));
}
