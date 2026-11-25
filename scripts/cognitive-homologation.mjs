// End-to-end homologation of the audited cognitive architecture with REAL calls on the DISPOSABLE
// homologation creature (never production). Automatic routing only; experiment mode "acelerado".
// Each step: perception → choice → execution → result → persistence → next decision. One observer
// message is sent midway (an induced stimulus, recorded as such). Writes
// artifacts/cognitive-audit/homologation.json. Usage: node scripts/cognitive-homologation.mjs [cycles]
import { remoteClient } from './remote-client.mjs';
import { writeFile } from 'node:fs/promises';
const raw = await remoteClient('homologation');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const client = { async request(path, body) { for (let i = 0; ; i++) { try { await sleep(body === undefined ? 300 : 2500); return await raw.request(path, body); } catch (e) { if (!String(e.message).includes('429') || i > 4) throw e; await sleep(65000); } } } };
const cycles = Number(process.argv[2] ?? 14);
const disabledProviders = (process.argv[3] ?? '').split(',').filter(Boolean);
const overview = await client.request('ai');
await client.request('ai/config', { ...overview.config, strategy: 'auto', manual: {}, allowTrialInProduction: true, disabledProviders: [...new Set([...(overview.config.disabledProviders ?? []), ...disabledProviders])] });
const before = await client.request('state');
if (!before.state) throw new Error('homologation_has_no_creature');
await client.request('experiment', { action: 'start', hours: 6, maxCalls: 40, mode: 'acelerado' }).catch((e) => console.log('experiment start:', e.message));
const log = [];
try {
  for (let i = 0; i < cycles; i++) {
    if (i === Math.floor(cycles / 2)) await client.request('message', { content: 'Oi! Faz tempo que não passo aqui. O que você descobriu ou fez de interessante desde então?', id: crypto.randomUUID() });
    let step = await client.request('experiment', { action: 'step', virtualMinutes: 30 });
    for (let w = 0; step.status === 'backoff' && w < 3; w++) {
      await sleep(Math.min(16 * 60000, Math.max(5000, step.nextAttempt - Date.now() + 3000)));
      step = await client.request('experiment', { action: 'step', virtualMinutes: 30 });
    }
    const recent = (await client.request('records?kind=intencao')).records ?? [];
    const last = recent[0];
    const route = last?.data?.route ?? {};
    const attempt = (route.attempts ?? []).find((a) => a.outcome === 'aceita') ?? (route.attempts ?? [])[0] ?? {};
    const row = { cycle: i, status: step.status, at: last?.realAt ?? null, category: route.category ?? null, model: route.selected ?? null, fallbacks: route.fallbacks ?? null, tokensIn: attempt.tokensIn ?? null, tokensOut: attempt.tokensOut ?? null, estimatedIn: attempt.estimatedIn ?? null, maxOutput: attempt.maxOutput ?? null, latencyMs: attempt.latencyMs ?? null, intention: last?.content ?? null, summary: String(last?.data?.summary ?? '').slice(0, 300), outcomes: last?.data?.outcomes ?? null, execution: last?.data?.execution ?? null, proposals: (last?.data?.proposals ?? []).map((p) => (p.activity ? 'atividade:' + p.activity : p.type) + (p.query ? '(' + p.query + ')' : '') + (p.content ? ': ' + String(p.content).slice(0, 200) : '') + (p.artifact ? ' [' + p.artifact.format + ']' : '')) };
    log.push(row);
    console.log(JSON.stringify({ i, st: row.status, cat: row.category, m: row.model, in: row.tokensIn, out: row.tokensOut, est: row.estimatedIn, int: (row.intention ?? '').slice(0, 100), acts: row.proposals.map((x) => x.slice(0, 50)) }));
  }
} finally {
  await client.request('experiment', { action: 'stop' }).catch(() => undefined);
  await client.request('ai/config', overview.config).catch((e) => console.log('restore config:', e.message));
}
const after = await client.request('state');
const kinds = ['diario', 'artefato', 'pesquisa', 'interesse', 'projeto', 'conversa', 'erro_ferramenta'];
const produced = {};
for (const k of kinds) produced[k] = ((await client.request('records?kind=' + k)).records ?? []).filter((r) => r.realAt >= (log[0]?.at ?? Date.now()) - 60000).map((r) => ({ content: String(r.content).slice(0, 300), data: k === 'erro_ferramenta' ? r.data : undefined }));
await writeFile('artifacts/cognitive-audit/homologation.json', JSON.stringify({ at: new Date().toISOString(), environment: 'homologation (criatura descartável)', identityBefore: before.state.identity, identityAfter: after.state.identity, cycles: log, produced }, null, 1));
console.log(JSON.stringify({ cycles: log.length, decisions: log.filter((r) => r.status === 'decisao_registrada').length, models: [...new Set(log.map((r) => r.model).filter(Boolean))], produced: Object.fromEntries(Object.entries(produced).map(([k, v]) => [k, v.length])) }));
