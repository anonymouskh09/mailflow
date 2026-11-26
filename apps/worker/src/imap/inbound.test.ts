import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@mailflow/db';
import { processInbound } from './inbound.js';
import { tick } from '../engine/sender.js';
import { resetDb, makeAccount, makeCampaign, fakeDeps } from '../test/factory.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

function eml(o: { from: string; to: string; subject: string; body: string; inReplyTo?: string; messageId?: string; headers?: Record<string, string> }) {
  const h = [
    `From: ${o.from}`,
    `To: ${o.to}`,
    `Subject: ${o.subject}`,
    `Message-ID: ${o.messageId ?? `<${Math.random().toString(36).slice(2)}@lead.com>`}`,
    'Date: Wed, 25 Nov 2026 11:00:00 +0000',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
  ];
  if (o.inReplyTo) h.push(`In-Reply-To: ${o.inReplyTo}`, `References: ${o.inReplyTo}`);
  for (const [k, v] of Object.entries(o.headers ?? {})) h.push(`${k}: ${v}`);
  return `${h.join('\r\n')}\r\n\r\n${o.body}\r\n`;
}

async function sentCampaign(steps = [{ subject: 'Hello {{firstName}}' }, { subject: '', delayDays: 1 }], over: Record<string, unknown> = {}) {
  await prisma.leadLabel.create({ data: { name: 'Out of office' } });
  const a = await makeAccount();
  const { campaign } = await makeCampaign({ accounts: [a.id], leads: ['james@lead.com'], steps, over });
  const f = fakeDeps('2026-11-25T09:00:00Z');
  await tick(f.deps);
  return { a, campaign, f, first: f.sent[0] };
}

describe('inbound processing', () => {
  it('matches a reply by In-Reply-To, stores it in the Unibox and stops the sequence', async () => {
    const { a, campaign, first } = await sentCampaign();
    const res = await processInbound(a, eml({ from: 'James <james@lead.com>', to: a.email, subject: 'Re: Hello First1', body: 'Thursday works.\n\nOn Wed, Sender wrote:\n> Hello', inReplyTo: first.messageId }));
    expect(res.kind).toBe('reply');
    const cl = await prisma.campaignLead.findFirstOrThrow({ where: { campaignId: campaign.id } });
    expect(cl.state).toBe('replied');
    expect(cl.nextDueAt).toBeNull();
    const thread = await prisma.thread.findFirstOrThrow({ include: { messages: true } });
    expect(thread.unread).toBe(true);
    expect(thread.snippet).toBe('Thursday works.');
    expect(thread.campaignId).toBe(campaign.id);
    expect(thread.messages).toHaveLength(1);
    expect(await prisma.event.count({ where: { type: 'reply' } })).toBe(1);
  });

  it('is idempotent for the same Message-ID', async () => {
    const { a, first } = await sentCampaign();
    const raw = eml({ from: 'james@lead.com', to: a.email, subject: 'Re: x', body: 'Yes', inReplyTo: first.messageId, messageId: '<same@lead.com>' });
    await processInbound(a, raw);
    expect((await processInbound(a, raw)).kind).toBe('duplicate');
    expect(await prisma.inboxMessage.count()).toBe(1);
    expect(await prisma.event.count({ where: { type: 'reply' } })).toBe(1);
  });

  it('matches by sender address when headers are missing', async () => {
    const { a, campaign } = await sentCampaign();
    const res = await processInbound(a, eml({ from: 'james@lead.com', to: a.email, subject: 'question', body: 'Who handles this on your side?' }));
    expect(res.kind).toBe('reply');
    expect((await prisma.campaignLead.findFirstOrThrow({ where: { campaignId: campaign.id } })).state).toBe('replied');
  });

  it('auto-replies are labelled Out of office and do not stop the sequence by default', async () => {
    const { a, campaign, first } = await sentCampaign();
    const res = await processInbound(a, eml({ from: 'james@lead.com', to: a.email, subject: 'Automatic reply: Hello', body: 'I am out of the office until Monday.', inReplyTo: first.messageId, headers: { 'Auto-Submitted': 'auto-replied' } }));
    expect(res.kind).toBe('auto_reply');
    const cl = await prisma.campaignLead.findFirstOrThrow({ where: { campaignId: campaign.id } });
    expect(cl.state).toBe('active');
    const t = await prisma.thread.findFirstOrThrow({ include: { label: true } });
    expect(t.label?.name).toBe('Out of office');
    expect(await prisma.event.count({ where: { type: 'reply' } })).toBe(0);
    expect(await prisma.event.count({ where: { type: 'auto_reply' } })).toBe(1);
  });

  it('auto-replies stop the sequence when the campaign says so', async () => {
    const { a, campaign, first } = await sentCampaign(undefined, { stopOnAutoReply: true });
    await processInbound(a, eml({ from: 'james@lead.com', to: a.email, subject: 'Out of Office', body: 'Away', inReplyTo: first.messageId }));
    expect((await prisma.campaignLead.findFirstOrThrow({ where: { campaignId: campaign.id } })).state).toBe('replied');
  });

  it('bounces from mailer-daemon mark the lead bounced and suppressed', async () => {
    const { a, campaign, first } = await sentCampaign();
    const dsn = eml({
      from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
      to: a.email,
      subject: 'Delivery Status Notification (Failure)',
      body: `Address not found\r\n\r\nFinal-Recipient: rfc822; james@lead.com\r\nStatus: 5.1.1\r\n\r\nMessage-ID: ${first.messageId}`,
    });
    expect((await processInbound(a, dsn)).kind).toBe('bounce');
    const cl = await prisma.campaignLead.findFirstOrThrow({ where: { campaignId: campaign.id } });
    expect(cl.state).toBe('bounced');
    expect(await prisma.suppression.findUnique({ where: { value: 'james@lead.com' } })).toBeTruthy();
    expect(await prisma.thread.count()).toBe(0);
  });

  it('warmup emails are recognised and never reach the Unibox', async () => {
    const { a } = await sentCampaign();
    const res = await processInbound(a, eml({ from: 'x@other.com', to: a.email, subject: 'Quick question', body: 'Hi\n\nRef: mfw-abcdefgh1', headers: { 'X-MF-Warmup': 'mfw-abcdefgh1' } }));
    expect(res).toEqual({ kind: 'warmup', warmupCode: 'mfw-abcdefgh1' });
    expect(await prisma.thread.count()).toBe(0);
  });

  it('ignores newsletters and strangers, keeps emails from known leads', async () => {
    const a = await makeAccount();
    expect((await processInbound(a, eml({ from: 'news@shop.com', to: a.email, subject: 'Sale', body: '50% off' }))).kind).toBe('ignored');
    const list = await prisma.leadList.create({ data: { name: 'L' } });
    await prisma.lead.create({ data: { listId: list.id, email: 'known@lead.com', firstName: 'Known' } });
    expect((await processInbound(a, eml({ from: 'known@lead.com', to: a.email, subject: 'Hi', body: 'Saw your site' }))).kind).toBe('lead_email');
    const t = await prisma.thread.findFirstOrThrow();
    expect(t.leadName).toBe('Known');
  });

  it('replies keep the thread when the lead writes again; analytics count the lead once', async () => {
    const { a, first } = await sentCampaign();
    await processInbound(a, eml({ from: 'james@lead.com', to: a.email, subject: 'Re: x', body: 'One', inReplyTo: first.messageId }));
    await processInbound(a, eml({ from: 'james@lead.com', to: a.email, subject: 'Re: x', body: 'Two', inReplyTo: first.messageId }));
    expect(await prisma.thread.count()).toBe(1);
    expect(await prisma.inboxMessage.count()).toBe(2);
    expect(await prisma.event.count({ where: { type: 'reply' } })).toBe(1);
  });
});
