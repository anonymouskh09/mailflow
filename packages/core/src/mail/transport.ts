import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import { ImapFlow } from 'imapflow';
import { decrypt } from '../crypto.js';
import { env } from '../env.js';
import { getGoogleAccessToken } from './google.js';

export interface MailAccount {
  id: string;
  email: string;
  fromName: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  username: string;
  authType: string;
  passwordEnc: string | null;
  oauthRefreshTokenEnc: string | null;
  workspace?: { serviceAccountJsonEnc: string } | null;
}

/** Plain credentials, used when testing before an account is saved. */
export interface RawCredentials {
  password?: string;
  accessToken?: string;
}

async function credentials(account: MailAccount, raw?: RawCredentials): Promise<{ pass?: string; accessToken?: string }> {
  if (raw?.accessToken) return { accessToken: raw.accessToken };
  if (raw?.password !== undefined) return { pass: raw.password };
  if (account.authType === 'password') {
    if (!account.passwordEnc) throw new Error('No password stored');
    return { pass: decrypt(account.passwordEnc) };
  }
  return { accessToken: await getGoogleAccessToken(account) };
}

export async function createSmtpTransport(account: MailAccount, raw?: RawCredentials): Promise<Transporter<SMTPTransport.SentMessageInfo>> {
  const override = env().DEV_SMTP_OVERRIDE;
  if (override) {
    const u = new URL(override);
    return nodemailer.createTransport({
      host: u.hostname,
      port: Number(u.port || 1025),
      secure: u.protocol === 'smtps:',
      auth: u.username ? { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) } : undefined,
      tls: { rejectUnauthorized: false },
    });
  }
  const cred = await credentials(account, raw);
  const auth = cred.accessToken
    ? { type: 'OAuth2' as const, user: account.username || account.email, accessToken: cred.accessToken }
    : { user: account.username || account.email, pass: cred.pass ?? '' };
  return nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure,
    requireTLS: !account.smtpSecure && account.smtpPort === 587,
    auth,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
}

export async function createImapClient(account: MailAccount, raw?: RawCredentials): Promise<ImapFlow> {
  const cred = await credentials(account, raw);
  return new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    auth: cred.accessToken
      ? { user: account.username || account.email, accessToken: cred.accessToken }
      : { user: account.username || account.email, pass: cred.pass ?? '' },
    logger: false,
    socketTimeout: 120_000,
    tls: { rejectUnauthorized: env().NODE_ENV === 'production' },
  });
}

export interface TestResult {
  ok: boolean;
  error?: string;
}

function friendly(err: any, kind: 'SMTP' | 'IMAP'): string {
  const code = err?.code as string | undefined;
  const resp = (err?.response as string | undefined) ?? err?.responseText ?? '';
  if (code === 'EAUTH' || err?.authenticationFailed || /auth/i.test(resp)) {
    return `${kind} login failed: wrong username or (app) password${resp ? ` — ${String(resp).slice(0, 160)}` : ''}`;
  }
  if (code === 'ETIMEDOUT' || code === 'ETIMEOUT' || code === 'ECONNECTION' || code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ESOCKET') {
    return `${kind} server unreachable (${code}) — check host and port${kind === 'SMTP' ? '; many VPS block 465, use 587' : ''}`;
  }
  return `${kind} error: ${String(err?.message ?? err).slice(0, 200)}`;
}

export async function testSmtp(account: MailAccount, raw?: RawCredentials): Promise<TestResult> {
  try {
    const t = await createSmtpTransport(account, raw);
    await t.verify();
    t.close();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendly(err, 'SMTP') };
  }
}

export async function testImap(account: MailAccount, raw?: RawCredentials): Promise<TestResult> {
  let client: ImapFlow | undefined;
  try {
    client = await createImapClient(account, raw);
    client.on('error', () => {});
    await client.connect();
    await client.mailboxOpen('INBOX', { readOnly: true });
    await client.logout();
    return { ok: true };
  } catch (err) {
    try {
      client?.close();
    } catch {}
    return { ok: false, error: friendly(err, 'IMAP') };
  }
}

export async function testConnection(account: MailAccount, raw?: RawCredentials) {
  const [smtp, imap] = await Promise.all([testSmtp(account, raw), testImap(account, raw)]);
  return { smtp, imap, ok: smtp.ok && imap.ok };
}

/** Classify an SMTP send error for the retry policy (SPEC §9). */
export type SendErrorKind = 'temporary' | 'hard_bounce' | 'auth' | 'rate_limit';

export function classifySendError(err: any): SendErrorKind {
  const code = Number(err?.responseCode ?? 0);
  const text = `${err?.response ?? ''} ${err?.message ?? ''}`.toLowerCase();
  if (err?.name === 'GoogleAuthError' || err?.code === 'EAUTH' || code === 535 || code === 534 || code === 530) return 'auth';
  if (/rate limit|too many|quota|exceeded|try again later|throttl/.test(text) && (code === 421 || code === 450 || code === 451 || code === 452 || code === 550 || code === 554)) {
    return 'rate_limit';
  }
  if (code >= 500 && code < 600) return 'hard_bounce';
  return 'temporary';
}

/** Find a special-use folder (\\Sent, \\Junk, \\All) on the server. */
export async function findSpecialFolder(client: ImapFlow, use: '\\Sent' | '\\Junk' | '\\Archive' | '\\All'): Promise<string | null> {
  const list = await client.list();
  const hit = list.find((m) => m.specialUse === use);
  if (hit) return hit.path;
  const names: Record<string, RegExp> = {
    '\\Sent': /^(sent|sent items|sent messages|\[gmail\]\/sent mail|inbox\.sent)$/i,
    '\\Junk': /^(spam|junk|junk e-mail|junk email|bulk mail|\[gmail\]\/spam|inbox\.spam|inbox\.junk)$/i,
    '\\Archive': /^(archive|archives)$/i,
    '\\All': /^\[gmail\]\/all mail$/i,
  };
  return list.find((m) => names[use].test(m.path))?.path ?? null;
}
