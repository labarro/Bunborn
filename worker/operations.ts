import {birth,tick,administer,safeError} from './engine';
import {GeminiProvider,CognitiveError,type Env} from './provider';
import {Store,entry} from './store';
import {reconcile,quotaDay} from '../shared/domain';
import{isFrozen,sha}from'./segmented-backup';
import{instrument}from'./metrics';
export type Experiment={id:number;started_at:number;ends_at:number;max_calls:number;status:string;mode:string;context:string};
export async function experimentInfo(env:Env){return env.DB.prepare('SELECT * FROM experiment WHERE id=1').first<Experiment>();}
export async function startExperiment(env:Env,hours:number,maxCalls:number,mode:string){
 if(env.ENVIRONMENT_ID!=='homologation'||env.EXPERIMENT_ENABLED!=='true')throw new CognitiveError('experimento_nao_autorizado');
 const store=new Store(env.DB);const prior=await experimentInfo(env);if(prior?.status==='ativo')throw new CognitiveError('experimento_ja_ativo');
 if(!await store.state())await birth({...env,BIRTH_ENABLED:'true'});
 const now=Date.now();await env.DB.prepare("INSERT INTO experiment VALUES(1,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET started_at=excluded.started_at,ends_at=excluded.ends_at,max_calls=excluded.max_calls,status=excluded.status,mode=excluded.mode,context=excluded.context").bind(now,now+Math.max(1,Math.min(72,hours))*3600000,Math.max(1,Math.min(180,maxCalls)),'ativo',mode,'Criatura descartável; nome, interesses e objetivos não direcionados.').run();
 await administer(env,async s=>{s.paused=false;if(!s.failures||s.nextDecisionAt<Date.now())s.nextDecisionAt=Date.now();return [entry(s,'experimento','Início de experimento descartável com prazo e limite de chamadas.',{hours,maxCalls,mode},{origin:'homologacao'})];});return experimentInfo(env);
}
export async function stopExperiment(env:Env,status='encerrado'){
 if(env.ENVIRONMENT_ID!=='homologation')throw new CognitiveError('experimento_nao_autorizado');
 await administer(env,async s=>{s.paused=true;return [entry(s,'experimento','Experimento interrompido; estado preservado.',{status},{origin:'homologacao'})];});await env.DB.prepare('UPDATE experiment SET status=? WHERE id=1').bind(status).run();
}
export async function runCycle(inputEnv:Env,options:{acceleratedMinutes?:number;forcedModel?:'lite'|'flash'}={}){
 const measured=instrument(inputEnv),env=measured.env;
 if(await isFrozen(env))return {status:'backup_ou_restauracao_em_andamento'};
 const store=new Store(env.DB);const before=await store.state();const meter=await env.DB.prepare('SELECT bytes FROM storage_meter WHERE id=1').first<{bytes:number}>();
 if(options.acceleratedMinutes!==undefined&&before&&before.failures>0&&before.nextDecisionAt>Date.now())return {status:'backoff',nextAttempt:before.nextDecisionAt};
 if(env.ENVIRONMENT_ID==='homologation'){
  const experiment=await experimentInfo(env);if(!experiment||experiment.status!=='ativo')return {status:'experimento_inativo'};
  const used=await env.DB.prepare('SELECT COUNT(*) AS n FROM calls WHERE at>=?').bind(experiment.started_at).first<{n:number}>();
  if(Date.now()>=experiment.ends_at||(used?.n??0)>=experiment.max_calls){await stopExperiment(env,Date.now()>=experiment.ends_at?'prazo_encerrado':'orcamento_encerrado');return {status:'experimento_encerrado'};}
  if(experiment.mode==='acelerado'&&!options.acceleratedMinutes)return {status:'aguardando_passo_controlado'};
 }
 if(options.acceleratedMinutes!==undefined){
  if(env.ENVIRONMENT_ID!=='homologation')throw new CognitiveError('relogio_controlado_nao_autorizado');
  await administer(env,async s=>{const delta=Math.max(0,Math.min(720,options.acceleratedMinutes!));const reconciled=reconcile({...s,updatedAt:s.updatedAt-delta/s.multiplier*60000},Date.now());Object.assign(s,reconciled.state);s.nextDecisionAt=Date.now();if(options.forcedModel)s.complexNext=options.forcedModel==='flash';return [entry(s,'ensaio_temporal','Avanço virtual controlado para homologação; não representa tempo real decorrido.',{virtualMinutes:delta,forcedModel:options.forcedModel??null},{origin:'homologacao'}),...reconciled.completed.map(activity=>entry(s,'atividade_concluida',`Atividade concluída: ${activity.kind}.`,{activity},{virtualAt:activity.until,origin:'simulacao_deterministica'}))];});
 }
 const started=Date.now();let result:{status:string;[key:string]:unknown};
 try{result=await tick(env);}catch(e){result={status:'falha_motor',code:safeError(e)};}
 const after=await store.state();const afterMeter=await env.DB.prepare('SELECT bytes FROM storage_meter WHERE id=1').first<{bytes:number}>();
 if(before&&after&&after.decisions!==before.decisions||result.status==='suspenso'||result.status==='falha_motor')await inputEnv.DB.prepare('INSERT INTO cycle_metrics(id,started_at,completed_at,decision_before,decision_after,status,logical_bytes_before,logical_bytes_after,rows_read,rows_written,db_size,shared_reads,shared_writes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),started,Date.now(),before?.decisions??0,after?.decisions??0,result.status,meter?.bytes??0,afterMeter?.bytes??0,measured.local.reads,measured.local.writes,measured.local.size,measured.shared.reads,measured.shared.writes).run();
 return {...result,wallMs:Date.now()-started};
}
export async function scheduledRun(env:Env,scheduledAt:number){let status='';try{status=(await runCycle(env)).status;}catch(e){status=safeError(e);}await env.DB.prepare('INSERT INTO heartbeats(id,scheduled_at,completed_at,status,count) VALUES(1,?,?,?,1) ON CONFLICT(id) DO UPDATE SET scheduled_at=excluded.scheduled_at,completed_at=excluded.completed_at,status=excluded.status,count=count+1').bind(scheduledAt,Date.now(),status).run();}
export async function birthPreflight(env:Env){
 const store=new Store(env.DB);if(env.BIRTH_ENABLED!=='true')throw new CognitiveError('aguardando_liberacao_da_homologacao');
 const current=await store.state();if(current)return {alreadyBorn:true,state:current};if((await store.recent(1)).length)throw new CognitiveError('banco_nao_vazio');
 await new GeminiProvider(env,store).available();const budgetStore=new Store(env.BUDGET_DB??env.DB);const day=quotaDay(Date.now());const usage=(await budgetStore.usage()) as {day:string;model:string;calls:number}[];
 if(usage.some(u=>u.day===day&&u.model===env.MODEL_LITE&&u.calls>=Math.min(440,Number(env.LITE_GLOBAL_LIMIT??440))))throw new CognitiveError('orcamento_global_suspenso');
 const challenge=crypto.randomUUID();await env.DB.prepare('INSERT INTO birth_challenges(id,expires) VALUES(?,?)').bind(challenge,Date.now()+300000).run();return {alreadyBorn:false,challenge,expiresAt:Date.now()+300000,checks:{databaseEmpty:true,modelsAvailable:true,freeConfirmed:env.FREE_TIER_CONFIRMED==='true',quotaReserved:false},confirmation:'QUERO INICIAR ESTA EXISTENCIA'};
}
export async function confirmedBirth(env:Env,challenge:string,confirmation:string){if(confirmation!=='QUERO INICIAR ESTA EXISTENCIA')throw new CognitiveError('confirmacao_de_nascimento_necessaria');const accepted=await env.DB.prepare('UPDATE birth_challenges SET consumed=1 WHERE id=? AND consumed=0 AND expires>? RETURNING id').bind(challenge,Date.now()).first();if(!accepted)throw new CognitiveError('confirmacao_expirada_ou_utilizada');return birth(env);}
export async function diagnoseGemini(env:Env,model:'lite'|'flash'){
 if(env.ENVIRONMENT_ID!=='homologation')throw new CognitiveError('diagnostico_somente_homologacao');
 const started=Date.now();const {decision}=await new GeminiProvider(env,new Store(env.DB)).decide({facts:{technicalContractTest:true,notPermanentExistence:true,simulation:true,species:'coelho'},identity:{name:null,traits:{}},needs:{energia:80,fome:10,sede:10,sono:10},activity:{kind:'observar',intention:'Teste técnico isolado, sem aplicação de ações.'},memories:[],projects:[],interests:[],inbox:[]},model==='flash',Date.now());
 const result={checkedAt:Date.now(),model:model==='flash'?env.MODEL_FLASH:env.MODEL_LITE,wallMs:Date.now()-started,valid:true,actionsProposed:decision.actions.map(a=>a.type),actionsExecuted:0,induced:true};await env.DB.prepare('INSERT INTO operations(key,data,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').bind('diagnostic:'+model,JSON.stringify(result),Date.now()).run();return result;
}
