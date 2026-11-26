export const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('en-US'));
export const pctStr = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? '—' : `${Number(n.toFixed(digits))}%`);

export function scoreColor(score: number | null | undefined) {
  if (score === null || score === undefined) return '#71717A';
  return score >= 90 ? '#15803D' : score >= 80 ? '#B45309' : '#B91C1C';
}

export function timeAgo(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = new Date(date);
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 0) {
    const m = Math.round(-s / 60);
    if (m < 60) return `in ${m} min`;
    const h = Math.round(m / 60);
    if (h < 48) return `in ${h}h`;
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function shortTime(date: string | Date): string {
  const d = new Date(date);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  if (now.getTime() - d.getTime() < 6 * 86400000) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function fullTime(date: string | Date): string {
  const d = new Date(date);
  return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function daysLabel(days: number[]): string {
  const s = [...days].sort();
  const key = s.join(',');
  if (key === '1,2,3,4,5') return 'Mon–Fri';
  if (key === '0,1,2,3,4,5,6') return 'Every day';
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => s.includes(d)).map((d) => DAYS[d]).join(', ');
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
