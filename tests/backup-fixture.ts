// Loads a signed production backup into a DISPOSABLE in-memory SQLite (never a remote database),
// so the real context the creature receives can be rebuilt and studied offline.
import { readFileSync } from 'node:fs';
import { database } from './database';
type Backup = { manifest: { state: Record<string, unknown> }; segments: { table: string; rows: Record<string, unknown>[] }[] };
const snake: Record<string, string> = { entityId: 'entity_id', realAt: 'real_at', virtualAt: 'virtual_at' };
export function loadBackup(path: string, tables = ['records', 'record_links', 'retrievals', 'inbox']) {
  const d = database();
  const b = JSON.parse(readFileSync(path, 'utf8')) as Backup;
  for (const seg of b.segments) {
    if (!tables.includes(seg.table)) continue;
    for (const row of seg.rows) {
      const cols = Object.keys(row).map((k) => snake[k] ?? k);
      const vals = Object.values(row).map((v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v));
      d.sqlite.prepare(`INSERT OR IGNORE INTO ${seg.table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...(vals as never[]));
    }
  }
  const state = { ...b.manifest.state, paused: false };
  d.sqlite.prepare("INSERT INTO world(id,state,revision) VALUES('principal',?,?)").run(JSON.stringify(state), Number((state as { revision?: number }).revision ?? 0));
  return { ...d, state };
}
