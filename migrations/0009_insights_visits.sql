-- Additive. Time-range index for public highlights/logbook (reads only the requested days)
-- and an anonymous daily visitor table (salted hash per day; no IP stored; pruned after 8 days).
CREATE INDEX IF NOT EXISTS records_real_at ON records(real_at);
CREATE TABLE IF NOT EXISTS visits (day TEXT NOT NULL, visitor TEXT NOT NULL, PRIMARY KEY(day, visitor));
