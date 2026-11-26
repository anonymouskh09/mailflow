import { z } from 'zod';
import { prisma, type Account, type WarmupSettings } from '@mailflow/db';
import { encrypt } from './crypto.js';
import { PRESETS } from './presets.js';
import { testConnection, type MailAccount } from './mail/transport.js';

export const accountInputSchema = z.object({
  provider: z.enum(['google', 'outlook', 'custom']),
  email: z.string().trim().toLowerCase().email(),
  fromName: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(500),
  username: z.string().trim().max(320).optional(),
  smtpHost: z.string().trim().max(255).optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  imapHost: z.string().trim().max(255).optional(),
  imapPort: z.coerce.number().int().min(1).max(65535).optional(),
  imapSecure: z.boolean().optional(),
  dailyLimit: z.coerce.number().int().min(1).max(2000).optional(),
  warmup: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export type AccountInput = z.infer<typeof accountInputSchema>;

/** Resolve presets into a full server config. */
export function resolveServers(input: AccountInput) {
  const preset = input.provider === 'custom' ? null : PRESETS[input.provider];
  const smtpPort = input.smtpPort ?? preset?.smtpPort ?? 587;
  const cfg = {
    smtpHost: input.smtpHost || preset?.smtpHost || '',
    smtpPort,
    smtpSecure: input.smtpSecure ?? (preset ? preset.smtpSecure : smtpPort === 465),
    imapHost: input.imapHost || preset?.imapHost || '',
    imapPort: input.imapPort ?? preset?.imapPort ?? 993,
    imapSecure: input.imapSecure ?? (preset ? preset.imapSecure : (input.imapPort ?? 993) === 993),
    username: input.username || input.email,
  };
  if (!cfg.smtpHost || !cfg.imapHost) throw new Error('SMTP and IMAP hosts are required for custom providers');
  return cfg;
}

export function draftMailAccount(input: AccountInput): MailAccount {
  const s = resolveServers(input);
  return { id: 'draft', email: input.email, fromName: input.fromName, ...s, authType: 'password', passwordEnc: null, oauthRefreshTokenEnc: null };
}

export async function testAccountInput(input: AccountInput) {
  return testConnection(draftMailAccount(input), { password: input.password });
}

/** Test then save an SMTP/IMAP account. Returns per-protocol results; saves only when both pass. */
export async function createPasswordAccount(input: AccountInput, opts: { skipTest?: boolean } = {}) {
  const s = resolveServers(input);
  const test = opts.skipTest ? { smtp: { ok: true }, imap: { ok: true }, ok: true } : await testAccountInput(input);
  if (!test.ok) return { test, account: null };
  const data = {
    fromName: input.fromName,
    provider: input.provider,
    ...s,
    authType: 'password' as const,
    passwordEnc: encrypt(input.password),
    status: 'active' as const,
    smtpOk: true,
    imapOk: true,
    lastError: null,
    lastCheckedAt: new Date(),
  };
  const account = await prisma.account.upsert({
    where: { email: input.email },
    update: data,
    create: {
      email: input.email,
      ...data,
      dailyLimit: input.dailyLimit ?? 30,
      tags: input.tags ?? [],
      warmup: { create: { enabled: input.warmup ?? true, startedOn: input.warmup === false ? null : new Date() } },
    },
  });
  return { test, account };
}

type AccountWithWarmup = Account & { warmup?: WarmupSettings | null };

/** Safe representation for the API: never includes secrets. */
export function publicAccount(a: AccountWithWarmup) {
  return {
    id: a.id,
    email: a.email,
    fromName: a.fromName,
    provider: a.provider,
    authType: a.authType,
    smtpHost: a.smtpHost,
    smtpPort: a.smtpPort,
    smtpSecure: a.smtpSecure,
    imapHost: a.imapHost,
    imapPort: a.imapPort,
    imapSecure: a.imapSecure,
    username: a.username,
    dailyLimit: a.dailyLimit,
    gapMinMinutes: a.gapMinMinutes,
    signatureHtml: a.signatureHtml,
    status: a.status,
    smtpOk: a.smtpOk,
    imapOk: a.imapOk,
    lastError: a.lastError,
    lastCheckedAt: a.lastCheckedAt,
    pausedUntil: a.pausedUntil,
    tags: a.tags,
    workspaceId: a.workspaceId,
    createdAt: a.createdAt,
    warmup: a.warmup
      ? {
          enabled: a.warmup.enabled,
          startVolume: a.warmup.startVolume,
          increasePerDay: a.warmup.increasePerDay,
          maxVolume: a.warmup.maxVolume,
          replyRate: a.warmup.replyRate,
          workingDays: a.warmup.workingDays,
          weekendFactor: a.warmup.weekendFactor,
          keepDuringCampaigns: a.warmup.keepDuringCampaigns,
          startedOn: a.warmup.startedOn,
        }
      : null,
  };
}

/** Re-test a saved account and update its health. */
export async function checkAccount(id: string) {
  const account = await prisma.account.findUniqueOrThrow({ where: { id }, include: { workspace: true } });
  const res = await testConnection(account);
  const errorText = [res.smtp.error, res.imap.error].filter(Boolean).join(' · ') || null;
  const updated = await prisma.account.update({
    where: { id },
    data: {
      smtpOk: res.smtp.ok,
      imapOk: res.imap.ok,
      lastError: errorText,
      lastCheckedAt: new Date(),
      status: account.status === 'paused' ? 'paused' : res.ok ? 'active' : 'error',
    },
    include: { warmup: true },
  });
  return { test: res, account: updated };
}
