import { session } from './auth';
import type { Env } from './provider';
import { handleApi, isPublicRoute, json } from './http';
import { coordinate } from './coordination';
export { CognitionCoordinator } from './coordinator';
// Thin gateway: on Workers Free each invocation has 10 ms CPU. The Worker only serves
// assets, login/session checks and forwards authenticated API calls to the single
// Durable Object executor, where validation, D1 work and cognition run.
const publicCache = new Map<string, { body: string; status: number; expires: number }>();
const local = new Set(['/api/session', '/api/login', '/api/logout']);
async function route(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
  if (local.has(path) || !env.COGNITION) return handleApi(request, env);
  const stub = env.COGNITION.get(env.COGNITION.idFromName(env.ENVIRONMENT_ID ?? 'development'));
  if (await session(env, request)) return stub.fetch(request);
  // Without a session only public observatory routes pass; everything else stops here and
  // never consumes Durable Object or D1 quota.
  if (!isPublicRoute(env, request.method, path)) return json({ error: 'autenticacao_necessaria' }, 401);
  if (request.method !== 'GET') return stub.fetch(request);
  // Public reads are identical for every visitor: a short per-isolate cache spares the DO
  // and D1 (the Cache API is not available on workers.dev).
  // Only known parameters form the key, so arbitrary query strings cannot bypass the cache.
  const original = new URL(request.url), key = new URL(original.origin + original.pathname);
  for (const name of ['kind', 'after', 'latest', 'q']) { const value = original.searchParams.get(name); if (value !== null) key.searchParams.set(name, value); }
  const hit = publicCache.get(key.href);
  if (hit && hit.expires > Date.now()) return new Response(hit.body, { status: hit.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-bunborn-cache': 'hit' } });
  const response = await stub.fetch(request);
  const body = await response.text();
  if (response.ok) {
    if (publicCache.size > 200) publicCache.clear();
    publicCache.set(key.href, { body, status: response.status, expires: Date.now() + 30000 });
  }
  return new Response(body, { status: response.status, headers: response.headers });
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let response: Response;
    try {
      response = await route(request, env);
    } catch {
      response = json({ error: 'falha_gateway' }, 503);
    }
    const headers = new Headers(response.headers);
    headers.set('x-content-type-options', 'nosniff');
    headers.set('referrer-policy', 'no-referrer');
    headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    headers.set(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    return new Response(response.body, { status: response.status, headers });
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(coordinate(env, { kind: 'scheduled', data: { at: controller.scheduledTime } }).then(() => undefined));
  },
};
