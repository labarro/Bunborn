import { afterEach, describe, expect, it } from 'vitest';
import { born, decisionSchema, quotaDay, type Decision } from '../shared/domain';
import { Store, entry } from '../worker/store';
import { tick, administer } from '../worker/engine';
import { CognitiveError, GeminiProvider, type CognitionProvider, type Env } from '../worker/provider';
import { confirmedBirth, runCycle } from '../worker/operations';
import { database } from './database';
// Mechanism tests with explicit fixtures. Nothing here is real cognition or emergence.
const opened: ReturnType<typeof database>[] = [];
afterEach(() => opened.splice(0).forEach((d) => d.sqlite.close()));
function setup(extra: Partial<Env> = {}) {
  const d = database();
  opened.push(d);
  const env = {
    DB: d.db,
    FREE_TIER_CONFIRMED: 'false',
    MODEL_LITE: 'gemini-3.1-flash-lite',
    MODEL_FLASH: 'gemini-3-flash-preview',
    LITE_DAILY_LIMIT: '440',
    FLASH_DAILY_LIMIT: '16',
    ENVIRONMENT: 'test',
    ...extra,
  } as Env;
  return { ...d, env, store: new Store(d.db) };
}
async function seed(store: Store, now = Date.now()) {
  const s = born(now);
  // Needs high enough that the body accepts every physical activity used by these mechanism tests.
  Object.assign(s.needs, { sono: 60, fome: 60, sede: 60, higiene: 50 });
  const token = await store.acquire(now);
  await store.commit(token!, s, [entry(s, 'nascimento', 'Nascimento DESCARTÁVEL de teste.', { fixture: true }, { importance: 1 })], [], true);
  await store.release(token!);
  return s;
}
function fixture(actions: Decision['actions'] = [], seen?: { complex: boolean[] }): CognitionProvider {
  return {
    async decide(_context, complex) {
      seen?.complex.push(complex);
      return {
        model: 'fixture-explicita-sem-ia',
        decision: decisionSchema.parse({ intention: 'Intenção FIXTURE', summary: 'Programada; não é IA.', nextMinutes: 5, complexNext: false, actions }),
      };
    },
  };
}
const geminiReply = (tokens = 50) =>
  Response.json({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ intention: 'Fixture HTTP', summary: 'Não é IA real.', nextMinutes: 5, complexNext: false, actions: [] }) }] } }],
    usageMetadata: { totalTokenCount: tokens },
  });
describe('physical activity queue (fixture decisions)', () => {
  it('queues up to four, continues without restarting, completes in order and interrupts explicitly', async () => {
    const { env, store } = setup();
    const t0 = Date.now();
    await seed(store, t0);
    await tick(env, t0, fixture([{ type: 'atividade', activity: 'dormir', minutes: 60 }, { type: 'atividade', activity: 'comer', minutes: 30 }]));
    let s = (await store.state())!;
    expect(s.activity.kind).toBe('dormir');
    const sleepUntil = s.activity.until;
    expect(s.queue?.map((q) => q.kind)).toEqual(['comer']);
    expect(s.queue?.[0].until).toBe(sleepUntil + 30);
    // 5 real minutes = 30 virtual minutes at 6x: continuing the same activity keeps its end.
    await tick(env, t0 + 300000, fixture([{ type: 'atividade', activity: 'dormir', minutes: 60 }]));
    s = (await store.state())!;
    expect(s.activity.until).toBe(sleepUntil);
    expect((await store.records('atividade')).at(-1)!.content).toContain('continuada');
    // After 60 virtual minutes the sleep completes and the queued meal becomes current.
    await tick(env, t0 + 600000 + 1000, fixture([]));
    s = (await store.state())!;
    expect(s.activity.kind).toBe('comer');
    const done = await store.records('atividade_concluida');
    expect(done.map((r) => (r.data.activity as { kind: string }).kind)).toContain('dormir');
    // Fill the queue while a long (non-passive) activity runs: four queued fit, the fifth is rejected.
    // A passive activity with an empty queue would simply be replaced, so sleep is used here.
    await tick(env, t0 + 900000 + 2000, fixture([{ type: 'atividade', activity: 'dormir', minutes: 240 }, { type: 'atividade', activity: 'beber', minutes: 30 }, { type: 'atividade', activity: 'higiene', minutes: 30 }]));
    await tick(env, t0 + 1200000 + 3000, fixture([{ type: 'atividade', activity: 'descansar', minutes: 30 }, { type: 'atividade', activity: 'organizar', minutes: 30 }, { type: 'atividade', activity: 'observar', minutes: 30 }]));
    s = (await store.state())!;
    expect(s.queue!.length).toBe(4);
    const errors = (await store.records('erro_ferramenta')).map((r) => r.data.code);
    expect(errors).toContain('fila_de_atividades_cheia');
    await tick(env, t0 + 1500000 + 4000, fixture([{ type: 'interromper', reason: 'Mudança de intenção (fixture).' }]));
    s = (await store.state())!;
    expect(s.queue).toEqual([]);
    expect(s.activity.until).toBeLessThanOrEqual(s.virtualMinutes);
    expect((await store.records('atividade_interrompida')).length).toBe(1);
  });
  it('records activities that finish during an administrative change instead of dropping them', async () => {
    const { env, store } = setup();
    const t0 = Date.now();
    await seed(store, t0);
    await tick(env, t0, fixture([{ type: 'atividade', activity: 'beber', minutes: 10 }]));
    await administer(env, async (s) => [entry(s, 'administracao', 'Ajuste de teste.')], t0 + 180000);
    expect((await store.records('atividade_concluida')).map((r) => (r.data.activity as { kind: string }).kind)).toEqual(['beber']);
  });
});
describe('same-cycle references and associative memory (fixture decisions)', () => {
  it('lets a later action cite an entity created earlier in the same cycle, but not an invented one', async () => {
    const { env, store } = setup();
    const t0 = Date.now();
    await seed(store, t0);
    await tick(env, t0, fixture([
      { type: 'projeto', id: 'p1', title: 'Projeto fixture', steps: ['Produzir'], completed: [], status: 'ativo', horizon: 'curto', evidence: ['nascimento'] },
      { type: 'criar', id: 'obra1', title: 'Obra fixture', motivation: 'teste', projectId: 'p1', artifact: { format: 'texto', content: 'Texto de teste.' } },
      { type: 'memoria', category: 'episodica', content: 'Lembrança fixture da obra.', confidence: 0.8, status: 'observacao', evidence: ['artefato:obra1', 'projeto:p1'] },
    ]));
    expect((await store.records('erro_ferramenta')).length).toBe(0);
    const memory = (await store.records('memoria')).find((r) => r.content === 'Lembrança fixture da obra.')!;
    const artifact = (await store.records('artefato'))[0];
    expect(memory.associations).toContain(artifact.id);
    await tick(env, t0 + 300000, fixture([{ type: 'memoria', category: 'episodica', content: 'Inventada.', confidence: 0.5, status: 'observacao', evidence: ['nao-existe-123'] }]));
    const rejection = (await store.records('erro_ferramenta')).find((r) => r.data.code === 'evidencia_inexistente')!;
    expect((rejection.data.detail as { missing: string[] }).missing).toEqual(['nao-existe-123']);
    // A station tool during another activity explains what is happening instead of a bare code.
    await tick(env, t0 + 600000, fixture([{ type: 'atividade', activity: 'dormir', minutes: 120 }, { type: 'diario', content: 'Tentativa durante o sono.' }]));
    const busy = (await store.records('erro_ferramenta')).find((r) => r.data.code === 'atividade_em_andamento')!;
    expect(busy.data.detail).toMatchObject({ current: 'dormir', requiredStation: 'diario' });
  });
  it('resolves entities cited by record UUID, short id or entityId without duplicating them', async () => {
    const { env, store } = setup();
    const t0 = Date.now();
    await seed(store, t0);
    await tick(env, t0, fixture([
      { type: 'projeto', id: 'ensaio', title: 'Projeto fixture', steps: ['Produzir'], completed: [], status: 'ativo', horizon: 'curto', evidence: ['nascimento'] },
      { type: 'criar', id: 'texto-ensaio', title: 'Poema fixture', motivation: 'teste', projectId: 'ensaio', artifact: { format: 'texto', content: 'Primeira versão.' } },
    ]));
    const project = (await store.records('projeto'))[0];
    const work = (await store.records('artefato'))[0];
    // Exactly what the real model did in the induced test: cite concrete record UUIDs.
    await tick(env, t0 + 400000, fixture([
      { type: 'ler_obra', id: work.id },
      { type: 'criar', id: work.id, title: 'Poema fixture', motivation: 'revisão', projectId: project.id, artifact: { format: 'texto', content: 'Segunda versão.' } },
      { type: 'projeto', id: project.id, title: 'Projeto fixture', steps: ['Produzir'], completed: [0], status: 'concluido', horizon: 'curto', evidence: [work.id] },
    ]));
    expect((await store.records('erro_ferramenta')).map((r) => r.data.code)).toEqual([]);
    const versions = await store.records('artefato');
    expect(new Set(versions.map((r) => r.entityId))).toEqual(new Set(['artefato:texto-ensaio']));
    expect(versions.at(-1)!.data).toMatchObject({ version: 2, projectId: 'projeto:ensaio' });
    const projects = await store.records('projeto');
    expect(new Set(projects.map((r) => r.entityId))).toEqual(new Set(['projeto:ensaio']));
    expect(projects.at(-1)!.data).toMatchObject({ status: 'concluido', version: 2 });
    expect((await store.records('leitura')).length).toBe(1);
  });
  it('retrieves an old memory buried under many newer ones through text and explicit links', async () => {
    const { store } = setup();
    const now = Date.now();
    const s = await seed(store, now);
    let token = (await store.acquire(now))!;
    const old = entry(s, 'memoria', 'Observei um cristal de quartzo violeta perto da estante.', { status: 'observacao' }, { category: 'episodica', importance: 0.4 });
    const linked = entry(s, 'memoria', 'Detalhe sem palavras em comum.', { status: 'observacao' }, { category: 'episodica', importance: 0.3, associations: [old.id] });
    await store.commit(token, s, [old, linked]);
    await store.release(token);
    for (let i = 0; i < 6; i++) {
      token = (await store.acquire(now))!;
      await store.commit(token, s, Array.from({ length: 60 }, (_, j) => entry(s, 'memoria', `Rotina recente ${i}-${j} de comer e dormir.`, {}, { category: 'episodica', importance: 0.5 })));
      await store.release(token);
    }
    const found = await store.memories('quartzo violeta', now + 3600000, 14);
    expect(found.map((r) => r.id)).toContain(old.id);
    expect(found.map((r) => r.id)).toContain(linked.id);
  });
});
describe('shared budget across environments (HTTP fixture, never real Gemini)', () => {
  it('local exhaustion never consumes global slots; global cap holds under concurrency', async () => {
    const shared = setup();
    const homolog = setup({ BUDGET_DB: shared.db, GEMINI_API_KEY: 'TEST-ONLY', FREE_TIER_CONFIRMED: 'true', LITE_DAILY_LIMIT: '2', LITE_GLOBAL_LIMIT: '5', ENVIRONMENT_ID: 'homologation' });
    const prod = setup({ BUDGET_DB: shared.db, GEMINI_API_KEY: 'TEST-ONLY', FREE_TIER_CONFIRMED: 'true', LITE_DAILY_LIMIT: '10', LITE_GLOBAL_LIMIT: '5', ENVIRONMENT_ID: 'production' });
    let network = 0;
    const fetcher = (async () => (network++, geminiReply())) as typeof fetch;
    const h = new GeminiProvider(homolog.env, homolog.store, fetcher);
    const p = new GeminiProvider(prod.env, prod.store, fetcher);
    const now = Date.now();
    for (let i = 0; i < 4; i++) await h.decide({ inbox: [] }, false, now + i * 61000).catch((e: CognitiveError) => e.code);
    const day = quotaDay(now);
    const globalCalls = () => shared.db.prepare('SELECT calls FROM budgets WHERE day=? AND model=?').bind(day, 'gemini-3.1-flash-lite').first<{ calls: number }>();
    expect((await globalCalls())!.calls).toBe(2);
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => p.decide({ inbox: [] }, false, now + 300000 + i * 61000)));
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(3);
    expect(results.filter((r) => r.status === 'rejected').map((r) => ((r as PromiseRejectedResult).reason as CognitiveError).code)).toEqual(['orcamento_global_suspenso', 'orcamento_global_suspenso', 'orcamento_global_suspenso']);
    expect((await globalCalls())!.calls).toBe(5);
    expect(network).toBe(5);
    const deniedLocal = await prod.db.prepare("SELECT COUNT(*) AS n FROM calls WHERE status='negada_global'").first<{ n: number }>();
    expect(deniedLocal!.n).toBe(3);
  });
  it('falls back to the principal model when the Flash budget is exhausted, recording why', async () => {
    const { env, store } = setup({ FLASH_DAILY_LIMIT: '1' });
    const t0 = Date.now();
    const s = await seed(store, t0);
    await store.db.prepare('INSERT INTO budgets(day,model,calls,tokens) VALUES(?,?,1,0)').bind(quotaDay(Date.now()), 'gemini-3-flash-preview').run();
    const token = (await store.acquire(t0))!;
    const current = (await store.state())!;
    current.complexNext = true;
    current.decisions = 3;
    await store.commit(token, current, []);
    await store.release(token);
    const seen = { complex: [] as boolean[] };
    await tick(env, t0 + 1000, fixture([], seen));
    expect(seen.complex).toEqual([false]);
    expect((await store.records('orcamento')).length).toBe(1);
    void s;
  });
});
describe('malformed actions (HTTP fixture reproducing a real production failure)', () => {
  it('runs the valid actions and records the malformed one instead of discarding the decision', async () => {
    const { env, store } = setup({ GEMINI_API_KEY: 'TEST-ONLY', FREE_TIER_CONFIRMED: 'true' });
    const t0 = Date.now();
    await seed(store, t0);
    const reply = { intention: 'Fixture HTTP', summary: 'Não é IA real.', nextMinutes: 5, complexNext: false, actions: [
      { type: 'atividade', activity: 'beber', minutes: 10 },
      { type: 'memoria', category: 'episodica', content: 'Sem evidência', confidence: 0.5, status: 'observacao', evidence: [] },
    ] };
    const fetcher = (async () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(reply) }] } }], usageMetadata: { totalTokenCount: 10 } })) as typeof fetch;
    const result = await tick(env, t0 + 1000, new GeminiProvider(env, store, fetcher));
    expect(result.status).toBe('decisao_registrada');
    expect((await store.state())!.activity.kind).toBe('beber');
    const rejected = (await store.records('erro_ferramenta'))[0];
    expect(rejected.data).toMatchObject({ tool: 'memoria', code: 'acao_malformada' });
    expect(JSON.stringify(rejected.data.detail)).toContain('evidence');
  });
});
describe('public observatory messages (fixture decisions)', () => {
  it('records visitor messages as visitor influence, distinct from the responsible observer', async () => {
    const { env, store } = setup();
    const t0 = Date.now();
    await seed(store, t0);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO inbox(id,content,at,author) VALUES('v1','Olá, sou visitante',?,'visitante')").bind(t0),
      env.DB.prepare("INSERT INTO inbox(id,content,at) VALUES('o1','Mensagem do responsável',?)").bind(t0),
    ]);
    await tick(env, t0 + 1000, fixture([]));
    const talks = await store.records('conversa');
    expect(talks.map((r) => [r.content, r.data.role, r.origin])).toEqual([
      ['Olá, sou visitante', 'visitante', 'visitante'],
      ['Mensagem do responsável', 'observador', 'observador'],
    ]);
  });
});
describe('birth nonce and experiment deadline (no real birth)', () => {
  it('accepts a birth challenge once, rejects reuse and expiry', async () => {
    const { env } = setup({ BIRTH_ENABLED: 'true' });
    await env.DB.prepare('INSERT INTO birth_challenges(id,expires) VALUES(?,?)').bind('11111111-1111-4111-8111-111111111111', Date.now() + 60000).run();
    await env.DB.prepare('INSERT INTO birth_challenges(id,expires) VALUES(?,?)').bind('22222222-2222-4222-8222-222222222222', Date.now() - 1).run();
    await expect(confirmedBirth(env, '11111111-1111-4111-8111-111111111111', 'errado')).rejects.toThrow('confirmacao_de_nascimento_necessaria');
    // First valid use consumes the nonce; birth itself then fails closed without Gemini config.
    await expect(confirmedBirth(env, '11111111-1111-4111-8111-111111111111', 'QUERO INICIAR ESTA EXISTENCIA')).rejects.toThrow('configuracao_pendente');
    await expect(confirmedBirth(env, '11111111-1111-4111-8111-111111111111', 'QUERO INICIAR ESTA EXISTENCIA')).rejects.toThrow('confirmacao_expirada_ou_utilizada');
    await expect(confirmedBirth(env, '22222222-2222-4222-8222-222222222222', 'QUERO INICIAR ESTA EXISTENCIA')).rejects.toThrow('confirmacao_expirada_ou_utilizada');
    expect(await new Store(env.DB).state()).toBeNull();
  });
  it('stops a homologation experiment automatically at its deadline or call ceiling', async () => {
    for (const reason of ['prazo_encerrado', 'orcamento_encerrado'] as const) {
      const { env, store } = setup({ ENVIRONMENT_ID: 'homologation' });
      const now = Date.now();
      await seed(store, now - 60000);
      const ends = reason === 'prazo_encerrado' ? now - 1 : now + 3600000;
      await env.DB.prepare("INSERT INTO experiment VALUES(1,?,?,?,'ativo','autonomo','fixture')").bind(now - 7200000, ends, 2).run();
      if (reason === 'orcamento_encerrado')
        await env.DB.batch([0, 1].map((i) => env.DB.prepare("INSERT INTO calls(id,day,model,at,reserved_tokens,status) VALUES(?,?,?,?,1,'sucesso')").bind('x' + i, quotaDay(now), 'gemini-3.1-flash-lite', now - 1000)));
      expect((await runCycle(env)).status).toBe('experimento_encerrado');
      expect((await store.state())!.paused).toBe(true);
      expect((await env.DB.prepare('SELECT status FROM experiment').first<{ status: string }>())!.status).toBe(reason);
    }
  });
  it('a production environment never runs controlled clocks or experiments', async () => {
    const { env, store } = setup({ ENVIRONMENT_ID: 'production' });
    await seed(store);
    await expect(runCycle(env, { acceleratedMinutes: 30 })).rejects.toThrow('relogio_controlado_nao_autorizado');
  });
});
