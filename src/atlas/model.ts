// Neural Atlas — pure view logic (28/11): modes, filters, stable colours, node size with a declared
// criterion, and label placement without collisions. No randomness: the same data looks the same.
import type { Atlas, AtlasEdge, AtlasNode, EdgeOrigin, NodeType } from '../../shared/atlas';

export type Mode = 'conhecimentos' | 'experiencias' | 'interesses' | 'projetos' | 'aprendizado' | 'integrada';
export const modes: { id: Mode; label: string; types: NodeType[]; hint: string }[] = [
  { id: 'conhecimentos', label: 'Conhecimentos', types: ['consulta', 'conhecimento', 'conceito'], hint: 'Consultas, o que voltou delas com fontes, e conceitos que ela registrou.' },
  { id: 'experiencias', label: 'Experiências', types: ['consulta', 'conhecimento', 'conceito', 'memoria'], hint: 'Memórias dela ligadas a conhecimentos, ou as mais lembradas.' },
  { id: 'interesses', label: 'Interesses', types: ['interesse', 'consulta', 'conhecimento', 'conceito', 'memoria', 'obra'], hint: 'Interesses e as evidências que os sustentam.' },
  { id: 'projetos', label: 'Projetos', types: ['projeto', 'obra', 'memoria', 'consulta', 'conceito'], hint: 'Projetos, as obras que fazem parte deles e o que usaram.' },
  { id: 'aprendizado', label: 'Aprendizado', types: ['habilidade', 'procedimento', 'experimento', 'conceito', 'obra', 'memoria'], hint: 'Habilidades, procedimentos e experimentos, com suas evidências.' },
  { id: 'integrada', label: 'Tudo', types: ['consulta', 'conhecimento', 'conceito', 'interesse', 'projeto', 'obra', 'experimento', 'habilidade', 'procedimento', 'memoria'], hint: 'Todos os elementos; use os filtros para não saturar.' },
];
export const typeLabel: Record<NodeType, string> = { consulta: 'Consulta', conhecimento: 'Conhecimento com fonte', conceito: 'Conceito', interesse: 'Interesse', projeto: 'Projeto', obra: 'Obra', experimento: 'Experimento', habilidade: 'Habilidade', procedimento: 'Procedimento', memoria: 'Memória' };
export const originLabel: Record<EdgeOrigin, string> = { declarada: 'declarada por ela', fonte: 'fundamentada em fonte', motor: 'registrada pelo motor', inferida: 'inferida pelo sistema', hipotese: 'hipótese dela' };
/** A mode exists only if there is data for what makes it different (no empty tabs). */
export function availableModes(a: Atlas) {
  const has = (t: NodeType) => a.nodes.some((n) => n.type === t);
  return modes.filter((m) => (m.id === 'conhecimentos' ? has('consulta') || has('conceito') : m.id === 'experiencias' ? has('memoria') : m.id === 'interesses' ? has('interesse') : m.id === 'projetos' ? has('projeto') : m.id === 'aprendizado' ? has('habilidade') || has('procedimento') || has('experimento') : true));
}

// Palette: Bunborn violets plus blue, cyan, green, rose and gold, tuned for a dark sky.
export const palette = ['#b49cff', '#7fb0ff', '#6fe0e6', '#8fe3a8', '#ff9cc8', '#f2cf7a', '#c8a2ff', '#9bd0ff', '#ffb98a', '#a6f0d0'];
export const isolatedColor = '#a9a3c9';
function hash(s: string) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
const assigned = new Map<string, string>();
/** Assigns colours once per set of clusters: each id starts at its hash slot and moves to the next free one. */
export function assignColors(ids: string[]) {
  assigned.clear();
  const used = new Set<number>();
  for (const id of [...ids].filter((x) => x !== 'isolados').sort()) {
    let i = hash(id) % palette.length;
    for (let k = 0; k < palette.length && used.has(i); k++) i = (i + 1) % palette.length;
    used.add(i);
    assigned.set(id, palette[i]);
  }
}
/** Same cluster → same colour across loads (depends on the cluster ids only). */
export const clusterColor = (id: string | undefined) => (!id || id === 'isolados' ? isolatedColor : assigned.get(id) ?? palette[hash(id) % palette.length]);

export type SizeBy = 'conexoes' | 'fontes' | 'recuperacoes' | 'ocorrencias';
export const sizeLabel: Record<SizeBy, string> = { conexoes: 'número de ligações (estrutura, não domínio)', fontes: 'fontes e evidências registradas', recuperacoes: 'vezes que a memória foi lembrada', ocorrencias: 'vezes que a consulta foi feita' };
export function radiusOf(n: AtlasNode, by: SizeBy, degree: number) {
  const v = by === 'conexoes' ? degree : by === 'fontes' ? n.sources.length + n.evidence.length : by === 'recuperacoes' ? n.retrievals : n.occurrences;
  const base = n.type === 'interesse' || n.type === 'projeto' ? 6 : n.type === 'obra' || n.type === 'memoria' ? 3.2 : 4.2;
  return Math.min(22, base + Math.sqrt(Math.max(0, v)) * (by === 'recuperacoes' ? 0.9 : 2.1));
}

export type Filters = { types: Set<NodeType>; origins: Set<EdgeOrigin>; showIsolated: boolean; until: number | null; query: string };
export function visibleGraph(a: Atlas, mode: Mode, f: Filters) {
  const allowed = new Set(modes.find((m) => m.id === mode)!.types.filter((t) => f.types.has(t)));
  let nodes = a.nodes.filter((n) => allowed.has(n.type) && (f.until === null || n.at <= f.until));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = a.edges.filter((e) => ids.has(e.source) && ids.has(e.target) && f.origins.has(e.origin) && (f.until === null || e.at <= f.until));
  const degree = new Map<string, number>();
  for (const e of edges) { degree.set(e.source, (degree.get(e.source) ?? 0) + 1); degree.set(e.target, (degree.get(e.target) ?? 0) + 1); }
  if (!f.showIsolated) nodes = nodes.filter((n) => degree.get(n.id));
  const keep = new Set(nodes.map((n) => n.id));
  return { nodes, edges: edges.filter((e) => keep.has(e.source) && keep.has(e.target)), degree };
}
export function search(a: Atlas, q: string) {
  const t = q.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{M}/gu, '');
  if (t.length < 2) return [];
  const norm = (s: string) => s.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{M}/gu, '');
  return a.nodes.filter((n) => norm(n.label).includes(t) || n.aliases.some((x) => norm(x).includes(t)) || norm(n.description ?? '').includes(t)).slice(0, 12);
}
export function neighbours(edges: AtlasEdge[], id: string) {
  const set = new Set<string>([id]);
  for (const e of edges) { if (e.source === id) set.add(e.target); if (e.target === id) set.add(e.source); }
  return set;
}

export type LabelBox = { id: string; x: number; y: number; w: number; h: number };
/**
 * Greedy label placement by priority: a label is drawn only where it does not overlap another
 * label already placed. Full names are never cut; what does not fit stays reachable by hover/panel.
 */
export function placeLabels(items: { id: string; x: number; y: number; r: number; text: string; priority: number }[], measure: (t: string) => number, budget: number, view = { w: Infinity, h: Infinity }) {
  const placed: LabelBox[] = [];
  const hit = (b: LabelBox) => placed.some((p) => b.x < p.x + p.w && b.x + b.w > p.x && b.y < p.y + p.h && b.y + b.h > p.y);
  for (const it of [...items].sort((a, b) => b.priority - a.priority)) {
    if (placed.length >= budget) break;
    const w = measure(it.text) + 8, h = 15;
    const candidates = [{ x: it.x + it.r + 5, y: it.y - h / 2 }, { x: it.x - it.r - 5 - w, y: it.y - h / 2 }, { x: it.x - w / 2, y: it.y + it.r + 3 }, { x: it.x - w / 2, y: it.y - it.r - 3 - h }];
    // Only where the whole label fits on screen: never a name cut by the edge.
    for (const c of candidates) { const box = { id: it.id, x: c.x, y: c.y, w, h }; if (box.x >= 2 && box.y >= 2 && box.x + w <= view.w - 2 && box.y + h <= view.h - 2 && !hit(box)) { placed.push(box); break; } }
  }
  return placed;
}
/** Indicators with an explicit method (shown to the observer, never to the creature as goals). */
export function indicators(a: Atlas) {
  const count = (t: NodeType) => a.nodes.filter((n) => n.type === t).length;
  const week = Date.now() - 7 * 86400000;
  const applied = new Set(a.edges.filter((e) => ['usa', 'evidência', 'fundamentado em', 'aprendido através de'].includes(e.label)).map((e) => e.target));
  return [
    { label: 'consultas', value: count('consulta'), how: 'perguntas distintas feitas ao mundo (textos normalizados)' },
    { label: 'conhecimentos com fonte', value: count('conhecimento'), how: 'resultados de pesquisa guardados com links' },
    { label: 'conceitos declarados', value: count('conceito'), how: 'ideias que ela registrou com a ação conceito' },
    { label: 'relações dela', value: a.edges.filter((e) => e.origin === 'declarada' || e.origin === 'fonte').length, how: 'ligações declaradas por ela ou fundamentadas em fonte' },
    { label: 'hipóteses abertas', value: a.edges.filter((e) => e.origin === 'hipotese').length, how: 'relações que ela marcou como hipótese' },
    { label: 'usados em algo', value: [...applied].filter((id) => a.nodes.some((n) => n.id === id)).length, how: 'nós citados como evidência por interesses, projetos, obras, experimentos ou habilidades' },
    { label: 'novos em 7 dias', value: a.nodes.filter((n) => n.at >= week).length, how: 'nós cujo primeiro registro tem menos de 7 dias' },
    { label: 'áreas', value: a.clusters.filter((c) => c.id !== 'isolados').length, how: 'grupos encontrados por ligações e termos em comum (não são categorias impostas)' },
  ];
}
