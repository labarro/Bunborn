-- Additive: distinguishes the responsible observer from public visitors in the inbox.
ALTER TABLE inbox ADD COLUMN author TEXT NOT NULL DEFAULT 'responsavel';
