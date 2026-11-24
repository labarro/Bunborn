import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
// Real SQLite/FTS5 with a small D1 binding adapter. Network and model are never implied real.
export function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0001_initial.sql', '0002_capacity.sql','0003_operational.sql','0004_restore_progress.sql','0005_cycle_measurements.sql','0006_storage_headroom.sql','0007_backup_segments.sql','0008_message_author.sql','0009_insights_visits.sql'])
    sqlite.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
  class Statement {
    constructor(
      public sql: string,
      public args: unknown[] = [],
    ) {}
    bind(...args: unknown[]) {
      return new Statement(this.sql, args);
    }
    async first<T>(): Promise<T | null> {
      return (sqlite.prepare(this.sql).get(...(this.args as never[])) as T) ?? null;
    }
    async all<T>() {
      return {
        results: sqlite.prepare(this.sql).all(...(this.args as never[])) as T[],
        success: true,
      };
    }
    async run() {
      const result = sqlite.prepare(this.sql).run(...(this.args as never[]));
      return { success: true, meta: { changes: Number(result.changes) } };
    }
  }
  const db = {
    prepare: (sql: string) => new Statement(sql),
    // D1 executes each batch as one serialized transaction. Run it synchronously so
    // concurrent promises in tests can never interleave inside a transaction.
    async batch(statements: Statement[]) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((statement) =>
          /^\s*SELECT\b/i.test(statement.sql)
            ? { results: sqlite.prepare(statement.sql).all(...(statement.args as never[])), success: true }
            : { success: true, meta: { changes: Number(sqlite.prepare(statement.sql).run(...(statement.args as never[])).changes) } },
        );
        sqlite.exec('COMMIT');
        return results;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return { db: db as unknown as D1Database, sqlite };
}
