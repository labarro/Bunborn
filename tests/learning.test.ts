// Cognitive diversity, living world and learning (27/11). Fixtures are SIMULATED on disposable
// in-memory databases; real-model evidence lives in artifacts/diversity.
import { afterEach, describe, expect, it } from 'vitest';
import { born, type Decision, type State } from '../shared/domain';
import { closest, hamming, mmr, repeatedSequences, rollingSimilarity, simhash } from '../shared/similarity';
import { activeAt, eventsBetween, perceives } from '../shared/events';
import { growth, DAY } from '../shared/world';
import { bedLight, roomAt } from '../shared/house';
import { diffArtifact, editSection } from '../shared/creative';
import { stateSchema } from '../shared/validation';
import { Store, entry } from '../worker/store';
import { buildContext, perceiveWorld, placeFor, tick } from '../worker/engine';
import { trajectory } from '../worker/insights';
import type { Env } from '../worker/provider';
import { database } from './database';

const opened: ReturnType<typeof database>[] = [];
afterEach(() => opened.splice(0).forEach((d) => d.sqlite.close()));
function setup() {
  const d = database();
  opened.push(d);
  const env = { DB: d.db, ENVIRONMENT_ID: 'tool-tests', MIN_DECISION_MINUTES: '0', FREE_TIER_CONFIRMED: 'true', AI_PROVIDERS: 'gemini', ENVIRONMENT: 'test' } as unknown as Env;
  return { d, env, store: new Store(d.db) };
}
async function seed(store: Store, f: (s: State) => void = () => {}, now = Date.now(), extra: (s: State) => ReturnType<typeof entry>[] = () => []) {
  const s = born(now);
  s.decisions = 30;
  s.activity.until = 0;
  s.needs = { ...s.needs, sono: 30, energia: 80, fome: 50, sede: 60 };
  f(s);
  const token = await store.acquire(now);
  await store.commit(token!, s, [entry(s, 'nascimento', 'Nascimento DESCARTÁVEL de teste.', {}, { importance: 1 }), ...extra(s)], [], true);
  await store.release(token!);
  return s;
}
const fixture = (actions: Decision['actions']) => ({ async decide() { return { decision: { intention: 'Fixture', summary: 's', nextMinutes: 5, complexNext: false, actions }, model: 'fixture' }; } });
const last = async (store: Store) => (await store.records('intencao')).at(-1)!.data.outcomes as { action: string; result: string; code?: string; detail?: { note?: string } }[];

describe('similarity (deterministic, no AI)', () => {
  it('sees the same frame behind different words, and groups near-duplicates', () => {
    const a = 'A manhã de verão segue com uma serenidade nítida pela sala.';
    const b = 'A manhã de verão decorre com uma calma luminosa na sala.';
    const c = closest(b, [{ content: a }, { content: 'Pesquisei sobre vulcões e aprendi que o magma sobe.' }]);
    expect(c.sameOpening).toBe(true);
    expect(hamming(simhash(a), simhash(a))).toBe(0);
    expect(hamming(simhash(a), simhash('Vulcões, magma e crosta terrestre.'))).toBeGreaterThan(8);
    expect(repeatedSequences(['diario', 'descansar', 'diario', 'descansar', 'diario', 'descansar', 'diario'], 2, 3)[0]).toEqual(['diario > descansar', 3]);
    expect(rollingSimilarity([a, a, a]).average).toBe(1);
  });
  it('MMR keeps relevance but does not fill slots with equivalent texts', () => {
    const items = [
      { item: 1, score: 1, text: 'A falta é o motor da minha identidade e da criação.' },
      { item: 2, score: 0.95, text: 'A falta é o motor da minha identidade e da criação artística.' },
      { item: 3, score: 0.6, text: 'Aprendi que girassóis seguem o sol durante o dia.' },
    ];
    expect(mmr(items, 2)).toEqual([1, 3]);
  });
});

describe('places (root cause 27/11: 89 refusals of her own stations)', () => {
  it('a body activity understands the station, objects of its room and the room name', () => {
    const s = born(0);
    expect(placeFor(s, 'beber', 'pia_cozinha')).toBe('comida');
    expect(placeFor(s, 'comer', 'Cozinha')).toBe('comida');
    expect(placeFor(s, 'higiene', 'pia_banheiro')).toBe('higiene');
    expect(placeFor(s, 'descansar', 'sala')).toMatch(/sofa|poltrona|descanso/);
    expect(placeFor(s, 'observar', 'janela_estudio')).toBe('janela_estudio');
    expect(() => placeFor(s, 'beber', 'cama')).toThrow(/lugar_inadequado/);
  });
  it('drinking "in the kitchen sink" now happens; ir walks to another room through doors', async () => {
    const { env, store } = setup();
    await seed(store, (s) => { s.position = { x: 3, y: 8 }; });
    await tick(env, Date.now() + 1000, fixture([{ type: 'atividade', activity: 'beber', minutes: 10, objectId: 'pia_cozinha' }]));
    expect((await last(store))[0]).toMatchObject({ result: 'feita' });
    const { env: env2, store: store2 } = setup();
    await seed(store2, (s) => { s.position = { x: 3, y: 8 }; });
    await tick(env2, Date.now() + 1000, fixture([{ type: 'ir', destino: 'estudio' }]));
    const s = (await store2.state())!;
    expect(roomAt(s.position).id).toBe('estudio');
    expect((await store2.records('habitat')).at(-1)!.content).toBe('Foi até Estúdio.');
  });
});

describe('diary and memory', () => {
  it('a diary entry like a recent one is kept, with a factual note (no ban)', async () => {
    const { env, store } = setup();
    await seed(store);
    await tick(env, Date.now() + 1000, fixture([{ type: 'diario', content: 'A manhã de verão segue com uma serenidade nítida, e penso nas cores do girassol.' }]));
    await tick(env, Date.now() + 400000, fixture([{ type: 'diario', content: 'A manhã de verão decorre com uma calma luminosa; volto a pensar no girassol.' }]));
    const o = (await last(store))[0];
    expect(o.result).toBe('feita');
    expect(o.detail?.note).toMatch(/parecida com uma entrada recente \(mesma abertura/);
    expect((await store.records('diario'))).toHaveLength(2);
  });
  it('memories recalled very often and just now step back; others get the slot (nothing deleted)', async () => {
    const { env, store, d } = setup();
    const now = Date.now();
    const s = await seed(store, () => {}, now, (x) => [
      entry(x, 'memoria', 'Consolidação: a falta é o motor da minha identidade e da criação.', {}, { importance: 0.95, origin: 'criatura', realAt: now - 3600000 }),
      entry(x, 'memoria', 'Aprendi a regar o girassol pela manhã quando a terra seca.', {}, { importance: 0.5, origin: 'criatura', realAt: now - 2 * 86400000 }),
    ]);
    const dominant = (await store.records('memoria')).find((r) => r.content.startsWith('Consolidação'))!;
    d.sqlite.prepare('INSERT INTO retrievals(memory_id,count,last_at) VALUES(?,?,?)').run(dominant.id, 250, now - 60000);
    const { context } = await buildContext(env, store, s, now);
    const mems = (context.memories as { content: string }[]).map((m) => m.content);
    expect(mems[0]).toMatch(/regar o girassol/);
    expect(mems.some((m) => m.startsWith('Consolidação'))).toBe(true); // still there, just not first
  });
});

describe('living world', () => {
  it('events are deterministic; rare ones stay rare; perception needs her awake and able to see', () => {
    expect(eventsBetween(10000, 14000)).toEqual(eventsBetween(10000, 14000));
    const month = eventsBetween(0, 3 * DAY).length;
    expect(month).toBeGreaterThan(0);
    let rainbows = 0, total = 0;
    for (let d = 0; d < 60; d++) { const ev = eventsBetween(d * DAY, (d + 1) * DAY); total += ev.length; rainbows += ev.filter((e) => e.kind === 'arco_iris').length; }
    expect(rainbows).toBeLessThan(total / 6);
    const sight = { id: 'x', kind: 'borboletas', label: 'borboletas', start: 0, end: 10, where: 'jardim' as const, sense: 'ver' as const };
    expect(perceives(sight, { awake: false, outdoors: true, lookingOut: false, night: false })).toBeNull();
    expect(perceives(sight, { awake: true, outdoors: false, lookingOut: false, night: false })).toBeNull();
    expect(perceives(sight, { awake: true, outdoors: false, lookingOut: true, night: false })).toBe('viu pela janela');
    expect(perceives({ ...sight, sense: 'ouvir' }, { awake: true, outdoors: false, lookingOut: false, night: false })).toBe('ouviu');
    expect(Array.isArray(activeAt(12345))).toBe(true);
  });
  it('perceiveWorld records only what she could perceive, once per event', () => {
    // Find a day with an audible event (birds or rain) to test with.
    let a = 0;
    for (let d = 0; d < 40 && !a; d++) if (eventsBetween(d * DAY, (d + 1) * DAY).some((e) => e.sense === 'ouvir')) a = d * DAY;
    const before = born(0); before.virtualMinutes = a; before.activity = { kind: 'observar', until: a + DAY, target: 'descanso', intention: 'x' };
    const after = { ...structuredClone(before), virtualMinutes: a + DAY };
    const recs = perceiveWorld(before, after, []);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.length).toBeLessThanOrEqual(3);
    expect(perceiveWorld(before, after, recs).every((r) => !recs.some((x) => x.data.eventId === r.data.eventId))).toBe(true);
    const asleep = structuredClone(before); asleep.activity = { kind: 'dormir', until: a + DAY, target: 'cama', intention: 'x' };
    expect(perceiveWorld(asleep, { ...structuredClone(asleep), virtualMinutes: a + DAY }, [])).toHaveLength(0);
  });
});

describe('experiments with engine-made results', () => {
  it('shade under the tree slows rule-2 plants; old plots keep their past', () => {
    const plot = { species: 'alface', plantedAt: 0, waterings: Array.from({ length: 12 }, (_, i) => i * 1200), rule: 2 as const };
    expect(growth(plot, 2 * DAY, 1).progress).toBeGreaterThan(growth(plot, 2 * DAY, 0.5).progress);
    const old = { species: 'alface', plantedAt: 0, waterings: [0] };
    expect(growth(old, 600, 0.5)).toEqual(growth(old, 600, 1));
    expect(bedLight({ x: 16, y: 13 }, [{ id: 'arvore', kind: 'arvore', label: 'a', color: '#000000', x: 17, y: 13 }])).toBe(0.5);
  });
  it('start, measure and conclude; measurements come from the simulation; conclusion is hers', async () => {
    const { env, store } = setup();
    const t0 = Date.now();
    await seed(store, (s) => { s.position = { x: 3, y: 12 }; s.house = { version: 2, garden: { canteiro_1: { species: 'alface', plantedAt: 0, waterings: [0], rule: 2 }, canteiro_2: { species: 'alface', plantedAt: 0, waterings: [], rule: 2 } } }; }, t0);
    await tick(env, t0 + 1000, fixture([{ type: 'experimento', acao: 'iniciar', id: 'agua', pergunta: 'Regar faz a alface crescer mais rápido?', hipotese: 'O canteiro regado cresce mais', variavel: 'rega', grupos: [{ canteiro: 'canteiro_1', condicao: 'regado' }, { canteiro: 'canteiro_2', condicao: 'sem rega' }], conclusao: null }]));
    await tick(env, t0 + 400000, fixture([{ type: 'experimento', acao: 'concluir', id: 'agua', pergunta: null, hipotese: null, variavel: null, grupos: null, conclusao: null }]));
    expect((await last(store))[0]).toMatchObject({ result: 'recusada', code: 'sem_conclusao' });
    await tick(env, t0 + 800000, fixture([{ type: 'experimento', acao: 'concluir', id: 'agua', pergunta: null, hipotese: null, variavel: null, grupos: null, conclusao: 'Com rega cresceu mais, neste mundo.' }]));
    const exp = (await store.records('experimento')).at(-1)!;
    expect(exp.data.status).toBe('concluido');
    const meds = exp.data.medicoes as { grupos: { canteiro: string; crescimentoPct: number; horasUmidas: number }[] }[];
    expect(meds.length).toBeGreaterThanOrEqual(2);
    expect(typeof meds[0].grupos[0].crescimentoPct).toBe('number');
    expect(exp.data.escopo).toMatch(/mundo virtual/);
    const s = (await store.state())!;
    expect(stateSchema.safeParse(s).success).toBe(true);
  });
});

describe('learning: skills and procedures', () => {
  it('a skill needs evidence and new evidence to change; a procedure comes back when relevant', async () => {
    const { env, store } = setup();
    const t0 = Date.now();
    await seed(store, (s) => { s.motives.criatividade = 80; }, t0, (x) => [entry(x, 'artefato', 'Samambaia', { artifact: { format: 'texto', content: 'x' }, version: 1 }, { entityId: 'artefato:samambaia' })]);
    await tick(env, t0 + 1000, fixture([
      { type: 'habilidade', id: 'pintura', nome: 'Pintura de plantas', descricao: 'pinto plantas com traços finos', tecnicas: ['caule primeiro'], limitacoes: null, evidence: ['artefato:samambaia'] },
      { type: 'procedimento', id: 'compor', titulo: 'Compor uma planta', contexto: 'pintura', passos: ['caule central', 'folhas em pares'], evidence: ['artefato:samambaia'] },
    ]));
    await tick(env, t0 + 400000, fixture([{ type: 'habilidade', id: 'pintura', nome: 'Pintura de plantas', descricao: 'igual', tecnicas: [], limitacoes: null, evidence: ['artefato:samambaia'] }]));
    expect((await last(store))[0]).toMatchObject({ result: 'recusada', code: 'nova_evidencia_necessaria' });
    const { context } = await buildContext(env, store, (await store.state())!, t0 + 500000);
    const k = context.knowledge as { skills?: { nome: string }[]; procedures?: { titulo: string }[] };
    expect(k.skills?.[0].nome).toBe('Pintura de plantas');
    expect(k.procedures?.[0].titulo).toBe('Compor uma planta');
  });
});

describe('creative system', () => {
  it('sections grow a long text; an identical revision is not saved; changes are measured', async () => {
    expect(editSection('## Um\nA', 'Dois', 'B', 'adicionar')).toBe('## Um\nA\n\n## Dois\nB\n');
    expect(editSection('## Um\nA\n\n## Dois\nB\n', 'um', 'Z', 'substituir')).toMatch(/## Um\nZ/);
    expect(diffArtifact({ format: 'texto', content: 'a b c' }, { format: 'texto', content: 'a b c' }).identical).toBe(true);
    const { env, store } = setup();
    const t0 = Date.now();
    await seed(store, () => {}, t0);
    await tick(env, t0 + 1000, fixture([{ type: 'criar', id: 'livro', title: 'Livro do jardim', motivation: 'm', projectId: null, artifact: { format: 'texto', content: '## Prólogo\nUm começo.' } }]));
    await tick(env, t0 + 400000, fixture([{ type: 'obra_secao', id: 'livro', secao: 'Capítulo 1', conteudo: 'O girassol virou para a janela.', modo: 'adicionar' }]));
    let w = (await store.records('artefato')).at(-1)!;
    expect(w.data.version).toBe(2);
    expect(w.data.sections).toEqual(['Prólogo', 'Capítulo 1']);
    expect(String((w.data.revision as { change: string }).change)).toMatch(/palavras novas/);
    await tick(env, t0 + 800000, fixture([{ type: 'criar', id: 'livro', title: 'Livro do jardim', motivation: 'm', projectId: null, artifact: w.data.artifact as never }]));
    expect((await last(store))[0]).toMatchObject({ result: 'recusada', code: 'revisao_sem_alteracao' });
    w = (await store.records('artefato')).at(-1)!;
    expect(w.data.version).toBe(2);
  });
});

describe('observer trajectory', () => {
  it('summarises behaviour, creation, learning and repetition from stored records only', async () => {
    const { env, store } = setup();
    await seed(store);
    await tick(env, Date.now() + 1000, fixture([{ type: 'diario', content: 'Primeira entrada sobre o girassol e a luz.' }]));
    const t = await trajectory(env);
    expect(t.behaviour.decisions).toBe(1);
    expect(t.repetition.note).toMatch(/não é necessariamente um problema/);
    expect(t.learning.skills).toEqual([]);
  });
});

describe('formal tolerance for flattened answers', () => {
  it('experiment groups as a map become the list; absent nullable fields read as null', async () => {
    const { parseDecision } = await import('../shared/domain');
    const r = parseDecision({ intention: 'x', summary: 's', nextMinutes: 5, complexNext: false, actions: [{ type: 'experimento', acao: 'iniciar', id: 'luz', pergunta: 'A sombra atrasa?', hipotese: 'sim', variavel: 'luz', grupos: { canteiro_1: 'sol', canteiro_3: 'sombra' } }] });
    expect(r.invalidActions).toEqual([]);
    expect(r.decision.actions[0]).toMatchObject({ grupos: [{ canteiro: 'canteiro_1', condicao: 'sol' }, { canteiro: 'canteiro_3', condicao: 'sombra' }], conclusao: null });
  });
});
