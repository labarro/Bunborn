// Deterministic cognitive router: no AI call is spent choosing the model.
// score = 0.55·quality(category) + 0.25·(success×validity) + 0.10·speed + 0.10·quota headroom
//         − penalties (degraded, probing, quota pressure)
// Hard exclusions: disabled, breaker open, not homologated for the category, terms forbid this
// environment, no budget left, context too large. Affinity keeps the previous model for the same
// category when it is within 0.08 of the best (continuity of conversations/projects).
import { catalog, modelKey, nvidiaEntry, type Category, type ModelEntry } from '../../shared/ai-catalog';
import quality from '../../shared/model-quality.json';
import { callable, type Health } from './health';

export type AiConfig = {
  disabledProviders: string[];
  disabledModels: string[];
  strategy: 'auto' | 'manual';
  manual: Partial<Record<Category, string>>;
  allowTrialInProduction: boolean;
  /** Extra per-model internal daily request caps (never above the catalog's). */
  dailyCaps: Record<string, number>;
};
export const defaultConfig: AiConfig = { disabledProviders: [], disabledModels: [], strategy: 'auto', manual: {}, allowTrialInProduction: false, dailyCaps: {} };
type QualityFile = { generatedAt: string | null; models: Record<string, { entry?: Partial<ModelEntry>; scores: Partial<Record<Category, number>>; homologated: Category[]; note?: string }> };
let q = quality as QualityFile;
/** Benchmarks and tests may evaluate against another quality table (never used by production). */
export function useQuality(file: QualityFile) {
  q = file;
}
export type { QualityFile };

/** Catalog plus models that passed homologation (e.g. NVIDIA or newer Gemini entries). */
export function knownModels(): ModelEntry[] {
  const list = [...catalog];
  for (const [key, info] of Object.entries(q.models)) {
    if (list.some((m) => modelKey(m) === key) || !info.entry) continue;
    const [provider, ...rest] = key.split(':');
    const id = rest.join(':');
    const base = provider === 'nvidia' ? nvidiaEntry(id) : { ...catalog[0], id, label: id, free: 'verificado' as const };
    list.push({ ...base, ...info.entry, id, provider: provider as ModelEntry['provider'] });
  }
  return list;
}
export function qualityOf(key: string) {
  return q.models[key] ?? { scores: {}, homologated: [] as Category[] };
}

export type CategorySignals = { inbox: number; complexNext: boolean; decisionNumber: number; consolidationDue: boolean; recentResearch: boolean; creativity: number; boredom: number; activeCreativeProject: boolean };
/** One decision = one request; the category only steers model choice, it never splits the call. */
export function categorize(s: CategorySignals): { category: Category; reason: string } {
  if (s.inbox > 0) return { category: 'comunicacao', reason: 'há mensagens pendentes' };
  if (s.complexNext || (s.decisionNumber > 0 && s.decisionNumber % 24 === 0)) return { category: 'complexa', reason: s.complexNext ? 'a própria decisão anterior pediu revisão complexa' : 'revisão periódica (a cada 24 decisões)' };
  if (s.consolidationDue) return { category: 'memoria', reason: 'consolidação de memória pendente' };
  if (s.recentResearch) return { category: 'pesquisa', reason: 'resultados de pesquisa recentes para interpretar' };
  if (s.activeCreativeProject || (s.creativity >= 70 && s.boredom >= 60)) return { category: 'criatividade', reason: s.activeCreativeProject ? 'projeto criativo em andamento' : 'vontade de criar e tédio altos' };
  return { category: 'cotidiana', reason: 'decisão cotidiana' };
}

export type Usage = { callsToday: number; tokensToday: number };
export type Candidate = { model: ModelEntry; key: string; score: number; reasons: string[] };
export type Ranking = { ranked: Candidate[]; excluded: { key: string; reason: string }[] };
export function rankModels(input: {
  category: Category;
  models: ModelEntry[];
  health: Map<string, Health>;
  usage: (m: ModelEntry) => Usage;
  config: AiConfig;
  environment: string;
  availableProviders: string[];
  now: number;
  estimatedTokens: number;
  lastModel?: { key: string; category: Category } | null;
}): Ranking {
  const ranked: Candidate[] = [];
  const excluded: Ranking['excluded'] = [];
  for (const m of input.models) {
    const key = modelKey(m);
    const h = input.health.get(key);
    const info = qualityOf(key);
    const quality = info.scores[input.category];
    const out = (reason: string) => excluded.push({ key, reason });
    if (!input.availableProviders.includes(m.provider)) { out('provedor sem chave configurada'); continue; }
    if (input.config.disabledProviders.includes(m.provider)) { out('provedor desabilitado pelo responsável'); continue; }
    if (input.config.disabledModels.includes(key)) { out('modelo desabilitado pelo responsável'); continue; }
    if (input.environment === 'production' && !m.productionAllowed && !input.config.allowTrialInProduction) { out('termos do provedor não permitem uso em produção'); continue; }
    if (!info.homologated.includes(input.category) || quality === undefined) { out('não homologado para ' + input.category); continue; }
    if (!callable(h, input.now)) { out(h?.state === 'desabilitado' ? 'desabilitado: ' + (h.last_error ?? '') : 'circuit breaker aberto até ' + new Date(h!.next_probe_at).toISOString()); continue; }
    if (m.context && input.estimatedTokens > m.context * 0.8) { out('contexto excede a janela do modelo'); continue; }
    // Groq counts prompt + max_tokens against tokens/minute: a request that cannot fit is refused.
    if (input.estimatedTokens + 400 > m.limits.tpm) { out('contexto grande demais para o limite de tokens por minuto do modelo'); continue; }
    const u = input.usage(m);
    const rpd = Math.min(m.limits.rpd, input.config.dailyCaps[key] ?? Infinity);
    if (u.callsToday >= rpd) { out('limite diário de requisições atingido'); continue; }
    if (m.limits.tpd !== null && u.tokensToday + input.estimatedTokens > m.limits.tpd) { out('limite diário de tokens atingido'); continue; }
    const headroom = Math.max(0, Math.min(1 - u.callsToday / rpd, m.limits.tpd ? 1 - u.tokensToday / m.limits.tpd : 1));
    const success = h ? h.success_ewma * h.valid_ewma : 0.81;
    const speed = 1 - Math.min(1, (h?.latency_ewma ?? 3000) / 30000);
    let score = 0.55 * quality + 0.25 * success + 0.1 * speed + 0.1 * headroom;
    const reasons = [`qualidade homologada ${quality.toFixed(2)} em ${input.category}`, `confiabilidade recente ${success.toFixed(2)}`];
    if (headroom < 0.25) { score -= 0.15 * (1 - headroom / 0.25); reasons.push('próximo do limite diário'); }
    if (h?.state === 'degradado') { score -= 0.1; reasons.push('degradado por respostas inválidas recentes'); }
    if (h?.state === 'indisponivel' || h?.state === 'em_teste') { score -= 0.05; reasons.push('em teste de recuperação'); }
    ranked.push({ model: m, key, score, reasons });
  }
  ranked.sort((a, b) => b.score - a.score);
  // Safety net: when no model homologated for this category is available, use the models homologated
  // for everyday decisions (general competence), scored on that category, and say so.
  if (!ranked.length && input.category !== 'cotidiana') {
    const general = rankModels({ ...input, category: 'cotidiana', lastModel: null });
    for (const c of general.ranked) c.reasons.unshift('sem modelo homologado disponível para ' + input.category + '; usando o melhor homologado em cotidiana');
    return { ranked: general.ranked, excluded };
  }
  if (ranked.length) ranked[0].reasons.unshift('melhor pontuação para ' + input.category);
  const manual = input.config.strategy === 'manual' ? input.config.manual[input.category] : undefined;
  const pinned = manual ? ranked.findIndex((c) => c.key === manual) : -1;
  if (pinned > 0) {
    const [c] = ranked.splice(pinned, 1);
    c.reasons.unshift('seleção manual do responsável');
    ranked.unshift(c);
  } else if (input.lastModel && input.lastModel.category === input.category) {
    const i = ranked.findIndex((c) => c.key === input.lastModel!.key);
    if (i > 0 && ranked[0].score - ranked[i].score <= 0.08) {
      const [c] = ranked.splice(i, 1);
      c.reasons.unshift('continuidade: mesmo modelo do ciclo anterior desta categoria');
      ranked.unshift(c);
    }
  }
  return { ranked, excluded };
}
