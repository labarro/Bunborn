// Lists the models each key can actually reach (read-only catalog calls; keys stay in memory,
// never printed). Writes artifacts/ai-discovery.json. Run: node scripts/ai-discover.mjs
import { readGemini, readProviderKey } from './private-secrets.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
const out = { at: new Date().toISOString(), providers: {} };
async function list(name, url, headers, pick) {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    const body = await r.json().catch(() => ({}));
    out.providers[name] = { status: r.status, models: r.ok ? pick(body) : [], error: r.ok ? null : String(body?.error?.message ?? body?.detail ?? r.statusText).slice(0, 300) };
  } catch (e) { out.providers[name] = { status: 0, models: [], error: String(e.message ?? e).slice(0, 200) }; }
}
const gemini = (await readGemini()).key;
await list('gemini', 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { 'x-goog-api-key': gemini }, (b) => (b.models ?? []).filter((m) => m.supportedGenerationMethods?.includes('generateContent')).map((m) => ({ id: m.name.replace('models/', ''), context: m.inputTokenLimit, maxOutput: m.outputTokenLimit })));
const groq = await readProviderKey('groq');
if (groq) await list('groq', 'https://api.groq.com/openai/v1/models', { Authorization: 'Bearer ' + groq }, (b) => (b.data ?? []).map((m) => ({ id: m.id, owner: m.owned_by, context: m.context_window, maxOutput: m.max_completion_tokens, active: m.active })));
const nvidia = await readProviderKey('nvidia');
if (nvidia) await list('nvidia', 'https://integrate.api.nvidia.com/v1/models', { Authorization: 'Bearer ' + nvidia }, (b) => (b.data ?? []).map((m) => ({ id: m.id, owner: m.owned_by })));
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/ai-discovery.json', JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out.providers)) console.log(k, 'status', v.status, 'models', v.models.length, v.error ?? '');
