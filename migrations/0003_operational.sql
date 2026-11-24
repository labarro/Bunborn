-- Additive operational migration; existing identity and history remain intact.
CREATE TABLE IF NOT EXISTS operations (key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS heartbeats (id INTEGER PRIMARY KEY CHECK(id=1), scheduled_at INTEGER NOT NULL, completed_at INTEGER NOT NULL, status TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS cycle_metrics (id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, completed_at INTEGER NOT NULL, decision_before INTEGER NOT NULL, decision_after INTEGER NOT NULL, status TEXT NOT NULL, logical_bytes_before INTEGER NOT NULL, logical_bytes_after INTEGER NOT NULL, rows_read INTEGER NOT NULL DEFAULT 0, rows_written INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS cycle_metrics_time ON cycle_metrics(started_at);
CREATE TABLE IF NOT EXISTS experiment (id INTEGER PRIMARY KEY CHECK(id=1), started_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, max_calls INTEGER NOT NULL, status TEXT NOT NULL, mode TEXT NOT NULL, context TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS birth_challenges (id TEXT PRIMARY KEY, expires INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS backup_sessions (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, expires INTEGER NOT NULL, manifest TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS restore_sessions (id TEXT PRIMARY KEY, status TEXT NOT NULL, manifest TEXT NOT NULL, hash TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0, started_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS restore_chunks (session_id TEXT NOT NULL, idx INTEGER NOT NULL, digest TEXT NOT NULL, table_name TEXT NOT NULL, rows_json TEXT NOT NULL, PRIMARY KEY(session_id,idx));
CREATE TABLE IF NOT EXISTS record_links (record_id TEXT NOT NULL, related_id TEXT NOT NULL, PRIMARY KEY(record_id,related_id));
CREATE INDEX IF NOT EXISTS record_links_related ON record_links(related_id,record_id);
CREATE TABLE IF NOT EXISTS research_cache (cache_key TEXT PRIMARY KEY, record_id TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS checkpoints (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, revision INTEGER NOT NULL, state TEXT NOT NULL, upper_seq INTEGER NOT NULL, digest TEXT NOT NULL);
ALTER TABLE calls ADD COLUMN latency_ms INTEGER;
ALTER TABLE calls ADD COLUMN scope TEXT;
