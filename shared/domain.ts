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
      minutes: z.number().int().min(5).max(120),
    })
    .strict(),
  z
    .object({
      type: z.literal('pesquisar'),
      source: z.enum(['wikipedia', 'wikidata']),
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
  activity: { kind: string; until: number; target: string; intention: string };
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
export function reconcile(input: State, now: number): { state: State; gap: boolean;completed:State['activity'][] } {
  const s = structuredClone(input);
  const elapsed = Math.max(0, (now - s.updatedAt) / 60000);
  s.updatedAt = Math.max(now, s.updatedAt);
  if (s.paused) return { state: s, gap: false,completed:[] };
  const vm = elapsed * s.multiplier;
  s.virtualMinutes += vm;
  // Homeostasis is rule-based, not an invented cognitive activity. Cap offline degradation.
  const hours = Math.min(vm / 60, 12);
  const n = s.needs;
  n.fome = clamp(n.fome + hours * 2);
  n.sede = clamp(n.sede + hours * 2.5);
  n.sono = clamp(n.sono + hours * 2);
  n.energia = clamp(n.energia - hours * 1.4, 10);
  n.higiene = clamp(n.higiene - hours * 0.8, 10);
  n.conforto = clamp(100 - (n.fome + n.sede + n.sono) / 4, 15);
  n.saude = clamp(n.saude + (n.conforto > 40 ? hours * 0.8 : -hours), 30);
  s.motives.tedio = clamp(s.motives.tedio + hours);
  s.motives.interacao = clamp(s.motives.interacao + hours * 0.3);
  const completed:State['activity'][]=[];let start=input.virtualMinutes;
  for(const activity of [input.activity,...(input.queue??[])]){
  if (activity.until > input.virtualMinutes) {
    const overlap =
      Math.max(0, Math.min(s.virtualMinutes, activity.until) - Math.max(start,input.virtualMinutes)) / 60;
    const k = activity.kind;
    if (k === 'dormir') {
      n.sono = clamp(n.sono - overlap * 40);
      n.energia = clamp(n.energia + overlap * 30);
    }
    if (k === 'comer') n.fome = clamp(n.fome - overlap * 90);
    if (k === 'beber') n.sede = clamp(n.sede - overlap * 120);
    if (k === 'higiene') n.higiene = clamp(n.higiene + overlap * 100);
    if (k === 'descansar') {
      n.energia = clamp(n.energia + overlap * 20);
      n.conforto = clamp(n.conforto + overlap * 20);
    }
  }
    if(activity.until>input.virtualMinutes&&activity.until<=s.virtualMinutes){completed.push(activity);s.lastCompleted=activity;}
    start=Math.max(start,activity.until);
  }
  while(s.activity.until<=s.virtualMinutes&&s.queue?.length){s.activity=s.queue.shift()!;const object=s.objects.find(o=>o.id===s.activity.target);if(object){const path=approach(s.position,object,s.objects);if(path.length)s.position=path[path.length-1];}}
  return { state: s, gap: elapsed > 15,completed };
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
