// Read-only signed backup (v2) of the PERMANENT production existence, taken before any schema
// change. Writes only to .wrangler/private/backups (git-ignored). Never restores anything.
import { remoteClient } from './remote-client.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const client = await remoteClient('production');
const started = Date.now();
// A consistent export requires the existence paused; it is resumed in finally, even on failure.
const before = await client.request('state');
const wasPaused = !!before.state?.paused;
if (!wasPaused) await client.request('settings', { paused: true, multiplier: before.state.multiplier });
let manifest;
try {
manifest = await client.request('backup/begin', {});
const segments = [];
try {
  for (const table of Object.keys(manifest.upper)) {
    let after = 0;
    do {
      const page = await client.request('backup/page', { id: manifest.id, table, after });
      segments.push(page);
      after = page.next ?? 0;
    } while (after);
  }
  const seal = await client.request('backup/seal', { id: manifest.id });
  await mkdir('.wrangler/private/backups', { recursive: true });
  const file = `.wrangler/private/backups/production-${manifest.id}.backup.json`;
  await writeFile(file, JSON.stringify({ format: 'bunborn', version: 2, manifest, segments, seal }));
  console.log(JSON.stringify({ file, segments: segments.length, counts: manifest.counts, ms: Date.now() - started }));
} catch (e) {
  await client.request('backup/cancel', { id: manifest.id }).catch(() => undefined);
  throw e;
}
} finally {
  if (!wasPaused) await client.request('settings', { paused: false, multiplier: before.state.multiplier });
  const after = await client.request('state');
  console.log(JSON.stringify({ resumed: !after.state?.paused }));
}
