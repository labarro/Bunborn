-- Additive: export segment headers live in their own rows so concurrent page
-- requests cannot overwrite each other's manifest entries (no read-modify-write).
CREATE TABLE IF NOT EXISTS backup_segments (session_id TEXT NOT NULL, table_name TEXT NOT NULL, after INTEGER NOT NULL, last_cursor INTEGER NOT NULL, count INTEGER NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(session_id,table_name,after));
