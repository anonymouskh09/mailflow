/**
 * IMAP inbox sync. Polls every account's INBOX (every 2 minutes) for new mail since the last seen UID and
 * hands each message to `processInbound`. Warmup messages are handed to the warmup receiver.
 * An IDLE watcher (idle.ts) triggers the same sync immediately when the server announces new mail.
 */
import type { ImapFlow } from 'imapflow';
import type IORedis from 'ioredis';
import { prisma } from '@mailflow/db';
import { createImapClient } from '@mailflow/core';
import { processInbound } from './inbound.js';
import { handleWarmupReceived } from '../warmup/receiver.js';
import { log } from '../log.js';

const MAX_PER_RUN = 200;

async function withLock<T>(redis: IORedis, key: string, ttlSec: number, fn: () => Promise<T>): Promise<T | undefined> {
  const token = `${process.pid}-${Math.random()}`;
  const ok = await redis.set(key, token, 'EX', ttlSec, 'NX');
  if (!ok) return undefined;
  try {
    return await fn();
  } finally {
    // release only our own lock
    await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, key, token);
  }
}

export async function syncAccount(accountId: string, redis: IORedis): Promise<number | undefined> {
  return withLock(redis, `mf:imap:${accountId}`, 300, async () => {
    const account = await prisma.account.findUnique({ where: { id: accountId }, include: { workspace: true } });
    if (!account || account.status === 'paused') return 0;
    let client: ImapFlow | undefined;
    let processed = 0;
    try {
      client = await createImapClient(account);
      client.on('error', (err) => log('warn', 'imap socket error', { account: account.email, err: err.message }));
      await client.connect();
      const box = await client.mailboxOpen('INBOX');
      const validity = String(box.uidValidity);
      let lastUid = account.imapInboxValidity === validity ? (account.imapInboxUid ?? 0) : 0;

      let uids: number[];
      if (!lastUid) {
        // First sync (or UIDVALIDITY changed): only look at mail since the account was connected.
        const since = new Date(Math.min(account.createdAt.getTime(), Date.now()) - 24 * 3600_000);
        uids = ((await client.search({ since }, { uid: true })) || []) as number[];
        if (!uids.length) lastUid = Math.max(0, Number(box.uidNext) - 1);
      } else {
        uids = ((await client.search({ uid: `${lastUid + 1}:*` }, { uid: true })) || []) as number[];
        uids = uids.filter((u) => u > lastUid);
      }
      uids.sort((a, b) => a - b);
      const batch = uids.slice(0, MAX_PER_RUN);
      for (const uid of batch) {
        const msg = await client.fetchOne(String(uid), { source: true, internalDate: true, flags: true }, { uid: true });
        if (!msg || !msg.source) continue;
        try {
          const res = await processInbound(account, msg.source, { uid, folder: 'INBOX', receivedAt: msg.internalDate ? new Date(msg.internalDate) : undefined });
          if (res.kind === 'warmup' && res.warmupCode) await handleWarmupReceived(client, account, res.warmupCode, { uid, folder: 'INBOX' });
          if (res.kind !== 'ignored' && res.kind !== 'duplicate') processed++;
        } catch (err) {
          log('error', 'inbound processing failed', { account: account.email, uid, err: (err as Error).message });
        }
        lastUid = Math.max(lastUid, uid);
      }
      if (!batch.length && uids.length === 0 && !lastUid) lastUid = Math.max(0, Number(box.uidNext) - 1);

      // Warmup emails that landed in Spam / Junk are rescued here (SPEC §5).
      const { rescueWarmupFromSpam } = await import('../warmup/receiver.js');
      await rescueWarmupFromSpam(client, account);

      await prisma.account.update({
        where: { id: account.id },
        data: { imapInboxUid: lastUid, imapInboxValidity: validity, imapSyncedAt: new Date(), ...(account.imapOk === false ? { imapOk: true } : {}) },
      });
      if (account.status === 'error' && account.smtpOk !== false && account.imapOk === false) await prisma.account.update({ where: { id: account.id }, data: { status: 'active', lastError: null } });
      await client.logout();
      return processed;
    } catch (err: any) {
      try {
        client?.close();
      } catch {}
      const authFail = err?.authenticationFailed || /auth|login|credentials|invalid_grant/i.test(String(err?.responseText ?? err?.message));
      log('warn', 'imap sync failed', { account: account.email, err: err?.message, authFail });
      if (authFail) {
        await prisma.account.update({ where: { id: account.id }, data: { imapOk: false, status: 'error', lastError: `IMAP login failed: ${String(err?.responseText ?? err?.message).slice(0, 200)}`, lastCheckedAt: new Date() } });
      }
      return processed;
    }
  });
}

/** Poll every active account, a few at a time. */
export async function syncAll(redis: IORedis, concurrency = 5) {
  const accounts = await prisma.account.findMany({ where: { status: { in: ['active', 'error'] } }, select: { id: true } });
  let i = 0;
  let total = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, accounts.length) }, async () => {
      while (i < accounts.length) {
        const a = accounts[i++];
        total += (await syncAccount(a.id, redis)) ?? 0;
      }
    }),
  );
  return total;
}
