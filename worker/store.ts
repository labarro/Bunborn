import { memoryScore, type RecordEntry, type State } from '../shared/domain';
export type Row = {
  seq: number;
  id: string;
  entity_id: string;
  kind: string;
  category: string;
  content: string;
  data: string;
  real_at: number;
  virtual_at: number;
  importance: number;
  confidence: number;
  associations: string;
  origin: string;
};
export const decode = (r: Row): RecordEntry => ({
  seq: r.seq,
  id: r.id,
  entityId: r.entity_id,
  kind: r.kind,
  category: r.category,
  content: r.content,
  data: JSON.parse(r.data),
  realAt: r.real_at,
  virtualAt: r.virtual_at,
  importance: r.importance,
  confidence: r.confidence,
  associations: JSON.parse(r.associations),
  origin: r.origin,
});
/** Tool rejection with factual detail the creature can read in the next cycle. */
export class ToolError extends Error {
  constructor(code: string, public detail: Record<string, unknown>) {
    super(code);
  }
}
export class Store {
  constructor(public db: D1Database, public pending:RecordEntry[] = []) {}
  withPending(records:RecordEntry[]){return new Store(this.db,records);}
  async state(): Promise<State | null> {
    const row = await this.db
      .prepare("SELECT state FROM world WHERE id='principal'")
      .first<{ state: string }>();
    return row ? JSON.parse(row.state) : null;
  }
  async acquire(now: number): Promise<string | null> {
    const token = crypto.randomUUID();
    const row = await this.db
      .prepare('UPDATE lease SET token=?,expires=? WHERE id=1 AND expires<=? RETURNING token')
      // 5 min: a decision (≤45 s) plus the painter (≤75 s, one quick retry) must commit inside the lease (27/11).
      .bind(token, now + 300000, now)
      .first();
    return row ? token : null;
  }
  async release(token: string) {
    await this.db.prepare('UPDATE lease SET expires=0 WHERE id=1 AND token=?').bind(token).run();
  }
  insert(r: RecordEntry) {
    return this.db
      .prepare(
        'INSERT INTO records(id,entity_id,kind,category,content,data,real_at,virtual_at,importance,confidence,associations,origin) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        r.id,
        r.entityId,
        r.kind,
        r.category,
        r.content,
        JSON.stringify(r.data),
        r.realAt,
        r.virtualAt,
        r.importance,
        r.confidence,
        JSON.stringify(r.associations),
        r.origin,
      );
  }
  async commit(
    token: string,
    state: State,
    records: RecordEntry[],
    inbox: string[] = [],
    birth = false,
  ) {
    const expected = state.revision;
    const nextRevision = expected + 1;
    const guard = this.db
      .prepare(
        "INSERT INTO commit_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM lease WHERE id=1 AND token=? AND expires>?) AND (?=1 OR EXISTS(SELECT 1 FROM world WHERE id='principal' AND revision=?)) THEN 1 ELSE 0 END",
      )
      .bind(token, Date.now(), birth ? 1 : 0, expected);
    const write = birth
      ? this.db.prepare("INSERT INTO world(id,state,revision) VALUES('principal',?,?)")
      : this.db.prepare("UPDATE world SET state=?,revision=? WHERE id='principal'");
    await this.db.batch([
      guard,
      write.bind(JSON.stringify({ ...state, revision: nextRevision }), nextRevision),
      ...records.map((r) => this.insert(r)),
      ...records.flatMap(r=>[...new Set([...r.associations,r.entityId])].slice(0,24).map(id=>this.db.prepare('INSERT OR IGNORE INTO record_links(record_id,related_id) VALUES(?,?)').bind(r.id,id))),
      ...inbox.map((id) => this.db.prepare('UPDATE inbox SET consumed=1 WHERE id=?').bind(id)),
      this.db.prepare('DELETE FROM commit_guard'),
    ]);
    state.revision = nextRevision;
  }
  async records(kind: string, after = 0, limit = 80, until = Number.MAX_SAFE_INTEGER) {
    const r = await this.db
      .prepare('SELECT * FROM records WHERE kind=? AND seq>? AND seq<=? ORDER BY seq ASC LIMIT ?')
      .bind(kind, after, until, limit)
      .all<Row>();
    return r.results.map(decode);
  }
  async recent(limit = 40) {
    const r = await this.db
      .prepare('SELECT * FROM records ORDER BY seq DESC LIMIT ?')
      .bind(limit)
      .all<Row>();
    return r.results.map(decode);
  }
  async latest(kind: string, limit = 80) {
    const r = await this.db
      .prepare(
        'SELECT * FROM records WHERE seq IN (SELECT MAX(seq) FROM records WHERE kind=? GROUP BY entity_id) ORDER BY seq DESC LIMIT ?',
      )
      .bind(kind, limit)
      .all<Row>();
    const combined=[...r.results.map(decode),...this.pending.filter(r=>r.kind===kind)];return [...new Map(combined.map(r=>[r.entityId,r])).values()].sort((a,b)=>b.realAt-a.realAt).slice(0,limit);
  }
  async entity(id: string) {
    const buffered=[...this.pending].reverse().find(r=>r.entityId===id||r.id===id);if(buffered)return buffered;
    const r = await this.db
      .prepare('SELECT * FROM records WHERE entity_id=? OR id=? ORDER BY seq DESC LIMIT 1')
      .bind(id,id)
      .first<Row>();
    return r ? decode(r) : null;
  }
  async memories(query: string, now: number, limit = 14, keep: (r: RecordEntry) => boolean = () => true) {
    const words = query.replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi,'').match(/[\p{L}\p{N}]{3,}/gu)?.slice(0, 24) ?? [];
    const matched = words.length
      ? (
          await this.db
            .prepare(
              'SELECT r.* FROM memory_search f JOIN records r ON r.seq=f.rowid WHERE memory_search MATCH ? ORDER BY rank LIMIT 45',
            )
            .bind(words.map((w) => '"' + w + '"').join(' OR '))
            .all<Row>()
        ).results
      : [];
    const recent = (
      await this.db
        .prepare("SELECT * FROM records WHERE kind='memoria' ORDER BY seq DESC LIMIT 24")
        .all<Row>()
    ).results;
    const important = (
      await this.db
        .prepare(
          "SELECT * FROM records WHERE kind='memoria' AND importance>=0.8 ORDER BY seq DESC LIMIT 12",
        )
        .all<Row>()
    ).results;
    const seeds=[...new Set(matched.slice(0,8).flatMap(r=>[r.id,r.entity_id]))].slice(0,16);
    const linked=seeds.length?(await this.db.prepare(`SELECT DISTINCT r.* FROM record_links l JOIN records r ON r.id=l.record_id OR r.id=l.related_id WHERE l.related_id IN (${seeds.map(()=>'?').join(',')}) OR l.record_id IN (${seeds.map(()=>'?').join(',')}) LIMIT 24`).bind(...seeds,...seeds).all<Row>()).results:[];
    const linkedIds=new Set(linked.map(r=>r.id));
    const entries = [
      ...new Map([...matched, ...recent, ...important,...linked].map((r) => [r.id, decode(r)])).values(),
    ]
      .filter(keep)
      .map(record=>({record,score:memoryScore(record,query,now)+(linkedIds.has(record.id)?.22:0)}))
      .sort((a,b)=>b.score-a.score)
      .slice(0, limit).map(item=>item.record);
    return entries;
  }
  async retrievalStats(ids: string[]) {
    const out = new Map<string, { count: number; last_at: number }>();
    if (!ids.length) return out;
    const rows = await this.db.prepare(`SELECT memory_id, count, last_at FROM retrievals WHERE memory_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ memory_id: string; count: number; last_at: number }>();
    for (const r of rows.results) out.set(r.memory_id, { count: r.count, last_at: r.last_at });
    return out;
  }
  async markRetrieval(ids: string[], now: number) {
    if (ids.length)
      await this.db.batch(
        ids.map((id) =>
          this.db
            .prepare(
              'INSERT INTO retrievals(memory_id,count,last_at) VALUES(?,1,?) ON CONFLICT(memory_id) DO UPDATE SET count=count+1,last_at=excluded.last_at',
            )
            .bind(id, now),
        ),
      );
  }
  async exists(ids: string[]) {
    if (!ids.length) return false;
    const missing=ids.filter(id=>!this.pending.some(r=>r.id===id));if(!missing.length)return true;
    const rows = await this.db
      .prepare(`SELECT id FROM records WHERE id IN (${missing.map(() => '?').join(',')})`)
      .bind(...missing)
      .all();
    return rows.results.length === new Set(missing).size;
  }
  async resolveEvidence(refs:string[]):Promise<RecordEntry[]>{
    const found=new Map<string,RecordEntry>();for(const ref of refs){const row=[...this.pending].reverse().find(r=>r.id===ref||r.entityId===ref);if(row)found.set(ref,row);}
    for(const alias of ['nascimento','ambiente'])if(refs.includes(alias)&&!found.has(alias)){const row=alias==='nascimento'?await this.db.prepare("SELECT * FROM records WHERE kind='nascimento' ORDER BY seq LIMIT 1").first<Row>():await this.db.prepare("SELECT * FROM records WHERE kind='memoria' AND json_extract(data,'$.status')='fato_do_ambiente' ORDER BY seq LIMIT 1").first<Row>();if(row)found.set(alias,decode(row));}
    const missing=refs.filter(ref=>!found.has(ref));
    if(missing.length){const query=`WITH requested(ref) AS (VALUES ${missing.map(()=>'(?)').join(',')}) SELECT q.ref AS requested_ref,r.* FROM requested q JOIN records r ON r.seq=(SELECT MAX(seq) FROM records WHERE id=q.ref OR entity_id=q.ref)`;const rows=await this.db.prepare(query).bind(...missing).all<Row&{requested_ref:string}>();for(const row of rows.results)found.set(row.requested_ref,decode(row));}
    const absent=refs.filter(ref=>!found.has(ref));if(absent.length)throw new ToolError('evidencia_inexistente',{missing:absent.slice(0,8),hint:'Use IDs de registros existentes (id ou entityId) ou as referências nascimento/ambiente; campos de contexto e nomes de ferramentas não são registros.'});return refs.map(ref=>found.get(ref)!);
  }
  async reserve(
    model: string,
    day: string,
    now: number,
    daily: number,
    rpm: number,
    tokens: number,
    scope='local',
    tpm = 200000,
    tpd: number | null = null,
    provider: string | null = null,
    category: string | null = null,
  ): Promise<string | null> {
    const id = crypto.randomUUID();
    try {
      await this.db.batch([
        this.db
          .prepare('INSERT INTO budgets(day,model) VALUES(?,?) ON CONFLICT DO NOTHING')
          .bind(day, model),
        this.db
          .prepare(
            'INSERT INTO commit_guard(ok) SELECT CASE WHEN (SELECT calls FROM budgets WHERE day=? AND model=?)<? AND (SELECT COUNT(*) FROM calls WHERE model=? AND at>?)<? AND COALESCE((SELECT SUM(reserved_tokens) FROM calls WHERE model=? AND at>?),0)+?<=? AND (? IS NULL OR COALESCE((SELECT tokens FROM budgets WHERE day=? AND model=?),0)+?<=?) THEN 1 ELSE 0 END',
          )
          .bind(day, model, daily, model, now - 60000, rpm, model, now - 60000, tokens, tpm, tpd, day, model, tokens, tpd),
        this.db
          .prepare(
            "INSERT INTO calls(id,day,model,at,reserved_tokens,status,scope,provider,category) VALUES(?,?,?,?,?,'reservada',?,?,?)",
          )
          .bind(id, day, model, now, tokens,scope,provider,category),
        this.db
          .prepare('UPDATE budgets SET calls=calls+1 WHERE day=? AND model=?')
          .bind(day, model),
        this.db.prepare('DELETE FROM commit_guard'),
      ]);
      return id;
    } catch (e) {
      if (String(e).includes('CHECK constraint')) return null;
      throw e;
    }
  }
  async settle(id: string, tokens: number, status: string,latency=0) {
    await this.db.batch([
      this.db.prepare('UPDATE budgets SET tokens=tokens+? WHERE (day,model)=(SELECT day,model FROM calls WHERE id=? AND actual_tokens IS NULL)').bind(tokens,id),
      this.db
        .prepare('UPDATE calls SET actual_tokens=?,status=?,latency_ms=? WHERE id=? AND actual_tokens IS NULL')
        .bind(tokens, status,latency, id),
    ]);
  }
  /**
   * Reservations never settled (Worker interrupted mid-call) are settled conservatively with the
   * reserved tokens, as if the provider had processed them: limits are never exceeded and the
   * day's token count is not undercounted. Idempotent (only rows with actual_tokens NULL).
   */
  async reconcileOrphans(now: number, olderThanMs = 10 * 60000) {
    const cut = now - olderThanMs;
    await this.db.batch([
      this.db.prepare('UPDATE budgets SET tokens=tokens+COALESCE((SELECT SUM(reserved_tokens) FROM calls c WHERE c.day=budgets.day AND c.model=budgets.model AND c.actual_tokens IS NULL AND c.at<?),0) WHERE EXISTS(SELECT 1 FROM calls c WHERE c.day=budgets.day AND c.model=budgets.model AND c.actual_tokens IS NULL AND c.at<?)').bind(cut, cut),
      this.db.prepare("UPDATE calls SET actual_tokens=reserved_tokens,status='orfa_conservadora' WHERE actual_tokens IS NULL AND at<?").bind(cut),
    ]);
  }
  async usage() {
    return (await this.db.prepare('SELECT * FROM budgets ORDER BY day DESC LIMIT 14').all())
      .results;
  }
  async inbox() {
    return (
      await this.db
        .prepare('SELECT id,content,at,author FROM inbox WHERE consumed=0 ORDER BY at LIMIT 8')
        .all<{ id: string; content: string; at: number; author?: string }>()
    ).results;
  }
  async capacity() {
    const result = await this.db
      .prepare('SELECT bytes,records FROM storage_meter WHERE id=1')
      .all<{ bytes: number; records: number }>();
    const r=result.results[0];const physical=result.meta?.size_after??0;
    return !!r && r.bytes < 179000000&&physical<400000000;
  }
}
export function entry(
  state: State,
  kind: string,
  content: string,
  data: Record<string, unknown> = {},
  options: Partial<RecordEntry> = {},
): RecordEntry {
  const id = crypto.randomUUID();
  return {
    id,
    entityId: id,
    kind,
    category: 'episodica',
    content,
    data,
    realAt: state.updatedAt,
    virtualAt: state.virtualMinutes,
    importance: 0.5,
    confidence: 1,
    associations: [],
    origin: 'motor',
    ...options,
  };
}
