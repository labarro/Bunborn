import type { Env } from './provider';
const enc = new TextEncoder();
async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value)));
}
export async function equalSecret(a: string, b: string) {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
async function signature(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(value)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export function configured(env: Env) {
  return (
    !!env.OBSERVER_SECRET &&
    env.OBSERVER_SECRET.length >= 32 &&
    !!env.SESSION_SECRET &&
    env.SESSION_SECRET.length >= 32
  );
}
export async function session(env: Env, request: Request) {
  if (!configured(env)) return false;
  const token = request.headers.get('cookie')?.match(/(?:^|;\s*)observador=([^;]+)/)?.[1];
  if (!token) return false;
  const [expires, mac] = token.split('.');
  if (!expires || !mac || Number(expires) < Date.now() || Number(expires) > Date.now() + 86400001)
    return false;
  return equalSecret(mac, await signature(expires, env.SESSION_SECRET!));
}
export async function sessionCookie(env: Env) {
  const expires = String(Date.now() + 86400000);
  return `observador=${expires}.${await signature(expires, env.SESSION_SECRET!)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${env.ENVIRONMENT === 'development' ? '' : '; Secure'}`;
}
export async function rateLimit(env: Env, key: string, max: number, windowMs: number) {
  const window = Math.floor(Date.now() / windowMs);
  const result = await env.DB.prepare(
    'INSERT INTO rate_limits(key,window,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window RETURNING count',
  )
    .bind(key, window)
    .first<{ count: number }>();
  return (result?.count ?? max + 1) <= max;
}
export function sameOrigin(request: Request, env: Env) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const own = new URL(request.url);
  if (origin === own.origin) return true;
  if (env.ENVIRONMENT === 'development') {
    try {
      const other = new URL(origin);
      return (
        ['localhost', '127.0.0.1'].includes(other.hostname) &&
        ['localhost', '127.0.0.1'].includes(own.hostname)
      );
    } catch {
      return false;
    }
  }
  return false;
}
