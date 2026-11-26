// Multiprovider cognition: one decision = one logical request, routed to the most suitable
// homologated model, with bounded fallback (max 3 attempts) and no effects applied until the
// engine receives a valid decision. Identity always comes from Bunborn's persisted state (the
// context), never from a provider-side session.
import { parseDecision, quotaDay, type Decision, type InvalidAction } from '../../shared/domain';
import { modelKey, type Category, type ModelEntry } from '../../shared/ai-catalog';
import compiledDecisionSchema from '../../shared/decision.schema.json';
import { Store } from '../store';
import { CognitiveError, systemFor, type Env } from '../provider';
import { callModel, extractJson, ProviderFailure, type Keys } from './adapters';
import { freshHealth, loadHealth, onFailure, onSuccess, saveHealth, type Health } from './health';
import { defaultConfig, knownModels, rankModels, type AiConfig, type Usage } from './router';
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
        const reply = await callModel(m, { system, prompt, schema: compiledDecisionSchema, maxOutput, reasoning }, keys, this.fetcher);
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
}
export { modelKey };
