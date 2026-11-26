import { createHmac } from 'node:crypto';
import { prisma, type Prisma, type Campaign, type Lead, type SequenceStep, type Account } from '@mailflow/db';
import { env } from './env.js';
import { renderEmail, leadVars } from './render.js';
import { trackingBase } from './settings.js';
import { emailDomain } from './presets.js';

// ---------- tracking URLs ----------

export function clickSig(token: string, url: string): string {
  return createHmac('sha256', env().SESSION_SECRET).update(`${token}|${url}`).digest('base64url').slice(0, 16);
}

export function trackingUrls(base: string, token: string) {
  return {
    open: `${base}/o/${token}.gif`,
    unsubscribe: `${base}/u/${token}`,
    click: (url: string) => `${base}/c/${token}?u=${encodeURIComponent(url)}&s=${clickSig(token, url)}`,
  };
}

// ---------- rendering a campaign email ----------

type CampaignLike = Pick<Campaign, 'trackOpens' | 'trackClicks' | 'plainText' | 'unsubscribeFooter'>;

export function buildCampaignEmail(opts: {
  campaign: CampaignLike;
  step: Pick<SequenceStep, 'subject' | 'bodyHtml' | 'position'>;
  lead: Pick<Lead, 'email' | 'firstName' | 'lastName' | 'company' | 'customFields'>;
  account: Pick<Account, 'fromName' | 'email' | 'signatureHtml'>;
  token: string;
  trackingDomain: string;
  threadSubject?: string | null;
  rnd?: () => number;
}) {
  const base = trackingBase({ trackingDomain: opts.trackingDomain });
  const urls = trackingUrls(base, opts.token);
  const isReply = opts.step.position > 1 && !opts.step.subject.trim();
  const out = renderEmail({
    subject: isReply ? '' : opts.step.subject,
    bodyHtml: opts.step.bodyHtml,
    lead: leadVars(opts.lead),
    sender: opts.account,
    unsubscribeUrl: opts.campaign.unsubscribeFooter ? urls.unsubscribe : undefined,
    openPixelUrl: opts.campaign.trackOpens && !opts.campaign.plainText ? urls.open : undefined,
    clickUrl: opts.campaign.trackClicks && !opts.campaign.plainText ? urls.click : undefined,
    unsubscribeFooter: opts.campaign.unsubscribeFooter,
    plainText: opts.campaign.plainText,
    rnd: opts.rnd,
  });
  const subject = isReply ? (opts.threadSubject ? (/^re:/i.test(opts.threadSubject) ? opts.threadSubject : `Re: ${opts.threadSubject}`) : 'Re:') : out.subject;
  return { ...out, subject, isReply, unsubscribeUrl: opts.campaign.unsubscribeFooter ? urls.unsubscribe : undefined };
}

// ---------- suppression ----------

export async function isSuppressed(email: string, db: Prisma.TransactionClient = prisma): Promise<string | null> {
  const e = email.toLowerCase().trim();
  const hit = await db.suppression.findFirst({ where: { value: { in: [e, emailDomain(e)] } } });
  return hit?.reason ?? null;
}

export async function suppressedSet(emails: string[]): Promise<Set<string>> {
  const lower = emails.map((e) => e.toLowerCase());
  const domains = [...new Set(lower.map(emailDomain))];
  const rows = await prisma.suppression.findMany({ where: { value: { in: [...lower, ...domains] } }, select: { value: true } });
  const vals = new Set(rows.map((r) => r.value));
  return new Set(lower.filter((e) => vals.has(e) || vals.has(emailDomain(e))));
}

export async function addSuppression(value: string, reason: 'unsubscribed' | 'bounced' | 'manual', db: Prisma.TransactionClient = prisma) {
  const v = value.toLowerCase().trim().replace(/^@/, '');
  const kind = v.includes('@') ? 'email' : 'domain';
  await db.suppression.upsert({ where: { value: v }, update: {}, create: { value: v, kind, reason } });
}

// ---------- stop rules ----------

/** Lead replied: mark replied and cancel remaining steps (if the campaign stops on reply). */
export async function markReplied(campaignLeadId: string, opts: { auto: boolean; at?: Date }) {
  const cl = await prisma.campaignLead.findUnique({ where: { id: campaignLeadId }, include: { campaign: true, lead: true } });
  if (!cl) return;
  const at = opts.at ?? new Date();
  if (opts.auto) {
    await prisma.campaignLead.update({ where: { id: cl.id }, data: { lastActivity: 'Auto-reply', lastActivityAt: at } });
    if (!cl.campaign.stopOnAutoReply || cl.state !== 'active') return;
  }
  const stop = opts.auto ? cl.campaign.stopOnAutoReply : cl.campaign.stopOnReply;
  await prisma.campaignLead.update({
    where: { id: cl.id },
    data: {
      ...(stop && cl.state === 'active' ? { state: 'replied', nextDueAt: null } : {}),
      ...(opts.auto ? {} : { lastActivity: 'Replied', lastActivityAt: at }),
    },
  });
  if (!opts.auto) await prisma.lead.update({ where: { id: cl.leadId }, data: { status: 'replied' } });
  if (!opts.auto && cl.campaign.stopOnDomainReply) {
    const domain = emailDomain(cl.lead.email);
    const others = await prisma.campaignLead.findMany({
      where: { campaignId: cl.campaignId, state: 'active', id: { not: cl.id }, lead: { email: { endsWith: `@${domain}`, mode: 'insensitive' } } },
      select: { id: true },
    });
    if (others.length) await prisma.campaignLead.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { state: 'completed', nextDueAt: null, heldReason: `Stopped: someone at ${domain} replied` } });
  }
}

/** Hard bounce: stop the lead everywhere and suppress the address. */
export async function markBounced(email: string, opts: { campaignLeadId?: string; at?: Date } = {}) {
  const at = opts.at ?? new Date();
  await addSuppression(email, 'bounced');
  const leads = await prisma.lead.findMany({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  await prisma.lead.updateMany({ where: { id: { in: ids } }, data: { status: 'bounced' } });
  await prisma.campaignLead.updateMany({ where: { leadId: { in: ids }, state: 'active' }, data: { state: 'bounced', nextDueAt: null, lastActivity: 'Bounced', lastActivityAt: at } });
  if (opts.campaignLeadId) await prisma.campaignLead.update({ where: { id: opts.campaignLeadId }, data: { state: 'bounced', nextDueAt: null, lastActivity: 'Bounced', lastActivityAt: at } });
}

export async function markUnsubscribed(email: string, at = new Date()) {
  await addSuppression(email, 'unsubscribed');
  const leads = await prisma.lead.findMany({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  await prisma.lead.updateMany({ where: { id: { in: ids } }, data: { status: 'unsubscribed' } });
  await prisma.campaignLead.updateMany({ where: { leadId: { in: ids }, state: { in: ['active', 'completed'] } }, data: { state: 'unsubscribed', nextDueAt: null, lastActivity: 'Unsubscribed', lastActivityAt: at } });
}

// ---------- campaign leads ----------

/** Add campaign_leads rows for every lead in the campaign's list that is not in it yet. */
export async function syncCampaignLeads(campaignId: string, dueAt: Date = new Date()): Promise<number> {
  const c = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!c?.listId) return 0;
  const res = await prisma.$executeRaw`
    INSERT INTO campaign_leads (id, campaign_id, lead_id, current_step, next_due_at, state, created_at, updated_at)
    SELECT 'cl' || md5(random()::text || l.id), ${campaignId}, l.id, 0, ${dueAt}, 'active', now(), now()
    FROM leads l
    WHERE l.list_id = ${c.listId}
      AND NOT EXISTS (SELECT 1 FROM campaign_leads x WHERE x.campaign_id = ${campaignId} AND x.lead_id = l.id)
  `;
  return Number(res);
}
