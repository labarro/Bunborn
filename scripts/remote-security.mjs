// Remote security/isolation checks against the deployed Workers. Read-only or rejected
// operations only: it NEVER calls birth confirmation and never writes to production state.
import { remoteClient, baseFor } from './remote-client.mjs';
import { encryptedGeneratedSecrets } from './private-secrets.mjs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
const results = [];
const check = (env, name, ok, detail) => { results.push({ env, name, ok: !!ok, detail }); };
const raw = async (env, path, init = {}) => {
  const r = await fetch(baseFor(env) + path, { ...init, signal: AbortSignal.timeout(60000) });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body, headers: r.headers };
};
const secrets = await encryptedGeneratedSecrets();
for (const env of ['production', 'homologation']) {
  const base = baseFor(env);
  if (env === 'production') {
    const pub = await raw(env, '/api/state');
    check(env, 'public observatory: anonymous read allowed', pub.status === 200 && pub.body?.state === null, pub.status);
    check(env, 'public session flag exposed', (await raw(env, '/api/session')).body?.publicObservation === true);
    for (const path of ['/api/settings', '/api/backup/begin', '/api/birth/prepare', '/api/birth/confirm', '/api/tick', '/api/resource', '/api/experiment', '/api/restore'])
      check(env, 'anonymous POST ' + path + ' is 401', (await raw(env, path, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: '{}' })).status === 401);
    check(env, 'anonymous export is 401', (await raw(env, '/api/export')).status === 401);
    const msg = await raw(env, '/api/message', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ content: 'teste', id: crypto.randomUUID() }) });
    check(env, 'anonymous message refused while unborn (no creature)', msg.status === 409, msg.status);
  } else check(env, 'unauthenticated API is 401 (private homologation)', (await raw(env, '/api/state')).status === 401);
  check(env, 'forged session cookie on private route is 401', (await raw(env, '/api/export', { headers: { cookie: 'observador=9999999999999.' + 'a'.repeat(64) } })).status === 401);
  check(env, 'POST without Origin is 403', (await raw(env, '/api/login', { method: 'POST', body: '{}' })).status === 403);
  check(env, 'POST from foreign Origin is 403', (await raw(env, '/api/login', { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' })).status === 403);
  const wrong = await raw(env, '/api/login', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ secret: 'x'.repeat(40) }) });
  check(env, 'wrong observer credential is 401 (rate limited)', wrong.status === 401 || wrong.status === 429, wrong.status);
  const login = await raw(env, '/api/login', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ secret: secrets[env].observer }) });
  const cookie = login.headers.get('set-cookie') ?? '';
  check(env, 'login sets HttpOnly; Secure; SameSite=Strict cookie', login.status === 200 && /HttpOnly/.test(cookie) && /Secure/.test(cookie) && /SameSite=Strict/.test(cookie), login.status);
  const html = await (await fetch(base + '/')).text();
  const scripts = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  let bundle = html;
  for (const s of scripts) bundle += await (await fetch(base + s)).text();
  const leaked = [secrets[env].observer, secrets[env].session].some((v) => bundle.includes(v)) || /GEMINI_API_KEY|AIza[0-9A-Za-z_-]{30}/.test(bundle);
  check(env, 'no secrets or API keys in HTML/JS assets', !leaked, scripts.length + ' scripts scanned');
  const headers = (await fetch(base + '/')).headers;
  check(env, 'CSP frame-ancestors none + nosniff on assets', /frame-ancestors 'none'/.test(headers.get('content-security-policy') ?? '') && headers.get('x-content-type-options') === 'nosniff');
}
const prod = await remoteClient('production');
const expectError = async (env, client, name, path, body, pattern) => {
  try { await client.request(path, body); check(env, name, false, 'unexpected success'); }
  catch (e) { check(env, name, pattern.test(e.message), e.message); }
};
const state = await prod.request('state');
check('production', 'production existence is empty (state=null)', state.state === null && state.birthEnabled === false, { birthEnabled: state.birthEnabled, ready: state.ready });
await expectError('production', prod, 'birth preflight refused while BIRTH_ENABLED=false', 'birth/prepare', {}, /aguardando_liberacao_da_homologacao/);
await expectError('production', prod, 'legacy /api/birth refused', 'birth', {}, /409|confirma/);
await expectError('production', prod, 'experiments refused in production', 'experiment', { action: 'start', hours: 1, maxCalls: 1 }, /experimento_nao_autorizado/);
await expectError('production', prod, 'controlled clock refused in production', 'experiment', { action: 'step', virtualMinutes: 30 }, /experimento_inativo|relogio_controlado_nao_autorizado|nao_nasceu|experimento/);
await expectError('production', prod, 'Gemini diagnostics refused in production (no call)', 'diagnostics/gemini', { model: 'lite' }, /diagnostico_somente_homologacao/);
await expectError('production', prod, 'induced tool tests refused in production', 'diagnostics/tools', { scenario: 'research' }, /ensaio_de_ferramentas_nao_autorizado/);
await expectError('production', prod, 'recovery target refused in production', 'backup/restore/apply?target=recovery', { id: crypto.randomUUID() }, /recuperacao_nao_autorizada|403/);
await expectError('production', prod, 'legacy v1 restore refused in production', 'restore', { version: 1 }, /403|backup assinado/i);
const files = (await readdir('.wrangler/private/backups')).filter((f) => f.endsWith('.backup.json'));
const backup = JSON.parse(await readFile('.wrangler/private/backups/' + files[0], 'utf8'));
await expectError('production', prod, 'homologation-signed backup cannot be imported into production', 'backup/restore/begin', { manifest: backup.manifest, seal: backup.seal }, /assinatura_ou_integridade_invalida|origem_de_teste_proibida/);
const hom = await remoteClient('homologation');
const tampered = structuredClone(backup);
tampered.manifest.state.identity.name = 'Inventado';
await expectError('homologation', hom, 'tampered manifest rejected by signature', 'backup/restore/begin?target=recovery', { manifest: tampered.manifest, seal: tampered.seal }, /assinatura_ou_integridade_invalida/);
const extra = structuredClone(backup);
extra.manifest.unsigned = true;
await expectError('homologation', hom, 'unsigned extra manifest field rejected', 'backup/restore/begin?target=recovery', { manifest: extra.manifest, seal: extra.seal }, /409|400|unrecognized|invalid|falha/i);
// XSS message test ran once on 2026-11-24 00:36Z; not repeated to avoid influencing the experiment creature.
const before = (await hom.request('monitor')).calls.length;
const ticks = await Promise.allSettled([0, 1, 2].map(() => hom.request('tick', {})));
const statuses = ticks.map((t) => (t.status === 'fulfilled' ? t.value.status : t.reason.message));
const afterCalls = (await hom.request('monitor')).calls.length;
check('homologation', 'three concurrent ticks cause at most one model call (lease + nextDecisionAt)', afterCalls - before <= 1, { statuses, newCalls: afterCalls - before });
const report = { checkedAt: new Date().toISOString(), passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
await writeFile('artifacts/remote-security.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
