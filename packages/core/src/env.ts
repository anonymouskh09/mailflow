import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Load the nearest .env (walking up from the working directory). Existing variables win. */
function loadDotEnv() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const file = path.join(dir, '.env');
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
        if (!m || line.trim().startsWith('#')) continue;
        let v = m[2];
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (process.env[m[1]] === undefined) process.env[m[1]] = v;
      }
      return;
    }
    const up = path.dirname(dir);
    if (up === dir) return;
    dir = up;
  }
}
if (!process.env.VITEST) loadDotEnv();

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32)'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),
  APP_URL: z.string().default('http://localhost:5173'),
  TRACKING_URL: z.string().default('http://localhost:3000'),
  ADMIN_EMAIL: z.string().default('admin@example.com'),
  ADMIN_PASSWORD: z.string().default(''),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  DELAY_UNIT: z.enum(['days', 'minutes']).default('days'),
  DEV_SMTP_OVERRIDE: z.string().default(''),
  DEV_IGNORE_SCHEDULE: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
      throw new Error(`Invalid environment:\n${msg}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function resetEnvCache() {
  cached = undefined;
}

export const isProd = () => env().NODE_ENV === 'production';
