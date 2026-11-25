// Rebuilds the exact cognitive context (and system prompt) from a production backup in a
// disposable in-memory DB and measures it. Usage: node scripts/run-ts.mjs scripts/context-snapshot.ts <backup> <out>
import { writeFileSync } from 'node:fs';
import { loadBackup } from '../tests/backup-fixture';
import { Store } from '../worker/store';
import { buildContext, packContext } from '../worker/engine';
import { systemFor } from '../worker/provider';
import { reconcile, type State } from '../shared/domain';
const [file, out] = process.argv.slice(2);
const d = loadBackup(file);
const store = new Store(d.db);
const s0 = (await store.state()) as State;
const now = s0.updatedAt + 1000;
const s = reconcile(s0, now).state;
const env = { DB: d.db, ENVIRONMENT_ID: 'snapshot' } as never;
const { context } = await buildContext(env, store, s, now);
const packed = packContext(context);
const prompt = JSON.stringify(packed);
const system = systemFor(s.decisions);
const bytes = (t: string) => new TextEncoder().encode(t).length;
const sections = Object.fromEntries(Object.entries(packed).map(([k, v]) => [k, bytes(JSON.stringify(v))]));
writeFileSync(out.replace(/.raw.json$/, '.system.txt'), system);
writeFileSync(out, JSON.stringify({ decisions: s.decisions, bytes: { prompt: bytes(prompt), system: bytes(system) }, sections, context: packed }, null, 1));
console.log(JSON.stringify({ promptBytes: bytes(prompt), systemBytes: bytes(system), sections }));
