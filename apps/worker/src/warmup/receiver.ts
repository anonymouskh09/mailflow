/**
 * Receiving side of warmup (SPEC §5): find warmup emails in Inbox and Spam, rescue from spam,
 * mark read + starred, schedule an in-thread reply at the configured reply rate, and move the
 * message to a hidden MF-Warmup folder.
 */
import type { ImapFlow } from 'imapflow';
import { prisma } from '@mailflow/db';
import { findSpecialFolder, findWarmupCode, randomToken, randomInt, addMinutes, WARMUP_HEADER } from '@mailflow/core';
import { log } from '../log.js';

export const WARMUP_FOLDER = 'MF-Warmup';

async function ensureFolder(client: ImapFlow): Promise<string> {
  const list = await client.list();
  const hit = list.find((m) => m.path === WARMUP_FOLDER || m.path.endsWith(`/${WARMUP_FOLDER}`) || m.path.endsWith(`.${WARMUP_FOLDER}`));
  if (hit) return hit.path;
  try {
    await client.mailboxCreate(WARMUP_FOLDER);
  } catch {}
  return WARMUP_FOLDER;
}

/** Decide whether to reply and create the reply row. Exported for tests. */
export async function recordWarmupReceipt(account: { id: string }, code: string, landed: 'inbox' | 'spam', now = new Date(), rnd: () => number = Math.random) {
  const w = await prisma.warmupMessage.findUnique({ where: { code }, include: { toAccount: { include: { warmup: true } } } });
  if (!w || w.toAccountId !== account.id) return { known: false as const };
  if (w.processedAt) {
    if (landed === 'spam' && w.landed !== 'spam') await prisma.warmupMessage.update({ where: { id: w.id }, data: { landed: 'spam' } });
    return { known: true as const, first: false, warmup: w };
  }
  const rate = w.toAccount.warmup?.replyRate ?? 30;
  const reply = !w.parentId && rnd() * 100 < rate;
  await prisma.warmupMessage.update({
    where: { id: w.id },
    data: { processedAt: now, landed, ...(landed === 'spam' ? { rescuedAt: now } : {}), ...(reply ? { replyDueAt: addMinutes(now, randomInt(10, 120, rnd)) } : {}) },
  });
  if (reply) {
    await prisma.warmupMessage.create({
      data: { fromAccountId: account.id, toAccountId: w.fromAccountId, parentId: w.id, code: `mfw-${randomToken(9).replace(/[^A-Za-z0-9]/g, 'x').toLowerCase()}`, subject: '', scheduledAt: addMinutes(now, randomInt(10, 120, rnd)) },
    });
  }
  return { known: true as const, first: true, warmup: w, replied: reply };
}

/** Called by the inbox sync for a warmup message found in INBOX. */
export async function handleWarmupReceived(client: ImapFlow, account: { id: string; email: string }, code: string, at: { uid: number; folder: string }) {
  try {
    const r = await recordWarmupReceipt(account, code, 'inbox');
    if (!r.known) return;
    await client.messageFlagsAdd(String(at.uid), ['\\Seen', '\\Flagged'], { uid: true });
    const folder = await ensureFolder(client);
    await client.messageMove(String(at.uid), folder, { uid: true });
  } catch (err) {
    log('warn', 'warmup receive failed', { account: account.email, err: (err as Error).message });
  }
}

/** Look in Spam / Junk for warmup emails, record the spam hit and move them back to the Inbox ("not spam"). */
export async function rescueWarmupFromSpam(client: ImapFlow, account: { id: string; email: string }) {
  const junk = await findSpecialFolder(client, '\\Junk').catch(() => null);
  if (!junk) return 0;
  let rescued = 0;
  const lock = await client.getMailboxLock(junk);
  try {
    const since = new Date(Date.now() - 3 * 86_400_000);
    const uids = ((await client.search({ since, header: { [WARMUP_HEADER]: '' } }, { uid: true })) || []) as number[];
    for (const uid of uids.slice(0, 100)) {
      const msg = await client.fetchOne(String(uid), { headers: [WARMUP_HEADER], source: false, bodyParts: ['TEXT'] }, { uid: true });
      if (!msg) continue;
      const headerText = msg.headers?.toString() ?? '';
      const code = /mfw-[a-z0-9]+/i.exec(headerText)?.[0] ?? findWarmupCode(new Map(), msg.bodyParts?.get('TEXT')?.toString() ?? '');
      if (!code) continue;
      const r = await recordWarmupReceipt(account, code, 'spam');
      if (!r.known) continue;
      await client.messageFlagsAdd(String(uid), ['\\Seen', '\\Flagged'], { uid: true });
      await client.messageMove(String(uid), 'INBOX', { uid: true }); // inbox sync then files it in MF-Warmup
      rescued++;
    }
  } finally {
    lock.release();
  }
  if (rescued) log('info', 'warmup rescued from spam', { account: account.email, rescued });
  return rescued;
}
