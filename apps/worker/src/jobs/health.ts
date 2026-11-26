import { prisma } from '@mailflow/db';
import { checkAccount } from '@mailflow/core';
import { log } from '../log.js';

/**
 * Re-test connections: accounts in Error every run (30 min) so they recover automatically,
 * healthy accounts every 6 hours so revoked tokens / changed passwords are noticed.
 */
export async function runHealthChecks(now = new Date()) {
  const sixHoursAgo = new Date(now.getTime() - 6 * 3600_000);
  const accounts = await prisma.account.findMany({
    where: { OR: [{ status: 'error' }, { status: 'active', OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: sixHoursAgo } }] }] },
    select: { id: true, email: true, status: true },
  });
  for (const a of accounts) {
    try {
      const res = await checkAccount(a.id);
      if (res.test.ok !== (a.status !== 'error')) log('info', 'account health changed', { email: a.email, ok: res.test.ok });
    } catch (err) {
      log('warn', 'health check failed', { email: a.email, err: (err as Error).message });
    }
  }
  return accounts.length;
}
