-- ONLY for bunborn-homologation, after the disposable existence was archived and verified in
-- bunborn-recovery (artifacts/backup-restore-real.json). Quota history (budgets, calls),
-- operations, heartbeats, rate limits and cycle metrics are PRESERVED: quotas are never reset.
INSERT INTO memory_search(memory_search) VALUES('delete-all');
DELETE FROM records;
DELETE FROM world;
DELETE FROM retrievals;
DELETE FROM inbox;
DELETE FROM experiment;
DELETE FROM birth_challenges;
DELETE FROM backup_sessions;
DELETE FROM backup_segments;
DELETE FROM restore_sessions;
DELETE FROM restore_chunks;
DELETE FROM record_links;
DELETE FROM research_cache;
DELETE FROM checkpoints;
DELETE FROM sqlite_sequence WHERE name='records';
UPDATE storage_meter SET bytes=0, records=0 WHERE id=1;
INSERT INTO operations(key,data,updated_at) VALUES('archived-existence','{"archivedTo":"bunborn-recovery","reason":"born with pre-label code; new disposable birth for 24h experiment","decisions":25}',CAST(strftime('%s','now') AS INTEGER)*1000) ON CONFLICT(key) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;
