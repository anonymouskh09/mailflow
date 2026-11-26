/**
 * Sending engine (SPEC §9). One `tick` picks due campaign emails and sends each through an account
 * that is inside the campaign schedule, under its limits and past its gap.
 *
 * Safety:
 *  - every campaign_lead is claimed with a conditional UPDATE (locked_until), so two workers never send it;
 *  - every send is idempotent on (campaign, lead, step) via the unique messages row;
 *  - an account sends at most once per gap, so a tick sends at most one email per account.
 */
import { prisma, isUniqueViolation, type Account, type Campaign, type SequenceStep, type CampaignLead, type Lead } from '@mailflow/db';
import {
  env,
  getSettings,
  delayMinutes,
  isWithinSchedule,
  nextOpenTime,
  dayBounds,
  addMinutes,
  randomInt,
  randomToken,
  buildCampaignEmail,
  isSuppressed,
  markBounced,
  classifySendError,
  sendEmail,
  type MailAccount,
  type OutgoingEmail,
} from '@mailflow/core';
import { log } from '../log.js';

export interface EngineDeps {
  now: () => Date;
  rnd: () => number;
  send: (account: MailAccount, mail: OutgoingEmail) => Promise<{ messageId: string }>;
  ignoreSchedule?: boolean;
}

export const defaultDeps = (): EngineDeps => ({
  now: () => new Date(),
  rnd: Math.random,
  send: (a, m) => sendEmail(a, m),
  ignoreSchedule: env().DEV_IGNORE_SCHEDULE,
});

export const RETRY_BACKOFF_MIN = [5, 15, 60];
const LOCK_MINUTES = 5;
const BATCH = 200;

type CampaignFull = Campaign & { steps: SequenceStep[]; accounts: { account: Account & { workspace: { serviceAccountJsonEnc: string } | null } }[] };
type DueLead = CampaignLead & { lead: Lead };

interface AccountState {
  account: Account & { workspace: { serviceAccountJsonEnc: string } | null };
  campaignSent: number;
  warmupReserved: number;
  blocked: boolean; // auth error / rate limit hit during this tick
}

export interface TickResult {
  sent: number;
  failed: number;
  skipped: number;
}

/** Account may send now? (status, rate-limit pause, gap, daily cap shared with warmup) */
function accountReady(s: AccountState, now: Date): boolean {
  const a = s.account;
  if (s.blocked || a.status !== 'active') return false;
  if (a.pausedUntil && a.pausedUntil > now) return false;
  if (a.nextSendAt && a.nextSendAt > now) return false;
  return s.campaignSent + s.warmupReserved < a.dailyLimit;
}

export async function tick(deps: EngineDeps = defaultDeps()): Promise<TickResult> {
  const now = deps.now();
  const settings = await getSettings();
  const result: TickResult = { sent: 0, failed: 0, skipped: 0 };

  const campaigns = (await prisma.campaign.findMany({
    where: { status: 'active' },
    include: { steps: { orderBy: { position: 'asc' } }, accounts: { include: { account: { include: { workspace: { select: { serviceAccountJsonEnc: true } } } } } } },
    orderBy: { launchedAt: 'asc' },
  })) as CampaignFull[];
  if (!campaigns.length) return result;

  // Shared account state across campaigns for this tick.
  const states = new Map<string, AccountState>();
  const allAccounts = new Map<string, AccountState['account']>();
  for (const c of campaigns) for (const ca of c.accounts) allAccounts.set(ca.account.id, ca.account);
  const ids = [...allAccounts.keys()];
  const { start, end } = dayBounds(now, settings.defaultTimezone);
  const [campCounts, warmCounts] = await Promise.all([
    prisma.message.groupBy({ by: ['accountId'], where: { accountId: { in: ids }, status: 'sent', sentAt: { gte: start, lt: end } }, _count: { _all: true } }),
    prisma.warmupMessage.groupBy({ by: ['fromAccountId'], where: { fromAccountId: { in: ids }, status: { in: ['planned', 'sent'] }, scheduledAt: { gte: start, lt: end } }, _count: { _all: true } }),
  ]);
  for (const [id, account] of allAccounts) {
    states.set(id, {
      account,
      campaignSent: campCounts.find((r) => r.accountId === id)?._count._all ?? 0,
      warmupReserved: warmCounts.find((r) => r.fromAccountId === id)?._count._all ?? 0,
      blocked: false,
    });
  }

  for (const campaign of campaigns) {
    try {
      await processCampaign(campaign, states, settings, deps, now, result);
    } catch (err) {
      log('error', 'campaign tick failed', { campaign: campaign.id, err: (err as Error).message });
    }
  }
  return result;
}

async function processCampaign(campaign: CampaignFull, states: Map<string, AccountState>, settings: Awaited<ReturnType<typeof getSettings>>, deps: EngineDeps, now: Date, result: TickResult) {
  if (campaign.startAt && campaign.startAt > now) return;
  const schedule = { timezone: campaign.timezone, days: campaign.days, windowStart: campaign.windowStart, windowEnd: campaign.windowEnd };
  if (!deps.ignoreSchedule && !isWithinSchedule(now, schedule)) return;
  if (!campaign.steps.length) return;

  const { start, end } = dayBounds(now, campaign.timezone);
  const [campaignSentToday, newLeadsToday] = await Promise.all([
    prisma.message.count({ where: { campaignId: campaign.id, status: 'sent', sentAt: { gte: start, lt: end } } }),
    campaign.newLeadsPerDay ? prisma.message.count({ where: { campaignId: campaign.id, status: 'sent', stepPosition: 1, sentAt: { gte: start, lt: end } } }) : Promise.resolve(0),
  ]);
  let campaignRemaining = campaign.dailyLimit - campaignSentToday;
  let newLeadsRemaining = campaign.newLeadsPerDay ? campaign.newLeadsPerDay - newLeadsToday : Infinity;
  if (campaignRemaining <= 0) return;

  const campaignAccountIds = new Set(campaign.accounts.map((a) => a.account.id));
  const readyCount = () => [...campaignAccountIds].filter((id) => accountReady(states.get(id)!, now)).length;
  if (!readyCount()) return;

  const due = (await prisma.campaignLead.findMany({
    where: { campaignId: campaign.id, state: 'active', nextDueAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    include: { lead: true },
    orderBy: campaign.priority === 'followups_first' ? [{ currentStep: 'desc' }, { nextDueAt: 'asc' }] : [{ currentStep: 'asc' }, { nextDueAt: 'asc' }],
    take: BATCH,
  })) as DueLead[];

  for (const cl of due) {
    if (campaignRemaining <= 0 || !readyCount()) break;
    const step = campaign.steps[cl.currentStep];
    if (!step) {
      await prisma.campaignLead.update({ where: { id: cl.id }, data: { state: 'completed', nextDueAt: null } });
      continue;
    }
    const isFollowup = cl.currentStep > 0;
    if (!isFollowup && newLeadsRemaining <= 0) {
      result.skipped++;
      continue;
    }

    // Suppression is checked at send time, so newly blocked addresses are never emailed.
    const suppressed = await isSuppressed(cl.lead.email);
    if (suppressed) {
      const state = suppressed === 'bounced' ? 'bounced' : 'unsubscribed';
      await prisma.campaignLead.update({ where: { id: cl.id }, data: { state, nextDueAt: null, heldReason: `On suppression list (${suppressed})` } });
      continue;
    }

    // Choose the account.
    let accountState: AccountState | undefined;
    if (isFollowup) {
      accountState = cl.accountId ? states.get(cl.accountId) : undefined;
      if (!accountState) {
        // Sender removed from the campaign or deleted: hold the follow-up.
        const acct = cl.accountId ? await prisma.account.findUnique({ where: { id: cl.accountId } }) : null;
        if (!acct) {
          await prisma.campaignLead.update({ where: { id: cl.id }, data: { heldReason: 'The account that sent Step 1 was removed' } });
          result.skipped++;
          continue;
        }
        if (!states.has(acct.id)) {
          // still allow sending from it even if not in the campaign's current account list
          const full = await prisma.account.findUniqueOrThrow({ where: { id: acct.id }, include: { workspace: { select: { serviceAccountJsonEnc: true } } } });
          const [sent, warm] = await Promise.all([
            prisma.message.count({ where: { accountId: acct.id, status: 'sent', sentAt: { gte: dayBounds(now, settings.defaultTimezone).start } } }),
            prisma.warmupMessage.count({ where: { fromAccountId: acct.id, status: { in: ['planned', 'sent'] }, scheduledAt: { gte: dayBounds(now, settings.defaultTimezone).start, lt: dayBounds(now, settings.defaultTimezone).end } } }),
          ]);
          states.set(acct.id, { account: full, campaignSent: sent, warmupReserved: warm, blocked: false });
        }
        accountState = states.get(acct.id);
      }
      if (!accountState || !accountReady(accountState, now)) {
        if (accountState?.account.status === 'error' && cl.heldReason !== 'Sending account has an error') {
          await prisma.campaignLead.update({ where: { id: cl.id }, data: { heldReason: 'Sending account has an error' } });
        }
        result.skipped++;
        continue;
      }
    } else {
      const candidates = [...campaignAccountIds].map((id) => states.get(id)!).filter((s) => accountReady(s, now));
      if (!candidates.length) break;
      // fewest sends today first; tie-break on oldest next_send_at (round-robin)
      candidates.sort((a, b) => a.campaignSent - b.campaignSent || (a.account.nextSendAt?.getTime() ?? 0) - (b.account.nextSendAt?.getTime() ?? 0));
      accountState = candidates[0];
    }

    // Claim the lead (conditional update = lock).
    const claimed = await prisma.campaignLead.updateMany({
      where: { id: cl.id, state: 'active', currentStep: cl.currentStep, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
      data: { lockedUntil: addMinutes(now, LOCK_MINUTES) },
    });
    if (claimed.count === 0) continue;

    // Reserve the account gap before sending so a parallel worker cannot use this account.
    const gap = Math.max(accountState.account.gapMinMinutes, randomInt(campaign.gapMin, Math.max(campaign.gapMin, campaign.gapMax), deps.rnd));
    const nextSendAt = addMinutes(now, gap);
    const reserved = await prisma.account.updateMany({
      where: { id: accountState.account.id, OR: [{ nextSendAt: null }, { nextSendAt: { lte: now } }] },
      data: { nextSendAt },
    });
    if (reserved.count === 0) {
      accountState.blocked = true; // another worker just used it
      await prisma.campaignLead.update({ where: { id: cl.id }, data: { lockedUntil: null } });
      continue;
    }
    accountState.account.nextSendAt = nextSendAt;

    const outcome = await sendOne({ campaign, cl, step, account: accountState.account, settings, deps, now });
    if (outcome === 'sent') {
      result.sent++;
      accountState.campaignSent++;
      campaignRemaining--;
      if (!isFollowup) newLeadsRemaining--;
    } else {
      if (outcome === 'auth' || outcome === 'rate_limit') accountState.blocked = true;
      if (outcome !== 'duplicate') result.failed++;
      // the gap reservation is released for failures that did not reach the server
      if (outcome === 'auth' || outcome === 'rate_limit' || outcome === 'duplicate') {
        await prisma.account.update({ where: { id: accountState.account.id }, data: { nextSendAt: now } }).catch(() => {});
        accountState.account.nextSendAt = now;
      }
    }
  }

  // Campaign completes when no active leads remain.
  // (leads that failed permanently have next_due_at = null and do not block completion)
  const remaining = await prisma.campaignLead.count({ where: { campaignId: campaign.id, state: 'active', nextDueAt: { not: null } } });
  if (remaining === 0) {
    const total = await prisma.campaignLead.count({ where: { campaignId: campaign.id } });
    if (total > 0) await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'completed', completedAt: now } });
  }
}

type SendOutcome = 'sent' | 'temporary' | 'failed' | 'hard_bounce' | 'auth' | 'rate_limit' | 'duplicate';

async function sendOne(args: { campaign: CampaignFull; cl: DueLead; step: SequenceStep; account: AccountState['account']; settings: Awaited<ReturnType<typeof getSettings>>; deps: EngineDeps; now: Date }): Promise<SendOutcome> {
  const { campaign, cl, step, account, settings, deps, now } = args;
  const isFollowup = cl.currentStep > 0;

  // Idempotency: one messages row per (campaign, lead, step).
  let message = await prisma.message.findUnique({ where: { campaignId_leadId_stepId: { campaignId: campaign.id, leadId: cl.leadId, stepId: step.id } } });
  if (message?.status === 'sent') {
    await advance(cl, campaign, step, message.sentAt ?? now, settings, { messageId: message.messageId!, subject: message.subject, accountId: message.accountId! });
    return 'duplicate';
  }
  if (message?.status === 'failed') {
    await prisma.campaignLead.update({ where: { id: cl.id }, data: { lockedUntil: null, nextDueAt: null, heldReason: message.error ?? 'Send failed' } });
    return 'duplicate';
  }
  if (!message) {
    try {
      message = await prisma.message.create({
        data: { campaignId: campaign.id, leadId: cl.leadId, stepId: step.id, campaignLeadId: cl.id, accountId: account.id, stepPosition: step.position, token: randomToken(18), toEmail: cl.lead.email },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        await prisma.campaignLead.update({ where: { id: cl.id }, data: { lockedUntil: null } });
        return 'duplicate';
      }
      throw err;
    }
  }

  const rendered = buildCampaignEmail({ campaign, step, lead: cl.lead, account, token: message.token, trackingDomain: settings.trackingDomain, threadSubject: cl.threadSubject, rnd: deps.rnd });
  const inThread = isFollowup && rendered.isReply && !!cl.threadMessageId;
  const mail: OutgoingEmail = {
    to: cl.lead.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    inReplyTo: inThread ? (cl.threadReferences?.split(/\s+/).filter(Boolean).pop() ?? cl.threadMessageId) : undefined,
    references: inThread ? (cl.threadReferences ?? cl.threadMessageId) : undefined,
    listUnsubscribe: rendered.unsubscribeUrl,
  };

  try {
    const res = await deps.send(account, mail);
    const sentAt = deps.now();
    await prisma.$transaction([
      prisma.message.update({
        where: { id: message.id },
        data: { status: 'sent', messageId: res.messageId, sentAt, accountId: account.id, subject: mail.subject, bodyHtml: mail.html ?? '', bodyText: mail.text, error: null, nextRetryAt: null },
      }),
      prisma.event.create({ data: { messageId: message.id, campaignId: campaign.id, leadId: cl.leadId, accountId: account.id, stepId: step.id, type: 'sent', at: sentAt } }),
    ]);
    await advance(cl, campaign, step, sentAt, settings, { messageId: res.messageId, subject: mail.subject, accountId: account.id });
    return 'sent';
  } catch (err: any) {
    const kind = classifySendError(err);
    const errText = String(err?.response ?? err?.message ?? err).slice(0, 500);
    log('warn', 'send failed', { campaign: campaign.id, account: account.email, kind, err: errText });
    if (kind === 'hard_bounce') {
      await prisma.message.update({ where: { id: message.id }, data: { status: 'failed', error: errText } });
      await prisma.event.create({ data: { messageId: message.id, campaignId: campaign.id, leadId: cl.leadId, accountId: account.id, stepId: step.id, type: 'bounce', at: now } });
      await markBounced(cl.lead.email, { campaignLeadId: cl.id, at: now });
      await prisma.campaignLead.update({ where: { id: cl.id }, data: { lockedUntil: null } });
      return 'hard_bounce';
    }
    if (kind === 'auth') {
      await prisma.account.update({ where: { id: account.id }, data: { status: 'error', smtpOk: false, lastError: `SMTP login failed while sending: ${errText}`, lastCheckedAt: now } });
      account.status = 'error';
      await prisma.message.update({ where: { id: message.id }, data: { error: errText } });
      if (isFollowup) {
        await prisma.campaignLead.update({ where: { id: cl.id }, data: { lockedUntil: null, heldReason: 'Sending account has an error' } });
      } else {
        // Step 1 is re-routed: drop the provisional row so another account picks it up.
        await prisma.message.delete({ where: { id: message.id } });
        await prisma.campaignLead.update({ where: { id: cl.id }, data: { lockedUntil: null } });
      }
      return 'auth';
    }
    if (kind === 'rate_limit') {
      await prisma.account.update({ where: { id: account.id }, data: { pausedUntil: addMinutes(now, 60), lastError: `Provider rate limit: ${errText}` } });
      await prisma.message.update({ where: { id: message.id }, data: { error: errText } });
      if (!isFollowup) await prisma.message.delete({ where: { id: message.id } });
      await prisma.campaignLead.update({ where: { id: cl.id }, data: { lockedUntil: null } });
      return 'rate_limit';
    }
    // temporary: retry with back-off, up to 3 times
    const retry = message.retryCount + 1;
    if (retry > RETRY_BACKOFF_MIN.length) {
      await prisma.message.update({ where: { id: message.id }, data: { status: 'failed', error: errText, retryCount: retry } });
      await prisma.campaignLead.update({ where: { id: cl.id }, data: { lockedUntil: null, nextDueAt: null, heldReason: `Failed after ${RETRY_BACKOFF_MIN.length} retries: ${errText.slice(0, 200)}`, lastActivity: 'Failed', lastActivityAt: now } });
      return 'failed';
    }
    const at = addMinutes(now, RETRY_BACKOFF_MIN[retry - 1]);
    await prisma.message.update({ where: { id: message.id }, data: { error: errText, retryCount: retry, nextRetryAt: at } });
    await prisma.campaignLead.update({ where: { id: cl.id }, data: { lockedUntil: null, nextDueAt: at } });
    return 'temporary';
  }
}

/** After a successful send: move the lead to its next step (or complete it). */
async function advance(cl: DueLead, campaign: CampaignFull, step: SequenceStep, sentAt: Date, settings: { delayUnit: string }, sent: { messageId: string; subject: string; accountId: string }) {
  const nextStep = campaign.steps[cl.currentStep + 1];
  const schedule = { timezone: campaign.timezone, days: campaign.days, windowStart: campaign.windowStart, windowEnd: campaign.windowEnd };
  let nextDueAt: Date | null = null;
  if (nextStep) {
    const raw = addMinutes(sentAt, delayMinutes(nextStep.delayDays, settings));
    nextDueAt = nextOpenTime(raw, schedule) ?? raw;
  }
  const isFirst = cl.currentStep === 0;
  const refs = isFirst ? sent.messageId : [cl.threadReferences ?? cl.threadMessageId, sent.messageId].filter(Boolean).join(' ');
  await prisma.campaignLead.update({
    where: { id: cl.id },
    data: {
      currentStep: cl.currentStep + 1,
      nextDueAt,
      state: nextStep ? 'active' : 'completed',
      lockedUntil: null,
      heldReason: null,
      lastActivity: `Sent step ${step.position}`,
      lastActivityAt: sentAt,
      ...(isFirst ? { accountId: sent.accountId, threadMessageId: sent.messageId, threadSubject: sent.subject } : {}),
      // replies in the same thread chain their references; a new-subject step starts its own
      threadReferences: step.subject.trim() && !isFirst ? cl.threadReferences : refs,
    },
  });
  await prisma.lead.update({ where: { id: cl.leadId }, data: { status: nextStep ? 'in_sequence' : 'completed' } });
}
