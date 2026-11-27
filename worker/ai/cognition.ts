// Multiprovider cognition: one decision = one logical request, routed to the most suitable
// homologated model, with bounded fallback (max 3 attempts) and no effects applied until the
// engine receives a valid decision. Identity always comes from Bunborn's persisted state (the
// context), never from a provider-side session.
import { creatableArtifactSchema, strokeSchema, parseDecision, quotaDay, type Artifact, type Decision, type InvalidAction } from '../../shared/domain';
import toolContracts from '../../shared/tool-contracts.json';
import { modelKey, type Category, type ModelEntry } from '../../shared/ai-catalog';
import compiledDecisionSchema from '../../shared/decision.schema.json';
import { Store } from '../store';
import { CognitiveError, instructionsFor, systemFor, type Env } from '../provider';
import { callModel, extractJson, ProviderFailure, type Keys } from './adapters';
import { freshHealth, loadHealth, onFailure, onSuccess, saveHealth, type Health } from './health';
import { defaultConfig, knownModels, PAINTER, rankModels, type AiConfig, type Usage } from './router';
import { estimateInput, maxOutputFor } from '../../shared/token-budget';
/** Ledger writes never mask the decision or the original error (audit 25/11). */
async function safely(db: D1Database, what: string, work: () => Promise<unknown>) {
  try {
    await work();
  } catch (e) {
    await db.prepare('INSERT INTO operations(key,data,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').bind('ledger-error:' + what, JSON.stringify({ error: String((e as Error)?.message ?? e).slice(0, 300) }), Date.now()).run().catch(() => undefined);
  }
}

export type RouteAttempt = { model: string; provider: string; outcome: 'aceita' | string; latencyMs: number; tokens: number; tokensIn?: number; tokensOut?: number; estimatedIn?: number; maxOutput?: number; detail?: string };
export type RouteRecord = {
  category: Category;
  categoryReason: string;
  selected: string | null;
  provider: string | null;
  reasons: string[];
  eligible: { model: string; score: number }[];
  excluded: { key: string; reason: string }[];
  attempts: RouteAttempt[];
  fallbacks: number;
  tokens: number;
  latencyMs: number;
  validation: string;
};
export type RoutedDecision = { decision: Decision; model: string; invalidActions: InvalidAction[]; route: RouteRecord };

export function providerKeys(env: Env): Keys {
  const enabled = (env.AI_PROVIDERS ?? 'gemini').split(',').map((s) => s.trim());
  return {
    gemini: enabled.includes('gemini') && env.FREE_TIER_CONFIRMED === 'true' ? env.GEMINI_API_KEY : undefined,
    groq: enabled.includes('groq') ? env.GROQ_API_KEY : undefined,
    nvidia: enabled.includes('nvidia') ? env.NVIDIA_API_KEY : undefined,
  };
}
export async function loadConfig(db: D1Database): Promise<AiConfig> {
  const row = await db.prepare("SELECT data FROM operations WHERE key='ai-config'").first<{ data: string }>();
  try {
    return { ...defaultConfig, ...(row ? JSON.parse(row.data) : {}) };
  } catch {
    return defaultConfig;
  }
}
const dayFor = (m: ModelEntry, now: number) => (m.provider === 'gemini' ? quotaDay(now) : new Date(now).toISOString().slice(0, 10));
async function usageMap(store: Store, budget: Store, now: number) {
  const rows = [...((await store.usage()) as { day: string; model: string; calls: number; tokens: number }[])];
  const global = budget === store ? rows : ((await budget.usage()) as typeof rows);
  return (m: ModelEntry): Usage => {
    const day = dayFor(m, now);
    const pick = (list: typeof rows) => list.find((r) => r.day === day && r.model === m.id) ?? { calls: 0, tokens: 0 };
    const local = pick(rows), shared = pick(global);
    return { callsToday: Math.max(local.calls, shared.calls), tokensToday: Math.max(local.tokens, shared.tokens) };
  };
}

export class RoutedProvider {
  constructor(private env: Env, private store: Store, private fetcher: typeof fetch = fetch, private systemAddon = '') {}
  async decide(context: unknown, complex: boolean, now: number, hint?: { category: Category; categoryReason: string; lastModel?: { key: string; category: Category } | null; hasMessages?: boolean; creativeRoom?: boolean }): Promise<RoutedDecision> {
    const category: Category = hint?.category ?? (complex ? 'complexa' : 'cotidiana');
    const keys = providerKeys(this.env);
    const availableProviders = Object.entries(keys).filter(([, k]) => !!k).map(([p]) => p);
    if (!availableProviders.length) throw new CognitiveError('configuracao_pendente', 3600000);
    const config = await loadConfig(this.store.db);
    const health = await loadHealth(this.store.db);
    const budget = this.env.BUDGET_DB ? new Store(this.env.BUDGET_DB) : this.store;
    const usage = await usageMap(this.store, budget, now);
    // Reservations left open by an interrupted Worker are settled conservatively before routing.
    await safely(this.store.db, 'orphans-local', () => this.store.reconcileOrphans(now));
    if (budget !== this.store) await safely(this.store.db, 'orphans-global', () => budget.reconcileOrphans(now));
    const prompt = JSON.stringify(context);
    const system = systemFor((context as { facts?: { decisionNumber?: number } }).facts?.decisionNumber ?? 1, this.systemAddon);
    // Input estimated per model family from real calls (tokenizers differ); see shared/token-budget.ts.
    const bytes = new TextEncoder().encode(prompt + system).length;
    const inputFor = (m: ModelEntry) => estimateInput(bytes, m);
    const estimatedInput = Math.ceil(bytes / 3.2);
    const estimatedTokens = estimatedInput + 800;
    if (estimatedTokens > 60000) throw new CognitiveError('contexto_excessivo');
    const environment = this.env.ENVIRONMENT_ID ?? this.env.ENVIRONMENT;
    const rankInput = { models: knownModels(), health, usage, config, environment, availableProviders, now, estimatedTokens, inputFor };
    const { ranked: primary, excluded } = rankModels({ ...rankInput, category, lastModel: hint?.lastModel });
    // If every model of this category fails, the best everyday models continue the same decision.
    const general = category === 'cotidiana' ? [] : rankModels({ ...rankInput, category: 'cotidiana', lastModel: null }).ranked.filter((g) => !primary.some((p) => p.key === g.key)).map((g) => ({ ...g, reasons: ['alternativa geral (homologado em cotidiana) após falhas em ' + category, ...g.reasons] }));
    const ranked = [...primary, ...general];
    const route: RouteRecord = { category, categoryReason: hint?.categoryReason ?? '', selected: null, provider: null, reasons: [], eligible: ranked.map((c) => ({ model: c.key, score: Math.round(c.score * 1000) / 1000 })), excluded, attempts: [], fallbacks: 0, tokens: 0, latencyMs: 0, validation: 'sem resposta' };
    const reasoning = category === 'complexa' || category === 'criatividade' ? 'medio' : 'baixo';
    // A reply cut off by max_tokens usually means a long work (a painting, a long text): the next
    // model gets the room of a creative decision (25/11: NVIDIA truncated mid-drawing).
    let truncated = false;
    for (const candidate of ranked.slice(0, 3)) {
      const m = candidate.model;
      const key = candidate.key;
      const h: Health = health.get(key) ?? freshHealth(key);
      const day = dayFor(m, now);
      const rpd = Math.min(m.limits.rpd, config.dailyCaps[key] ?? Infinity);
      // Keep ~10% of each model's day for pending conversations.
      const daily = hint?.hasMessages ? rpd : Math.floor(rpd * 0.9);
      const inTokens = inputFor(m);
      const maxOutput = maxOutputFor(m, truncated || hint?.creativeRoom ? 'criatividade' : category, inTokens);
      // Reserve what the provider will count: input plus the output room requested.
      const reserveTokens = inTokens + maxOutput;
      const local = await this.store.reserve(m.id, day, now, daily, m.limits.rpm, reserveTokens, environment, m.limits.tpm, m.limits.tpd, m.provider, category);
      if (!local) { route.attempts.push({ model: key, provider: m.provider, outcome: 'orcamento_local', latencyMs: 0, tokens: 0 }); continue; }
      let shared: string | null = null;
      if (budget !== this.store) {
        try {
          shared = await budget.reserve(m.id, day, now, rpd, m.limits.rpm, reserveTokens, environment, m.limits.tpm, m.limits.tpd, m.provider, category);
        } catch (e) {
          // The global ledger is unreachable: release the local slot and do not call (never above limits).
          await safely(this.store.db, 'settle-local', () => this.store.settle(local, 0, 'falha_orcamento_global'));
          route.attempts.push({ model: key, provider: m.provider, outcome: 'orcamento_global_indisponivel', latencyMs: 0, tokens: 0, detail: String((e as Error)?.message ?? e).slice(0, 160) });
          continue;
        }
        if (!shared) { await safely(this.store.db, 'settle-local', () => this.store.settle(local, 0, 'negada_global')); route.attempts.push({ model: key, provider: m.provider, outcome: 'orcamento_global', latencyMs: 0, tokens: 0 }); continue; }
      }
      const started = Date.now();
      let tokens = 0, tokensIn = 0, tokensOut = 0, status = 'falha';
      try {
        const reply = await callModel(m, { system, prompt, // Gemini: JSON mode without a schema (the 30-action union has "too many states" for it, 27/11);
        // the contracts are in the prompt and the engine validates every action as always.
        schema: m.provider === 'gemini' ? null : compiledDecisionSchema, maxOutput, reasoning }, keys, this.fetcher);
        tokens = reply.tokensTotal;
        tokensIn = reply.tokensIn;
        tokensOut = reply.tokensOut;
        let parsed: ReturnType<typeof parseDecision>;
        try {
          parsed = parseDecision(extractJson(reply.text));
        } catch (e) {
          throw new ProviderFailure('resposta_invalida', 200, null, e instanceof ProviderFailure ? e.detail : 'esquema: ' + String((e as Error).message).slice(0, 200));
        }
        status = 'sucesso';
        const next = onSuccess(h, reply.latencyMs, now, parsed.invalidActions.length);
        await saveHealth(this.store.db, next, now);
        route.attempts.push({ model: key, provider: m.provider, outcome: 'aceita', latencyMs: reply.latencyMs, tokens, tokensIn, tokensOut, estimatedIn: inTokens, maxOutput });
        route.selected = key;
        route.provider = m.provider;
        route.reasons = candidate.reasons;
        route.tokens += tokens;
        route.latencyMs += reply.latencyMs;
        route.fallbacks = route.attempts.length - 1;
        route.validation = parsed.invalidActions.length ? `válida com ${parsed.invalidActions.length} ação(ões) malformada(s) rejeitada(s)` : 'válida';
        return { decision: parsed.decision, model: m.id, invalidActions: parsed.invalidActions, route };
      } catch (e) {
        const f = e instanceof ProviderFailure ? e : new ProviderFailure('resposta_invalida', 0, null, String((e as Error)?.message ?? e).slice(0, 200));
        const partial = (e as { reply?: { tokensTotal?: number; tokensIn?: number; tokensOut?: number } }).reply;
        tokens = partial?.tokensTotal ?? tokens;
        tokensIn = partial?.tokensIn ?? tokensIn;
        tokensOut = partial?.tokensOut ?? tokensOut;
        status = f.kind;
        if (/resposta truncada|MAX_TOKENS/.test(f.detail)) truncated = true;
        // A request we sized too large for the provider is our fault, not the model's: no health penalty.
        const sizing = f.kind === 'requisicao_invalida' && /too large/i.test(f.detail);
        if (!sizing) await saveHealth(this.store.db, onFailure(h, f.kind, f.detail, now, f.retryAfterMs), now);
        route.attempts.push({ model: key, provider: m.provider, outcome: f.kind, latencyMs: Date.now() - started, tokens, tokensIn, tokensOut, estimatedIn: inTokens, maxOutput, detail: f.detail.slice(0, 160) });
        route.tokens += tokens;
        route.latencyMs += Date.now() - started;
      } finally {
        // A failed ledger write is recorded but never discards a valid decision nor hides the original error.
        const elapsed = Date.now() - started;
        await safely(this.store.db, 'settle-local', () => this.store.settle(local, tokens, status, elapsed));
        if (shared) { const id = shared; await safely(this.store.db, 'settle-global', () => budget.settle(id, tokens, status, elapsed)); }
      }
    }
    route.fallbacks = Math.max(0, route.attempts.length - 1);
    // Nothing callable or every attempt failed: suspend cognition safely and say why.
    const probes = [...(await loadHealth(this.store.db)).values()].map((x) => x.next_probe_at).filter((t) => t > now);
    const retry = Math.max(120000, Math.min(1800000, (probes.length ? Math.min(...probes) : now + 600000) - now));
    const error = new CognitiveError(ranked.length ? 'cognicao_indisponivel' : 'nenhum_modelo_elegivel', retry, JSON.stringify(route).slice(0, 4000));
    (error as CognitiveError & { route?: RouteRecord }).route = route;
    throw error;
  }

  /**
   * Paints a work she decided to make, always with the painter model (observer's decision, 26/11:
   * every drawing of hers is made by Nemotron Ultra). The decision itself (to paint, the title,
   * the motivation) stays the deciding model's; only the painting is requested here, with the
   * same identity, rules and context. Same budget, health and eligibility checks as a decision;
   * one attempt, no fallback to another painter.
   */
  async paint(context: unknown, request: { title: string; motivation: string }, now: number): Promise<{ artifact: Painting; attempt: RouteAttempt }> {
    const keys = providerKeys(this.env);
    const availableProviders = Object.entries(keys).filter(([, k]) => !!k).map(([p]) => p);
    const config = await loadConfig(this.store.db);
    const health = await loadHealth(this.store.db);
    const budget = this.env.BUDGET_DB ? new Store(this.env.BUDGET_DB) : this.store;
    const usage = await usageMap(this.store, budget, now);
    const decisionNumber = (context as { facts?: { decisionNumber?: number } }).facts?.decisionNumber ?? 1;
    const system = instructionsFor(decisionNumber) + '\nContrato da pintura (obrigatório):\n' + JSON.stringify(paintingContract()) + '\n' + paintShape + '\n' + this.systemAddon;
    const prompt = JSON.stringify(context) + '\n\nPintura que você decidiu fazer agora: ' + JSON.stringify(request);
    const bytes = new TextEncoder().encode(prompt + system).length;
    const inputFor = (m: ModelEntry) => estimateInput(bytes, m);
    const environment = this.env.ENVIRONMENT_ID ?? this.env.ENVIRONMENT;
    const { ranked, excluded } = rankModels({ models: knownModels(), health, usage, config, environment, availableProviders, now, estimatedTokens: Math.ceil(bytes / 3.2) + 800, inputFor, category: 'criatividade', lastModel: null });
    const candidate = ranked.find((c) => c.key === PAINTER);
    if (!candidate) throw new Error('pintor indisponível: ' + (excluded.find((e) => e.key === PAINTER)?.reason ?? 'sem chave ou desativado'));
    const m = { ...candidate.model, maxOutput: Math.max(candidate.model.maxOutput, PAINT_OUTPUT) };
    const h: Health = health.get(PAINTER) ?? freshHealth(PAINTER);
    const day = dayFor(m, now);
    const rpd = Math.min(m.limits.rpd, config.dailyCaps[PAINTER] ?? Infinity);
    const inTokens = inputFor(m);
    // A detailed painting used 3824 of 4096 output tokens and another truncated (26/11): more room.
    const maxOutput = Math.max(PAINT_OUTPUT, maxOutputFor(m, 'criatividade', inTokens));
    const local = await this.store.reserve(m.id, day, now, Math.floor(rpd * 0.9), m.limits.rpm, inTokens + maxOutput, environment, m.limits.tpm, m.limits.tpd, m.provider, 'criatividade');
    if (!local) throw new Error('orçamento local do pintor');
    let shared: string | null = null;
    if (budget !== this.store) {
      try {
        shared = await budget.reserve(m.id, day, now, rpd, m.limits.rpm, inTokens + maxOutput, environment, m.limits.tpm, m.limits.tpd, m.provider, 'criatividade');
      } catch {
        shared = null;
      }
      if (!shared) {
        await safely(this.store.db, 'settle-local', () => this.store.settle(local, 0, 'negada_global'));
        throw new Error('orçamento global do pintor');
      }
    }
    const started = Date.now();
    let tokens = 0, tokensIn = 0, tokensOut = 0, status = 'falha';
    try {
      const reply = await callModel(m, { system, prompt, schema: paintingSchema(), maxOutput, reasoning: 'medio' }, keys, this.fetcher, PAINT_TIMEOUT_MS);
      tokens = reply.tokensTotal; tokensIn = reply.tokensIn; tokensOut = reply.tokensOut;
      const json = extractJson(reply.text) as { artifact?: unknown; format?: unknown } | null;
      const { artifact, dropped, why } = readPainting(json?.artifact ?? (json?.format === 'pintura' ? json : undefined));
      if (!artifact) throw new ProviderFailure('resposta_invalida', 200, null, 'pintura fora do contrato: ' + why);
      status = 'sucesso';
      await saveHealth(this.store.db, onSuccess(h, reply.latencyMs, now, 0), now);
      return { artifact, attempt: { model: PAINTER, provider: m.provider, outcome: 'aceita', latencyMs: reply.latencyMs, tokens, tokensIn, tokensOut, estimatedIn: inTokens, maxOutput, ...(dropped ? { detail: dropped + ' traço(s) fora do contrato descartado(s)' } : {}) } };
    } catch (e) {
      const f = e instanceof ProviderFailure ? e : new ProviderFailure('resposta_invalida', 0, null, String((e as Error)?.message ?? e).slice(0, 200));
      tokens = (e as { reply?: { tokensTotal?: number } }).reply?.tokensTotal ?? tokens;
      status = f.kind;
      await saveHealth(this.store.db, onFailure(h, f.kind, f.detail, now, f.retryAfterMs), now);
      throw f;
    } finally {
      const elapsed = Date.now() - started;
      await safely(this.store.db, 'settle-local', () => this.store.settle(local, tokens, status, elapsed));
      if (shared) {
        const id = shared;
        await safely(this.store.db, 'settle-global', () => budget.settle(id, tokens, status, elapsed));
      }
    }
  }
}
type Painting = Extract<Artifact, { format: 'pintura' }>;
// Nemotron paints in 23–43 s; a decision allows 45 s, a painting a little more (26/11 tests).
const PAINT_TIMEOUT_MS = 75000;
const PAINT_OUTPUT = 6144;
/**
 * One malformed stroke (an ellipse with "y" instead of "cy") used to discard a 17-stroke painting
 * (26/11). Invalid strokes are dropped; the painting stands if at least one stroke is valid.
 */
export function readPainting(raw: unknown): { artifact: Painting | null; dropped: number; why: string } {
  const whole = creatableArtifactSchema.safeParse(raw);
  if (whole.success) return whole.data.format === 'pintura' ? { artifact: whole.data, dropped: 0, why: '' } : { artifact: null, dropped: 0, why: 'formato ' + whole.data.format };
  const r = raw as { format?: unknown; strokes?: unknown } | null;
  if (!r || typeof r !== 'object') return { artifact: null, dropped: 0, why: 'sem objeto artifact' };
  if (r.format !== 'pintura' || !Array.isArray(r.strokes)) return { artifact: null, dropped: 0, why: 'format=' + String(r.format).slice(0, 20) + ', strokes ' + (Array.isArray(r.strokes) ? 'ok' : 'ausente') };
  const strokes = r.strokes.filter((x) => strokeSchema.safeParse(x).success);
  const again = creatableArtifactSchema.safeParse({ ...r, strokes: strokes.slice(0, 160) });
  if (again.success && again.data.format === 'pintura') return { artifact: again.data, dropped: r.strokes.length - strokes.length, why: '' };
  const issue = again.error?.issues[0];
  return { artifact: null, dropped: 0, why: issue ? issue.path.join('.') + ' ' + issue.message : 'inválida' };
}
const paintShape = 'Formato obrigatório da resposta: um único objeto JSON {"artifact": <a pintura conforme o contrato>}. Sem texto fora do JSON.';
/** The painting branch of the creation contract, from the precompiled manifest. */
function paintingContract() {
  const criar = (toolContracts as Record<string, unknown>[]).find((c) => c.type === 'criar') as { artifact: Record<string, unknown[]> };
  return Object.values(criar.artifact)[0].find((o) => (o as { format?: string }).format === 'pintura');
}
type SchemaNode = { const?: string; anyOf?: SchemaNode[]; properties?: Record<string, SchemaNode> };
/** The painting branch of the precompiled JSON schema, for providers with structured output. */
function paintingSchema() {
  const actions = (compiledDecisionSchema as unknown as { properties: { actions: { items: SchemaNode } } }).properties.actions.items.anyOf!;
  const criar = actions.find((a) => a.properties?.type?.const === 'criar')!;
  const pintura = criar.properties!.artifact.anyOf!.find((o) => o.properties?.format?.const === 'pintura');
  return { type: 'object', properties: { artifact: pintura }, required: ['artifact'] };
}
export { modelKey };
