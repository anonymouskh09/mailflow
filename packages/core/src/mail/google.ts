import { OAuth2Client, JWT } from 'google-auth-library';
import { env } from '../env.js';
import { decrypt } from '../crypto.js';

export const GOOGLE_SCOPES = ['https://mail.google.com/', 'openid', 'email', 'profile'];

export function googleConfigured(): boolean {
  return !!env().GOOGLE_CLIENT_ID && !!env().GOOGLE_CLIENT_SECRET;
}

export function oauthClient(redirectUri?: string): OAuth2Client {
  return new OAuth2Client({
    clientId: env().GOOGLE_CLIENT_ID,
    clientSecret: env().GOOGLE_CLIENT_SECRET,
    redirectUri: redirectUri ?? `${env().APP_URL.replace(/\/$/, '')}/api/oauth/google/callback`,
  });
}

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  [k: string]: unknown;
}

export function parseServiceAccount(json: string): ServiceAccountKey {
  const key = JSON.parse(json) as ServiceAccountKey;
  if (!key.client_email || !key.private_key) throw new Error('Service account JSON must include client_email and private_key');
  return key;
}

export function dwdClient(key: ServiceAccountKey, subject: string, scopes = ['https://mail.google.com/']): JWT {
  return new JWT({ email: key.client_email, key: key.private_key, scopes, subject });
}

type TokenAccount = {
  id: string;
  email: string;
  authType: string;
  oauthRefreshTokenEnc: string | null;
  workspace?: { serviceAccountJsonEnc: string } | null;
};

const cache = new Map<string, { token: string; exp: number }>();

export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

/** Fresh access token for a Google account (OAuth refresh token or domain-wide delegation). */
export async function getGoogleAccessToken(account: TokenAccount): Promise<string> {
  const hit = cache.get(account.id);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  try {
    if (account.authType === 'google_oauth') {
      if (!account.oauthRefreshTokenEnc) throw new GoogleAuthError('No refresh token stored — reconnect the account');
      const client = oauthClient();
      client.setCredentials({ refresh_token: decrypt(account.oauthRefreshTokenEnc) });
      const res = await client.getAccessToken();
      if (!res.token) throw new GoogleAuthError('Google did not return an access token');
      const exp = client.credentials.expiry_date ?? Date.now() + 50 * 60_000;
      cache.set(account.id, { token: res.token, exp });
      return res.token;
    }
    if (account.authType === 'google_dwd') {
      if (!account.workspace) throw new GoogleAuthError('Workspace service account missing');
      const key = parseServiceAccount(decrypt(account.workspace.serviceAccountJsonEnc));
      const jwt = dwdClient(key, account.email);
      const res = await jwt.authorize();
      if (!res.access_token) throw new GoogleAuthError('Service account did not return an access token');
      cache.set(account.id, { token: res.access_token, exp: res.expiry_date ?? Date.now() + 50 * 60_000 });
      return res.access_token;
    }
  } catch (err) {
    if (err instanceof GoogleAuthError) throw err;
    const msg = (err as any)?.response?.data?.error_description || (err as Error).message;
    throw new GoogleAuthError(`Google sign-in failed: ${msg}`);
  }
  throw new GoogleAuthError('Not a Google account');
}

export function clearTokenCache(accountId: string) {
  cache.delete(accountId);
}
