import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, type Prisma } from '@mailflow/db';
import { sendEmail, appendToSent, newMessageId, setSeenFlags, substitute, leadVars, textToHtml, htmlToText, escapeHtml, addSuppression, syncCampaignLeads } from '@mailflow/core';
import { badRequest, notFound } from '../util.js';
import { leadStatus } from './campaigns.js';

export const DEFAULT_LABELS = [
  { name: 'Interested', bg: '#DCFCE7', color: '#166534' },
  { name: 'Meeting booked', bg: '#DBEAFE', color: '#1E40AF' },
  { name: 'Not interested', bg: '#F4F4F5', color: '#3F3F46' },
  { name: 'Out of office', bg: '#FEF3C7', color: '#92400E' },
  { name: 'Wrong person', bg: '#FCE7F3', color: '#9D174D' },
  { name: 'Do not contact', bg: '#FEE2E2', color: '#991B1B' },
];

export async function seedLabels() {
  if ((await prisma.leadLabel.count()) > 0) return;
  await prisma.leadLabel.createMany({ data: DEFAULT_LABELS.map((l, i) => ({ ...l, position: i })) });
}

const reSubject = (s: string) => (/^re:/i.test(s.trim()) ? s.trim() : `Re: ${s.trim()}`);

export async function uniboxRoutes(app: FastifyInstance) {
  app.get('/api/unibox/unread-count', async () => ({ count: await prisma.thread.count({ where: { unread: true, isLead: true } }) }));

  app.get('/api/unibox/threads', async (req) => {
    const q = z
      .object({
        tab: z.enum(['all', 'unread', 'interested']).default('all'),
        label: z.string().optional(),
        campaign: z.string().optional(),
        account: z.string().optional(),
        q: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        notLeads: z.string().optional(),
        page: z.coerce.number().int().min(1).default(1),
      })
      .parse(req.query);
    const where: Prisma.ThreadWhereInput = { isLead: q.notLeads === '1' ? false : true };
    if (q.tab === 'unread') where.unread = true;
    if (q.tab === 'interested') where.label = { name: 'Interested' };
    if (q.label) where.labelId = q.label;
    if (q.campaign) where.campaignId = q.campaign;
    if (q.account) where.accountId = q.account;
    if (q.from || q.to) where.lastMessageAt = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) };
    if (q.q) {
      const s = q.q.trim();
      where.OR = [
        { leadName: { contains: s, mode: 'insensitive' } },
        { leadEmail: { contains: s, mode: 'insensitive' } },
        { lead: { company: { contains: s, mode: 'insensitive' } } },
        { messages: { some: { bodyText: { contains: s, mode: 'insensitive' } } } },
      ];
    }
    const [total, threads, unread] = await Promise.all([
      prisma.thread.count({ where }),
      prisma.thread.findMany({ where, orderBy: { lastMessageAt: 'desc' }, skip: (q.page - 1) * 50, take: 50, include: { label: true, campaign: { select: { name: true } }, account: { select: { email: true } } } }),
      prisma.thread.count({ where: { unread: true, isLead: true } }),
    ]);
    return {
      total,
      unread,
      threads: threads.map((t) => ({
        id: t.id,
        leadName: t.leadName || t.leadEmail,
        leadEmail: t.leadEmail,
        snippet: t.snippet,
        lastMessageAt: t.lastMessageAt,
        unread: t.unread,
        label: t.label ? { id: t.label.id, name: t.label.name, color: t.label.color, bg: t.label.bg } : null,
        campaign: t.campaign?.name ?? null,
        account: t.account.email,
      })),
    };
  });

  app.get('/api/unibox/threads/:id', async (req) => {
    const { id } = req.params as { id: string };
    const t = await prisma.thread.findUnique({
      where: { id },
      include: {
        label: true,
        account: { select: { id: true, email: true, fromName: true, signatureHtml: true } },
        lead: true,
        campaign: { select: { id: true, name: true, _count: { select: { steps: true } } } },
        campaignLead: true,
        messages: { orderBy: { receivedAt: 'asc' } },
      },
    });
    if (!t) throw notFound('Conversation not found');
    const campaignMsgs = t.leadId
      ? await prisma.message.findMany({ where: { leadId: t.leadId, accountId: t.accountId, status: 'sent' }, orderBy: { sentAt: 'asc' }, select: { id: true, subject: true, bodyHtml: true, bodyText: true, sentAt: true, stepPosition: true, toEmail: true } })
      : [];
    const items = [
      ...campaignMsgs.map((m) => ({ id: m.id, kind: 'campaign', direction: 'out', fromName: t.account.fromName, fromEmail: t.account.email, toEmail: m.toEmail, subject: m.subject, html: m.bodyHtml.replace(/<img[^>]+\/o\/[^>]+>/g, ''), text: m.bodyText, at: m.sentAt, step: m.stepPosition, status: 'sent' })),
      ...t.messages.map((m) => ({ id: m.id, kind: 'inbox', direction: m.direction, fromName: m.direction === 'out' ? t.account.fromName : m.fromName || t.leadName, fromEmail: m.fromEmail, toEmail: m.toEmail, subject: m.subject, html: m.bodyHtml, text: m.bodyText, at: m.status === 'scheduled' ? m.scheduledAt : m.receivedAt, step: null, status: m.status, isAutoReply: m.isAutoReply, error: m.error })),
    ].sort((a, b) => new Date(a.at ?? 0).getTime() - new Date(b.at ?? 0).getTime());

    const custom = (t.lead?.customFields ?? {}) as Record<string, string>;
    return {
      id: t.id,
      subject: t.subject,
      leadName: t.leadName || t.leadEmail,
      leadEmail: t.leadEmail,
      unread: t.unread,
      isLead: t.isLead,
      notes: t.notes,
      label: t.label ? { id: t.label.id, name: t.label.name, color: t.label.color, bg: t.label.bg } : null,
      account: { id: t.account.id, email: t.account.email },
      lead: t.lead ? { id: t.lead.id, firstName: t.lead.firstName, lastName: t.lead.lastName, company: t.lead.company, status: t.lead.status, custom } : null,
      campaign: t.campaign ? { id: t.campaign.id, name: t.campaign.name, steps: t.campaign._count.steps } : null,
      progress: t.campaignLead ? { step: t.campaignLead.currentStep, status: leadStatus(t.campaignLead) } : null,
      items,
    };
  });

  app.patch('/api/unibox/threads/:id', async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ labelId: z.string().nullable().optional(), unread: z.boolean().optional(), isLead: z.boolean().optional(), notes: z.string().max(20000).optional() }).parse(req.body);
    const t = await prisma.thread.findUnique({ where: { id }, include: { account: { include: { workspace: true } }, messages: { where: { direction: 'in', imapUid: { not: null } }, select: { imapUid: true, imapFolder: true } } } });
    if (!t) throw notFound('Conversation not found');
    const updated = await prisma.thread.update({ where: { id }, data: b });
    if (b.unread !== undefined && b.unread !== t.unread) {
      // Sync read state back to the real mailbox (best effort, in the background).
      const uids = t.messages.filter((m) => (m.imapFolder ?? 'INBOX') === 'INBOX').map((m) => m.imapUid!) as number[];
      setSeenFlags(t.account, uids, !b.unread).catch((err) => req.log.warn({ err: err.message }, 'read-state sync failed'));
    }
    if (b.labelId) {
      const label = await prisma.leadLabel.findUnique({ where: { id: b.labelId } });
      if (label?.name === 'Do not contact') await addSuppression(t.leadEmail, 'manual');
    }
    return { ok: true, unread: updated.unread };
  });

  app.post('/api/unibox/threads/:id/reply', async (req) => {
    const { id } = req.params as { id: string };
    const b = z
      .object({
        bodyHtml: z.string().min(1).max(200_000),
        scheduledAt: z.string().datetime().optional(),
        forwardTo: z.string().email().optional(),
        quote: z.boolean().default(true),
      })
      .parse(req.body);
    const t = await prisma.thread.findUnique({ where: { id }, include: { account: { include: { workspace: true } }, lead: true, messages: { orderBy: { receivedAt: 'desc' } } } });
    if (!t) throw notFound('Conversation not found');
    if (t.account.status === 'paused') throw badRequest(`${t.account.email} is paused. Resume it to reply.`);
    const lastIn = t.messages.find((m) => m.direction === 'in');
    const lastCampaign = t.leadId ? await prisma.message.findFirst({ where: { leadId: t.leadId, accountId: t.accountId, status: 'sent' }, orderBy: { sentAt: 'desc' } }) : null;
    const parentId = lastIn?.messageId ?? lastCampaign?.messageId ?? null;
    const refs = [lastIn?.references, parentId].filter(Boolean).join(' ').trim() || null;
    const baseSubject = lastIn?.subject || lastCampaign?.subject || t.subject || '';

    const vars = { ...(t.lead ? leadVars(t.lead) : { email: t.leadEmail }), senderName: t.account.fromName, senderEmail: t.account.email, signature: t.account.signatureHtml ? textToHtml(t.account.signatureHtml) : '' };
    let html = substitute(textToHtml(b.bodyHtml), vars, { html: true, raw: ['signature'] }).text;
    const quoted = lastIn ?? null;
    if (b.quote && quoted) {
      const when = quoted.receivedAt.toUTCString().replace(' GMT', '');
      const q = quoted.bodyText ? escapeHtml(quoted.bodyText).replace(/\n/g, '<br>') : quoted.bodyHtml;
      html += `<br><div>On ${escapeHtml(when)}, ${escapeHtml(quoted.fromName || quoted.fromEmail)} &lt;${escapeHtml(quoted.fromEmail)}&gt; wrote:</div><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${q}</blockquote>`;
    }
    const text = htmlToText(html);
    const isForward = !!b.forwardTo;
    const mail = {
      to: b.forwardTo ?? t.leadEmail,
      subject: isForward ? `Fwd: ${baseSubject.replace(/^(re|fwd):\s*/i, '')}` : reSubject(baseSubject),
      html,
      text,
      inReplyTo: isForward ? null : parentId,
      references: isForward ? null : refs,
      messageId: newMessageId(t.account.email),
    };
    const scheduled = b.scheduledAt ? new Date(b.scheduledAt) : null;
    if (scheduled && scheduled.getTime() > Date.now() + 30_000) {
      const m = await prisma.inboxMessage.create({
        data: { threadId: t.id, accountId: t.accountId, direction: 'out', status: 'scheduled', messageId: mail.messageId, inReplyTo: mail.inReplyTo, references: mail.references, fromEmail: t.account.email, fromName: t.account.fromName, toEmail: mail.to, subject: mail.subject, bodyHtml: html, bodyText: text, receivedAt: scheduled, scheduledAt: scheduled },
      });
      return { ok: true, scheduled: true, id: m.id };
    }
    try {
      await sendEmail(t.account, mail);
    } catch (err: any) {
      throw badRequest(`Could not send from ${t.account.email}: ${String(err?.response ?? err?.message).slice(0, 200)}`);
    }
    const now = new Date();
    const m = await prisma.inboxMessage.create({
      data: { threadId: t.id, accountId: t.accountId, direction: 'out', status: 'sent', messageId: mail.messageId, inReplyTo: mail.inReplyTo, references: mail.references, fromEmail: t.account.email, fromName: t.account.fromName, toEmail: mail.to, subject: mail.subject, bodyHtml: html, bodyText: text, receivedAt: now },
    });
    await prisma.thread.update({ where: { id: t.id }, data: { lastMessageAt: now, unread: false } });
    // A copy in the mailbox's Sent folder so it also shows in Gmail / Outlook.
    appendToSent(t.account, mail).catch((err) => req.log.warn({ err: err.message }, 'append to Sent failed'));
    return { ok: true, scheduled: false, id: m.id };
  });

  app.delete('/api/unibox/messages/:id', async (req) => {
    const { id } = req.params as { id: string };
    const m = await prisma.inboxMessage.findUnique({ where: { id } });
    if (!m || m.status !== 'scheduled') throw badRequest('Only scheduled replies can be cancelled');
    await prisma.inboxMessage.delete({ where: { id } });
    return { ok: true };
  });

  app.post('/api/unibox/threads/:id/suppress', async (req) => {
    const { id } = req.params as { id: string };
    const t = await prisma.thread.findUnique({ where: { id } });
    if (!t) throw notFound();
    await addSuppression(t.leadEmail, 'manual');
    await prisma.campaignLead.updateMany({ where: { state: 'active', lead: { email: t.leadEmail } }, data: { state: 'unsubscribed', nextDueAt: null, heldReason: 'Added to suppression list' } });
    return { ok: true };
  });

  app.post('/api/unibox/threads/:id/move', async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ campaignId: z.string() }).parse(req.body);
    const t = await prisma.thread.findUnique({ where: { id }, include: { lead: true } });
    if (!t) throw notFound();
    const target = await prisma.campaign.findUnique({ where: { id: b.campaignId } });
    if (!target?.listId) throw badRequest('Campaign not found');
    // stop the lead in its current campaign, then add it to the target campaign's list
    if (t.campaignLeadId) await prisma.campaignLead.update({ where: { id: t.campaignLeadId }, data: { state: 'completed', nextDueAt: null, heldReason: `Moved to ${target.name}` } });
    const src = t.lead;
    await prisma.lead.upsert({
      where: { listId_email: { listId: target.listId, email: t.leadEmail } },
      update: {},
      create: { listId: target.listId, email: t.leadEmail, firstName: src?.firstName ?? '', lastName: src?.lastName ?? '', company: src?.company ?? '', customFields: (src?.customFields ?? {}) as Prisma.InputJsonValue },
    });
    if (target.status === 'active' || target.status === 'paused') await syncCampaignLeads(target.id);
    return { ok: true };
  });

  // ---- Labels ----
  app.get('/api/labels', async () => ({ labels: await prisma.leadLabel.findMany({ orderBy: { position: 'asc' } }) }));
  app.post('/api/labels', async (req) => {
    const b = z.object({ name: z.string().trim().min(1).max(60), color: z.string().max(20).optional(), bg: z.string().max(20).optional() }).parse(req.body);
    const max = await prisma.leadLabel.aggregate({ _max: { position: true } });
    return prisma.leadLabel.create({ data: { ...b, position: (max._max.position ?? 0) + 1 } });
  });
  app.patch('/api/labels/:id', async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ name: z.string().trim().min(1).max(60).optional(), color: z.string().max(20).optional(), bg: z.string().max(20).optional(), position: z.number().int().optional() }).parse(req.body);
    return prisma.leadLabel.update({ where: { id }, data: b });
  });
  app.delete('/api/labels/:id', async (req) => {
    const { id } = req.params as { id: string };
    await prisma.leadLabel.delete({ where: { id } });
    return { ok: true };
  });

  // ---- Saved reply templates ----
  app.get('/api/reply-templates', async () => ({ templates: await prisma.replyTemplate.findMany({ orderBy: { name: 'asc' } }) }));
  app.post('/api/reply-templates', async (req) => {
    const b = z.object({ name: z.string().trim().min(1).max(120), subject: z.string().max(998).default(''), bodyHtml: z.string().min(1).max(100_000) }).parse(req.body);
    return prisma.replyTemplate.create({ data: b });
  });
  app.patch('/api/reply-templates/:id', async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ name: z.string().trim().min(1).max(120).optional(), subject: z.string().max(998).optional(), bodyHtml: z.string().min(1).max(100_000).optional() }).parse(req.body);
    return prisma.replyTemplate.update({ where: { id }, data: b });
  });
  app.delete('/api/reply-templates/:id', async (req) => {
    const { id } = req.params as { id: string };
    await prisma.replyTemplate.delete({ where: { id } });
    return { ok: true };
  });
}
