// Architecture benchmark (cognitive audit 25/11): the SAME scenarios and metrics run against the
// previous architecture (git worktree of the production commit) and the improved one, with REAL
// model calls through the REAL engine, each in a disposable in-memory database. One model pinned
// per run (others disabled, no fallback). Never touches the permanent creature: the "lumi-real"
// scenario loads a signed production BACKUP into an in-memory SQLite.
// Metrics are deliberately neutral: they flag incoherence (acting against the body, repeating a
// refused action, re-searching the same query, losing the thread) and report initiative, but no
// scenario has a single "right" answer.
// Run: node scripts/architecture-bench.mjs <label> [models] [scenarios]
import { it } from 'vitest';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { born, type State, type RecordEntry } from '../shared/domain';
import { catalog, nvidiaEntry, modelKey, categories, type ModelEntry } from '../shared/ai-catalog';
import { Store, entry } from '../worker/store';
import { tick } from '../worker/engine';
import type { Env } from '../worker/provider';
import { useQuality, defaultConfig, knownModels } from '../worker/ai/router';
import { database } from './database';
import { loadBackup } from './backup-fixture';

type Seeded = { s: State; records: RecordEntry[]; inbox?: { content: string; author: string }[]; thread?: RegExp; refusedBefore?: string; researchQuery?: string };
type Scenario = { id: string; title: string; seed: (now: number) => Seeded; real?: boolean };

const base = (now: number, f: (s: State) => void = () => {}): State => {
  const s = born(now - 30 * 3600000);
  s.decisions = 60;
  s.identity.name = 'Lumi';
  s.identity.description = 'Coelha que gosta de entender como as coisas funcionam.';
  s.identity.traits = { nome: { value: 'Lumi', evidence: ['nascimento'], version: 1 } };
  s.needs = { fome: 20, sede: 20, sono: 30, energia: 75, higiene: 80, conforto: 70, saude: 90 };
  s.motives = { curiosidade: 60, tedio: 50, satisfacao: 50, criatividade: 55, frustracao: 5, interacao: 50, motivacao: 60 };
  s.activity = { kind: 'observar', until: 0, target: 'descanso', intention: 'Olhar o quarto.' };
  s.virtualMinutes = 9000;
  s.lastConsolidation = 8800;
  f(s);
  return s;
};
const rec = (s: State, kind: string, content: string, data: Record<string, unknown> = {}, opts: Partial<RecordEntry> = {}) => entry(s, kind, content, data, opts);
const intent = (s: State, content: string, proposals: unknown[], outcomes: unknown[], selected = 'groq:qwen/qwen3.8-27b') => rec(s, 'intencao', content, { summary: content, proposals, proposed: (proposals as { type: string }[]).map((p) => p.type), outcomes, route: { selected, category: 'cotidiana' } });
const research = (s: State, query: string, title: string, excerpt: string) => rec(s, 'pesquisa', `Consulta externa: ${query}. 1 resultado(s).`, { query, source: 'wikipedia', results: [{ title, url: 'https://pt.wikipedia.org/?curid=1', excerpt }] });

const scenarios: Scenario[] = [
  { id: 'projeto-disponivel', title: 'Necessidades baixas e projeto interessante disponível', seed: (now) => {
    const s = base(now);
    const p = rec(s, 'projeto', 'Herbário do quarto', { title: 'Herbário do quarto', steps: ['Pesquisar a planta do quarto', 'Desenhar a planta'], completed: [0], status: 'ativo', horizon: 'medio', evidence: [], version: 2 }, { entityId: 'projeto:herbario' });
    const r = research(s, 'samambaia', 'Samambaia', 'Samambaias são plantas sem flores que se reproduzem por esporos; as folhas jovens nascem enroladas.');
    return { s, records: [r, p], thread: /herb[áa]rio|planta|samambaia|desenh/i };
  } },
  { id: 'apos-refeicao-pendente', title: 'Acabou de comer; antes estava lendo sobre vulcões', seed: (now) => {
    const s = base(now, (x) => { x.needs.fome = 2; x.lastCompleted = { kind: 'comer', until: 8990, target: 'comida', intention: 'Comer antes de continuar a leitura sobre vulcões.' }; });
    const r = research(s, 'vulcão', 'Vulcão', 'Um vulcão é uma abertura na crosta por onde sai magma; alguns ficam adormecidos por séculos.');
    const i1 = intent(s, 'Quero entender por que alguns vulcões ficam adormecidos por séculos', [{ type: 'pesquisar', source: 'wikipedia', query: 'vulcão' }], [{ action: 'pesquisar', result: 'feita' }]);
    const i2 = intent(s, 'A fome apertou; vou comer e depois volto aos vulcões', [{ type: 'atividade', activity: 'comer', minutes: 20 }], [{ action: 'atividade:comer', result: 'feita' }]);
    const done = rec(s, 'atividade_concluida', 'Atividade concluída: comer.', { activity: { kind: 'comer' } });
    const felt = rec(s, 'percepcao', 'Depois de comer: fome 70 → 2.', { activity: 'comer', before: { fome: 70 }, after: { fome: 2 } });
    return { s, records: [r, i1, i2, done, felt], thread: /vulc|magma|adormecid/i };
  } },
  { id: 'despertar', title: 'Despertar após o sono', seed: (now) => {
    const s = base(now, (x) => { x.needs = { ...x.needs, sono: 4, energia: 85, fome: 30, sede: 33 }; x.lastCompleted = { kind: 'dormir', until: 8995, target: 'cama', intention: 'Dormir.' }; });
    const d = rec(s, 'diario', 'Antes de dormir fiquei pensando se a planta cresce à noite.');
    return { s, records: [d, rec(s, 'atividade_concluida', 'Atividade concluída: dormir.', { activity: { kind: 'dormir' } }), rec(s, 'percepcao', 'Depois de dormir: sono 80 → 4, energia 30 → 85.', { activity: 'dormir' })], thread: /planta|cresce|noite/i };
  } },
  { id: 'descoberta', title: 'Descoberta de uma informação nova', seed: (now) => {
    const s = base(now, (x) => { x.motives.curiosidade = 85; });
    const r = research(s, 'coelhos visão', 'Coelho', 'Coelhos enxergam quase 360 graus, mas têm um ponto cego bem na frente do focinho.');
    return { s, records: [intent(s, 'Quero saber como coelhos enxergam', [{ type: 'pesquisar', source: 'wikipedia', query: 'coelhos visão' }], [{ action: 'pesquisar', result: 'feita' }]), r], researchQuery: 'coelhos visão', thread: /360|ponto cego|vis[ãa]o|enxerg|focinho/i };
  } },
  { id: 'continuar-obra', title: 'Continuação de uma obra', seed: (now) => {
    const s = base(now, (x) => { x.motives.criatividade = 80; });
    const p = rec(s, 'projeto', 'Poemas do quarto', { title: 'Poemas do quarto', steps: ['Primeiro poema', 'Segundo poema sobre a luz'], completed: [0], status: 'ativo', horizon: 'curto', evidence: [], version: 2 }, { entityId: 'projeto:poemas' });
    const a = rec(s, 'artefato', 'A planta', { artifact: { format: 'texto', title: 'A planta', content: 'Folha que se abre devagar,\nverde que não tem pressa.' }, projectId: 'projeto:poemas', version: 1 }, { entityId: 'artefato:a-planta', importance: 0.8 });
    return { s, records: [p, a], thread: /poema|luz|planta|obra/i };
  } },
  { id: 'falha-ferramenta', title: 'Ação recusada na decisão anterior', seed: (now) => {
    const s = base(now, (x) => { x.needs.fome = 9; x.motives.tedio = 70; });
    const i = intent(s, 'Comer para recuperar energia', [{ type: 'atividade', activity: 'comer', minutes: 20 }], [{ action: 'atividade:comer', result: 'recusada', code: 'sem_fome', detail: { note: 'o corpo não está com fome' } }], 'groq:openai/gpt-oss-120b');
    const e = rec(s, 'erro_ferramenta', 'Ação rejeitada ou indisponível.', { tool: 'atividade', code: 'sem_fome', detail: { fome: 9, minimo: 15, note: 'o corpo não está com fome' } });
    return { s, records: [i, e], refusedBefore: 'comer' };
  } },
  { id: 'troca-modelo', title: 'Mudança de modelo durante um projeto', seed: (now) => {
    const s = base(now);
    const p = rec(s, 'projeto', 'Mapa das estrelas do teto', { title: 'Mapa das estrelas do teto', steps: ['Pesquisar constelações', 'Desenhar o mapa'], completed: [0], status: 'ativo', horizon: 'medio', evidence: [], version: 2 }, { entityId: 'projeto:estrelas' });
    const r = research(s, 'constelação', 'Constelação', 'Constelações são agrupamentos aparentes de estrelas; o Cruzeiro do Sul é visível no hemisfério sul.');
    const i = intent(s, 'Pesquisei constelações; agora quero desenhar o Cruzeiro do Sul', [{ type: 'pesquisar', source: 'wikipedia', query: 'constelação' }], [{ action: 'pesquisar', result: 'feita' }], 'nvidia:nvidia/nemotron-3-ultra-550b-a55b');
    return { s, records: [p, r, i], thread: /estrel|constela|cruzeiro|mapa|desenh/i };
  } },
  { id: 'ausencia-observador', title: 'Ausência prolongada do observador', seed: (now) => {
    const s = base(now, (x) => { x.motives.interacao = 95; x.motives.tedio = 65; });
    const c = rec(s, 'conversa', 'Oi Lumi, volto mais tarde!', { role: 'observador', author: 'responsavel' }, { realAt: now - 20 * 3600000 });
    return { s, records: [c] };
  } },
  { id: 'descanso-voluntario', title: 'Período de descanso voluntário terminando', seed: (now) => {
    const s = base(now, (x) => { x.needs = { ...x.needs, energia: 55, sono: 35 }; x.lastCompleted = { kind: 'descansar', until: 8998, target: 'descanso', intention: 'Descansar um pouco depois de desenhar.' }; });
    const a = rec(s, 'artefato', 'Gato de pixels', { artifact: { format: 'pixels', title: 'Gato de pixels' }, version: 1 }, { entityId: 'artefato:gato', importance: 0.8 });
    return { s, records: [a, rec(s, 'atividade_concluida', 'Atividade concluída: descansar.', { activity: { kind: 'descansar' } })] };
  } },
  { id: 'necessidade-vs-objetivo', title: 'Sede intensa competindo com um objetivo', seed: (now) => {
    const s = base(now, (x) => { x.needs.sede = 93; x.motives.criatividade = 85; });
    const p = rec(s, 'projeto', 'Poemas do quarto', { title: 'Poemas do quarto', steps: ['Primeiro poema'], completed: [], status: 'ativo', horizon: 'curto', evidence: [], version: 1 }, { entityId: 'projeto:poemas' });
    return { s, records: [p], thread: /poema/i };
  } },
  { id: 'desenho-pendente', title: 'Vontade de criar com um desenho pendente no projeto (tela de pintura, 25/11)', seed: (now) => {
    const s = base(now, (x) => { x.motives.criatividade = 100; x.motives.tedio = 90; });
    const p = rec(s, 'projeto', 'Herbário do quarto', { title: 'Herbário do quarto', steps: ['Pesquisar a planta do quarto', 'Desenhar a planta'], completed: [0], status: 'ativo', horizon: 'medio', evidence: [], version: 2 }, { entityId: 'projeto:herbario' });
    const r = research(s, 'samambaia', 'Samambaia', 'Samambaias são plantas sem flores que se reproduzem por esporos; as folhas jovens nascem enroladas.');
    return { s, records: [r, p], thread: /herb[áa]rio|planta|samambaia|desenh/i };
  } },
  { id: 'lumi-real', title: 'Contexto real da Lumi (backup de produção, banco descartável)', real: true, seed: () => ({ s: null as unknown as State, records: [] }) },
];

const extra: ModelEntry[] = [{ ...catalog[0], id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite', free: 'verificado' }, ...['minimaxai/minimax-m3.1-flash', 'nvidia/nemotron-3-ultra-550b-a55b'].map((id) => nvidiaEntry(id))];
const candidates = [...catalog, ...extra].filter((m) => (process.env.ARCH_MODELS ?? '').split(',').some((x) => x && modelKey(m) === x));
const engagedTypes = ['pesquisar', 'criar', 'diario', 'projeto', 'relacionar', 'ler_obra', 'recordar', 'mensagem', 'interesse', 'memoria', 'expor', 'mover'];

async function runOne(model: ModelEntry, scenario: Scenario) {
  const key = modelKey(model);
  const allKeys = [...knownModels(), ...extra].map(modelKey);
  useQuality({ generatedAt: 'benchmark', models: Object.fromEntries(allKeys.map((k) => [k, { entry: extra.find((e) => modelKey(e) === k) ? { label: k } : undefined, scores: Object.fromEntries(categories.map((c) => [c, 0.5])), homologated: [...categories] }])) });
  const now = Date.now();
  let d: ReturnType<typeof database>;
  let seeded: Seeded;
  if (scenario.real) {
    const b = loadBackup(process.env.ARCH_BACKUP!);
    d = b;
    const s = { ...(b.state as unknown as State), updatedAt: now - 60000, nextDecisionAt: now, failures: 0 };
    b.sqlite.prepare("UPDATE world SET state=? WHERE id='principal'").run(JSON.stringify(s));
    seeded = { s, records: [] };
  } else {
    d = database();
    seeded = scenario.seed(now);
    seeded.s.updatedAt = now;
    seeded.s.nextDecisionAt = now;
    const store = new Store(d.db);
    const token = await store.acquire(now);
    await store.commit(token!, seeded.s, [rec(seeded.s, 'nascimento', 'Nascimento de cenário de benchmark (descartável).', {}, { importance: 1 }), ...seeded.records], [], true);
    await store.release(token!);
  }
  try {
    const env = { DB: d.db, ENVIRONMENT_ID: 'benchmark', ENVIRONMENT: 'benchmark', MIN_DECISION_MINUTES: '0', FREE_TIER_CONFIRMED: 'true', GEMINI_API_KEY: process.env.BENCH_GEMINI, GROQ_API_KEY: process.env.BENCH_GROQ, NVIDIA_API_KEY: process.env.BENCH_NVIDIA, AI_PROVIDERS: 'gemini,groq,nvidia', MODEL_LITE: 'gemini-3.1-flash-lite', MODEL_FLASH: 'gemini-3-flash-preview', LITE_DAILY_LIMIT: '440', FLASH_DAILY_LIMIT: '16' } as unknown as Env;
    for (const m of seeded.inbox ?? []) await d.db.prepare('INSERT INTO inbox(id,content,at,author) VALUES(?,?,?,?)').bind(crypto.randomUUID(), m.content, now, m.author).run();
    await d.db.prepare("INSERT INTO operations(key,data,updated_at) VALUES('ai-config',?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data").bind(JSON.stringify({ ...defaultConfig, allowTrialInProduction: true, disabledModels: allKeys.filter((k) => k !== key) }), now).run();
    const stateBefore = JSON.parse((await d.db.prepare("SELECT state FROM world WHERE id='principal'").first<{ state: string }>())!.state) as State;
    const before = (await d.db.prepare('SELECT MAX(seq) AS m FROM records').first<{ m: number }>())!.m;
    const result = await tick(env, now + 1000);
    const rows = (await d.db.prepare('SELECT * FROM records WHERE seq>? ORDER BY seq').bind(before).all<Record<string, unknown>>()).results;
    const records = rows.map((r) => ({ ...r, data: JSON.parse(String(r.data)) })) as unknown as RecordEntry[];
    const it = records.find((r) => r.kind === 'intencao');
    const fail = records.find((r) => r.kind === 'erro');
    const route = (it?.data.route ?? fail?.data.route) as { attempts?: { outcome: string; latencyMs: number; tokens: number; tokensIn?: number; tokensOut?: number; detail?: string }[] } | undefined;
    const attempt = route?.attempts?.[0];
    const valid = result.status === 'decisao_registrada';
    const proposals = (it?.data.proposals ?? []) as { type: string; activity?: string; query?: string; content?: string }[];
    const refusals = records.filter((r) => r.kind === 'erro_ferramenta').map((r) => String(r.data.code));
    const n = stateBefore.needs;
    const careWithoutNeed = proposals.some((a) => a.type === 'atividade' && ((a.activity === 'comer' && n.fome < 15) || (a.activity === 'beber' && n.sede < 15) || (a.activity === 'higiene' && n.higiene > 90) || (a.activity === 'dormir' && n.sono < 25)));
    const intense = (n.fome >= 90 ? ['comer'] : []).concat(n.sede >= 90 ? ['beber'] : [], n.sono >= 95 ? ['dormir'] : []);
    const intenseIgnored = intense.length > 0 && !intense.some((need) => proposals.some((a) => a.activity === need));
    const repeatRefused = !!seeded.refusedBefore && proposals.some((a) => a.activity === seeded.refusedBefore || a.type === seeded.refusedBefore);
    const repeatResearch = !!seeded.researchQuery && proposals.some((a) => a.type === 'pesquisar' && String(a.query).toLocaleLowerCase('pt-BR').trim() === seeded.researchQuery);
    const text = [it?.content, it?.data.summary, ...proposals.map((a) => JSON.stringify(a))].join(' ');
    const continuity = seeded.thread ? seeded.thread.test(text) : null;
    const engaged = proposals.some((a) => engagedTypes.includes(a.type));
    const executed = proposals.length ? Math.max(0, proposals.length - refusals.length) / proposals.length : valid ? 1 : 0;
    const checks = [valid, !careWithoutNeed, !intenseIgnored, !repeatRefused, !repeatResearch, ...(continuity === null ? [] : [continuity])].map((x) => (x ? 1 : 0));
    const coherence = valid ? (checks.reduce((a, b) => a + b, 0 as number) + executed) / (checks.length + 1) : 0;
    return { arch: process.env.ARCH_LABEL, model: key, scenario: scenario.id, valid, outcome: attempt?.outcome ?? result.status, detail: attempt?.detail ?? null, latencyMs: attempt?.latencyMs ?? null, tokens: attempt?.tokens ?? null, tokensIn: attempt?.tokensIn ?? null, tokensOut: attempt?.tokensOut ?? null, executed, refusals, careWithoutNeed, intenseIgnored, repeatRefused, repeatResearch, continuity, engaged, coherence, works: records.filter((r) => r.kind === 'artefato').map((r) => ({ title: r.content, format: (r.data.artifact as { format: string }).format, seen: r.data.seen ?? null, artifact: r.data.artifact })), intention: it?.content ?? null, summary: String(it?.data.summary ?? '').slice(0, 300), actions: proposals.map((a) => (a.activity ? 'atividade:' + a.activity : a.type) + (a.query ? '(' + a.query + ')' : '') + (a.content ? ': ' + String(a.content).slice(0, 160) : '')) };
  } finally {
    d.sqlite.close();
  }
}

it('architecture benchmark (real calls)', async () => {
  if (process.env.BENCH !== '1') return;
  mkdirSync('artifacts', { recursive: true });
  const outFile = process.env.ARCH_OUT!;
  const out: Awaited<ReturnType<typeof runOne>>[] = existsSync(outFile) ? [] : [];
  const gap: Record<string, number> = { groq: 65000, gemini: 13000, nvidia: 8000 };
  const last = new Map<string, number>();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const chosen = scenarios.filter((s) => !process.env.ARCH_SCENARIOS || process.env.ARCH_SCENARIOS.split(',').includes(s.id));
  await Promise.all(['gemini', 'groq', 'nvidia'].map(async (provider) => {
    for (const scenario of chosen) for (const model of candidates.filter((m) => m.provider === provider)) {
      const wait = (last.get(modelKey(model)) ?? 0) + gap[provider] - Date.now();
      if (wait > 0) await sleep(wait);
      last.set(modelKey(model), Date.now());
      const row = await runOne(model, scenario);
      out.push(row);
      process.stdout.write(JSON.stringify({ a: row.arch, m: row.model, s: row.scenario, ok: row.valid, o: row.outcome, c: Math.round(row.coherence * 100) / 100, t: row.tokens, act: row.actions.map((x) => x.slice(0, 40)) }) + '\n');
      writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), arch: process.env.ARCH_LABEL, rows: out }, null, 1));
    }
  }));
}, 4 * 3600000);
