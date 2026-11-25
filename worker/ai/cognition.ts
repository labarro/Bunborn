// Multiprovider cognition: one decision = one logical request, routed to the most suitable
// homologated model, with bounded fallback (max 3 attempts) and no effects applied until the
// engine receives a valid decision. Identity always comes from Bunborn's persisted state (the
// context), never from a provider-side session.
import { parseDecision, quotaDay, type Decision, type InvalidAction } from '../../shared/domain';
import { modelKey, type Category, type ModelEntry } from '../../shared/ai-catalog';
import compiledDecisionSchema from '../../shared/decision.schema.json';
import toolContracts from '../../shared/tool-contracts.json';
import { Store } from '../store';
import { CognitiveError, systemInstruction, type Env } from '../provider';
import { callModel, extractJson, ProviderFailure, type Keys } from './adapters';
import { freshHealth, loadHealth, onFailure, onSuccess, saveHealth, type Health } from './health';
import { defaultConfig, knownModels, rankModels, type AiConfig, type Usage } from './router';

export type RouteAttempt = { model: string; provider: string; outcome: 'aceita' | string; latencyMs: number; tokens: number; detail?: string };
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
const jsonShape = 'Formato obrigatório da resposta: um único objeto JSON {"intention": string<=160, "summary": string, "nextMinutes": inteiro 3..60, "complexNext": boolean, "actions": [no máximo 3 ações conforme os contratos]}. Sem texto fora do JSON.';

export class RoutedProvider {
  constructor(private env: Env, private store: Store, private fetcher: typeof fetch = fetch, private systemAddon = '') {}
  async decide(context: unknown, complex: boolean, now: number, hint?: { category: Category; categoryReason: string; lastModel?: { key: string; category: Category } | null; hasMessages?: boolean }): Promise<RoutedDecision> {
    const category: Category = hint?.category ?? (complex ? 'complexa' : 'cotidiana');
    const keys = providerKeys(this.env);
    const availableProviders = Object.entries(keys).filter(([, k]) => !!k).map(([p]) => p);
    if (!availableProviders.length) throw new CognitiveError('configuracao_pendente', 3600000);
    const config = await loadConfig(this.store.db);
    const health = await loadHealth(this.store.db);
    const budget = this.env.BUDGET_DB ? new Store(this.env.BUDGET_DB) : this.store;
    const usage = await usageMap(this.store, budget, now);
    const prompt = JSON.stringify(context);
    const system = systemInstruction + '\nContratos tipados das ferramentas (obrigatórios; cada ação é um objeto plano com type e os demais campos, NÃO use parameters ou args):\n' + JSON.stringify(toolContracts) + '\n' + jsonShape + '\n' + this.systemAddon;
    // ~4 bytes/token measured on real calls (Portuguese JSON); +800 for the typical reply.
    const estimatedInput = Math.ceil(new TextEncoder().encode(prompt + system).length / 4);
    const estimatedTokens = estimatedInput + 800;
    if (estimatedTokens > 60000) throw new CognitiveError('contexto_excessivo');
    const environment = this.env.ENVIRONMENT_ID ?? this.env.ENVIRONMENT;
    const rankInput = { models: knownModels(), health, usage, config, environment, availableProviders, now, estimatedTokens };
    const { ranked: primary, excluded } = rankModels({ ...rankInput, category, lastModel: hint?.lastModel });
    // If every model of this category fails, the best everyday models continue the same decision.
    const general = category === 'cotidiana' ? [] : rankModels({ ...rankInput, category: 'cotidiana', lastModel: null }).ranked.filter((g) => !primary.some((p) => p.key === g.key)).map((g) => ({ ...g, reasons: ['alternativa geral (homologado em cotidiana) após falhas em ' + category, ...g.reasons] }));
    const ranked = [...primary, ...general];
    const route: RouteRecord = { category, categoryReason: hint?.categoryReason ?? '', selected: null, provider: null, reasons: [], eligible: ranked.map((c) => ({ model: c.key, score: Math.round(c.score * 1000) / 1000 })), excluded, attempts: [], fallbacks: 0, tokens: 0, latencyMs: 0, validation: 'sem resposta' };
    const reasoning = category === 'complexa' || category === 'criatividade' ? 'medio' : 'baixo';
    for (const candidate of ranked.slice(0, 3)) {
      const m = candidate.model;
      const key = candidate.key;
      const h: Health = health.get(key) ?? freshHealth(key);
      const day = dayFor(m, now);
      const rpd = Math.min(m.limits.rpd, config.dailyCaps[key] ?? Infinity);
      // Keep ~10% of each model's day for pending conversations.
      const daily = hint?.hasMessages ? rpd : Math.floor(rpd * 0.9);
      const local = await this.store.reserve(m.id, day, now, daily, m.limits.rpm, estimatedTokens, environment, m.limits.tpm, m.limits.tpd, m.provider, category);
      if (!local) { route.attempts.push({ model: key, provider: m.provider, outcome: 'orcamento_local', latencyMs: 0, tokens: 0 }); continue; }
      let shared: string | null = null;
      if (budget !== this.store) {
        shared = await budget.reserve(m.id, day, now, rpd, m.limits.rpm, estimatedTokens, environment, m.limits.tpm, m.limits.tpd, m.provider, category);
        if (!shared) { await this.store.settle(local, 0, 'negada_global'); route.attempts.push({ model: key, provider: m.provider, outcome: 'orcamento_global', latencyMs: 0, tokens: 0 }); continue; }
      }
      const started = Date.now();
      let tokens = 0, status = 'falha';
      try {
        const reply = await callModel(m, { system, prompt, schema: compiledDecisionSchema, maxOutput: m.provider === 'gemini' ? 4096 : Math.max(1000, Math.min(3000, m.limits.tpm - estimatedInput - 200)), reasoning }, keys, this.fetcher);
        tokens = reply.tokensTotal;
        let parsed: ReturnType<typeof parseDecision>;
        try {
          parsed = parseDecision(extractJson(reply.text));
        } catch (e) {
          throw new ProviderFailure('resposta_invalida', 200, null, e instanceof ProviderFailure ? e.detail : 'esquema: ' + String((e as Error).message).slice(0, 200));
        }
        status = 'sucesso';
        const next = onSuccess(h, reply.latencyMs, now, parsed.invalidActions.length);
        await saveHealth(this.store.db, next, now);
        route.attempts.push({ model: key, provider: m.provider, outcome: 'aceita', latencyMs: reply.latencyMs, tokens });
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
        const partial = (e as { reply?: { tokensTotal?: number } }).reply;
        tokens = partial?.tokensTotal ?? tokens;
        status = f.kind;
        await saveHealth(this.store.db, onFailure(h, f.kind, f.detail, now, f.retryAfterMs), now);
        route.attempts.push({ model: key, provider: m.provider, outcome: f.kind, latencyMs: Date.now() - started, tokens, detail: f.detail.slice(0, 160) });
        route.tokens += tokens;
        route.latencyMs += Date.now() - started;
      } finally {
        await this.store.settle(local, tokens, status, Date.now() - started);
        if (shared) await budget.settle(shared, tokens, status, Date.now() - started);
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
