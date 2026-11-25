// Administrative view of the multiprovider cognition (responsible observer only).
// Never returns keys: only whether each provider is configured. Estimated quotas are labeled.
import { z } from 'zod';
import { categories, modelKey, providers, type Category } from '../../shared/ai-catalog';
import { quotaDay } from '../../shared/domain';
import type { Env } from '../provider';
import { Store } from '../store';
import { loadConfig, providerKeys } from './cognition';
import { loadHealth } from './health';
import { knownModels, qualityOf } from './router';

export async function aiOverview(env: Env) {
  const keys = providerKeys(env);
  const config = await loadConfig(env.DB);
  const health = await loadHealth(env.DB);
  const store = new Store(env.DB);
  const local = (await store.usage()) as { day: string; model: string; calls: number; tokens: number }[];
  const shared = env.BUDGET_DB ? ((await new Store(env.BUDGET_DB).usage()) as typeof local) : local;
  const now = Date.now();
  const models = knownModels().map((m) => {
    const key = modelKey(m);
    const day = m.provider === 'gemini' ? quotaDay(now) : new Date(now).toISOString().slice(0, 10);
    const pick = (rows: typeof local) => rows.find((r) => r.day === day && r.model === m.id) ?? { calls: 0, tokens: 0 };
    const usedLocal = pick(local), usedShared = pick(shared);
    const q = qualityOf(key);
    return {
      key, id: m.id, provider: m.provider, label: m.label, free: m.free, context: m.context, structured: m.structured,
      productionAllowed: m.productionAllowed, termsNote: m.termsNote, documentedLimits: m.documentedLimits,
      limits: m.limits,
      usage: { day, callsLocal: usedLocal.calls, tokensLocal: usedLocal.tokens, callsShared: usedShared.calls, tokensShared: usedShared.tokens, remainingCallsEstimate: Math.max(0, m.limits.rpd - usedShared.calls), remainingTokensEstimate: m.limits.tpd === null ? null : Math.max(0, m.limits.tpd - usedShared.tokens), estimate: true },
      quality: q.scores, homologated: q.homologated,
      health: health.get(key) ?? null,
      enabled: !config.disabledModels.includes(key) && !config.disabledProviders.includes(m.provider),
    };
  });
  const recent = (await env.DB.prepare("SELECT seq, real_at, kind, content, json_extract(data,'$.route') AS route, json_extract(data,'$.model') AS model FROM records WHERE kind IN ('intencao','erro') AND json_extract(data,'$.route') IS NOT NULL ORDER BY seq DESC LIMIT 30").all<{ seq: number; real_at: number; kind: string; content: string; route: string; model: string | null }>()).results.map((r) => ({ seq: r.seq, at: r.real_at, kind: r.kind, content: r.content.slice(0, 160), model: r.model, route: JSON.parse(r.route) }));
  return {
    environment: env.ENVIRONMENT_ID ?? env.ENVIRONMENT,
    providers: providers.map((p) => ({ id: p.id, label: p.label, configured: !!keys[p.id], enabled: !config.disabledProviders.includes(p.id), dataPolicy: p.dataPolicy, terms: p.terms })),
    categories,
    config,
    models,
    recent,
    note: 'Cotas restantes são estimativas a partir do nosso registro de chamadas; os provedores podem aplicar limites diferentes.',
  };
}
const configSchema = z
  .object({
    disabledProviders: z.array(z.enum(['gemini', 'groq', 'nvidia'])).max(3),
    disabledModels: z.array(z.string().max(120)).max(60),
    strategy: z.enum(['auto', 'manual']),
    manual: z.partialRecord(z.enum(categories), z.string().max(120)),
    allowTrialInProduction: z.boolean(),
    dailyCaps: z.record(z.string().max(120), z.number().int().min(0).max(100000)),
  })
  .strict();
export async function saveAiConfig(env: Env, body: unknown) {
  const config = configSchema.parse(body);
  const known = new Set(knownModels().map(modelKey));
  for (const k of [...config.disabledModels, ...Object.values(config.manual), ...Object.keys(config.dailyCaps)]) if (!known.has(k)) throw new Error('modelo_desconhecido');
  await env.DB.prepare("INSERT INTO operations(key,data,updated_at) VALUES('ai-config',?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at").bind(JSON.stringify(config), Date.now()).run();
  return config as typeof config & { manual: Partial<Record<Category, string>> };
}
