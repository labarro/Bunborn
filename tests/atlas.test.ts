// Neural Atlas (28/11). Fixtures are SIMULATED records on disposable databases.
import { afterEach, describe, expect, it } from 'vitest';
import { born, type Decision, type RecordEntry } from '../shared/domain';
import { buildAtlas } from '../shared/atlas';
import { assignColors, availableModes, clusterColor, placeLabels, visibleGraph, type Filters } from '../src/atlas/model';
import { Store, entry } from '../worker/store';
import { buildContext, tick } from '../worker/engine';
import { atlas as atlasEndpoint } from '../worker/insights';
import type { Env } from '../worker/provider';
import { database } from './database';

const s = born(0);
let seq = 0;
const rec = (kind: string, content: string, data: Record<string, unknown> = {}, opts: Partial<RecordEntry> = {}) => ({ ...entry(s, kind, content, data, { realAt: 1000 + seq * 1000, ...opts }), seq: ++seq });
function sample() {
  seq = 0;
  const p1 = rec('pesquisa', 'Consulta externa: simulação computacional.', { query: 'simulação computacional', results: [{ title: 'Simulação', url: 'https://pt.wikipedia.org/wiki/Simula%C3%A7%C3%A3o' }, { title: 'X', url: 'javascript:alert(1)' }] });
  const p2 = rec('pesquisa', 'Consulta externa: Simulação Computacional.', { query: 'Simulação Computacional', results: [] });
  const legacy = rec('conceito', 'simulação computacional', { researchId: p1.id, sources: ['https://pt.wikipedia.org/wiki/Simula%C3%A7%C3%A3o'] }, { entityId: 'conceito:simulação computacional' });
  const k = rec('memoria', 'Simulação: imitação de um processo.', { status: 'fonte_consultada', query: 'simulação computacional', sources: [{ title: 'Simulação', url: 'https://pt.wikipedia.org/wiki/Simula%C3%A7%C3%A3o' }] }, { origin: 'criatura' });
  const p3 = rec('pesquisa', 'Consulta externa: limites da simulação computacional.', { query: 'limites da simulação computacional', results: [] });
  const p4 = rec('pesquisa', 'Consulta externa: girassol.', { query: 'girassol', results: [] });
  const c1 = rec('conceito', 'Falta', { nome: 'Falta', descricao: 'ausência que move o desejo', aliases: [], evidence: [k.id] }, { entityId: 'conceito:falta' });
  const c2 = rec('conceito', 'Identidade', { nome: 'Identidade', descricao: 'continuidade de quem se é', aliases: [], evidence: [] }, { entityId: 'conceito:identidade' });
  const rel = rec('relacao', 'sustenta', { from: 'conceito:falta', to: 'conceito:identidade', status: 'hipotese', evidence: [k.id] }, { entityId: 'relacao:falta:identidade' });
  return [p1, p2, legacy, k, p3, p4, c1, c2, rel];
}

describe('Neural Atlas data', () => {
  it('queries are queries (also the old query-concepts), normalized and counted; never declared concepts', () => {
    const a = buildAtlas(sample(), new Map(), 1e7);
    const q = a.nodes.filter((n) => n.type === 'consulta');
    expect(q.map((n) => n.id)).toContain('q:simulacao computacional');
    expect(q.find((n) => n.id === 'q:simulacao computacional')!.occurrences).toBe(2);
    expect(a.nodes.filter((n) => n.type === 'conceito').map((n) => n.label).sort()).toEqual(['Falta', 'Identidade']);
  });
  it('every link has an identifiable origin and real endpoints; inferences and hypotheses are marked', () => {
    const a = buildAtlas(sample(), new Map(), 1e7);
    const ids = new Set(a.nodes.map((n) => n.id));
    for (const e of a.edges) { expect(ids.has(e.source) && ids.has(e.target)).toBe(true); expect(['declarada', 'fonte', 'motor', 'inferida', 'hipotese']).toContain(e.origin); }
    expect(a.edges.find((e) => e.label === 'sustenta')?.origin).toBe('hipotese');
    expect(a.edges.find((e) => e.label === 'resultou em')?.origin).toBe('motor');
    expect(a.edges.find((e) => e.label === 'fundamentado em')?.origin).toBe('fonte');
    const inferred = a.edges.filter((e) => e.origin === 'inferida');
    expect(inferred.length).toBeGreaterThan(0);
    for (const e of inferred) expect(e.label).toBe('termos em comum');
  });
  it('isolated nodes stay; unsafe URLs are dropped; clusters are deterministic', () => {
    const a = buildAtlas(sample(), new Map(), 1e7);
    expect(a.nodes.find((n) => n.id === 'q:girassol')!.cluster).toBe('isolados');
    expect(JSON.stringify(a)).not.toContain('javascript:');
    expect(buildAtlas(sample(), new Map(), 1e7).clusters).toEqual(a.clusters);
  });
  it('events come only from records (nothing recent → no activity)', () => {
    expect(buildAtlas(sample(), new Map(), 1e12).events).toEqual([]);
    const now = 20000;
    const a = buildAtlas(sample(), new Map(), now);
    expect(a.events.length).toBeGreaterThan(0);
    for (const ev of a.events) for (const id of ev.nodes) expect(a.nodes.some((n) => n.id === id)).toBe(true);
  });
});

describe('Neural Atlas view', () => {
  it('modes without data are hidden; filters keep the layout data; colours do not collide', () => {
    const a = buildAtlas(sample(), new Map(), 1e7);
    expect(availableModes(a).map((m) => m.id)).toEqual(['conhecimentos', 'integrada']);
    const f: Filters = { types: new Set(['consulta', 'conhecimento', 'conceito']), origins: new Set(['declarada', 'fonte', 'motor', 'hipotese']), showIsolated: false, until: null, query: '' };
    const g = visibleGraph(a, 'conhecimentos', f);
    expect(g.edges.every((e) => e.origin !== 'inferida')).toBe(true);
    expect(g.nodes.some((n) => n.id === 'q:girassol')).toBe(false);
    assignColors(['g:a', 'g:b', 'g:c']);
    expect(new Set(['g:a', 'g:b', 'g:c'].map(clusterColor)).size).toBe(3);
  });
  it('labels never overlap and never leave the screen', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ id: String(i), x: 100 + (i % 5) * 12, y: 100 + Math.floor(i / 5) * 6, r: 4, text: 'rótulo bastante longo ' + i, priority: 40 - i }));
    const placed = placeLabels(items, (t) => t.length * 6, 50, { w: 400, h: 300 });
    for (const a of placed) {
      expect(a.x >= 0 && a.y >= 0 && a.x + a.w <= 400 && a.y + a.h <= 300).toBe(true);
      for (const b of placed) if (a !== b) expect(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y).toBe(false);
    }
  });
});

const opened: ReturnType<typeof database>[] = [];
afterEach(() => opened.splice(0).forEach((d) => d.sqlite.close()));
describe('engine integration', () => {
  it('a search no longer creates a concept; the conceito action does; relations come back in context; the endpoint builds', async () => {
    const d = database();
    opened.push(d);
    const env = { DB: d.db, ENVIRONMENT_ID: 'tool-tests', MIN_DECISION_MINUTES: '0', FREE_TIER_CONFIRMED: 'true', AI_PROVIDERS: 'gemini', ENVIRONMENT: 'test' } as unknown as Env;
    const store = new Store(d.db);
    const st = born(Date.now());
    st.decisions = 30; st.activity.until = 0;
    const token = await store.acquire(Date.now());
    await store.commit(token!, st, [entry(st, 'nascimento', 'Nascimento DESCARTÁVEL de teste.', {}, { importance: 1 })], [], true);
    await store.release(token!);
    const fx = (actions: Decision['actions']) => ({ async decide() { return { decision: { intention: 'x', summary: 's', nextMinutes: 5, complexNext: false, actions }, model: 'fixture' }; } });
    const fetcher = (async () => Response.json({ query: { search: [{ title: 'Falta', snippet: 'conceito', pageid: 1 }] } })) as unknown as typeof fetch;
    await tick(env, Date.now() + 1000, fx([{ type: 'pesquisar', source: 'wikipedia', query: 'falta lacan' }]), fetcher);
    expect(await store.records('conceito')).toHaveLength(0);
    const ev = (await store.records('pesquisa'))[0].id;
    await tick(env, Date.now() + 400000, fx([{ type: 'conceito', id: 'falta', nome: 'Falta', descricao: 'ausência que move o desejo', aliases: ['manque'], evidence: [ev] }, { type: 'conceito', id: 'desejo', nome: 'Desejo', descricao: 'o que a falta move', aliases: [], evidence: [ev] }]));
    await tick(env, Date.now() + 800000, fx([{ type: 'relacionar', from: 'conceito:falta', to: 'conceito:desejo', relation: 'move', status: 'opiniao', evidence: [ev] }]));
    const { context } = await buildContext(env, store, (await store.state())!, Date.now() + 900000);
    const k = context.knowledge as { concepts: { nome: string }[]; relations?: { relacao: string }[] };
    expect(k.concepts.map((c) => c.nome)).toEqual(expect.arrayContaining(['Falta', 'Desejo']));
    expect(k.relations?.[0].relacao).toBe('move');
    const a = await atlasEndpoint(env);
    expect(a.nodes.filter((n) => n.type === 'conceito')).toHaveLength(2);
    expect(a.edges.find((e) => e.label === 'move')?.origin).toBe('declarada');
  });
});
