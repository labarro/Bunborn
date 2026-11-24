// Analyses the disposable homologation experiment from D1 (read-only).
// node scripts/analyze-experiment.mjs  -> artifacts/experiment-analysis.json
// Separates autonomous model decisions from observer influence and deterministic engine rules.
import { readFile, writeFile } from 'node:fs/promises';
import { cf, accountId } from './cloudflare.mjs';
const resources = JSON.parse(await readFile('artifacts/cloudflare-resources.json', 'utf8'));
const db = resources.databases['bunborn-homologation'];
const q = async (sql, params = []) => (await cf(`/accounts/${accountId}/d1/database/${db}/query`, { method: 'POST', body: JSON.stringify({ sql, params }) }))[0].results;
const [exp] = await q('SELECT * FROM experiment WHERE id=1');
if (!exp) throw new Error('no experiment');
const [world] = await q("SELECT state FROM world WHERE id='principal'");
const state = world ? JSON.parse(world.state) : null;
const rows = (await q('SELECT seq,kind,category,content,data,real_at,origin,entity_id FROM records WHERE real_at>=? ORDER BY seq', [exp.started_at - 60000])).map((r) => ({ ...r, data: JSON.parse(r.data) }));
const intents = rows.filter((r) => r.kind === 'intencao');
const norm = (t) => t.toLowerCase().normalize('NFD').replace(/[^a-z ]/g, '').split(/\s+/).filter((w) => w.length > 3).slice(0, 8).join(' ');
const distinct = new Set(intents.map((r) => norm(r.content))).size;
const tools = {};
for (const r of intents) for (const t of r.data.proposed ?? []) tools[t] = (tools[t] ?? 0) + 1;
const errors = {};
for (const r of rows.filter((r) => r.kind === 'erro_ferramenta')) errors[`${r.data.tool}:${r.data.code}`] = (errors[`${r.data.tool}:${r.data.code}`] ?? 0) + 1;
const intervals = intents.slice(1).map((r, i) => (r.real_at - intents[i].real_at) / 60000);
const pick = (kind) => rows.filter((r) => r.kind === kind).map((r) => ({ at: new Date(r.real_at).toISOString(), entity: r.entity_id, content: r.content.slice(0, 200), origin: r.origin }));
const calls = await q('SELECT model,status,COUNT(*) AS n,SUM(actual_tokens) AS tokens,AVG(latency_ms) AS latency FROM calls WHERE at>=? GROUP BY model,status', [exp.started_at]);
const analysis = {
  checkedAt: new Date().toISOString(),
  experiment: { status: exp.status, mode: exp.mode, startedAt: new Date(exp.started_at).toISOString(), endsAt: new Date(exp.ends_at).toISOString(), maxCalls: exp.max_calls, realHoursElapsed: +((Math.min(Date.now(), exp.ends_at) - exp.started_at) / 3600000).toFixed(2) },
  creature: state && { decisions: state.decisions, name: state.identity.name, traits: state.identity.traits, identityVersion: state.identity.version, virtualMinutes: Math.round(state.virtualMinutes), paused: state.paused, failures: state.failures },
  decisions: { autonomous: intents.length, models: intents.reduce((a, r) => ((a[r.data.model] = (a[r.data.model] ?? 0) + 1), a), {}), distinctIntentionShapes: distinct, repetitionRatio: intents.length ? +(1 - distinct / intents.length).toFixed(2) : null, toolsProposed: tools, realMinutesBetweenDecisions: intervals.length ? { min: +Math.min(...intervals).toFixed(1), avg: +(intervals.reduce((a, b) => a + b, 0) / intervals.length).toFixed(1), max: +Math.max(...intervals).toFixed(1) } : null },
  toolRejections: errors,
  emergentSignals: { identity: pick('identidade'), interests: pick('interesse'), projects: pick('projeto'), artifacts: pick('artefato'), research: pick('pesquisa'), diary: pick('diario').length, messagesToObserver: pick('conversa').filter((m) => m.origin !== 'observador') },
  observerInfluence: rows.filter((r) => r.kind === 'conversa' && r.origin === 'observador').map((r) => ({ at: new Date(r.real_at).toISOString(), content: r.content.slice(0, 200) })),
  engineRules: { completedActivities: rows.filter((r) => r.kind === 'atividade_concluida').length, protectiveRecovery: rows.filter((r) => r.kind === 'recuperacao').length, budgetFallbacks: rows.filter((r) => r.kind === 'orcamento').length, failures: rows.filter((r) => r.kind === 'erro').map((r) => r.data.code) },
  calls: calls.map((c) => ({ ...c, note: 'reservations incl. failures; tokens as reported by API (0 when unknown)' })),
  intentions: intents.map((r) => ({ at: new Date(r.real_at).toISOString().slice(0, 19), model: r.data.model, proposed: r.data.proposed, nextMinutes: r.data.nextMinutes, text: r.content.slice(0, 160) })),
};
await writeFile('artifacts/experiment-analysis.json', JSON.stringify(analysis, null, 2));
console.log(JSON.stringify({ ...analysis, intentions: `${analysis.intentions.length} (see file)` }, null, 1));
