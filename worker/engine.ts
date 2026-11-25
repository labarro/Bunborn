import {
  approach,
  born,
  clamp,
  reconcile,
  validLayout,
  type Action,
  type RecordEntry,
  type State,
  quotaDay,
} from '../shared/domain';
import { CognitiveError, GeminiProvider, type CognitionProvider, type Env } from './provider';
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
function activate(s: State, kind: string, minutes = 30,allowQueue=false) {
  const target = targetFor[kind] ?? 'mesa';
  const object = s.objects.find((o) => o.id === target);
  if (!object) throw new Error('objeto_indisponivel');
  const route = approach(s.position, object, s.objects);
  if (!route.length) throw new Error('objeto_inacessivel');
  if(s.activity.until>s.virtualMinutes){
    if(s.activity.kind===kind&&s.activity.target===target)return 'continuada';
    if(!allowQueue&&passive.includes(s.activity.kind)&&!s.activity.involuntary){s.position=route[route.length-1];s.activity={kind,until:s.virtualMinutes+minutes,target,intention:s.activity.intention};return 'substituida';}
    if(!allowQueue)throw new ToolError('atividade_em_andamento',{current:s.activity.kind,currentStation:s.activity.target,requiredStation:target,remainingVirtualMinutes:Math.round(s.activity.until-s.virtualMinutes),queued:(s.queue??[]).map(q=>q.kind),options:'aguardar o término, ou usar interromper antes'});
    s.queue??=[];if(s.queue.some(a=>a.kind===kind&&a.target===target))return 'ja_agendada';if(s.queue.length>=4)throw new Error('fila_de_atividades_cheia');const tail=s.queue[s.queue.length-1]??s.activity;s.queue.push({kind,until:tail.until+minutes,target,intention:s.activity.intention});return 'agendada';
  }
  s.position = route[route.length - 1];
  s.activity = { kind, until: s.virtualMinutes + minutes, target, intention: s.activity.intention };
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
  if (['pesquisar', 'criar', 'projeto', 'relacionar', 'mover', 'organizar'].includes(a.type === 'atividade' ? a.activity : a.type) && (n.energia <= 15 || n.sono >= 95 || n.fome >= 95 || n.sede >= 95))
    throw new ToolError('corpo_sem_condicoes', { needs: { fome: Math.round(n.fome), sede: Math.round(n.sede), sono: Math.round(n.sono), energia: Math.round(n.energia), saude: Math.round(n.saude) }, limits: 'energia > 15, sono < 95, fome < 95, sede < 95', options: 'comer, beber, dormir ou descansar recuperam o corpo' });
  if (a.type === 'interromper' && s.activity.involuntary && s.activity.until > s.virtualMinutes && n.sono > 60)
    throw new ToolError('sono_involuntario', { sono: Math.round(n.sono), remainingVirtualMinutes: Math.round(s.activity.until - s.virtualMinutes) });
  const start = (kind: string, minutes: number) => {
    const previous = s.activity;
    if (activate(s, kind, minutes) === 'substituida') record('atividade_interrompida', `Deixou de ${previous.kind} para ${kind}.`, { activity: previous, replacedBy: kind, automatic: true });
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
        { artifact: work.data.artifact, version: work.data.version, sourceId: work.id },
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
      const status=activate(s, a.activity, a.minutes,true);
      record('atividade', `Atividade ${status}: ${a.activity}.`, { activity:s.queue?.find(item=>item.kind===a.activity)??s.activity,status });
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
      // A concept is an actually searched query; edges connect to retrieved context, not fabricated mastery.
      record(
        'conceito',
        a.query,
        { sources: results.map((x) => x.url), related: s.working.slice(0, 4), researchId: r.id },
        { entityId: 'conceito:' + a.query.toLocaleLowerCase('pt-BR'), associations: [r.id] },
      );
      s.motives.tedio = clamp(s.motives.tedio - 10);
      s.motives.satisfacao = clamp(s.motives.satisfacao + 3);
      break;
    }
    case 'diario':
      start('diario', 20);
      record('diario', a.content);
      s.motives.tedio = clamp(s.motives.tedio - 5);
      break;
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
      s.motives.tedio = clamp(s.motives.tedio - 5);
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
      if (
        art.format === 'pixels' &&
        art.pixels.some(
          (row) => row.length !== art.pixels[0].length || row.some((p) => p >= art.palette.length),
        )
      )
        throw new Error('pixels_invalidos');
      const prior = await existingEntity(store, 'artefato', a.id);
      start('criar', 40);
      record(
        'artefato',
        a.title,
        {
          artifact: a.artifact,
          motivation: a.motivation,
          projectId: project?.entityId ?? null,
          version: Number(prior?.data.version ?? 0) + 1,
          author: s.id,
        },
        { entityId: prior?.entityId ?? entityId('artefato', a.id), importance: 0.8 },
      );
      s.motives.satisfacao = clamp(s.motives.satisfacao + 6);
      s.motives.criatividade = clamp(s.motives.criatividade - 10);
      s.motives.tedio = clamp(s.motives.tedio - 12);
      break;
    }
    case 'mover': {
      const objects = structuredClone(s.objects);
      const object = objects.find((o) => o.id === a.objectId);
      if (!object) throw new Error('objeto_inexistente');
      object.x = a.x;
      object.y = a.y;
      if (!validLayout(objects, s.position)) throw new Error('posicao_bloqueia_acesso');
      s.objects = objects;
      record('habitat', `Reposicionou ${object.label}.`, { object });
      s.motives.tedio = clamp(s.motives.tedio - 4);
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
    case 'recurso':
      record(
        'recurso',
        a.title,
        { reason: a.reason, status: 'pendente' },
        { entityId: 'recurso:' + a.id, category: 'prospectiva' },
      );
      break;
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
    for (const event of events) records.push(bodyEvent(s, event));
    for(const activity of completed)records.push(entry(s,'atividade_concluida',`Atividade concluída: ${activity.kind}.`,{activity},{virtualAt:activity.until,origin:'simulacao_deterministica'}));
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
    const inbox = await store.inbox();
    const memories = await store.memories(s.activity.intention + ' ' + s.working.join(' '), now);
    const [interests, projects, artifacts, recent, concepts, readings] = await Promise.all([
      store.latest('interesse', 12),
      store.latest('projeto', 10),
      store.latest('artefato', 8),
      store.recent(10),
      store.latest('conceito', 10),
      store.latest('leitura', 2),
    ]);
    let complex =
      (s.complexNext || (s.decisions > 0 && s.decisions % 24 === 0)) && s.decisions > 0;
    if(complex){const today=quotaDay(Date.now());const local=await store.usage() as {day:string;model:string;calls:number}[];const global=env.BUDGET_DB?await new Store(env.BUDGET_DB).usage() as typeof local:local;const used=(rows:typeof local)=>rows.find(r=>r.day===today&&r.model===env.MODEL_FLASH)?.calls??0;if(used(local)>=Math.min(16,Number(env.FLASH_DAILY_LIMIT))||used(global)>=Math.min(16,Number(env.FLASH_GLOBAL_LIMIT??16))){complex=false;records.push(entry(s,'orcamento','Revisão complexa adiada por cota; continuidade com o cérebro principal.',{model:env.MODEL_LITE},{origin:'controle_orcamento'}));}}
    const context = {
      facts: {
        simulation: true,
        decisionNumber:s.decisions,
        species: 'coelho',
        virtualMinutes: s.virtualMinutes,
        multiplier: s.multiplier,
        realAt: now,
        consolidationDue: s.virtualMinutes - s.lastConsolidation > 1440,
        minimumRealMinutesBetweenDecisions: decisionFloor(env) / 60000,
        timeUnits: `atividade.minutes é tempo VIRTUAL; nextMinutes é tempo REAL. 1 minuto real = ${s.multiplier} minutos virtuais (dormir 60 dura ${Math.round(60 / s.multiplier)} min reais). Quando a atividade e a fila terminam, a próxima decisão vem cedo; nextMinutes é só a espera máxima enquanto ocupada.`,
      },
      identity: s.identity,
      needs: s.needs,
      body: bodyAlerts(s),
      motives: s.motives,
      activity: s.activity,
      activityStatus: s.activity.until > s.virtualMinutes ? { ongoing: true, remainingVirtualMinutes: Math.round(s.activity.until - s.virtualMinutes), remainingRealMinutes: Math.round((s.activity.until - s.virtualMinutes) / s.multiplier) } : { ongoing: false, note: 'nenhuma atividade em andamento' },
      queuedActivities:s.queue??[],
      lastCompletedActivity:s.lastCompleted??null,
      objects: s.objects,
      concepts: concepts.map((r) => ({
        id: r.id,
        entityId: r.entityId,
        content: r.content,
        associations: r.associations,
      })),
      memories: memories.map((r) => ({
        id: r.id,
        category: r.category,
        content: r.content.slice(0, 1600),
        confidence: r.confidence,
        status: r.data.status,
        evidence: r.associations.slice(0, 4),
      })),
      interests: interests.map((r) => ({
        ...r,
        data: {
          ...r.data,
          effectiveStrength:
            Number(r.data.strength) *
            Math.exp(-Math.max(0, s.virtualMinutes - r.virtualAt) / 43200),
        },
      })),
      projects,
      artifacts: artifacts.map((r) => ({
        id: r.id,
        entityId: r.entityId,
        title: r.content,
        version: r.data.version,
      })),
      recent: recent.map((r) => ({
        id: r.id,
        kind: r.kind,
        content: r.content.slice(0, 1000),
        result: ['leitura','erro_ferramenta','pesquisa'].includes(r.kind) ? JSON.stringify(r.data).slice(0, 6000) : undefined,
      })),
      inbox,
      working: s.working,
      workingResults: readings.map((r) => ({
        id: r.id,
        realAt: r.realAt,
        content: r.content,
        result: JSON.stringify(r.data).slice(0, 12000),
      })),
    };
    try {
      const { decision, model, invalidActions = [] } = await (provider ?? new GeminiProvider(env, store)).decide(
        packContext(context),
        complex,
        now,
      );
      s.lastModel = model;
      s.activity.intention = decision.intention;
      records.push(
        entry(s, 'intencao', decision.intention, {
          summary: decision.summary,
          model,
          proposed: decision.actions.map((a) => a.type),
          nextMinutes:decision.nextMinutes,
          complexNext:decision.complexNext,
          proposals:decision.actions.map(a=>a.type==='criar'?{...a,artifact:{format:a.artifact.format}}:a),
        }),
      );
      for (const bad of invalidActions)
        records.push(entry(s, 'erro_ferramenta', 'Ação rejeitada ou indisponível.', { tool: bad.type, code: 'acao_malformada', detail: { issues: bad.issues, hint: 'Siga o contrato da ferramenta; evidence precisa citar ao menos um registro existente.' } }));
      // Apply each tool against a draft so rejected actions cannot partially mutate state.
      let external = 0;
      for (const a of decision.actions) {
        if (a.type === 'pesquisar' && external++ >= 1) {
          records.push(entry(s, 'erro_ferramenta', 'Máximo de uma pesquisa por ciclo.'));
          continue;
        }
        const draft = structuredClone(s);
        const output: RecordEntry[] = [];
        try {
          await applyAction(draft, a, store.withPending(records), output, now, fetcher);
          Object.assign(s, draft);
          records.push(...output);
        } catch (e) {
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
      records.push(
        entry(
          s,
          'memoria',
          `Contexto de continuidade: ${decision.intention}.`,
          { activity: s.activity, evidence: [observation.id] },
          {
            category: 'trabalho',
            origin: 'observacao',
            importance: 0.35,
            associations: [observation.id],
          },
        ),
      );
      const successful = records.filter((r) =>
        ['atividade', 'artefato', 'pesquisa', 'habitat'].includes(r.kind),
      );
      if (successful.length)
        records.push(
          entry(
            s,
            'memoria',
            'Associação afetiva simulada após a atividade.',
            { motives: s.motives, evidence: successful.map((r) => r.id) },
            {
              category: 'afetiva',
              origin: 'regra_afetiva',
              importance: 0.35,
              associations: successful.map((r) => r.id),
            },
          ),
        );
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
// Overload (503), timeouts and malformed replies are transient: retry in 5, 10, 20, 20... min.
// Budget/configuration problems keep their own longer delay. Before this, 7 consecutive 503s
// grew the wait to 5h20 and the creature stood still for hours.
export function retryDelay(code: string, retryMs: number, failures: number) {
  const transient = /^gemini_(http_(5\d\d|429)|fetch_|response_)|^resposta_incompleta|^falha/.test(code);
  if (transient) return Math.min(1200000, 300000 * 2 ** Math.min(Math.max(0, failures - 1), 2));
  return Math.min(21600000, Math.max(retryMs, 300000 * 2 ** Math.min(failures - 1, 6)));
}
function bodyEvent(s: State, event: string): RecordEntry {
  return entry(s, 'corpo', 'Adormeceu de exaustão: o corpo parou (regra fisiológica, não decisão).', { event, needs: { ...s.needs }, activity: s.activity }, { origin: 'simulacao_deterministica' });
}
// Plain facts about the body for the model; no instruction about what to do.
export function bodyAlerts(s: State): string[] {
  const n = s.needs, out: string[] = [];
  if (n.fome >= 90) out.push('fome crítica: a saúde está caindo (dormir e descansar não reduzem a fome; só comer reduz)');
  else if (n.fome >= 70) out.push('com fome');
  if (n.sede >= 90) out.push('sede crítica: a saúde está caindo (dormir e descansar não reduzem a sede; só beber reduz)');
  else if (n.sede >= 70) out.push('com sede');
  if (n.sono >= 95) out.push('exausta de sono: pode adormecer sozinha a qualquer momento');
  else if (n.sono >= 75) out.push('com sono');
  if (n.energia <= 15) out.push('sem energia para trabalho exigente');
  if (n.saude < 50) out.push('saúde baixa: a energia se esgota mais rápido; a saúde só se recupera com fome e sede abaixo de 70 e sono abaixo de 80');
  if (s.activity.involuntary && s.activity.until > s.virtualMinutes) out.push('dormindo por exaustão');
  return out;
}
// Server-imposed pacing to fit free quotas; production is fixed at five real minutes.
function decisionFloor(env: Env) {
  return env.ENVIRONMENT_ID === 'homologation' || env.ENVIRONMENT_ID === 'tool-tests' ? Math.max(0, Number(env.MIN_DECISION_MINUTES ?? 5)) * 60000 : 300000;
}
export function packContext(input: Record<string, unknown>): Record<string, unknown> {
  const packed = structuredClone(input);
  const encoder = new TextEncoder();
  let bytes = encoder.encode(JSON.stringify(packed)).length;
  const omitted: Record<string, number> = {};
  for (const key of [
    'recent',
    'workingResults',
    'interests',
    'projects',
    'concepts',
    'memories',
    'artifacts',
    'inbox',
  ]) {
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
      ...completed.map((activity) => entry(s, 'atividade_concluida', `Atividade concluída: ${activity.kind}.`, { activity }, { virtualAt: activity.until, origin: 'simulacao_deterministica' })),
      ...(await mutate(s, store)),
    ];
    await store.commit(token, s, records);
    return s;
  } finally {
    await store.release(token);
  }
}
