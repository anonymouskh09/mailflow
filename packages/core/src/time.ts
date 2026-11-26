// Timezone-aware helpers built on Intl (no extra dependency).

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function isValidTimezone(tz: string): boolean {
  try {
    dtf(tz);
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(date: Date, tz: string): ZonedParts {
  const parts = dtf(tz).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WD[get('weekday')] ?? 0,
  };
}

/** Offset (ms) of tz at the given instant: local wall time minus UTC. */
function tzOffset(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Convert a wall-clock time in tz to a UTC instant. */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let ts = guess - tzOffset(new Date(guess), tz);
  // second pass handles DST transitions
  ts = guess - tzOffset(new Date(ts), tz);
  return new Date(ts);
}

/** YYYY-MM-DD of the instant in tz. */
export function dayKey(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** UTC instants for the start and end of the local day containing `date`. */
export function dayBounds(date: Date, tz: string): { start: Date; end: Date } {
  const p = zonedParts(date, tz);
  const start = zonedToUtc(p.year, p.month, p.day, 0, 0, tz);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  const end = zonedToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, tz);
  return { start, end };
}

export function parseHm(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export interface Schedule {
  timezone: string;
  days: number[]; // 0 = Sunday
  windowStart: string; // HH:MM
  windowEnd: string; // HH:MM
}

export function isWithinSchedule(date: Date, s: Schedule): boolean {
  const p = zonedParts(date, s.timezone);
  if (!s.days.includes(p.weekday)) return false;
  const mins = p.hour * 60 + p.minute;
  return mins >= parseHm(s.windowStart) && mins < parseHm(s.windowEnd);
}

/**
 * Return `date` if it is inside the schedule, otherwise the start of the next open window.
 * Returns null if the schedule has no open window at all.
 */
export function nextOpenTime(date: Date, s: Schedule): Date | null {
  if (!s.days.length || parseHm(s.windowEnd) <= parseHm(s.windowStart)) return null;
  if (isWithinSchedule(date, s)) return date;
  const startMin = parseHm(s.windowStart);
  const p = zonedParts(date, s.timezone);
  for (let i = 0; i < 8; i++) {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + i));
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth() + 1;
    const da = d.getUTCDate();
    const candidate = zonedToUtc(y, mo, da, Math.floor(startMin / 60), startMin % 60, s.timezone);
    if (candidate.getTime() <= date.getTime()) continue;
    if (s.days.includes(zonedParts(candidate, s.timezone).weekday)) return candidate;
  }
  return null;
}

export function addMinutes(d: Date, m: number): Date {
  return new Date(d.getTime() + m * 60_000);
}

export function randomInt(min: number, max: number, rnd: () => number = Math.random): number {
  if (max <= min) return min;
  return Math.floor(min + rnd() * (max - min + 1));
}
