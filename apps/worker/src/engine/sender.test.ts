import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@mailflow/db';
import { markReplied } from '@mailflow/core';
import { tick } from './sender.js';
import { resetDb, makeAccount, makeCampaign, fakeDeps } from '../test/factory.js';

// 2026-11-25 is a Wednesday.
const WED_0900 = '2026-11-25T09:00:00Z';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('sending engine', () => {
  it('rotates Step 1 across accounts (fewest sends first) and respects the gap', async () => {
    const accts = await Promise.all([makeAccount(), makeAccount(), makeAccount()]);
    await makeCampaign({ accounts: accts.map((a) => a.id), leads: 10, over: { gapMin: 8, gapMax: 15 } });
    const f = fakeDeps(WED_0900);

    let r = await tick(f.deps);
    expect(r.sent).toBe(3);
    expect(new Set(f.sent.map((s) => s.from)).size).toBe(3);

    // still inside the gap: nothing goes out
    f.advance(0.5);
    r = await tick(f.deps);
    expect(r.sent).toBe(0);
    f.advance(7);
    expect((await tick(f.deps)).sent).toBe(0); // 7.5 min < 8 min minimum

    f.advance(1); // 8.5 min
    r = await tick(f.deps);
    expect(r.sent).toBe(3);
    const perAccount = Object.values(f.sent.reduce<Record<string, number>>((m, s) => ((m[s.from] = (m[s.from] ?? 0) + 1), m), {}));
    expect(perAccount).toEqual([2, 2, 2]);

    // gap is a random value between min and max
    const a = await prisma.account.findUniqueOrThrow({ where: { id: accts[0].id } });
    const gapMin = (a.nextSendAt!.getTime() - f.now.getTime()) / 60000;
    expect(gapMin).toBeGreaterThanOrEqual(8);
    expect(gapMin).toBeLessThanOrEqual(15);
  });

  it('uses the account minimum gap when it is longer than the campaign gap', async () => {
    const a = await makeAccount({ gapMinMinutes: 20 });
    await makeCampaign({ accounts: [a.id], leads: 3 });
    const f = fakeDeps(WED_0900);
    await tick(f.deps);
    f.advance(15);
    expect((await tick(f.deps)).sent).toBe(0);
    f.advance(5);
    expect((await tick(f.deps)).sent).toBe(1);
  });

  it('only sends inside the schedule window (days, hours, timezone)', async () => {
    const a = await makeAccount();
    await makeCampaign({ accounts: [a.id], leads: 2, launchedAt: new Date('2026-11-25T00:00:00Z'), over: { timezone: 'Asia/Tashkent', windowStart: '09:00', windowEnd: '17:00' } });
    const f = fakeDeps('2026-11-25T03:59:00Z'); // 08:59 in Tashkent
    expect((await tick(f.deps)).sent).toBe(0);
    f.set('2026-11-25T04:00:00Z'); // 09:00 Tashkent
    expect((await tick(f.deps)).sent).toBe(1);
    f.set('2026-11-25T12:00:00Z'); // 17:00 Tashkent (window end is exclusive)
    expect((await tick(f.deps)).sent).toBe(0);
    f.set('2026-11-28T06:00:00Z'); // Saturday
    expect((await tick(f.deps)).sent).toBe(0);
  });

  it('does not start before the campaign start date', async () => {
    const a = await makeAccount();
    await makeCampaign({ accounts: [a.id], leads: 1, over: { startAt: new Date('2026-11-26T09:00:00Z') } });
    const f = fakeDeps(WED_0900);
    expect((await tick(f.deps)).sent).toBe(0);
    f.set('2026-11-26T09:00:00Z');
    expect((await tick(f.deps)).sent).toBe(1);
  });

  it('sends follow-ups from the Step 1 account, after the delay, shifted into the window, in the same thread', async () => {
    const accts = await Promise.all([makeAccount(), makeAccount()]);
    const { campaign } = await makeCampaign({
      accounts: accts.map((a) => a.id),
      leads: 1,
      steps: [
        { subject: 'Quick question, {{firstName}}' },
        { subject: '', delayDays: 2 },
        { subject: 'Should I close your file?', delayDays: 3 },
      ],
    });
    const f = fakeDeps('2026-11-26T16:55:00Z'); // Thursday 16:55
    await tick(f.deps);
    expect(f.sent).toHaveLength(1);
    const first = f.sent[0];
    expect(first.subject).toBe('Quick question, First1');

    let cl = await prisma.campaignLead.findFirstOrThrow({ where: { campaignId: campaign.id } });
    // Thu 16:55 + 2 days = Sat 16:55 -> next window Mon 09:00
    expect(cl.nextDueAt!.toISOString()).toBe('2026-11-30T09:00:00.000Z');
    expect(cl.accountId).toBe(accts.find((a) => a.email === first.from)!.id);

    f.set('2026-11-28T17:00:00Z'); // Saturday
    expect((await tick(f.deps)).sent).toBe(0);
    f.set('2026-11-30T09:00:00Z');
    await tick(f.deps);
    expect(f.sent).toHaveLength(2);
    const second = f.sent[1];
    expect(second.from).toBe(first.from);
    expect(second.subject).toBe('Re: Quick question, First1');
    expect(second.inReplyTo).toBe(first.messageId);
    expect(second.references).toBe(first.messageId);

    cl = await prisma.campaignLead.findFirstOrThrow({ where: { campaignId: campaign.id } });
    expect(cl.nextDueAt!.toISOString()).toBe('2026-12-03T09:00:00.000Z'); // Mon 09:00 + 3 days = Thu 09:00
    f.set('2026-12-03T09:00:00Z');
    await tick(f.deps);
    const third = f.sent[2];
    expect(third.from).toBe(first.from);
    expect(third.subject).toBe('Should I close your file?');
    expect(third.inReplyTo).toBeUndefined(); // own subject = new thread

    cl = await prisma.campaignLead.findFirstOrThrow({ where: { campaignId: campaign.id } });
    expect(cl.state).toBe('completed');
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe('completed');
    expect((await prisma.lead.findFirstOrThrow()).status).toBe('completed');
  });

  it('honours account, campaign and new-leads-per-day limits, with warmup sharing the account cap', async () => {
    const a1 = await makeAccount({ dailyLimit: 2 });
    const a2 = await makeAccount({ dailyLimit: 3 });
    const a3 = await makeAccount({ dailyLimit: 10 });
    // a3 has 8 warmup emails reserved today -> only 2 campaign emails left
    await prisma.warmupMessage.createMany({ data: Array.from({ length: 8 }, (_, i) => ({ fromAccountId: a3.id, toAccountId: a1.id, code: `mfw-${i}xxxxxxxx`, scheduledAt: new Date('2026-11-25T10:00:00Z') })) });
    await makeCampaign({ accounts: [a1.id, a2.id, a3.id], leads: 20, over: { gapMin: 0, gapMax: 0, dailyLimit: 6 } });
    const f = fakeDeps(WED_0900);
    for (let i = 0; i < 5; i++) {
      await tick(f.deps);
      f.advance(1);
    }
    expect(f.sent).toHaveLength(6); // campaign limit 6 < 2 + 3 + 2 account capacity (7)
    const by = (e: string) => f.sent.filter((s) => s.from === e).length;
    expect(by(a1.email)).toBeLessThanOrEqual(2);
    expect(by(a3.email)).toBeLessThanOrEqual(2);

    // next day the counters reset
    f.set('2026-11-26T09:00:00Z');
    await tick(f.deps);
    expect(f.sent.length).toBeGreaterThan(6);
  });

  it('caps new leads per day so follow-ups get room', async () => {
    const a = await makeAccount();
    await makeCampaign({ accounts: [a.id], leads: 10, over: { gapMin: 0, gapMax: 0, newLeadsPerDay: 3 } });
    const f = fakeDeps(WED_0900);
    for (let i = 0; i < 6; i++) {
      await tick(f.deps);
      f.advance(1);
    }
    expect(f.sent).toHaveLength(3);
  });

  it('sends due follow-ups before new leads by default', async () => {
    const a = await makeAccount();
    const { campaign } = await makeCampaign({ accounts: [a.id], leads: 3, steps: [{ subject: 'S1' }, { subject: '', delayDays: 1 }] });
    const f = fakeDeps(WED_0900);
    await tick(f.deps); // lead1 step1
    f.set('2026-11-26T09:00:00Z');
    await tick(f.deps);
    expect(f.sent[1].subject).toBe('Re: S1');
    expect(f.sent[1].to).toBe(f.sent[0].to);
    // new_first flips the order: lead1 step 1 first, while lead2's follow-up waits
    await prisma.campaign.update({ where: { id: campaign.id }, data: { priority: 'new_first' } });
    await prisma.account.update({ where: { id: a.id }, data: { nextSendAt: null } });
    f.set('2026-11-27T09:00:00Z');
    await tick(f.deps);
    expect(f.sent[2].subject).toBe('S1');
    expect(f.sent[2].to).not.toBe(f.sent[1].to);
  });

  it('stops the sequence when the lead replies (not on auto-replies unless enabled)', async () => {
    const a = await makeAccount();
    const { campaign } = await makeCampaign({ accounts: [a.id], leads: 2, over: { gapMin: 0, gapMax: 0 }, steps: [{ subject: 'S1' }, { subject: '', delayDays: 1 }, { subject: '', delayDays: 1 }] });
    const f = fakeDeps(WED_0900);
    await tick(f.deps);
    await tick(f.deps);
    expect(f.sent).toHaveLength(2);
    const [cl1, cl2] = await prisma.campaignLead.findMany({ where: { campaignId: campaign.id }, include: { lead: true }, orderBy: { lead: { email: 'asc' } } });
    await markReplied(cl1.id, { auto: false });
    await markReplied(cl2.id, { auto: true });

    f.set('2026-11-26T09:00:00Z');
    await tick(f.deps);
    await tick(f.deps);
    const to = f.sent.slice(2).map((s) => s.to);
    expect(to).not.toContain(cl1.lead.email);
    expect(to).toContain(cl2.lead.email);
    const after = await prisma.campaignLead.findUniqueOrThrow({ where: { id: cl1.id }, include: { lead: true } });
    expect(after.state).toBe('replied');
    expect(after.lead.status).toBe('replied');
  });

  it('never sends the same email twice when two workers tick at once', async () => {
    const accts = await Promise.all([makeAccount(), makeAccount(), makeAccount()]);
    await makeCampaign({ accounts: accts.map((a) => a.id), leads: 6, over: { gapMin: 0, gapMax: 0 } });
    const f = fakeDeps(WED_0900);
    await Promise.all([tick(f.deps), tick(f.deps), tick(f.deps)]);
    const keys = f.sent.map((s) => s.to);
    expect(new Set(keys).size).toBe(keys.length);
    const msgs = await prisma.message.findMany({ where: { status: 'sent' } });
    expect(msgs).toHaveLength(f.sent.length);
  });

  it('hard bounce: lead bounced and suppressed', async () => {
    const a = await makeAccount();
    const { campaign } = await makeCampaign({ accounts: [a.id], leads: ['gone@nowhere.com'] });
    const f = fakeDeps(WED_0900);
    f.failWhen(() => Object.assign(new Error('550 5.1.1 user unknown'), { responseCode: 550, response: '550 5.1.1 user unknown' }));
    await tick(f.deps);
    const cl = await prisma.campaignLead.findFirstOrThrow({ where: { campaignId: campaign.id }, include: { lead: true } });
    expect(cl.state).toBe('bounced');
    expect(cl.lead.status).toBe('bounced');
    expect(await prisma.suppression.findUnique({ where: { value: 'gone@nowhere.com' } })).toBeTruthy();
    expect(await prisma.event.count({ where: { type: 'bounce' } })).toBe(1);
  });

  it('auth failure: account goes to Error and Step 1 is re-routed to another account', async () => {
    const bad = await makeAccount();
    const good = await makeAccount();
    await prisma.account.update({ where: { id: good.id }, data: { nextSendAt: new Date('2026-11-25T09:00:30Z') } }); // bad goes first
    const { campaign } = await makeCampaign({ accounts: [bad.id, good.id], leads: 1 });
    const f = fakeDeps(WED_0900);
    f.failWhen((from) => (from === bad.email ? Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535 }) : null));
    await tick(f.deps);
    expect(f.sent).toHaveLength(0);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: bad.id } })).status).toBe('error');
    f.advance(1);
    await tick(f.deps);
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].from).toBe(good.email);
    const cl = await prisma.campaignLead.findFirstOrThrow({ where: { campaignId: campaign.id } });
    expect(cl.accountId).toBe(good.id);
  });

  it('auth failure on a follow-up holds it until the account recovers', async () => {
    const a = await makeAccount();
    const b = await makeAccount();
    const { campaign } = await makeCampaign({ accounts: [a.id, b.id], leads: 1, steps: [{ subject: 'S1' }, { subject: '', delayDays: 1 }] });
    const f = fakeDeps(WED_0900);
    await tick(f.deps);
    const sender = f.sent[0].from;
    f.set('2026-11-26T09:00:00Z');
    f.failWhen((from) => (from === sender ? Object.assign(new Error('auth'), { code: 'EAUTH', responseCode: 535 }) : null));
    await tick(f.deps);
    f.advance(30);
    await tick(f.deps);
    expect(f.sent).toHaveLength(1); // not sent from the other account
    const cl = await prisma.campaignLead.findFirstOrThrow({ where: { campaignId: campaign.id } });
    expect(cl.heldReason).toBe('Sending account has an error');
    // account fixed
    f.failWhen(null);
    await prisma.account.updateMany({ where: { email: sender }, data: { status: 'active' } });
    f.advance(1);
    await tick(f.deps);
    expect(f.sent).toHaveLength(2);
    expect(f.sent[1].from).toBe(sender);
  });

  it('temporary errors retry after 5 / 15 / 60 minutes, then fail', async () => {
    const a = await makeAccount();
    const { campaign } = await makeCampaign({ accounts: [a.id], leads: 1, over: { gapMin: 0, gapMax: 0 } });
    const f = fakeDeps(WED_0900);
    f.failWhen(() => Object.assign(new Error('451 try again'), { responseCode: 451, response: '451 try again' }));
    const due = async () => (await prisma.campaignLead.findFirstOrThrow({ where: { campaignId: campaign.id } })).nextDueAt;
    await tick(f.deps);
    expect((await due())!.toISOString()).toBe('2026-11-25T09:05:00.000Z');
    f.set('2026-11-25T09:05:00Z');
    await tick(f.deps);
    expect((await due())!.toISOString()).toBe('2026-11-25T09:20:00.000Z');
    f.set('2026-11-25T09:20:00Z');
    await tick(f.deps);
    expect((await due())!.toISOString()).toBe('2026-11-25T10:20:00.000Z');
    f.set('2026-11-25T10:20:00Z');
    await tick(f.deps);
    const cl = await prisma.campaignLead.findFirstOrThrow({ where: { campaignId: campaign.id } });
    expect(cl.nextDueAt).toBeNull();
    expect(cl.heldReason).toMatch(/Failed after 3 retries/);
    expect((await prisma.message.findFirstOrThrow()).status).toBe('failed');
    expect(await prisma.message.count()).toBe(1); // same row reused on every retry
  });

  it('a retry that succeeds reuses the same message row', async () => {
    const a = await makeAccount();
    await makeCampaign({ accounts: [a.id], leads: 1, over: { gapMin: 0, gapMax: 0 } });
    const f = fakeDeps(WED_0900);
    f.failWhen(() => Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    await tick(f.deps);
    f.failWhen(null);
    f.set('2026-11-25T09:05:00Z');
    await tick(f.deps);
    expect(f.sent).toHaveLength(1);
    const m = await prisma.message.findFirstOrThrow();
    expect(m.status).toBe('sent');
    expect(m.retryCount).toBe(1);
  });

  it('provider rate limit pauses the account for an hour', async () => {
    const a = await makeAccount();
    await makeCampaign({ accounts: [a.id], leads: 2 });
    const f = fakeDeps(WED_0900);
    f.failWhen(() => Object.assign(new Error('rate'), { responseCode: 421, response: '421 4.7.0 Too many messages, rate limited' }));
    await tick(f.deps);
    const acct = await prisma.account.findUniqueOrThrow({ where: { id: a.id } });
    expect(acct.pausedUntil!.toISOString()).toBe('2026-11-25T10:00:00.000Z');
    f.failWhen(null);
    f.advance(30);
    expect((await tick(f.deps)).sent).toBe(0);
    f.set('2026-11-25T10:00:00Z');
    expect((await tick(f.deps)).sent).toBe(1);
  });

  it('never emails suppressed addresses or domains', async () => {
    const a = await makeAccount();
    await prisma.suppression.create({ data: { value: 'blocked.com', kind: 'domain', reason: 'manual' } });
    const { campaign } = await makeCampaign({ accounts: [a.id], leads: ['ceo@blocked.com', 'ok@fine.com'], over: { gapMin: 0, gapMax: 0 } });
    const f = fakeDeps(WED_0900);
    await tick(f.deps);
    await tick(f.deps);
    expect(f.sent.map((s) => s.to)).toEqual(['ok@fine.com']);
    const blocked = await prisma.campaignLead.findFirstOrThrow({ where: { campaignId: campaign.id, lead: { email: 'ceo@blocked.com' } } });
    expect(blocked.state).toBe('unsubscribed');
  });

  it('adds unsubscribe header, tracking pixel and skips paused or error accounts', async () => {
    const paused = await makeAccount({ status: 'paused' });
    const ok = await makeAccount();
    await makeCampaign({ accounts: [paused.id, ok.id], leads: 2, over: { gapMin: 0, gapMax: 0 } });
    const f = fakeDeps(WED_0900);
    await tick(f.deps);
    expect(f.sent.every((s) => s.from === ok.email)).toBe(true);
    expect(f.sent[0].listUnsubscribe).toMatch(/^https:\/\/track\.test\.dev\/u\//);
    expect(f.sent[0].html).toMatch(/https:\/\/track\.test\.dev\/o\/[\w-]+\.gif/);
    expect(await prisma.event.count({ where: { type: 'sent' } })).toBe(f.sent.length);
  });

  it('paused campaigns do not send', async () => {
    const a = await makeAccount();
    await makeCampaign({ accounts: [a.id], leads: 2, over: { status: 'paused' } });
    const f = fakeDeps(WED_0900);
    expect((await tick(f.deps)).sent).toBe(0);
  });
});
