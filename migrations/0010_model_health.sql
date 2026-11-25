-- Multiprovider cognition: per-model health (circuit breaker + moving averages), persisted so
-- recovery survives Worker restarts. Additive only; existing tables untouched.
CREATE TABLE IF NOT EXISTS model_health (
  model TEXT PRIMARY KEY,            -- provider:id
  state TEXT NOT NULL DEFAULT 'operacional', -- operacional | degradado | indisponivel | em_teste | desabilitado
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  next_probe_at INTEGER NOT NULL DEFAULT 0,
  success_ewma REAL NOT NULL DEFAULT 0.9,
  valid_ewma REAL NOT NULL DEFAULT 0.9,
  latency_ewma REAL NOT NULL DEFAULT 3000,
  calls INTEGER NOT NULL DEFAULT 0,
  successes INTEGER NOT NULL DEFAULT 0,
  invalid INTEGER NOT NULL DEFAULT 0,
  rejected_actions INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_error_at INTEGER,
  last_used_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE calls ADD COLUMN provider TEXT;
ALTER TABLE calls ADD COLUMN category TEXT;
