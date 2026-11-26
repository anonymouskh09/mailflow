/**
 * IMAP IDLE watcher: keeps one connection per account open on INBOX and triggers an immediate sync when the
 * server announces new mail. Servers without IDLE (or errors) simply fall back to the 2-minute polling.
 * Only one worker process runs the watcher (Redis leader lock).
 */
import type { ImapFlow } from 'imapflow';
import type IORedis from 'ioredis';
import { prisma } from '@mailflow/db';
import { createImapClient } from '@mailflow/core';
import { syncAccount } from './sync.js';
import { log } from '../log.js';

const LEADER_KEY = 'mf:idle-leader';

export class IdleManager {
  private clients = new Map<string, ImapFlow>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private stopped = false;
  private leader = false;
  private me = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  private loop?: ReturnType<typeof setInterval>;

  constructor(private redis: IORedis) {}

  start() {
    this.loop = setInterval(() => void this.refresh(), 60_000);
    void this.refresh();
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.loop);
    for (const t of this.timers.values()) clearTimeout(t);
    await Promise.all([...this.clients.values()].map((c) => c.logout().catch(() => c.close())));
    this.clients.clear();
    if (this.leader) await this.redis.del(LEADER_KEY);
  }

  private async refresh() {
    if (this.stopped) return;
    // leader election (lease renewed every minute)
    const held = await this.redis.get(LEADER_KEY);
    if (held === this.me) await this.redis.expire(LEADER_KEY, 180);
    else if (!held) this.leader = (await this.redis.set(LEADER_KEY, this.me, 'EX', 180, 'NX')) === 'OK';
    else this.leader = false;
    if (held === this.me) this.leader = true;
    if (!this.leader) return;

    const accounts = await prisma.account.findMany({ where: { status: 'active', imapOk: { not: false } }, select: { id: true } });
    const want = new Set(accounts.map((a) => a.id));
    for (const [id, c] of this.clients) if (!want.has(id)) {
      this.clients.delete(id);
      c.logout().catch(() => c.close());
    }
    for (const id of want) if (!this.clients.has(id)) void this.watch(id);
  }

  private trigger(id: string) {
    clearTimeout(this.timers.get(id));
    this.timers.set(
      id,
      setTimeout(() => {
        syncAccount(id, this.redis).catch((err) => log('warn', 'idle-triggered sync failed', { err: err.message }));
      }, 3000),
    );
  }

  private async watch(id: string) {
    const account = await prisma.account.findUnique({ where: { id }, include: { workspace: true } });
    if (!account) return;
    let client: ImapFlow;
    try {
      client = await createImapClient(account);
    } catch {
      return;
    }
    this.clients.set(id, client);
    client.on('error', () => {});
    client.on('exists', () => this.trigger(id));
    client.on('close', () => {
      if (this.clients.get(id) === client) this.clients.delete(id); // refresh() reconnects within a minute
    });
    try {
      await client.connect();
      if (!client.capabilities.has('IDLE')) {
        this.clients.delete(id);
        await client.logout();
        return;
      }
      await client.mailboxOpen('INBOX');
      // ImapFlow idles automatically while the connection is unused.
    } catch (err) {
      this.clients.delete(id);
      try {
        client.close();
      } catch {}
      log('debug', 'idle connect failed', { account: account.email, err: (err as Error).message });
    }
  }
}
