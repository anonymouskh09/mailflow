// Minimal structured logger. Never pass secrets in `extra`.
type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min = order[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? 20;

export function log(level: Level, msg: string, extra: Record<string, unknown> = {}) {
  if (order[level] < min || process.env.VITEST) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}
