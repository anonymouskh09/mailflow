import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import type Mail from 'nodemailer/lib/mailer/index.js';
import { randomBytes } from 'node:crypto';
import { createSmtpTransport, createImapClient, findSpecialFolder, type MailAccount } from './mail/transport.js';
import { emailDomain } from './presets.js';

export interface OutgoingEmail {
  to: string;
  subject: string;
  html?: string | null;
  text: string;
  inReplyTo?: string | null;
  references?: string | null;
  headers?: Record<string, string>;
  listUnsubscribe?: string; // URL for List-Unsubscribe + one-click
  messageId?: string;
  cc?: string;
}

export function newMessageId(fromEmail: string): string {
  return `<${randomBytes(12).toString('hex')}.${Date.now().toString(36)}@${emailDomain(fromEmail) || 'mailflow.local'}>`;
}

function buildMail(account: Pick<MailAccount, 'email' | 'fromName'>, mail: OutgoingEmail): Mail.Options {
  const headers: Record<string, string> = { ...(mail.headers ?? {}) };
  if (mail.listUnsubscribe) {
    headers['List-Unsubscribe'] = `<${mail.listUnsubscribe}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
  return {
    from: { name: account.fromName, address: account.email },
    to: mail.to,
    cc: mail.cc,
    subject: mail.subject,
    text: mail.text,
    html: mail.html ?? undefined,
    messageId: mail.messageId ?? newMessageId(account.email),
    inReplyTo: mail.inReplyTo ?? undefined,
    references: mail.references ?? undefined,
    headers,
  };
}

export async function buildRaw(account: Pick<MailAccount, 'email' | 'fromName'>, mail: OutgoingEmail): Promise<Buffer> {
  const composer = new MailComposer(buildMail(account, mail));
  return composer.compile().build();
}

/** Send one email over the account's SMTP. Returns the Message-ID used. */
export async function sendEmail(account: MailAccount, mail: OutgoingEmail): Promise<{ messageId: string; response: string }> {
  const opts = buildMail(account, mail);
  const transport = await createSmtpTransport(account);
  try {
    const info = await transport.sendMail(opts);
    return { messageId: (opts.messageId as string) ?? info.messageId, response: info.response };
  } finally {
    transport.close();
  }
}

/** Save a copy to the mailbox's Sent folder over IMAP (Gmail does this automatically). */
export async function appendToSent(account: MailAccount & { provider?: string }, mail: OutgoingEmail): Promise<void> {
  if (account.provider === 'google' || /gmail\.com$/i.test(account.smtpHost)) return; // Gmail stores sent mail itself
  const client = await createImapClient(account);
  client.on('error', () => {});
  await client.connect();
  try {
    const sent = (await findSpecialFolder(client, '\\Sent')) ?? 'Sent';
    const raw = await buildRaw(account, mail);
    try {
      await client.append(sent, raw, ['\\Seen']);
    } catch {
      await client.mailboxCreate(sent).catch(() => {});
      await client.append(sent, raw, ['\\Seen']);
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

/** Set or clear \Seen on INBOX messages (Unibox read/unread sync). */
export async function setSeenFlags(account: MailAccount, uids: number[], seen: boolean): Promise<void> {
  if (!uids.length) return;
  const client = await createImapClient(account);
  client.on('error', () => {});
  await client.connect();
  try {
    await client.mailboxOpen('INBOX');
    const set = uids.join(',');
    if (seen) await client.messageFlagsAdd(set, ['\\Seen'], { uid: true });
    else await client.messageFlagsRemove(set, ['\\Seen'], { uid: true });
  } finally {
    await client.logout().catch(() => {});
  }
}
