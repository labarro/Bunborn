import { afterEach, describe, expect, it } from 'vitest';
import { born, parseDecision, reconcile, type Decision } from '../shared/domain';
import { Store, entry } from '../worker/store';
import { bodyAlerts, retryDelay, tick } from '../worker/engine';
import { CognitiveError, type CognitionProvider, type Env } from '../worker/provider';
import { database } from './database';

// Disposable, isolated databases only; decisions come from fixtures, never from a real model.
const opened: ReturnType<typeof database>[] = [];
afterEach(() => opened.splice(0).forEach((d) => d.sqlite.close()));
function setup() {
  const d = database();
  opened.push(d);
  const db = d.db;
  const env = { DB: db, ENVIRONMENT_ID: 'tool-tests', MIN_DECISION_MINUTES: '0', MODEL_LITE: 'gemini-3.1-flash-lite', MODEL_FLASH: 'gemini-3-flash-preview', LITE_DAILY_LIMIT: '400', FLASH_DAILY_LIMIT: '12' } as unknown as Env;
  return { env, store: new Store(db) };
}
async function seed(store: Store, mutate: (s: ReturnType<typeof born>) => void, now = Date.now()) {
  const s = born(now);
  mutate(s);
  const token = await store.acquire(now);
  await store.commit(token!, s, [entry(s, 'nascimento', 'Nascimento DESCARTÁVEL de teste.', { fixture: true }, { importance: 1 })], [], true);
  await store.release(token!);
  return s;
}
const fixture = (actions: Decision['actions']): CognitionProvider => ({
  async decide() {
    return { decision: { intention: 'Fixture', summary: 'Decisão de teste; não é IA.', nextMinutes: 5, complexNext: false, actions }, model: 'gemini-3.1-flash-lite' };
  },
});
const hour = 3600000 / 6; // one virtual hour at multiplier 6

describe('physiology (deterministic body rules)', () => {
  it('needs rise while awake and eating, drinking and sleeping really restore them', () => {
    let s = born(0);
    s = reconcile(s, 8 * hour).state;
    expect(s.needs.fome).toBeGreaterThan(50);
    expect(s.needs.sede).toBeGreaterThan(60);
    const hungry = s.needs.fome;
    s.activity = { kind: 'comer', until: s.virtualMinutes + 20, target: 'comida', intention: 't' };
    s = reconcile(s, s.updatedAt + (20 / 60) * hour).state;
    expect(hungry).toBeGreaterThan(50);
    expect(s.needs.fome).toBeLessThan(5);
    s.needs.sono = 90;
    s.activity = { kind: 'dormir', until: s.virtualMinutes + 360, target: 'cama', intention: 't' };
    s = reconcile(s, s.updatedAt + 6 * hour).state;
    expect(s.needs.sono).toBeLessThan(10);
  });
  it('neglect costs health and energy, but the creature never dies', () => {
    let s = born(0);
    s.needs = { ...s.needs, fome: 95, sede: 95 };
    const before = { saude: s.needs.saude, energia: s.needs.energia };
    s = reconcile(s, 2 * hour).state;
    expect(s.needs.saude).toBeLessThan(before.saude - 10);
    expect(s.needs.energia).toBeLessThan(before.energia - 10);
    for (let i = 0; i < 100; i++) s = reconcile(s, s.updatedAt + 12 * hour).state;
    expect(s.needs.saude).toBeGreaterThanOrEqual(10);
  });
  it('exhaustion makes the body fall asleep on its own, as physiology, and alerts are plain facts', () => {
    let s = born(0);
    s.needs.sono = 99;
    const result = reconcile(s, hour);
    s = result.state;
    expect(result.events).toEqual(['adormeceu_exausta']);
    expect(s.activity).toMatchObject({ kind: 'dormir', involuntary: true });
    expect(bodyAlerts(s)).toContain('dormindo por exaustão');
  });
  it('records involuntary sleep and blocks demanding work while the body has no conditions', async () => {
    const { env, store } = setup();
    const t0 = Date.now();
    await seed(store, (s) => { s.needs.sono = 99.9; s.needs.energia = 50; }, t0);
    await tick(env, t0 + 60000, fixture([{ type: 'pesquisar', source: 'wikipedia', query: 'coelhos' }, { type: 'interromper', reason: 'quero acordar' }]));
    expect((await store.records('corpo')).length).toBe(1);
    const errors = (await store.records('erro_ferramenta')).map((r) => r.data.code);
    expect(errors).toEqual(expect.arrayContaining(['corpo_sem_condicoes', 'sono_involuntario']));
    expect((await store.state())!.activity.kind).toBe('dormir');
  });
});

describe('recovery from provider failures', () => {
  it('transient overload retries within 20 minutes instead of growing to hours', () => {
    const delays = [1, 2, 3, 4, 5, 6, 7].map((f) => retryDelay('gemini_http_503', 300000, f) / 60000);
    expect(delays).toEqual([5, 10, 20, 20, 20, 20, 20]);
    expect(retryDelay('gemini_fetch_timeouterror', 300000, 7)).toBe(1200000);
    expect(retryDelay('orcamento_suspenso', 3600000, 1)).toBe(3600000);
  });
  it('a 503 streak no longer leaves the creature still for hours', async () => {
    const { env, store } = setup();
    const t0 = Date.now();
    await seed(store, (s) => { s.failures = 6; }, t0);
    const failing: CognitionProvider = { async decide() { throw new CognitiveError('gemini_http_503', 300000); } };
    await tick(env, t0 + 1000, failing);
    const state = (await store.state())!;
    expect(state.nextDecisionAt - (t0 + 1000)).toBeLessThanOrEqual(1200000);
  });
});

describe('formal tolerance of model replies (no invented content)', () => {
  const base = { summary: 'ok', nextMinutes: 10, complexNext: false };
  it('trims an over-long intention instead of discarding the decision (real failure 25/11 01:19Z)', () => {
    const { decision } = parseDecision({ ...base, intention: 'x'.repeat(300), actions: [] });
    expect(decision.intention).toHaveLength(160);
  });
  it('reads an activity written as its own type, and still rejects truly malformed actions', () => {
    const { decision, invalidActions } = parseDecision({ ...base, intention: 'i', actions: [{ type: 'observar' }, { type: 'dormir', minutes: 300 }, { type: 'voar' }] });
    expect(decision.actions).toEqual([
      { type: 'atividade', activity: 'observar', minutes: 30 },
      { type: 'atividade', activity: 'dormir', minutes: 300 },
    ]);
    expect(invalidActions.map((a) => a.type)).toEqual(['voar']);
  });
});

describe('clearer rejections', () => {
  it('re-registering the current name is explained as already registered', async () => {
    const { env, store } = setup();
    const t0 = Date.now();
    await seed(store, (s) => { s.identity.name = 'Teste'; s.identity.traits.nome = { value: 'Teste', evidence: ['x'], version: 1 }; }, t0);
    const nascimento = (await store.records('nascimento'))[0];
    await tick(env, t0 + 1000, fixture([{ type: 'identidade', field: 'nome', value: 'Teste', evidence: [nascimento.id] }]));
    const error = (await store.records('erro_ferramenta'))[0];
    expect(error.data).toMatchObject({ code: 'ja_registrado', detail: { field: 'nome', value: 'Teste' } });
  });
});

describe('sleepiness and energy are coupled', () => {
  it('a very sleepy body cannot have high energy', () => {
    let s = born(0);
    s.needs = { ...s.needs, sono: 96, energia: 80 };
    s = reconcile(s, 60000).state;
    expect(s.needs.energia).toBeLessThanOrEqual(30);
  });
});

describe('tools are usable while doing something passive', () => {
  it('searching while observing replaces the observation (recorded) and returns real-shaped results', async () => {
    const { env, store } = setup();
    const t0 = Date.now();
    await seed(store, (s) => { s.activity = { kind: 'observar', until: s.virtualMinutes + 120, target: 'descanso', intention: 'olhar' }; }, t0);
    const fetcher = (async (input: unknown) => {
      expect(new URL(String(input)).hostname).toBe('openlibrary.org');
      return Response.json({ docs: [{ key: '/works/OL1W', title: 'Watership Down', author_name: ['Richard Adams'], first_publish_year: 1972 }] });
    }) as typeof fetch;
    const reply: CognitionProvider = { async decide() { return { decision: { intention: 'Fixture', summary: 'teste', nextMinutes: 5, complexNext: false, actions: [{ type: 'pesquisar', source: 'openlibrary', query: 'coelhos' }] }, model: 'gemini-3.1-flash-lite' }; } };
    await tick(env, t0 + 1000, reply, fetcher);
    expect((await store.state())!.activity.kind).toBe('pesquisar');
    expect((await store.records('atividade_interrompida'))[0].data).toMatchObject({ replacedBy: 'pesquisar', automatic: true });
    const found = (await store.records('pesquisa'))[0].data.results as { url: string; excerpt: string }[];
    expect(found[0].url).toBe('https://openlibrary.org/works/OL1W');
    expect(found[0].excerpt).toContain('Richard Adams');
  });
  it('parses arXiv entries from a fixed origin', async () => {
    const { research } = await import('../worker/research');
    const xml = '<feed><entry><id>http://arxiv.org/abs/2401.00001v1</id><title>Artificial Life\n Models</title><summary>  A study &amp; more. </summary></entry></feed>';
    const results = await research('arxiv', 'life', 1, (async (input: unknown) => {
      expect(new URL(String(input)).hostname).toBe('export.arxiv.org');
      return new Response(xml, { status: 200 });
    }) as typeof fetch);
    expect(results).toEqual([{ title: 'Artificial Life Models', url: 'https://arxiv.org/abs/2401.00001v1', excerpt: 'A study & more.', accessedAt: 1, source: 'arxiv' }]);
  });
});

describe('review 25/11: idleness, motives and backup compatibility', () => {
  it('a state with involuntary sleep and decision timestamp still passes the strict backup schema', async () => {
    const { stateSchema } = await import('../shared/validation');
    let s = born(0);
    s.needs.sono = 100;
    s = reconcile(s, 60000).state;
    s.lastCompleted = { ...s.activity };
    s.lastDecisionAt = 123;
    expect(stateSchema.safeParse(s).success).toBe(true);
  });
  it('decides again soon after the activity ends instead of waiting the whole chosen interval', async () => {
    const { env, store } = setup();
    const t0 = Date.now();
    await seed(store, () => {}, t0);
    const calls: number[] = [];
    const provider: CognitionProvider = { async decide() { calls.push(1); return { decision: { intention: 'Fixture', summary: 'teste', nextMinutes: 60, complexNext: false, actions: [{ type: 'atividade', activity: 'beber', minutes: 15 }] }, model: 'gemini-3.1-flash-lite' }; } };
    await tick(env, t0, provider);
    expect(calls.length).toBe(1);
    // beber 15 virtual min = 2.5 real min; pacing floor in tool-tests is 0 here
    await tick(env, t0 + 3 * 60000, provider);
    expect(calls.length).toBe(2);
  });
  it('boredom grows while idle and falls with engaging work; frustration fades', () => {
    let s = born(0);
    s.motives = { ...s.motives, tedio: 20, frustracao: 40 };
    s.activity.until = 0;
    s = reconcile(s, 4 * hour).state;
    expect(s.motives.tedio).toBeGreaterThan(30);
    expect(s.motives.frustracao).toBeLessThan(30);
    s.activity = { kind: 'pesquisar', until: s.virtualMinutes + 120, target: 'terminal', intention: 't' };
    const before = s.motives.tedio;
    s = reconcile(s, s.updatedAt + 2 * hour).state;
    expect(s.motives.tedio).toBeLessThan(before - 15);
  });
});

describe('waking up (review 25/11 05:15Z)', () => {
  it('wakes by itself when rested even if a longer sleep was chosen, and then decides again', async () => {
    let s = born(0);
    s.needs = { ...s.needs, sono: 30, fome: 20, sede: 20 };
    s.activity = { kind: 'dormir', until: s.virtualMinutes + 600, target: 'cama', intention: 't' };
    const r = reconcile(s, 3 * hour);
    expect(r.events).toEqual(['acordou_descansada']);
    expect(r.state.activity.until).toBeLessThanOrEqual(r.state.virtualMinutes);
    expect(r.completed.map((a) => a.kind)).toContain('dormir');
  });
  it('hunger or thirst wakes it once sleep pressure is no longer high', () => {
    let s = born(0);
    s.needs = { ...s.needs, sono: 45, fome: 100, sede: 100 };
    s.activity = { kind: 'dormir', until: s.virtualMinutes + 600, target: 'cama', intention: 't' };
    expect(reconcile(s, hour).events).toEqual(['acordou_com_fome_ou_sede']);
  });
  it('cannot fall asleep without sleep pressure', async () => {
    const { env, store } = setup();
    const t0 = Date.now();
    await seed(store, (s) => { s.needs.sono = 5; s.activity.until = 0; }, t0);
    await tick(env, t0 + 1000, fixture([{ type: 'atividade', activity: 'dormir', minutes: 360 }]));
    expect((await store.records('erro_ferramenta'))[0].data).toMatchObject({ code: 'sem_sono' });
    expect((await store.state())!.activity.kind).not.toBe('dormir');
  });
});

describe('sense from experience (review 25/11 05:40Z)', () => {
  it('eating stops when sated and the queued drink starts at once instead of waiting', () => {
    let s = born(0);
    s.needs = { ...s.needs, fome: 30, sede: 80 };
    s.activity = { kind: 'comer', until: s.virtualMinutes + 60, target: 'comida', intention: 't' };
    s.queue = [{ kind: 'beber', until: s.virtualMinutes + 90, target: 'comida', intention: 't' }];
    s = reconcile(s, (12 / 60) * hour).state; // 12 virtual minutes: fome 30 - 60 → 0
    expect(s.activity.kind).toBe('beber');
    expect(s.activity.until).toBeLessThanOrEqual(s.virtualMinutes + 31);
  });
  it('the body refuses to eat without hunger, and a chosen drink replaces a passive observation', async () => {
    const { env, store } = setup();
    const t0 = Date.now();
    await seed(store, (s) => { s.needs.fome = 2; s.needs.sede = 90; s.activity = { kind: 'observar', until: s.virtualMinutes + 120, target: 'descanso', intention: 'olhar' }; }, t0);
    await tick(env, t0 + 1000, fixture([{ type: 'atividade', activity: 'comer', minutes: 30 }, { type: 'atividade', activity: 'beber', minutes: 15 }]));
    expect((await store.records('erro_ferramenta'))[0].data).toMatchObject({ code: 'sem_fome' });
    const state = (await store.state())!;
    expect(state.activity.kind).toBe('beber');
    expect(state.queue ?? []).toEqual([]);
  });
  it('records what changed in the body when an activity ends, so the creature can learn by itself', async () => {
    const { env, store } = setup();
    const t0 = Date.now();
    await seed(store, (s) => { s.needs = { ...s.needs, sono: 60, fome: 80, sede: 80 }; s.activity.until = 0; }, t0);
    await tick(env, t0, fixture([{ type: 'atividade', activity: 'dormir', minutes: 60 }]));
    await tick(env, t0 + 11 * 60000, fixture([]));
    const felt = (await store.records('percepcao'))[0];
    expect(felt.content).toMatch(/^Depois de dormir: /);
    expect(felt.content).toMatch(/sono 60 → \d+/);
    expect(felt.content).toMatch(/fome 80 → \d+/);
    expect(Number((felt.data.after as Record<string, number>).fome)).toBeGreaterThan(80);
  });
  it('body facts are sensations only: no remedy or rule is told', () => {
    const s = born(0);
    s.needs = { ...s.needs, fome: 95, sede: 95, saude: 20 };
    const text = bodyAlerts(s).join(' | ');
    expect(text).not.toMatch(/comer|beber|dormir|descansar|só /);
  });
});
