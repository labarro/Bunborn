// Multiprovider routing, resilience and continuity. ALL provider responses here are SIMULATED
// with fixture fetchers (no real calls); real-call evidence lives in the benchmark/homologation.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { born } from '../shared/domain';
import { catalog, modelKey, type Category } from '../shared/ai-catalog';
import { Store, entry } from '../worker/store';
import { tick } from '../worker/engine';
import type { Env } from '../worker/provider';
import { categorize, rankModels, useQuality, defaultConfig, knownModels, type QualityFile } from '../worker/ai/router';
import { freshHealth, loadHealth, onFailure, onSuccess, saveHealth, callable } from '../worker/ai/health';
import { classifyHttp } from '../worker/ai/adapters';
import quality from '../shared/model-quality.json';
import { database } from './database';

const all: Category[] = ['cotidiana', 'complexa', 'memoria', 'pesquisa', 'criatividade', 'comunicacao'];
const testQuality: QualityFile = {
  generatedAt: 'teste',
  models: {
    'gemini:gemini-3.1-flash-lite': { scores: Object.fromEntries(all.map((c) => [c, 0.7])), homologated: all },
    'groq:openai/gpt-oss-120b': { scores: Object.fromEntries(all.map((c) => [c, c === 'complexa' ? 0.9 : 0.65])), homologated: all },
    'groq:openai/gpt-oss-20b': { scores: Object.fromEntries(all.map((c) => [c, 0.6])), homologated: all },
  },
};
beforeEach(() => useQuality(testQuality));
afterEach(() => useQuality(quality as QualityFile));
const opened: ReturnType<typeof database>[] = [];
afterEach(() => opened.splice(0).forEach((d) => d.sqlite.close()));
function setup(extra: Partial<Env> = {}) {
  const d = database();
  opened.push(d);
  const env = { DB: d.db, ENVIRONMENT_ID: 'tool-tests', MIN_DECISION_MINUTES: '0', FREE_TIER_CONFIRMED: 'true', GEMINI_API_KEY: 'TEST-GEMINI-KEY-0000000000', GROQ_API_KEY: 'TEST-GROQ-KEY-000000000000', NVIDIA_API_KEY: 'TEST-NV-KEY-0000000000000', AI_PROVIDERS: 'gemini,groq,nvidia', MODEL_LITE: 'gemini-3.1-flash-lite', MODEL_FLASH: 'gemini-3-flash-preview', LITE_DAILY_LIMIT: '440', FLASH_DAILY_LIMIT: '16', ENVIRONMENT: 'test', ...extra } as unknown as Env;
  return { env, store: new Store(d.db) };
}
async function seed(store: Store, now = Date.now(), name: string | null = 'Lumi') {
  const s = born(now);
  s.identity.name = name;
  s.activity.until = 0;
  const token = await store.acquire(now);
  await store.commit(token!, s, [entry(s, 'nascimento', 'Nascimento DESCARTÁVEL de teste.', { fixture: true }, { importance: 1 })], [], true);
  await store.release(token!);
}
const decisionJson = (intention: string) => JSON.stringify({ intention, summary: 'Fixture simulada.', nextMinutes: 5, complexNext: false, actions: [{ type: 'diario', content: 'Registro da fixture.' }] });
type Behavior = 'ok' | 503 | 429 | 401 | 'invalid' | 'timeout';
function fakeProviders(behavior: Partial<Record<'gemini' | 'groq' | 'nvidia', Behavior>>, log: { provider: string; body: string }[] = []) {
  return (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const provider = url.includes('generativelanguage') ? 'gemini' : url.includes('groq.com') ? 'groq' : 'nvidia';
    log.push({ provider, body: String(init?.body ?? '') });
    const b = behavior[provider] ?? 'ok';
    if (b === 'timeout') throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    if (typeof b === 'number') return new Response(JSON.stringify({ error: { message: b === 503 ? 'high demand' : b === 429 ? 'rate limit per minute' : 'invalid api key' } }), { status: b, headers: b === 429 ? { 'retry-after': '30' } : {} });
    const text = b === 'invalid' ? 'não é json' : decisionJson('Decisão via ' + provider);
    if (provider === 'gemini') return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 } });
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: text } }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } });
  }) as typeof fetch;
}

describe('categorization (deterministic, no AI call)', () => {
  const base = { inbox: 0, complexNext: false, decisionNumber: 3, consolidationDue: false, recentResearch: false, creativity: 50, boredom: 30, activeCreativeProject: false };
  it('maps state signals to one category per decision', () => {
    expect(categorize({ ...base, inbox: 1 }).category).toBe('comunicacao');
    expect(categorize({ ...base, complexNext: true }).category).toBe('complexa');
    expect(categorize({ ...base, decisionNumber: 48 }).category).toBe('complexa');
    expect(categorize({ ...base, consolidationDue: true }).category).toBe('memoria');
    expect(categorize({ ...base, recentResearch: true }).category).toBe('pesquisa');
    expect(categorize({ ...base, creativity: 80, boredom: 70 }).category).toBe('criatividade');
    expect(categorize(base).category).toBe('cotidiana');
  });
});

describe('router ranking', () => {
  const rank = (over: Partial<Parameters<typeof rankModels>[0]> = {}) =>
    rankModels({ category: 'cotidiana', models: knownModels(), health: new Map(), usage: () => ({ callsToday: 0, tokensToday: 0 }), config: defaultConfig, environment: 'tool-tests', availableProviders: ['gemini', 'groq', 'nvidia'], now: 1000, estimatedTokens: 6000, ...over });
  it('selects by homologated quality per category, not by a fixed provider order', () => {
    expect(rank().ranked[0].key).toBe('gemini:gemini-3.1-flash-lite');
    expect(rank({ category: 'complexa' }).ranked[0].key).toBe('groq:openai/gpt-oss-120b');
  });
  it('excludes non-homologated, breaker-open, over-budget and disabled models with reasons', () => {
    const health = new Map([['gemini:gemini-3.1-flash-lite', { ...freshHealth('gemini:gemini-3.1-flash-lite'), state: 'indisponivel' as const, next_probe_at: 99999 }]]);
    const r = rank({ health, usage: (m) => (m.id === 'openai/gpt-oss-20b' ? { callsToday: 0, tokensToday: 179000 } : { callsToday: 0, tokensToday: 0 }), config: { ...defaultConfig, disabledModels: ['groq:qwen/qwen3.8-27b'] } });
    expect(r.ranked.map((c) => c.key)).toEqual(['groq:openai/gpt-oss-120b']);
    const reasons = Object.fromEntries(r.excluded.map((e) => [e.key, e.reason]));
    expect(reasons['gemini:gemini-3.1-flash-lite']).toMatch(/circuit breaker/);
    expect(reasons['groq:openai/gpt-oss-20b']).toMatch(/tokens/);
    expect(reasons['groq:qwen/qwen3.8-27b']).toMatch(/desabilitado/);
    expect(reasons['gemini:gemini-3-flash-preview']).toMatch(/não homologado/);
  });
  it('keeps trial-only providers out of production unless the responsible observer allows it', () => {
    useQuality({ generatedAt: 't', models: { ...testQuality.models, 'nvidia:moonshotai/kimi-k3.1-pro': { entry: { label: 'Kimi' }, scores: { cotidiana: 0.99 }, homologated: ['cotidiana'] } } });
    expect(rank({ environment: 'production' }).ranked.some((c) => c.model.provider === 'nvidia')).toBe(false);
    expect(rank({ environment: 'homologation' }).ranked[0].model.provider).toBe('nvidia');
    expect(rank({ environment: 'production', config: { ...defaultConfig, allowTrialInProduction: true } }).ranked[0].model.provider).toBe('nvidia');
  });
  it('affinity keeps the previous model of the same category when close; manual pin wins', () => {
    const lastModel = { key: 'groq:openai/gpt-oss-120b', category: 'cotidiana' as Category };
    expect(rank({ lastModel }).ranked[0].key).toBe('groq:openai/gpt-oss-120b');
    expect(rank({ lastModel: { ...lastModel, category: 'pesquisa' } }).ranked[0].key).toBe('gemini:gemini-3.1-flash-lite');
    expect(rank({ config: { ...defaultConfig, strategy: 'manual', manual: { cotidiana: 'groq:openai/gpt-oss-20b' } } }).ranked[0].key).toBe('groq:openai/gpt-oss-20b');
  });
  it('quota pressure lowers a model without excluding it', () => {
    const near = rank({ usage: (m) => (m.provider === 'gemini' ? { callsToday: 420, tokensToday: 0 } : { callsToday: 0, tokensToday: 0 }) });
    expect(near.ranked[0].model.provider).toBe('groq');
    expect(near.ranked.find((c) => c.model.provider === 'gemini')!.reasons.join()).toMatch(/limite diário/);
  });
});

describe('circuit breaker (persisted)', () => {
  it('classifies errors: overload, rate limit, daily quota, auth, invalid request', () => {
    expect(classifyHttp(503, 'high demand', null, {}).kind).toBe('sobrecarga');
    expect(classifyHttp(429, 'Rate limit reached for requests per minute', '12', {}).kind).toBe('limite_taxa');
    expect(classifyHttp(429, 'Rate limit reached on tokens per day (TPD)', null, {}).kind).toBe('cota_esgotada');
    expect(classifyHttp(401, 'bad key', null, {}).recoverable).toBe(false);
    expect(classifyHttp(400, 'bad', null, {}).kind).toBe('requisicao_invalida');
    expect(classifyHttp(429, 'Request too large for model qwen in organization on tokens per minute (TPM)', null, {}).kind).toBe('requisicao_invalida');
    expect(classifyHttp(503, 'contains SECRET-KEY-XYZ', null, { groq: 'SECRET-KEY-XYZ' }).detail).not.toContain('SECRET-KEY-XYZ');
  });
  it('opens with backoff+jitter, respects Retry-After, disables on auth, tolerates a single invalid reply', () => {
    const h = freshHealth('gemini:x');
    const a = onFailure(h, 'sobrecarga', '503', 0, null);
    expect(a.state).toBe('indisponivel');
    expect(a.next_probe_at).toBeGreaterThan(100000);
    expect(a.next_probe_at).toBeLessThan(140000);
    const b = onFailure(a, 'sobrecarga', '503', 0, null);
    expect(b.next_probe_at).toBeGreaterThan(a.next_probe_at);
    expect(onFailure(h, 'limite_taxa', '429', 0, 30000).next_probe_at).toBeGreaterThan(25000);
    expect(onFailure(h, 'autenticacao', '401', 0, null).state).toBe('desabilitado');
    const once = onFailure(h, 'resposta_invalida', 'json', 0, null);
    expect(once.state).toBe('degradado');
    expect(callable(once, 0)).toBe(true);
    expect(h.success_ewma - onFailure(h, 'sobrecarga', '', 0, null).success_ewma).toBeLessThan(0.2);
    const recovered = onSuccess(b, 500, 1);
    expect(recovered).toMatchObject({ state: 'operacional', consecutive_failures: 0 });
  });
  it('survives a Worker restart (state lives in D1)', async () => {
    const { store } = setup();
    await saveHealth(store.db, onFailure(freshHealth('groq:a'), 'sobrecarga', '503', 1000, null), 1000);
    const again = await loadHealth(new Store(store.db).db);
    expect(again.get('groq:a')?.state).toBe('indisponivel');
  });
});

describe('fallback inside the real engine (simulated provider failures)', () => {
  it('Gemini 503 → next best model answers in the same cycle; exactly one decision is applied', async () => {
    const { env, store } = setup();
    const t0 = Date.now();
    await seed(store, t0);
    const log: { provider: string; body: string }[] = [];
    const result = await tick(env, t0 + 1000, undefined, fakeProviders({ gemini: 503 }, log));
    expect(result.status).toBe('decisao_registrada');
    const intents = await store.records('intencao');
    expect(intents).toHaveLength(1);
    expect(intents[0].content).toBe('Decisão via groq');
    const route = intents[0].data.route as { attempts: { outcome: string }[]; fallbacks: number; selected: string };
    expect(route.attempts.map((a) => a.outcome)).toEqual(['sobrecarga', 'aceita']);
    expect(route.fallbacks).toBe(1);
    expect((await store.records('diario'))).toHaveLength(1);
    expect((await loadHealth(store.db)).get('gemini:gemini-3.1-flash-lite')?.state).toBe('indisponivel');
  });
  it('invalid JSON and timeouts also fall back; 429 honors Retry-After; bad credentials are not retried', async () => {
    const { env, store } = setup();
    const t0 = Date.now();
    await seed(store, t0);
    const log: { provider: string; body: string }[] = [];
    // Gemini answers garbage and both Groq models reject the key: three bounded attempts, no decision.
    await tick(env, t0 + 1000, undefined, fakeProviders({ gemini: 'invalid', groq: 401 }, log));
    const route = (await store.records('erro'))[0].data.route as { attempts: { outcome: string; model: string }[] };
    expect(route.attempts.map((a) => a.outcome)).toEqual(['resposta_invalida', 'autenticacao', 'autenticacao']);
    expect(await store.records('intencao')).toHaveLength(0);
    const health = await loadHealth(store.db);
    expect(health.get('groq:openai/gpt-oss-120b')?.state).toBe('desabilitado');
    // Next cycle: the disabled Groq model is not called again.
    log.length = 0;
    await tick(env, t0 + 10 * 60000, undefined, fakeProviders({ gemini: 'timeout' }, log));
    expect(log.filter((l) => l.provider === 'groq' && l.body.includes('gpt-oss-120b'))).toHaveLength(0);
  });
  it('all providers down: state preserved, suspension recorded, no invented decision, automatic resume', async () => {
    const { env, store } = setup();
    const t0 = Date.now();
    await seed(store, t0);
    const down = fakeProviders({ gemini: 503, groq: 503, nvidia: 503 });
    const result = await tick(env, t0 + 1000, undefined, down);
    expect(result.status).toBe('suspenso');
    expect(await store.records('intencao')).toHaveLength(0);
    const error = (await store.records('erro'))[0];
    expect(error.data.code).toBe('cognicao_indisponivel');
    expect((error.data.route as { attempts: unknown[] }).attempts.length).toBeGreaterThan(0);
    const state = (await store.state())!;
    expect(state.nextDecisionAt).toBeGreaterThan(t0 + 1000 + 110000);
    // Deterministic body simulation keeps running while cognition is suspended.
    await tick(env, t0 + 60000, undefined, down);
    expect((await store.state())!.virtualMinutes).toBeGreaterThan(state.virtualMinutes);
    // After the breakers' probe time, cognition resumes by itself.
    const later = t0 + 3 * 3600000;
    const resumed = await tick(env, later, undefined, fakeProviders({}));
    expect(resumed.status).toBe('decisao_registrada');
  });
  it('the same identity reaches every model: the context sent to Gemini and Groq is the same persisted state', async () => {
    const { env, store } = setup();
    const t0 = Date.now();
    await seed(store, t0, 'Lumi');
    const log: { provider: string; body: string }[] = [];
    await tick(env, t0 + 1000, undefined, fakeProviders({ gemini: 503 }, log));
    const prompts = log.map((l) => {
      const body = JSON.parse(l.body);
      return l.provider === 'gemini' ? body.contents[0].parts[0].text : body.messages[1].content;
    });
    expect(prompts).toHaveLength(2);
    expect(JSON.parse(prompts[0]).identity).toEqual(JSON.parse(prompts[1]).identity);
    expect(JSON.parse(prompts[1]).identity.name).toBe('Lumi');
  });
  it('a full cycle reserves budget per model and records provider and category', async () => {
    const { env, store } = setup();
    const t0 = Date.now();
    await seed(store, t0);
    await tick(env, t0 + 1000, undefined, fakeProviders({ gemini: 503 }));
    const calls = (await store.db.prepare('SELECT model, provider, category, status FROM calls ORDER BY at').all()).results;
    expect(calls).toEqual([
      { model: 'gemini-3.1-flash-lite', provider: 'gemini', category: 'cotidiana', status: 'sobrecarga' },
      { model: 'openai/gpt-oss-120b', provider: 'groq', category: 'cotidiana', status: 'sucesso' },
    ]);
  });
});
void catalog;
void modelKey;

describe('category safety net', () => {
  it('when nothing homologated for the category is available, the best everyday model is used and the reason recorded', () => {
    useQuality({ generatedAt: 't', models: { 'groq:openai/gpt-oss-120b': { scores: { cotidiana: 0.9 }, homologated: ['cotidiana'] } } });
    const r = rankModels({ category: 'comunicacao', models: knownModels(), health: new Map(), usage: () => ({ callsToday: 0, tokensToday: 0 }), config: defaultConfig, environment: 'production', availableProviders: ['gemini', 'groq'], now: 1, estimatedTokens: 5000 });
    expect(r.ranked[0].key).toBe('groq:openai/gpt-oss-120b');
    expect(r.ranked[0].reasons[0]).toMatch(/sem modelo homologado disponível para comunicacao/);
  });
});

describe('fallback beyond the category', () => {
  it('when the category models fail, an everyday-homologated model answers the same decision', async () => {
    useQuality({ generatedAt: 't', models: { 'gemini:gemini-3.1-flash-lite': { scores: { cotidiana: 0.6, comunicacao: 0.6 }, homologated: ['cotidiana', 'comunicacao'] }, 'groq:openai/gpt-oss-120b': { scores: { cotidiana: 0.9 }, homologated: ['cotidiana'] } } });
    const { env, store } = setup();
    const t0 = Date.now();
    await seed(store, t0);
    await env.DB.prepare("INSERT INTO inbox(id,content,at,author) VALUES('m1','Oi!',?,'responsavel')").bind(t0).run();
    await tick(env, t0 + 1000, undefined, fakeProviders({ gemini: 503 }));
    const route = (await store.records('intencao'))[0].data.route as { category: string; selected: string; attempts: { outcome: string }[]; reasons: string[] };
    expect(route.category).toBe('comunicacao');
    expect(route.selected).toBe('groq:openai/gpt-oss-120b');
    expect(route.reasons[0]).toMatch(/alternativa geral/);
  });
});
