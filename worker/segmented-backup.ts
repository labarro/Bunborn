import {z} from 'zod';
import {stateSchema} from '../shared/validation';
import {artifactSchema,validLayout,type State} from '../shared/domain';
import {Store,decode,type Row} from './store';
import type {Env} from './provider';
// Tables that belong to the existence. `heartbeats`, `rate_limits`, leases and
// backup/restore bookkeeping are per-deployment operational data: they are not
// exported, so Cron heartbeats may keep running during a frozen export without
// changing the snapshot.
const descriptors:Record<string,Record<string,string>>={
 records:{seq:'seq',id:'id',entity_id:'entityId',kind:'kind',category:'category',content:'content',data:'data',real_at:'realAt',virtual_at:'virtualAt',importance:'importance',confidence:'confidence',associations:'associations',origin:'origin'},
 budgets:{day:'day',model:'model',calls:'calls',tokens:'tokens'},
 calls:{id:'id',day:'day',model:'model',at:'at',reserved_tokens:'reserved_tokens',actual_tokens:'actual_tokens',status:'status',latency_ms:'latency_ms',scope:'scope'},
 inbox:{id:'id',content:'content',at:'at',consumed:'consumed',author:'author'},
 retrievals:{memory_id:'memory_id',count:'count',last_at:'last_at'},
 record_links:{record_id:'record_id',related_id:'related_id'},
 cycle_metrics:{id:'id',started_at:'started_at',completed_at:'completed_at',decision_before:'decision_before',decision_after:'decision_after',status:'status',logical_bytes_before:'logical_bytes_before',logical_bytes_after:'logical_bytes_after',rows_read:'rows_read',rows_written:'rows_written',db_size:'db_size',shared_reads:'shared_reads',shared_writes:'shared_writes'},
 experiment:{id:'id',started_at:'started_at',ends_at:'ends_at',max_calls:'max_calls',status:'status',mode:'mode',context:'context'},
 checkpoints:{id:'id',at:'at',revision:'revision',state:'state',upper_seq:'upper_seq',digest:'digest'},
 operations:{key:'key',data:'data',updated_at:'updated_at'},
};
export const backupTables=Object.keys(descriptors);
const names=backupTables;const encoder=new TextEncoder();
export const PAGE_ROWS=80,PAGE_BYTES=65000;
// Deterministic canonical JSON: keys sorted by code point (never locale-dependent).
export const canonical=(value:unknown)=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v);
export async function sha(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
async function sign(env:Env,value:unknown){if(!env.SESSION_SECRET)throw new Error('secret_ausente');const key=await crypto.subtle.importKey('raw',encoder.encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(canonical(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');}
async function locks(env:Env){return (await env.DB.prepare("SELECT key,data FROM operations WHERE key IN ('backup-freeze','restore-lock')").all<{key:string;data:string}>()).results.map(lock=>({key:lock.key,...JSON.parse(lock.data) as {id:string;expires?:number}}));}
export async function isFrozen(env:Env){return (await locks(env)).some(lock=>lock.key==='restore-lock'||(lock.expires??0)>Date.now());}
export async function restoreLocked(env:Env){return (await locks(env)).some(lock=>lock.key==='restore-lock');}
type SegmentHeader={table:string;after:number;count:number;digest:string};
export type Manifest={format:'bunborn';version:2;id:string;createdAt:number;source:string;state:State;upper:Record<string,number>;counts:Record<string,number>;pageSize:number};
const filter=(table:string)=>table==='operations'?" AND key NOT IN ('backup-freeze','restore-lock')":'';
export async function beginExport(env:Env){
 const store=new Store(env.DB);const token=await store.acquire(Date.now());if(!token)throw new Error('motor_ocupado');
 try{const state=await store.state();if(!state?.paused)throw new Error('pause_para_exportar');if(await isFrozen(env))throw new Error('backup_ou_restauracao_em_andamento');
 const result=await env.DB.batch(names.map(table=>env.DB.prepare(`SELECT COALESCE(MAX(rowid),0) AS upper,COUNT(*) AS count FROM ${table} WHERE 1=1${filter(table)}`)));
 const manifest:Manifest={format:'bunborn',version:2,id:crypto.randomUUID(),createdAt:Date.now(),source:env.ENVIRONMENT_ID??'development',state,upper:Object.fromEntries(names.map((name,i)=>[name,(result[i].results[0] as {upper:number}).upper])),counts:Object.fromEntries(names.map((name,i)=>[name,(result[i].results[0] as {count:number}).count])),pageSize:PAGE_ROWS};
 const now=Date.now(),expires=now+3600000;
 await env.DB.batch([
  env.DB.prepare('DELETE FROM backup_segments WHERE session_id IN (SELECT id FROM backup_sessions WHERE expires<=?)').bind(now),
  env.DB.prepare('DELETE FROM backup_sessions WHERE expires<=?').bind(now),
  env.DB.prepare('INSERT INTO backup_sessions(id,revision,expires,manifest) VALUES(?,?,?,?)').bind(manifest.id,state.revision,expires,JSON.stringify({manifest})),
  env.DB.prepare("INSERT INTO operations(key,data,updated_at) VALUES('backup-freeze',?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at").bind(JSON.stringify({id:manifest.id,expires}),now)]);
 return manifest;
 }finally{await store.release(token);}
}
async function snapshot(env:Env,id:string){const row=await env.DB.prepare('SELECT * FROM backup_sessions WHERE id=? AND expires>?').bind(id,Date.now()).first<{manifest:string;revision:number}>();const state=await new Store(env.DB).state();const freeze=(await locks(env)).find(lock=>lock.key==='backup-freeze');if(!row||!state?.paused||state.revision!==row.revision||freeze?.id!==id)throw new Error('snapshot_expirado_ou_alterado');return (JSON.parse(row.manifest) as {manifest:Manifest}).manifest;}
export async function exportSegment(env:Env,id:string,table:string,after:number){
 if(!names.includes(table)||!Number.isSafeInteger(after)||after<0)throw new Error('segmento_invalido');const manifest=await snapshot(env,id);
 const raw=await env.DB.prepare(`SELECT rowid AS cursor,* FROM ${table} WHERE rowid>? AND rowid<=?${filter(table)} ORDER BY rowid LIMIT ${PAGE_ROWS}`).bind(after,manifest.upper[table]).all<Row&{cursor:number}>();let selected=raw.results;
 let rows=selected.map(row=>table==='records'?decode(row):Object.fromEntries(Object.keys(descriptors[table]).map(key=>[key,(row as unknown as Record<string,unknown>)[key]])));
 while(rows.length>1&&encoder.encode(JSON.stringify(rows)).length>PAGE_BYTES){selected=selected.slice(0,-1);rows=rows.slice(0,-1);}
 const digest=await sha(JSON.stringify(rows));const last=selected.length?selected[selected.length-1].cursor:after;const next=selected.length&&last<manifest.upper[table]?last:null;
 // One row per (table,after): concurrent or repeated requests are idempotent and must agree.
 await env.DB.prepare('INSERT INTO backup_segments(session_id,table_name,after,last_cursor,count,digest) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING').bind(id,table,after,last,rows.length,digest).run();
 const stored=await env.DB.prepare('SELECT digest,count,last_cursor FROM backup_segments WHERE session_id=? AND table_name=? AND after=?').bind(id,table,after).first<{digest:string;count:number;last_cursor:number}>();
 if(!stored||stored.digest!==digest||stored.count!==rows.length||stored.last_cursor!==last)throw new Error('snapshot_alterado');
 return {table,after,count:rows.length,digest,rows,next};
}
export async function sealExport(env:Env,id:string){
 const manifest=await snapshot(env,id);
 const all=(await env.DB.prepare('SELECT table_name,after,last_cursor,count,digest FROM backup_segments WHERE session_id=? ORDER BY after').bind(id).all<{table_name:string;after:number;last_cursor:number;count:number;digest:string}>()).results;
 const headers:SegmentHeader[]=[];
 for(const table of names){
  // Segments must form one contiguous chain from rowid 0 covering exactly the frozen row count.
  // Off-chain pages requested with arbitrary cursors are ignored, never signed.
  const byAfter=new Map(all.filter(s=>s.table_name===table).map(s=>[s.after,s]));let expected=0,total=0,first=true;
  while(true){const s=byAfter.get(expected);if(!s)break;if(s.count===0&&!first)break;headers.push({table,after:s.after,count:s.count,digest:s.digest});total+=s.count;first=false;if(s.count===0||s.last_cursor===expected)break;expected=s.last_cursor;}
  if(first||total!==manifest.counts[table])throw new Error('exportacao_incompleta_'+table);
 }
 const payload={manifest,segments:headers};const signature=await sign(env,payload);
 await env.DB.prepare("DELETE FROM operations WHERE key='backup-freeze' AND json_extract(data,'$.id')=?").bind(id).run();
 return {signature,headers,digest:await sha(canonical(payload))};
}
export async function cancelExport(env:Env,id:string){await env.DB.batch([env.DB.prepare("DELETE FROM operations WHERE key='backup-freeze' AND json_extract(data,'$.id')=?").bind(id),env.DB.prepare('DELETE FROM backup_segments WHERE session_id=?').bind(id)]);}
const manifestSchema=z.object({format:z.literal('bunborn'),version:z.literal(2),id:z.string().uuid(),createdAt:z.number(),source:z.string(),state:stateSchema,upper:z.record(z.string(),z.number().int().nonnegative()),counts:z.record(z.string(),z.number().int().nonnegative()),pageSize:z.number().int().min(1).max(PAGE_ROWS)}).strict();
const headersSchema=z.array(z.object({table:z.string(),after:z.number().int().nonnegative(),count:z.number().int().nonnegative().max(PAGE_ROWS),digest:z.string().regex(/^[a-f0-9]{64}$/)})).max(20000);
export async function beginRestore(env:Env,input:unknown){
 const value=z.object({manifest:manifestSchema,seal:z.object({signature:z.string().regex(/^[a-f0-9]{64}$/),headers:headersSchema,digest:z.string()}).strict()}).strict().parse(input);
 // Strict schemas reject unsigned extra keys, so the raw input equals the validated value;
 // persisting the raw manifest keeps the exact signed key order of the state.
 const raw=input as {manifest:Manifest};
 const payload={manifest:value.manifest,segments:value.seal.headers};if(await sign(env,payload)!==value.seal.signature||await sha(canonical(payload))!==value.seal.digest)throw new Error('assinatura_ou_integridade_invalida');
 if(env.ENVIRONMENT_ID==='production'&&value.manifest.source!=='production')throw new Error('origem_de_teste_proibida_na_producao');
 if(!value.manifest.state.paused||!validLayout(value.manifest.state.objects,value.manifest.state.position))throw new Error('estado_invalido');
 for(const table of names){if(!Number.isSafeInteger(value.manifest.counts[table])||value.manifest.counts[table]<0)throw new Error('manifesto_incompleto');if(value.seal.headers.filter(h=>h.table===table).reduce((n,h)=>n+h.count,0)!==value.manifest.counts[table])throw new Error('manifesto_inconsistente_'+table);}
 if(value.seal.headers.some(h=>!names.includes(h.table)))throw new Error('tabela_invalida');
 const store=new Store(env.DB);const token=await store.acquire(Date.now());if(!token)throw new Error('motor_ocupado');
 try{
  const id=value.manifest.id;
  // Resume first: a partially applied session legitimately leaves the target non-empty.
  const existing=await env.DB.prepare('SELECT status,hash FROM restore_sessions WHERE id=?').bind(id).first<{status:string;hash:string}>();
  if(existing){if(existing.hash!==value.seal.digest)throw new Error('sessao_divergente');return {id,status:existing.status,resumed:true};}
  const otherLock=(await locks(env)).find(lock=>lock.key==='restore-lock');if(otherLock)throw new Error('outra_restauracao_em_andamento');
  if(await store.state()||(await store.recent(1)).length)throw new Error('restauracao_exige_banco_vazio');
  await env.DB.batch([env.DB.prepare("INSERT INTO restore_sessions(id,status,manifest,hash,started_at) VALUES(?,'upload',?,?,?)").bind(id,JSON.stringify({manifest:raw.manifest,seal:value.seal}),value.seal.digest,Date.now()),env.DB.prepare("INSERT INTO operations(key,data,updated_at) VALUES('restore-lock',?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at").bind(JSON.stringify({id}),Date.now())]);return {id,status:'upload',resumed:false};
 }finally{await store.release(token);}
}
async function activeSession(env:Env,id:string){const session=await env.DB.prepare('SELECT manifest,status FROM restore_sessions WHERE id=?').bind(id).first<{manifest:string;status:string}>();if(!session)throw new Error('sessao_de_restauracao_invalida');return {status:session.status,value:JSON.parse(session.manifest) as {manifest:Manifest;seal:{headers:SegmentHeader[]}}};}
export async function uploadRestoreSegment(env:Env,input:unknown){const value=z.object({id:z.string().uuid(),idx:z.number().int().nonnegative().max(20000),rows:z.array(z.record(z.string(),z.unknown())).max(PAGE_ROWS)}).parse(input);const session=await activeSession(env,value.id);if(session.status!=='upload')throw new Error('sessao_de_restauracao_invalida');const header=session.value.seal.headers[value.idx];if(!header||header.count!==value.rows.length||await sha(JSON.stringify(value.rows))!==header.digest)throw new Error('segmento_corrompido');
 if(header.table==='records')for(const row of value.rows){z.object({id:z.string().min(1).max(100),entityId:z.string().max(300),kind:z.string().max(40),content:z.string().max(14000),associations:z.array(z.string()).max(100),data:z.record(z.string(),z.unknown())}).passthrough().parse(row);if(row.kind==='artefato')artifactSchema.parse((row.data as {artifact:unknown}).artifact);}
 const json=JSON.stringify(value.rows),bytes=encoder.encode(json).length;if(bytes>180000)throw new Error('segmento_excessivo');
 await env.DB.prepare('INSERT INTO restore_chunks(session_id,idx,digest,table_name,rows_json) VALUES(?,?,?,?,?) ON CONFLICT(session_id,idx) DO NOTHING').bind(value.id,value.idx,header.digest,header.table,json).run();return {accepted:true,idx:value.idx};}
export async function applyRestore(env:Env,id:string){
 const session=await activeSession(env,id);if(session.status==='complete')return {complete:true};const value=session.value;
 const lock=(await locks(env)).find(l=>l.key==='restore-lock');if(lock?.id!==id)throw new Error('sessao_sem_trava');
 const total=await env.DB.prepare('SELECT COUNT(*) AS n FROM restore_chunks WHERE session_id=?').bind(id).first<{n:number}>();if(total?.n!==value.seal.headers.length)throw new Error('upload_incompleto');
 const chunks=await env.DB.prepare('SELECT idx,table_name FROM restore_chunks WHERE session_id=? AND applied=0 ORDER BY idx LIMIT 3').bind(id).all<{idx:number;table_name:string}>();
 for(const chunk of chunks.results){const columns=descriptors[chunk.table_name];if(!columns)throw new Error('tabela_invalida');
  // The applied flag is checked inside the same transaction as the insert, so concurrent
  // or retried apply requests can never import a chunk twice.
  const defaults:Record<string,string>=chunk.table_name==='inbox'?{author:"'responsavel'"}:{};
  const sql=`INSERT INTO ${chunk.table_name}(${Object.keys(columns).join(',')}) SELECT ${Object.entries(columns).map(([column,key])=>defaults[column]?`COALESCE(json_extract(value,'$.${key}'),${defaults[column]})`:`json_extract(value,'$.${key}')`).join(',')} FROM json_each((SELECT rows_json FROM restore_chunks WHERE session_id=? AND idx=?)) WHERE (SELECT applied FROM restore_chunks WHERE session_id=? AND idx=?)=0`;
  await env.DB.batch([env.DB.prepare(sql).bind(id,chunk.idx,id,chunk.idx),env.DB.prepare('UPDATE restore_chunks SET applied=1 WHERE session_id=? AND idx=? AND applied=0').bind(id,chunk.idx)]);}
 const remaining=await env.DB.prepare('SELECT COUNT(*) AS n FROM restore_chunks WHERE session_id=? AND applied=0').bind(id).first<{n:number}>();if(remaining?.n)return {complete:false,remaining:remaining.n};
 const checks=await env.DB.batch(names.map(table=>env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE 1=1${filter(table)}`)));for(let i=0;i<names.length;i++)if((checks[i].results[0] as {n:number}).n!==value.manifest.counts[names[i]])throw new Error('contagem_divergente_'+names[i]);
 const births=await env.DB.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='nascimento'").first<{n:number}>();if(births?.n!==1)throw new Error('nascimento_invalido');
 // World row is inserted last; its primary key makes a concurrent finalisation fail atomically.
 await env.DB.batch([env.DB.prepare("INSERT INTO world(id,state,revision) VALUES('principal',?,?)").bind(JSON.stringify(value.manifest.state),value.manifest.state.revision),env.DB.prepare("UPDATE restore_sessions SET status='complete' WHERE id=?").bind(id),env.DB.prepare("DELETE FROM operations WHERE key='restore-lock' AND json_extract(data,'$.id')=?").bind(id),env.DB.prepare('DELETE FROM restore_chunks WHERE session_id=?').bind(id)]);return {complete:true,state:value.manifest.state};
}
