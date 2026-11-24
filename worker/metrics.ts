import type {Env} from './provider';
type Counters={reads:number;writes:number;size:number;queries:number};
export function instrument(env:Env){
 const local:Counters={reads:0,writes:0,size:0,queries:0},shared:Counters={reads:0,writes:0,size:0,queries:0};
 function wrap(db:D1Database,counters:Counters):D1Database{
  const originals=new WeakMap<object,D1PreparedStatement>();
  function observe<T extends {meta?:{rows_read?:number;rows_written?:number;size_after?:number}}>(result:T){counters.queries++;counters.reads+=result.meta?.rows_read??0;counters.writes+=result.meta?.rows_written??0;counters.size=Math.max(counters.size,result.meta?.size_after??0);return result;}
  function statement(inner:D1PreparedStatement){const value={bind(...args:unknown[]){return statement(inner.bind(...args));},async all(){return observe(await inner.all());},async run(){return observe(await inner.run());},async first(column?:string){const result=observe(await inner.all<Record<string,unknown>>());const row=result.results[0];return row?(column?row[column]:row):null;}};originals.set(value,inner);return value as unknown as D1PreparedStatement;}
  return {prepare(sql:string){return statement(db.prepare(sql));},async batch(items:D1PreparedStatement[]){return (await db.batch(items.map(item=>originals.get(item)??item))).map(observe);}} as unknown as D1Database;
 }
 return {env:{...env,DB:wrap(env.DB,local),BUDGET_DB:env.BUDGET_DB?wrap(env.BUDGET_DB,shared):undefined},local,shared};
}
