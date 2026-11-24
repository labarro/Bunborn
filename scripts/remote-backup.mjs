// Real backup v2 homologation: export the DISPOSABLE homologation existence, restore it into
// the isolated, empty bunborn-recovery database, then export the recovered copy and compare
// every signed segment digest. Never touches production. Backup file stays in .wrangler/private.
import { remoteClient } from './remote-client.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const client = await remoteClient('homologation');
const q = (target) => (target === 'recovery' ? '?target=recovery' : '');
async function exportFrom(target) {
  const started = Date.now();
  const manifest = await client.request('backup/begin' + q(target), {});
  const segments = [];
  try {
    for (const table of Object.keys(manifest.upper)) {
      let after = 0;
      do {
        const page = await client.request('backup/page' + q(target), { id: manifest.id, table, after });
        segments.push(page);
        after = page.next ?? 0;
      } while (after);
    }
    const seal = await client.request('backup/seal' + q(target), { id: manifest.id });
    return { backup: { format: 'bunborn', version: 2, manifest, segments, seal }, ms: Date.now() - started };
  } catch (e) {
    await client.request('backup/cancel' + q(target), { id: manifest.id }).catch(() => undefined);
    throw e;
  }
}
const inspect = (target) => client.request('backup/inspect' + q(target));
const before = { homologation: await inspect('homologation'), recovery: await inspect('recovery') };
if (before.recovery.state) throw new Error('recovery_not_empty: refusing to proceed');
const source = await exportFrom('homologation');
await mkdir('.wrangler/private/backups', { recursive: true });
const file = `.wrangler/private/backups/homologation-${source.backup.manifest.id}.backup.json`;
const text = JSON.stringify(source.backup);
await writeFile(file, text);
// Restore from the parsed file (download/upload roundtrip), resuming idempotently if needed.
const backup = JSON.parse(text);
const restoreStarted = Date.now();
const session = await client.request('backup/restore/begin?target=recovery', { manifest: backup.manifest, seal: backup.seal });
const byKey = new Map(backup.segments.map((s) => [s.table + ':' + s.after, s]));
for (const [idx, header] of backup.seal.headers.entries()) await client.request('backup/restore/page?target=recovery', { id: session.id, idx, rows: byKey.get(header.table + ':' + header.after).rows });
let applyCalls = 0, result = { complete: false };
while (!result.complete && applyCalls < 5000) { result = await client.request('backup/restore/apply?target=recovery', { id: session.id }); applyCalls++; }
const restoreMs = Date.now() - restoreStarted;
const after = { homologation: await inspect('homologation'), recovery: await inspect('recovery') };
const copy = await exportFrom('recovery');
const digests = (b) => b.seal.headers.map((h) => `${h.table}:${h.after}:${h.count}:${h.digest}`);
const a = digests(source.backup), c = digests(copy.backup);
const mismatched = a.filter((x, i) => x !== c[i]).length + Math.abs(a.length - c.length);
const s1 = source.backup.manifest.state, s2 = copy.backup.manifest.state;
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
const report = {
  checkedAt: new Date().toISOString(),
  environment: 'homologation (disposable) -> bunborn-recovery (isolated, was empty)',
  backupId: source.backup.manifest.id,
  bytes: Buffer.byteLength(text),
  segments: a.length,
  counts: source.backup.manifest.counts,
  exportMs: source.ms,
  restoreMs,
  applyCalls,
  restoreResumed: session.resumed,
  identical: {
    segmentDigests: mismatched === 0,
    mismatchedSegments: mismatched,
    counts: JSON.stringify(source.backup.manifest.counts) === JSON.stringify(copy.backup.manifest.counts),
    state: canon(s1) === canon(s2),
    stateSameKeyOrder: JSON.stringify(s1) === JSON.stringify(s2),
    identity: canon(s1.identity) === canon(s2.identity),
    ageVirtualMinutes: [s1.virtualMinutes, s2.virtualMinutes],
    needs: JSON.stringify(s1.needs) === JSON.stringify(s2.needs),
    decisions: [s1.decisions, s2.decisions],
    storageMeter: JSON.stringify(after.homologation.storage) === JSON.stringify(after.recovery.storage),
    kindCounts: JSON.stringify(after.homologation.counts) === JSON.stringify(after.recovery.counts),
  },
  storage: { homologation: after.homologation.storage, recovery: after.recovery.storage },
  kindCounts: after.recovery.counts,
  localFile: file.replace(/^.*private/, '.wrangler/private'),
};
await writeFile('artifacts/backup-restore-real.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
