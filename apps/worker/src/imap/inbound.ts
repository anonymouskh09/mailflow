/**
 * Classify and store one incoming email for an account (SPEC §10, §11).
 * Pure DB logic: no IMAP here, so it is unit-testable with raw RFC 822 strings.
 */
import { simpleParser, type ParsedMail, type AddressObject } from 'mailparser';
import { prisma, isUniqueViolation } from '@mailflow/db';
import { isAutoReply, isBounceSender, parseBounce, findWarmupCode, markReplied, markBounced, stripQuoted, htmlToText } from '@mailflow/core';

export type InboundKind = 'warmup' | 'bounce' | 'reply' | 'auto_reply' | 'lead_email' | 'ignored' | 'duplicate';

export interface InboundResult {
  kind: InboundKind;
  warmupCode?: string;
  threadId?: string;
}

function firstAddress(a: AddressObject | AddressObject[] | undefined): { address: string; name: string } {
  const obj = Array.isArray(a) ? a[0] : a;
  const v = obj?.value?.[0];
  return { address: (v?.address ?? '').toLowerCase(), name: v?.name ?? '' };
}

function idList(v: string | string[] | undefined): string[] {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.flatMap((x) => x.match(/<[^>]+>/g) ?? []).map((x) => x.trim());
}

export async function parseRaw(raw: Buffer | string): Promise<ParsedMail> {
  return simpleParser(raw, { skipImageLinks: true, skipTextToHtml: false });
}

export async function processInbound(
  account: { id: string; email: string },
  raw: Buffer | string,
  meta: { uid?: number; folder?: string; receivedAt?: Date } = {},
): Promise<InboundResult> {
  const mail = await parseRaw(raw);
  const from = firstAddress(mail.from);
  const subject = mail.subject ?? '';
  const text = mail.text ?? (mail.html ? htmlToText(String(mail.html)) : '');
  const receivedAt = meta.receivedAt ?? mail.date ?? new Date();
  const rawStr = typeof raw === 'string' ? raw : raw.toString('utf8');

  // 1. Warmup traffic never reaches campaigns or the Unibox.
  const code = findWarmupCode(mail.headers as any, text);
  if (code) return { kind: 'warmup', warmupCode: code };

  // Our own outgoing mail (e.g. copies) is not a reply.
  if (from.address === account.email.toLowerCase()) return { kind: 'ignored' };

  // 2. Bounces (delivery status notifications).
  if (isBounceSender(`${from.name} <${from.address}>`, subject)) {
    const b = parseBounce(rawStr);
    let message = b.originalMessageId ? await prisma.message.findUnique({ where: { messageId: b.originalMessageId } }) : null;
    if (!message && b.recipient) {
      message = await prisma.message.findFirst({ where: { accountId: account.id, toEmail: b.recipient, status: 'sent' }, orderBy: { sentAt: 'desc' } });
    }
    if (message && b.permanent) {
      const exists = await prisma.event.findFirst({ where: { messageId: message.id, type: 'bounce' } });
      if (!exists) await prisma.event.create({ data: { messageId: message.id, campaignId: message.campaignId, leadId: message.leadId, accountId: message.accountId, stepId: message.stepId, type: 'bounce', at: receivedAt } });
      await markBounced(message.toEmail, { campaignLeadId: message.campaignLeadId, at: receivedAt });
      return { kind: 'bounce' };
    }
    return { kind: 'ignored' };
  }

  // 3. Match to a campaign email: In-Reply-To / References first, then sender address.
  const refs = [...idList(mail.inReplyTo), ...idList(mail.references as any)];
  let campaignMessage = refs.length ? await prisma.message.findFirst({ where: { messageId: { in: refs } }, orderBy: { sentAt: 'desc' } }) : null;
  let outboundUnibox = !campaignMessage && refs.length ? await prisma.inboxMessage.findFirst({ where: { accountId: account.id, direction: 'out', messageId: { in: refs } }, include: { thread: true } }) : null;
  if (!campaignMessage && !outboundUnibox) {
    campaignMessage = await prisma.message.findFirst({ where: { accountId: account.id, toEmail: from.address, status: 'sent' }, orderBy: { sentAt: 'desc' } });
  }
  // A reply that came to a different mailbox than the one that sent: still attribute to the campaign
  if (campaignMessage && campaignMessage.toEmail !== from.address && !refs.length) campaignMessage = null;

  let leadId: string | null = campaignMessage?.leadId ?? outboundUnibox?.thread.leadId ?? null;
  let campaignId: string | null = campaignMessage?.campaignId ?? outboundUnibox?.thread.campaignId ?? null;
  let campaignLeadId: string | null = campaignMessage?.campaignLeadId ?? outboundUnibox?.thread.campaignLeadId ?? null;

  if (!leadId) {
    // "plus any new email from an address in a lead list"
    const lead = await prisma.lead.findFirst({ where: { email: from.address }, orderBy: { createdAt: 'desc' } });
    if (!lead) return { kind: 'ignored' };
    leadId = lead.id;
    const cl = await prisma.campaignLead.findFirst({ where: { leadId: lead.id, accountId: account.id }, orderBy: { createdAt: 'desc' } });
    campaignId = cl?.campaignId ?? null;
    campaignLeadId = cl?.id ?? null;
  }

  const auto = isAutoReply(mail.headers as any, subject, text);
  const messageId = mail.messageId ?? `<no-id-${meta.uid ?? Date.now()}@${account.email}>`;
  const existing = await prisma.inboxMessage.findUnique({ where: { accountId_messageId: { accountId: account.id, messageId } } });
  if (existing) return { kind: 'duplicate', threadId: existing.threadId };

  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
  const leadName = `${lead.firstName} ${lead.lastName}`.trim() || from.name;
  const snippet = stripQuoted(text).replace(/\s+/g, ' ').slice(0, 200);

  const thread = await prisma.thread.upsert({
    where: { accountId_leadEmail: { accountId: account.id, leadEmail: from.address } },
    update: { lastMessageAt: receivedAt, unread: true, snippet, leadId, ...(campaignId ? { campaignId, campaignLeadId } : {}) },
    create: { accountId: account.id, leadEmail: from.address, leadName, leadId, campaignId, campaignLeadId, subject, snippet, lastMessageAt: receivedAt, unread: true },
  });

  try {
    await prisma.inboxMessage.create({
      data: {
        threadId: thread.id,
        accountId: account.id,
        direction: 'in',
        messageId,
        inReplyTo: idList(mail.inReplyTo)[0] ?? null,
        references: refs.join(' ') || null,
        fromEmail: from.address,
        fromName: from.name,
        toEmail: account.email,
        subject,
        bodyHtml: mail.html ? String(mail.html) : '',
        bodyText: text,
        isAutoReply: auto,
        receivedAt,
        imapUid: meta.uid ?? null,
        imapFolder: meta.folder ?? 'INBOX',
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { kind: 'duplicate', threadId: thread.id };
    throw err;
  }

  if (auto) {
    const ooo = await prisma.leadLabel.findFirst({ where: { name: 'Out of office' } });
    if (ooo && !thread.labelId) await prisma.thread.update({ where: { id: thread.id }, data: { labelId: ooo.id } });
  }

  // Campaign stats + stop rules
  if (campaignLeadId) {
    const target =
      campaignMessage ??
      (await prisma.message.findFirst({ where: { campaignLeadId, status: 'sent' }, orderBy: { sentAt: 'desc' } }));
    if (target) {
      const type = auto ? 'auto_reply' : 'reply';
      const dup = await prisma.event.findFirst({ where: { messageId: target.id, type } });
      if (!dup || auto) await prisma.event.create({ data: { messageId: target.id, campaignId: target.campaignId, leadId: target.leadId, accountId: target.accountId, stepId: target.stepId, type, at: receivedAt } });
    }
    await markReplied(campaignLeadId, { auto, at: receivedAt });
  } else if (!auto) {
    await prisma.lead.update({ where: { id: leadId }, data: { status: 'replied' } }).catch(() => {});
  }
  return { kind: auto ? 'auto_reply' : campaignLeadId ? 'reply' : 'lead_email', threadId: thread.id };
}
