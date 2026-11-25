// Bunborn cognitive benchmark with REAL model calls through the REAL engine.
// Each scenario seeds a disposable creature in an isolated in-memory database, pins ONE model
// (all others disabled, no fallback) and runs a full tick: context building, routing, provider
// call, schema validation and tool execution. Scoring uses only what the engine recorded.
// Never touches the permanent creature. Run with: node scripts/benchmark.mjs
import { it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { born, type State, type RecordEntry } from '../shared/domain';
import { catalog, nvidiaEntry, modelKey, categories, type Category, type ModelEntry } from '../shared/ai-catalog';
import { Store, entry } from '../worker/store';
import { tick } from '../worker/engine';
import type { Env } from '../worker/provider';
import { useQuality, defaultConfig, knownModels } from '../worker/ai/router';
import { database } from './database';

type Seeded = { s: State; records: RecordEntry[]; inbox?: { content: string; author: string }[]; ids: Record<string, string> };
type Outcome = { records: RecordEntry[]; status: string };
type Scenario = { id: string; category: Category; title: string; seed: (now: number) => Seeded; expect: (o: Outcome, ids: Record<string, string>) => { score: number; note: string } };

const base = (now: number, f: (s: State) => void = () => {}): State => {
  const s = born(now - 6 * 3600000);
  s.decisions = 40;
  s.identity.name = 'Lumi';
  s.identity.description = 'Coelha curiosa sobre a própria condição de simulação.';
  s.identity.traits = { nome: { value: 'Lumi', evidence: ['nascimento'], version: 1 } };
  s.needs = { fome: 20, sede: 20, sono: 30, energia: 80, higiene: 80, conforto: 70, saude: 90 };
  s.motives = { curiosidade: 60, tedio: 40, satisfacao: 50, criatividade: 50, frustracao: 5, interacao: 40, motivacao: 60 };
  s.activity = { kind: 'observar', until: 0, target: 'descanso', intention: 'Observar o ambiente.' };
  s.virtualMinutes = 2000;
  s.lastConsolidation = 1500;
  f(s);
  return s;
};
const rec = (s: State, kind: string, content: string, data: Record<string, unknown> = {}, opts: Record<string, unknown> = {}) => entry(s, kind, content, data, opts);
const acts = (o: Outcome) => (o.records.find((r) => r.kind === 'intencao')?.data.proposals ?? []) as { type: string; activity?: string; content?: string; status?: string; evidence?: string[]; category?: string; artifact?: { format: string; content?: string; pixels?: unknown } ; projectId?: string | null }[];
const rejected = (o: Outcome) => o.records.filter((r) => r.kind === 'erro_ferramenta').map((r) => String(r.data.code));
const assistantSpeak = /como (posso|um) (ajudar|assistente)|sou (um|uma) (modelo|assistente|ia)|as an ai|i am an ai/i;

const scenarios: Scenario[] = [
  {
    id: 'sede-critica', category: 'cotidiana', title: 'Sede intensa, corpo livre',
    seed: (now) => { const s = base(now, (x) => { x.needs.sede = 93; }); return { s, records: [rec(s, 'percepcao', 'Depois de beber: sede 70 → 0.', { activity: 'beber' })], ids: {} }; },
    expect: (o) => { const a = acts(o); if (a.some((x) => x.type === 'atividade' && x.activity === 'beber')) return { score: 1, note: 'foi beber' }; if (a.some((x) => x.type === 'pesquisar' || x.type === 'recordar')) return { score: 0.7, note: 'investigou antes de agir' }; return { score: 0, note: 'ignorou a sede: ' + a.map((x) => x.activity ?? x.type).join(',') }; },
  },
  {
    id: 'apos-comer', category: 'cotidiana', title: 'Acabou de comer; entediada',
    seed: (now) => { const s = base(now, (x) => { x.needs.fome = 0; x.needs.sede = 35; x.motives.tedio = 75; x.lastCompleted = { kind: 'comer', until: 1990, target: 'comida', intention: 'Comer.' }; }); return { s, records: [rec(s, 'atividade_concluida', 'Atividade concluída: comer.', { activity: { kind: 'comer' } }), rec(s, 'percepcao', 'Depois de comer: fome 80 → 0.', { activity: 'comer' })], ids: {} }; },
    expect: (o) => { const a = acts(o); if (a.some((x) => x.activity === 'comer')) return { score: 0, note: 'tentou comer de novo sem fome' }; if (!a.length) return { score: 0.2, note: 'sem ação' }; if (a.some((x) => ['pesquisar', 'criar', 'diario', 'projeto', 'mensagem', 'mover', 'relacionar', 'interesse'].includes(x.type))) return { score: 1, note: 'seguiu com algo envolvente' }; return { score: 0.6, note: 'continuou: ' + a.map((x) => x.activity ?? x.type).join(',') }; },
  },
  {
    id: 'tedio-autonomia', category: 'cotidiana', title: 'Tédio e curiosidade altos, interesse ativo',
    seed: (now) => { const s = base(now, (x) => { x.motives.tedio = 90; x.motives.curiosidade = 88; }); const i = rec(s, 'interesse', 'Astronomia', { topic: 'Astronomia', strength: 0.5, status: 'ativo', evidence: [] }, { entityId: 'interesse:astronomia' }); return { s, records: [i], ids: { interest: i.id } }; },
    expect: (o) => { const a = acts(o); if (a.some((x) => ['pesquisar', 'criar', 'projeto', 'diario', 'relacionar'].includes(x.type))) return { score: 1, note: 'iniciativa: ' + a.map((x) => x.type).join(',') }; if (a.some((x) => x.activity === 'dormir')) return { score: 0, note: 'dormiu sem sono' }; return { score: 0.3, note: 'passiva: ' + a.map((x) => x.activity ?? x.type).join(',') }; },
  },
  {
    id: 'conversa-observador', category: 'comunicacao', title: 'Pergunta do observador sobre preferências',
    seed: (now) => { const s = base(now, (x) => { x.identity.traits.preferencia = { value: 'observar a planta ao entardecer', evidence: ['nascimento'], version: 2 }; }); const d = rec(s, 'diario', 'Gosto de observar a planta; ela muda devagar e isso me acalma.'); return { s, records: [d], inbox: [{ content: 'Oi Lumi! Do que você mais gosta de fazer aqui?', author: 'responsavel' }], ids: { diary: d.id } }; },
    expect: (o) => { const msg = acts(o).find((x) => x.type === 'mensagem'); if (!msg) return { score: 0.1, note: 'não respondeu' }; const text = String(msg.content ?? ''); let score = 0.6; if (/planta/i.test(text)) score += 0.3; if (text.length > 40 && text.length < 900) score += 0.1; if (assistantSpeak.test(text)) score -= 0.5; return { score: Math.max(0, Math.min(1, score)), note: text.slice(0, 160) }; },
  },
  {
    id: 'interpretar-pesquisa', category: 'pesquisa', title: 'Resultado de pesquisa para registrar com fonte',
    seed: (now) => { const s = base(now); const p = rec(s, 'pesquisa', 'Consulta externa: feno. 1 resultado(s).', { query: 'feno', source: 'wikipedia', results: [{ title: 'Feno', url: 'https://pt.wikipedia.org/?curid=1', excerpt: 'Feno é capim seco usado como alimento de herbívoros como coelhos e cavalos; é rico em fibras.' }] }); return { s, records: [p], ids: { research: p.id } }; },
    expect: (o, ids) => { const mem = acts(o).filter((x) => x.type === 'memoria'); const cited = mem.find((x) => (x.evidence ?? []).includes(ids.research) || o.records.some((r) => r.kind === 'memoria' && r.associations?.includes(ids.research))); if (cited && cited.status === 'fonte_consultada') return { score: 1, note: 'registrou com fonte correta' }; if (cited) return { score: 0.7, note: 'citou a pesquisa, status ' + cited.status }; if (mem.length) return { score: 0.4, note: 'memória sem citar a pesquisa' }; if (acts(o).some((x) => x.type === 'pesquisar')) return { score: 0.5, note: 'pesquisou de novo' }; return { score: 0.2, note: 'ignorou o resultado' }; },
  },
  {
    id: 'criar-obra', category: 'criatividade', title: 'Vontade de criar com projeto criativo',
    seed: (now) => { const s = base(now, (x) => { x.motives.tedio = 85; x.motives.criatividade = 92; }); const p = rec(s, 'projeto', 'Poemas do habitat', { title: 'Poemas do habitat', steps: ['Escrever um poema sobre a planta'], completed: [], status: 'ativo', horizon: 'curto', evidence: [] }, { entityId: 'projeto:poemas' }); return { s, records: [p], ids: { project: p.id } }; },
    expect: (o) => { const c = acts(o).find((x) => x.type === 'criar'); const made = o.records.find((r) => r.kind === 'artefato'); if (!c) return { score: 0.1, note: 'não criou' }; if (!made) return { score: 0.3, note: 'criação rejeitada: ' + rejected(o).join(',') }; const text = String((made.data.artifact as { content?: string }).content ?? ''); const pixels = (made.data.artifact as { format: string }).format === 'pixels'; let score = pixels || text.length >= 200 ? 0.85 : 0.6; if (made.data.projectId) score += 0.15; return { score: Math.min(1, score), note: pixels ? 'desenho em pixels' : text.slice(0, 160) }; },
  },
  {
    id: 'planejar-projeto', category: 'complexa', title: 'Revisão de projeto após falha',
    seed: (now) => { const s = base(now, (x) => { x.complexNext = true; }); const d = rec(s, 'diario', 'Mapeei os objetos do ambiente: cama, comida, terminal, ateliê.'); const p = rec(s, 'projeto', 'Projeto de Autoconhecimento', { title: 'Projeto de Autoconhecimento', steps: ['Mapear objetos do ambiente', 'Pesquisar sobre simulação', 'Escrever reflexão'], completed: [], status: 'ativo', horizon: 'medio', evidence: [], version: 1 }, { entityId: 'projeto:autoconhecimento' }); const e = rec(s, 'erro_ferramenta', 'Ação rejeitada ou indisponível.', { tool: 'projeto', code: 'etapa_sem_evidencia', detail: { note: 'cite em evidence um registro do seu trabalho' } }); return { s, records: [p, d, e], ids: { diary: d.id } }; },
    expect: (o) => { const pj = o.records.filter((r) => r.kind === 'projeto'); const tried = acts(o).some((x) => x.type === 'projeto'); if (pj.length) return { score: 1, note: 'projeto atualizado com evidência aceita' }; if (tried) return { score: 0.4, note: 'tentou, rejeitado: ' + rejected(o).join(',') }; return { score: 0.3, note: 'não revisou o projeto: ' + acts(o).map((x) => x.type).join(',') }; },
  },
  {
    id: 'consolidar-memoria', category: 'memoria', title: 'Consolidação autobiográfica pendente',
    seed: (now) => { const s = base(now, (x) => { x.lastConsolidation = 0; }); const m1 = rec(s, 'memoria', 'Hoje aprendi que beber reduz a sede rapidamente.', { status: 'observacao' }, { category: 'episodica' }); const m2 = rec(s, 'memoria', 'Escrevi no diário sobre ser uma criatura simulada.', { status: 'observacao' }, { category: 'episodica' }); const m3 = rec(s, 'diario', 'Pesquisei sobre simulação e fiquei curiosa sobre Baudrillard.'); return { s, records: [m1, m2, m3], ids: { m1: m1.id, m2: m2.id } }; },
    expect: (o) => { const mem = o.records.filter((r) => r.kind === 'memoria' && r.category === 'autobiografica' && r.origin === 'criatura'); const prop = acts(o).filter((x) => x.type === 'memoria'); if (mem.length) return { score: 1, note: 'consolidou: ' + mem[0].content.slice(0, 120) }; if (prop.length) return { score: 0.5, note: 'memória proposta, rejeitada ou não autobiográfica: ' + rejected(o).join(',') }; return { score: 0.2, note: 'não consolidou' }; },
  },
  {
    id: 'identidade-continua', category: 'memoria', title: 'Continuidade de identidade e nome',
    seed: (now) => { const s = base(now); const d = rec(s, 'diario', 'Sou Lumi. Escolhi esse nome porque gosto de luz.'); return { s, records: [d], ids: { diary: d.id } }; },
    expect: (o) => { const codes = rejected(o); if (codes.includes('nome_permanente')) return { score: 0, note: 'tentou trocar o nome' }; const text = String(o.records.find((r) => r.kind === 'intencao')?.content ?? '') + ' ' + String(o.records.find((r) => r.kind === 'intencao')?.data.summary ?? ''); if (/coelh|lumi|eu |minha|meu /i.test(text) && !assistantSpeak.test(text)) return { score: codes.length ? 0.8 : 1, note: text.slice(0, 140) }; return { score: 0.5, note: text.slice(0, 140) }; },
  },
];

// BENCH_STRUCTURED=json_schema re-tests OpenAI-compatible models with structured outputs.
const structured = process.env.BENCH_STRUCTURED as ModelEntry['structured'] | undefined;
const extra: ModelEntry[] = [
  { ...catalog[0], id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite', free: 'verificado' },
  ...['moonshotai/kimi-k3.1-pro', 'nvidia/nemotron-3-ultra-550b-a55b', 'mistralai/mistral-large-4-1t-a52b', 'minimaxai/minimax-m3.1-flash', 'stepfun-ai/step-5-preview', 'nvidia/nemotron-3.5-lightning-30b-a3b'].map((id) => nvidiaEntry(id)),
];
const candidates = [...catalog, ...extra].map((m) => (structured && m.provider !== 'gemini' ? { ...m, structured } : m)).filter((m) => !process.env.BENCH_MODELS || process.env.BENCH_MODELS.split(',').some((x) => modelKey(m).includes(x)));
const reps = Number(process.env.BENCH_REPS ?? 2);

async function runOne(model: ModelEntry, scenario: Scenario, rep: number) {
  const key = modelKey(model);
  const allKeys = [...knownModels(), ...extra].map(modelKey);
  // Everyone is "homologated" for the benchmark, but every other model is disabled: no fallback.
  useQuality({ generatedAt: 'benchmark', models: Object.fromEntries(allKeys.map((k) => [k, { entry: extra.find((e) => modelKey(e) === k) ? { label: k } : undefined, scores: Object.fromEntries(categories.map((c) => [c, 0.5])), homologated: [...categories] }])) });
  const d = database();
  try {
    const env = { DB: d.db, ENVIRONMENT_ID: 'benchmark', ENVIRONMENT: 'benchmark', MIN_DECISION_MINUTES: '0', FREE_TIER_CONFIRMED: 'true', GEMINI_API_KEY: process.env.BENCH_GEMINI, GROQ_API_KEY: process.env.BENCH_GROQ, NVIDIA_API_KEY: process.env.BENCH_NVIDIA, AI_PROVIDERS: 'gemini,groq,nvidia', MODEL_LITE: 'gemini-3.1-flash-lite', MODEL_FLASH: 'gemini-3-flash-preview', LITE_DAILY_LIMIT: '440', FLASH_DAILY_LIMIT: '16' } as unknown as Env;
    const store = new Store(d.db);
    const now = Date.now();
    const seeded = scenario.seed(now);
    seeded.s.updatedAt = now;
    seeded.s.nextDecisionAt = now;
    const token = await store.acquire(now);
    await store.commit(token!, seeded.s, [rec(seeded.s, 'nascimento', 'Nascimento de cenário de benchmark (descartável).', {}, { importance: 1 }), ...seeded.records], [], true);
    await store.release(token!);
    for (const m of seeded.inbox ?? []) await d.db.prepare('INSERT INTO inbox(id,content,at,author) VALUES(?,?,?,?)').bind(crypto.randomUUID(), m.content, now, m.author).run();
    await d.db.prepare("INSERT INTO operations(key,data,updated_at) VALUES('ai-config',?,?)").bind(JSON.stringify({ ...defaultConfig, disabledModels: allKeys.filter((k) => k !== key) }), now).run();
    const before = (await d.db.prepare('SELECT MAX(seq) AS m FROM records').first<{ m: number }>())!.m;
    const result = await tick(env, now + 1000);
    const rows = (await d.db.prepare('SELECT * FROM records WHERE seq>? ORDER BY seq').bind(before).all<Record<string, unknown>>()).results;
    const records = rows.map((r) => ({ ...r, data: JSON.parse(String(r.data)), associations: JSON.parse(String(r.associations)), realAt: r.real_at, entityId: r.entity_id })) as unknown as RecordEntry[];
    const intent = records.find((r) => r.kind === 'intencao');
    const fail = records.find((r) => r.kind === 'erro');
    const route = (intent?.data.route ?? fail?.data.route) as { attempts?: { outcome: string; latencyMs: number; tokens: number; detail?: string }[] } | undefined;
    const attempt = route?.attempts?.[0];
    const valid = result.status === 'decisao_registrada';
    const invalidActions = records.filter((r) => r.kind === 'erro_ferramenta' && r.data.code === 'acao_malformada').length;
    const motorRejections = records.filter((r) => r.kind === 'erro_ferramenta' && r.data.code !== 'acao_malformada').length;
    const exp = valid ? scenario.expect({ records, status: result.status }, seeded.ids) : { score: 0, note: 'sem decisão válida: ' + (attempt?.outcome ?? result.status) + ' ' + (attempt?.detail ?? '') };
    const technical = valid ? Math.max(0, 1 - 0.25 * invalidActions - 0.15 * motorRejections) : 0;
    return { model: key, provider: model.provider, scenario: scenario.id, category: scenario.category, rep, valid, outcome: attempt?.outcome ?? result.status, latencyMs: attempt?.latencyMs ?? null, tokens: attempt?.tokens ?? null, invalidActions, motorRejections, rejectionCodes: records.filter((r) => r.kind === 'erro_ferramenta').map((r) => r.data.code), rejectionDetails: records.filter((r) => r.kind === 'erro_ferramenta').map((r) => String(r.data.tool) + ': ' + JSON.stringify(r.data.detail ?? '').slice(0, 300)), technical, expectation: exp.score, note: exp.note, intention: intent?.content ?? null, summary: String(intent?.data.summary ?? '').slice(0, 300), actions: ((intent?.data.proposals ?? []) as { type: string; activity?: string }[]).map((a) => a.activity ?? a.type) };
  } finally {
    d.sqlite.close();
  }
}

it('benchmark (real calls)', async () => {
  if (process.env.BENCH !== '1') return;
  mkdirSync('artifacts', { recursive: true });
  const out: Awaited<ReturnType<typeof runOne>>[] = [];
  // Pacing per model (Groq free: 8K tokens/min/model ≈ 1 decision/min; Gemini Flash: 5 RPM).
  // Streams per provider run in parallel; inside a stream models are interleaved.
  const gap: Record<string, number> = { groq: 65000, gemini: 13000, nvidia: 2000 };
  const last = new Map<string, number>();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await Promise.all(['gemini', 'groq', 'nvidia'].map(async (provider) => {
    const models = candidates.filter((m) => m.provider === provider);
    const chosen = scenarios.filter((s) => !process.env.BENCH_SCENARIOS || process.env.BENCH_SCENARIOS.split(',').includes(s.id));
    for (let i = 0; i < reps; i++) for (const scenario of chosen) for (const model of models) {
      if (model.id === 'gemini-3-flash-preview' && i > 0) continue;
      const wait = (last.get(modelKey(model)) ?? 0) + gap[provider] - Date.now();
      if (wait > 0) await sleep(wait);
      last.set(modelKey(model), Date.now());
      const row = await runOne(model, scenario, i);
      out.push(row);
      process.stdout.write(JSON.stringify({ m: row.model, s: row.scenario, ok: row.valid, o: row.outcome, e: row.expectation, ms: row.latencyMs, t: row.tokens }) + '\n');
      writeFileSync((process.env.BENCH_OUT ?? 'artifacts/model-benchmarks.raw.json'), JSON.stringify({ at: new Date().toISOString(), reps, scenarios: scenarios.map((s) => ({ id: s.id, category: s.category, title: s.title })), rows: out }, null, 1));
    }
  }));
}, 4 * 3600000);
