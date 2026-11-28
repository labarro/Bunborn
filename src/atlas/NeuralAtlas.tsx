// Neural Atlas (28/11): an interactive map of what the creature searched, learned, related, used and
// remembered — built from persistent records (shared/atlas.ts). It is NOT the internal network of
// the AI models. Pulses appear only for events the engine actually recorded; the faint drift of
// background stars is decoration and means nothing.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { Crosshair, Expand, Filter, Info, Pause, Play, RotateCcw, Search, X, Radio, History } from 'lucide-react';
import type { Atlas, AtlasEdge, AtlasEvent, AtlasNode, EdgeOrigin, NodeType } from '../../shared/atlas';
import './atlas.css';
import { assignColors, availableModes, clusterColor, indicators, modes, neighbours, originLabel, placeLabels, radiusOf, search, sizeLabel, typeLabel, visibleGraph, type Filters, type Mode, type SizeBy } from './model';

type SimNode = AtlasNode & SimulationNodeDatum & { r: number; color: string };
type SimEdge = SimulationLinkDatum<SimNode> & Omit<AtlasEdge, 'source' | 'target'> & { curve: number };
type Pulse = { id: string; t0: number; kind: AtlasEvent['kind'] | 'novo'; other?: string };
const POS_KEY = 'bunborn-atlas-pos-v1';
const pulseColor: Record<Pulse['kind'], string> = { aquisicao: '#8fe3a8', associacao: '#f2cf7a', recuperacao: '#c8a2ff', aplicacao: '#ff9cc8', revisao: '#ffb98a', novo: '#6fe0e6' };
const eventLabel: Record<AtlasEvent['kind'], string> = { aquisicao: 'aquisição', associacao: 'associação', recuperacao: 'recuperação de memória', aplicacao: 'aplicação', revisao: 'revisão' };
const allTypes: NodeType[] = ['consulta', 'conhecimento', 'conceito', 'interesse', 'projeto', 'obra', 'experimento', 'habilidade', 'procedimento', 'memoria'];
const allOrigins: EdgeOrigin[] = ['declarada', 'fonte', 'motor', 'inferida', 'hipotese'];
const directional = new Set(['usa', 'faz parte de', 'resultou em', 'evidência', 'fundamentado em', 'aprendido através de', 'lembra']);
const loadPos = (): Record<string, [number, number]> => { try { return JSON.parse(localStorage.getItem(POS_KEY) ?? '{}'); } catch { return {}; } };
const savePos = (p: Record<string, [number, number]>) => { try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* private mode: layout just is not remembered */ } };
const hashN = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
const fmt = (n: number) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(n);

function haloSprite(color: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, color + 'aa'); grd.addColorStop(0.25, color + '44'); grd.addColorStop(1, color + '00');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return c;
}
function shapePath(g: CanvasRenderingContext2D, type: NodeType, x: number, y: number, r: number) {
  g.beginPath();
  if (type === 'projeto' || type === 'interesse') { g.moveTo(x, y - r * 1.15); g.lineTo(x + r * 1.15, y); g.lineTo(x, y + r * 1.15); g.lineTo(x - r * 1.15, y); g.closePath(); }
  else if (type === 'obra') g.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
  else if (type === 'experimento') { g.moveTo(x, y - r * 1.2); g.lineTo(x + r * 1.1, y + r * 0.8); g.lineTo(x - r * 1.1, y + r * 0.8); g.closePath(); }
  else if (type === 'habilidade' || type === 'procedimento') { for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i - Math.PI / 6; g[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r * 1.1, y + Math.sin(a) * r * 1.1); } g.closePath(); }
  else g.arc(x, y, r, 0, Math.PI * 2);
}

export function NeuralAtlas({ pollMs = 60000 }: { pollMs?: number } = {}) {
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>('conhecimentos');
  const [sizeBy, setSizeBy] = useState<SizeBy>('conexoes');
  const [filters, setFilters] = useState<Filters>({ types: new Set(allTypes), origins: new Set(allOrigins), showIsolated: true, until: null, query: '' });
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<AtlasEdge | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState<'filtros' | 'legenda' | 'indicadores' | null>(null);
  const [feed, setFeed] = useState<AtlasEvent[]>([]);
  const [replay, setReplay] = useState<{ on: boolean; t: number; playing: boolean; speed: number }>({ on: false, t: 0, playing: false, speed: 1 });
  const [immersive, setImmersive] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sim = useRef<Simulation<SimNode, SimEdge> | null>(null);
  const simNodes = useRef<SimNode[]>([]);
  const simEdges = useRef<SimEdge[]>([]);
  const positions = useRef<Record<string, [number, number]>>(loadPos());
  const cam = useRef({ x: 0, y: 0, k: 1, fitted: false });
  const userMoved = useRef(false);
  const pulses = useRef<Pulse[]>([]);
  const sprites = useRef(new Map<string, HTMLCanvasElement>());
  const stars = useRef<{ x: number; y: number; r: number; p: number }[]>([]);
  const dirty = useRef(true);
  const lastEventAt = useRef(0);
  const knownIds = useRef<Set<string> | null>(null);
  const focus = useRef<{ hover: string | null; selected: string | null; edge: AtlasEdge | null }>({ hover: null, selected: null, edge: null });
  focus.current = { hover, selected, edge: selectedEdge };

  // Data: first load, then every minute (public reads are cached); new events become pulses.
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/atlas', { credentials: 'same-origin' });
      if (!r.ok) throw new Error('http_' + r.status);
      const a = (await r.json()) as Atlas;
      const now = performance.now();
      if (knownIds.current) {
        for (const n of a.nodes) if (!knownIds.current.has(n.id)) pulses.current.push({ id: n.id, t0: now, kind: 'novo' });
        const fresh = a.events.filter((e) => e.at > lastEventAt.current);
        for (const e of fresh) { pulses.current.push({ id: e.nodes[0], t0: now, kind: e.kind, other: e.nodes[1] }); for (const extra of e.nodes.slice(1)) pulses.current.push({ id: extra, t0: now + 300, kind: e.kind }); }
        if (fresh.length) setFeed((f) => [...fresh.reverse(), ...f].slice(0, 12));
      } else setFeed([...a.events].reverse().slice(0, 8));
      assignColors(a.clusters.map((c) => c.id));
      knownIds.current = new Set(a.nodes.map((n) => n.id));
      lastEventAt.current = Math.max(lastEventAt.current, ...a.events.map((e) => e.at), 0);
      setAtlas(a);
      setError('');
    } catch {
      setError('Não foi possível carregar o atlas agora.');
    }
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, pollMs); return () => clearInterval(t); }, [load, pollMs]);

  const modeList = useMemo(() => (atlas ? availableModes(atlas) : modes.slice(0, 1)), [atlas]);
  const effectiveFilters = useMemo(() => ({ ...filters, until: replay.on ? replay.t : null }), [filters, replay.on, replay.t]);
  const graph = useMemo(() => (atlas ? visibleGraph(atlas, mode, effectiveFilters) : null), [atlas, mode, effectiveFilters]);
  const results = useMemo(() => (atlas ? search(atlas, query) : []), [atlas, query]);

  // Simulation: positions survive reloads and filter changes; new nodes start near their neighbours.
  useEffect(() => {
    if (!graph || !atlas) return;
    const prev = new Map(simNodes.current.map((n) => [n.id, n]));
    const clusterRank = new Map(atlas.clusters.map((c, i) => [c.id, i]));
    const anchor = (cid: string | undefined) => {
      if (!cid || cid === 'isolados') { const a = hashN(cid ?? 'x') * Math.PI * 2; return { x: Math.cos(a) * 520, y: Math.sin(a) * 380 }; }
      const i = clusterRank.get(cid) ?? 0; const a = i * 2.399963; const d = 150 * Math.sqrt(i + 0.3);
      return { x: Math.cos(a) * d, y: Math.sin(a) * d * 0.78 };
    };
    const nodes: SimNode[] = graph.nodes.map((n) => {
      const old = prev.get(n.id);
      const saved = positions.current[n.id];
      const anc = anchor(n.cluster);
      const r = radiusOf(n, sizeBy, graph.degree.get(n.id) ?? 0);
      const color = clusterColor(n.cluster);
      if (old) return Object.assign(old, n, { r, color });
      const nb = graph.edges.filter((e) => e.source === n.id || e.target === n.id).map((e) => (e.source === n.id ? e.target : e.source)).map((id) => prev.get(id) ?? (positions.current[id] ? { x: positions.current[id][0], y: positions.current[id][1] } : null)).filter(Boolean) as { x?: number; y?: number }[];
      const x = saved?.[0] ?? (nb.length ? nb.reduce((t, p) => t + (p.x ?? 0), 0) / nb.length + (hashN(n.id) - 0.5) * 30 : anc.x + (hashN(n.id) - 0.5) * 80);
      const y = saved?.[1] ?? (nb.length ? nb.reduce((t, p) => t + (p.y ?? 0), 0) / nb.length + (hashN(n.id + 'y') - 0.5) * 30 : anc.y + (hashN(n.id + 'y') - 0.5) * 80);
      return { ...n, r, color, x, y } as SimNode;
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges: SimEdge[] = graph.edges.map((e) => ({ ...e, source: byId.get(e.source)!, target: byId.get(e.target)!, curve: (hashN(e.id) - 0.5) * 0.5 }));
    const known = nodes.filter((n) => positions.current[n.id] || prev.has(n.id)).length / Math.max(1, nodes.length);
    simNodes.current = nodes; simEdges.current = edges;
    sim.current?.stop();
    const s = forceSimulation<SimNode, SimEdge>(nodes)
      .force('charge', forceManyBody<SimNode>().strength((d) => -70 - d.r * 10).distanceMax(520))
      .force('link', forceLink<SimNode, SimEdge>(edges).id((d) => d.id).distance((e) => (e.origin === 'inferida' ? 110 : e.origin === 'motor' ? 58 : 80)).strength((e) => (e.origin === 'inferida' ? 0.12 : 0.45)))
      .force('collide', forceCollide<SimNode>((d) => d.r + 14).iterations(2))
      .force('x', forceX<SimNode>((d) => anchor(d.cluster).x).strength(0.035))
      .force('y', forceY<SimNode>((d) => anchor(d.cluster).y).strength(0.035))
      .alpha(known > 0.8 ? 0.12 : known > 0.3 ? 0.4 : 1)
      .alphaDecay(0.035)
      .on('tick', () => { dirty.current = true; })
      .on('end', () => { for (const n of nodes) positions.current[n.id] = [Math.round(n.x ?? 0), Math.round(n.y ?? 0)]; savePos(positions.current); if (!userMoved.current) fit(); });
    sim.current = s;
    dirty.current = true;
    return () => { s.stop(); };
  }, [graph, atlas, sizeBy]);

  // Camera helpers.
  const fit = useCallback((ids?: Set<string>) => {
    const cv = canvasRef.current; if (!cv) return;
    const list = simNodes.current.filter((n) => !ids || ids.has(n.id));
    if (!list.length) return;
    const xs = list.map((n) => n.x ?? 0), ys = list.map((n) => n.y ?? 0);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const W = cv.clientWidth, H = cv.clientHeight;
    const k = Math.min(2.4, Math.max(0.15, Math.min(W / (maxX - minX + 160), H / (maxY - minY + 160))));
    Object.assign(cam.current, { x: (minX + maxX) / 2, y: (minY + maxY) / 2, k, fitted: true });
    dirty.current = true;
  }, []);
  const centerOn = useCallback((id: string) => {
    const n = simNodes.current.find((x) => x.id === id); if (!n) return;
    const start = { ...cam.current }, k = Math.max(cam.current.k, 1.4), t0 = performance.now();
    const step = () => { const t = Math.min(1, (performance.now() - t0) / 450), e = 1 - (1 - t) ** 3; cam.current.x = start.x + ((n.x ?? 0) - start.x) * e; cam.current.y = start.y + ((n.y ?? 0) - start.y) * e; cam.current.k = start.k + (k - start.k) * e; dirty.current = true; if (t < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }, []);
  // Fit once, after the first layout settles a little (never on automatic updates).
  useEffect(() => { if (graph && !cam.current.fitted) { const t = setTimeout(() => fit(), 700); return () => clearTimeout(t); } }, [graph, fit]);

  // Render loop.
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const g = cv.getContext('2d')!;
    let raf = 0, lastAmbient = 0;
    const resize = () => { const dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); dirty.current = true; if (!stars.current.length) stars.current = Array.from({ length: 160 }, (_, i) => ({ x: hashN('sx' + i), y: hashN('sy' + i), r: 0.4 + hashN('sr' + i) * 1.1, p: hashN('sp' + i) * Math.PI * 2 })); };
    const ro = new ResizeObserver(resize); ro.observe(cv); resize();
    const sprite = (c: string) => { let s = sprites.current.get(c); if (!s) { s = haloSprite(c); sprites.current.set(c, s); } return s; };
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const animating = pulses.current.length > 0 || (sim.current?.alpha() ?? 0) > (sim.current?.alphaMin() ?? 0.001);
      if (!dirty.current && !animating && now - lastAmbient < 120) return;
      if (!animating && !dirty.current) lastAmbient = now;
      dirty.current = false;
      const W = cv.clientWidth, H = cv.clientHeight, { x: cx, y: cy, k } = cam.current;
      const sx = (x: number) => (x - cx) * k + W / 2, sy = (y: number) => (y - cy) * k + H / 2;
      // Deep sky.
      const bg = g.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
      bg.addColorStop(0, '#1b1640'); bg.addColorStop(0.55, '#110e2a'); bg.addColorStop(1, '#07060f');
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      for (const s of stars.current) { const tw = 0.35 + 0.25 * Math.sin(now / 2400 + s.p); g.fillStyle = `rgba(214,206,255,${tw * 0.55})`; g.fillRect(((s.x * W + cx * 0.02 * k) % W + W) % W, ((s.y * H + cy * 0.02 * k) % H + H) % H, s.r, s.r); }
      const nodes = simNodes.current, edges = simEdges.current;
      // Level of detail: large network seen from afar → plain dots and lines (keeps it fluid).
      const lite = nodes.length > 400 && k < 0.9;
      const f = focus.current;
      const focusId = f.hover ?? f.selected;
      const near = focusId ? neighbours(edges.map((e) => ({ ...e, source: (e.source as SimNode).id, target: (e.target as SimNode).id })), focusId) : null;
      const nowP = performance.now();
      pulses.current = pulses.current.filter((p) => nowP - p.t0 < 2600);
      const pulsing = new Map(pulses.current.filter((p) => nowP >= p.t0).map((p) => [p.id, p]));
      // Synapses: curved, gradient between the two clusters, style by origin.
      for (const e of edges) {
        const a = e.source as SimNode, b = e.target as SimNode;
        const x1 = sx(a.x ?? 0), y1 = sy(a.y ?? 0), x2 = sx(b.x ?? 0), y2 = sy(b.y ?? 0);
        const mx = (x1 + x2) / 2 - (y2 - y1) * e.curve, my = (y1 + y2) / 2 + (x2 - x1) * e.curve;
        const on = !near || (near.has(a.id) && near.has(b.id) && (a.id === focusId || b.id === focusId));
        const isSel = f.edge?.id === e.id;
        const base = e.origin === 'fonte' ? 0.85 : e.origin === 'declarada' ? 0.8 : e.origin === 'hipotese' ? 0.7 : e.origin === 'inferida' ? 0.4 : 0.55;
        g.globalAlpha = isSel ? 1 : on ? (near ? Math.min(1, base + 0.3) : base) : 0.06;
        let stroke: string | CanvasGradient = a.color;
        if (!lite) { const grad = g.createLinearGradient(x1, y1, x2, y2); grad.addColorStop(0, a.color); grad.addColorStop(1, b.color); stroke = grad; }
        g.strokeStyle = e.origin === 'hipotese' ? '#f2cf7a' : stroke;
        g.lineWidth = (e.origin === 'fonte' ? 1.6 : e.origin === 'declarada' ? 1.4 : e.origin === 'hipotese' ? 1.2 : e.origin === 'motor' ? 1.0 : 0.9) * (isSel ? 2 : on && near ? 1.5 : 1) * Math.max(0.7, Math.min(1.6, k));
        g.setLineDash(e.origin === 'inferida' ? [2, 5] : e.origin === 'hipotese' ? [5, 4] : []);
        if (!lite && e.origin !== 'inferida' && e.origin !== 'hipotese') { const lw = g.lineWidth; const a0 = g.globalAlpha; g.lineWidth = lw * 4; g.globalAlpha = a0 * 0.16; g.beginPath(); g.moveTo(x1, y1); g.quadraticCurveTo(mx, my, x2, y2); g.stroke(); g.lineWidth = lw; g.globalAlpha = a0; }
        g.beginPath(); g.moveTo(x1, y1); g.quadraticCurveTo(mx, my, x2, y2); g.stroke();
        if (directional.has(e.label) && (on && near || isSel) && k > 0.6) { const t = 0.72, px = (1 - t) ** 2 * x1 + 2 * (1 - t) * t * mx + t * t * x2, py = (1 - t) ** 2 * y1 + 2 * (1 - t) * t * my + t * t * y2; g.setLineDash([]); g.fillStyle = b.color; g.beginPath(); g.arc(px, py, 1.8, 0, Math.PI * 2); g.fill(); }
        // An association that was just formed travels along its synapse.
        const pa = pulsing.get(a.id);
        if (pa && pa.kind === 'associacao' && pa.other === b.id) { const t = Math.min(1, (nowP - pa.t0) / 1400), px = (1 - t) ** 2 * x1 + 2 * (1 - t) * t * mx + t * t * x2, py = (1 - t) ** 2 * y1 + 2 * (1 - t) * t * my + t * t * y2; g.setLineDash([]); g.globalAlpha = 1 - t * 0.6; g.fillStyle = pulseColor.associacao; g.beginPath(); g.arc(px, py, 3.5, 0, Math.PI * 2); g.fill(); }
      }
      g.setLineDash([]);
      // Neurons: halo, core, shape by type.
      for (const n of nodes) {
        const x = sx(n.x ?? 0), y = sy(n.y ?? 0);
        if (x < -60 || y < -60 || x > W + 60 || y > H + 60) continue;
        const r = Math.max(1.6, n.r * Math.max(0.55, Math.min(1.8, k)));
        const on = !near || near.has(n.id);
        const p = pulsing.get(n.id);
        const appear = p?.kind === 'novo' ? Math.min(1, (nowP - p.t0) / 900) : 1;
        g.globalAlpha = (on ? 1 : 0.12) * appear;
        const hs = r * (n.id === focusId ? 6 : 4.4);
        if (!lite || n.id === focusId || (near && near.has(n.id))) {
          g.drawImage(sprite(n.color), x - hs, y - hs, hs * 2, hs * 2);
          const core = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r * 1.2);
          core.addColorStop(0, '#ffffff'); core.addColorStop(0.35, n.color); core.addColorStop(1, n.color + '99');
          g.fillStyle = core;
        } else g.fillStyle = n.color;
        shapePath(g, n.type, x, y, r * appear); g.fill();
        if (n.type === 'consulta') { g.strokeStyle = n.color; g.lineWidth = 0.8; g.beginPath(); g.arc(x, y, r + 2.6, 0, Math.PI * 2); g.stroke(); }
        if (n.type === 'conceito') { g.strokeStyle = '#ffffffaa'; g.lineWidth = 1; g.beginPath(); g.arc(x, y, r + 2.5, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(x, y, r + 5, 0, Math.PI * 2); g.stroke(); }
        if (n.id === f.selected) { g.strokeStyle = '#ffffff'; g.lineWidth = 1.4; g.beginPath(); g.arc(x, y, r + 7, 0, Math.PI * 2); g.stroke(); }
        if (p && p.kind !== 'novo') { const t = (nowP - p.t0) / 2600; g.globalAlpha = 1 - t; g.strokeStyle = pulseColor[p.kind]; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r + 4 + t * 26, 0, Math.PI * 2); g.stroke(); }
      }
      g.globalAlpha = 1;
      // Labels: contextual, by priority, never overlapping, never cut.
      g.font = '12px "Segoe UI", system-ui, sans-serif';
      const budget = focusId ? 60 : k < 0.7 ? 8 : k < 1.2 ? 18 : k < 2 ? 40 : 90;
      const items = nodes.filter((n) => !near || near.has(n.id)).map((n) => ({ id: n.id, x: sx(n.x ?? 0), y: sy(n.y ?? 0), r: n.r * Math.max(0.55, Math.min(1.8, k)), text: n.label, priority: (n.id === focusId ? 1e6 : 0) + (near?.has(n.id) ? 1e4 : 0) + n.r * 10 + (n.type === 'interesse' || n.type === 'projeto' || n.type === 'conceito' ? 40 : 0) }));
      const placed = placeLabels(items.filter((i) => i.x > -50 && i.x < W + 50 && i.y > -20 && i.y < H + 20), (t) => g.measureText(t).width, budget, { w: W, h: H });
      for (const b of placed) {
        const n = nodes.find((x) => x.id === b.id)!;
        g.fillStyle = 'rgba(10,8,24,0.62)'; g.beginPath(); g.roundRect(b.x, b.y, b.w, b.h, 4); g.fill();
        g.fillStyle = n.id === focusId ? '#ffffff' : '#e9e4ff'; g.fillText(n.label, b.x + 4, b.y + 11.5);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);
  useEffect(() => { dirty.current = true; }, [hover, selected, selectedEdge, sizeBy]);

  // Interaction: pan, zoom, drag nodes, pinch, select nodes or synapses.
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const toWorld = (px: number, py: number) => ({ x: (px - cv.clientWidth / 2) / cam.current.k + cam.current.x, y: (py - cv.clientHeight / 2) / cam.current.k + cam.current.y });
    const nodeAt = (px: number, py: number) => { const w = toWorld(px, py); let best: SimNode | null = null, bd = Infinity; for (const n of simNodes.current) { const d = Math.hypot((n.x ?? 0) - w.x, (n.y ?? 0) - w.y); const lim = (n.r + 6) / Math.min(1, cam.current.k) ; if (d < lim && d < bd) { bd = d; best = n; } } return best; };
    const edgeAt = (px: number, py: number) => { const w = toWorld(px, py); for (const e of simEdges.current) { const a = e.source as SimNode, b = e.target as SimNode; const mx = ((a.x ?? 0) + (b.x ?? 0)) / 2 - ((b.y ?? 0) - (a.y ?? 0)) * e.curve, my = ((a.y ?? 0) + (b.y ?? 0)) / 2 + ((b.x ?? 0) - (a.x ?? 0)) * e.curve; for (let i = 1; i < 12; i++) { const t = i / 12, x = (1 - t) ** 2 * (a.x ?? 0) + 2 * (1 - t) * t * mx + t * t * (b.x ?? 0), y = (1 - t) ** 2 * (a.y ?? 0) + 2 * (1 - t) * t * my + t * t * (b.y ?? 0); if (Math.hypot(x - w.x, y - w.y) < 5 / cam.current.k) return e; } } return null; };
    const pts = new Map<number, { x: number; y: number }>();
    let drag: { kind: 'pan' | 'node'; node?: SimNode; sx: number; sy: number; cx: number; cy: number; moved: boolean } | null = null;
    let pinch = 0;
    const local = (e: PointerEvent | WheelEvent) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const zoomAt = (px: number, py: number, f: number) => { userMoved.current = true; const before = toWorld(px, py); cam.current.k = Math.max(0.12, Math.min(6, cam.current.k * f)); const after = toWorld(px, py); cam.current.x += before.x - after.x; cam.current.y += before.y - after.y; dirty.current = true; };
    const down = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId); const p = local(e); pts.set(e.pointerId, p);
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); drag = null; return; }
      const n = nodeAt(p.x, p.y);
      drag = { kind: n ? 'node' : 'pan', node: n ?? undefined, sx: p.x, sy: p.y, cx: cam.current.x, cy: cam.current.y, moved: false };
      if (n) { n.fx = n.x; n.fy = n.y; sim.current?.alphaTarget(0.15).restart(); }
    };
    const move = (e: PointerEvent) => {
      const p = local(e);
      if (pts.has(e.pointerId)) pts.set(e.pointerId, p);
      if (pts.size === 2 && pinch) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch); pinch = d; return; }
      if (!drag) { const n = nodeAt(p.x, p.y); setHover(n?.id ?? null); cv.style.cursor = n ? 'pointer' : 'grab'; return; }
      if (Math.hypot(p.x - drag.sx, p.y - drag.sy) > 3) drag.moved = true;
      if (drag.kind === 'pan') { userMoved.current = true; cam.current.x = drag.cx - (p.x - drag.sx) / cam.current.k; cam.current.y = drag.cy - (p.y - drag.sy) / cam.current.k; dirty.current = true; cv.style.cursor = 'grabbing'; }
      else if (drag.node) { const w = toWorld(p.x, p.y); drag.node.fx = w.x; drag.node.fy = w.y; }
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId); if (pts.size < 2) pinch = 0;
      if (!drag) return;
      const p = local(e);
      if (drag.node) { drag.node.fx = null; drag.node.fy = null; sim.current?.alphaTarget(0); }
      if (!drag.moved) { if (drag.node) { setSelected(drag.node.id); setSelectedEdge(null); } else { const ed = edgeAt(p.x, p.y); setSelectedEdge(ed ? { ...ed, source: (ed.source as SimNode).id, target: (ed.target as SimNode).id } : null); if (!ed) setSelected(null); } }
      drag = null;
    };
    const wheel = (e: WheelEvent) => { e.preventDefault(); const p = local(e); zoomAt(p.x, p.y, e.deltaY > 0 ? 0.9 : 1.11); };
    cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('wheel', wheel, { passive: false });
    return () => { cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', up); cv.removeEventListener('wheel', wheel); };
  }, []);

  // History replay: nodes and links appear at the time their first record was written.
  useEffect(() => {
    if (!replay.on || !replay.playing || !atlas) return;
    const end = atlas.generatedAt;
    const t = setInterval(() => setReplay((r) => { const span = end - (atlas.bornAt ?? end - 86400000); const nt = Math.min(end, r.t + (span / 240) * r.speed); return { ...r, t: nt, playing: nt < end }; }), 80);
    return () => clearInterval(t);
  }, [replay.on, replay.playing, atlas]);
  const prevVisible = useRef<Set<string>>(new Set());
  useEffect(() => { if (!graph) return; if (replay.on) { const now = performance.now(); for (const n of graph.nodes) if (!prevVisible.current.has(n.id)) pulses.current.push({ id: n.id, t0: now, kind: 'novo' }); } prevVisible.current = new Set(graph.nodes.map((n) => n.id)); }, [graph, replay.on]);

  // Keyboard.
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') { if (e.key === 'Escape') (e.target as HTMLElement).blur(); return; }
    const cv = canvasRef.current; if (!cv) return;
    const zoom = (f: number) => { cam.current.k = Math.max(0.12, Math.min(6, cam.current.k * f)); dirty.current = true; };
    if (e.key === 'Escape') { setSelected(null); setSelectedEdge(null); }
    else if (e.key === '+' || e.key === '=') zoom(1.2);
    else if (e.key === '-') zoom(0.83);
    else if (e.key === '0') fit();
    else if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
    else if (e.key.toLowerCase() === 'f') void toggleFull();
  };
  async function toggleFull() {
    if (document.fullscreenElement) { await document.exitFullscreen(); setImmersive(false); return; }
    await shell.current?.requestFullscreen?.().catch(() => undefined);
    setImmersive(true);
  }
  useEffect(() => { const h = () => { if (!document.fullscreenElement) setImmersive(false); dirty.current = true; }; document.addEventListener('fullscreenchange', h); return () => document.removeEventListener('fullscreenchange', h); }, []);

  const node = atlas?.nodes.find((n) => n.id === selected) ?? null;
  const nodeEdges = node && atlas ? atlas.edges.filter((e) => e.source === node.id || e.target === node.id) : [];
  const nameOf = (id: string) => atlas?.nodes.find((n) => n.id === id)?.label ?? id;
  const toggleSet = <T,>(set: Set<T>, v: T) => { const s = new Set(set); if (s.has(v)) s.delete(v); else s.add(v); return s; };

  if (error && !atlas) return <p className="footnote">{error}</p>;
  return (
    <div className={`atlas${immersive ? ' immersive' : ''}`} ref={shell} tabIndex={0} onKeyDown={onKey} aria-label="Neural Atlas: mapa interativo dos conhecimentos registrados">
      <canvas ref={canvasRef} className="atlas-canvas" role="img" aria-label={`Rede com ${graph?.nodes.length ?? 0} nós e ${graph?.edges.length ?? 0} ligações. Use a busca para navegar pelo teclado.`} />
      <div className="atlas-top">
        <div className="atlas-modes" role="tablist" aria-label="Camadas">
          {modeList.map((m) => <button key={m.id} role="tab" aria-selected={mode === m.id} className={mode === m.id ? 'on' : ''} title={m.hint} onClick={() => setMode(m.id)}>{m.label}</button>)}
        </div>
        <div className="atlas-search">
          <Search size={14} />
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar no atlas  ( / )" aria-label="Buscar conhecimentos" onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { setSelected(results[0].id); centerOn(results[0].id); setQuery(''); } }} />
          {results.length ? (
            <ul className="atlas-results">{results.map((r) => <li key={r.id}><button onClick={() => { setSelected(r.id); centerOn(r.id); setQuery(''); }}><span className="dot" style={{ background: clusterColor(r.cluster) }} />{r.label}<small>{typeLabel[r.type]}</small></button></li>)}</ul>
          ) : null}
        </div>
        <div className="atlas-tools">
          <button onClick={() => fit()} title="Ver a rede inteira (0)" aria-label="Ver a rede inteira"><Crosshair size={15} /></button>
          <button className={panel === 'filtros' ? 'on' : ''} onClick={() => setPanel(panel === 'filtros' ? null : 'filtros')} title="Filtros" aria-label="Filtros"><Filter size={15} /></button>
          <button className={panel === 'legenda' ? 'on' : ''} onClick={() => setPanel(panel === 'legenda' ? null : 'legenda')} title="Legenda e método" aria-label="Legenda"><Info size={15} /></button>
          <button className={replay.on ? 'on' : ''} onClick={() => setReplay((r) => (r.on ? { ...r, on: false, playing: false } : { on: true, t: atlas?.bornAt ?? Date.now(), playing: true, speed: 1 }))} title="Reprodução histórica" aria-label="Reprodução histórica"><History size={15} /></button>
          <button onClick={() => { positions.current = {}; savePos({}); simNodes.current = []; setFilters((f) => ({ ...f })); cam.current.fitted = false; }} title="Reorganizar a rede" aria-label="Reorganizar a rede"><RotateCcw size={15} /></button>
          <button onClick={() => void toggleFull()} title="Tela cheia (F)" aria-label="Tela cheia"><Expand size={15} /></button>
        </div>
      </div>
      {panel === 'filtros' && atlas ? (
        <div className="atlas-panel atlas-filters">
          <strong>Tipos</strong>
          <div className="chips">{allTypes.filter((t) => modes.find((m) => m.id === mode)!.types.includes(t) && atlas.nodes.some((n) => n.type === t)).map((t) => <label key={t}><input type="checkbox" checked={filters.types.has(t)} onChange={() => setFilters((f) => ({ ...f, types: toggleSet(f.types, t) }))} />{typeLabel[t]}</label>)}</div>
          <strong>Origem das ligações</strong>
          <div className="chips">{allOrigins.filter((o) => atlas.edges.some((e) => e.origin === o)).map((o) => <label key={o}><input type="checkbox" checked={filters.origins.has(o)} onChange={() => setFilters((f) => ({ ...f, origins: toggleSet(f.origins, o) }))} />{originLabel[o]}</label>)}</div>
          <label><input type="checkbox" checked={filters.showIsolated} onChange={() => setFilters((f) => ({ ...f, showIsolated: !f.showIsolated }))} /> mostrar nós sem ligações</label>
          <label>Tamanho por <select value={sizeBy} onChange={(e) => setSizeBy(e.target.value as SizeBy)}>{(Object.keys(sizeLabel) as SizeBy[]).map((s) => <option key={s} value={s}>{sizeLabel[s]}</option>)}</select></label>
          <button className="text-button" onClick={() => { setFilters({ types: new Set(allTypes), origins: new Set(allOrigins), showIsolated: true, until: null, query: '' }); setSizeBy('conexoes'); }}>Restaurar padrão</button>
        </div>
      ) : null}
      {panel === 'legenda' && atlas ? (
        <div className="atlas-panel atlas-legend">
          <p className="atlas-note">{atlas.notes[0]}</p>
          <strong>Áreas (surgem das ligações, não são categorias impostas)</strong>
          <ul>{atlas.clusters.slice(0, 10).map((c) => <li key={c.id}><button onClick={() => { const ids = new Set(atlas.nodes.filter((n) => n.cluster === c.id).map((n) => n.id)); fit(ids); }}><span className="dot" style={{ background: clusterColor(c.id) }} />{c.label} <small>{c.size}</small></button></li>)}</ul>
          <strong>Ligações</strong>
          <ul className="lines">
            <li><i className="l fonte" />fundamentada em fonte</li><li><i className="l declarada" />declarada por ela</li><li><i className="l motor" />registrada pelo motor</li><li><i className="l hipotese" />hipótese</li><li><i className="l inferida" />inferida pelo sistema (semelhança de termos; não é uma associação dela)</li>
          </ul>
          <strong>Formas</strong>
          <p className="atlas-note">● consulta (com anel), conhecimento, memória · ◎ conceito · ◆ interesse/projeto · ■ obra · ▲ experimento · ⬡ habilidade/procedimento</p>
          <p className="atlas-note">Tamanho: {sizeLabel[sizeBy]}.</p>
          <strong>Indicadores</strong>
          <ul className="ind">{indicators(atlas).map((i) => <li key={i.label} title={i.how}><b>{i.value}</b> {i.label}<small>{i.how}</small></li>)}</ul>
          {atlas.notes.slice(1).map((n, i) => <p key={i} className="atlas-note">{n}</p>)}
        </div>
      ) : null}
      <div className="atlas-live" aria-live="polite">
        <span className="live-dot"><Radio size={12} /> atividade registrada</span>
        {feed.slice(0, 3).map((e, i) => <button key={i} onClick={() => { setSelected(e.nodes[0]); centerOn(e.nodes[0]); }} title={`${eventLabel[e.kind]}: ${e.label} · ${fmt(e.at)}`}><span className="dot" style={{ background: pulseColor[e.kind] }} /><span className="t">{eventLabel[e.kind]}: {e.label}</span></button>)}
        {!feed.length ? <small>Nenhum evento cognitivo recente.</small> : null}
      </div>
      {replay.on && atlas ? (
        <div className="atlas-replay">
          <button onClick={() => setReplay((r) => ({ ...r, playing: !r.playing, t: r.t >= atlas.generatedAt ? atlas.bornAt ?? r.t : r.t }))} aria-label={replay.playing ? 'Pausar' : 'Reproduzir'}>{replay.playing ? <Pause size={14} /> : <Play size={14} />}</button>
          <input type="range" min={atlas.bornAt ?? atlas.generatedAt - 86400000} max={atlas.generatedAt} value={replay.t} onChange={(e) => setReplay((r) => ({ ...r, t: Number(e.target.value), playing: false }))} aria-label="Momento da história" />
          <select value={replay.speed} onChange={(e) => setReplay((r) => ({ ...r, speed: Number(e.target.value) }))} aria-label="Velocidade">{[1, 2, 4, 8].map((s) => <option key={s} value={s}>{s}×</option>)}</select>
          <span>{fmt(replay.t)}{atlas.bornAt ? ` · dia real ${Math.floor((replay.t - atlas.bornAt) / 86400000) + 1}` : ''}</span>
          <button onClick={() => setReplay({ on: false, t: 0, playing: false, speed: 1 })} aria-label="Voltar ao presente"><X size={14} /></button>
        </div>
      ) : null}
      {node ? (
        <aside className="atlas-detail" aria-label="Detalhes do nó">
          <button className="close" onClick={() => setSelected(null)} aria-label="Fechar"><X size={16} /></button>
          <span className="kind" style={{ color: clusterColor(node.cluster) }}>{typeLabel[node.type]}{node.cluster && node.cluster !== 'isolados' ? ` · ${atlas?.clusters.find((c) => c.id === node.cluster)?.label ?? ''}` : ''}</span>
          <h3>{node.label}</h3>
          <p className="meta">{node.origin} · primeiro registro {fmt(node.at)}{node.updated !== node.at ? ` · atualizado ${fmt(node.updated)}` : ''}</p>
          {node.description ? <p className="desc">{node.description}</p> : <p className="desc muted">Ainda não há descrição registrada para este nó.</p>}
          <ul className="facts">
            {node.occurrences ? <li>Consultada {node.occurrences}×{node.aliases.length > 1 ? ` (formas: ${node.aliases.join(' · ')})` : ''}</li> : null}
            {node.retrievals ? <li>Lembrada {node.retrievals}×</li> : null}
            {node.confidence !== null && node.type !== 'consulta' ? <li>Confiança registrada: {Math.round(node.confidence * 100)}%</li> : null}
            {node.status ? <li>Estado: {node.status}</li> : null}
          </ul>
          {node.sources.length ? (<><strong>Fontes</strong><ul className="sources">{node.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a></li>)}</ul></>) : null}
          {nodeEdges.length ? (<><strong>Ligações</strong><ul className="links">{nodeEdges.map((e) => { const other = e.source === node.id ? e.target : e.source; return <li key={e.id}><button onClick={() => { setSelected(other); centerOn(other); }}><i className={`l ${e.origin}`} />{e.source === node.id ? '' : '← '}{e.label} {e.source === node.id ? '→ ' : ''}<b>{nameOf(other)}</b><small>{originLabel[e.origin]}</small></button></li>; })}</ul></>) : <p className="muted">Sem ligações registradas. Nós isolados são válidos.</p>}
        </aside>
      ) : selectedEdge && atlas ? (
        <aside className="atlas-detail" aria-label="Detalhes da ligação">
          <button className="close" onClick={() => setSelectedEdge(null)} aria-label="Fechar"><X size={16} /></button>
          <span className="kind">Ligação · {originLabel[selectedEdge.origin]}</span>
          <h3>{nameOf(selectedEdge.source)} <span className="muted">{selectedEdge.label}</span> {nameOf(selectedEdge.target)}</h3>
          <p className="meta">Desde {fmt(selectedEdge.at)}</p>
          {selectedEdge.origin === 'inferida' ? <p className="desc">Calculada pelo sistema por semelhança de termos. Não é uma associação que ela fez.</p> : selectedEdge.origin === 'hipotese' ? <p className="desc">Ela marcou esta relação como hipótese: ainda não confirmada.</p> : null}
          <p><button className="text-button" onClick={() => { setSelected(selectedEdge.source); centerOn(selectedEdge.source); }}>Ir para {nameOf(selectedEdge.source)}</button> · <button className="text-button" onClick={() => { setSelected(selectedEdge.target); centerOn(selectedEdge.target); }}>Ir para {nameOf(selectedEdge.target)}</button></p>
        </aside>
      ) : null}
      {hover && hover !== selected && atlas ? <div className="atlas-hover">{nameOf(hover)} <small>{typeLabel[atlas.nodes.find((n) => n.id === hover)?.type ?? 'consulta']}</small></div> : null}
    </div>
  );
}
