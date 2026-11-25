import type { Env } from './provider';
import { Store, decode, type Row } from './store';
// Public summaries built ONLY from stored records (counts, lists, latest versions).
// No model call and no interpretation is added. Results are cached in memory of the single
// Durable Object, so every visitor shares one computation and D1 reads stay bounded.
const memos = new WeakMap<object, Map<string, { expires: number; value: unknown }>>();
async function cached<T>(env: Env, key: string, ttl: number, compute: () => Promise<T>): Promise<T> {
  let memo = memos.get(env.DB);
  if (!memo) memos.set(env.DB, (memo = new Map()));
  const hit = memo.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await compute();
  if (memo.size > 100) memo.clear();
  memo.set(key, { expires: Date.now() + ttl, value });
  return value;
}
// History can be replaced (birth, restore): drop every cached summary for this database.
export function forgetInsights(env: Env) {
  memos.delete(env.DB);
}
const BRT = -3 * 3600000; // Brasília (UTC-3), the audience's calendar day
export const dayKey = (ms: number) => new Date(ms + BRT).toISOString().slice(0, 10);
const dayStart = (key: string) => Date.parse(key + 'T00:00:00Z') - BRT;
type Counts = Record<string, number>;
async function countsBetween(env: Env, from: number, to: number): Promise<Counts> {
  const rows = (await env.DB.prepare('SELECT kind, COUNT(*) AS n FROM records WHERE real_at>=? AND real_at<? GROUP BY kind').bind(from, to).all<{ kind: string; n: number }>()).results;
  return Object.fromEntries(rows.map((r) => [r.kind, r.n]));
}
export async function highlights(env: Env) {
  return cached(env, 'highlights', 120000, async () => {
    const store = new Store(env.DB);
    const state = await store.state();
    if (!state) return { born: false };
    const now = Date.now(), since = now - 86400000;
    const [thought, interests, artifacts, projects, changes, today, yesterday, born] = await Promise.all([
      env.DB.prepare("SELECT * FROM records WHERE kind='intencao' ORDER BY seq DESC LIMIT 1").first<Row>(),
      store.latest('interesse', 30),
      store.latest('artefato', 6),
      store.latest('projeto', 10),
      env.DB.prepare("SELECT * FROM records WHERE real_at>=? AND kind IN ('identidade','interesse','projeto','artefato','pesquisa','diario','conversa','relacao','recurso') ORDER BY real_at DESC LIMIT 30").bind(since).all<Row>(),
      countsBetween(env, since, now + 1),
      countsBetween(env, since - 86400000, since),
      env.DB.prepare("SELECT real_at FROM records WHERE kind='nascimento' ORDER BY seq LIMIT 1").first<{ real_at: number }>(),
    ]);
    const strength = (r: { data: Record<string, unknown>; virtualAt: number }) => Number(r.data.strength ?? 0) * Math.exp(-Math.max(0, state.virtualMinutes - r.virtualAt) / 43200);
    return {
      born: true,
      name: state.identity.name,
      description: state.identity.description,
      traits: state.identity.traits,
      bornAt: born?.real_at ?? state.bornAt,
      virtualMinutes: state.virtualMinutes,
      decisions: state.decisions,
      activity: state.activity,
      lastThought: thought ? { intention: thought.content, summary: (JSON.parse(thought.data) as { summary?: string }).summary ?? null, at: thought.real_at } : null,
      interests: interests.filter((r) => r.data.status !== 'abandonado').map((r) => ({ topic: r.content, strength: +strength(r).toFixed(2), status: r.data.status })).sort((a, b) => b.strength - a.strength).slice(0, 5),
      artifacts: artifacts.map((r) => ({ entityId: r.entityId, title: r.content, format: (r.data.artifact as { format?: string } | undefined)?.format ?? null, version: r.data.version ?? 1, at: r.realAt })),
      projects: projects.filter((r) => r.data.status === 'ativo' || r.data.status === 'concluido').map((r) => ({ title: r.content, status: r.data.status, steps: (r.data.steps as unknown[] | undefined)?.length ?? 0, done: new Set((r.data.completed as unknown[] | undefined) ?? []).size })),
      changes: changes.results.map(decode).map((r) => ({ kind: r.kind, content: r.content.slice(0, 220), at: r.realAt, role: r.data.role ?? null, field: r.data.field ?? null })),
      last24h: today,
      previous24h: yesterday,
      generatedAt: now,
    };
  });
}
async function summarizeDay(env: Env, key: string) {
  const from = dayStart(key), to = from + 86400000;
  const q = <T>(sql: string) => env.DB.prepare(sql).bind(from, to).all<T>().then((r) => r.results);
  const [kinds, activities, research, works, identity, interests, projects, talks] = await Promise.all([
    q<{ kind: string; n: number }>('SELECT kind, COUNT(*) AS n FROM records WHERE real_at>=? AND real_at<? GROUP BY kind'),
    q<{ k: string; n: number }>("SELECT json_extract(data,'$.activity.kind') AS k, COUNT(*) AS n FROM records WHERE real_at>=? AND real_at<? AND kind='atividade_concluida' GROUP BY k ORDER BY n DESC"),
    q<{ query: string; cached: number }>("SELECT json_extract(data,'$.query') AS query, json_extract(data,'$.cached') AS cached FROM records WHERE real_at>=? AND real_at<? AND kind='pesquisa' ORDER BY seq LIMIT 8"),
    q<{ title: string; version: number; format: string }>("SELECT content AS title, json_extract(data,'$.version') AS version, json_extract(data,'$.artifact.format') AS format FROM records WHERE real_at>=? AND real_at<? AND kind='artefato' ORDER BY seq LIMIT 8"),
    q<{ field: string; value: string }>("SELECT json_extract(data,'$.field') AS field, content AS value FROM records WHERE real_at>=? AND real_at<? AND kind='identidade' ORDER BY seq LIMIT 8"),
    q<{ topic: string; status: string }>("SELECT content AS topic, json_extract(data,'$.status') AS status FROM records WHERE real_at>=? AND real_at<? AND kind='interesse' ORDER BY seq LIMIT 8"),
    q<{ title: string; status: string }>("SELECT content AS title, json_extract(data,'$.status') AS status FROM records WHERE real_at>=? AND real_at<? AND kind='projeto' ORDER BY seq LIMIT 8"),
    q<{ role: string; n: number }>("SELECT json_extract(data,'$.role') AS role, COUNT(*) AS n FROM records WHERE real_at>=? AND real_at<? AND kind='conversa' GROUP BY role"),
  ]);
  const count = Object.fromEntries(kinds.map((r) => [r.kind, r.n])) as Counts;
  return { day: key, decisions: count.intencao ?? 0, diary: count.diario ?? 0, pauses: count.erro ?? 0, toolRejections: count.erro_ferramenta ?? 0, born: (count.nascimento ?? 0) > 0, activities, research, works, identity, interests, projects, talks: Object.fromEntries(talks.map((t) => [t.role ?? 'outro', t.n])) };
}
export async function logbook(env: Env, days: number) {
  const store = new Store(env.DB);
  const state = await store.state();
  if (!state) return { born: false, days: [] };
  const birth = await env.DB.prepare("SELECT real_at FROM records WHERE kind='nascimento' ORDER BY seq LIMIT 1").first<{ real_at: number }>();
  const first = dayKey(birth?.real_at ?? state.bornAt), today = dayKey(Date.now());
  const keys: string[] = [];
  for (let t = dayStart(today); keys.length < days; t -= 86400000) {
    const key = dayKey(t);
    if (key < first) break;
    keys.push(key);
  }
  // Finished days never change: cache them for hours; the current day refreshes every 10 min.
  const entries = await Promise.all(keys.map((key) => cached(env, 'day:' + key, key === today ? 600000 : 6 * 3600000, () => summarizeDay(env, key))));
  return { born: true, timezone: 'America/Sao_Paulo (UTC-3)', days: entries };
}
export async function recordVisit(env: Env, request: Request) {
  const day = dayKey(Date.now());
  const raw = (request.headers.get('cf-connecting-ip') ?? 'local') + '|' + day + '|' + (env.SESSION_SECRET ?? '');
  const visitor = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)))].slice(0, 16).map((n) => n.toString(16).padStart(2, '0')).join('');
  const oldest = dayKey(Date.now() - 8 * 86400000);
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO visits(day, visitor) VALUES(?, ?)').bind(day, visitor),
    env.DB.prepare('DELETE FROM visits WHERE day < ?').bind(oldest),
  ]);
  memos.get(env.DB)?.delete('visitors:' + day);
  return visitorsToday(env);
}
export async function visitorsToday(env: Env) {
  const day = dayKey(Date.now());
  return cached(env, 'visitors:' + day, 30000, async () => ({ day, today: (await env.DB.prepare('SELECT COUNT(*) AS n FROM visits WHERE day=?').bind(day).first<{ n: number }>())?.n ?? 0 }));
}
