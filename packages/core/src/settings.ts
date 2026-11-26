import { prisma, type Settings } from '@mailflow/db';
import { env } from './env.js';

export async function getSettings(): Promise<Settings> {
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  if (s) return s;
  return prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, adminEmail: env().ADMIN_EMAIL, passwordHash: '', defaultTimezone: 'UTC' },
  });
}

/** Step delay unit. Env DELAY_UNIT=minutes or the Settings toggle turns days into minutes (testing). */
export function delayMinutes(delayDays: number, settings: Pick<Settings, 'delayUnit'>): number {
  const unit = env().DELAY_UNIT === 'minutes' || settings.delayUnit === 'minutes' ? 'minutes' : 'days';
  return unit === 'minutes' ? delayDays : delayDays * 24 * 60;
}

export function trackingBase(settings: Pick<Settings, 'trackingDomain'>): string {
  const d = settings.trackingDomain.trim();
  if (d) return (/^https?:\/\//.test(d) ? d : `https://${d}`).replace(/\/$/, '');
  return env().TRACKING_URL.replace(/\/$/, '');
}
