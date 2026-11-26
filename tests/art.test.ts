// Painting canvas and what the creature sees of her own drawings. Fixtures are SIMULATED.
import { afterEach, describe, expect, it } from 'vitest';
import { artifactSchema, born, type Artifact } from '../shared/domain';
import { lookAt, visibleColours } from '../shared/art';
import { Store, entry } from '../worker/store';
import { buildContext, tick } from '../worker/engine';
import type { Env } from '../worker/provider';
import { database } from './database';

const painting = {
  format: 'pintura',
  width: 100,
  height: 100,
  background: '#ffffff',
  strokes: [
    { tool: 'retangulo', color: '#3a7d44', fill: true, x: 0, y: 50, w: 100, h: 50 },
    { tool: 'elipse', color: '#f4d35e', fill: true, cx: 75, cy: 25, rx: 12, ry: 12 },
    { tool: 'pincel', color: '#1b263b', size: 4, points: [{ x: 10, y: 40 }, { x: 30, y: 30 }, { x: 50, y: 40 }] },
    { tool: 'poligono', color: '#8b4513', fill: true, points: [{ x: 20, y: 60 }, { x: 40, y: 60 }, { x: 30, y: 45 }] },
    { tool: 'texto', color: '#000000', x: 5, y: 95, size: 8, text: 'meu quarto' },
  ],
};

describe('painting canvas', () => {
  it('accepts brush, shapes and text; rejects colours that are not hex', () => {
    expect(artifactSchema.safeParse(painting).success).toBe(true);
    const bad = { ...painting, strokes: [{ ...painting.strokes[0], color: 'red' }] };
    expect(artifactSchema.safeParse(bad).success).toBe(false);
    expect(artifactSchema.safeParse({ ...painting, strokes: [{ tool: 'balde', color: '#000000' }] }).success).toBe(false);
  });
  it('she sees the colours she actually painted and how much each covers', () => {
    const seen = visibleColours(artifactSchema.parse(painting) as Artifact)!;
    expect(seen.map((c) => c.color)).toEqual(expect.arrayContaining(['#ffffff', '#3a7d44', '#f4d35e', '#8b4513']));
    expect(seen.reduce((t, c) => t + c.share, 0)).toBeCloseTo(1);
    expect(seen.find((c) => c.color === '#3a7d44')!.share).toBeGreaterThan(0.3);
    expect(lookAt(painting as Artifact)).toMatch(/5 traços; \d cores visíveis/);
  });
  it('a flat drawing is perceived as flat, in pixels or painting, without advice', () => {
    const flat = { format: 'pixels', palette: ['#101820', '#f4f1de'], pixels: Array.from({ length: 8 }, () => Array(8).fill(1)) } as Artifact;
    expect(lookAt(flat)).toBe('ao olhar a obra: uma só cor (#f4f1de) cobre a tela inteira; nada mais aparece');
    const hidden = { ...painting, strokes: [{ tool: 'retangulo', color: '#ffffff', fill: true, x: 0, y: 0, w: 100, h: 100 }] } as Artifact;
    expect(lookAt(hidden)).toMatch(/uma só cor/);
    expect(lookAt({ format: 'texto', content: 'x' })).toBeNull();
  });
});

const opened: ReturnType<typeof database>[] = [];
afterEach(() => opened.splice(0).forEach((d) => d.sqlite.close()));

describe('reading an old pixel work', () => {
  it('she sees the flat drawing as flat before the raw grid', async () => {
    const d = database();
    opened.push(d);
    const env = { DB: d.db, ENVIRONMENT_ID: 'tool-tests', MIN_DECISION_MINUTES: '0', FREE_TIER_CONFIRMED: 'true', AI_PROVIDERS: 'gemini', ENVIRONMENT: 'test' } as unknown as Env;
    const store = new Store(d.db);
    const now = Date.now();
    const s = born(now);
    s.decisions = 30;
    s.activity.until = 0;
    const flat = { format: 'pixels', palette: ['#101820', '#f4f1de'], pixels: Array.from({ length: 12 }, () => Array(11).fill(1)) };
    const token = await store.acquire(now);
    await store.commit(token!, s, [entry(s, 'nascimento', 'Nascimento DESCARTÁVEL de teste.', {}, { importance: 1 }), entry(s, 'artefato', 'Planta do quarto', { artifact: flat, version: 1 }, { entityId: 'artefato:planta' })], [], true);
    await store.release(token!);
    const fixture = { async decide() { return { decision: { intention: 'Rever minha planta', summary: 's', nextMinutes: 5, complexNext: false, actions: [{ type: 'ler_obra' as const, id: 'artefato:planta' }] }, model: 'fixture' }; } };
    await tick(env, now + 1000, fixture);
    const { context } = await buildContext(env, store, (await store.state())!, now + 2000);
    const read = (context.workingResults as { result: string }[])[0].result;
    expect(read.startsWith('{"seen":"ao olhar a obra: uma só cor (#f4f1de) cobre a tela inteira')).toBe(true);
  });
});

describe('creating a painting in the engine', () => {
  it('records the work with what she saw, and the next decision perceives it in thread', async () => {
    const d = database();
    opened.push(d);
    const env = { DB: d.db, ENVIRONMENT_ID: 'tool-tests', MIN_DECISION_MINUTES: '0', FREE_TIER_CONFIRMED: 'true', AI_PROVIDERS: 'gemini', ENVIRONMENT: 'test' } as unknown as Env;
    const store = new Store(d.db);
    const now = Date.now();
    const s = born(now);
    s.decisions = 30;
    s.activity.until = 0;
    const token = await store.acquire(now);
    await store.commit(token!, s, [entry(s, 'nascimento', 'Nascimento DESCARTÁVEL de teste.', {}, { importance: 1 })], [], true);
    await store.release(token!);
    const fixture = { async decide() { return { decision: { intention: 'Pintar o quarto', summary: 's', nextMinutes: 5, complexNext: false, actions: [{ type: 'criar' as const, id: 'quarto', title: 'Meu quarto', motivation: 'ver o quarto de outro jeito', projectId: null, artifact: painting as never }] }, model: 'fixture' }; } };
    const r = await tick(env, now + 1000, fixture);
    expect(r.status).toBe('decisao_registrada');
    const art = (await store.records('artefato'))[0];
    expect(art.data.artifact).toMatchObject({ format: 'pintura' });
    expect(String(art.data.seen)).toMatch(/cores visíveis/);
    const { context } = await buildContext(env, store, (await store.state())!, now + 2000);
    const actions = (context.thread as { actions: string[] }[])[0].actions;
    expect(actions[0]).toMatch(/^criar: feita \(ao olhar a obra: 5 traços/);
  });
});
