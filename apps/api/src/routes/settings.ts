import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { promises as dns } from 'node:dns';
import bcrypt from 'bcryptjs';
import { prisma } from '@mailflow/db';
import { getSettings, isValidTimezone, emailDomain, env } from '@mailflow/core';
import { badRequest } from '../util.js';
import { clearHashCache } from '../auth.js';

async function txt(name: string): Promise<string[]> {
  try {
    return (await dns.resolveTxt(name)).map((r) => r.join(''));
  } catch {
    return [];
  }
}

const DKIM_SELECTORS = ['google', 'selector1', 'selector2', 'default', 'dkim', 'k1', 'k2', 's1', 's2', 'mail', 'zoho', 'zmail', 'mx', 'smtp'];

export async function checkDomain(domain: string) {
  const [spfRecs, dmarcRecs] = await Promise.all([txt(domain), txt(`_dmarc.${domain}`)]);
  const spf = spfRecs.find((r) => r.toLowerCase().startsWith('v=spf1')) ?? null;
  const dmarc = dmarcRecs.find((r) => r.toLowerCase().startsWith('v=dmarc1')) ?? null;
  let dkim: { selector: string; record: string } | null = null;
  for (const sel of DKIM_SELECTORS) {
    const recs = await txt(`${sel}._domainkey.${domain}`);
    const hit = recs.find((r) => /v=dkim1|k=rsa|p=/i.test(r));
    if (hit) {
      dkim = { selector: sel, record: hit.slice(0, 80) };
      break;
    }
  }
  return { domain, spf: { ok: !!spf, record: spf }, dkim: { ok: !!dkim, selector: dkim?.selector ?? null }, dmarc: { ok: !!dmarc, record: dmarc } };
}

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', async () => {
    const s = await getSettings();
    return {
      adminEmail: s.adminEmail,
      trackingDomain: s.trackingDomain,
      defaultTimezone: s.defaultTimezone,
      delayUnit: env().DELAY_UNIT === 'minutes' ? 'minutes' : s.delayUnit,
      delayUnitLockedByEnv: env().DELAY_UNIT === 'minutes',
      notifyEmail: s.notifyEmail,
      trackingUrl: env().TRACKING_URL,
    };
  });

  app.patch('/api/settings', async (req) => {
    const b = z
      .object({
        trackingDomain: z.string().trim().max(255).optional(),
        defaultTimezone: z.string().trim().max(64).optional(),
        delayUnit: z.enum(['days', 'minutes']).optional(),
        notifyEmail: z.union([z.literal(''), z.string().trim().email()]).optional(),
        currentPassword: z.string().optional(),
        newPassword: z.string().min(10, 'Use at least 10 characters').max(200).optional(),
      })
      .parse(req.body);
    if (b.defaultTimezone && !isValidTimezone(b.defaultTimezone)) throw badRequest('Unknown timezone');
    const s = await getSettings();
    const data: Record<string, unknown> = {};
    if (b.trackingDomain !== undefined) data.trackingDomain = b.trackingDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (b.defaultTimezone) data.defaultTimezone = b.defaultTimezone;
    if (b.delayUnit) data.delayUnit = b.delayUnit;
    if (b.notifyEmail !== undefined) data.notifyEmail = b.notifyEmail;
    if (b.newPassword) {
      if (!b.currentPassword || !(await bcrypt.compare(b.currentPassword, s.passwordHash))) throw badRequest('Current password is wrong');
      data.passwordHash = await bcrypt.hash(b.newPassword, 12);
    }
    await prisma.settings.update({ where: { id: 1 }, data });
    clearHashCache();
    return { ok: true, passwordChanged: !!b.newPassword };
  });

  app.get('/api/deliverability', async (req) => {
    const q = z.object({ domain: z.string().optional() }).parse(req.query);
    const domains = q.domain ? [q.domain.toLowerCase()] : [...new Set((await prisma.account.findMany({ select: { email: true } })).map((a) => emailDomain(a.email)))].filter(Boolean);
    const results = [];
    for (const d of domains.slice(0, 50)) results.push(await checkDomain(d));
    return { domains: results };
  });
}
