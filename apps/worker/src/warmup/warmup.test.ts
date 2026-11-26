import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@mailflow/db';
import { planWarmup, pickRecipient, warmupCapInCampaign } from './planner.js';
import { sendDueWarmups } from './sender.js';
import { recordWarmupReceipt } from './receiver.js';
import { resetDb, makeAccount, makeCampaign } from '../test/factory.js';
import { warmupStats } from '@mailflow/core';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

async function poolAccount(email: string, warmup: Record<string, unknown> = {}) {
  const a = await makeAccount({ email, username: email });
  await prisma.warmupSettings.create({ data: { accountId: a.id, enabled: true, startedOn: new Date('2026-11-20T00:00:00Z'), ...warmup } });
  return a;
}

describe('warmup', () => {
  it('needs at least 3 accounts in the pool', async () => {
    await poolAccount('a@one.com');
    await poolAccount('b@two.com');
    const r = await planWarmup(new Date('2026-11-25T07:00:00Z'));
    expect(r.planned).toBe(0);
    expect(await prisma.warmupMessage.count()).toBe(0);
  });

  it('plans the ramp-up target once a day, spread over working hours, to other pool accounts', async () => {
    const a = await poolAccount('a@one.com'); // started 5 days ago -> 3 + 5*2 = 13
    await poolAccount('b@two.com');
    await poolAccount('c@three.com');
    const now = new Date('2026-11-25T07:00:00Z'); // before 08:00 UTC working start
    await planWarmup(now);
    const rows = await prisma.warmupMessage.findMany({ where: { fromAccountId: a.id }, orderBy: { scheduledAt: 'asc' } });
    expect(rows).toHaveLength(13);
    expect(rows.every((r) => r.toAccountId !== a.id)).toBe(true);
    expect(rows[0].scheduledAt.getTime()).toBeGreaterThanOrEqual(new Date('2026-11-25T08:00:00Z').getTime());
    expect(rows[12].scheduledAt.getTime()).toBeLessThanOrEqual(new Date('2026-11-25T20:00:00Z').getTime());
    for (let i = 1; i < rows.length; i++) expect(rows[i].toAccountId).not.toBe(rows[i - 1].toAccountId); // never the same pair twice in a row
    // second run the same day plans nothing new
    await planWarmup(new Date('2026-11-25T09:00:00Z'));
    expect(await prisma.warmupMessage.count({ where: { fromAccountId: a.id } })).toBe(13);
  });

  it('caps warmup for accounts in an active campaign (shared daily cap) or stops it if asked', async () => {
    const a = await poolAccount('a@one.com', { startVolume: 20 });
    const b = await poolAccount('b@two.com', { startVolume: 20, keepDuringCampaigns: false });
    await poolAccount('c@three.com');
    await makeCampaign({ accounts: [a.id, b.id], leads: 1 });
    await planWarmup(new Date('2026-11-25T07:00:00Z'));
    expect(await prisma.warmupMessage.count({ where: { fromAccountId: a.id } })).toBe(warmupCapInCampaign(30));
    expect(await prisma.warmupMessage.count({ where: { fromAccountId: b.id } })).toBe(0);
  });

  it('prefers recipients on other domains', () => {
    const sender = { id: 's', email: 's@same.com' };
    const pool = [sender, { id: 'x', email: 'x@same.com' }, { id: 'y', email: 'y@other.com' }];
    let other = 0;
    for (let i = 0; i < 1000; i++) if (pickRecipient(sender, pool, undefined, Math.random)?.id === 'y') other++;
    expect(other).toBeGreaterThan(700); // weight 1 vs 0.25 -> ~80%
  });

  it('sends due warmups with the warmup header, records replies, and scores inbox placement', async () => {
    const a = await poolAccount('a@one.com');
    const b = await poolAccount('b@two.com', { replyRate: 100 });
    await poolAccount('c@three.com');
    const w = await prisma.warmupMessage.create({ data: { fromAccountId: a.id, toAccountId: b.id, code: 'mfw-test00001', scheduledAt: new Date('2026-11-25T09:00:00Z') } });
    const sent: any[] = [];
    const now = new Date('2026-11-25T09:00:30Z');
    await sendDueWarmups({ now: () => now, send: async (acct, mail) => (sent.push({ from: acct.email, ...mail }), { messageId: '<w1@one.com>' }) });
    expect(sent).toHaveLength(1);
    expect(sent[0].headers['X-MF-Warmup']).toBe('mfw-test00001');
    expect(sent[0].text).toContain('mfw-test00001');
    expect(sent[0].text).not.toMatch(/https?:/);

    // receiver finds it in spam: rescued, reply scheduled (reply rate 100%)
    const r = await recordWarmupReceipt({ id: b.id }, 'mfw-test00001', 'spam', now, () => 0.5);
    expect(r.known && r.first && r.replied).toBe(true);
    const updated = await prisma.warmupMessage.findUniqueOrThrow({ where: { id: w.id } });
    expect(updated.landed).toBe('spam');
    expect(updated.rescuedAt).not.toBeNull();
    const reply = await prisma.warmupMessage.findFirstOrThrow({ where: { parentId: w.id } });
    expect(reply.fromAccountId).toBe(b.id);

    // reply goes out in the same thread
    await sendDueWarmups({ now: () => new Date('2026-11-25T12:00:00Z'), send: async (acct, mail) => (sent.push({ from: acct.email, ...mail }), { messageId: '<w2@two.com>' }) });
    expect(sent[1].from).toBe('b@two.com');
    expect(sent[1].inReplyTo).toBe('<w1@one.com>');
    expect(sent[1].subject).toMatch(/^Re: /);
    expect((await prisma.warmupMessage.findUniqueOrThrow({ where: { id: w.id } })).repliedAt).not.toBeNull();

    const stats = (await warmupStats([a.id, b.id], new Date('2026-11-25T13:00:00Z')));
    expect(stats.get(a.id)!.score).toBe(0); // its only email landed in spam
    expect(stats.get(b.id)!.savedFromSpam).toBe(1);
    expect(stats.get(b.id)!.replies).toBe(1);
  });

  it('a second sighting of the same warmup email does nothing', async () => {
    const a = await poolAccount('a@one.com');
    const b = await poolAccount('b@two.com', { replyRate: 100 });
    await prisma.warmupMessage.create({ data: { fromAccountId: a.id, toAccountId: b.id, code: 'mfw-twice0001', status: 'sent', scheduledAt: new Date(), sentAt: new Date() } });
    await recordWarmupReceipt({ id: b.id }, 'mfw-twice0001', 'inbox', new Date(), () => 0);
    const again = await recordWarmupReceipt({ id: b.id }, 'mfw-twice0001', 'inbox', new Date(), () => 0);
    expect(again.known && again.first).toBe(false);
    expect(await prisma.warmupMessage.count({ where: { parentId: { not: null } } })).toBe(1);
  });
});
