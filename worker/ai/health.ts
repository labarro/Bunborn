// Per-model circuit breaker and moving averages, persisted in D1 (model_health).
// States: operacional → (failures) degradado/indisponivel → (probe time) em_teste → operacional.
// desabilitado only after authentication/model-not-found errors or by the responsible observer.
import type { FailureKind } from './adapters';
export type Health = {
  model: string;
  state: 'operacional' | 'degradado' | 'indisponivel' | 'em_teste' | 'desabilitado';
  consecutive_failures: number;
  next_probe_at: number;
  success_ewma: number;
  valid_ewma: number;
  latency_ewma: number;
  calls: number;
  successes: number;
  invalid: number;
  rejected_actions: number;
  last_error: string | null;
  last_error_at: number | null;
  last_used_at: number | null;
};
export const freshHealth = (model: string): Health => ({ model, state: 'operacional', consecutive_failures: 0, next_probe_at: 0, success_ewma: 0.9, valid_ewma: 0.9, latency_ewma: 3000, calls: 0, successes: 0, invalid: 0, rejected_actions: 0, last_error: null, last_error_at: null, last_used_at: null });
const ALPHA = 0.2; // one event moves the average by 20%: a single failure never flips preferences.
const ewma = (prev: number, value: number) => prev + ALPHA * (value - prev);
/** Deterministic jitter in [0.85, 1.15] derived from the model name and attempt (testable). */
function jitter(model: string, n: number) {
  let h = 2166136261;
  for (const c of model + n) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return 0.85 + ((h >>> 0) % 1000) / 1000 * 0.3;
}
export async function loadHealth(db: D1Database): Promise<Map<string, Health>> {
  const rows = (await db.prepare('SELECT * FROM model_health').all<Health>()).results;
  return new Map(rows.map((r) => [r.model, r]));
}
/** A model is callable when operational/degraded, or when its recovery probe time has come. */
export function callable(h: Health | undefined, now: number) {
  if (!h) return true;
  if (h.state === 'desabilitado') return false;
  if (h.state === 'indisponivel' || h.state === 'em_teste') return now >= h.next_probe_at;
  return true;
}
export function nextUntilUtcMidnight(now: number) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now;
}
export function onFailure(h: Health, kind: FailureKind, detail: string, now: number, retryAfterMs: number | null): Health {
  const n = h.consecutive_failures + 1;
  const next: Health = { ...h, consecutive_failures: n, calls: h.calls + 1, last_error: (kind + ': ' + detail).slice(0, 300), last_error_at: now, last_used_at: now, success_ewma: ewma(h.success_ewma, 0) };
  if (kind === 'resposta_invalida' || kind === 'requisicao_invalida') {
    next.invalid = h.invalid + 1;
    next.valid_ewma = ewma(h.valid_ewma, 0);
  }
  let wait: number;
  switch (kind) {
    case 'autenticacao':
    case 'modelo_inexistente':
    case 'configuracao':
      return { ...next, state: 'desabilitado', next_probe_at: 0 };
    case 'cota_esgotada':
      wait = retryAfterMs ?? nextUntilUtcMidnight(now);
      break;
    case 'limite_taxa':
      wait = retryAfterMs ?? 60000 * Math.min(8, 2 ** (n - 1));
      break;
    case 'resposta_invalida':
    case 'requisicao_invalida':
      // Format problems: keep callable until a streak shows the model cannot follow the contract.
      if (n < 3) return { ...next, state: 'degradado' };
      wait = 10 * 60000 * Math.min(6, 2 ** (n - 3));
      break;
    default: // sobrecarga, timeout, rede
      wait = Math.max(retryAfterMs ?? 0, Math.min(30 * 60000, 2 * 60000 * 2 ** Math.min(n - 1, 4)));
  }
  return { ...next, state: 'indisponivel', next_probe_at: now + Math.round(wait * jitter(h.model, n)) };
}
export function onSuccess(h: Health, latencyMs: number, now: number, rejectedActions = 0): Health {
  return { ...h, state: 'operacional', consecutive_failures: 0, next_probe_at: 0, calls: h.calls + 1, successes: h.successes + 1, success_ewma: ewma(h.success_ewma, 1), valid_ewma: ewma(h.valid_ewma, 1), latency_ewma: ewma(h.latency_ewma, latencyMs), rejected_actions: h.rejected_actions + rejectedActions, last_used_at: now };
}
export async function saveHealth(db: D1Database, h: Health, now: number) {
  await db
    .prepare(
      `INSERT INTO model_health(model,state,consecutive_failures,next_probe_at,success_ewma,valid_ewma,latency_ewma,calls,successes,invalid,rejected_actions,last_error,last_error_at,last_used_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(model) DO UPDATE SET state=excluded.state,consecutive_failures=excluded.consecutive_failures,next_probe_at=excluded.next_probe_at,success_ewma=excluded.success_ewma,valid_ewma=excluded.valid_ewma,latency_ewma=excluded.latency_ewma,calls=excluded.calls,successes=excluded.successes,invalid=excluded.invalid,rejected_actions=excluded.rejected_actions,last_error=excluded.last_error,last_error_at=excluded.last_error_at,last_used_at=excluded.last_used_at,updated_at=excluded.updated_at`,
    )
    .bind(h.model, h.state, h.consecutive_failures, h.next_probe_at, h.success_ewma, h.valid_ewma, h.latency_ewma, h.calls, h.successes, h.invalid, h.rejected_actions, h.last_error, h.last_error_at, h.last_used_at, now)
    .run();
}
