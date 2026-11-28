// Development-only harness (atlas-preview.html): feeds the Atlas with a local fixture instead of
// /api/atlas. ?data=lumi uses the real graph built from a backup (preview-data/, git-ignored);
// ?data=sintetico&n=600 builds an explicitly SYNTHETIC large graph for scale tests.
import { createRoot } from 'react-dom/client';
import { NeuralAtlas } from './NeuralAtlas';
import type { Atlas, AtlasNode } from '../../shared/atlas';
const q = new URLSearchParams(location.search);
function synthetic(n: number): Atlas {
  const types = ['consulta', 'conhecimento', 'conceito', 'memoria'] as const;
  const now = Date.now();
  const nodes: AtlasNode[] = Array.from({ length: n }, (_, i) => ({ id: 'syn:' + i, type: types[i % 4], label: `SINTÉTICO ${i} · tema ${i % 12}`, description: 'Nó sintético de teste de escala (não pertence à Lumi).', at: now - (n - i) * 600000, updated: now, virtualAt: 0, sources: [], evidence: [], aliases: [], confidence: null, status: null, retrievals: i % 7, occurrences: 1, cluster: 'g:tema' + (i % 12), origin: 'sintético', recordIds: [] }));
  const edges = nodes.flatMap((nd, i) => [i - 1, i - 12, i - 3].filter((j) => j >= 0 && (j % 12 === i % 12 || j === i - 1)).map((j) => ({ id: `${nd.id}|syn:${j}`, source: nd.id, target: 'syn:' + j, label: 'relacionado (sintético)', origin: (['declarada', 'fonte', 'motor', 'inferida', 'hipotese'] as const)[i % 5], at: nd.at })));
  return { nodes, edges, clusters: Array.from({ length: 12 }, (_, i) => ({ id: 'g:tema' + i, label: 'tema sintético ' + i, size: Math.ceil(n / 12) })), events: [], generatedAt: now, bornAt: now - n * 600000, notes: ['DADOS SINTÉTICOS de teste de escala.'] };
}
const data = q.get('data') ?? 'lumi';
const real = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).includes('/api/atlas')) {
    if (data === 'sintetico') return Response.json(synthetic(Number(q.get('n') ?? 600)));
    const a = (await (await real('/preview-data/atlas-lumi.json')).json()) as Atlas;
    if (data === 'pequeno') { const keep = new Set(a.nodes.filter((x) => x.type === 'consulta' || x.type === 'conhecimento').slice(0, 10).map((x) => x.id)); return Response.json({ ...a, nodes: a.nodes.filter((x) => keep.has(x.id)), edges: a.edges.filter((e) => keep.has(e.source) && keep.has(e.target)) }); }
    // ?live=1 (preview only): from the second poll on, one recall event of an existing memory is added, to review the pulse effect.
    if (q.get('live') && (window as unknown as { __polls?: number }).__polls) { const m = a.nodes.find((x) => x.type === 'conhecimento')!; a.events.push({ at: Date.now(), kind: 'recuperacao', nodes: [m.id], label: 'PRÉVIA: evento de teste em ' + m.label }); }
    (window as unknown as { __polls?: number }).__polls = ((window as unknown as { __polls?: number }).__polls ?? 0) + 1;
    return Response.json(a);
  }
  return real(input, init);
}) as typeof fetch;
if (q.get('clearpos')) localStorage.removeItem('bunborn-atlas-pos-v1');
createRoot(document.getElementById('root')!).render(<NeuralAtlas pollMs={q.get('live') ? 2500 : 60000} />);
setTimeout(() => { document.title = 'ready'; }, Number(q.get('wait') ?? 4500));
