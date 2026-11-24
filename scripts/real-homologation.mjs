import {remoteClient} from './remote-client.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const mode=process.argv[2]??'status';const client=await remoteClient('homologation');
if(mode==='diagnostics'){
 const results=[];for(const model of ['lite','flash']){try{const result=await client.request('diagnostics/gemini',{model});results.push(result);console.log(JSON.stringify(result));}catch(e){results.push({model,error:e.message});console.log(JSON.stringify({model,error:e.message}));}}
 await writeFile('artifacts/gemini-live-diagnostics.json',JSON.stringify(results,null,2));
}else if(mode==='start-accelerated'){const result=await client.request('experiment',{action:'start',hours:1,maxCalls:60,mode:'acelerado'});console.log(JSON.stringify(result));}
else if(mode==='step'){
 const count=Math.min(20,Math.max(1,Number(process.argv[3])||1));let history=[];try{history=JSON.parse(await readFile('artifacts/cognitive-live-cycles.json','utf8'));}catch{}
 for(let i=0;i<count;i++){
 const started=Date.now();try{const result=await client.request('experiment',{action:'step',virtualMinutes:60,model:i===Math.floor(count/2)&&count>2?'flash':'lite'});const snapshot=await client.request('state');const item={at:new Date().toISOString(),result,decisions:snapshot.state?.decisions,virtualMinutes:snapshot.state?.virtualMinutes,name:snapshot.state?.identity.name,model:snapshot.state?.lastModel,recent:snapshot.recent};history.push(item);await writeFile('artifacts/cognitive-live-cycles.json',JSON.stringify(history,null,2));console.log(JSON.stringify({at:item.at,status:result.status,decisions:item.decisions,virtualMinutes:item.virtualMinutes,model:item.model,name:item.name,wallMs:Date.now()-started}));if(['suspenso','falha_motor','experimento_encerrado'].includes(result.status))break;}catch(e){console.log(JSON.stringify({error:e.message}));break;}
 if(i<count-1)await new Promise(resolve=>setTimeout(resolve,Math.max(10000,22000-(Date.now()-started))));
 }
}else if(mode==='start-autonomous'){
 // Real-time autonomous run of a DISPOSABLE creature. Deadline and call ceiling are enforced
 // server-side by Cron (runCycle -> stopExperiment), so no local process needs to stay alive.
 const hours=Math.min(72,Math.max(1,Number(process.argv[3])||24)),maxCalls=Math.min(180,Math.max(1,Number(process.argv[4])||110));
 const info=await client.request('monitor');if(info.experiment?.status==='ativo')throw new Error('experiment_already_active');
 const result=await client.request('experiment',{action:'start',hours,maxCalls,mode:'autonomo'});const state=await client.request('state');
 const record={url:client.base,startedAt:new Date(result.started_at).toISOString(),endsAt:new Date(result.ends_at).toISOString(),hours,maxCalls,mode:'autonomo',minDecisionMinutes:15,browserRequired:false,localProcessRequired:false,creature:{bornAt:state.state?new Date(state.state.bornAt).toISOString():null,decisions:state.state?.decisions??null},budgetAtStart:{local:info.usage,shared:info.sharedUsage},note:'Disposable creature. Cron executes on Cloudflare; computer-off operation must be verified with scripts/verify-offline-window.mjs over a window when this computer was actually off.'};
 await writeFile('artifacts/autonomy-experiment.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));
}else if(mode==='tools'){
 // INDUCED scenarios in the isolated TOOL_DB. Real Gemini responses; prompts direct the test,
 // so outcomes demonstrate tool mechanics only, never spontaneous interests or preferences.
 const list=(process.argv[3]??'research,create,music_object,read,revise,habitat,complete,memory_message').split(',');let out=[];try{out=JSON.parse(await readFile('artifacts/tool-tests-induced.json','utf8')).results.filter(r=>r.status==='decisao_registrada'&&!list.includes(r.scenario));}catch{}
 for(const scenario of list){let entry,attempts=0;
  while(attempts++<3){const started=Date.now();
   try{const r=await client.request('diagnostics/tools',{scenario,model:'lite'});
    if(r.status==='backoff'){const wait=Math.max(0,r.nextAttempt-Date.now())+5000;console.log(JSON.stringify({scenario,backoffMs:wait}));await new Promise(res=>setTimeout(res,wait));continue;}
    const marker=Math.max(...(r.recent??[]).filter(x=>x.kind==='ensaio_ferramenta'&&x.data?.scenario===scenario).map(x=>x.seq));const fresh=(r.recent??[]).filter(x=>x.seq>marker);
    entry={scenario,induced:true,status:r.result?.status,decisionsBefore:r.beforeDecisions,decisionsAfter:r.afterDecisions,
     proposed:fresh.find(x=>x.kind==='intencao')?.data?.proposed??null,
     created:fresh.filter(x=>!['intencao','memoria','erro_ferramenta','atividade_concluida','interrupcao','erro'].includes(x.kind)).map(x=>({kind:x.kind,entityId:x.entityId,content:String(x.content).slice(0,160),format:x.data?.artifact?.format??null,version:x.data?.version??null,sources:x.data?.results?.map(s=>s.url)??undefined})),
     rejected:fresh.filter(x=>x.kind==='erro_ferramenta').map(x=>({tool:x.data.tool,code:x.data.code,detail:x.data.detail??null})),
     error:fresh.find(x=>x.kind==='erro')?.data??null,wallMs:Date.now()-started};
   }catch(e){entry={scenario,induced:true,error:e.message,wallMs:Date.now()-started};}
   if(entry.status==='suspenso'&&attempts<3){console.log(JSON.stringify(entry));await new Promise(res=>setTimeout(res,310000));continue;}break;}
  out.push(entry);console.log(JSON.stringify(entry));await writeFile('artifacts/tool-tests-induced.json',JSON.stringify({checkedAt:new Date().toISOString(),database:'bunborn-tool-tests (isolated)',note:'Induced scenarios: prompts instruct which tool to use. Real model output, not spontaneous behaviour. External failures (HTTP 503) are recorded, not retried silently.',results:out},null,2));
  await new Promise(r=>setTimeout(r,20000));}
}else if(mode==='stop'){console.log(JSON.stringify(await client.request('experiment',{action:'stop'})));}
else {const state=await client.request('state');const monitor=await client.request('monitor');const report={checkedAt:new Date().toISOString(),state:state.state,monitor};await writeFile('artifacts/remote-status.json',JSON.stringify(report,null,2));console.log(JSON.stringify({url:client.base,decisions:state.state?.decisions,name:state.state?.identity?.name,usage:monitor.usage,heartbeat:monitor.heartbeat,experiment:monitor.experiment,storage:monitor.storage}));}
