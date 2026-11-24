import { z } from 'zod';
import { born, validLayout, artifactSchema, type State } from '../shared/domain';
import { decode, Store, type Row } from './store';
import type { Env } from './provider';
import { stateSchema } from '../shared/validation';
// Export includes the exact state at its upper sequence; later append-only records are excluded.
export async function exportBackup(env: Env) {
  const store = new Store(env.DB);
  const token = await store.acquire(Date.now());
  if (!token) throw new Error('motor_ocupado');
  let metadata: unknown;
  try {
    const count = await env.DB.prepare('SELECT records FROM storage_meter WHERE id=1').first<{
      records: number;
    }>();
    if ((count?.records ?? 0) > 2000) throw new Error('use_exportacao_paginada');
    metadata = {
      format: 'bunborn',
      version: 1,
      exportedAt: Date.now(),
      state: await store.state(),
      upper:
        (await env.DB.prepare('SELECT MAX(seq) AS upper FROM records').first<{ upper: number }>())
          ?.upper ?? 0,
      budgets: (await env.DB.prepare('SELECT * FROM budgets').all()).results,
      calls: (await env.DB.prepare('SELECT * FROM calls').all()).results,
      inbox: (await env.DB.prepare('SELECT * FROM inbox').all()).results,
      retrievals: (await env.DB.prepare('SELECT * FROM retrievals').all()).results,
    };
  } finally {
    await store.release(token);
  }
  const upper = (metadata as { upper: number }).upper;
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        controller.enqueue(encoder.encode(JSON.stringify(metadata).slice(0, -1) + ',"records":['));
        let cursor = 0,
          first = true;
        while (true) {
          const batch = await env.DB.prepare(
            'SELECT * FROM records WHERE seq>? AND seq<=? ORDER BY seq LIMIT 100',
          )
            .bind(cursor, upper)
            .all<Row>();
          if (!batch.results.length) break;
          for (const row of batch.results) {
            controller.enqueue(encoder.encode((first ? '' : ',') + JSON.stringify(decode(row))));
            first = false;
            cursor = row.seq;
          }
        }
        controller.enqueue(encoder.encode(']}'));
        controller.close();
      } catch {
        controller.error(new Error('exportacao_interrompida'));
      }
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'application/json',
      'content-disposition': 'attachment; filename="existencia.backup.json"',
      'cache-control': 'no-store',
    },
  });
}
export const backupTables = ['records', 'budgets', 'calls', 'inbox', 'retrievals'] as const;
export async function exportManifest(env: Env) {
  const store = new Store(env.DB);
  const token = await store.acquire(Date.now());
  if (!token) throw new Error('motor_ocupado');
  try {
    const state = await store.state();
    if (!state?.paused) throw new Error('pause_para_exportar');
    const results = await env.DB.batch(
      backupTables.map((table) =>
        env.DB.prepare(`SELECT COALESCE(MAX(rowid),0) AS upper FROM ${table}`),
      ),
    );
    const upper = Object.fromEntries(
      backupTables.map((table, i) => [table, (results[i].results[0] as { upper: number }).upper]),
    );
    return { format: 'bunborn', version: 1, exportedAt: Date.now(), state, upper };
  } finally {
    await store.release(token);
  }
}
export async function exportPage(
  env: Env,
  table: string,
  after: number,
  upper: number,
  revision: number,
) {
  if (!backupTables.includes(table as (typeof backupTables)[number]))
    throw new Error('tabela_invalida');
  const state = await new Store(env.DB).state();
  if (!state?.paused || state.revision !== revision)
    throw new Error('estado_alterado_reinicie_exportacao');
  const result = await env.DB.prepare(
    `SELECT rowid AS cursor,* FROM ${table} WHERE rowid>? AND rowid<=? ORDER BY rowid LIMIT 200`,
  )
    .bind(after, upper)
    .all<Row & { cursor: number }>();
  return {
    rows: result.results.map((row) => (table === 'records' ? decode(row) : row)),
    next: result.results.length === 200 ? result.results[result.results.length - 1].cursor : null,
  };
}
const rowSchema = z.object({
  id: z.string().max(100),
  entityId: z.string().max(200),
  kind: z.string().max(40),
  category: z.string().max(40),
  content: z.string().max(14000),
  data: z.record(z.string(), z.unknown()),
  realAt: z.number(),
  virtualAt: z.number(),
  importance: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  associations: z.array(z.string().max(200)).max(100),
  origin: z.string().max(100),
  seq: z.number().optional(),
});
export async function restoreBackup(env: Env, value: unknown) {
  const input = z
    .object({
      format: z.string().min(1).max(40),
      version: z.literal(1),
      state: z.record(z.string(), z.unknown()),
      records: z.array(rowSchema).max(2000),
      budgets: z.array(
        z.object({
          day: z.string(),
          model: z.string(),
          calls: z.number().int().min(0),
          tokens: z.number().min(0),
        }),
      ),
      calls: z
        .array(
          z.object({
            id: z.string(),
            day: z.string(),
            model: z.string(),
            at: z.number(),
            reserved_tokens: z.number(),
            actual_tokens: z.number().nullable(),
            status: z.string(),
          }),
        )
        .max(20000),
      inbox: z.array(
        z.object({
          id: z.string(),
          content: z.string().max(2000),
          at: z.number(),
          consumed: z.number().int().min(0).max(1),
        }),
      ),
      retrievals: z.array(
        z.object({ memory_id: z.string(), count: z.number(), last_at: z.number() }),
      ),
    })
    .parse(value);
  const template = born(Date.now());
  const s = stateSchema.parse(input.state) as State;
  for (const record of input.records) {
    if (record.kind === 'artefato') {
      const artifact = artifactSchema.parse(record.data.artifact);
      if (
        artifact.format === 'pixels' &&
        artifact.pixels.some(
          (row) =>
            row.length !== artifact.pixels[0].length ||
            row.some((p) => p >= artifact.palette.length),
        )
      )
        throw new Error('backup_artefato_invalido');
    }
  }
  for (const key of Object.keys(template))
    if (!(key in s)) throw new Error('backup_estado_incompleto');
  if (
    s.schema !== 1 ||
    s.id !== 'principal' ||
    !Array.isArray(s.objects) ||
    !validLayout(s.objects, s.position) ||
    s.multiplier < 1 ||
    s.multiplier > 12 ||
    !Number.isFinite(s.virtualMinutes) ||
    !s.identity ||
    !input.records.some((r) => r.kind === 'nascimento')
  )
    throw new Error('backup_invalido');
  if (
    input.records.filter((r) => r.kind === 'nascimento').length !== 1 ||
    new Set(input.records.map((r) => r.id)).size !== input.records.length
  )
    throw new Error('backup_nascimento_invalido');
  const store = new Store(env.DB);
  const token = await store.acquire(Date.now());
  if (!token) throw new Error('motor_ocupado');
  try {
    if ((await store.state()) || (await store.recent(1)).length)
      throw new Error('restauracao_exige_banco_vazio');
    // Import is all-or-nothing. Conservative UI size bound avoids D1/Worker request limits.
    const statements = [
      env.DB.prepare(
        'INSERT INTO commit_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM lease WHERE token=? AND expires>?) THEN 1 ELSE 0 END',
      ).bind(token, Date.now()),
      env.DB.prepare("INSERT INTO world VALUES('principal',?,?)").bind(
        JSON.stringify(s),
        s.revision,
      ),
      ...input.records.map((r) => store.insert(r)),
      ...input.budgets.map((r) =>
        env.DB.prepare('INSERT INTO budgets VALUES(?,?,?,?)').bind(
          r.day,
          r.model,
          r.calls,
          r.tokens,
        ),
      ),
      ...input.calls.map((r) =>
        env.DB.prepare('INSERT INTO calls(id,day,model,at,reserved_tokens,actual_tokens,status) VALUES(?,?,?,?,?,?,?)').bind(
          r.id,
          r.day,
          r.model,
          r.at,
          r.reserved_tokens,
          r.actual_tokens,
          r.status,
        ),
      ),
      ...input.inbox.map((r) =>
        env.DB.prepare('INSERT INTO inbox(id,content,at,consumed) VALUES(?,?,?,?)').bind(r.id, r.content, r.at, r.consumed),
      ),
      ...input.retrievals.map((r) =>
        env.DB.prepare('INSERT INTO retrievals VALUES(?,?,?)').bind(
          r.memory_id,
          r.count,
          r.last_at,
        ),
      ),
      env.DB.prepare('DELETE FROM commit_guard'),
    ];
    await env.DB.batch(statements);
    return { restored: true };
  } finally {
    await store.release(token);
  }
}
