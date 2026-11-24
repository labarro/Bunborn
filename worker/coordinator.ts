import {DurableObject}from'cloudflare:workers';
import {boundedJson,type Env}from'./provider';
import {executeTask,type Task}from'./coordination';
import {safeError}from'./engine';
import {handleApi}from'./http';
// A single executor, not a second agent. Identity/history remain exclusively in D1.
// SQLite-backed Durable Objects are available on Workers Free; their per-request CPU
// budget is far above the 10 ms of the public Worker, so validation, D1 work, context
// assembly and cognition run here. Cognitive/administrative tasks are serialized in one
// queue; observer reads are not queued behind a slow model call (D1 leases still fence
// every state mutation).
export class CognitionCoordinator extends DurableObject<Env>{
 private tail:Promise<unknown>=Promise.resolve();
 private serialized(task:Task){const work=this.tail.catch(()=>undefined).then(()=>executeTask(this.env,task));this.tail=work.then(()=>undefined,()=>undefined);return work;}
 async fetch(request:Request){
  const url=new URL(request.url);
  if(url.hostname==='bunborn-internal'&&url.pathname==='/execute'){const task=await boundedJson(request as unknown as Response,200000) as Task;try{return Response.json(await this.serialized(task));}catch(e){return Response.json({error:safeError(e)},{status:409});}}
  // Authenticated observer API forwarded by the gateway (re-verified inside handleApi).
  return handleApi(request,{...this.env,LOCAL_EXECUTOR:task=>this.serialized(task as Task)});
 }
}
