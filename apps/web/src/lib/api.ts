export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data: any,
  ) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
    signal: opts.signal,
  });
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    window.dispatchEvent(new Event('mf:unauthorized'));
  }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || res.statusText, data);
  return data as T;
}

export const get = <T = any>(path: string) => api<T>(path);
export const post = <T = any>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body });
export const patch = <T = any>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T = any>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
