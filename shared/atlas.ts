// Neural Atlas (28/11): the knowledge graph of the Bunborn, built ONLY from persistent records.
// It is not the internal network of any AI model: it shows what the creature searched, learned,
// related, used and experienced, with the origin of every node and every link. Nothing is invented
// to fill the map: isolated nodes stay isolated, and links inferred by the system are marked so.
import type { RecordEntry } from './domain.ts';
import { contentWords, jaccard, normalize } from './similarity.ts';

export type NodeType = 'consulta' | 'conhecimento' | 'conceito' | 'interesse' | 'projeto' | 'obra' | 'experimento' | 'habilidade' | 'procedimento' | 'memoria';
/** Who or what establishes a link: her (declared), a consulted source, the engine's own records, the system's inference, or an open hypothesis. */
export type EdgeOrigin = 'declarada' | 'fonte' | 'motor' | 'inferida' | 'hipotese';
export type AtlasNode = {
  id: string; type: NodeType; label: string; description: string | null;
  at: number; updated: number; virtualAt: number;
  sources: { title: string; url: string }[]; evidence: string[]; aliases: string[];
  confidence: number | null; status: string | null; retrievals: number; occurrences: number; cluster?: string;
  origin: string; recordIds: string[];
};
export type AtlasEdge = { id: string; source: string; target: string; label: string; origin: EdgeOrigin; at: number };
export type AtlasEvent = { at: number; kind: 'aquisicao' | 'associacao' | 'recuperacao' | 'aplicacao' | 'revisao'; nodes: string[]; label: string };
export type Atlas = { nodes: AtlasNode[]; edges: AtlasEdge[]; clusters: { id: string; label: string; size: number }[]; events: AtlasEvent[]; generatedAt: number; bornAt: number | null; notes: string[] };

const safeUrl = (u: unknown) => { try { const x = new URL(String(u)); return x.protocol === 'https:' || x.protocol === 'http:' ? x.toString() : null; } catch { return null; } };
const clean = (t: unknown, n = 400) => String(t ?? '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, n);
/** A short name for long texts, cut only between words (the full text stays in the description). */
const short = (t: unknown, n: number) => { const c = clean(t, 2000); if (c.length <= n) return c; const cut = c.slice(0, n); const at = cut.lastIndexOf(' '); return (at > n * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,;:.—-]+$/, '') + '…'; };
const latestBy = (rows: RecordEntry[]) => { const m = new Map<string, RecordEntry>(); for (const r of rows) m.set(r.entityId, r); return [...m.values()]; };

/**
 * Builds the graph. `records` are stored records (any order); `retrievals` maps memory id → times
 * recalled. Older searches were also saved as "conceito" (one per query, 24–26/11): those are shown
 * as the queries they are, never as concepts she declared.
 */
export function buildAtlas(records: RecordEntry[], retrievals: Map<string, { count: number; last_at: number }> = new Map(), now = Date.now()): Atlas {
  const rows = [...records].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || a.realAt - b.realAt);
  const nodes = new Map<string, AtlasNode>();
  const byRecord = new Map<string, string>(); // record id or entity id → node id
  const edges = new Map<string, AtlasEdge>();
  const node = (id: string, init: Omit<AtlasNode, 'id' | 'sources' | 'evidence' | 'aliases' | 'retrievals' | 'occurrences' | 'recordIds'> & Partial<AtlasNode>) => {
    const prev = nodes.get(id);
    if (prev) return prev;
    const n: AtlasNode = { id, sources: [], evidence: [], aliases: [], retrievals: 0, occurrences: 0, recordIds: [], ...init };
    nodes.set(id, n);
    return n;
  };
  const link = (r: RecordEntry, id: string) => { byRecord.set(r.id, id); byRecord.set(r.entityId, id); };
  const edge = (source: string, target: string, label: string, origin: EdgeOrigin, at: number) => {
    if (!nodes.has(source) || !nodes.has(target) || source === target) return;
    const id = `${source}|${target}|${label}`;
    if (!edges.has(id)) edges.set(id, { id, source, target, label, origin, at });
  };
  const addSources = (n: AtlasNode, list: unknown) => {
    for (const s of (Array.isArray(list) ? list : []) as { title?: unknown; url?: unknown }[]) {
      const url = safeUrl(typeof s === 'string' ? s : s?.url);
      if (url && !n.sources.some((x) => x.url === url) && n.sources.length < 8) n.sources.push({ title: clean(typeof s === 'string' ? s : s?.title ?? url, 140), url });
    }
  };

  // 1. Queries (the questions she asked the world), grouped by their normalized text.
  for (const r of rows.filter((x) => x.kind === 'pesquisa')) {
    const q = clean(r.data.query, 160);
    if (!q) continue;
    const id = 'q:' + normalize(q);
    const n = node(id, { type: 'consulta', label: q, description: null, at: r.realAt, updated: r.realAt, virtualAt: r.virtualAt, confidence: null, status: null, origin: 'pesquisa externa' });
    n.occurrences++; n.updated = r.realAt; n.recordIds.push(r.id);
    if (!n.aliases.includes(q)) n.aliases.push(q);
    addSources(n, r.data.results);
    link(r, id);
  }
  // Legacy query-concepts (one "conceito" per query): they are queries.
  for (const r of rows.filter((x) => x.kind === 'conceito' && x.data.researchId)) {
    const id = 'q:' + normalize(r.content);
    const n = node(id, { type: 'consulta', label: clean(r.content, 160), description: null, at: r.realAt, updated: r.realAt, virtualAt: r.virtualAt, confidence: null, status: null, origin: 'pesquisa externa' });
    if (!n.aliases.includes(clean(r.content, 160))) n.aliases.push(clean(r.content, 160));
    addSources(n, r.data.sources);
    link(r, id);
  }
  // 2. Knowledge with sources: what came back from a search, kept as a memory with its sources.
  for (const r of rows.filter((x) => x.kind === 'memoria' && x.data.status === 'fonte_consultada' && x.data.query)) {
    const q = 'q:' + normalize(clean(r.data.query, 160));
    const first = ((r.data.sources ?? []) as { title?: string }[])[0]?.title;
    const id = 'k:' + normalize(clean(r.data.query, 160)) + ':' + normalize(clean(first ?? r.content.slice(0, 40), 60));
    const n = node(id, { type: 'conhecimento', label: short(first ?? r.content.split(':')[0], 90), description: clean(r.content, 600), at: r.realAt, updated: r.realAt, virtualAt: r.virtualAt, confidence: r.confidence, status: 'fonte consultada', origin: 'resultado de pesquisa' });
    n.updated = r.realAt; n.recordIds.push(r.id);
    n.retrievals += retrievals.get(r.id)?.count ?? 0;
    addSources(n, r.data.sources);
    link(r, id);
    edge(q, id, 'resultou em', 'motor', r.realAt);
  }
  // 3. Concepts she declared (conceito without a research id), latest version per concept.
  for (const r of latestBy(rows.filter((x) => x.kind === 'conceito' && !x.data.researchId))) {
    const id = 'c:' + r.entityId;
    const first = rows.find((x) => x.entityId === r.entityId);
    node(id, { type: 'conceito', label: clean(r.data.nome ?? r.content, 120), description: clean(r.data.descricao ?? r.data.description, 600) || null, at: first?.realAt ?? r.realAt, updated: r.realAt, virtualAt: first?.virtualAt ?? r.virtualAt, confidence: r.confidence, status: clean(r.data.status, 40) || null, origin: 'declarado por ela', evidence: (r.data.evidence ?? r.associations ?? []) as string[], aliases: ((r.data.aliases ?? []) as string[]).map((a) => clean(a, 80)) });
    link(r, id);
  }
  // 4. Interests, projects, works, experiments, skills, procedures (latest version each).
  const entityNodes: [string, NodeType, string, (r: RecordEntry) => string | null][] = [
    ['interesse', 'interesse', 'i:', (r) => clean(r.data.status, 30) || null],
    ['projeto', 'projeto', 'p:', (r) => clean(r.data.status, 30) || null],
    ['artefato', 'obra', 'o:', (r) => clean((r.data.artifact as { format?: string } | undefined)?.format, 20) || null],
    ['experimento', 'experimento', 'e:', (r) => clean(r.data.status, 30) || null],
    ['habilidade', 'habilidade', 'h:', () => 'declarada por ela'],
    ['procedimento', 'procedimento', 'f:', (r) => clean(r.data.contexto, 30) || null],
  ];
  for (const [kind, type, prefix, status] of entityNodes)
    for (const r of latestBy(rows.filter((x) => x.kind === kind))) {
      const first = rows.find((x) => x.entityId === r.entityId);
      const id = prefix + r.entityId;
      const desc = kind === 'experimento' ? `Pergunta: ${clean(r.data.pergunta, 160)}. Hipótese: ${clean(r.data.hipotese, 160)}.${r.data.conclusao ? ' Conclusão dela: ' + clean(r.data.conclusao, 300) : ''}` : kind === 'habilidade' ? clean(r.data.descricao, 300) : kind === 'procedimento' ? ((r.data.passos ?? []) as string[]).map((p, i) => `${i + 1}. ${clean(p, 120)}`).join(' ') : kind === 'artefato' ? clean(r.data.motivation, 300) || null : kind === 'projeto' ? ((r.data.steps ?? []) as string[]).map((p) => clean(p, 80)).join(' · ') : null;
      node(id, { type, label: short(r.data.topic ?? r.data.title ?? r.data.nome ?? r.data.titulo ?? r.data.pergunta ?? r.content, 120), description: desc || null, at: first?.realAt ?? r.realAt, updated: r.realAt, virtualAt: first?.virtualAt ?? r.virtualAt, confidence: r.confidence ?? null, status: status(r), origin: kind === 'artefato' ? 'obra dela' : 'registrado por ela', evidence: (r.data.evidence ?? []) as string[] });
      for (const v of rows.filter((x) => x.entityId === r.entityId)) link(v, id);
    }
  // 5. Memories that matter to the graph: cited as evidence, or among the most recalled.
  const cited = new Set([...nodes.values()].flatMap((n) => n.evidence));
  const memRows = rows.filter((x) => x.kind === 'memoria' && x.data.status !== 'fonte_consultada' && x.origin === 'criatura');
  const top = new Set([...memRows].sort((a, b) => (retrievals.get(b.id)?.count ?? 0) - (retrievals.get(a.id)?.count ?? 0)).slice(0, 24).map((r) => r.id));
  for (const r of memRows) {
    if (!cited.has(r.id) && !top.has(r.id)) continue;
    const id = 'm:' + r.id;
    node(id, { type: 'memoria', label: short(r.content, 70), description: clean(r.content, 600), at: r.realAt, updated: r.realAt, virtualAt: r.virtualAt, confidence: r.confidence, status: r.category, origin: 'memória dela', retrievals: retrievals.get(r.id)?.count ?? 0 });
    link(r, id);
  }
  // 6. Links with an identifiable origin.
  const resolve = (ref: string) => byRecord.get(ref) ?? byRecord.get(ref.replace(/^[a-z]+:/, '')) ?? null;
  for (const n of nodes.values())
    for (const ev of n.evidence) {
      const target = resolve(ev);
      if (!target) continue;
      const t = nodes.get(target)!;
      edge(n.id, target, n.type === 'conceito' ? (t.type === 'conhecimento' ? 'fundamentado em' : 'aprendido através de') : n.type === 'obra' || n.type === 'projeto' || n.type === 'experimento' ? 'usa' : 'evidência', t.type === 'conhecimento' ? 'fonte' : 'declarada', n.at);
    }
  for (const r of latestBy(rows.filter((x) => x.kind === 'artefato' && x.data.projectId))) {
    const p = resolve(String(r.data.projectId));
    if (p) edge('o:' + r.entityId, p, 'faz parte de', 'motor', r.realAt);
  }
  for (const r of latestBy(rows.filter((x) => x.kind === 'relacao'))) {
    const a = resolve(String(r.data.from)), b = resolve(String(r.data.to));
    if (a && b) edge(a, b, clean(r.content, 60), r.data.status === 'fonte_consultada' ? 'fonte' : r.data.status === 'hipotese' ? 'hipotese' : 'declarada', r.realAt);
  }
  for (const r of memRows) {
    const id = 'm:' + r.id;
    if (!nodes.has(id)) continue;
    for (const ref of r.associations) { const t = resolve(ref); if (t && t !== id) edge(id, t, 'lembra', 'motor', r.realAt); }
  }
  // 7. System inference (marked as such): queries/concepts that share most of their words.
  const textual = [...nodes.values()].filter((n) => n.type === 'consulta' || n.type === 'conceito');
  const words = new Map(textual.map((n) => [n.id, contentWords(n.label)]));
  for (const n of textual) {
    const best = textual.filter((m) => m.id < n.id || m.id > n.id).map((m) => ({ m, s: jaccard(words.get(n.id)!, words.get(m.id)!) })).filter((x) => x.s >= 0.34 && x.m.id !== n.id).sort((a, b) => b.s - a.s).slice(0, 2);
    for (const { m } of best) if (!edges.has(`${m.id}|${n.id}|termos em comum`)) edge(n.id, m.id, 'termos em comum', 'inferida', Math.max(n.at, m.at));
  }
  // 8. Thematic clusters (deterministic). Queries, their results and concepts that are linked or
  // share most words are first joined (union-find); the rest follow their neighbours by label
  // propagation. A cluster is named after its most connected member, with the original words.
  const ids = [...nodes.keys()].sort();
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (x: string): string => { const p = parent.get(x)!; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
  const textualTypes = new Set<NodeType>(['consulta', 'conhecimento', 'conceito']);
  for (const e of edges.values()) if (textualTypes.has(nodes.get(e.source)!.type) && textualTypes.has(nodes.get(e.target)!.type)) { const a2 = find(e.source), b2 = find(e.target); if (a2 !== b2) parent.set(a2 < b2 ? b2 : a2, a2 < b2 ? a2 : b2); }
  const label = new Map(ids.map((id) => [id, find(id)]));
  const adj = new Map(ids.map((id) => [id, [] as { to: string; w: number }[]]));
  for (const e of edges.values()) { const w = e.origin === 'inferida' ? 0.6 : 1; adj.get(e.source)!.push({ to: e.target, w }); adj.get(e.target)!.push({ to: e.source, w }); }
  const sizeOf = () => { const m = new Map<string, number>(); for (const l of label.values()) m.set(l, (m.get(l) ?? 0) + 1); return m; };
  for (let it = 0; it < 12; it++) {
    let changed = false;
    const sizes = sizeOf();
    for (const id of ids) {
      if (textualTypes.has(nodes.get(id)!.type) && find(id) !== id && adj.get(id)!.length) { /* joined above; may still move with neighbours */ }
      const score = new Map<string, number>();
      for (const { to, w } of adj.get(id)!) score.set(label.get(to)!, (score.get(label.get(to)!) ?? 0) + w);
      if (!score.size) continue;
      const best = [...score].sort((a2, b2) => b2[1] - a2[1] || (sizes.get(b2[0]) ?? 0) - (sizes.get(a2[0]) ?? 0) || (a2[0] < b2[0] ? -1 : 1))[0][0];
      if (best !== label.get(id)) { label.set(id, best); changed = true; }
    }
    if (!changed) break;
  }
  const groups = new Map<string, string[]>();
  for (const id of ids) (groups.get(label.get(id)!) ?? groups.set(label.get(id)!, []).get(label.get(id)!)!).push(id);
  const degree = (id: string) => adj.get(id)!.length;
  const prefer: Record<NodeType, number> = { interesse: 6, projeto: 5, conceito: 5, consulta: 4, habilidade: 4, experimento: 3, procedimento: 3, conhecimento: 2, obra: 1, memoria: 0 };
  const clusters: Atlas['clusters'] = [];
  for (const [, members] of groups) {
    if (members.length < 2) { for (const m of members) nodes.get(m)!.cluster = 'isolados'; continue; }
    // Named after a central member; memories and works name a group only if nothing else is there.
    const score = (id: string) => prefer[nodes.get(id)!.type] * 2 + Math.min(degree(id), 6) * 0.5;
    const head = [...members].sort((a2, b2) => score(b2) - score(a2) || (a2 < b2 ? -1 : 1))[0];
    // Whole words only, up to ~38 characters.
    const words2 = nodes.get(head)!.label.split(/[:—–(]/)[0].trim().split(/\s+/);
    let name = '';
    for (const w of words2) { if ((name + ' ' + w).trim().length > 38) break; name = (name + ' ' + w).trim(); }
    if (!name) name = words2[0];
    const id = 'g:' + normalize(head);
    for (const m of members) nodes.get(m)!.cluster = id;
    clusters.push({ id, label: name, size: members.length });
  }
  clusters.sort((a2, b2) => b2.size - a2.size);
  // 9. Cognitive events actually recorded (last 3 days): acquisitions, associations, applications, revisions, recalls.
  const since = now - 3 * 86400000;
  const events: AtlasEvent[] = [];
  for (const r of rows.filter((x) => x.realAt >= since)) {
    const id = byRecord.get(r.id);
    if (r.kind === 'pesquisa' && id) events.push({ at: r.realAt, kind: 'aquisicao', nodes: [id], label: 'pesquisou ' + clean(r.data.query, 80) });
    else if (r.kind === 'memoria' && r.data.status === 'fonte_consultada' && id) events.push({ at: r.realAt, kind: 'aquisicao', nodes: [id], label: 'registrou o que encontrou' });
    else if (r.kind === 'relacao') { const a = resolve(String(r.data.from)), b = resolve(String(r.data.to)); if (a && b) events.push({ at: r.realAt, kind: 'associacao', nodes: [a, b], label: 'relacionou: ' + clean(r.content, 60) }); }
    else if (r.kind === 'conceito' && !r.data.researchId && id) events.push({ at: r.realAt, kind: Number(r.data.version ?? 1) > 1 ? 'revisao' : 'aquisicao', nodes: [id], label: 'conceito: ' + clean(r.content, 60) });
    else if (['artefato', 'projeto', 'experimento', 'habilidade', 'procedimento'].includes(r.kind) && id) {
      const used = ((r.data.evidence ?? []) as string[]).map(resolve).filter((x): x is string => !!x);
      events.push({ at: r.realAt, kind: used.length ? 'aplicacao' : 'revisao', nodes: [id, ...used], label: `${r.kind}: ${clean(r.content, 60)}` });
    }
  }
  for (const [mem, st] of retrievals) if (st.last_at >= since) { const id = byRecord.get(mem); if (id && nodes.has(id)) events.push({ at: st.last_at, kind: 'recuperacao', nodes: [id], label: 'lembrou: ' + nodes.get(id)!.label.slice(0, 60) }); }
  events.sort((a, b) => a.at - b.at);
  return {
    nodes: [...nodes.values()], edges: [...edges.values()], clusters, events: events.slice(-200), generatedAt: now, bornAt: rows.find((r) => r.kind === 'nascimento')?.realAt ?? null,
    notes: [
      'Mapa dos registros persistentes do Bunborn; não é a rede neural interna de nenhum modelo de IA.',
      'Consultas antigas também foram gravadas como "conceito" (uma por busca); aparecem como consultas.',
      'Ligações "inferida" são semelhanças textuais calculadas pelo sistema, não associações que ela fez.',
      'Recuperações de memória mostram apenas a última vez em que cada memória foi lembrada (o histórico completo de recuperações não era registrado).',
    ],
  };
}
