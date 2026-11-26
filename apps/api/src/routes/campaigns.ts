import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, Prisma } from '@mailflow/db';
import {
  getSettings,
  isValidTimezone,
  buildCampaignEmail,
  extractVars,
  sendEmail,
  syncCampaignLeads,
  usageToday,
  warmupStats,
  nextOpenTime,
  delayMinutes,
} from '@mailflow/core';
import { badRequest, notFound, pct } from '../util.js';

const settingsSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  timezone: z.string().refine(isValidTimezone, 'Unknown timezone').optional(),
  days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  windowStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  windowEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  startAt: z.string().datetime().nullable().optional(),
  gapMin: z.coerce.number().int().min(0).max(1440).optional(),
  gapMax: z.coerce.number().int().min(0).max(1440).optional(),
  dailyLimit: z.coerce.number().int().min(1).max(100000).optional(),
  newLeadsPerDay: z.coerce.number().int().min(1).max(100000).nullable().optional(),
  priority: z.enum(['followups_first', 'new_first']).optional(),
  trackOpens: z.boolean().optional(),
  trackClicks: z.boolean().optional(),
  stopOnReply: z.boolean().optional(),
  stopOnAutoReply: z.boolean().optional(),
  stopOnDomainReply: z.boolean().optional(),
  plainText: z.boolean().optional(),
  unsubscribeFooter: z.boolean().optional(),
  listId: z.string().optional(),
});

const stepsSchema = z.object({
  steps: z
    .array(
      z.object({
        id: z.string().optional(),
        delayDays: z.coerce.number().int().min(0).max(365),
        subject: z.string().max(998),
        bodyHtml: z.string().max(200_000),
      }),
    )
    .min(1)
    .max(50),
});

export function leadStatus(cl: { state: string; currentStep: number }) {
  if (cl.state === 'active') return cl.currentStep === 0 ? 'not_contacted' : 'in_sequence';
  return cl.state;
}

/** Aggregate stats for many campaigns in a few queries. */
export async function campaignStats(ids: string[]) {
  const out = new Map<string, { leads: number; contacted: number; sent: number; opened: number; clicked: number; replied: number; bounced: number; unsubscribed: number }>();
  for (const id of ids) out.set(id, { leads: 0, contacted: 0, sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0, unsubscribed: 0 });
  if (!ids.length) return out;
  const [leads, contacted, sent, evts] = await Promise.all([
    prisma.campaignLead.groupBy({ by: ['campaignId'], where: { campaignId: { in: ids } }, _count: { _all: true } }),
    prisma.campaignLead.groupBy({ by: ['campaignId'], where: { campaignId: { in: ids }, currentStep: { gt: 0 } }, _count: { _all: true } }),
    prisma.message.groupBy({ by: ['campaignId'], where: { campaignId: { in: ids }, status: 'sent' }, _count: { _all: true } }),
    prisma.$queryRaw<{ campaign_id: string; type: string; n: bigint }[]>`
      SELECT campaign_id, type::text, COUNT(DISTINCT lead_id) AS n FROM events
      WHERE campaign_id IN (${Prisma.join(ids)}) AND type IN ('open','click','reply','bounce','unsubscribe')
      GROUP BY campaign_id, type`,
  ]);
  for (const r of leads) out.get(r.campaignId)!.leads = r._count._all;
  for (const r of contacted) out.get(r.campaignId)!.contacted = r._count._all;
  for (const r of sent) out.get(r.campaignId)!.sent = r._count._all;
  const key: Record<string, 'opened' | 'clicked' | 'replied' | 'bounced' | 'unsubscribed'> = { open: 'opened', click: 'clicked', reply: 'replied', bounce: 'bounced', unsubscribe: 'unsubscribed' };
  for (const r of evts) out.get(r.campaign_id)![key[r.type]] = Number(r.n);
  return out;
}

async function loadCampaign(id: string) {
  const c = await prisma.campaign.findUnique({
    where: { id },
    include: { steps: { orderBy: { position: 'asc' } }, accounts: { include: { account: { select: { id: true, email: true, status: true, dailyLimit: true } } } }, list: { include: { _count: { select: { leads: true } } } } },
  });
  if (!c) throw notFound('Campaign not found');
  return c;
}

function serialize(c: Awaited<ReturnType<typeof loadCampaign>>) {
  const { accounts, list, ...rest } = c;
  return { ...rest, accountIds: accounts.map((a) => a.accountId), accounts: accounts.map((a) => a.account), listName: list?.name ?? null, listLeads: list?._count.leads ?? 0 };
}

async function sampleLead(campaignId: string, listId: string | null, leadId?: string) {
  if (leadId) {
    const l = await prisma.lead.findUnique({ where: { id: leadId } });
    if (l) return l;
  }
  if (listId) {
    const l = await prisma.lead.findFirst({ where: { listId }, orderBy: { createdAt: 'asc' } });
    if (l) return l;
  }
  return { id: 'sample', email: 'james@example.com', firstName: 'James', lastName: 'Carter', company: 'Carter & Hale LLP', customFields: {} };
}

export async function campaignRoutes(app: FastifyInstance) {
  app.get('/api/campaigns', async (req) => {
    const q = z.object({ q: z.string().optional(), status: z.string().optional() }).parse(req.query);
    const where: Prisma.CampaignWhereInput = {};
    if (q.q) where.name = { contains: q.q, mode: 'insensitive' };
    if (q.status) where.status = q.status as any;
    const list = await prisma.campaign.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { steps: true, accounts: true } }, list: { include: { _count: { select: { leads: true } } } } },
    });
    const stats = await campaignStats(list.map((c) => c.id));
    const counts = await prisma.campaign.groupBy({ by: ['status'], _count: { _all: true } });
    return {
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      campaigns: list.map((c) => {
        const s = stats.get(c.id)!;
        const leads = c.status === 'draft' ? (c.list?._count.leads ?? 0) : s.leads;
        return {
          id: c.id,
          name: c.name,
          status: c.status,
          createdAt: c.createdAt,
          steps: c._count.steps,
          accounts: c._count.accounts,
          leads,
          progress: leads ? Math.round((s.contacted / leads) * 100) : 0,
          sent: s.sent,
          openRate: c.trackOpens ? pct(s.opened, s.contacted) : null,
          replyRate: pct(s.replied, s.contacted),
          contacted: s.contacted,
        };
      }),
    };
  });

  app.post('/api/campaigns', async (req) => {
    const b = z.object({ name: z.string().trim().min(1).max(200), timezone: z.string().optional() }).parse(req.body);
    const s = await getSettings();
    const tz = b.timezone && isValidTimezone(b.timezone) ? b.timezone : s.defaultTimezone;
    const list = await prisma.leadList.create({ data: { name: `${b.name} – leads` } });
    const c = await prisma.campaign.create({
      data: {
        name: b.name,
        timezone: tz,
        listId: list.id,
        steps: { create: [{ position: 1, delayDays: 0, subject: '', bodyHtml: '' }] },
      },
    });
    return { id: c.id };
  });

  app.get('/api/campaigns/:id', async (req) => {
    const { id } = req.params as { id: string };
    return serialize(await loadCampaign(id));
  });

  app.patch('/api/campaigns/:id', async (req) => {
    const { id } = req.params as { id: string };
    const b = settingsSchema.parse(req.body);
    const c = await loadCampaign(id);
    if (b.gapMin !== undefined && b.gapMax !== undefined && b.gapMax < b.gapMin) throw badRequest('Maximum gap must be at least the minimum');
    if (b.listId && c.status !== 'draft') throw badRequest('The lead list can only be changed before launch');
    const { startAt, ...rest } = b;
    await prisma.campaign.update({ where: { id }, data: { ...rest, ...(startAt !== undefined ? { startAt: startAt ? new Date(startAt) : null } : {}) } });
    return serialize(await loadCampaign(id));
  });

  app.delete('/api/campaigns/:id', async (req) => {
    const { id } = req.params as { id: string };
    await prisma.campaign.delete({ where: { id } }).catch(() => {
      throw notFound('Campaign not found');
    });
    await prisma.dailyStat.deleteMany({ where: { campaignId: id } });
    return { ok: true };
  });

  app.post('/api/campaigns/:id/duplicate', async (req) => {
    const { id } = req.params as { id: string };
    const c = await loadCampaign(id);
    const { id: _id, createdAt: _c, updatedAt: _u, status: _s, launchedAt: _l, completedAt: _x, steps, accounts, list, listId: _li, ...settings } = c;
    const newList = await prisma.leadList.create({ data: { name: `${c.name} (copy) – leads` } });
    const copy = await prisma.campaign.create({
      data: {
        ...settings,
        name: `${c.name} (copy)`,
        listId: newList.id,
        steps: { create: steps.map((s) => ({ position: s.position, delayDays: s.delayDays, subject: s.subject, bodyHtml: s.bodyHtml, bodyText: s.bodyText })) },
        accounts: { create: accounts.map((a) => ({ accountId: a.accountId })) },
      },
    });
    void list;
    return { id: copy.id };
  });

  app.put('/api/campaigns/:id/steps', async (req) => {
    const { id } = req.params as { id: string };
    const b = stepsSchema.parse(req.body);
    const c = await loadCampaign(id);
    const existing = c.steps;
    if (c.status !== 'draft') {
      // After launch: existing steps keep their order and cannot be removed; new steps may be appended.
      for (let i = 0; i < existing.length; i++) {
        if (b.steps[i]?.id !== existing[i].id) throw badRequest('After launch, steps can be edited or added at the end, but not removed or reordered');
      }
    }
    await prisma.$transaction(async (tx) => {
      const keep = new Set(b.steps.map((s) => s.id).filter(Boolean) as string[]);
      const removed = existing.filter((s) => !keep.has(s.id)).map((s) => s.id);
      if (removed.length) await tx.sequenceStep.deleteMany({ where: { id: { in: removed } } });
      for (let i = 0; i < b.steps.length; i++) {
        const s = b.steps[i];
        const data = { position: i + 1, delayDays: i === 0 ? 0 : s.delayDays, subject: s.subject, bodyHtml: s.bodyHtml };
        if (s.id && existing.some((e) => e.id === s.id)) await tx.sequenceStep.update({ where: { id: s.id }, data });
        else await tx.sequenceStep.create({ data: { ...data, campaignId: id } });
      }
      // Leads that finished all steps get the new ones when steps are appended to a running campaign.
      if (c.status !== 'draft' && b.steps.length > existing.length) {
        const added = b.steps[existing.length];
        const finished = await tx.campaignLead.findMany({ where: { campaignId: id, state: 'completed', currentStep: existing.length }, select: { id: true } });
        for (const f of finished) {
          const lastSent = await tx.message.findFirst({ where: { campaignLeadId: f.id, status: 'sent' }, orderBy: { sentAt: 'desc' } });
          const s = await getSettings();
          const base = new Date((lastSent?.sentAt ?? new Date()).getTime() + delayMinutes(added.delayDays, s) * 60_000);
          const due = nextOpenTime(base, { timezone: c.timezone, days: c.days, windowStart: c.windowStart, windowEnd: c.windowEnd }) ?? base;
          await tx.campaignLead.update({ where: { id: f.id }, data: { state: 'active', nextDueAt: due } });
        }
        if (finished.length && c.status === 'completed') await tx.campaign.update({ where: { id }, data: { status: 'active', completedAt: null } });
      }
    });
    return serialize(await loadCampaign(id));
  });

  app.put('/api/campaigns/:id/accounts', async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ accountIds: z.array(z.string()).max(1000) }).parse(req.body);
    await loadCampaign(id);
    await prisma.$transaction([
      prisma.campaignAccount.deleteMany({ where: { campaignId: id, accountId: { notIn: b.accountIds } } }),
      prisma.campaignAccount.createMany({ data: b.accountIds.map((accountId) => ({ campaignId: id, accountId })), skipDuplicates: true }),
    ]);
    return serialize(await loadCampaign(id));
  });

  app.post('/api/campaigns/:id/accounts/add', async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ accountIds: z.array(z.string()).min(1).max(1000) }).parse(req.body);
    await loadCampaign(id);
    await prisma.campaignAccount.createMany({ data: b.accountIds.map((accountId) => ({ campaignId: id, accountId })), skipDuplicates: true });
    return { ok: true };
  });

  /** Accounts with health info for the campaign Settings tab. */
  app.get('/api/campaigns/:id/account-options', async (req) => {
    const { id } = req.params as { id: string };
    await loadCampaign(id);
    const accounts = await prisma.account.findMany({ orderBy: { email: 'asc' }, select: { id: true, email: true, fromName: true, status: true, dailyLimit: true, tags: true } });
    const s = await getSettings();
    const ids = accounts.map((a) => a.id);
    const [usage, scores] = await Promise.all([usageToday(ids, new Date(), s.defaultTimezone), warmupStats(ids, new Date())]);
    return { accounts: accounts.map((a) => ({ ...a, sentToday: usage.get(a.id)!.campaign, warmupScore: scores.get(a.id)!.score })) };
  });

  app.post('/api/campaigns/:id/preview', async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ position: z.number().int().min(1), leadId: z.string().optional(), subject: z.string().optional(), bodyHtml: z.string().optional() }).parse(req.body);
    const c = await loadCampaign(id);
    const stored = c.steps.find((s) => s.position === b.position);
    const step = { position: b.position, subject: b.subject ?? stored?.subject ?? '', bodyHtml: b.bodyHtml ?? stored?.bodyHtml ?? '' };
    const first = c.steps[0];
    const lead = await sampleLead(id, c.listId, b.leadId);
    const accountId = c.accounts[0]?.accountId;
    const account = accountId ? await prisma.account.findUnique({ where: { id: accountId } }) : null;
    const sender = account ?? { fromName: 'Your Name', email: 'you@yourdomain.com', signatureHtml: 'Your Name' };
    const s = await getSettings();
    const firstSubject = first && step.position > 1 ? buildCampaignEmail({ campaign: c, step: first, lead, account: sender, token: 'preview', trackingDomain: s.trackingDomain }).subject : null;
    const out = buildCampaignEmail({ campaign: { ...c, trackOpens: false, trackClicks: false }, step, lead, account: sender, token: 'preview', trackingDomain: s.trackingDomain, threadSubject: firstSubject });

    // How many leads in the list miss a variable that has no fallback?
    const vars = [...new Set(extractVars(`${step.subject}\n${step.bodyHtml}`).filter((v) => !v.hasFallback).map((v) => v.name))].filter((v) => !['signature', 'senderName', 'senderEmail', 'unsubscribeLink'].includes(v));
    const missingCounts: Record<string, number> = {};
    if (c.listId) {
      const colMap: Record<string, string> = { firstName: 'first_name', lastName: 'last_name', company: 'company', email: 'email' };
      for (const v of vars.slice(0, 20)) {
        const col = colMap[v];
        const rows = col
          ? await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM leads WHERE list_id = $1 AND coalesce(trim(${col}), '') = ''`, c.listId)
          : await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM leads WHERE list_id = ${c.listId} AND coalesce(trim(custom_fields->>${v}), '') = ''`;
        const n = Number(rows[0]?.n ?? 0);
        if (n > 0) missingCounts[v] = n;
      }
    }
    return { subject: out.subject, html: out.html, text: out.text, missing: out.missing, missingCounts, from: `${sender.fromName} <${sender.email}>`, to: lead.email, lead: { id: lead.id, email: lead.email, firstName: lead.firstName, lastName: lead.lastName, company: lead.company } };
  });

  app.post('/api/campaigns/:id/test-email', async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ position: z.number().int().min(1), leadId: z.string().optional(), to: z.string().email().optional(), accountId: z.string().optional() }).parse(req.body);
    const c = await loadCampaign(id);
    const step = c.steps.find((s) => s.position === b.position);
    if (!step) throw badRequest('Save the step first');
    const accountId = b.accountId ?? c.accounts.find((a) => a.account.status === 'active')?.accountId ?? c.accounts[0]?.accountId;
    if (!accountId) throw badRequest('Select at least one sending account in Settings first');
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId }, include: { workspace: true } });
    const lead = await sampleLead(id, c.listId, b.leadId);
    const s = await getSettings();
    const first = c.steps[0];
    const threadSubject = step.position > 1 ? buildCampaignEmail({ campaign: c, step: first, lead, account, token: 'test', trackingDomain: s.trackingDomain }).subject : null;
    const out = buildCampaignEmail({ campaign: { ...c, trackOpens: false, trackClicks: false }, step, lead, account, token: 'test', trackingDomain: s.trackingDomain, threadSubject });
    const to = b.to ?? (s.notifyEmail || s.adminEmail);
    try {
      await sendEmail(account, { to, subject: `[Test] ${out.subject}`, html: out.html, text: out.text });
    } catch (err: any) {
      throw badRequest(`Could not send from ${account.email}: ${err?.response ?? err?.message}`);
    }
    return { ok: true, to, from: account.email };
  });

  app.post('/api/campaigns/:id/launch', async (req) => {
    const { id } = req.params as { id: string };
    const c = await loadCampaign(id);
    if (c.status === 'active') return serialize(c);
    const problems: string[] = [];
    if (!c.accounts.length) problems.push('Select at least one sending account (Settings tab)');
    else if (!c.accounts.some((a) => a.account.status === 'active')) problems.push('All selected accounts are paused or have errors');
    if (!c.steps[0]?.subject.trim()) problems.push('Step 1 needs a subject');
    c.steps.forEach((s) => {
      if (!s.bodyHtml.replace(/<[^>]+>/g, '').trim()) problems.push(`Step ${s.position} needs a body`);
    });
    if (!c.list?._count.leads) problems.push('Add leads first (Leads tab)');
    if (!c.days.length) problems.push('Choose at least one sending day');
    if (c.windowEnd <= c.windowStart) problems.push('The schedule end time must be after the start time');
    if (problems.length) throw badRequest(problems.join('. '));
    const now = new Date();
    await prisma.campaign.update({ where: { id }, data: { status: 'active', launchedAt: c.launchedAt ?? now, completedAt: null } });
    await syncCampaignLeads(id, c.startAt && c.startAt > now ? c.startAt : now);
    return serialize(await loadCampaign(id));
  });

  app.post('/api/campaigns/:id/pause', async (req) => {
    const { id } = req.params as { id: string };
    await prisma.campaign.update({ where: { id }, data: { status: 'paused' } });
    return serialize(await loadCampaign(id));
  });

  app.post('/api/campaigns/:id/resume', async (req) => {
    const { id } = req.params as { id: string };
    const c = await loadCampaign(id);
    if (c.status !== 'paused') throw badRequest('Only paused campaigns can be resumed');
    await prisma.campaign.update({ where: { id }, data: { status: 'active' } });
    await syncCampaignLeads(id, new Date());
    return serialize(await loadCampaign(id));
  });

  app.get('/api/campaigns/:id/leads', async (req) => {
    const { id } = req.params as { id: string };
    const q = z.object({ state: z.string().optional(), q: z.string().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    const c = await loadCampaign(id);
    const search = q.q
      ? { OR: [{ email: { contains: q.q, mode: 'insensitive' as const } }, { firstName: { contains: q.q, mode: 'insensitive' as const } }, { lastName: { contains: q.q, mode: 'insensitive' as const } }, { company: { contains: q.q, mode: 'insensitive' as const } }] }
      : {};
    const where: Prisma.CampaignLeadWhereInput = { campaignId: id, lead: search };
    if (q.state === 'in_sequence') Object.assign(where, { state: 'active', currentStep: { gt: 0 } });
    else if (q.state === 'not_contacted') Object.assign(where, { state: 'active', currentStep: 0 });
    else if (q.state) where.state = q.state as any;
    const [total, rows, counts] = await Promise.all([
      prisma.campaignLead.count({ where }),
      prisma.campaignLead.findMany({ where, include: { lead: true, account: { select: { email: true } } }, orderBy: [{ lastActivityAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.campaignLead.groupBy({ by: ['state'], where: { campaignId: id }, _count: { _all: true } }),
    ]);
    // Draft campaigns have no campaign_leads yet: show the list.
    if (c.status === 'draft' && c.listId && total === 0) {
      const lw: Prisma.LeadWhereInput = { listId: c.listId, ...search };
      const [lt, leads] = await Promise.all([prisma.lead.count({ where: lw }), prisma.lead.findMany({ where: lw, orderBy: { createdAt: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize })]);
      return {
        total: q.state && q.state !== 'not_contacted' ? 0 : lt,
        counts: {},
        rows: q.state && q.state !== 'not_contacted' ? [] : leads.map((l) => ({ id: l.id, leadId: l.id, email: l.email, firstName: l.firstName, lastName: l.lastName, company: l.company, customFields: l.customFields, status: 'not_contacted', step: 0, lastActivity: null, lastActivityAt: null, account: null, heldReason: null })),
      };
    }
    return {
      total,
      counts: Object.fromEntries(counts.map((x) => [x.state, x._count._all])),
      rows: rows.map((r) => ({
        id: r.id,
        leadId: r.leadId,
        email: r.lead.email,
        firstName: r.lead.firstName,
        lastName: r.lead.lastName,
        company: r.lead.company,
        customFields: r.lead.customFields,
        status: leadStatus(r),
        step: r.currentStep,
        nextDueAt: r.nextDueAt,
        lastActivity: r.lastActivity,
        lastActivityAt: r.lastActivityAt,
        account: r.account?.email ?? null,
        heldReason: r.heldReason,
      })),
    };
  });

  app.get('/api/campaigns/:id/stats', async (req) => {
    const { id } = req.params as { id: string };
    const c = await loadCampaign(id);
    const s = (await campaignStats([id])).get(id)!;
    const total = c.status === 'draft' ? (c.list?._count.leads ?? 0) : s.leads;
    const steps = await prisma.$queryRaw<{ step_id: string; sent: bigint; opened: bigint; clicked: bigint; replied: bigint }[]>`
      SELECT m.step_id,
        COUNT(*) FILTER (WHERE m.status = 'sent') AS sent,
        COUNT(DISTINCT m.lead_id) FILTER (WHERE EXISTS (SELECT 1 FROM events e WHERE e.message_id = m.id AND e.type = 'open')) AS opened,
        COUNT(DISTINCT m.lead_id) FILTER (WHERE EXISTS (SELECT 1 FROM events e WHERE e.message_id = m.id AND e.type = 'click')) AS clicked,
        COUNT(DISTINCT m.lead_id) FILTER (WHERE EXISTS (SELECT 1 FROM events e WHERE e.message_id = m.id AND e.type = 'reply')) AS replied
      FROM messages m WHERE m.campaign_id = ${id} GROUP BY m.step_id`;
    return {
      kpis: { total, contacted: s.contacted, opened: s.opened, clicked: s.clicked, replied: s.replied, bounced: s.bounced, unsubscribed: s.unsubscribed, sent: s.sent },
      trackOpens: c.trackOpens && !c.plainText,
      trackClicks: c.trackClicks && !c.plainText,
      steps: c.steps.map((st) => {
        const r = steps.find((x) => x.step_id === st.id);
        const sent = Number(r?.sent ?? 0);
        return { position: st.position, delayDays: st.delayDays, subject: st.subject, sent, opened: Number(r?.opened ?? 0), clicked: Number(r?.clicked ?? 0), replied: Number(r?.replied ?? 0) };
      }),
    };
  });
}
