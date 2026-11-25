// Cognitive audit 25/11: prompt modules, felt body, memory echo, token budgets, ledger safety.
// Provider responses are SIMULATED fixtures; real-call evidence is in artifacts/cognitive-audit.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { born, feelings, feltChange } from '../shared/domain';
import { catalog, nvidiaEntry } from '../shared/ai-catalog';
import { maxOutputFor, estimateInput } from '../shared/token-budget';
import { Store, entry } from '../worker/store';
import { buildContext, tick } from '../worker/engine';
import { instructionsFor, systemFor, type Env } from '../worker/provider';
import { classifyHttp, retryAfterMs } from '../worker/ai/adapters';
import { useQuality, type QualityFile } from '../worker/ai/router';
import quality from '../shared/model-quality.json';
import { database } from './database';

const opened: ReturnType<typeof database>[] = [];
afterEach(() => opened.splice(0).forEach((d) => d.sqlite.close()));
const all = ['cotidiana', 'complexa', 'memoria', 'pesquisa', 'criatividade', 'comunicacao'] as const;
beforeEach(() => useQuality({ generatedAt: 't', models: { 'groq:openai/gpt-oss-120b': { scores: Object.fromEntries(all.map((c) => [c, 0.8])), homologated: [...all] }, 'gemini:gemini-3.1-flash-lite': { scores: Object.fromEntries(all.map((c) => [c, 0.7])), homologated: [...all] } } }));
afterEach(() => useQuality(quality as QualityFile));
function setup() {
  const d = database();
  opened.push(d);
  const env = { DB: d.db, ENVIRONMENT_ID: 'tool-tests', MIN_DECISION_MINUTES: '0', FREE_TIER_CONFIRMED: 'true', GEMINI_API_KEY: 'TEST-GEMINI-KEY-0000000000', GROQ_API_KEY: 'TEST-GROQ-KEY-000000000000', AI_PROVIDERS: 'gemini,groq', MODEL_LITE: 'gemini-3.1-flash-lite', MODEL_FLASH: 'gemini-3-flash-preview', LITE_DAILY_LIMIT: '440', FLASH_DAILY_LIMIT: '16', ENVIRONMENT: 'test' } as unknown as Env;
  return { d, env, store: new Store(d.db) };
}
type S = ReturnType<typeof born>;
async function seedState(store: Store, f: (s: S) => void = () => {}, records: (s: S) => ReturnType<typeof entry>[] = () => [], now = Date.now()) {
  const s = born(now);
  s.decisions = 30;
  s.activity.until = 0;
  f(s);
  const token = await store.acquire(now);
  await store.commit(token!, s, [entry(s, 'nascimento', 'Nascimento DESCARTÁVEL de teste.', {}, { importance: 1 }), ...records(s)], [], true);
  await store.release(token!);
  return s;
}

describe('prompt modules', () => {
  it('birth instructions only at decision zero; safety and continuity always', () => {
    expect(instructionsFor(0)).toMatch(/começa sem nome/);
    expect(instructionsFor(5)).not.toMatch(/começa sem nome/);
    for (const n of [0, 5]) {
      expect(instructionsFor(n)).toMatch(/NÃO CONFIÁVEIS/);
      expect(instructionsFor(n)).toMatch(/sempre a mesma criatura/);
      expect(instructionsFor(n)).not.toMatch(/altos indicam necessidade/);
    }
    expect(systemFor(5)).toMatch(/Contratos tipados/);
  });
});

describe('felt body', () => {
  it('levels follow the real simulation thresholds without exposing numbers', () => {
    const s = born(0);
    s.needs = { ...s.needs, fome: 10, sede: 92, sono: 20, energia: 40 };
    const f = feelings(s);
    expect(f.body).toMatchObject({ fome: 'sem fome', sede: 'sede intensa', sono: 'descansada', energia: 'um pouco cansada' });
    expect(JSON.stringify(f)).not.toMatch(/\d/);
    expect(feltChange('comer', { fome: 80, sono: 30 }, { fome: 1, sono: 31 })).toBe('Depois de comer: fome: com fome → sem fome.');
  });
});

describe('context: continuity instead of echo', () => {
  it('auto summaries of the current cycle are not recalled as memories; older real memories are', async () => {
    const { env, store } = setup();
    const now = Date.now();
    const s = await seedState(store, (x) => { x.activity.intention = 'Desenhar a planta do quarto'; }, (x) => [
      entry(x, 'memoria', 'Percebi que a planta muda de cor ao entardecer.', { status: 'observacao' }, { category: 'episodica', origin: 'criatura', realAt: now - 3 * 86400000, importance: 0.7 }),
      entry(x, 'intencao', 'Desenhar a planta do quarto', { proposals: [], outcomes: [] }, { realAt: now - 60000 }),
      entry(x, 'memoria', 'Intenção: Desenhar a planta do quarto. Resultado: nada.', {}, { category: 'episodica', origin: 'observacao', realAt: now - 60000 }),
      entry(x, 'memoria', 'Contexto de continuidade: Desenhar a planta do quarto.', {}, { category: 'trabalho', origin: 'observacao', realAt: now - 60000 }),
      entry(x, 'memoria', 'Associação afetiva simulada após a atividade.', {}, { category: 'afetiva', origin: 'regra_afetiva', realAt: now - 60000 }),
    ], now);
    const { context } = await buildContext(env, store, s, now);
    const texts = (context.memories as { content: string }[]).map((m) => m.content);
    expect(texts).toContain('Percebi que a planta muda de cor ao entardecer.');
    expect(texts.some((t) => /Contexto de continuidade|Associação afetiva|^Intenção:/.test(t))).toBe(false);
    expect((context.thread as { intention: string }[])[0].intention).toBe('Desenhar a planta do quarto');
  });
  it('research results come back as knowledge, one entry per question', async () => {
    const { env, store } = setup();
    const now = Date.now();
    const s = await seedState(store, () => {}, (x) => [1, 2].map(() => entry(x, 'pesquisa', 'Consulta externa: vulcão.', { query: 'vulcão', source: 'wikipedia', results: [{ title: 'Vulcão', excerpt: 'Abertura na crosta por onde sai magma.', url: 'https://pt.wikipedia.org/?curid=1' }] })));
    const { context } = await buildContext(env, store, s, now);
    const research = (context.knowledge as { research: { query: string; results: { title: string }[] }[] }).research;
    expect(research).toHaveLength(1);
    expect(research[0].results[0].title).toBe('Vulcão');
  });
  it('a finished cycle no longer writes the two content-free memories', async () => {
    const { env, store } = setup();
    await seedState(store);
    const fixture = { async decide() { return { decision: { intention: 'Ler sobre vulcões', summary: 's', nextMinutes: 5, complexNext: false, actions: [{ type: 'atividade' as const, activity: 'descansar' as const, minutes: 10 }] }, model: 'fixture' }; } };
    await tick(env, Date.now() + 1000, fixture);
    const mems = await store.records('memoria');
    expect(mems.some((m) => /Contexto de continuidade|Associação afetiva/.test(m.content))).toBe(false);
    expect(mems.some((m) => m.content.startsWith('Intenção: Ler sobre vulcões'))).toBe(true);
  });
});

describe('tokens and output budgets', () => {
  const groq = catalog.find((m) => m.id === 'openai/gpt-oss-120b')!;
  it('fits Groq output under tokens/minute and gives creative work more room', () => {
    expect(maxOutputFor(groq, 'cotidiana', 4000)).toBe(2560); // gpt-oss reasons: floor 2560 (used 2037 of 2048 on 25/11)
    expect(maxOutputFor(groq, 'cotidiana', 5000)).toBe(2500); // ...but never above Groq tokens/minute
    expect(maxOutputFor(catalog.find((m) => m.id.startsWith('qwen/'))!, 'cotidiana', 5000)).toBe(1536);
    expect(maxOutputFor(nvidiaEntry('nvidia/nemotron-3-ultra-550b-a55b'), 'cotidiana', 5000)).toBe(3072);
    expect(maxOutputFor(groq, 'criatividade', 5000)).toBe(groq.limits.tpm - 5000 - 300);
    expect(maxOutputFor(catalog[0], 'criatividade', 5000)).toBe(4096);
    expect(maxOutputFor(catalog[0], 'cotidiana', 5000)).toBe(1536);
    expect(estimateInput(33000, nvidiaEntry('x/y'))).toBeGreaterThan(estimateInput(33000, catalog[0]));
  });
});

describe('errors and ledger', () => {
  it('Retry-After as seconds or HTTP date; provider account ids are redacted', () => {
    const now = Date.parse('2026-11-25T22:00:00Z');
    expect(retryAfterMs('30', now)).toBe(30000);
    expect(retryAfterMs('Wed, 25 Nov 2026 22:02:00 GMT', now)).toBe(120000);
    expect(retryAfterMs(null, now)).toBeNull();
    expect(retryAfterMs('garbage', now)).toBeNull();
    const f = classifyHttp(429, 'Request too large for model in organization org_01abcdefghij on tokens per minute', null, {});
    expect(f.detail).not.toMatch(/org_01abcdefghij/);
    expect(f.detail).toMatch(/org_\[redacted\]/);
  });
  it('orphan reservations are settled conservatively once and never twice', async () => {
    const { d, store } = setup();
    const now = Date.now();
    const id = await store.reserve('m', '2026-11-25', now - 20 * 60000, 10, 5, 5000);
    expect(id).not.toBeNull();
    await store.reconcileOrphans(now);
    await store.reconcileOrphans(now);
    const row = d.sqlite.prepare('SELECT status, actual_tokens FROM calls WHERE id=?').get(id!) as { status: string; actual_tokens: number };
    expect(row).toMatchObject({ status: 'orfa_conservadora', actual_tokens: 5000 });
    expect((d.sqlite.prepare("SELECT tokens FROM budgets WHERE model='m'").get() as { tokens: number }).tokens).toBe(5000);
    await store.settle(id!, 10, 'sucesso'); // a late settle cannot double count
    expect((d.sqlite.prepare("SELECT tokens FROM budgets WHERE model='m'").get() as { tokens: number }).tokens).toBe(5000);
  });
  it('a ledger failure after a valid answer never discards the decision', async () => {
    const { env, store } = setup();
    await seedState(store);
    const original = Store.prototype.settle;
    Store.prototype.settle = async function () { throw new Error('D1 indisponível'); };
    try {
      const fetcher = (async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ intention: 'Pesquisar vulcões', summary: 's', nextMinutes: 5, complexNext: false, actions: [{ type: 'atividade', activity: 'descansar', minutes: 10 }] }) } }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } })) as typeof fetch;
      const r = await tick(env, Date.now() + 1000, undefined, fetcher);
      expect(r.status).toBe('decisao_registrada');
    } finally {
      Store.prototype.settle = original;
    }
  });
});
