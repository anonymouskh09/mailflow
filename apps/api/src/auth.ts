import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@mailflow/db';
import { env, isProd, getSettings } from '@mailflow/core';

export const COOKIE = 'mf_session';
const MAX_AGE = 60 * 60 * 24 * 14; // 14 days

export function sign(value: string): string {
  return createHmac('sha256', env().SESSION_SECRET).update(value).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

/** Signed, stateless session token. `pv` ties it to the current password hash, so changing the password logs out everywhere. */
export function makeSession(passwordHash: string): string {
  const payload = Buffer.from(JSON.stringify({ sub: 'admin', exp: Date.now() + MAX_AGE * 1000, pv: sign(passwordHash).slice(0, 12) })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifySession(token: string | undefined, passwordHash: string): boolean {
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp: number; pv: string };
    return data.exp > Date.now() && data.pv === sign(passwordHash).slice(0, 12);
  } catch {
    return false;
  }
}

/** Sync admin credentials from env on start (bcrypt hash stored in settings). */
export async function bootstrapAdmin() {
  const s = await getSettings();
  const e = env();
  const data: { adminEmail?: string; passwordHash?: string } = {};
  if (e.ADMIN_EMAIL && e.ADMIN_EMAIL.toLowerCase() !== s.adminEmail.toLowerCase()) data.adminEmail = e.ADMIN_EMAIL.toLowerCase();
  if (e.ADMIN_PASSWORD && (!s.passwordHash || !(await bcrypt.compare(e.ADMIN_PASSWORD, s.passwordHash)))) {
    data.passwordHash = await bcrypt.hash(e.ADMIN_PASSWORD, 12);
  }
  if (Object.keys(data).length) await prisma.settings.update({ where: { id: 1 }, data });
}

// Small in-memory login rate limiter: 10 attempts / 15 min per IP.
const attempts = new Map<string, { n: number; reset: number }>();
export function rateLimited(ip: string): boolean {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.reset < now) {
    attempts.set(ip, { n: 1, reset: now + 15 * 60_000 });
    return false;
  }
  a.n++;
  return a.n > 10;
}
export function resetRateLimit(ip: string) {
  attempts.delete(ip);
}

let hashCache: { hash: string; at: number } | null = null;
export async function currentHash(): Promise<string> {
  if (hashCache && Date.now() - hashCache.at < 5000) return hashCache.hash;
  const s = await getSettings();
  hashCache = { hash: s.passwordHash, at: Date.now() };
  return s.passwordHash;
}
export function clearHashCache() {
  hashCache = null;
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const ok = verifySession(req.cookies[COOKIE], await currentHash());
  if (!ok) return reply.code(401).send({ error: 'Not signed in' });
}

function setCookie(reply: FastifyReply, value: string, maxAge: number) {
  reply.setCookie(COOKIE, value, { path: '/', httpOnly: true, secure: isProd(), sameSite: 'lax', maxAge });
}

const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (req, reply) => {
    if (rateLimited(req.ip)) return reply.code(429).send({ error: 'Too many attempts. Try again in 15 minutes.' });
    const body = loginSchema.parse(req.body);
    const s = await getSettings();
    const ok = body.email === s.adminEmail.toLowerCase() && !!s.passwordHash && (await bcrypt.compare(body.password, s.passwordHash));
    if (!ok) return reply.code(401).send({ error: 'Wrong email or password' });
    resetRateLimit(req.ip);
    setCookie(reply, makeSession(s.passwordHash), MAX_AGE);
    return { email: s.adminEmail };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    setCookie(reply, '', 0);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const s = await getSettings();
    if (!verifySession(req.cookies[COOKIE], s.passwordHash)) return reply.code(401).send({ error: 'Not signed in' });
    return { email: s.adminEmail };
  });
}
