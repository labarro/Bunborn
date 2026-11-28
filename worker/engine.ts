import { lookAt } from '../shared/art';
import { catalogue, catalogueEntry, footprint, kindOf, migrateObjects, roomAt, rooms as houseRooms } from '../shared/house';
import { closest, mmr, normalize } from '../shared/similarity';
import { bedLight } from '../shared/house';
import { diffArtifact, editSection, sectionsOf } from '../shared/creative';
import { activeAt, eventsBetween, perceives } from '../shared/events';
import { conditionLabel, feltTemperature, growth, outsideView, periodLabel, periodOf, seasonLabel, seasonOf, species, stageLabel, weatherAt } from '../shared/world';
import {
  artifactSchema,
  creatableArtifactSchema,
  approach,
  pathfind,
  born,
  clamp,
  reconcile,
  physiology,
  bodySnapshot,
  feel,
  feelings,
  feltChange,
  validLayout,
  type Action,
  type RecordEntry,
  type State,
  quotaDay,
} from '../shared/domain';
import { CognitiveError, GeminiProvider, type CognitionProvider, type Env } from './provider';
import { RoutedProvider, type RouteRecord } from './ai/cognition';
import { categorize, creativeSignals, PAINTER } from './ai/router';
import type { Category } from '../shared/ai-catalog';
import { research } from './research';
import { entry, Store, ToolError } from './store';
const targetFor: Record<string, string> = {
  comer: 'comida',
  beber: 'comida',
  dormir: 'cama',
  higiene: 'higiene',
  descansar: 'descanso',
  observar: 'descanso',
  organizar: 'bau',
  pesquisar: 'terminal',
  criar: 'atelie',
  diario: 'diario',
};
const entityId=(kind:string,id:string)=>id.startsWith(kind+':')?id:kind+':'+id;
// The model may cite an entity by entityId, by its short id or by a concrete record UUID shown
// in context. All three resolve to the same entity of the expected kind (never another kind).
async function existingEntity(store:Store,kind:string,ref:string){for(const candidate of [ref,entityId(kind,ref)]){const found=await store.entity(candidate);if(found?.kind===kind)return found;}return null;}
export async function birth(env: Env, now = Date.now()) {
  if(env.BIRTH_ENABLED==='false')throw new CognitiveError('nascimento_bloqueado');
  const store = new Store(env.DB);
  const token = await store.acquire(now);
  if (!token) throw new CognitiveError('motor_ocupado', 60000);
  try {
    const existing = await store.state();
    if (existing) return existing;
    if((await store.recent(1)).length)throw new CognitiveError('banco_nao_vazio');
    await new GeminiProvider(env, store).available();
    const s = born(now);
    await store.commit(
      token,
      s,
      [
        entry(
          s,
          'nascimento',
          env.ENVIRONMENT_ID==='homologation'?'Nascimento da criatura descartável de homologação.':'Nascimento único da existência principal.',
          { natureza: 'Simulação computacional; nenhuma consciência real é afirmada.',environment:env.ENVIRONMENT_ID??'development',permanent:env.ENVIRONMENT_ID==='production' },
          { importance: 1 },
        ),
        entry(
          s,
          'memoria',
          'O ambiente possui recursos renováveis, terminal de leitura e ferramentas limitadas. Sou uma criatura simulada e imortal.',
          { status: 'fato_do_ambiente' },
          { category: 'semantica', importance: 1 },
        ),
      ],
      [],
      true,
    );
    return s;
  } finally {
    await store.release(token);
  }
}
// Passive voluntary activities give way to a concrete tool use (searching, writing, creating,
// moving furniture); the replacement is recorded as an interruption, never hidden.
const passive = ['observar', 'descansar', 'organizar', 'diario'];
function activate(s: State, kind: string, minutes = 30,allowQueue=false, chosen?: string) {
  const target = chosen ?? targetFor[kind] ?? 'mesa';
  const object = s.objects.find((o) => o.id === target);
  if (!object) throw new Error('objeto_indisponivel');
  const route = approach(s.position, object, s.objects);
  if (!route.length) throw new Error('objeto_inacessivel');
  if(s.activity.until>s.virtualMinutes){
    if(s.activity.kind===kind&&s.activity.target===target)return 'continuada';
    if(passive.includes(s.activity.kind)&&!s.activity.involuntary&&!s.queue?.length){s.position=route[route.length-1];s.activity={kind,until:s.virtualMinutes+minutes,target,intention:s.activity.intention,startNeeds:bodySnapshot(s.needs,s.motives)};return 'substituida';}
    if(!allowQueue)throw new ToolError('atividade_em_andamento',{current:s.activity.kind,currentStation:s.activity.target,requiredStation:target,remainingVirtualMinutes:Math.round(s.activity.until-s.virtualMinutes),queued:(s.queue??[]).map(q=>q.kind),options:'aguardar o término, ou usar interromper antes'});
    s.queue??=[];if(s.queue.some(a=>a.kind===kind&&a.target===target))return 'ja_agendada';if(s.queue.length>=4)throw new Error('fila_de_atividades_cheia');const tail=s.queue[s.queue.length-1]??s.activity;s.queue.push({kind,until:tail.until+minutes,target,intention:s.activity.intention});return 'agendada';
  }
  s.position = route[route.length - 1];
  s.activity = { kind, until: s.virtualMinutes + minutes, target, intention: s.activity.intention, startNeeds: bodySnapshot(s.needs, s.motives) };
  return 'iniciada';
}
async function applyAction(
  s: State,
  a: Action,
  store: Store,
  out: RecordEntry[],
  now: number,
  fetcher: typeof fetch,
) {
  const record = (
    kind: string,
    content: string,
    data: Record<string, unknown> = {},
    opts: Partial<RecordEntry> = {},
  ) => {
    const r = entry(s, kind, content, data, { origin: 'criatura', ...opts });
    out.push(r);
    return r;
  };
  // Body limits (physiology, not preference): an exhausted or starving body cannot do
  // demanding work, and involuntary sleep cannot be cut short while still exhausted.
  const n = s.needs;
  // Searching and remembering stay available in any bodily state: when unsure, the creature can look it up.
  if (['criar', 'projeto', 'relacionar', 'mover', 'organizar', 'jardim', 'decorar', 'guardar'].includes(a.type === 'atividade' ? a.activity : a.type) && (n.energia <= 15 || n.sono >= 95 || n.fome >= 95 || n.sede >= 95))
    throw new ToolError('corpo_sem_condicoes', { sente: feelings(s).body, note: 'o corpo está sem condições para isso agora' });
  if (a.type === 'interromper' && s.activity.involuntary && s.activity.until > s.virtualMinutes && n.sono > 60)
    throw new ToolError('sono_involuntario', { sente: feel('sono', n.sono), remainingVirtualMinutes: Math.round(s.activity.until - s.virtualMinutes), note: 'o corpo ainda não consegue acordar' });
  const start = (kind: string, minutes: number, chosen?: string) => {
    const previous = s.activity;
    if (activate(s, kind, minutes, false, chosen) === 'substituida') record('atividade_interrompida', `Deixou de ${previous.kind} para ${kind}.`, { activity: previous, replacedBy: kind, automatic: true });
  };
  let evidenceRecords:RecordEntry[]=[];
  if('evidence' in a){evidenceRecords=await store.resolveEvidence(a.evidence);a.evidence=evidenceRecords.map(r=>r.id);}
  switch (a.type) {
    case 'interromper':{record('atividade_interrompida',a.reason,{activity:s.activity,queue:s.queue??[]});s.queue=[];s.activity={kind:'observar',until:s.virtualMinutes,target:'descanso',intention:s.activity.intention};break;}
    case 'ler_obra': {
      const work = await existingEntity(store, 'artefato', a.id);
      if (work?.kind !== 'artefato') throw new Error('obra_inexistente');
      record(
        'leitura',
        `Leitura da própria obra: ${work.content}.`,
        // What she sees comes first: a raw pixel grid is thousands of zeros, not a picture.
        { seen: (() => { const art = artifactSchema.safeParse(work.data.artifact); return art.success ? lookAt(art.data) : null; })(), artifact: work.data.artifact, version: work.data.version, sourceId: work.id },
        { associations: [work.id] },
      );
      break;
    }
    case 'recordar': {
      const recovered = await store.memories(a.query, now, 6);
      await store.markRetrieval(
        recovered.map((r) => r.id),
        now,
      );
      record(
        'leitura',
        `Recuperação dirigida: ${a.query}.`,
        {
          memories: recovered.map((r) => ({
            id: r.id,
            content: r.content.slice(0, 1200),
            status: r.data.status,
            confidence: r.confidence,
          })),
        },
        { associations: recovered.map((r) => r.id) },
      );
      break;
    }
    case 'atividade':{
      if (a.activity === 'dormir' && s.needs.sono < physiology.minSonoToSleep)
        throw new ToolError('sem_sono', { sente: feel('sono', s.needs.sono), note: 'o corpo não consegue adormecer sem sono' });
      const need = { comer: ['fome', 'sem_fome', 'não está com fome'], beber: ['sede', 'sem_sede', 'não está com sede'] } as const;
      const rule = need[a.activity as keyof typeof need];
      if (rule && s.needs[rule[0]] < physiology.needToStart[a.activity as 'comer' | 'beber'])
        throw new ToolError(rule[1], { sente: feel(rule[0], s.needs[rule[0]]), note: 'o corpo ' + rule[2] });
      if (a.activity === 'higiene' && s.needs.higiene > physiology.needToStart.higiene)
        throw new ToolError('ja_limpa', { sente: feel('higiene', s.needs.higiene), note: 'já está limpa' });
      const place = a.objectId ? placeFor(s, a.activity, a.objectId) : undefined;
      if (a.activity === 'observar') {
        // Looking again at a room she already knows, unchanged, shows nothing new: the body refuses and says why.
        // The room only changes when furniture moves or a work is exposed (habitat records).
        // An observation counts once it started: "observar + diario" replaced it before it ended, so no
        // perception was recorded and she observed 10 times in 14 cycles (homologation 25/11).
        const perceived = (await store.latest('percepcao', 60)).find((r) => r.data.activity === 'observar');
        const started = (await store.latest('atividade', 60)).find((r) => (r.data.activity as { kind?: string } | undefined)?.kind === 'observar' && ['iniciada', 'substituida'].includes(String(r.data.status)));
        const last = [perceived, started].filter((r): r is RecordEntry => !!r).sort((a, b) => b.realAt - a.realAt)[0];
        const changed = (await store.latest('habitat', 1))[0];
        // Both perceptions and started observations carry the signature of the house + the world outside.
        if (last && (last.data.room ? last.data.room === roomSignature(s) : !changed || changed.realAt <= last.realAt))
          throw new ToolError('nada_novo_para_observar', { lastObserved: new Date(last.realAt).toISOString(), note: 'você já observou e nada mudou desde então (nem a casa, nem o tempo lá fora)' });
      }
      const previous = s.activity;
      const status=activate(s, a.activity, a.minutes,true,place);
      if (status === 'substituida') record('atividade_interrompida', `Deixou de ${previous.kind} para ${a.activity}.`, { activity: previous, replacedBy: a.activity, automatic: true });
      record('atividade', `Atividade ${status}: ${a.activity}.`, { activity:s.queue?.find(item=>item.kind===a.activity)??s.activity,status, ...(a.activity === 'observar' ? { room: roomSignature(s) } : {}) });
      break;
    }
    case 'pesquisar': {
      start('pesquisar', 30);
      const cached = (await store.latest('pesquisa', 40)).find(
        (r) => r.data.query === a.query && r.data.source === a.source && now - r.realAt < 86400000,
      );
      const results = cached
        ? (cached.data.results as Awaited<ReturnType<typeof research>>)
        : await research(a.source, a.query, now, fetcher);
      const r = record(
        'pesquisa',
        `Consulta ${cached ? 'ao cache' : 'externa'}: ${a.query}. ${results.length} resultado(s).`,
        { query: a.query, source: a.source, results, cached: !!cached, originalId: cached?.id },
      );
      record(
        'memoria',
        results
          .map((x) => `${x.title}: ${x.excerpt}`)
          .join('\n')
          .slice(0, 6000) || 'A pesquisa não encontrou resultados.',
        { sources: results, status: 'fonte_consultada', query: a.query },
        { category: 'semantica', importance: 0.65, confidence: 0.7, associations: [r.id, a.query] },
      );
      // A search query is not a concept (Neural Atlas, 28/11): the query and what came back stay as
      // pesquisa + memória with sources; concepts are declared by her with the conceito action.
      s.motives.tedio = clamp(s.motives.tedio - 10);
      s.motives.curiosidade = clamp(s.motives.curiosidade + 4);
      s.motives.criatividade = clamp(s.motives.criatividade + 2);
      s.motives.satisfacao = clamp(s.motives.satisfacao + 3);
      break;
    }
    case 'diario': {
      // The diary keeps what is new to her: an entry that repeats a recent one is refused (she reads why next cycle).
      const repeated = repeatedDiary(a.content, await store.latest('diario', 6));
      if (repeated)
        throw new ToolError('diario_repetido', { similarTo: repeated.content.slice(0, 200), writtenAt: new Date(repeated.realAt).toISOString(), note: 'você já escreveu quase o mesmo no diário' });
      start('diario', 20);
      record('diario', a.content, { echo: diaryEcho(a.content, await store.latest('diario', 12)) });
      s.motives.tedio = clamp(s.motives.tedio - 5);
      s.motives.criatividade = clamp(s.motives.criatividade + 3);
      break;
    }
    case 'relacionar': {
      const [from, to] = await Promise.all([store.entity(a.from), store.entity(a.to)]);
      if (from?.kind !== 'conceito' || to?.kind !== 'conceito' || from.id === to.id)
        throw new Error('conceitos_invalidos');
      if (
        a.status === 'fonte_consultada' &&
        !a.evidence.some((id) => from.associations.includes(id) || to.associations.includes(id))
      )
        throw new Error('relacao_sem_fonte');
      record(
        'relacao',
        a.relation,
        { from: a.from, to: a.to, status: a.status, evidence: a.evidence },
        {
          entityId: `relacao:${a.from}:${a.to}:${a.relation}`,
          category: 'semantica',
          confidence: a.status === 'hipotese' ? 0.4 : 0.65,
          associations: [...a.evidence,from.id,to.id],
        },
      );
      break;
    }
    case 'mensagem':
      record('conversa', a.content, { role: 'criatura' });
      s.motives.interacao = clamp(s.motives.interacao - 10);
      break;
    case 'memoria': {
      if(a.status==='fato_do_ambiente'&&!evidenceRecords.some(r=>r.data.status==='fato_do_ambiente'||r.kind==='nascimento'))throw new Error('fato_do_ambiente_sem_origem');
      if (a.status === 'fonte_consultada') {
        if (!evidenceRecords.some((r) => r.kind === 'pesquisa')) throw new Error('fonte_nao_consultada');
      }
      record(
        'memoria',
        a.content,
        { status: a.status, evidence: a.evidence },
        {
          category: a.category,
          confidence: a.confidence,
          importance: a.category === 'autobiografica' ? 0.9 : 0.6,
          associations: a.evidence,
        },
      );
      if (a.category === 'autobiografica') s.lastConsolidation = s.virtualMinutes;
      break;
    }
    case 'identidade': {
      if (a.field === 'nome' && s.identity.name && s.identity.name !== a.value)
        throw new Error('nome_permanente');
      if (s.identity.traits[a.field]?.value === a.value)
        throw new ToolError('ja_registrado', { field: a.field, value: a.value, since: 'identidade versão ' + s.identity.traits[a.field].version, note: 'este valor já faz parte da sua identidade; não é preciso registrar de novo' });
      if (a.field === 'aparencia' && !/^#[0-9a-fA-F]{6}$/.test(a.value))
        throw new Error('aparencia_invalida');
      const previous = s.identity.traits[a.field];
      const versions = await store.latest('identidade', 20);
      if (versions.some((v) => v.data.field === a.field && now - v.realAt < 3600000))
        throw new Error('mudanca_identidade_muito_rapida');
      if (previous && !a.evidence.some((id) => !previous.evidence.includes(id)))
        throw new ToolError('nova_evidencia_necessaria', { field: a.field, current: previous.value, alreadyCited: previous.evidence, note: 'para mudar este traço, cite ao menos um registro novo que motive a mudança' });
      s.identity.version++;
      s.identity.traits[a.field] = {
        value: a.value,
        evidence: a.evidence,
        version: s.identity.version,
      };
      if (a.field === 'nome') s.identity.name = a.value;
      if (a.field === 'autodescricao') s.identity.description = a.value;
      record(
        'identidade',
        a.value,
        {
          field: a.field,
          evidence: a.evidence,
          previous: previous ?? null,
          version: s.identity.version,
          classification: 'declarada',
        },
        {
          entityId: 'identidade:' + a.field,
          category: 'identidade',
          importance: 1,
          associations: a.evidence,
        },
      );
      break;
    }
    case 'interesse': {
      const prior = await existingEntity(store, 'interesse', a.id);
      const interestId = prior?.entityId ?? entityId('interesse', a.id);
      if (
        prior &&
        !a.evidence.some((id) => !((prior.data.evidence ?? []) as string[]).includes(id))
      )
        throw new Error('nova_evidencia_necessaria');
      const strength = clamp(
        Number(prior?.data.strength ?? 0) *
          Math.exp(
            -Math.max(0, s.virtualMinutes - (prior?.virtualAt ?? s.virtualMinutes)) / 43200,
          ) +
          a.change,
        0,
        1,
      );
      record(
        'interesse',
        a.topic,
        {
          topic: a.topic,
          strength,
          status: a.status,
          evidence: a.evidence,
          originId: prior?.data.originId ?? a.evidence[0],
        },
        { entityId: interestId, associations: a.evidence },
      );
      break;
    }
    case 'projeto': {
      const prior = await existingEntity(store, 'projeto', a.id);
      const projectId = prior?.entityId ?? entityId('projeto', a.id);
      const artifacts = await store.latest('artefato');
      const produced = artifacts.filter((r) => entityId('projeto',String(r.data.projectId??'')) === projectId);
      if (a.completed.some((i) => i >= a.steps.length)) throw new Error('etapa_invalida');
      const oldCompleted = (prior?.data.completed ?? []) as number[];
      const workKinds = ['artefato', 'diario', 'memoria', 'pesquisa', 'leitura', 'conceito', 'relacao', 'habitat', 'atividade_concluida'];
      const priorEvidence = (prior?.data.evidence ?? []) as string[];
      if (
        a.completed.some((i) => !oldCompleted.includes(i)) &&
        !evidenceRecords.some((r) => workKinds.includes(r.kind) && !priorEvidence.includes(r.id) && (!prior || r.realAt >= prior.realAt))
      )
        throw new ToolError('etapa_sem_evidencia', { newlyCompleted: a.completed.filter((i) => !oldCompleted.includes(i)).map((i) => a.steps[i]), accepted: workKinds, note: 'cite em evidence um registro do seu trabalho feito depois da última versão do projeto (diário, memória, pesquisa, obra, atividade concluída...)' });
      if (
        a.status === 'concluido' &&
        (new Set(a.completed).size !== a.steps.length || !produced.length)
      )
        throw new Error('conclusao_sem_resultado');
      record(
        'projeto',
        a.title,
        { ...a, version: Number(prior?.data.version ?? 0) + 1 },
        { entityId: projectId, category: 'prospectiva', associations: a.evidence },
      );
      break;
    }
    case 'criar': {
      const project = a.projectId ? await existingEntity(store, 'projeto', a.projectId) : null;
      if (a.projectId && !project) throw new Error('projeto_inexistente');
      const art = a.artifact;
      // Providers are parsed upstream; this also guards fixtures and the retired pixel grid.
      if (!creatableArtifactSchema.safeParse(art).success) throw new Error('formato_indisponivel');
      const prior = await existingEntity(store, 'artefato', a.id);
      const change = diffArtifact(prior?.data.artifact as never, a.artifact as never);
      if (change.identical) throw new ToolError('revisao_sem_alteracao', { id: prior?.entityId, note: 'a nova versão é idêntica à anterior; nada foi salvo' });
      start('criar', 40);
      record(
        'artefato',
        a.title,
        {
          artifact: a.artifact,
          revision: { fromVersion: Number(prior?.data.version ?? 0), change: change.summary, details: change.details, purpose: a.motivation },
          seen: lookAt(a.artifact),
          motivation: a.motivation,
          projectId: project?.entityId ?? null,
          version: Number(prior?.data.version ?? 0) + 1,
          author: s.id,
        },
        { entityId: prior?.entityId ?? entityId('artefato', a.id), importance: 0.8 },
      );
      s.motives.satisfacao = clamp(s.motives.satisfacao + 6);
      s.motives.criatividade = clamp(s.motives.criatividade + 8);
      s.motives.tedio = clamp(s.motives.tedio - 12);
      break;
    }
    case 'mover': {
      const objects = structuredClone(s.objects);
      const stored = (s.house?.inventory ?? []).find((o) => o.id === a.objectId);
      if (stored) objects.push(structuredClone(stored));
      const object = objects.find((o) => o.id === a.objectId);
      if (!object) throw new ToolError('objeto_inexistente', { objectId: a.objectId, note: 'mover reposiciona objetos da casa (ids em situation.objects e otherRooms); você mesma vai até um lugar pelas atividades, e descansar ou observar aceitam objectId' });
      object.x = a.x;
      object.y = a.y;
      if (!validLayout(objects, s.position)) throw new ToolError('posicao_bloqueia_acesso', { note: 'nessa posição algo ficaria bloqueado, atravessaria uma parede ou uma porta, ou ficaria fora do cômodo certo' });
      s.objects = objects;
      if (stored && s.house) s.house.inventory = (s.house.inventory ?? []).filter((o) => o.id !== stored.id);
      record('habitat', `Reposicionou ${object.label}.`, { object });
      start('organizar', 20);
      break;
    }
    case 'expor': {
      const artifact = await existingEntity(store, 'artefato', a.artifactId);
      const object = s.objects.find((o) => o.id === a.objectId);
      if (!artifact || !object) throw new Error('exposicao_invalida');
      object.artifactId = artifact.entityId;
      record('habitat', `Expôs ${artifact.content} em ${object.label}.`, {
        artifactId: artifact.entityId,
        objectId: object.id,
      });
      break;
    }
    case 'recurso': {
      const item = a.catalogId ? catalogueEntry(a.catalogId) : null;
      if (a.catalogId && !item) throw new ToolError('catalogo_inexistente', { catalogId: a.catalogId, note: 'esse item não existe no catálogo (use catalogo para ver o que existe)' });
      record(
        'recurso',
        a.title,
        { reason: a.reason, status: 'pendente', ...(item ? { catalogId: item.id, kind: item.kind } : {}) },
        { entityId: 'recurso:' + a.id, category: 'prospectiva' },
      );
      break;
    }
    case 'conceito': {
      const prior = await existingEntity(store, 'conceito', a.id);
      record('conceito', a.nome, { nome: a.nome, descricao: a.descricao, aliases: a.aliases, evidence: a.evidence, version: Number(prior?.data.version ?? 0) + 1 }, { entityId: prior?.entityId ?? entityId('conceito', a.id), category: 'semantica', associations: a.evidence, importance: 0.6, confidence: 0.7 });
      break;
    }
    case 'obra_secao': {
      const work = await existingEntity(store, 'artefato', a.id);
      const art = work?.data.artifact as { format?: string; content?: string } | undefined;
      if (!work || art?.format !== 'texto') throw new ToolError('obra_inexistente', { id: a.id, note: 'só obras de texto existentes têm seções; crie a obra primeiro com criar (formato texto)' });
      const content = editSection(String(art.content ?? ''), a.secao, a.conteudo, a.modo);
      if (content.length > 12000) throw new ToolError('obra_grande_demais', { note: 'a obra passaria de 12000 caracteres; comece outra obra (por exemplo, um segundo volume)' });
      const next = { format: 'texto' as const, content };
      const change = diffArtifact(art as never, next);
      if (change.identical) throw new ToolError('revisao_sem_alteracao', { id: work.entityId, note: 'a seção ficou igual; nada foi salvo' });
      start('criar', 30);
      record('artefato', work.content, { artifact: next, revision: { fromVersion: Number(work.data.version ?? 1), change: change.summary, section: a.secao, mode: a.modo }, motivation: work.data.motivation, projectId: work.data.projectId ?? null, version: Number(work.data.version ?? 1) + 1, author: s.id, sections: sectionsOf(content) }, { entityId: work.entityId, importance: 0.8 });
      s.motives.criatividade = clamp(s.motives.criatividade + 6);
      s.motives.tedio = clamp(s.motives.tedio - 10);
      break;
    }
    case 'habilidade': {
      // Declared by her, with evidence that exists. The system never assigns levels.
      const prior = await existingEntity(store, 'habilidade', a.id);
      if (prior && !a.evidence.some((id) => !((prior.data.evidence ?? []) as string[]).includes(id))) throw new ToolError('nova_evidencia_necessaria', { note: 'para atualizar uma habilidade, cite ao menos uma evidência nova' });
      record('habilidade', a.nome, { nome: a.nome, descricao: a.descricao, tecnicas: a.tecnicas, limitacoes: a.limitacoes, evidence: [...new Set([...((prior?.data.evidence ?? []) as string[]), ...a.evidence])].slice(-24), declaredBy: 'criatura', version: Number(prior?.data.version ?? 0) + 1 }, { entityId: prior?.entityId ?? entityId('habilidade', a.id), category: 'procedimental', associations: a.evidence, importance: 0.7 });
      break;
    }
    case 'procedimento': {
      const prior = await existingEntity(store, 'procedimento', a.id);
      record('procedimento', a.titulo, { titulo: a.titulo, contexto: a.contexto, passos: a.passos, evidence: a.evidence, version: Number(prior?.data.version ?? 0) + 1 }, { entityId: prior?.entityId ?? entityId('procedimento', a.id), category: 'procedimental', associations: a.evidence, importance: 0.65 });
      break;
    }
    case 'experimento': {
      const prior = await existingEntity(store, 'experimento', a.id);
      const id = prior?.entityId ?? entityId('experimento', a.id);
      const data = (prior?.data ?? {}) as { pergunta?: string; hipotese?: string; variavel?: string; grupos?: { canteiro: string; condicao: string }[]; medicoes?: unknown[]; status?: string };
      if (a.acao === 'iniciar') {
        if (prior && prior.data.status === 'ativo') throw new ToolError('experimento_ativo', { id, note: 'esse experimento já está em andamento; use medir ou concluir' });
        if (!a.pergunta || !a.hipotese || !a.grupos?.length) throw new ToolError('experimento_incompleto', { note: 'iniciar pede pergunta, hipotese e grupos (canteiros com a condição de cada um)' });
        for (const g of a.grupos) if (!s.objects.some((o) => o.id === g.canteiro && o.kind === 'canteiro')) throw new ToolError('canteiro_inexistente', { canteiro: g.canteiro, note: 'grupos usam canteiros existentes' });
        const medicao = measure(s, a.grupos);
        record('experimento', a.pergunta, { pergunta: a.pergunta, hipotese: a.hipotese, variavel: a.variavel, grupos: a.grupos, medicoes: [medicao], status: 'ativo', escopo: 'mundo virtual do Bunborn (regras da simulação)' }, { entityId: id, category: 'prospectiva', importance: 0.7 });
      } else {
        if (!prior) throw new ToolError('experimento_inexistente', { id: a.id, note: 'não há experimento com esse id' });
        if (data.status !== 'ativo') throw new ToolError('experimento_encerrado', { id, note: 'esse experimento já foi encerrado' });
        const medicoes = [...(data.medicoes ?? []), measure(s, data.grupos ?? [])].slice(-12);
        if (a.acao === 'concluir' && medicoes.length < 2) throw new ToolError('poucas_medicoes', { note: 'concluir pede ao menos uma medição depois do início' });
        if (a.acao === 'concluir' && !a.conclusao) throw new ToolError('sem_conclusao', { note: 'diga sua conclusão' });
        const status = a.acao === 'medir' ? 'ativo' : a.acao === 'concluir' ? 'concluido' : 'abandonado';
        record('experimento', prior.content, { ...data, medicoes, status, ...(a.conclusao ? { conclusao: a.conclusao } : {}), escopo: 'mundo virtual do Bunborn (regras da simulação)' }, { entityId: id, category: 'prospectiva', importance: status === 'concluido' ? 0.8 : 0.6 });
      }
      start('jardinar', 15, (a.grupos ?? data.grupos ?? [])[0]?.canteiro);
      break;
    }
    case 'ir': {
      const target = resolvePlace(s, a.destino);
      if (!target) throw new ToolError('destino_inexistente', { destino: a.destino, note: 'não há cômodo nem objeto com esse nome; cômodos: ' + houseRooms.map((r) => r.id).join(', ') });
      if (s.activity.until > s.virtualMinutes && !passive.includes(s.activity.kind)) throw new ToolError('atividade_em_andamento', { current: s.activity.kind, note: 'termine ou interrompa ' + s.activity.kind + ' antes de ir' });
      const path = target.object ? approach(s.position, target.object, s.objects) : pathfind(s.position, target.cell!, s.objects);
      if (!path.length) throw new ToolError('sem_caminho', { destino: a.destino, note: 'não há caminho livre até lá agora' });
      s.position = path[path.length - 1];
      s.activity = { kind: 'caminhar', until: s.virtualMinutes + Math.max(2, Math.round(path.length / 2)), target: target.object?.id ?? 'descanso', intention: s.activity.intention, startNeeds: bodySnapshot(s.needs, s.motives) };
      record('habitat', `Foi até ${target.label}.`, { walked: path.length - 1, to: target.object?.id ?? roomAt(s.position).id }, { origin: 'criatura' });
      break;
    }
    case 'decorar': {
      s.house ??= { version: 2 };
      if (a.room) {
        s.house.walls = { ...(s.house.walls ?? {}), [a.room]: a.color };
        record('habitat', `Pintou as paredes de ${houseRooms.find((r) => r.id === a.room)!.label} com ${a.color}.`, { room: a.room, color: a.color });
      } else if (a.objectId) {
        const o = s.objects.find((x) => x.id === a.objectId);
        if (!o) throw new ToolError('objeto_inexistente', { objectId: a.objectId, note: 'esse objeto não existe na casa' });
        if (!kindOf(o).recolor) throw new ToolError('sem_cor_mutavel', { objectId: o.id, note: o.label + ' não tem cor que possa mudar' });
        o.color = a.color;
        record('habitat', `Mudou a cor de ${o.label} para ${a.color}.`, { object: o });
      } else throw new ToolError('decorar_sem_alvo', { note: 'diga o objeto (objectId) ou o cômodo (room)' });
      start('organizar', 15);
      break;
    }
    case 'guardar': {
      const o = s.objects.find((x) => x.id === a.objectId);
      if (!o) throw new ToolError('objeto_inexistente', { objectId: a.objectId, note: 'esse objeto não existe na casa' });
      const info = kindOf(o);
      if (info.station || o.kind === 'janela') throw new ToolError('nao_guardavel', { objectId: o.id, note: o.label + ' faz parte da casa ou do corpo e não pode ser guardado' });
      s.objects = s.objects.filter((x) => x.id !== o.id);
      s.house ??= { version: 2 };
      s.house.inventory = [...(s.house.inventory ?? []), o].slice(-40);
      record('habitat', `Guardou ${o.label}.`, { object: o, stored: true });
      start('organizar', 15);
      break;
    }
    case 'jardim': {
      const bed = s.objects.find((x) => x.id === a.canteiro);
      if (!bed || bed.kind !== 'canteiro') throw new ToolError('canteiro_inexistente', { canteiro: a.canteiro, note: 'não há canteiro com esse id' });
      s.house ??= { version: 2 };
      const garden = { ...(s.house.garden ?? {}) };
      const plot = garden[bed.id];
      if (a.acao === 'plantar') {
        if (plot) throw new ToolError('canteiro_ocupado', { canteiro: bed.id, especie: plot.species, note: 'já há algo plantado aí' });
        if (!a.especie) throw new ToolError('sem_especie', { opcoes: Object.keys(species), note: 'diga qual espécie plantar' });
        garden[bed.id] = { species: a.especie, plantedAt: s.virtualMinutes, waterings: [s.virtualMinutes], rule: 2 };
        record('jardim', `Plantou ${species[a.especie].label} no ${bed.label}.`, { canteiro: bed.id, especie: a.especie, acao: 'plantar' });
      } else if (a.acao === 'regar') {
        if (!plot) throw new ToolError('canteiro_vazio', { canteiro: bed.id, note: 'não há nada plantado aí' });
        garden[bed.id] = { ...plot, waterings: [...plot.waterings, s.virtualMinutes].slice(-12) };
        record('jardim', `Regou o ${bed.label}.`, { canteiro: bed.id, especie: plot.species, acao: 'regar' });
      } else {
        if (!plot) throw new ToolError('canteiro_vazio', { canteiro: bed.id, note: 'não há nada plantado aí' });
        const g = growth(plot, s.virtualMinutes, bedLight(bed, s.objects));
        if (g.stage < 4) throw new ToolError('ainda_nao_pronta', { canteiro: bed.id, estagio: stageLabel[g.stage], note: 'a planta ainda não está pronta' });
        delete garden[bed.id];
        record('jardim', `Colheu ${species[plot.species].label} do ${bed.label}.`, { canteiro: bed.id, especie: plot.species, acao: 'colher' });
      }
      s.house.garden = garden;
      start('jardinar', 20, bed.id);
      break;
    }
    case 'catalogo': {
      const wanted = a.categoria?.toLocaleLowerCase('pt-BR');
      const items = catalogue.filter((c) => !wanted || c.category.includes(wanted)).map((c) => catalogueEntry(c.id)!).map((c) => ({ catalogId: c.id, nome: c.name, descricao: c.description, categoria: c.category, ocupa: c.footprint, oferece: c.offers, onde: c.rooms, restricoes: c.restrictions }));
      record('leitura', 'Catálogo de objetos que podem ser pedidos ao observador.', { catalogo: items, nota: 'pedidos usam a ação recurso com catalogId; o observador aprova ou recusa' });
      break;
    }
    case 'tocar': {
      const o = s.objects.find((x) => x.id === a.objectId);
      if (!o || !(kindOf(o).offers ?? []).includes('tocar')) throw new ToolError('sem_instrumento', { objectId: a.objectId, note: 'esse objeto não toca música' });
      const work = await existingEntity(store, 'artefato', a.artifactId);
      if (!work || (work.data.artifact as { format?: string })?.format !== 'musica') throw new ToolError('nao_e_musica', { artifactId: a.artifactId, note: 'só composições (formato musica) podem ser tocadas' });
      start('tocar', 20, o.id);
      record('musica', `Tocou ${work.content} em ${o.label}.`, { artifactId: work.entityId, objectId: o.id }, { associations: [work.id] });
      break;
    }
  }
}
export async function tick(
  env: Env,
  now = Date.now(),
  provider?: CognitionProvider,
  fetcher: typeof fetch = fetch,
) {
  const store = new Store(env.DB);
  const token = await store.acquire(now);
  if (!token) return { status: 'ocupado' };
  try {
    const original = await store.state();
    if (!original) return { status: 'aguardando_nascimento' };
    if (original.paused) return { status: 'pausado' };
    if (!(await store.capacity())) return { status: 'armazenamento_suspenso' };
    const { state: s, gap,completed,events } = reconcile(original, now);
    const records: RecordEntry[] = [];
    if (s.house?.version !== 2) records.push(migrateHouse(s));
    records.push(...perceiveWorld(original, s, await store.latest('ambiente', 30)));
    for (const event of events) records.push(bodyEvent(s, event));
    for(const activity of completed){records.push(entry(s,'atividade_concluida',`Atividade concluída: ${activity.kind}.`,{activity},{virtualAt:activity.until,origin:'simulacao_deterministica'}));const felt=perception(s,activity);if(felt)records.push(felt);}
    if (gap)
      records.push(
        entry(
          s,
          'interrupcao',
          'Intervalo sem execução: tempo reconciliado deterministicamente; nenhuma decisão retroativa foi inventada.',
          { realMinutes: (now - original.updatedAt) / 60000 },
        ),
      );
    // The chosen interval is the longest wait while busy, not forced idleness: when the current
    // activity and queue are over, the next decision comes as soon as pacing allows. Before this,
    // "nextMinutes: 60" (real) after "dormir 60" (virtual, 10 real min) left her still for 50 min.
    const idle = s.activity.until <= s.virtualMinutes && !s.queue?.length;
    if (idle && s.failures === 0 && s.nextDecisionAt > now) s.nextDecisionAt = Math.max(now, (s.lastDecisionAt ?? 0) + decisionFloor(env));
    if (s.nextDecisionAt > now) {
      await store.commit(token, s, records);
      return { status: 'tempo_atualizado' };
    }
    const { context, inbox, lastIntent, recent, projects, artifacts, complex, memories } = await buildContext(env, store, s, now);
    try {
      // Category steers model choice only; the decision is still ONE request with the same context.
      const lastRoute = lastIntent?.data.route as { selected?: string; category?: Category } | undefined;
      const signals = {
        inbox: inbox.length,
        complexNext: complex,
        decisionNumber: s.decisions,
        consolidationDue: s.virtualMinutes - s.lastConsolidation > 1440,
        recentResearch: recent.slice(0, 6).some((r) => r.kind === 'pesquisa' || r.kind === 'leitura'),
        creativity: s.motives.criatividade,
        boredom: s.motives.tedio,
        activeCreativeProject: projects.some((p) => p.data.status === 'ativo' && artifacts.some((a) => a.data.projectId === p.entityId)),
      };
      const { category, reason: categoryReason } = categorize(signals);
      const hint = { category, categoryReason, lastModel: lastRoute?.selected && lastRoute.category ? { key: lastRoute.selected, category: lastRoute.category } : null, hasMessages: inbox.length > 0, creativeRoom: creativeSignals(signals) };
      const brain = provider ?? new RoutedProvider(env, store, fetcher);
      const reply = (await brain.decide(packContext(context), complex, now, hint)) as Awaited<ReturnType<CognitionProvider['decide']>> & { route?: RouteRecord };
      const { decision, model, invalidActions = [], route } = reply;
      // Every painting of hers is made by the painter model (observer's decision, 26/11). When
      // another model decided to paint, the decision stays (what, why, when) and the painter paints
      // it with the same context. If the painter cannot answer now, that creation is refused with
      // the reason and she can try again later; no other model paints in its place.
      const painterId = PAINTER.slice(PAINTER.indexOf(':') + 1);
      const paintings: { title: string; attempt?: unknown; error?: string }[] = [];
      const unpainted = new Map<object, string>();
      const painter = brain as { paint?: RoutedProvider['paint'] };
      if (model !== painterId && painter.paint)
        for (const a of decision.actions) {
          if (a.type !== 'criar' || a.artifact.format !== 'pintura') continue;
          try {
            const ask = () => painter.paint!.call(brain, packContext(context), { title: a.title, motivation: a.motivation }, now);
            // One more try when the answer was malformed or cut (not on timeouts or limits): ~30%
            // of painter answers failed that way in the 26/11 tests.
            const t0 = Date.now();
            // Retry only a quick malformed answer, so a tick stays well inside its 5-minute lease.
            const done = await ask().catch((e: { kind?: string }) => { if (e?.kind === 'resposta_invalida' && Date.now() - t0 < 30000) return ask(); throw e; });
            a.artifact = done.artifact;
            paintings.push({ title: a.title, attempt: done.attempt });
          } catch (e) {
            const why = String((e as { detail?: string; message?: string })?.detail ?? (e as Error)?.message ?? e).slice(0, 160);
            unpainted.set(a, why);
            paintings.push({ title: a.title, error: why });
          }
        }
      s.lastModel = model;
      s.activity.intention = decision.intention;
      const outcomes: { action: string; result: 'feita' | 'recusada'; code?: string; detail?: unknown }[] = [];
      const label = (a: { type: string; activity?: string }) => a.type + (a.activity ? ':' + a.activity : '');
      const intent = entry(s, 'intencao', decision.intention, {
          summary: decision.summary,
          model,
          proposed: decision.actions.map((a) => a.type),
          nextMinutes:decision.nextMinutes,
          complexNext:decision.complexNext,
          proposals:decision.actions.map(a=>a.type==='criar'?{...a,artifact:{format:a.artifact.format}}:a),
          // Technical routing metadata (why this model), never the creature's own intention.
          ...(route ? { route } : {}),
          ...(paintings.length ? { paintings } : {}),
          outcomes,
        });
      records.push(intent);
      for (const bad of invalidActions) {
        // The reason travels with the result so she can understand it (it used to say only "acao_malformada").
        outcomes.push({ action: bad.type, result: 'recusada', code: 'acao_malformada', detail: { note: 'formato inválido: ' + bad.issues.map((i) => (i.path || 'type') + ' (' + i.message + ')').join('; ').slice(0, 240) } });
        records.push(entry(s, 'erro_ferramenta', 'Ação rejeitada ou indisponível.', { tool: bad.type, code: 'acao_malformada', detail: { issues: bad.issues, hint: 'Corrija os campos listados em issues conforme o contrato da ferramenta: ' + bad.issues.map((i) => (i.path || 'type') + ' (' + i.message + ')').join('; ').slice(0, 400) } }));
        s.motives.frustracao = clamp(s.motives.frustracao + 4);
      }
      // Apply each tool against a draft so rejected actions cannot partially mutate state.
      let external = 0;
      for (const a of decision.actions) {
        if (unpainted.has(a)) {
          const why = unpainted.get(a)!;
          outcomes.push({ action: label(a), result: 'recusada', code: 'pintura_indisponivel', detail: { note: 'não foi possível pintar agora (' + why + ')' } });
          records.push(entry(s, 'erro_ferramenta', 'Ação rejeitada ou indisponível.', { tool: 'criar', code: 'pintura_indisponivel', detail: { note: why } }));
          continue;
        }
        if (a.type === 'pesquisar' && external++ >= 1) {
          records.push(entry(s, 'erro_ferramenta', 'Máximo de uma pesquisa por ciclo.'));
          outcomes.push({ action: label(a), result: 'recusada', code: 'uma_pesquisa_por_ciclo' });
          continue;
        }
        const draft = structuredClone(s);
        const output: RecordEntry[] = [];
        try {
          await applyAction(draft, a, store.withPending(records), output, now, fetcher);
          Object.assign(s, draft);
          records.push(...output);
          const echo = a.type === 'diario' ? (output.find((r) => r.kind === 'diario')?.data.echo as { sameOpening: boolean; words: number; structure: number } | null) : null;
          const seen = a.type === 'criar' ? lookAt(a.artifact) : a.type === 'atividade' && a.activity === 'observar' ? observeNote(draft) : echo ? `registrada; parecida com uma entrada recente (${echo.sameOpening ? 'mesma abertura, ' : ''}${Math.round(echo.words * 100)}% das palavras)` : null;
          outcomes.push({ action: label(a), result: 'feita', ...(seen ? { detail: { note: seen } } : {}) });
        } catch (e) {
          outcomes.push({ action: label(a), result: 'recusada', code: safeError(e), ...(e instanceof ToolError ? { detail: e.detail } : {}) });
          records.push(
            entry(s, 'erro_ferramenta', 'Ação rejeitada ou indisponível.', {
              tool: a.type,
              code: safeError(e),
              ...(e instanceof ToolError ? { detail: e.detail } : {}),
            }),
          );
          s.motives.frustracao = clamp(s.motives.frustracao + 4);
        }
      }
      // Functional result, distinct from a structurally valid reply: how much of the decision happened.
      intent.data.execution = { proposed: outcomes.length, done: outcomes.filter((o) => o.result === 'feita').length, refused: outcomes.filter((o) => o.result === 'recusada').length };
      for (const message of inbox)
        records.push(
          entry(
            s,
            'conversa',
            message.content,
            { role: message.author === 'visitante' ? 'visitante' : 'observador', author: message.author ?? 'responsavel', messageId: message.id },
            { realAt: message.at, origin: message.author === 'visitante' ? 'visitante' : 'observador' },
          ),
        );
      const observation = entry(
        s,
        'memoria',
        `Intenção: ${decision.intention}. Resultado: ${
          records
            .filter((r) => !['intencao', 'memoria'].includes(r.kind))
            .map((r) => r.content)
            .join(' ')
            .slice(0, 1600) || 'Nenhuma ferramenta executada.'
        }`,
        { evidence: records.map((r) => r.id) },
        {
          category: 'episodica',
          origin: 'observacao',
          associations: records.slice(0, 8).map((r) => r.id),
        },
      );
      records.push(observation);
      // Observed tendency is evidence-based and explicitly distinct from declared personality.
      if (s.decisions % 12 === 11) {
        const observed = await store.latest('atividade', 24);
        if (observed.length) {
          const counts: Record<string, number> = {};
          for (const r of observed) {
            const k = String((r.data.activity as { kind?: string })?.kind ?? 'desconhecida');
            counts[k] = (counts[k] ?? 0) + 1;
          }
          records.push(
            entry(
              s,
              'comportamento',
              'Distribuição observada das últimas atividades registradas.',
              { classification: 'observada', counts, evidence: observed.map((r) => r.id) },
            ),
          );
        }
      }
      s.working = [observation.id, decision.intention];
      s.decisions++;
      s.failures = 0;
      s.complexNext = decision.complexNext;
      const floor=decisionFloor(env);
      s.nextDecisionAt = now + Math.max(floor, decision.nextMinutes * 60000);
      s.lastDecisionAt = now;
      // No per-cycle "Contexto de continuidade" or content-free "Associação afetiva" memories any more:
      // they were 85% of all memories and echoed the last cycle back as "relevant memories" (audit 25/11).
      // Continuity lives in state.activity and in the context thread.
      if (
        s.virtualMinutes - s.lastConsolidation >= 1440 &&
        ['dormir', 'descansar'].includes(s.activity.kind)
      ) {
        records.push(
          entry(
            s,
            'memoria',
            'Índice de consolidação durante repouso: experiências selecionadas para continuidade.',
            {
              method: 'agrupamento_deterministico_sem_nova_inferencia',
              summaries: memories
                .slice(0, 6)
                .map((r) => ({ id: r.id, excerpt: r.content.slice(0, 300) })),
            },
            {
              category: 'autobiografica',
              origin: 'consolidacao_deterministica',
              importance: 0.85,
              associations: memories.slice(0, 6).map((r) => r.id),
            },
          ),
        );
        s.lastConsolidation = s.virtualMinutes;
      }
      if (s.decisions % 24 === 0)
        records.push(
          entry(
            s,
            'checkpoint',
            'Checkpoint recuperável do estado; histórico permanece imutável.',
            { state: structuredClone(s) },
            { importance: 1, origin: 'backup_interno' },
          ),
        );
      await store.markRetrieval(
        memories.map((r) => r.id),
        now,
      );
      await store.commit(
        token,
        s,
        records,
        inbox.map((m) => m.id),
      );
      return { status: 'decisao_registrada', decisions: s.decisions };
    } catch (e) {
      s.failures++;
      const code = safeError(e);
      s.nextDecisionAt = now + retryDelay(code, e instanceof CognitiveError ? e.retryMs : 300000, s.failures);
      records.push(
        entry(s, 'erro', 'Operações cognitivas suspensas temporariamente.', {
          code,
          failures: s.failures,
          nextAttempt: s.nextDecisionAt,
          ...((e as { route?: RouteRecord }).route ? { route: (e as { route?: RouteRecord }).route } : {}),
        }),
      );
      // Protective deterministic homeostasis only; explicitly recorded as a rule, not a choice.
      if ((s.needs.energia < 15 || s.needs.sono > 95) && !(s.activity.kind === 'dormir' && s.activity.until > s.virtualMinutes)) {
        activate(s, 'descansar', 120);
        records.push(
          entry(
            s,
            'recuperacao',
            'Proteção determinística de recuperação ativada; não é decisão de IA.',
          ),
        );
      }
      await store.commit(token, s, records);
      return { status: 'suspenso', code };
    }
  } finally {
    await store.release(token);
  }
}
// Overload (503), timeouts and malformed replies are transient: retry in 5, then every 10 min.
// Budget/configuration problems keep their own longer delay. Before this, 7 consecutive 503s
// grew the wait to 5h20 and the creature stood still for hours.
export function retryDelay(code: string, retryMs: number, failures: number) {
  // The router already computed when the earliest model recovers.
  if (code === 'cognicao_indisponivel' || code === 'nenhum_modelo_elegivel') return Math.max(120000, Math.min(1800000, retryMs));
  const transient = /^gemini_(http_(5\d\d|429)|fetch_|response_)|^resposta_incompleta|^falha/.test(code);
  if (transient) return Math.min(600000, 300000 * 2 ** Math.min(Math.max(0, failures - 1), 1));
  return Math.min(21600000, Math.max(retryMs, 300000 * 2 ** Math.min(failures - 1, 6)));
}
const bodyText: Record<string, string> = {
  adormeceu_exausta: 'Adormeceu de exaustão: o corpo parou (regra fisiológica, não decisão).',
  acordou_descansada: 'Acordou sozinha: o sono acabou (regra fisiológica, não decisão).',
  acordou_com_fome_ou_sede: 'Acordou com fome ou sede críticas (regra fisiológica, não decisão).',
};
const needLabel: Record<string, string> = { fome: 'fome', sede: 'sede', sono: 'sono', energia: 'energia', higiene: 'higiene', saude: 'saúde', tedio: 'tédio', criatividade: 'criatividade', curiosidade: 'curiosidade' };
// What changed in the body between the start and the end of an activity. The creature learns
// cause and effect from these perceptions; the rules themselves are never told to it.
/** Fingerprint of the room (objects, positions and what is exposed on them). */
/**
 * Version-1 single room → house (26/11). Ids, labels, colours and exposed works are kept; moves
 * she made are re-applied where they still fit. Recorded as an EXTERNAL change of the world (the
 * development of Bunborn), never as her choice, and without telling her how to feel about it.
 */
export function migrateHouse(s: State): RecordEntry {
  const { objects, position, report } = migrateObjects(s.objects);
  s.objects = objects;
  const target = objects.find((o) => o.id === s.activity.target);
  const path = target ? approach(position, target, objects) : [];
  s.position = path.length ? path[path.length - 1] : position;
  s.house = { version: 2 };
  const reset = report.movedReset.map((id) => objects.find((o) => o.id === id)?.label ?? id);
  return entry(
    s,
    'habitat',
    'Alteração externa do ambiente (desenvolvimento do Bunborn, não uma escolha sua): o quarto único virou uma casa com quarto, estúdio, banheiro, sala, cozinha e jardim. Os objetos que já existiam e as obras expostas foram mantidos' + (reset.length ? `; ${reset.join(', ')} voltou à posição padrão porque o lugar anterior não existe na nova planta.` : '.'),
    { external: true, origin: 'desenvolvimento', migration: report },
    { origin: 'sistema', importance: 0.8 },
  );
}
const stationOf: Record<string, string> = { comer: 'comida', beber: 'comida', dormir: 'cama', higiene: 'higiene', pesquisar: 'terminal', organizar: 'bau' };
/** A room (id or label) or an object id, as she may name it. */
export function resolvePlace(s: State, name: string): { label: string; object?: State['objects'][number]; cell?: { x: number; y: number }; room: string } | null {
  const n = name.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{M}/gu, '').trim();
  const norm = (t: string) => t.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{M}/gu, '').trim();
  // By id or by its label ("Alimentação e água"), as she sees them.
  const o = s.objects.find((x) => x.id.toLocaleLowerCase('pt-BR') === n || norm(x.label) === n);
  if (o) return { label: o.label, object: o, room: roomAt(o).id };
  const r = houseRooms.find((x) => x.id === n || x.label.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{M}/gu, '') === n);
  if (!r) return null;
  // The free cell nearest to the room's centre.
  const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
  const taken = new Set(s.objects.flatMap((x) => footprint(x)).map((c) => c.x + ',' + c.y));
  const cells: { x: number; y: number }[] = [];
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (!taken.has(x + ',' + y)) cells.push({ x, y });
  cells.sort((p, q) => Math.hypot(p.x - cx, p.y - cy) - Math.hypot(q.x - cx, q.y - cy));
  return cells.length ? { label: r.label, cell: cells[0], room: r.id } : null;
}
/**
 * Where an activity happens when she names a place. Body activities have their station: naming it,
 * another object of the same room or the room itself means that station. Resting and observing
 * can use any object that offers it (a room name picks one there). Otherwise a factual refusal.
 */
export function placeFor(s: State, activity: string, name: string): string | undefined {
  const station = stationOf[activity];
  const where = resolvePlace(s, name);
  if (!where) throw new ToolError('objeto_inexistente', { objectId: name, note: 'esse objeto ou cômodo não existe na casa' });
  if (station) {
    const st = s.objects.find((o) => o.id === station);
    if (st && (where.object?.id === station || where.room === roomAt(st).id)) return station;
    throw new ToolError('lugar_inadequado', { objectId: name, note: `${activity} acontece em ${st?.label ?? station} (${st ? roomAt(st).label : ''})` });
  }
  const wants = activity === 'descansar' ? 'descansar' : 'observar';
  if (where.object) {
    const offers = kindOf(where.object).offers ?? [];
    if (offers.includes(wants) || (wants === 'observar' && offers.includes('descansar'))) return where.object.id;
    throw new ToolError('lugar_inadequado', { objectId: name, note: `${where.object.label} não oferece ${activity}; no mesmo cômodo: ${s.objects.filter((o) => roomAt(o).id === where.room && (kindOf(o).offers ?? []).includes(wants)).map((o) => o.id).join(', ') || 'nada'}` });
  }
  const pick = s.objects.find((o) => roomAt(o).id === where.room && (kindOf(o).offers ?? []).includes(wants));
  if (!pick) throw new ToolError('lugar_inadequado', { objectId: name, note: `em ${where.label} não há onde ${activity}` });
  return pick.id;
}
/** Similarity of a new diary entry to the recent ones (a fact she can read; nothing is refused for it). */
export function diaryEcho(content: string, recent: RecordEntry[]) {
  const c = closest(content, recent.map((r) => ({ id: r.id, content: r.content, realAt: r.realAt })));
  return c.words >= 0.3 || c.structure >= 0.12 || c.sameOpening ? { words: Math.round(c.words * 100) / 100, structure: Math.round(c.structure * 100) / 100, sameOpening: c.sameOpening, id: c.id } : null;
}
/** Measurements of an experiment's groups, produced by the simulation itself. */
export function measure(s: State, grupos: { canteiro: string; condicao: string }[]) {
  return {
    diaVirtual: Math.floor(s.virtualMinutes / 1440) + 1,
    hora: Math.floor((s.virtualMinutes % 1440) / 60),
    grupos: grupos.map((g) => {
      const bed = s.objects.find((o) => o.id === g.canteiro);
      const plot = s.house?.garden?.[g.canteiro];
      const light = bed ? bedLight(bed, s.objects) : 1;
      const gr = plot ? growth(plot, s.virtualMinutes, light) : null;
      return { canteiro: g.canteiro, condicao: g.condicao, especie: plot?.species ?? null, crescimentoPct: gr ? Math.round(gr.progress * 100) : null, estagio: gr ? stageLabel[gr.stage] : 'vazio', horasUmidas: gr?.moistHours ?? 0, regas: plot?.waterings.length ?? 0, sombra: light < 1, posicao: bed ? { x: bed.x, y: bed.y } : null };
    }),
  };
}
/** What she perceives when an observation starts (facts, never advice). */
export function observeNote(s: State): string {
  const o = s.objects.find((x) => x.id === s.activity.target);
  const vm = s.virtualMinutes;
  if (!o) return '';
  const outside = ['janela', 'canteiro', 'arvore', 'flores', 'banco', 'telescopio'].includes(o.kind) || roomAt(o).outdoor;
  if (outside) {
    const garden = Object.entries(s.house?.garden ?? {}).map(([bed, plot]) => { const o2 = s.objects.find((x) => x.id === bed); return `${bed}: ${species[plot.species]?.label ?? plot.species} (${stageLabel[growth(plot, vm, o2 ? bedLight(o2, s.objects) : 1).stage]})`; });
    return 'lá fora: ' + outsideView(vm, o.kind === 'telescopio' ? 'telescopio' : o.kind === 'janela' ? 'janela' : 'jardim') + (garden.length && o.kind !== 'telescopio' ? '; canteiros: ' + garden.join(', ') : '');
  }
  const room = roomAt(o);
  const here = s.objects.filter((x) => roomAt(x).id === room.id && x.kind !== 'tapete').map((x) => x.label + (x.artifactId ? ' (com obra exposta)' : ''));
  return `${room.id === "sala" || room.id === "cozinha" ? "na" : "no"} ${room.label.toLowerCase()}: ${here.join(", ")}`;
}
export function roomSignature(s: Pick<State, 'objects' | 'virtualMinutes'>) {
  let h = 2166136261;
  // The house and the world outside: a new period of the day or new weather is something new to see.
  for (const c of JSON.stringify(s.objects) + periodOf(s.virtualMinutes ?? 0) + weatherAt(s.virtualMinutes ?? 0).condition) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
}
function perception(s: State, activity: State['activity']): RecordEntry | null {
  if (!activity.startNeeds) return null;
  const after = bodySnapshot(s.needs, s.motives);
  const changes = Object.keys(after).filter((k) => Math.abs(after[k] - (activity.startNeeds![k] ?? after[k])) >= 1).map((k) => `${needLabel[k]} ${activity.startNeeds![k]} → ${after[k]}`);
  return entry(s, 'percepcao', `Depois de ${activity.kind}: ${changes.length ? changes.join(', ') : 'nada mudou no corpo'}.`, { activity: activity.kind, involuntary: !!activity.involuntary, before: activity.startNeeds, after, ...(activity.kind === 'observar' ? { room: roomSignature(s) } : {}) }, { origin: 'simulacao_deterministica', category: 'episodica', importance: 0.6 });
}
function bodyEvent(s: State, event: string): RecordEntry {
  return entry(s, 'corpo', bodyText[event] ?? 'Reação do corpo (regra fisiológica).', { event, needs: { ...s.needs }, activity: s.activity }, { origin: 'simulacao_deterministica' });
}
// Plain facts about the body for the model; no instruction about what to do.
export function bodyAlerts(s: State): string[] {
  const n = s.needs, out: string[] = [];
  if (n.fome >= 90) out.push('fome intensa; sente a saúde piorar');
  else if (n.fome >= 70) out.push('com fome');
  if (n.sede >= 90) out.push('sede intensa; sente a saúde piorar');
  else if (n.sede >= 70) out.push('com sede');
  if (n.sono >= 95) out.push('exausta de sono, mal consegue ficar acordada');
  else if (n.sono >= 75) out.push('com sono');
  if (n.energia <= 15) out.push('sem energia');
  if (n.saude < 50) out.push('saúde baixa, sente-se fraca');
  if (s.activity.involuntary && s.activity.until > s.virtualMinutes) out.push('dormindo por exaustão');
  if (n.higiene <= 25) out.push('sente-se suja e desconfortável');
  if (s.motives.tedio >= 80) out.push('muito entediada');
  if (s.motives.frustracao >= 60) out.push('frustrada');
  return out;
}
/**
 * What can come back on its own as a memory: her memories, diary, conversations and readings.
 * Engine bookkeeping (per-cycle "Intenção/Resultado" logs, continuity and affect rules, raw
 * intentions and numeric perceptions) stays in the database and in explicit recall (recordar),
 * but no longer floods the context (audit 25/11: 85% of memories were such echoes).
 */
const recallable = (r: RecordEntry) => ['memoria', 'diario', 'conversa', 'leitura'].includes(r.kind) && !['regra_afetiva', 'observacao'].includes(r.origin);
/** The room she is in with its objects (positions for moving), other rooms by name only. */
function houseContext(s: State) {
  const here = roomAt(s.position);
  // Ids are descriptive (cama, sofa, janela_sala); a label only when the id is not (approved resources).
  const pick = (o: State['objects'][number]) => ({ id: o.id, x: o.x, y: o.y, ...(o.id.includes(':') ? { label: o.label } : {}), ...(o.artifactId ? { artifactId: o.artifactId } : {}) });
  const others: Record<string, string[]> = {};
  for (const o of s.objects) { const r = roomAt(o); if (r.id !== here.id && o.kind !== 'tapete') (others[r.label] ??= []).push(o.id); }
  const garden = Object.entries(s.house?.garden ?? {}).map(([bed, plot]) => { const o = s.objects.find((x) => x.id === bed); const g = growth(plot, s.virtualMinutes, o ? bedLight(o, s.objects) : 1); return { canteiro: bed, especie: plot.species, estagio: stageLabel[g.stage], umido: g.moist }; });
  return {
    room: here.label,
    objects: s.objects.filter((o) => roomAt(o).id === here.id).map(pick),
    otherRooms: others,
    ...(garden.length ? { garden } : {}),
    ...(s.house?.inventory?.length ? { stored: s.house.inventory.map((o) => o.id) } : {}),
    ...(s.house?.walls && Object.keys(s.house.walls).length ? { wallColors: s.house.walls } : {}),
  };
}
function worldContext(s: State, previousVm: number | undefined, noticed: RecordEntry[], now: number) {
  const w = weatherAt(s.virtualMinutes);
  // What changed since her last decision, and what she actually perceived recently (never what
  // happened while she slept or could not see).
  const changed: string[] = [];
  if (previousVm !== undefined) {
    const pw = weatherAt(previousVm).condition, pp = periodOf(previousVm);
    if (pp !== periodOf(s.virtualMinutes)) changed.push(`${periodLabel[pp]} → ${periodLabel[periodOf(s.virtualMinutes)]}`);
    if (pw !== w.condition) changed.push(`${conditionLabel[pw]} → ${conditionLabel[w.condition]}`);
  }
  return {
    period: periodLabel[periodOf(s.virtualMinutes)], season: seasonLabel[seasonOf(s.virtualMinutes)], weather: conditionLabel[w.condition], air: feltTemperature(w.temp),
    ...(w.wind > 0.6 ? { wind: 'forte' } : w.wind > 0.35 ? { wind: 'brisa' } : {}),
    ...(changed.length ? { changedSinceLastDecision: changed } : {}),
    ...(noticed.length ? { noticed: noticed.slice(0, 3).map((r) => ({ id: r.id, what: r.content, agoRealMinutes: ago(now, r.realAt) })) } : {}),
  };
}
const outsideKinds = ['janela', 'canteiro', 'arvore', 'flores', 'banco', 'telescopio'];
/**
 * World events that happened since the last tick and that she could perceive: awake, and outdoors
 * or looking out for sights; sounds and felt changes anywhere. One record per event, at most three
 * per tick. Events she could not perceive still happened (the observer can see them) but are not hers.
 */
export function perceiveWorld(before: State, s: State, already: RecordEntry[]): RecordEntry[] {
  const seen = new Set(already.map((r) => String(r.data.eventId)));
  const timeline = [before.activity, ...(before.queue ?? []), s.activity];
  const activityAt = (t: number) => timeline.find((a) => a.until > t) ?? s.activity;
  const out: RecordEntry[] = [];
  const events = eventsBetween(before.virtualMinutes, s.virtualMinutes);
  // A bed becoming ready is a garden event too.
  for (const [bedId, plot] of Object.entries(s.house?.garden ?? {})) {
    const bed = s.objects.find((o) => o.id === bedId);
    if (!bed) continue;
    const light = bedLight(bed, s.objects);
    if (growth(plot, before.virtualMinutes, light).stage < 4 && growth(plot, s.virtualMinutes, light).stage >= 4)
      events.push({ id: `colheita:${bedId}:${plot.plantedAt}`, kind: 'pronta_colher', label: `${species[plot.species]?.label ?? plot.species} pronta para colher no ${bed.label}`, start: s.virtualMinutes - 1, end: s.virtualMinutes + 1440, where: 'jardim', sense: 'ver' });
  }
  for (const e of events) {
    if (out.length >= 3 || seen.has(e.id)) continue;
    const t = Math.max(e.start, before.virtualMinutes);
    const act = activityAt(t);
    const target = s.objects.find((o) => o.id === act.target);
    const how = perceives(e, { awake: act.kind !== 'dormir', outdoors: roomAt(s.position).outdoor === true, lookingOut: act.kind === 'observar' && !!target && (outsideKinds.includes(target.kind) || roomAt(target).outdoor === true), night: false });
    if (!how) continue;
    out.push(entry(s, 'ambiente', `${how[0].toUpperCase()}${how.slice(1)}: ${e.label}.`, { eventId: e.id, event: e.kind, how, where: e.where, rare: !!e.rare }, { origin: 'simulacao_deterministica', category: 'episodica', importance: e.rare ? 0.6 : 0.3, virtualAt: Math.round(t) }));
  }
  return out;
}
/** A fact about her own recent diary (the openings she keeps using), never a rule. */
function diaryPattern(diary: RecordEntry[]) {
  const counts = new Map<string, number>();
  for (const r of diary.slice(0, 6)) { const o = normalize(r.content).split(' ').slice(0, 3).join(' '); counts.set(o, (counts.get(o) ?? 0) + 1); }
  const [top, n] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  return n >= 3 ? `${n} das suas últimas ${Math.min(6, diary.length)} entradas começam com "${top}"` : null;
}
/** Skills she declared, procedures relevant to what she is doing, active experiments with the last measurement. */
function learningContext(s: State, skills: RecordEntry[], procedures: RecordEntry[], experiments: RecordEntry[]) {
  const latest = (rows: RecordEntry[]) => [...new Map(rows.map((r) => [r.entityId, r])).values()];
  const relevant = new Set<string>(['outro']);
  if (s.motives.criatividade >= 55 || s.activity.kind === 'criar') ['pintura', 'escrita', 'musica'].forEach((x) => relevant.add(x));
  if (Object.keys(s.house?.garden ?? {}).length || roomAt(s.position).outdoor) relevant.add('jardim');
  if (s.activity.kind === 'pesquisar' || s.motives.curiosidade >= 60) relevant.add('pesquisa');
  const active = latest(experiments).filter((r) => r.data.status === 'ativo');
  if (active.length) relevant.add('experimento');
  const procs = latest(procedures).filter((r) => relevant.has(String(r.data.contexto))).slice(0, 3);
  const out: Record<string, unknown> = {};
  const sk = latest(skills);
  if (sk.length) out.skills = sk.slice(0, 6).map((r) => ({ entityId: r.entityId, nome: r.data.nome, tecnicas: r.data.tecnicas, limitacoes: r.data.limitacoes ?? undefined }));
  if (procs.length) out.procedures = procs.map((r) => ({ entityId: r.entityId, titulo: r.content, contexto: r.data.contexto, passos: r.data.passos }));
  if (active.length) out.experiments = active.slice(0, 2).map((r) => ({ entityId: r.entityId, pergunta: r.data.pergunta, hipotese: r.data.hipotese, variavel: r.data.variavel, grupos: r.data.grupos, ultimaMedicao: (r.data.medicoes as unknown[] | undefined)?.at(-1), medicoes: (r.data.medicoes as unknown[] | undefined)?.length ?? 0 }));
  return out;
}
const ago = (now: number, at: number) => Math.max(0, Math.round((now - at) / 60000));
const noteOf = (o: { result?: string; code?: string; detail?: unknown }) => {
  const d = o.detail as { note?: string } | undefined;
  return o.result === 'feita' ? (d?.note ? `feita (${d.note})` : 'feita') : `recusada (${d?.note ?? o.code ?? 'motivo não informado'})`;
};
/** Notable events she lived (not engine bookkeeping), newest first. */
const eventKinds = ['conversa', 'artefato', 'habitat', 'jardim', 'musica', 'recurso', 'experimento', 'habilidade', 'procedimento', 'identidade', 'interesse', 'projeto', 'interrupcao', 'corpo', 'atividade_interrompida', 'relacao'];
/**
 * Everything the creature perceives when deciding, built from persisted state only.
 * Order follows a lived moment: who she is → how she feels → where she is → what she was doing
 * and thinking → what she knows → what she remembers → who is talking to her.
 * Numbers about the body are not sent: she feels levels (the observer still sees percentages).
 */
export async function buildContext(env: Env, store: Store, s: State, now: number) {
  const inbox = await store.inbox();
  const [noticed, skills, procedures, experiments, relations] = await Promise.all([store.latest('ambiente', 3), store.latest('habilidade', 12), store.latest('procedimento', 16), store.latest('experimento', 8), store.latest('relacao', 16)]);
  const [interests, projects, artifacts, recent, concepts, readings, researchRows, thread, diary, perceptionRows] = await Promise.all([
    store.latest('interesse', 12),
    store.latest('projeto', 10),
    store.latest('artefato', 8),
    store.recent(40),
    store.latest('conceito', 16),
    store.latest('leitura', 2),
    store.latest('pesquisa', 12),
    store.latest('intencao', 4),
    store.latest('diario', 6),
    store.latest('percepcao', 5),
  ]);
  const lastIntent = thread[0];
  // Retrieval cue: what she is doing and what matters to her, not only the last intention.
  const researchByQuery = [...new Map(researchRows.map((r) => [String(r.data.query ?? r.content).toLocaleLowerCase('pt-BR'), r])).values()].slice(0, 4);
  const cue = [s.activity.intention, ...interests.map((r) => r.content), ...projects.filter((p) => p.data.status === 'ativo').map((p) => p.content), ...researchByQuery.map((r) => String(r.data.query ?? '')), diary[0]?.content ?? ''].join(' ');
  const shownQueries = new Set(researchByQuery.slice(0, 3).map((r) => String(r.data.query ?? '').toLocaleLowerCase('pt-BR')));
  const diaryIds = new Set(diary.map((r) => r.id));
  // Skip what is already in front of her (diary entries, research shown in knowledge).
  const candidates = await store.memories(cue, now, 24, (r) => recallable(r) && !diaryIds.has(r.id) && !shownQueries.has(String(r.data.query ?? '').toLocaleLowerCase('pt-BR')));
  // Varied recall (27/11): the same 5 memories were recalled ~250 times each, in almost every
  // decision. Recently and often shown memories step back (habituation, not deletion) and MMR keeps
  // near-equivalent memories from taking several slots. Deterministic; nothing random.
  const seen = await store.retrievalStats(candidates.map((r) => r.id));
  const scored = candidates.map((r, i) => {
    const st = seen.get(r.id);
    const recentShow = st ? Math.exp(-Math.max(0, now - st.last_at) / (3 * 3600000)) : 0;
    const habit = st ? Math.min(1, Math.log10(1 + st.count) / 2.4) : 0;
    return { item: r, text: r.content, score: (candidates.length - i) / candidates.length - 0.7 * recentShow * habit };
  });
  const memories: RecordEntry[] = mmr(scored, 6, 0.6);
  const complex = (s.complexNext || (s.decisions > 0 && s.decisions % 24 === 0)) && s.decisions > 0;
  const felt = feelings(s);
  const ongoing = s.activity.until > s.virtualMinutes;
  const situationOf = (a: State['activity']) => ({ kind: a.kind, where: a.target, intention: a.intention });
  const context = {
    facts: {
      simulation: true,
      decisionNumber: s.decisions,
      species: 'coelho',
      ageVirtualDays: Math.round(s.virtualMinutes / 144) / 10,
      multiplier: s.multiplier,
      consolidationDue: s.virtualMinutes - s.lastConsolidation > 1440,
      minimumRealMinutesBetweenDecisions: decisionFloor(env) / 60000,
      timeUnits: `atividade.minutes é tempo VIRTUAL; nextMinutes é tempo REAL (1 min real = ${s.multiplier} min virtuais). Quando a atividade e a fila terminam, a próxima decisão vem cedo.`,
    },
    // Who she is: identity and her own trajectory (interests, projects, works, diary).
    identity: { name: s.identity.name, description: s.identity.description, version: s.identity.version, traits: Object.fromEntries(Object.entries(s.identity.traits).map(([k, v]) => [k, { value: v.value, evidence: v.evidence.slice(0, 3), version: v.version }])) },
    interests: interests.map((r) => ({ id: r.id, entityId: r.entityId, topic: r.content, status: r.data.status, effectiveStrength: Math.round(Number(r.data.strength) * Math.exp(-Math.max(0, s.virtualMinutes - r.virtualAt) / 43200) * 100) / 100 })),
    projects: projects.map((r) => ({ id: r.id, entityId: r.entityId, title: r.content, steps: r.data.steps, completed: r.data.completed, status: r.data.status, horizon: r.data.horizon, version: r.data.version })),
    artifacts: [...new Map(artifacts.map((r) => [r.entityId, r])).values()].map((r) => ({ id: r.id, entityId: r.entityId, title: r.content, version: r.data.version, format: (r.data.artifact as { format?: string } | undefined)?.format, ...(Array.isArray(r.data.sections) && r.data.sections.length ? { sections: r.data.sections } : {}), ...((r.data.revision as { change?: string } | undefined)?.change ? { lastChange: (r.data.revision as { change: string }).change } : {}) })),
    diaryRecent: diary.slice(0, 3).map((r) => ({ id: r.id, content: r.content.slice(0, 400), agoRealMinutes: ago(now, r.realAt) })),
    ...(diaryPattern(diary) ? { diaryPattern: diaryPattern(diary) } : {}),
    // How she feels now, and how she felt things change after recent activities.
    feeling: { body: felt.body, mood: felt.mood, state: bodyAlerts(s).filter((x) => x.startsWith('dormindo')) },
    perceptions: perceptionRows.map((r) => ({ id: r.id, felt: r.data.before && r.data.after ? feltChange(String(r.data.activity), r.data.before as Record<string, number>, r.data.after as Record<string, number>) : r.content })),
    // Where she is and what is going on around her.
    situation: {
      activity: ongoing ? { ...situationOf(s.activity), remainingVirtualMinutes: Math.round(s.activity.until - s.virtualMinutes) } : null,
      queue: (s.queue ?? []).map(situationOf),
      lastCompleted: s.lastCompleted ? situationOf(s.lastCompleted) : null,
      ...houseContext(s),
    },
    world: worldContext(s, lastIntent?.virtualAt, noticed, now),
    // Continuity of thought: her last decisions and what happened to each action.
    thread: thread.map((r) => ({
      intention: r.content,
      agoRealMinutes: ago(now, r.realAt),
      actions: Array.isArray(r.data.outcomes) && r.data.outcomes.length
        ? (r.data.outcomes as { action: string; result?: string; code?: string; detail?: unknown }[]).map((o) => `${o.action}: ${noteOf(o)}`)
        : ((r.data.proposals ?? []) as { type: string; activity?: string }[]).map((p) => (p.activity ? 'atividade:' + p.activity : p.type)),
    })),
    // What she learned: recent research results (one entry per question) and concepts.
    knowledge: {
      research: researchByQuery.slice(0, 3).map((r) => ({ id: r.id, query: r.data.query, source: r.data.source, agoRealMinutes: ago(now, r.realAt), results: ((r.data.results ?? []) as { title: string; excerpt: string; url: string }[]).slice(0, 2).map((x) => ({ title: x.title, excerpt: String(x.excerpt ?? '').slice(0, 220), url: x.url })) })),
      concepts: [...new Map(concepts.filter((r) => !r.data.researchId).map((r) => [r.entityId, { entityId: r.entityId, nome: r.content, descricao: String(r.data.descricao ?? '').slice(0, 160) || undefined }])).values()].slice(0, 10),
      ...(relations.length ? { relations: [...new Map(relations.map((r) => [r.entityId, { de: r.data.from, para: r.data.to, relacao: r.content, status: r.data.status }])).values()].slice(0, 10) } : {}),
      ...learningContext(s, skills, procedures, experiments),
    },
    memories: memories.map((r) => ({ id: r.id, category: r.category, content: r.content.slice(0, 320), confidence: r.confidence, status: r.data.status, evidence: r.associations.slice(0, 4) })),
    events: recent.filter((r) => eventKinds.includes(r.kind)).slice(0, 6).map((r) => ({ id: r.id, kind: r.kind, content: r.content.slice(0, 240), agoRealMinutes: ago(now, r.realAt) })),
    inbox,
    workingResults: readings.map((r) => ({ id: r.id, realAt: r.realAt, content: r.content, result: JSON.stringify(r.data).slice(0, 5000) })),
  };
  return { context, inbox, lastIntent, recent, projects, artifacts, complex, memories };
}
// Server-imposed pacing to fit free quotas; production is fixed at five real minutes.
function decisionFloor(env: Env) {
  return env.ENVIRONMENT_ID === 'homologation' || env.ENVIRONMENT_ID === 'tool-tests' ? Math.max(0, Number(env.MIN_DECISION_MINUTES ?? 5)) * 60000 : 300000;
}
const brief = (a: State['activity']) => ({ kind: a.kind, until: Math.round(a.until), target: a.target, intention: a.intention, ...(a.involuntary ? { involuntary: true } : {}) });
export function packContext(input: Record<string, unknown>): Record<string, unknown> {
  const packed = structuredClone(input);
  const encoder = new TextEncoder();
  let bytes = encoder.encode(JSON.stringify(packed)).length;
  const omitted: Record<string, number> = {};
  // Least essential first; at least one memory and one message always stay.
  for (const key of ['events', 'workingResults', 'artifacts', 'interests', 'projects', 'diaryRecent', 'memories', 'inbox']) {
    const values = packed[key];
    if (!Array.isArray(values)) continue;
    const minimum = ['memories', 'inbox'].includes(key) ? 1 : 0;
    while (bytes > 47000 && values.length > minimum) {
      const item = values.pop();
      bytes -= encoder.encode(JSON.stringify(item)).length + 1;
      omitted[key] = (omitted[key] ?? 0) + 1;
    }
  }
  packed.contextSelection = {
    omitted,
    reason: 'Limite técnico de contexto; registros integrais continuam no banco.',
  };
  return packed;
}
const diaryWords = (t: string) => new Set(t.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{M}/gu, '').match(/\p{L}{4,}/gu) ?? []);
/** A recent diary entry that shares ≥60% of the meaningful words of the shorter text, if any. */
export function repeatedDiary(content: string, recent: { content: string; realAt: number }[], threshold = 0.6) {
  const mine = diaryWords(content);
  if (mine.size < 4) return null;
  return recent.find((r) => {
    const other = diaryWords(r.content);
    if (other.size < 4) return false;
    let shared = 0;
    for (const w of mine) if (other.has(w)) shared++;
    return shared / Math.min(mine.size, other.size) >= threshold;
  }) ?? null;
}
export function safeError(e: unknown): string {
  if(e instanceof Error&&/Illegal invocation|incorrect.*this|this.*binding/i.test(e.message))return 'fetch_binding_invalido';
  return e instanceof CognitiveError
    ? e.code
    : e instanceof Error && /^[a-z_0-9]+$/.test(e.message)
      ? e.message
      : 'falha_validacao_ou_servico';
}
export async function administer(
  env: Env,
  mutate: (state: State, store: Store) => Promise<RecordEntry[]>,
  now = Date.now(),
) {
  const store = new Store(env.DB);
  const token = await store.acquire(now);
  if (!token) throw new CognitiveError('motor_ocupado', 60000);
  try {
    const current = await store.state();
    if (!current) throw new CognitiveError('nao_nasceu');
    const { state: s, completed, events } = reconcile(current, now);
    // Activities finishing inside this interval are recorded, never silently dropped.
    const records = [
      ...events.map((event) => bodyEvent(s, event)),
      ...completed.flatMap((activity) => { const felt = perception(s, activity); return [entry(s, 'atividade_concluida', `Atividade concluída: ${activity.kind}.`, { activity }, { virtualAt: activity.until, origin: 'simulacao_deterministica' }), ...(felt ? [felt] : [])]; }),
      ...(await mutate(s, store)),
    ];
    await store.commit(token, s, records);
    return s;
  } finally {
    await store.release(token);
  }
}
