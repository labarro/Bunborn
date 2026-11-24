import { afterEach, describe, expect, it } from 'vitest';
import { born } from '../shared/domain';
import { Store, entry } from '../worker/store';
import type { Env } from '../worker/provider';
import {
  applyRestore,
  backupTables,
  beginExport,
  beginRestore,
  cancelExport,
  exportSegment,
  isFrozen,
  restoreLocked,
  sealExport,
  uploadRestoreSegment,
} from '../worker/segmented-backup';
import { scheduledRun } from '../worker/operations';
import { database } from './database';
// Disposable fixture existences only. No Gemini, no network, no permanent creature.
const opened: ReturnType<typeof database>[] = [];
afterEach(() => opened.splice(0).forEach((d) => d.sqlite.close()));
function env(id = 'homologation', secret = 'fixture-session-secret-0123456789abcdef0123'): Env {
  const d = database();
  opened.push(d);
  return {
    DB: d.db,
    FREE_TIER_CONFIRMED: 'false',
    MODEL_LITE: 'gemini-3.1-flash-lite',
    MODEL_FLASH: 'gemini-3-flash-preview',
    LITE_DAILY_LIMIT: '80',
    FLASH_DAILY_LIMIT: '8',
    ENVIRONMENT: 'test',
    ENVIRONMENT_ID: id,
    SESSION_SECRET: secret,
  } as Env;
}
async function seedLarge(e: Env, total = 2600) {
  const store = new Store(e.DB);
  const now = Date.now();
  const s = born(now);
  let token = (await store.acquire(now))!;
  await store.commit(token, s, [entry(s, 'nascimento', 'Nascimento DESCARTÁVEL de teste de backup.', { fixture: true }, { importance: 1 })], [], true);
  await store.release(token);
  for (let start = 1; start < total; start += 400) {
    token = (await store.acquire(Date.now()))!;
    const records = Array.from({ length: Math.min(400, total - start) }, (_, i) =>
      entry(
        s,
        i % 7 === 0 ? 'diario' : 'memoria',
        `Fixture ${start + i}: ação "citada", acentuação çãõ, emoji 🐇, número ${(start + i) / 3}`,
        { n: start + i, nested: { flag: i % 2 === 0, value: 0.1 + i, list: [1, 'dois', null] } },
        { importance: ((start + i) % 10) / 10, associations: [] },
      ),
    );
    await store.commit(token, s, records);
    await store.release(token);
  }
  await e.DB.batch([
    e.DB.prepare("INSERT INTO budgets(day,model,calls,tokens) VALUES('2026-11-23','gemini-3.1-flash-lite',7,12345)"),
    e.DB.prepare("INSERT INTO calls(id,day,model,at,reserved_tokens,actual_tokens,status,latency_ms,scope) VALUES('c1','2026-11-23','gemini-3.1-flash-lite',1,9000,4321,'sucesso',812,'homologation')"),
    e.DB.prepare("INSERT INTO calls(id,day,model,at,reserved_tokens,actual_tokens,status) VALUES('c2','2026-11-23','gemini-3.1-flash-lite',2,9000,NULL,'gemini_http_503')"),
    e.DB.prepare("INSERT INTO inbox(id,content,at,consumed) VALUES('m1','Olá <script>x</script>',3,0)"),
    e.DB.prepare("INSERT INTO retrievals(memory_id,count,last_at) VALUES('r1',4,5)"),
    e.DB.prepare("INSERT INTO cycle_metrics(id,started_at,completed_at,decision_before,decision_after,status,logical_bytes_before,logical_bytes_after,rows_read,rows_written) VALUES('cm1',1,2,0,1,'decisao_registrada',10,20,364,125)"),
    e.DB.prepare("INSERT INTO operations(key,data,updated_at) VALUES('diagnostic:lite','{\"valid\":true}',9)"),
  ]);
  // Pause through the normal state path (revision increments as in production).
  token = (await store.acquire(Date.now()))!;
  const current = (await store.state())!;
  current.paused = true;
  await store.commit(token, current, [entry(current, 'administracao', 'Pausa para backup de teste.')]);
  await store.release(token);
}
async function fullExport(e: Env, during?: () => Promise<void>) {
  const manifest = await beginExport(e);
  const segments = [];
  for (const table of Object.keys(manifest.upper)) {
    let after = 0;
    do {
      const page = await exportSegment(e, manifest.id, table, after);
      segments.push(page);
      after = page.next ?? 0;
      if (during) await during();
    } while (after);
  }
  const seal = await sealExport(e, manifest.id);
  // Simulates download + file + re-upload: JSON roundtrip of the whole artifact.
  return JSON.parse(JSON.stringify({ format: 'bunborn', version: 2, manifest, segments, seal }));
}
async function fullRestore(target: Env, backup: Awaited<ReturnType<typeof fullExport>>, applyCalls = Infinity) {
  const session = await beginRestore(target, { manifest: backup.manifest, seal: backup.seal });
  const byKey = new Map(backup.segments.map((s: { table: string; after: number }) => [s.table + ':' + s.after, s]));
  for (const [idx, header] of backup.seal.headers.entries())
    await uploadRestoreSegment(target, { id: session.id, idx, rows: (byKey.get(header.table + ':' + header.after) as { rows: unknown[] }).rows });
  let result: { complete: boolean } = { complete: false };
  for (let i = 0; i < applyCalls && !result.complete; i++) result = await applyRestore(target, session.id);
  return { session, result };
}
async function dump(e: Env) {
  const out: Record<string, unknown[]> = {};
  for (const table of backupTables)
    out[table] = (await e.DB.prepare(`SELECT * FROM ${table} ${table === 'operations' ? "WHERE key NOT IN ('backup-freeze','restore-lock')" : ''} ORDER BY rowid`).all()).results;
  return out;
}
describe('segmented backup v2 (fixtures, isolated databases)', () => {
  it('exports >2000 records while Cron heartbeats run, and restores an identical existence', async () => {
    const source = env();
    await seedLarge(source);
    let beats = 0;
    const backup = await fullExport(source, async () => {
      if (beats++ % 5 === 0) await scheduledRun(source, Date.now());
    });
    expect(beats).toBeGreaterThan(30);
    expect((await source.DB.prepare('SELECT count FROM heartbeats WHERE id=1').first<{ count: number }>())!.count).toBeGreaterThan(5);
    expect(backup.manifest.counts.records).toBe(2601);
    expect(await isFrozen(source)).toBe(false);
    const target = env();
    const { result } = await fullRestore(target, backup);
    expect(result.complete).toBe(true);
    const [a, b] = [await dump(source), await dump(target)];
    for (const table of backupTables) expect(b[table], table).toEqual(a[table]);
    expect(await new Store(target.DB).state()).toEqual(await new Store(source.DB).state());
    // Byte-identical world row (same key order), not only semantically equal.
    expect((await target.DB.prepare('SELECT state FROM world').first<{ state: string }>())!.state).toBe((await source.DB.prepare('SELECT state FROM world').first<{ state: string }>())!.state);
    expect(await target.DB.prepare('SELECT bytes,records FROM storage_meter').first()).toEqual(await source.DB.prepare('SELECT bytes,records FROM storage_meter').first());
    const search = "SELECT COUNT(*) AS n FROM memory_search WHERE memory_search MATCH 'citada'";
    expect((await target.DB.prepare(search).first<{ n: number }>())!.n).toBe((await source.DB.prepare(search).first<{ n: number }>())!.n);
    expect((await target.DB.prepare('SELECT COUNT(*) AS n FROM heartbeats').first<{ n: number }>())!.n).toBe(0);
    expect(await restoreLocked(target)).toBe(false);
  });
  it('rejects tampered rows, manifests, foreign secrets and test sources in production', async () => {
    const source = env();
    await seedLarge(source, 300);
    const backup = await fullExport(source);
    const tamperedState = structuredClone(backup);
    tamperedState.manifest.state.identity.name = 'Imposto';
    await expect(beginRestore(env(), { manifest: tamperedState.manifest, seal: tamperedState.seal })).rejects.toThrow('assinatura_ou_integridade_invalida');
    const tamperedHeader = structuredClone(backup);
    tamperedHeader.seal.headers[0].count -= 1;
    await expect(beginRestore(env(), { manifest: tamperedHeader.manifest, seal: tamperedHeader.seal })).rejects.toThrow('assinatura_ou_integridade_invalida');
    await expect(beginRestore(env('homologation', 'another-secret-0123456789abcdef0123456789'), { manifest: backup.manifest, seal: backup.seal })).rejects.toThrow('assinatura_ou_integridade_invalida');
    await expect(beginRestore(env('production'), { manifest: backup.manifest, seal: backup.seal })).rejects.toThrow('origem_de_teste_proibida_na_producao');
    const target = env();
    const session = await beginRestore(target, { manifest: backup.manifest, seal: backup.seal });
    const rows = structuredClone(backup.segments[0].rows);
    rows[1].content = 'Memória inventada';
    await expect(uploadRestoreSegment(target, { id: session.id, idx: 0, rows })).rejects.toThrow('segmento_corrompido');
    await expect(applyRestore(target, session.id)).rejects.toThrow('upload_incompleto');
    expect(await new Store(target.DB).state()).toBeNull();
  });
  it('never overwrites a populated target and blocks reads/writes during import', async () => {
    const source = env();
    await seedLarge(source, 500);
    const backup = await fullExport(source);
    await expect(beginRestore(source, { manifest: backup.manifest, seal: backup.seal })).rejects.toThrow('restauracao_exige_banco_vazio');
    const target = env();
    await fullRestore(target, backup, 1);
    expect(await restoreLocked(target)).toBe(true);
    expect(await isFrozen(target)).toBe(true);
    expect(await new Store(target.DB).state()).toBeNull();
    // A different backup cannot start while this import holds the target.
    const other = env();
    await seedLarge(other, 50);
    const otherBackup = await fullExport(other);
    await expect(beginRestore(target, { manifest: otherBackup.manifest, seal: otherBackup.seal })).rejects.toThrow('outra_restauracao_em_andamento');
  });
  it('resumes a partially applied restore and applies concurrent requests exactly once', async () => {
    const source = env();
    await seedLarge(source, 2100);
    const backup = await fullExport(source);
    const target = env();
    const first = await fullRestore(target, backup, 2);
    expect(first.result.complete).toBe(false);
    expect((await target.DB.prepare('SELECT COUNT(*) AS n FROM records').first<{ n: number }>())!.n).toBeGreaterThan(0);
    // Resume with the same file: begin must not reject the non-empty partial target.
    const resumed = await beginRestore(target, { manifest: backup.manifest, seal: backup.seal });
    expect(resumed).toMatchObject({ id: first.session.id, resumed: true });
    for (const [idx, header] of backup.seal.headers.entries())
      await uploadRestoreSegment(target, { id: resumed.id, idx, rows: backup.segments.find((s: { table: string; after: number }) => s.table === header.table && s.after === header.after).rows });
    let done = false;
    for (let i = 0; i < 200 && !done; i++) {
      const results = await Promise.allSettled([applyRestore(target, resumed.id), applyRestore(target, resumed.id), applyRestore(target, resumed.id)]);
      done = results.some((r) => r.status === 'fulfilled' && r.value.complete);
    }
    expect(done).toBe(true);
    const [a, b] = [await dump(source), await dump(target)];
    for (const table of backupTables) expect(b[table], table).toEqual(a[table]);
    expect((await target.DB.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='nascimento'").first<{ n: number }>())!.n).toBe(1);
  });
  it('keeps concurrent and repeated page requests consistent; ignores off-chain pages', async () => {
    const source = env();
    await seedLarge(source, 400);
    const manifest = await beginExport(source);
    const [p1, p2] = await Promise.all([exportSegment(source, manifest.id, 'records', 0), exportSegment(source, manifest.id, 'records', 0)]);
    expect(p1.digest).toBe(p2.digest);
    await exportSegment(source, manifest.id, 'records', 17); // arbitrary cursor, never signed
    await expect(sealExport(source, manifest.id)).rejects.toThrow(/exportacao_incompleta/);
    for (const table of Object.keys(manifest.upper)) {
      let after = 0;
      do after = (await exportSegment(source, manifest.id, table, after)).next ?? 0;
      while (after);
    }
    const seal = await sealExport(source, manifest.id);
    expect(seal.headers.filter((h) => h.table === 'records' && h.after === 17)).toHaveLength(0);
    expect(seal.headers.filter((h) => h.table === 'records').reduce((n, h) => n + h.count, 0)).toBe(manifest.counts.records);
  });
  it('invalidates the snapshot if the existence changes or the export is cancelled', async () => {
    const source = env();
    await seedLarge(source, 100);
    const manifest = await beginExport(source);
    await cancelExport(source, manifest.id);
    await expect(exportSegment(source, manifest.id, 'records', 0)).rejects.toThrow('snapshot_expirado_ou_alterado');
    expect(await isFrozen(source)).toBe(false);
  });
});
