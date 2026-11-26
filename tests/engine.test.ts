import { afterEach, describe, expect, it } from 'vitest';
import {
  born,
  decisionSchema,
  initialObjects,
  pathfind,
  quotaDay,
  reconcile,
  validLayout,
  type Decision,
  artifactSchema,
} from '../shared/domain';
import { Store, entry } from '../worker/store';
import { birth, tick, packContext } from '../worker/engine';
import {
  CognitiveError,
  GeminiProvider,
  type Env,
  type CognitionProvider,
} from '../worker/provider';
import { exportBackup, exportManifest, exportPage, restoreBackup } from '../worker/backup';
import { research } from '../worker/research';
import { database } from './database';
const opened: ReturnType<typeof database>[] = [];
function setup() {
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
  } as Env;
  return { ...d, env, store: new Store(d.db) };
}
afterEach(() => {
  opened.splice(0).forEach((d) => d.sqlite.close());
});
async function seed(store: Store, now = Date.now()) {
  const s = born(now);
  const token = await store.acquire(now);
  const record = entry(s, 'nascimento', 'Nascimento de criatura DESCARTÁVEL de teste.', {
    fixture: true,
  });
  await store.commit(token!, s, [record], [], true);
  await store.release(token!);
  return { s, record };
}
function fixture(
  actions: Decision['actions'] = [],
  intention = 'Intenção FIXTURE de teste',
): CognitionProvider {
  return {
    async decide() {
      return {
        model: 'fixture-explicita-sem-ia',
        decision: decisionSchema.parse({
          intention,
          summary: 'Resposta programada de teste; não é emergência nem chamada real.',
          nextMinutes: 5,
          complexNext: false,
          actions,
        }),
      };
    },
  };
}
describe('continuity and persistence', () => {
  it('never births without credentials and cannot rebirth an existing identity', async () => {
    const { env, store } = setup();
    await expect(birth(env)).rejects.toThrow('configuracao_pendente');
    expect(await store.state()).toBeNull();
    const { s } = await seed(store);
    expect((await birth(env)).bornAt).toBe(s.bornAt);
    expect((await store.records('nascimento')).length).toBe(1);
  });
  it('fences expired leases and rolls back the complete batch', async () => {
    const { store } = setup();
    await seed(store);
    const s = (await store.state())!;
    const old = await store.acquire(Date.now());
    await store.db.prepare('UPDATE lease SET expires=0').run();
    const current = await store.acquire(Date.now());
    await expect(
      store.commit(old!, s, [entry(s, 'diario', 'must never appear')]),
    ).rejects.toThrow();
    expect(s.revision).toBe(1);
    expect((await store.records('diario')).length).toBe(0);
    expect((await store.state())!.revision).toBe(1);
    await store.release(current!);
  });
  it('skips concurrent and repeated ticks; persists after binding recreation', async () => {
    const { env, store, db } = setup();
    await seed(store);
    const lease = await store.acquire(Date.now());
    expect((await tick(env, Date.now(), fixture())).status).toBe('ocupado');
    await store.release(lease!);
    const now = Date.now();
    await tick(
      env,
      now,
      fixture([{ type: 'diario', content: 'Real artifact in a fixture scenario.' }]),
    );
    expect((await new Store(db).state())!.decisions).toBe(1);
    await tick(env, now + 60000, fixture());
    expect((await store.state())!.decisions).toBe(1);
    expect((await store.records('diario'))[0].content).toContain('fixture');
  });
  it('records interrupted time without fictional retrospective decisions', async () => {
    const { env, store } = setup();
    const now = Date.now();
    await seed(store, now);
    await tick(env, now + 86400000, fixture());
    expect((await store.state())!.decisions).toBe(1);
    expect((await store.state())!.virtualMinutes).toBe(8640);
    expect((await store.records('interrupcao')).length).toBe(1);
  });
  it('runs 72 distinct fixture cycles spanning 35.5 virtual hours with no real AI claim', async () => {
    const { env, store } = setup();
    const start = Date.now();
    await seed(store, start);
    for (let i = 0; i < 72; i++)
      await tick(
        env,
        start + i * 300000,
        fixture([
          {
            type: 'atividade',
            activity: ['comer', 'beber', 'dormir', 'higiene', 'descansar', 'observar'][
              i % 6
            ] as 'comer',
            minutes: 60,
          },
        ]),
      );
    const s = (await store.state())!;
    expect(s.decisions).toBe(72);
    expect(s.virtualMinutes).toBe(2130);
    expect(Object.values(s.needs).every((n) => n >= 0 && n <= 100)).toBe(true);
    expect(
      (await store.db
        .prepare("SELECT COUNT(*) AS n FROM records WHERE kind='memoria' AND category='episodica'")
        .first<{ n: number }>())!.n,
    ).toBe(72);
  });
});
describe('evidence, tools, and autonomy contracts', () => {
  it('chooses a fixture name once and rejects a second name without erasing history', async () => {
    const { env, store } = setup();
    const now = Date.now();
    const { record } = await seed(store, now);
    await tick(
      env,
      now,
      fixture([
        { type: 'identidade', field: 'nome', value: 'Nome de teste', evidence: [record.id] },
      ]),
    );
    await tick(
      env,
      now + 3600000,
      fixture([{ type: 'identidade', field: 'nome', value: 'Outro', evidence: [record.id] }]),
    );
    expect((await store.state())!.identity.name).toBe('Nome de teste');
    expect((await store.records('erro_ferramenta')).length).toBe(1);
  });
  it('rejects fabricated evidence and project completion without output', async () => {
    const { env, store } = setup();
    const now = Date.now();
    const { record } = await seed(store, now);
    await tick(
      env,
      now,
      fixture([
        {
          type: 'interesse',
          id: 'x',
          topic: 'Tema de fixture',
          change: 0.1,
          status: 'ativo',
          evidence: ['inventado'],
        },
        {
          type: 'projeto',
          id: 'p',
          title: 'P',
          steps: ['Uma etapa'],
          completed: [0],
          status: 'concluido',
          horizon: 'curto',
          evidence: [record.id],
        },
      ]),
    );
    expect((await store.records('interesse')).length).toBe(0);
    expect((await store.records('projeto')).length).toBe(0);
    expect((await store.records('erro_ferramenta')).length).toBe(2);
  });
  it('creates and revises actual artifacts and completes an evidenced project', async () => {
    const { env, store } = setup();
    const now = Date.now();
    const { record } = await seed(store, now);
    await tick(
      env,
      now,
      fixture([
        {
          type: 'projeto',
          id: 'p',
          title: 'Caderno de fixture',
          steps: ['Escrever'],
          completed: [],
          status: 'ativo',
          horizon: 'curto',
          evidence: [record.id],
        },
      ]),
    );
    await tick(
      env,
      now + 300000,
      fixture([
        {
          type: 'criar',
          id: 'obra',
          title: 'Texto',
          motivation: 'Teste',
          projectId: 'p',
          artifact: { format: 'texto', content: 'Este texto é um artefato persistido de teste.' },
        },
      ]),
    );
    const art = (await store.latest('artefato'))[0];
    await tick(
      env,
      now + 600000,
      fixture([
        {
          type: 'projeto',
          id: 'p',
          title: 'Caderno de fixture',
          steps: ['Escrever'],
          completed: [0],
          status: 'concluido',
          horizon: 'curto',
          evidence: [art.id],
        },
      ]),
    );
    expect((await store.entity('projeto:p'))!.data.status).toBe('concluido');
    await tick(
      env,
      now + 900000,
      fixture([
        {
          type: 'criar',
          id: 'obra',
          title: 'Texto revisto',
          motivation: 'Revisão',
          projectId: 'p',
          artifact: { format: 'texto', content: 'Segunda versão.' },
        },
      ]),
    );
    expect((await store.records('artefato')).length).toBe(2);
    expect((await store.entity('artefato:obra'))!.data.version).toBe(2);
  });
  it('performs fixture HTTP research, records actual returned sources, rejects arbitrary tools', async () => {
    const { env, store } = setup();
    const now = Date.now();
    await seed(store, now);
    let requested = '';
    const fetcher = (async (url: unknown) => {
      requested = String(url);
      return Response.json({
        query: {
          pages: {
            '1': {
              pageid: 1,
              title: 'Dados de teste',
              extract: 'Conteúdo EXTERNO FIXTURE, não pesquisa real.',
            },
          },
        },
      });
    }) as typeof fetch;
    await tick(
      env,
      now,
      fixture([{ type: 'pesquisar', source: 'wikipedia', query: 'consulta de fixture' }]),
      fetcher,
    );
    expect(requested.startsWith('https://pt.wikipedia.org/w/api.php?')).toBe(true);
    const record = (await store.records('pesquisa'))[0];
    expect(record.data.cached).toBe(false);
    expect((record.data.results as { url: string }[])[0].url).toBe(
      'https://pt.wikipedia.org/?curid=1',
    );
    expect((await store.records('conceito')).length).toBe(1);
    expect(() =>
      decisionSchema.parse({
        intention: 'x',
        summary: 'x',
        nextMinutes: 5,
        complexNext: false,
        actions: [{ type: 'shell', command: 'x' }],
      }),
    ).toThrow();
  });
  it('rejects layout collisions and stores a real valid rearrangement', async () => {
    const { env, store } = setup();
    const now = Date.now();
    await seed(store, now);
    await tick(
      env,
      now,
      fixture([
        { type: 'mover', objectId: 'cama', x: 8, y: 1 },
        { type: 'mover', objectId: 'planta', x: 10, y: 2 },
      ]),
    );
    expect((await store.records('erro_ferramenta')).length).toBe(1);
    expect((await store.state())!.objects.find((o) => o.id === 'planta')?.y).toBe(2);
    expect((await store.records('habitat')).length).toBe(1);
  });
  it('recovers old relevant memory and preserves source during consolidation', async () => {
    const { env, store } = setup();
    const now = Date.now();
    await seed(store, now);
    const s = (await store.state())!;
    const old = entry(
      s,
      'memoria',
      'Registro antigo sobre ametistas e cristais.',
      {},
      { realAt: now - 365 * 86400000, importance: 0.9 },
    );
    await store.insert(old).run();
    expect((await store.memories('ametistas', now))[0].id).toBe(old.id);
    await tick(
      env,
      now,
      fixture([
        {
          type: 'memoria',
          category: 'autobiografica',
          content: 'Recordo meu contato com cristais nesta fixture.',
          confidence: 0.9,
          status: 'opiniao',
          evidence: [old.id],
        },
      ]),
    );
    expect((await store.records('memoria')).some((r) => r.id === old.id)).toBe(true);
    expect((await store.records('memoria')).some((r) => r.category === 'autobiografica')).toBe(
      true,
    );
    expect(
      (await store.db
        .prepare('SELECT count FROM retrievals WHERE memory_id=?')
        .bind(old.id)
        .first<{ count: number }>())!.count,
    ).toBe(1);
  });
  it('messages are consumed once and can be declined by choosing another activity', async () => {
    const { env, store } = setup();
    const now = Date.now();
    await seed(store, now);
    await store.db
      .prepare('INSERT INTO inbox(id,content,at,consumed) VALUES(?,?,?,0)')
      .bind('msg', 'Mensagem fixture', now)
      .run();
    await tick(env, now, fixture([{ type: 'atividade', activity: 'descansar', minutes: 60 }]));
    await tick(env, now + 300000, fixture());
    expect((await store.records('conversa')).length).toBe(1);
    expect((await store.inbox()).length).toBe(0);
  });
});
describe('budgets, failures, backup, isolation', () => {
  it('reserves daily and rolling minute quotas atomically including failures', async () => {
    const { store } = setup();
    const now = Date.now();
    const first = await store.reserve('m', 'day', now, 2, 1, 1000);
    expect(first).toBeTruthy();
    expect(await store.reserve('m', 'day', now + 1000, 2, 1, 1000)).toBeNull();
    expect(await store.reserve('m', 'day', now + 61000, 2, 1, 1000)).toBeTruthy();
    expect(await store.reserve('m', 'day', now + 122000, 2, 1, 1000)).toBeNull();
    expect((await store.usage())[0].calls).toBe(2);
    expect(await store.reserve('m', 'next', now + 183000, 2, 1, 200001)).toBeNull();
  });
  it('blocks unconfirmed free tier and backs off HTTP429 without retry storms', async () => {
    const { env, store } = setup();
    let count = 0;
    const fetcher = (async () => {
      count++;
      return new Response('', { status: 429, headers: { 'retry-after': '600' } });
    }) as typeof fetch;
    const provider = new GeminiProvider(env, store, fetcher);
    await expect(provider.decide({}, false, Date.now())).rejects.toThrow('configuracao_pendente');
    expect(count).toBe(0);
    env.FREE_TIER_CONFIRMED = 'true';
    env.GEMINI_API_KEY = 'EXPLICIT-TEST-FIXTURE-NEVER-A-REAL-KEY';
    await expect(provider.decide({}, false, Date.now())).rejects.toThrow('gemini_http_429');
    expect(count).toBe(1);
    expect((await store.usage())[0].calls).toBe(1);
  });
  it('keeps identity on failed inference and bounds retry scheduling', async () => {
    const { env, store } = setup();
    const now = Date.now();
    await seed(store, now);
    await tick(env, now, {
      async decide() {
        throw new CognitiveError('gemini_http_503');
      },
    });
    const s = (await store.state())!;
    expect(s.decisions).toBe(0);
    expect(s.failures).toBe(1);
    expect(s.nextDecisionAt).toBeGreaterThan(now);
    expect((await store.records('erro')).length).toBe(1);
  });
  it('exports and restores identity, historical records and quotas into empty storage only', async () => {
    const { env, store } = setup();
    const now = Date.now();
    await seed(store, now);
    await tick(env, now, fixture([{ type: 'diario', content: 'Texto de backup.' }]));
    await store.reserve('m', 'd', now, 10, 10, 100);
    const backup = await (await exportBackup(env)).json();
    const other = setup();
    await restoreBackup(other.env, backup);
    expect((await other.store.state())!.bornAt).toBe((await store.state())!.bornAt);
    expect((await other.store.records('diario'))[0].content).toBe('Texto de backup.');
    expect((await other.store.usage())[0].calls).toBe(1);
    await expect(restoreBackup(other.env, backup)).rejects.toThrow('restauracao_exige_banco_vazio');
  });
  it('isolates all external requests to fixed origins even for URL-like prompts', async () => {
    let url = '';
    await research('wikidata', 'http://127.0.0.1/secrets', Date.now(), (async (input: unknown) => {
      url = String(input);
      return Response.json({ search: [] });
    }) as typeof fetch);
    expect(new URL(url).hostname).toBe('www.wikidata.org');
  });
});
describe('deterministic time and geometry', () => {
  it('freezes paused time and never allows permanent death', () => {
    const s = born(0);
    s.paused = true;
    expect(reconcile(s, 86400000).state.virtualMinutes).toBe(0);
    s.paused = false;
    for (let i = 0; i < 200; i++) Object.assign(s, reconcile(s, (i + 1) * 86400000).state);
    expect(s.needs.saude).toBeGreaterThanOrEqual(10);
    expect(s.needs.energia).toBeGreaterThanOrEqual(0);
  });
  it('uses Pacific calendar correctly across DST and day boundaries', () => {
    expect(quotaDay(Date.parse('2026-07-01T06:59:00Z'))).toBe('2026-06-30');
    expect(quotaDay(Date.parse('2026-07-01T07:00:00Z'))).toBe('2026-07-01');
    expect(quotaDay(Date.parse('2026-12-01T07:59:00Z'))).toBe('2026-11-30');
  });
  it('finds collision-free paths and all functional furniture is accessible', () => {
    expect(validLayout(initialObjects, { x: 5, y: 5 })).toBe(true);
    const path = pathfind({ x: 5, y: 5 }, { x: 0, y: 0 }, initialObjects);
    expect(path.length).toBeGreaterThan(1);
    expect(path.every((p) => !initialObjects.some((o) => o.x === p.x && o.y === p.y))).toBe(true);
  });
});

describe('extended contracts', () => {
  it('reads the actual old artifact before revision and can direct memory retrieval', async () => {
    const { env, store } = setup();
    const now = Date.now();
    await seed(store, now);
    await tick(
      env,
      now,
      fixture([
        {
          type: 'criar',
          id: 'old',
          title: 'Obra antiga fixture',
          motivation: 'Teste',
          projectId: null,
          artifact: { format: 'texto', content: 'CONTEUDO PERSISTIDO DE VERDADE, EM FIXTURE.' },
        },
      ]),
    );
    await tick(
      env,
      now + 300000,
      fixture([
        { type: 'ler_obra', id: 'old' },
        { type: 'recordar', query: 'Obra antiga fixture' },
      ]),
    );
    let context: unknown;
    await tick(env, now + 600000, {
      async decide(input) {
        context = input;
        return fixture().decide(input, false, now);
      },
    });
    expect(JSON.stringify(context)).toContain('CONTEUDO PERSISTIDO DE VERDADE');
    expect(await store.records('leitura')).toHaveLength(2);
  });
  it('bounds context without deleting persisted records', () => {
    const source = {
      identity: { name: null },
      memories: Array.from({ length: 30 }, (_, i) => ({ id: i, content: 'á'.repeat(1600) })),
      inbox: [{ content: 'Preservar mensagem' }],
    };
    const packed = packContext(source);
    expect(new TextEncoder().encode(JSON.stringify(packed)).length).toBeLessThan(48000);
    expect(source.memories).toHaveLength(30);
    expect((packed.memories as unknown[]).length).toBeGreaterThan(0);
  });
  it('exports bounded pages and refuses changed snapshot revisions', async () => {
    const { env, store } = setup();
    await seed(store);
    const s = (await store.state())!;
    s.paused = true;
    const token = await store.acquire(Date.now());
    await store.commit(token!, s, []);
    await store.release(token!);
    const manifest = await exportManifest(env);
    const page = await exportPage(env, 'records', 0, Number(manifest.upper.records), s.revision);
    expect(page.rows).toHaveLength(1);
    await expect(exportPage(env, 'lease', 0, 10, s.revision)).rejects.toThrow('tabela_invalida');
    await expect(exportPage(env, 'records', 0, 100, s.revision + 1)).rejects.toThrow(
      'estado_alterado_reinicie_exportacao',
    );
  });
  it('suspends at storage guard without erasing old identity or history', async () => {
    const { env, store } = setup();
    await seed(store);
    await store.db.prepare('UPDATE storage_meter SET bytes=179000001').run();
    expect((await tick(env, Date.now(), fixture())).status).toBe('armazenamento_suspenso');
    expect(await store.records('nascimento')).toHaveLength(1);
    expect((await store.state())!.decisions).toBe(0);
  });
  it('rejects oversized tool lists and response streams', async () => {
    expect(() =>
      decisionSchema.parse({
        intention: 'x',
        summary: 'x',
        nextMinutes: 5,
        complexNext: false,
        actions: Array.from({ length: 4 }, () => ({ type: 'diario', content: 'x' })),
      }),
    ).toThrow();
    const { boundedJson } = await import('../worker/provider');
    await expect(boundedJson(new Response('x'.repeat(100)), 50)).rejects.toThrow(
      'resposta_excessiva',
    );
  });
  it('persists all supported creative formats and rejects the retired pixel grid', async () => {
    const { env, store } = setup();
    const now = Date.now();
    await seed(store, now);
    await tick(
      env,
      now,
      fixture([
        {
          type: 'criar',
          id: 'pintura',
          title: 'Pintura fixture',
          motivation: 'Teste',
          projectId: null,
          artifact: {
            format: 'pintura',
            width: 64,
            height: 64,
            background: '#123456',
            strokes: [{ tool: 'elipse', color: '#abcdef', fill: true, cx: 32, cy: 32, rx: 10, ry: 10 }],
          },
        },
        {
          type: 'criar',
          id: 'musica',
          title: 'Notas fixture',
          motivation: 'Teste',
          projectId: null,
          artifact: { format: 'musica', tempo: 90, notes: [{ pitch: 60, beats: 1 }] },
        },
        {
          type: 'criar',
          id: 'objeto',
          title: 'Objeto fixture',
          motivation: 'Teste',
          projectId: null,
          artifact: { format: 'objeto', color: '#abcdef', shape: 'vaso' },
        },
      ]),
    );
    expect(await store.records('artefato')).toHaveLength(3);
    // The retired pixel grid is no longer part of the creation contract (old works stay valid).
    const pixels = { type: 'criar', id: 'bad', title: 'Erro', motivation: 'Teste', projectId: null, artifact: { format: 'pixels', palette: ['#123456'], pixels: [[0]] } };
    expect(decisionSchema.safeParse({ intention: 'x', summary: 'x', nextMinutes: 5, complexNext: false, actions: [pixels] }).success).toBe(false);
    expect(artifactSchema.safeParse(pixels.artifact).success).toBe(true);
  });
  it('uses actual provider JSON contract and reserves a single call without leaking secrets', async () => {
    const { env, store } = setup();
    env.GEMINI_API_KEY = 'EXPLICIT-TEST-ONLY-KEY';
    env.FREE_TIER_CONFIRMED = 'true';
    let calls = 0;
    const provider = new GeminiProvider(env, store, (async (
      _url: unknown,
      options?: RequestInit,
    ) => {
      calls++;
      const payload = JSON.parse(String(options?.body));
      expect(payload.generationConfig.responseJsonSchema).toHaveProperty('properties');
      expect(JSON.stringify(payload)).not.toContain('EXPLICIT-TEST-ONLY-KEY');
      return Response.json({
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    intention: 'Contrato fixture',
                    summary: 'Não é cognição real.',
                    nextMinutes: 5,
                    complexNext: false,
                    actions: [],
                  }),
                },
              ],
            },
          },
        ],
        usageMetadata: { totalTokenCount: 100 },
      });
    }) as typeof fetch);
    const result = await provider.decide({ inbox: [] }, false, Date.now());
    expect(result.decision.intention).toBe('Contrato fixture');
    expect(calls).toBe(1);
    expect((await store.usage())[0].tokens).toBe(100);
  });
  it('consolidates during rest and checkpoints after 24 real fixture cycles', async () => {
    const { env, store } = setup();
    const now = Date.now();
    await seed(store, now);
    for (let i = 0; i < 24; i++)
      await tick(
        env,
        now + i * 3600000,
        fixture([{ type: 'atividade', activity: 'dormir', minutes: 120 }]),
      );
    expect(await store.records('checkpoint')).toHaveLength(1);
    const memories = await store.records('memoria', 0, 200);
    expect(
      memories.some(
        (r) => r.category === 'autobiografica' && r.origin === 'consolidacao_deterministica',
      ),
    ).toBe(true);
    expect((await store.state())!.decisions).toBe(24);
  });
});
