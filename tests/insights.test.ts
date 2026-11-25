import { afterEach, describe, expect, it } from 'vitest';
import { born } from '../shared/domain';
import { Store, entry } from '../worker/store';
import type { Env } from '../worker/provider';
import { dayKey, highlights, logbook, recordVisit } from '../worker/insights';
import { database } from './database';
// Fixture records only: summaries must reflect exactly what is stored, nothing more.
const opened: ReturnType<typeof database>[] = [];
afterEach(() => opened.splice(0).forEach((d) => d.sqlite.close()));
function env(): Env {
  const d = database();
  opened.push(d);
  return { DB: d.db, ENVIRONMENT: 'test', SESSION_SECRET: 'fixture-session-secret-insights-0123456789' } as Env;
}
async function seed(e: Env) {
  const store = new Store(e.DB);
  const now = Date.now();
  const s = born(now - 3600000);
  let token = (await store.acquire(now))!;
  await store.commit(token, s, [entry({ ...s, updatedAt: now - 3600000 }, 'nascimento', 'Nascimento FIXTURE.', {}, { importance: 1 })], [], true);
  await store.release(token);
  token = (await store.acquire(now))!;
  const at = { ...s, updatedAt: now - 60000 };
  await store.commit(token, s, [
    entry(at, 'intencao', 'Ler sobre estrelas (fixture).', { summary: 'Curiosidade fixture.', proposed: ['pesquisar'] }),
    entry(at, 'pesquisa', 'Consulta externa: estrelas.', { query: 'estrelas', results: [] }),
    entry(at, 'artefato', 'Poema das estrelas', { artifact: { format: 'texto', content: 'x' }, version: 1 }, { entityId: 'artefato:poema' }),
    entry(at, 'interesse', 'astronomia', { strength: 0.3, status: 'ativo', evidence: [] }, { entityId: 'interesse:astronomia' }),
    entry(at, 'atividade_concluida', 'Atividade concluída: comer.', { activity: { kind: 'comer' } }),
    entry(at, 'conversa', 'Olá', { role: 'visitante' }, { origin: 'visitante' }),
  ]);
  await store.release(token);
}
describe('public highlights, logbook and visitor counter (fixtures)', () => {
  it('summarizes only stored facts', async () => {
    const e = env();
    await seed(e);
    const h = (await highlights(e)) as Record<string, any>;
    expect(h.born).toBe(true);
    expect(h.lastThought).toMatchObject({ intention: 'Ler sobre estrelas (fixture).', summary: 'Curiosidade fixture.' });
    expect(h.interests.map((i: { topic: string }) => i.topic)).toEqual(['astronomia']);
    expect(h.artifacts[0]).toMatchObject({ title: 'Poema das estrelas', format: 'texto' });
    expect(h.last24h).toMatchObject({ intencao: 1, pesquisa: 1, artefato: 1 });
    const book = await logbook(e, 7);
    const today = book.days.find((d) => d.day === dayKey(Date.now()))!;
    expect(today).toMatchObject({ decisions: 1, born: true });
    expect(today.research.map((r) => r.query)).toEqual(['estrelas']);
    expect(today.activities).toEqual([{ k: 'comer', n: 1 }]);
    expect(today.talks).toEqual({ visitante: 1 });
  });
  it('reports nothing for an unborn existence', async () => {
    const e = env();
    expect(await highlights(e)).toEqual({ born: false });
    expect(await logbook(e, 7)).toEqual({ born: false, days: [] });
  });
  it('counts each visitor once per day without storing the IP', async () => {
    const e = env();
    const req = (ip: string) => new Request('https://x/api/visit', { method: 'POST', headers: { 'cf-connecting-ip': ip } });
    const { visitorsToday } = await import('../worker/insights');
    expect((await visitorsToday(e)).today).toBe(0); // primes the 30 s memo, as a highlights GET would
    expect((await recordVisit(e, req('203.0.113.1'))).today).toBe(1);
    expect((await recordVisit(e, req('203.0.113.1'))).today).toBe(1);
    expect((await recordVisit(e, req('203.0.113.2'))).today).toBe(2);
    const rows = (await e.DB.prepare('SELECT visitor FROM visits').all<{ visitor: string }>()).results;
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.visitor.includes('203.0.113'))).toBe(false);
  });
});
