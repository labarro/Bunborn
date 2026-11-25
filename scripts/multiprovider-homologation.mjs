// End-to-end homologation of the multiprovider cognition with REAL calls on the DISPOSABLE
// homologation creature (never production). Controlled steps (experiment mode "acelerado"):
//   phase A: each cycle pinned to a different model/provider (forced rotation) + a conversation
//   phase B: automatic routing with real health/quota data
// Writes artifacts/multiprovider-homologation.json. Usage: node scripts/multiprovider-homologation.mjs [cycles]
import { remoteClient } from './remote-client.mjs';
import { writeFile } from 'node:fs/promises';
const raw = await remoteClient('homologation');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Respect the admin write limit (30/min): pace requests and wait out 429s.
const client = { async request(path, body) { for (let i = 0; ; i++) { try { await sleep(body === undefined ? 300 : 2500); return await raw.request(path, body); } catch (e) { if (!String(e.message).includes('429') || i > 4) throw e; await sleep(65000); } } } };
const cycles = Number(process.argv[2] ?? 18);
const rotation = ['gemini:gemini-3.5-flash-lite', 'groq:openai/gpt-oss-120b', 'nvidia:minimaxai/minimax-m3.1-flash', 'groq:qwen/qwen3.8-27b', 'gemini:gemini-3.1-flash-lite', 'groq:openai/gpt-oss-20b', 'nvidia:nvidia/nemotron-3-ultra-550b-a55b'];
const categories = ['cotidiana', 'complexa', 'memoria', 'pesquisa', 'criatividade', 'comunicacao'];
const overview = await client.request('ai');
const base = overview.config;
const before = await client.request('state');
if (!before.state) throw new Error('homologation_has_no_creature');
const identityBefore = before.state.identity;
await client.request('experiment', { action: 'start', hours: 6, maxCalls: 60, mode: 'acelerado' }).catch((e) => console.log('experiment start:', e.message));
const log = [];
try {
  for (let i = 0; i < cycles; i++) {
    const auto = i >= Math.ceil(cycles * 0.6);
    const pin = rotation[i % rotation.length];
    await client.request('ai/config', auto ? { ...base, strategy: 'auto', manual: {} } : { ...base, strategy: 'manual', manual: Object.fromEntries(categories.map((c) => [c, pin])) });
    if (i === 3 || i === 9) await client.request('message', { content: i === 3 ? 'Oi! Sou o observador responsável. Como você está e o que tem feito por aqui?' : 'Lembra do que me contou antes? O que mudou desde então?', id: crypto.randomUUID() });
    let step = await client.request('experiment', { action: 'step', virtualMinutes: 30 });
    // A failed cycle leaves a short protective backoff: wait for it instead of skipping the cycle.
    for (let w = 0; step.status === 'backoff' && w < 3; w++) {
      await sleep(Math.min(16 * 60000, Math.max(5000, step.nextAttempt - Date.now() + 3000)));
      step = await client.request('experiment', { action: 'step', virtualMinutes: 30 });
    }
    const state = await client.request('state');
    const recent = (await client.request('records?kind=intencao')).records ?? [];
    const last = recent[0];
    const row = { cycle: i, mode: auto ? 'automatico' : 'forcado', pinned: auto ? null : pin, status: step.status, code: step.code ?? null, selected: last?.data?.route?.selected ?? null, attempts: (last?.data?.route?.attempts ?? []).map((a) => a.model + ':' + a.outcome), category: last?.data?.route?.category ?? null, reasons: (last?.data?.route?.reasons ?? []).slice(0, 2), tokens: last?.data?.route?.tokens ?? null, latencyMs: last?.data?.route?.latencyMs ?? null, intention: last?.content ?? null, name: state.state?.identity?.name ?? null, decisions: state.state?.decisions };
    log.push(row);
    console.log(JSON.stringify({ i, mode: row.mode, pin: row.pinned, sel: row.selected, st: row.status, cat: row.category, ms: row.latencyMs, int: (row.intention ?? '').slice(0, 90) }));
  }
} finally {
  await client.request('ai/config', { ...base, strategy: 'auto', manual: {} });
  await client.request('experiment', { action: 'stop' }).catch(() => undefined);
}
const after = await client.request('state');
const conversations = ((await client.request('records?kind=conversa')).records ?? []).slice(0, 8).map((r) => ({ role: r.data.role, author: r.data.author ?? null, content: r.content.slice(0, 400), realAt: r.realAt }));
const identityChanges = ((await client.request('records?kind=identidade')).records ?? []).filter((r) => r.realAt > Date.now() - 3 * 3600000).map((r) => ({ field: r.data.field, value: r.content }));
await writeFile('artifacts/multiprovider-homologation.json', JSON.stringify({ at: new Date().toISOString(), environment: 'homologation (criatura descartável)', identityBefore: { name: identityBefore.name, description: identityBefore.description }, identityAfter: { name: after.state.identity.name, description: after.state.identity.description }, identityChanges, cycles: log, conversations }, null, 1));
const ok = log.filter((r) => r.status === 'decisao_registrada').length;
console.log(JSON.stringify({ cycles: log.length, decisions: ok, models: [...new Set(log.map((r) => r.selected).filter(Boolean))], nameBefore: identityBefore.name, nameAfter: after.state.identity.name }));
