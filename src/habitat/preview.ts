// Development-only harness for visual review (preview.html): a disposable fixture state, never the
// real creature. Query: ?vm=<virtual minutes>&weather=<condition>&activity=<kind>&target=<id>&x=&y=
// &mode=geral|acompanhar&room=<id>&zoom=<factor>&fur=<hex>&expose=1&garden=1
import { born, type State } from '../../shared/domain';
import { approach } from '../../shared/house';
import type { Condition } from '../../shared/world';
import { createHabitat } from '../habitat';
const q = new URLSearchParams(location.search);
const s: State = born(Date.now());
s.identity.name = 'Fixture';
s.paused = true;
s.virtualMinutes = Number(q.get('vm') ?? 600);
if (q.get('fur')) s.identity.traits.aparencia = { value: '#' + q.get('fur'), evidence: ['fixture'], version: 1 };
const activity = q.get('activity');
if (activity) {
  const target = q.get('target') ?? { comer: 'comida', beber: 'comida', dormir: 'cama', higiene: 'higiene', descansar: 'sofa', observar: 'janela_estudio', pesquisar: 'terminal', criar: 'atelie', diario: 'diario', organizar: 'bau', jardinar: 'canteiro_1', tocar: 'sofa' }[activity] ?? 'descanso';
  s.activity = { kind: activity, until: s.virtualMinutes + 60, target, intention: 'Fixture de revisão visual.' };
  const o = s.objects.find((x) => x.id === target);
  if (o) { const path = approach(s.position, o, s.objects); if (path.length) s.position = path[path.length - 1]; }
}
if (q.get('x')) s.position = { x: Number(q.get('x')), y: Number(q.get('y')) };
const works: Record<string, never> = {};
if (q.get('expose')) {
  const art = { format: 'pintura', width: 64, height: 64, background: '#f5f0e8', strokes: [
    { tool: 'pincel', color: '#2d5a27', size: 2, points: [{ x: 32, y: 60 }, { x: 32, y: 10 }] },
    ...[18, 26, 34, 42].flatMap((y, i) => [{ tool: 'pincel', color: ['#3a7d32', '#4ab840', '#5cd650', '#6ee062'][i], size: 2, points: [{ x: 32, y: y + 10 }, { x: 14 + i * 2, y }] }, { tool: 'pincel', color: ['#3a7d32', '#4ab840', '#5cd650', '#6ee062'][i], size: 2, points: [{ x: 32, y: y + 10 }, { x: 50 - i * 2, y }] }]),
  ] };
  for (const id of ['atelie', 'quadro_sala', 'estante', 'quadro_estudio']) { const o = s.objects.find((x) => x.id === id)!; o.artifactId = 'artefato:fixture-' + id; (works as Record<string, unknown>)[o.artifactId] = { title: 'Samambaia (fixture)', artifact: art, version: 1, realAt: Date.now() }; }
}
if (q.get('garden')) s.house = { version: 2, garden: { canteiro_1: { species: 'tomate', plantedAt: s.virtualMinutes - 80 * 60, waterings: [s.virtualMinutes - 60] }, canteiro_2: { species: 'girassol', plantedAt: s.virtualMinutes - 30 * 60, waterings: [s.virtualMinutes - 60] }, canteiro_3: { species: 'alface', plantedAt: s.virtualMinutes - 300, waterings: [] } } };
const host = document.getElementById('host')!;
const { scene, game } = createHabitat(host, { onSelect: (o) => console.log('select', o.id), onRabbit: () => console.log('rabbit'), onMode: () => undefined });
game.events.once('ready', () => {
  scene.setDebug({ vm: s.virtualMinutes, weather: (q.get('weather') as Condition) ?? undefined, events: q.get('events') ? q.get('events')!.split(',') : undefined });
  scene.apply(s, works);
  if (q.get('room')) scene.focusRoom(q.get('room')!);
  else if (q.get('mode') === 'acompanhar') scene.setMode('acompanhar');
  if (q.get('zoom')) scene.zoomBy(Number(q.get('zoom')));
  setTimeout(() => { document.title = 'ready'; }, 1500);
});
