import {z} from 'zod';
import {birth,administer,tick} from './engine';
import {GeminiProvider,type Env} from './provider';
import {Store,entry} from './store';
import{reconcile}from'../shared/domain';
const scenarios={
 research:'Teste induzido de pesquisa: consulte Wikipedia sobre água com a ferramenta pesquisar. Não afirme ter pesquisado antes do resultado. Outras ações são opcionais.',
 create:'Teste induzido: PRIMEIRA ação projeto com id ensaio, steps [Produzir uma obra], completed [], status ativo, horizon curto e evidence [nascimento], uma referência real resolvida pelo motor. Não marque a etapa concluída: o resultado ainda será produzido. SEGUNDA ação criar um poema curto id texto-ensaio associado ao projeto ensaio. TERCEIRA ação criar pintura id pixels-ensaio associada ao projeto ensaio. Essas obras testam o contrato, não definem preferências pessoais.',
 music_object:'Teste induzido: produza uma composição musical id musica-ensaio com pelo menos 8 notas e um objeto virtual id objeto-ensaio. Use os formatos musica e objeto reais do contrato.',
 read:'Teste induzido: leia a obra texto-ensaio com ler_obra antes de continuar sua revisão. Não declare revisão sem produzir nova versão.',
 revise:'Teste induzido: a obra texto-ensaio está em workingResults após leitura. Crie uma segunda versão desse mesmo id texto-ensaio, preservando uma imagem do texto anterior e acrescentando uma estrofe. Mantenha projectId ensaio.',
 habitat:'Teste induzido: mova a planta existente para x10,y2 se acessível e exponha pixels-ensaio no atelie. Não solicite serviços externos.',
 complete:'Teste induzido: atualize o projeto ensaio com steps [Produzir uma obra], completed [0] e status concluido, citando a evidência da obra texto-ensaio que já foi produzida. Se faltarem resultados, não declare conclusão.',
 memory_message:'Teste induzido: registre uma memória autobiográfica sobre uma atividade efetivamente executada neste ensaio, citando evidência existente, e deixe uma mensagem ao observador identificando que está em teste. Não invente fontes nem experiências.'
} as const;
export const toolTestSchema=z.object({scenario:z.enum(Object.keys(scenarios) as [keyof typeof scenarios,...(keyof typeof scenarios)[]]),model:z.enum(['lite','flash']).default('lite')}).strict();
export async function runToolTest(env:Env,input:unknown){
 if(env.ENVIRONMENT_ID!=='homologation'||!env.TOOL_DB)throw new Error('ensaio_de_ferramentas_nao_autorizado');const {scenario,model}=toolTestSchema.parse(input);const isolated={...env,DB:env.TOOL_DB,ENVIRONMENT_ID:'tool-tests',BIRTH_ENABLED:'true'};
 const store=new Store(isolated.DB);if(!await store.state())await birth(isolated);
 const before=await store.state();if(before!.failures&&before!.nextDecisionAt>Date.now())return {status:'backoff',nextAttempt:before!.nextDecisionAt,induced:true};
 await administer(isolated,async s=>{const passage=reconcile({...s,updatedAt:s.updatedAt-600000},Date.now());Object.assign(s,passage.state);s.nextDecisionAt=Date.now();s.complexNext=model==='flash';return [entry(s,'ensaio_ferramenta','Cenário induzido de homologação com avanço de 60 minutos virtuais; separado da criatura autônoma.',{scenario,model,induced:true,controlledVirtualMinutes:60},{origin:'homologacao_induzida'})];});
 const provider=new GeminiProvider(isolated,store,fetch,'Este é um cenário técnico INDUZIDO e separado da existência autônoma/permanente. Registre apenas resultados de ferramentas. '+scenarios[scenario]);
 // Force only the technical model selection. The content still comes from a real Gemini response.
 const result=await tick(isolated,Date.now(),{decide(context,_complex,now){return provider.decide(context,model==='flash',now);}});
 const after=await store.state();return {scenario,induced:true,result,beforeDecisions:before?.decisions,afterDecisions:after?.decisions,recent:await store.recent(16)};
}
