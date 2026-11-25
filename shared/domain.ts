import { z } from 'zod';
export const categories = [
  'episodica',
  'semantica',
  'procedimental',
  'afetiva',
  'autobiografica',
  'identidade',
  'prospectiva',
  'trabalho',
] as const;
export const categoryLabels: Record<string, string> = {
  episodica: 'Episódica',
  semantica: 'Semântica',
  procedimental: 'Procedimental',
  afetiva: 'Afetiva',
  autobiografica: 'Autobiográfica',
  identidade: 'Identidade',
  prospectiva: 'Prospectiva',
  trabalho: 'De trabalho',
};
const text = z.string().min(1).max(2000);
const short = z.string().min(1).max(160);
const evidence = z.array(z.string().max(100)).min(1).max(8);
export const artifactSchema = z.discriminatedUnion('format', [
  z.object({ format: z.literal('texto'), content: z.string().min(1).max(12000) }).strict(),
  z
    .object({
      format: z.literal('pixels'),
      palette: z
        .array(z.string().regex(/^#[0-9a-fA-F]{6}$/))
        .min(1)
        .max(16),
      pixels: z
        .array(z.array(z.number().int().min(0).max(15)).min(1).max(32))
        .min(1)
        .max(32),
    })
    .strict(),
  z
    .object({
      format: z.literal('musica'),
      tempo: z.number().int().min(40).max(200),
      notes: z
        .array(
          z
            .object({
              pitch: z.number().int().min(36).max(96),
              beats: z.number().min(0.125).max(8),
            })
            .strict(),
        )
        .min(1)
        .max(128),
    })
    .strict(),
  z
    .object({
      format: z.literal('objeto'),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      shape: z.enum(['vaso', 'escultura', 'quadro']),
    })
    .strict(),
]);
export const researchSources = ['wikipedia', 'wikipedia_en', 'wikidata', 'wikcionario', 'openlibrary', 'arxiv'] as const;
export const actionSchema = z.discriminatedUnion('type', [
  z.object({type:z.literal('interromper'),reason:short}).strict(),
  z.object({ type: z.literal('ler_obra'), id: short }).strict(),
  z.object({ type: z.literal('recordar'), query: short }).strict(),
  z
    .object({
      type: z.literal('atividade'),
      activity: z.enum([
        'comer',
        'beber',
        'dormir',
        'higiene',
        'descansar',
        'observar',
        'organizar',
      ]),
      minutes: z.number().int().min(5).max(480),
    })
    .strict(),
  z
    .object({
      type: z.literal('pesquisar'),
      source: z.enum(researchSources),
      query: short,
    })
    .strict(),
  z
    .object({
      type: z.literal('relacionar'),
      from: short,
      to: short,
      relation: short,
      status: z.enum(['hipotese', 'opiniao', 'fonte_consultada']),
      evidence,
    })
    .strict(),
  z.object({ type: z.literal('diario'), content: text }).strict(),
  z.object({ type: z.literal('mensagem'), content: text }).strict(),
  z
    .object({
      type: z.literal('memoria'),
      category: z.enum(categories),
      content: text,
      confidence: z.number().min(0).max(1),
      status: z.enum(['hipotese', 'opiniao', 'ficcao', 'incerto', 'fonte_consultada','observacao','fato_do_ambiente']),
      evidence,
    })
    .strict(),
  z
    .object({
      type: z.literal('identidade'),
      field: z.enum([
        'nome',
        'autodescricao',
        'preferencia',
        'valor',
        'crenca',
        'estilo',
        'aparencia',
      ]),
      value: short,
      evidence,
    })
    .strict(),
  z
    .object({
      type: z.literal('interesse'),
      id: short,
      topic: short,
      change: z.number().min(-0.1).max(0.1),
      status: z.enum(['ativo', 'adormecido', 'abandonado']),
      evidence,
    })
    .strict(),
  z
    .object({
      type: z.literal('projeto'),
      id: short,
      title: short,
      steps: z.array(short).min(1).max(12),
      completed: z.array(z.number().int().min(0).max(11)).max(12),
      status: z.enum(['ativo', 'suspenso', 'abandonado', 'concluido']),
      horizon: z.enum(['curto', 'medio', 'longo']),
      evidence,
    })
    .strict(),
  z
    .object({
      type: z.literal('criar'),
      id: short,
      title: short,
      motivation: short,
      projectId: z.string().max(160).nullable(),
      artifact: artifactSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('mover'),
      objectId: short,
      x: z.number().int().min(0).max(11),
      y: z.number().int().min(0).max(11),
    })
    .strict(),
  z.object({ type: z.literal('expor'), artifactId: short, objectId: short }).strict(),
  z.object({ type: z.literal('recurso'), id: short, title: short, reason: text }).strict(),
]);
export const decisionSchema = z
  .object({
    intention: short,
    summary: text,
    nextMinutes: z.number().int().min(3).max(60),
    complexNext: z.boolean(),
    actions: z.array(actionSchema).max(3),
  })
  .strict();
export type Decision = z.infer<typeof decisionSchema>;
export type InvalidAction = { type: string; issues: { path: string; message: string }[] };
// One malformed action must not discard the whole decision: valid actions run, malformed
// ones become explained rejections the creature sees in its next cycle.
const activityKinds = ['comer', 'beber', 'dormir', 'higiene', 'descansar', 'observar', 'organizar'];
// Purely formal tolerance: an over-long text is trimmed to the documented limit and an activity
// written as its own type ({type:'observar'}) is read as {type:'atividade'}. Content is never
// invented; anything else that is malformed is still rejected and explained.
function trimTooBig(value: unknown, issues: z.ZodIssue[]): unknown {
  const copy = structuredClone(value) as Record<string, unknown>;
  for (const issue of issues) {
    const max = (issue as { maximum?: unknown }).maximum;
    if (issue.code !== 'too_big' || typeof max !== 'number' || !issue.path.length) return null;
    let parent: Record<string, unknown> | undefined = copy;
    for (const key of issue.path.slice(0, -1)) parent = parent?.[key as string] as Record<string, unknown> | undefined;
    const last = issue.path[issue.path.length - 1] as string;
    if (!parent || typeof parent[last] !== 'string') return null;
    parent[last] = (parent[last] as string).slice(0, max);
  }
  return copy;
}
function normalizeAction(action: unknown): unknown {
  const a = action as Record<string, unknown> | null;
  if (a && typeof a === 'object' && typeof a.type === 'string' && activityKinds.includes(a.type)) {
    const minutes = Number(a.minutes ?? a.duration ?? 30);
    return { type: 'atividade', activity: a.type, minutes: Math.max(5, Math.min(480, Math.round(Number.isFinite(minutes) ? minutes : 30))) };
  }
  return action;
}
export function parseDecision(raw: unknown): { decision: Decision; invalidActions: InvalidAction[] } {
  const loose = decisionSchema.extend({ actions: z.array(z.unknown()) });
  let candidate = raw;
  const first = loose.safeParse(candidate);
  if (!first.success) {
    const trimmed = trimTooBig(candidate, first.error.issues);
    if (trimmed) candidate = trimmed;
  }
  const envelope = loose.parse(candidate);
  const valid: z.infer<typeof actionSchema>[] = [];
  const invalidActions: InvalidAction[] = [];
  for (const extra of envelope.actions.slice(3))
    invalidActions.push({ type: String((extra as { type?: unknown } | null)?.type ?? 'desconhecida').slice(0, 40), issues: [{ path: 'actions', message: 'no máximo 3 ações por decisão; esta não foi executada' }] });
  for (const original of envelope.actions.slice(0, 3)) {
    const action = normalizeAction(original);
    let result = actionSchema.safeParse(action);
    if (!result.success) {
      const trimmed = trimTooBig(action, result.error.issues);
      if (trimmed) result = actionSchema.safeParse(trimmed);
    }
    if (result.success) valid.push(result.data);
    else
      invalidActions.push({
        type: String((action as { type?: unknown } | null)?.type ?? 'desconhecida').slice(0, 40),
        issues: result.error.issues.slice(0, 4).map((i) => ({ path: i.path.join('.'), message: i.message.slice(0, 160) })),
      });
  }
  return { decision: decisionSchema.parse({ ...envelope, actions: valid }), invalidActions };
}
export type Action = z.infer<typeof actionSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type Point = { x: number; y: number };
export type HabitatObject = Point & {
  id: string;
  label: string;
  kind: string;
  color: string;
  artifactId?: string;
};
export type State = {
  schema: 1;
  id: 'principal';
  bornAt: number;
  updatedAt: number;
  virtualMinutes: number;
  multiplier: number;
  paused: boolean;
  revision: number;
  nextDecisionAt: number;
  decisions: number;
  failures: number;
  identity: {
    name: string | null;
    description: string;
    traits: Record<string, { value: string; evidence: string[]; version: number }>;
    version: number;
  };
  needs: Record<string, number>;
  motives: Record<string, number>;
  activity: { kind: string; until: number; target: string; intention: string; involuntary?: boolean };
  queue?:{kind:string;until:number;target:string;intention:string}[];
  lastCompleted?:{kind:string;until:number;target:string;intention:string};
  position: Point;
  objects: HabitatObject[];
  complexNext: boolean;
  lastConsolidation: number;
  working: string[];
  lastModel: string | null;
};
export type RecordEntry = {
  seq?: number;
  id: string;
  entityId: string;
  kind: string;
  category: string;
  content: string;
  data: Record<string, unknown>;
  realAt: number;
  virtualAt: number;
  importance: number;
  confidence: number;
  associations: string[];
  origin: string;
};
export const initialObjects: HabitatObject[] = [
  { id: 'cama', label: 'Cama', kind: 'cama', x: 1, y: 1, color: '#a38ab9' },
  { id: 'mesa', label: 'Mesa de trabalho', kind: 'mesa', x: 8, y: 2, color: '#b88b68' },
  { id: 'terminal', label: 'Terminal de pesquisa', kind: 'terminal', x: 8, y: 1, color: '#91aab0' },
  { id: 'estante', label: 'Estante', kind: 'estante', x: 1, y: 5, color: '#bb946b' },
  { id: 'comida', label: 'Alimentação e água', kind: 'comida', x: 2, y: 9, color: '#d4ad78' },
  { id: 'higiene', label: 'Área de higiene', kind: 'higiene', x: 9, y: 9, color: '#8fbbba' },
  { id: 'diario', label: 'Diário', kind: 'diario', x: 7, y: 3, color: '#b389a6' },
  { id: 'atelie', label: 'Ateliê', kind: 'atelie', x: 9, y: 5, color: '#d7ba90' },
  { id: 'bau', label: 'Armazenamento', kind: 'bau', x: 1, y: 7, color: '#b08767' },
  { id: 'descanso', label: 'Almofada de descanso', kind: 'descanso', x: 5, y: 6, color: '#9eae84' },
  { id: 'planta', label: 'Planta', kind: 'planta', x: 10, y: 1, color: '#91ad7e' },
];
export function born(now: number): State {
  return {
    schema: 1,
    id: 'principal',
    bornAt: now,
    updatedAt: now,
    virtualMinutes: 0,
    multiplier: 6,
    paused: false,
    revision: 0,
    nextDecisionAt: now,
    decisions: 0,
    failures: 0,
    identity: { name: null, description: 'Identidade ainda em formação.', traits: {}, version: 0 },
    needs: { fome: 15, sede: 15, sono: 10, energia: 85, higiene: 90, conforto: 85, saude: 100 },
    motives: {
      curiosidade: 50,
      tedio: 10,
      satisfacao: 50,
      criatividade: 50,
      frustracao: 0,
      interacao: 20,
      motivacao: 50,
    },
    activity: {
      kind: 'observar',
      until: 0,
      target: 'descanso',
      intention: 'Conhecer o ambiente disponível.',
    },
    position: { x: 5, y: 5 },
    queue:[],
    objects: structuredClone(initialObjects),
    complexNext: false,
    lastConsolidation: 0,
    working: [],
    lastModel: null,
  };
}
export const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));
// Physiology, per virtual hour. Needs are body rules (not choices): they rise while awake,
// activities restore them, and neglect has consequences (energy drain, health loss and,
// at exhaustion, involuntary sleep). Rates are sized so the 6x clock and ~15 min decision
// cadence make needs matter: hungry every ~12-16 virtual hours, sleepy after ~24.
export const physiology = {
  awake: { fome: 5, sede: 6, sono: 3.5, energia: -3, higiene: -1.5 },
  asleep: { fome: 2.5, sede: 3 },
  restore: { comer: { fome: -300 }, beber: { sede: -400 }, higiene: { higiene: 300 }, dormir: { sono: -15, energia: 12 }, descansar: { energia: 15, sono: -3 } },
  hungryDrain: 3,
  exhaustion: { sono: 100, energia: 5, sleepMinutes: 240 },
} as const;
export const energyCap = (sono: number) => clamp(100 - Math.max(0, sono - 60) * 2);
export function reconcile(input: State, now: number): { state: State; gap: boolean;completed:State['activity'][];events:string[] } {
  const s = structuredClone(input);
  const elapsed = Math.max(0, (now - s.updatedAt) / 60000);
  s.updatedAt = Math.max(now, s.updatedAt);
  if (s.paused) return { state: s, gap: false,completed:[],events:[] };
  const vm = elapsed * s.multiplier;
  s.virtualMinutes += vm;
  // Cap offline degradation; activity overlaps are scaled by the same factor.
  const hours = Math.min(vm / 60, 12);
  const scale = vm > 0 ? hours / (vm / 60) : 0;
  const over: Record<string, number> = {};
  const completed:State['activity'][]=[];let start=input.virtualMinutes;
  for(const activity of [input.activity,...(input.queue??[])]){
    if (activity.until > input.virtualMinutes) {
      const overlap = Math.max(0, Math.min(s.virtualMinutes, activity.until) - Math.max(start,input.virtualMinutes)) / 60;
      over[activity.kind] = (over[activity.kind] ?? 0) + overlap * scale;
    }
    if(activity.until>input.virtualMinutes&&activity.until<=s.virtualMinutes){completed.push(activity);s.lastCompleted=activity;}
    start=Math.max(start,activity.until);
  }
  const n = s.needs;
  const sleepH = Math.min(hours, over.dormir ?? 0);
  const awakeH = hours - sleepH;
  const p = physiology;
  const deprived = (n.fome ?? 0) >= 80 || (n.sede ?? 0) >= 80;
  n.fome = clamp(n.fome + awakeH * p.awake.fome + sleepH * p.asleep.fome + (over.comer ?? 0) * p.restore.comer.fome);
  n.sede = clamp(n.sede + awakeH * p.awake.sede + sleepH * p.asleep.sede + (over.beber ?? 0) * p.restore.beber.sede);
  n.sono = clamp(n.sono + awakeH * p.awake.sono + sleepH * p.restore.dormir.sono + (over.descansar ?? 0) * p.restore.descansar.sono);
  n.energia = clamp(
    n.energia + awakeH * p.awake.energia - (deprived ? awakeH * p.hungryDrain : 0) - ((n.saude ?? 100) < 50 ? awakeH * 2 : 0) +
      sleepH * p.restore.dormir.energia + (over.descansar ?? 0) * p.restore.descansar.energia,
  );
  // Sleep pressure caps usable energy: very sleepy means little energy (sono 80 → 60, 95 → 30, 100 → 20).
  n.energia = Math.min(n.energia, energyCap(n.sono));
  n.higiene = clamp(n.higiene + hours * p.awake.higiene + (over.higiene ?? 0) * p.restore.higiene.higiene);
  n.conforto = clamp(100 - (n.fome + n.sede + n.sono) / 3 - (100 - n.higiene) / 6 + (over.descansar ?? 0) * 20);
  const deficit = (n.fome >= 90 ? 4 : 0) + (n.sede >= 90 ? 4 : 0) + (n.sono >= 95 ? 2 : 0) + (n.higiene <= 15 ? 1 : 0);
  n.saude = clamp(deficit ? n.saude - hours * deficit : n.fome < 70 && n.sede < 70 && n.sono < 80 ? n.saude + hours * 1.5 : n.saude, 10);
  s.motives.tedio = clamp(s.motives.tedio + hours);
  s.motives.interacao = clamp(s.motives.interacao + hours * 0.3);
  while(s.activity.until<=s.virtualMinutes&&s.queue?.length){s.activity=s.queue.shift()!;const object=s.objects.find(o=>o.id===s.activity.target);if(object){const path=approach(s.position,object,s.objects);if(path.length)s.position=path[path.length-1];}}
  const events: string[] = [];
  const sleeping = s.activity.kind === 'dormir' && s.activity.until > s.virtualMinutes;
  if (!sleeping && (n.sono >= p.exhaustion.sono || n.energia <= p.exhaustion.energia)) {
    // The body gives out: recorded as physiology, never as a decision.
    s.queue = [];
    s.activity = { kind: 'dormir', until: s.virtualMinutes + p.exhaustion.sleepMinutes, target: 'cama', intention: s.activity.intention, involuntary: true };
    const bed = s.objects.find((o) => o.id === 'cama');
    if (bed) { const path = approach(s.position, bed, s.objects); if (path.length) s.position = path[path.length - 1]; }
    events.push('adormeceu_exausta');
  }
  return { state: s, gap: elapsed > 15,completed,events };
}
export function pathfind(start: Point, end: Point, objects: HabitatObject[]): Point[] {
  const blocked = new Set(objects.map((o) => `${o.x},${o.y}`));
  const queue: Point[][] = [[start]];
  const seen = new Set([`${start.x},${start.y}`]);
  while (queue.length) {
    const path = queue.shift()!;
    const p = path[path.length - 1];
    if (p.x === end.x && p.y === end.y) return path;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const n = { x: p.x + dx, y: p.y + dy };
      const key = `${n.x},${n.y}`;
      if (n.x < 0 || n.y < 0 || n.x > 11 || n.y > 11 || blocked.has(key) || seen.has(key)) continue;
      seen.add(key);
      queue.push([...path, n]);
    }
  }
  return [];
}
export function approach(start: Point, object: HabitatObject, objects: HabitatObject[]): Point[] {
  return (
    [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
      .map(([x, y]) => pathfind(start, { x: object.x + x, y: object.y + y }, objects))
      .filter((p) => p.length)
      .sort((a, b) => a.length - b.length)[0] ?? []
  );
}
export function validLayout(objects: HabitatObject[], position: Point): boolean {
  return (
    new Set(objects.map((o) => o.id)).size === objects.length &&
    new Set(objects.map((o) => `${o.x},${o.y}`)).size === objects.length &&
    !objects.some((o) => o.x === position.x && o.y === position.y) &&
    objects.every((o) => approach(position, o, objects).length > 0)
  );
}
export function quotaDay(now: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function memoryScore(r: RecordEntry, query: string, now: number): number {
  const words =
    query
      .toLocaleLowerCase('pt-BR')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  const hay = (r.content + ' ' + r.associations.join(' '))
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
  const relevant = words.filter((w) => hay.includes(w)).length / Math.max(1, words.length);
  return (
    relevant * 0.5 +
    r.importance * 0.3 +
    Math.exp(-Math.max(0, now - r.realAt) / 86400000 / 14) * 0.2
  );
}
