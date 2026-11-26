/** Sends Unibox replies that were scheduled for later. */
import { prisma } from '@mailflow/db';
import { sendEmail, appendToSent } from '@mailflow/core';
import { log } from '../log.js';

export async function sendScheduledReplies(now = new Date()) {
  const due = await prisma.inboxMessage.findMany({ where: { direction: 'out', status: 'scheduled', scheduledAt: { lte: now } }, include: { account: { include: { workspace: true } } }, take: 20 });
  let sent = 0;
  for (const m of due) {
    const claimed = await prisma.inboxMessage.updateMany({ where: { id: m.id, status: 'scheduled' }, data: { status: 'sending' } });
    if (!claimed.count) continue;
    const mail = { to: m.toEmail, subject: m.subject, html: m.bodyHtml, text: m.bodyText, inReplyTo: m.inReplyTo, references: m.references, messageId: m.messageId ?? undefined };
    try {
      await sendEmail(m.account, mail);
      await prisma.inboxMessage.update({ where: { id: m.id }, data: { status: 'sent', receivedAt: new Date(), error: null } });
      await prisma.thread.update({ where: { id: m.threadId }, data: { lastMessageAt: new Date() } });
      appendToSent(m.account, mail).catch((err) => log('warn', 'append to Sent failed', { err: err.message }));
      sent++;
    } catch (err: any) {
      await prisma.inboxMessage.update({ where: { id: m.id }, data: { status: 'failed', error: String(err?.response ?? err?.message).slice(0, 300) } });
    }
  }
  return sent;
}
