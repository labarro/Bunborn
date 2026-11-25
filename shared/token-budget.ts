// Token estimation and output budgets (cognitive audit 25/11). No tokenizer runs in the Worker:
// estimates are calibrated from real calls (bytes of system + context vs. prompt tokens the
// providers reported). Reservation is not consumption: the ledger always settles with the
// tokens the provider actually reported.
import type { Category, ModelEntry } from './ai-catalog';

/** UTF-8 bytes per input token, measured on real Bunborn requests (see COGNITIVE_AUDIT.md). */
export function bytesPerToken(m: Pick<ModelEntry, 'provider' | 'id'>) {
  // Measured 25/11 (homologation, prompt tokens reported vs. bytes sent): Gemini 3.38–3.46,
  // MiniMax 3.61. Groq and Nemotron not yet measured input-only: conservative values.
  if (m.provider === 'gemini') return 3.4;
  if (m.id.startsWith('minimaxai/')) return 3.6;
  if (m.id.startsWith('openai/gpt-oss')) return 3.4;
  if (m.id.startsWith('qwen/')) return 3.3;
  return 3.2;
}
export const estimateInput = (bytes: number, m: Pick<ModelEntry, 'provider' | 'id'>) => Math.ceil(bytes / bytesPerToken(m));
/** Output budget per kind of decision: a daily choice needs far less room than a new work. */
export const outputBudget: Record<Category, number> = { cotidiana: 1536, comunicacao: 1536, pesquisa: 1536, memoria: 2048, complexa: 2560, criatividade: 4096 };
/**
 * max_tokens for one request. Groq counts prompt + max_tokens against tokens/minute, so the
 * output is fitted below the per-minute limit; a request that cannot fit at least `floor` is excluded.
 */
/**
 * Models that always reason before answering spend output tokens on it: with 1536 tokens
 * Nemotron Ultra truncated 3 of 8 replies and MiniMax truncated at 3000 (benchmark 25/11).
 */
// With 4096 they reasoned past the 45 s timeout (Nemotron 8 of 11): 3072 balances truncation and time.
export const reasoningFloor = (id: string) => (/nemotron|minimax|kimi|step-|deepseek|thinking/i.test(id) ? 3072 : id.startsWith('openai/gpt-oss') ? 2560 : 0);
export function maxOutputFor(m: Pick<ModelEntry, 'provider' | 'id' | 'maxOutput' | 'limits'>, category: Category, inputTokens: number) {
  const wanted = Math.min(Math.max(outputBudget[category], reasoningFloor(m.id)), m.maxOutput);
  if (m.provider !== 'groq') return wanted;
  return Math.min(wanted, m.limits.tpm - inputTokens - 300);
}
export const minimumOutput = 900;
