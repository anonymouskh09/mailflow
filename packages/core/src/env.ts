import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

let envFileUsed: string | null = null;
const envSearched: string[] = [];

/** Read a .env file written by any editor: UTF-8 (with or without BOM) or UTF-16 (PowerShell's default for `>`). */
function readEnvText(file: string): string {
  const buf = readFileSync(file);
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  return buf.toString('utf8').replace(/^\uFEFF/, '');
}

/** Load the nearest .env (walking up from the working directory). Existing variables win. */
function loadDotEnv() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const file = path.join(dir, '.env');
    envSearched.push(file);
    if (existsSync(file)) {
      envFileUsed = file;
      for (const line of readEnvText(file).split(/\r?\n/)) {
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
      let hint: string;
      if (envFileUsed) hint = `Read settings from ${envFileUsed}. Fill in the values above there (see .env.example) and restart.`;
      else {
        const txt = envSearched.map((f) => `${f}.txt`).find((f) => existsSync(f));
        hint = txt
          ? `Found ${txt}: rename it to ".env" (Windows hid the .txt ending), then restart.`
          : `No .env file found (looked in: ${envSearched.join(', ')}). Copy .env.example to .env in the project folder and fill it in.`;
      }
      throw new Error(`Invalid environment:\n${msg}\n\n${hint}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function resetEnvCache() {
  cached = undefined;
}

export const isProd = () => env().NODE_ENV === 'production';
