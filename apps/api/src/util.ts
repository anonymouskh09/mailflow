import type { FastifyReply } from 'fastify';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, what);
export const badRequest = (msg: string) => new HttpError(400, msg);

export function sendCsv(reply: FastifyReply, filename: string, body: string) {
  return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${filename}"`).send(body);
}

/** Run async tasks with a concurrency limit. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}
