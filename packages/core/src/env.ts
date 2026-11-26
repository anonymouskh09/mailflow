import { z } from 'zod';

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
