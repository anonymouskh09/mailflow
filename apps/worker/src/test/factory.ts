import { prisma } from '@mailflow/db';
import { encrypt } from '@mailflow/core';

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
  await prisma.settings.create({ data: { id: 1, adminEmail: 'admin@test.dev', passwordHash: 'x', defaultTimezone: 'UTC', delayUnit: 'days', trackingDomain: 'track.test.dev' } });
}

let n = 0;
export async function makeAccount(over: Partial<Parameters<typeof prisma.account.create>[0]['data']> = {}) {
  n++;
  return prisma.account.create({
    data: {
      email: `sender${n}@d${n}.test`,
      fromName: `Sender ${n}`,
      provider: 'custom',
      smtpHost: 'smtp.test',
      smtpPort: 587,
      imapHost: 'imap.test',
      imapPort: 993,
      username: `sender${n}@d${n}.test`,
      authType: 'password',
      passwordEnc: encrypt('pw'),
      dailyLimit: 30,
      gapMinMinutes: 0,
      ...over,
    } as any,
  });
}

export async function makeCampaign(opts: {
  accounts: string[];
  leads: number | string[];
  steps?: { subject: string; body?: string; delayDays?: number }[];
  over?: Record<string, unknown>;
  launchedAt?: Date;
}) {
  const list = await prisma.leadList.create({ data: { name: 'List' } });
  const emails = typeof opts.leads === 'number' ? Array.from({ length: opts.leads }, (_, i) => `lead${i + 1}@company${i + 1}.com`) : opts.leads;
  await prisma.lead.createMany({ data: emails.map((email, i) => ({ listId: list.id, email, firstName: `First${i + 1}`, company: `Co${i + 1}` })) });
  const steps = opts.steps ?? [{ subject: 'Quick question, {{firstName}}', body: 'Hi {{firstName}}' }];
  const campaign = await prisma.campaign.create({
    data: {
      name: 'Test campaign',
      status: 'active',
      listId: list.id,
      timezone: 'UTC',
      days: [1, 2, 3, 4, 5],
      windowStart: '09:00',
      windowEnd: '17:00',
      gapMin: 8,
      gapMax: 15,
      dailyLimit: 100,
      launchedAt: opts.launchedAt ?? new Date('2026-11-25T08:00:00Z'),
      trackOpens: true,
      ...(opts.over ?? {}),
      steps: { create: steps.map((s, i) => ({ position: i + 1, subject: s.subject, bodyHtml: s.body ?? 'Hello {{firstName}}', delayDays: s.delayDays ?? 0 })) },
      accounts: { create: opts.accounts.map((accountId) => ({ accountId })) },
    },
  });
  const leads = await prisma.lead.findMany({ where: { listId: list.id }, orderBy: { email: 'asc' } });
  await prisma.campaignLead.createMany({ data: leads.map((l) => ({ campaignId: campaign.id, leadId: l.id, nextDueAt: opts.launchedAt ?? new Date('2026-11-25T08:00:00Z') })) });
  return { campaign, leads, list };
}

/** Fake clock + recording mailer. */
export function fakeDeps(start: string) {
  let t = new Date(start);
  const sent: { from: string; to: string; subject: string; inReplyTo?: string | null; references?: string | null; at: Date; messageId: string; html?: string | null; headers?: Record<string, string>; listUnsubscribe?: string }[] = [];
  let failWith: ((from: string, to: string) => any) | null = null;
  let seq = 0;
  return {
    sent,
    get now() {
      return t;
    },
    set(iso: string) {
      t = new Date(iso);
    },
    advance(minutes: number) {
      t = new Date(t.getTime() + minutes * 60_000);
    },
    failWhen(fn: ((from: string, to: string) => any) | null) {
      failWith = fn;
    },
    deps: {
      now: () => t,
      rnd: () => 0,
      ignoreSchedule: false,
      send: async (account: { email: string }, mail: any) => {
        const err = failWith?.(account.email, mail.to);
        if (err) throw err;
        const messageId = `<m${++seq}@${account.email.split('@')[1]}>`;
        sent.push({ from: account.email, to: mail.to, subject: mail.subject, inReplyTo: mail.inReplyTo, references: mail.references, at: t, messageId, html: mail.html, headers: mail.headers, listUnsubscribe: mail.listUnsubscribe });
        return { messageId };
      },
    },
  };
}
