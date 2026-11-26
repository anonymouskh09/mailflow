import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { prisma } from '@mailflow/db';
import { authRoutes, requireAuth } from './auth.js';
import { HttpError } from './util.js';
import { accountRoutes } from './routes/accounts.js';
import { googleRoutes } from './routes/google.js';
import { settingsRoutes } from './routes/settings.js';

const PUBLIC = [/^\/api\/auth\/(login|logout|me)$/, /^\/api\/health$/];

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.cookie', 'req.headers.authorization'] },
    bodyLimit: 60 * 1024 * 1024, // lead CSVs up to 100k rows
    trustProxy: true,
  });
  await app.register(cookie);

  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), issues: err.issues });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    const status = (err as FastifyError).statusCode ?? 500;
    if (status >= 500) req.log.error({ err: { message: err.message, stack: err.stack } }, 'request failed');
    return reply.code(status).send({ error: status >= 500 ? 'Something went wrong' : err.message });
  });

  // Every /api route requires the admin session unless whitelisted.
  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api/')) return;
    if (PUBLIC.some((re) => re.test(url))) return;
    return requireAuth(req, reply);
  });

  app.get('/api/health', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  });

  await app.register(authRoutes);
  await app.register(accountRoutes);
  await app.register(googleRoutes);
  await app.register(settingsRoutes);

  // Production: serve the built dashboard with SPA fallback.
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Not found' });
    });
  }
  return app;
}
