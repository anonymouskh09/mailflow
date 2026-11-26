import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from './env.js';

// AES-256-GCM. Output format: v1:<iv b64>:<tag b64>:<ciphertext b64>
const ALGO = 'aes-256-gcm';

function key(): Buffer {
  return Buffer.from(env().ENCRYPTION_KEY, 'hex');
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function decrypt(payload: string): string {
  const [v, ivB64, tagB64, ctB64] = payload.split(':');
  if (v !== 'v1' || !ivB64 || !tagB64 || ctB64 === undefined) throw new Error('Unsupported ciphertext format');
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

export function randomToken(bytes = 16): string {
  return randomBytes(bytes).toString('base64url');
}
