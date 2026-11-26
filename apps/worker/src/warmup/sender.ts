/** Sends due warmup emails and warmup replies (rows in warmup_messages with status planned). */
import { prisma } from '@mailflow/db';
import { sendEmail, generateWarmup, generateWarmupReply, WARMUP_HEADER, addMinutes, type MailAccount, type OutgoingEmail } from '@mailflow/core';
import { log } from '../log.js';

export interface WarmupDeps {
  now: () => Date;
  send: (account: MailAccount, mail: OutgoingEmail) => Promise<{ messageId: string }>;
}

const defaultDeps: WarmupDeps = { now: () => new Date(), send: (a, m) => sendEmail(a, m) };

export async function sendDueWarmups(deps: WarmupDeps = defaultDeps, limit = 50) {
  const now = deps.now();
  const due = await prisma.warmupMessage.findMany({
    where: { status: 'planned', scheduledAt: { lte: now } },
    include: { fromAccount: { include: { workspace: true, warmup: true } }, toAccount: true },
    orderBy: { scheduledAt: 'asc' },
    take: limit,
  });
  let sent = 0;
  for (const w of due) {
    const from = w.fromAccount;
    const isReply = !!w.parentId;
    if (from.status !== 'active' || (from.pausedUntil && from.pausedUntil > now) || (!isReply && !from.warmup?.enabled)) {
      // skipped sends are dropped, not retried, so they never pile up
      await prisma.warmupMessage.update({ where: { id: w.id }, data: { status: 'failed', error: 'Account not available' } });
      continue;
    }
    // claim: push scheduledAt forward so a parallel worker skips it
    const claimed = await prisma.warmupMessage.updateMany({ where: { id: w.id, status: 'planned', scheduledAt: w.scheduledAt }, data: { scheduledAt: addMinutes(now, 10) } });
    if (!claimed.count) continue;
    try {
      let mail: OutgoingEmail;
      if (isReply) {
        const parent = await prisma.warmupMessage.findUnique({ where: { id: w.parentId! } });
        const body = generateWarmupReply({ toName: w.toAccount.fromName, toEmail: w.toAccount.email, fromName: from.fromName, code: w.code });
        mail = {
          to: w.toAccount.email,
          subject: parent?.subject ? (parent.subject.startsWith('Re:') ? parent.subject : `Re: ${parent.subject}`) : 'Re:',
          text: body.text,
          inReplyTo: parent?.messageId ?? undefined,
          references: parent?.messageId ?? undefined,
          headers: { [WARMUP_HEADER]: w.code },
        };
      } else {
        const g = generateWarmup({ toName: w.toAccount.fromName, toEmail: w.toAccount.email, fromName: from.fromName, code: w.code });
        mail = { to: w.toAccount.email, subject: g.subject, text: g.text, headers: { [WARMUP_HEADER]: w.code } };
      }
      const res = await deps.send(from, mail);
      await prisma.warmupMessage.update({ where: { id: w.id }, data: { status: 'sent', sentAt: deps.now(), messageId: res.messageId, subject: mail.subject } });
      if (isReply) await prisma.warmupMessage.update({ where: { id: w.parentId! }, data: { repliedAt: deps.now() } });
      sent++;
    } catch (err: any) {
      log('warn', 'warmup send failed', { from: from.email, err: err?.message });
      await prisma.warmupMessage.update({ where: { id: w.id }, data: { status: 'failed', error: String(err?.response ?? err?.message).slice(0, 300) } });
    }
  }
  return sent;
}
