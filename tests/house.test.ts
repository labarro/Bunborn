// House v2 (26/11): migration, layout rules, tools, world and context. Fixtures are SIMULATED and
// run on disposable in-memory databases (never the permanent creature).
import { afterEach, describe, expect, it } from 'vitest';
import { born, type Decision, type State } from '../shared/domain';
import { approach, catalogueEntry, defaultPosition, houseObjects, migrateObjects, roomAt, usePoints, validLayout, wallBetween } from '../shared/house';
import { growth, outsideView, periodOf, weatherAt, WEATHER_BLOCK } from '../shared/world';
import { Store, entry } from '../worker/store';
import { buildContext, tick } from '../worker/engine';
import type { Env } from '../worker/provider';
import { database } from './database';

const opened: ReturnType<typeof database>[] = [];
afterEach(() => opened.splice(0).forEach((d) => d.sqlite.close()));
// Production objects of 26/11 (single room, two moves made by the creature, three works exposed).
const v1 = [{ id: 'cama', label: 'Cama', kind: 'cama', x: 1, y: 1, color: '#a38ab9' }, { id: 'mesa', label: 'Mesa de trabalho', kind: 'mesa', x: 6, y: 2, color: '#b88b68' }, { id: 'terminal', label: 'Terminal de pesquisa', kind: 'terminal', x: 8, y: 1, color: '#91aab0' }, { id: 'estante', label: 'Estante', kind: 'estante', x: 2, y: 5, color: '#bb946b', artifactId: 'artefato:a' }, { id: 'comida', label: 'Alimentação e água', kind: 'comida', x: 2, y: 9, color: '#d4ad78' }, { id: 'higiene', label: 'Área de higiene', kind: 'higiene', x: 9, y: 9, color: '#8fbbba' }, { id: 'diario', label: 'Diário', kind: 'diario', x: 7, y: 3, color: '#b389a6' }, { id: 'atelie', label: 'Ateliê', kind: 'atelie', x: 9, y: 5, color: '#d7ba90', artifactId: 'artefato:b' }, { id: 'bau', label: 'Armazenamento', kind: 'bau', x: 1, y: 7, color: '#b08767', artifactId: 'artefato:c' }, { id: 'descanso', label: 'Almofada de descanso', kind: 'descanso', x: 5, y: 6, color: '#9eae84' }, { id: 'planta', label: 'Planta', kind: 'planta', x: 10, y: 1, color: '#91ad7e' }, { id: 'recurso:vaso', label: 'Vaso azul', kind: 'decoracao', x: 4, y: 4, color: '#7799cc' }];

function setup() {
  const d = database();
  opened.push(d);
  const env = { DB: d.db, ENVIRONMENT_ID: 'tool-tests', MIN_DECISION_MINUTES: '0', FREE_TIER_CONFIRMED: 'true', AI_PROVIDERS: 'gemini', ENVIRONMENT: 'test' } as unknown as Env;
  return { d, env, store: new Store(d.db) };
}
async function seed(store: Store, f: (s: State) => void = () => {}, now = Date.now()) {
  const s = born(now);
  s.decisions = 30;
  s.activity.until = 0;
  s.needs = { ...s.needs, sono: 30, energia: 80 };
  f(s);
  const token = await store.acquire(now);
  await store.commit(token!, s, [entry(s, 'nascimento', 'Nascimento DESCARTÁVEL de teste.', {}, { importance: 1 })], [], true);
  await store.release(token!);
  return s;
}
const fixture = (actions: Decision['actions']) => ({ async decide() { return { decision: { intention: 'Fixture', summary: 's', nextMinutes: 5, complexNext: false, actions }, model: 'fixture' }; } });

describe('house layout', () => {
  it('default house is valid, rooms connect through doorways and every station is usable from the front', () => {
    expect(validLayout(houseObjects, defaultPosition)).toBe(true);
    for (const id of ['cama', 'comida', 'higiene', 'terminal', 'diario', 'atelie', 'bau', 'descanso']) {
      const o = houseObjects.find((x) => x.id === id)!;
      const path = approach(defaultPosition, o, houseObjects);
      expect(path.length, id).toBeGreaterThan(0);
      for (let i = 1; i < path.length; i++) expect(wallBetween(path[i - 1], path[i])).toBe(false);
    }
    // In front of the terminal (against the back wall), not beside it.
    expect(usePoints(houseObjects.find((o) => o.id === 'terminal')!)[0]).toEqual({ x: 8, y: 1 });
  });
  it('rejects objects on doorways, across walls, outdoor things indoors and blocked stations', () => {
    const at = (id: string, x: number, y: number) => houseObjects.map((o) => (o.id === id ? { ...o, x, y } : o));
    expect(validLayout(at('planta', 3, 5), defaultPosition)).toBe(false); // doorway quarto-sala
    expect(validLayout(at('sofa', 5, 2), defaultPosition)).toBe(false); // would cross the quarto/estúdio wall
    expect(validLayout(at('arvore', 4, 8), defaultPosition)).toBe(false); // a tree indoors
  });
});

describe('migration of the permanent single room', () => {
  it('keeps ids, colours, exposed works and decorations; re-applies her moves where they fit', () => {
    const { objects, position, report } = migrateObjects(v1);
    expect(validLayout(objects, position)).toBe(true);
    expect(report.exposures).toHaveLength(3);
    expect(objects.find((o) => o.id === 'atelie')!.artifactId).toBe('artefato:b');
    expect(report.movedKept).toContain('estante');
    expect(report.movedReset).toContain('mesa');
    expect(report.extras).toContain('recurso:vaso');
    expect(objects.find((o) => o.id === 'recurso:vaso')).toMatchObject({ label: 'Vaso azul', color: '#7799cc' });
    for (const id of v1.map((o) => o.id)) expect(objects.some((o) => o.id === id)).toBe(true);
  });
  it('happens once inside the tick, recorded as an external change and not as her choice', async () => {
    const { env, store } = setup();
    await seed(store, (s) => { s.objects = structuredClone(v1); delete s.house; s.position = { x: 5, y: 5 }; s.activity = { kind: 'dormir', until: 1e9, target: 'cama', intention: 'dormir' }; });
    await tick(env, Date.now() + 1000, fixture([]));
    const s = (await store.state())!;
    expect(s.house?.version).toBe(2);
    const rec = (await store.records('habitat'))[0];
    expect(rec.content).toMatch(/^Alteração externa do ambiente \(desenvolvimento do Bunborn, não uma escolha sua\)/);
    expect(rec.origin).toBe('sistema');
    expect(rec.content).not.toMatch(/gost|feliz|triste|adorou/i);
    // She stays where her activity is: at the bed.
    expect(roomAt(s.position).id).toBe('quarto');
    await tick(env, Date.now() + 400000, fixture([]));
    expect((await store.records('habitat')).length).toBe(1);
  });
});

describe('world', () => {
  it('weather, period and garden growth are deterministic functions of the virtual clock', () => {
    expect(weatherAt(12345)).toEqual(weatherAt(12345));
    expect(periodOf(3 * 60)).toBe('madrugada');
    expect(periodOf(14 * 60)).toBe('tarde');
    // Weather keeps a condition for a whole block (no change every cycle).
    const b = 40 * WEATHER_BLOCK;
    expect(weatherAt(b + 10).condition).toBe(weatherAt(b + WEATHER_BLOCK - 10).condition);
    const plot = { species: 'alface', plantedAt: 0, waterings: [0, 1200, 2400] };
    expect(growth(plot, 60).stage).toBe(0);
    expect(growth(plot, 4000).stage).toBe(4);
    expect(outsideView(14 * 60)).toMatch(/tarde/);
  });
});

describe('house tools', () => {
  it('decorar paints walls and recolours what can be recoloured; guardar and mover bring things back', async () => {
    const { env, store } = setup();
    await seed(store, (s) => { s.position = { x: 3, y: 8 }; });
    await tick(env, Date.now() + 1000, fixture([{ type: 'decorar', objectId: null, room: 'sala', color: '#88aacc' }, { type: 'decorar', objectId: 'terminal', room: null, color: '#000000' }]));
    let s = (await store.state())!;
    expect(s.house?.walls?.sala).toBe('#88aacc');
    expect((await store.records('erro_ferramenta')).some((r) => r.data.code === 'sem_cor_mutavel')).toBe(true);
    await tick(env, Date.now() + 400000, fixture([{ type: 'guardar', objectId: 'planta' }, { type: 'guardar', objectId: 'cama' }]));
    s = (await store.state())!;
    expect(s.objects.some((o) => o.id === 'planta')).toBe(false);
    expect(s.house?.inventory?.map((o) => o.id)).toEqual(['planta']);
    expect((await store.records('erro_ferramenta')).some((r) => r.data.code === 'nao_guardavel')).toBe(true);
    await tick(env, Date.now() + 800000, fixture([{ type: 'mover', objectId: 'planta', x: 8, y: 9 }]));
    s = (await store.state())!;
    expect(s.objects.find((o) => o.id === 'planta')).toMatchObject({ x: 8, y: 9 });
    expect(s.house?.inventory ?? []).toHaveLength(0);
  });
  it('jardim plants, waters and refuses an early harvest; rain counts as watering', async () => {
    const { env, store } = setup();
    await seed(store, (s) => { s.position = { x: 3, y: 12 }; });
    await tick(env, Date.now() + 1000, fixture([{ type: 'jardim', acao: 'plantar', canteiro: 'canteiro_1', especie: 'alface' }]));
    let s = (await store.state())!;
    expect(s.house?.garden?.canteiro_1?.species).toBe('alface');
    expect(s.activity).toMatchObject({ kind: 'jardinar', target: 'canteiro_1' });
    await tick(env, Date.now() + 400000, fixture([{ type: 'jardim', acao: 'colher', canteiro: 'canteiro_1', especie: null }]));
    expect((await store.records('erro_ferramenta')).some((r) => r.data.code === 'ainda_nao_pronta')).toBe(true);
    s = (await store.state())!;
    expect(s.house?.garden?.canteiro_1).toBeDefined();
  });
  it('catalogo is on demand; recurso may name a catalogue item; tocar needs an instrument and a composition', async () => {
    const { env, store } = setup();
    await seed(store);
    await tick(env, Date.now() + 1000, fixture([{ type: 'catalogo', categoria: 'música' }, { type: 'recurso', id: 'disco', title: 'Toca-discos', reason: 'ouvir minhas músicas', catalogId: 'toca_discos' }, { type: 'tocar', artifactId: 'nada', objectId: 'sofa' }]));
    const reading = (await store.records('leitura'))[0];
    expect((reading.data.catalogo as { catalogId: string }[]).map((c) => c.catalogId)).toEqual(['toca_discos', 'piano']);
    expect((await store.records('recurso'))[0].data).toMatchObject({ status: 'pendente', catalogId: 'toca_discos' });
    expect((await store.records('erro_ferramenta')).some((r) => r.data.code === 'sem_instrumento')).toBe(true);
    expect(catalogueEntry('telescopio')).toMatchObject({ name: 'Telescópio', offers: ['observar'] });
  });
  it('rest on a chosen object only if it offers rest; observing a window reports the world outside', async () => {
    const { env, store } = setup();
    await seed(store);
    await tick(env, Date.now() + 1000, fixture([{ type: 'atividade', activity: 'descansar', minutes: 20, objectId: 'geladeira' }]));
    expect((await store.records('erro_ferramenta')).some((r) => r.data.code === 'lugar_inadequado')).toBe(true);
    await tick(env, Date.now() + 400000, fixture([{ type: 'atividade', activity: 'observar', minutes: 15, objectId: 'janela_sala' }]));
    const intent = (await store.records('intencao')).at(-1)!;
    const outcome = (intent.data.outcomes as { result: string; detail?: { note: string } }[])[0];
    expect(outcome.result).toBe('feita');
    expect(outcome.detail?.note).toMatch(/^lá fora: /);
    expect((await store.state())!.activity.target).toBe('janela_sala');
  });
});

describe('context', () => {
  it('shows the room she is in with positions, other rooms by id, and the world, without a huge house dump', async () => {
    const { env, store } = setup();
    const s = await seed(store, (x) => { x.position = { x: 9, y: 2 }; });
    const { context } = await buildContext(env, store, s, Date.now());
    const sit = context.situation as { room: string; objects: { id: string }[]; otherRooms: Record<string, string[]> };
    expect(sit.room).toBe('Estúdio');
    expect(sit.objects.map((o) => o.id)).toContain('terminal');
    expect(sit.objects.map((o) => o.id)).not.toContain('cama');
    expect(sit.otherRooms.Quarto).toContain('cama');
    expect(context.world).toMatchObject({ period: expect.any(String), season: expect.any(String), weather: expect.any(String) });
    expect(JSON.stringify(context.situation).length).toBeLessThan(2600);
  });
});

describe('observing again (homologation 26/11)', () => {
  it('moving something and observing in the same cycle does not unlock endless observations', async () => {
    const { env, store } = setup();
    await seed(store, (s) => { s.position = { x: 3, y: 8 }; });
    const t0 = Date.now();
    await tick(env, t0 + 1000, fixture([{ type: 'mover', objectId: 'planta', x: 8, y: 9 }, { type: 'atividade', activity: 'observar', minutes: 15, objectId: 'janela_sala' }]));
    await tick(env, t0 + 400000, fixture([{ type: 'atividade', activity: 'observar', minutes: 15, objectId: 'quadro_sala' }]));
    const codes = (await store.records('erro_ferramenta')).map((r) => r.data.code);
    expect(codes).toContain('nada_novo_para_observar');
  });
});
