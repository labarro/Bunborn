// Real smoke call per candidate model: availability, JSON mode, latency, tokens.
// Writes artifacts/ai-smoke.json. Calls run on free accounts without billing.
import { callModel, extractJson, ProviderFailure, type Keys } from '../worker/ai/adapters';
import { catalog, nvidiaEntry, type ModelEntry } from '../shared/ai-catalog';
// @ts-ignore plain JS helper
import { readGemini, readProviderKey } from './private-secrets.mjs';
import { writeFileSync } from 'node:fs';
const keys: Keys = { gemini: (await readGemini()).key, groq: (await readProviderKey('groq')) ?? undefined, nvidia: (await readProviderKey('nvidia')) ?? undefined };
const extraGemini: ModelEntry[] = ['gemini-3.5-flash-lite', 'gemma-4-31b-it'].map((id) => ({ ...catalog[0], id, label: id, free: 'desconhecido', structured: id.startsWith('gemma') ? 'json_object' : 'json_schema', reasoning: id.startsWith('gemma') ? 'nenhum' : 'configuravel' }));
const nvidia = ['moonshotai/kimi-k3.1-pro', 'z-ai/glm-5.3-flash', 'nvidia/nemotron-3-ultra-550b-a55b', 'mistralai/mistral-large-4-1t-a52b', 'minimaxai/minimax-m3.1-flash', 'stepfun-ai/step-5-preview', 'nvidia/nemotron-3.5-lightning-30b-a3b'].map((id) => nvidiaEntry(id));
const models = [...catalog, ...extraGemini, ...nvidia];
const results = [];
for (const m of models) {
  const req = { system: 'Você responde somente com um objeto JSON válido, em português.', prompt: 'Retorne {"ok": true, "frase": "<uma frase curta sobre coelhos>"}', schema: { type: 'object', properties: { ok: { type: 'boolean' }, frase: { type: 'string' } }, required: ['ok', 'frase'] }, maxOutput: 600, reasoning: 'baixo' as const };
  try {
    const r = await callModel(m, req, keys, fetch, 60000);
    const parsed = extractJson(r.text) as { ok?: boolean; frase?: string };
    results.push({ model: m.id, provider: m.provider, ok: parsed.ok === true, latencyMs: r.latencyMs, tokensIn: r.tokensIn, tokensOut: r.tokensOut, sample: String(parsed.frase ?? '').slice(0, 100) });
  } catch (e) {
    const f = e instanceof ProviderFailure ? e : null;
    results.push({ model: m.id, provider: m.provider, ok: false, failure: f?.kind ?? 'erro', status: f?.status, detail: (f?.detail ?? String(e)).slice(0, 160) });
  }
  console.log(JSON.stringify(results.at(-1)));
}
writeFileSync('artifacts/ai-smoke.json', JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
