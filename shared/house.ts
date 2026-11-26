// The house (habitat v2, 26/11): a small isometric home with six connected spaces. Walls sit on
// the EDGES between cells (doors are gaps), so rooms stay compact and the creature walks through
// doorways instead of over walls. Everything here is pure and shared by the engine (source of
// truth: positions, access, validity) and the renderer (which only draws what the state says).
export type Point = { x: number; y: number };
export type RoomId = 'quarto' | 'estudio' | 'banheiro' | 'sala' | 'cozinha' | 'jardim';
export type HouseObject = Point & { id: string; label: string; kind: string; color: string; artifactId?: string; w?: number; h?: number };

export const GRID = { w: 20, h: 16 } as const;
export const rooms: { id: RoomId; label: string; x0: number; y0: number; x1: number; y1: number; outdoor?: boolean }[] = [
  { id: 'quarto', label: 'Quarto', x0: 0, y0: 0, x1: 5, y1: 5 },
  { id: 'estudio', label: 'Estúdio', x0: 6, y0: 0, x1: 13, y1: 5 },
  { id: 'banheiro', label: 'Banheiro', x0: 14, y0: 0, x1: 19, y1: 5 },
  { id: 'sala', label: 'Sala', x0: 0, y0: 6, x1: 9, y1: 10 },
  { id: 'cozinha', label: 'Cozinha', x0: 10, y0: 6, x1: 19, y1: 10 },
  { id: 'jardim', label: 'Jardim', x0: 0, y0: 11, x1: 19, y1: 15, outdoor: true },
];
/** Wall lines: 'v' runs along x = at (between columns at-1 and at), 'h' along y = at. */
export const walls: { axis: 'v' | 'h'; at: number; from: number; to: number; doors: number[]; outer?: boolean }[] = [
  { axis: 'v', at: 6, from: 0, to: 5, doors: [3] },
  { axis: 'v', at: 14, from: 0, to: 5, doors: [2] },
  { axis: 'h', at: 6, from: 0, to: 19, doors: [3, 9, 16] },
  { axis: 'v', at: 10, from: 6, to: 10, doors: [7, 8] },
  { axis: 'h', at: 11, from: 0, to: 19, doors: [4, 15], outer: true },
];
const edgeKey = (a: Point, b: Point) => (a.x < b.x || (a.x === b.x && a.y < b.y) ? `${a.x},${a.y}|${b.x},${b.y}` : `${b.x},${b.y}|${a.x},${a.y}`);
const blockedEdges = new Set<string>();
const doorCells = new Set<string>();
for (const w of walls)
  for (let i = w.from; i <= w.to; i++) {
    const a = w.axis === 'v' ? { x: w.at - 1, y: i } : { x: i, y: w.at - 1 };
    const b = w.axis === 'v' ? { x: w.at, y: i } : { x: i, y: w.at };
    if (w.doors.includes(i)) { doorCells.add(`${a.x},${a.y}`); doorCells.add(`${b.x},${b.y}`); }
    else blockedEdges.add(edgeKey(a, b));
  }
export const wallBetween = (a: Point, b: Point) => blockedEdges.has(edgeKey(a, b));
export const isDoorCell = (p: Point) => doorCells.has(`${p.x},${p.y}`);
export const inGrid = (p: Point) => p.x >= 0 && p.y >= 0 && p.x < GRID.w && p.y < GRID.h;
export function roomAt(p: Point) {
  return rooms.find((r) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1) ?? rooms[3];
}

/** What each kind of object is: footprint, how it is mounted, what it offers. */
export type KindInfo = {
  label: string;
  purpose: string;
  w?: number;
  h?: number;
  /** floor: walkable (rugs, flowers); wall: hangs on a wall (windows, frames); otherwise blocks a cell. */
  mount?: 'floor' | 'wall';
  offers?: ('dormir' | 'descansar' | 'observar' | 'expor' | 'tocar' | 'jardinar')[];
  outdoor?: boolean;
  indoor?: boolean;
  /** Stations the body depends on cannot be stored away. */
  station?: boolean;
  recolor?: boolean;
};
export const kinds: Record<string, KindInfo> = {
  cama: { label: 'Cama', purpose: 'Dormir.', w: 2, station: true, recolor: true, offers: ['dormir', 'descansar'], indoor: true },
  criado: { label: 'Mesa de cabeceira', purpose: 'Apoio ao lado da cama, com uma luminária.', indoor: true },
  guarda_roupa: { label: 'Armário', purpose: 'Guarda coisas do quarto.', h: 2, indoor: true, recolor: true },
  bau: { label: 'Baú', purpose: 'Armazenamento; organizar acontece aqui.', station: true, offers: ['expor'], recolor: true, indoor: true },
  tapete: { label: 'Tapete', purpose: 'Decoração de piso.', mount: 'floor', w: 2, h: 2, recolor: true, indoor: true },
  janela: { label: 'Janela', purpose: 'Mostra o céu, o tempo e a luz lá fora.', mount: 'wall', offers: ['observar'], indoor: true },
  quadro: { label: 'Moldura', purpose: 'Expõe uma obra na parede.', mount: 'wall', offers: ['expor', 'observar'], recolor: true, indoor: true },
  terminal: { label: 'Terminal de pesquisa', purpose: 'Pesquisar na internet real.', station: true, indoor: true },
  mesa: { label: 'Mesa de trabalho', purpose: 'Bancada com materiais de trabalho.', w: 2, station: true, offers: ['expor'], recolor: true, indoor: true },
  diario: { label: 'Escrivaninha do diário', purpose: 'Escrever no diário.', station: true, indoor: true },
  estante: { label: 'Estante', purpose: 'Livros e obras expostas.', station: true, offers: ['expor', 'observar'], recolor: true, indoor: true },
  atelie: { label: 'Cavalete do ateliê', purpose: 'Criar obras; mostra a obra exposta na tela.', station: true, offers: ['expor'], indoor: true },
  higiene: { label: 'Banheira', purpose: 'Higiene.', w: 2, station: true, indoor: true },
  pia_banheiro: { label: 'Pia com espelho', purpose: 'Pia do banheiro.', indoor: true },
  toalheiro: { label: 'Toalheiro', purpose: 'Toalhas.', indoor: true, recolor: true },
  sofa: { label: 'Sofá', purpose: 'Descansar e contemplar.', w: 2, offers: ['descansar'], recolor: true, indoor: true },
  poltrona: { label: 'Poltrona', purpose: 'Descansar.', offers: ['descansar'], recolor: true, indoor: true },
  mesa_centro: { label: 'Mesa de centro', purpose: 'Apoio na sala.', offers: ['expor'], indoor: true },
  descanso: { label: 'Almofada de descanso', purpose: 'Descansar e observar.', station: true, offers: ['descansar', 'observar'], recolor: true, indoor: true },
  planta: { label: 'Planta', purpose: 'Planta em vaso.', offers: ['observar'] },
  luminaria: { label: 'Luminária de pé', purpose: 'Luz para a noite.', indoor: true },
  geladeira: { label: 'Despensa', purpose: 'Guarda alimentos virtuais.', indoor: true },
  comida: { label: 'Alimentação e água', purpose: 'Comer e beber.', w: 2, station: true, indoor: true },
  pia_cozinha: { label: 'Pia da cozinha', purpose: 'Pia.', indoor: true },
  fogao: { label: 'Fogão', purpose: 'Bancada de cozinha.', indoor: true },
  mesa_cozinha: { label: 'Mesa da cozinha', purpose: 'Mesa com cadeiras.', w: 2, offers: ['expor'], indoor: true, recolor: true },
  canteiro: { label: 'Canteiro', purpose: 'Plantar, regar e colher plantas virtuais.', offers: ['jardinar', 'observar'], outdoor: true },
  banco: { label: 'Banco do jardim', purpose: 'Descansar ao ar livre.', w: 2, offers: ['descansar', 'observar'], outdoor: true, recolor: true },
  arvore: { label: 'Árvore', purpose: 'Muda com as estações.', offers: ['observar'], outdoor: true },
  flores: { label: 'Flores', purpose: 'Flores do jardim.', mount: 'floor', offers: ['observar'], outdoor: true },
  decoracao: { label: 'Decoração', purpose: 'Objeto decorativo aprovado pelo observador.', recolor: true },
  // Catalogue (only exists after a request is approved by the observer):
  telescopio: { label: 'Telescópio', purpose: 'Observar o céu virtual: lua, estrelas, chuvas de meteoros.', offers: ['observar'] },
  toca_discos: { label: 'Toca-discos', purpose: 'Tocar as próprias composições.', offers: ['tocar'], indoor: true },
  piano: { label: 'Teclado', purpose: 'Tocar as próprias composições.', w: 2, offers: ['tocar'], indoor: true, recolor: true },
  aquario: { label: 'Aquário decorativo', purpose: 'Contemplação (peixes decorativos, sem vida simulada).', offers: ['observar'], indoor: true },
  vitrine: { label: 'Vitrine de coleção', purpose: 'Expor obras e coleções.', offers: ['expor', 'observar'], indoor: true, recolor: true },
  cavalete: { label: 'Cavalete extra', purpose: 'Expor uma pintura em pé.', offers: ['expor'], indoor: true },
  estante_grande: { label: 'Estante grande', purpose: 'Mais espaço para livros e obras.', w: 2, offers: ['expor', 'observar'], indoor: true, recolor: true },
};
export const kindOf = (o: Pick<HouseObject, 'kind'>) => kinds[o.kind] ?? kinds.decoracao;
export const footprint = (o: HouseObject): Point[] => {
  const info = kindOf(o);
  if (info.mount) return [];
  const w = o.w ?? info.w ?? 1, h = o.h ?? info.h ?? 1;
  const cells: Point[] = [];
  for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) cells.push({ x: o.x + dx, y: o.y + dy });
  return cells;
};
/** Cells an object covers visually (rugs too), for drawing and clicking. */
export const cover = (o: HouseObject): Point[] => {
  const info = kindOf(o);
  const w = o.w ?? info.w ?? 1, h = o.h ?? info.h ?? 1;
  const cells: Point[] = [];
  for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) cells.push({ x: o.x + dx, y: o.y + dy });
  return cells;
};
/** Wall side an object hangs on, if any: the back (y) wall or the left (x) wall of its cell. */
export function wallSide(p: Point): 'back' | 'left' | null {
  if (p.y === 0 || wallBetween({ x: p.x, y: p.y - 1 }, p)) return 'back';
  if (p.x === 0 || wallBetween({ x: p.x - 1, y: p.y }, p)) return 'left';
  return null;
}

const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
function blockedCells(objects: HouseObject[], except?: string) {
  const set = new Set<string>();
  for (const o of objects) if (o.id !== except) for (const c of footprint(o)) set.add(`${c.x},${c.y}`);
  return set;
}
/** Shortest walk on free cells, through doorways only. */
export function pathfind(start: Point, end: Point, objects: HouseObject[]): Point[] {
  if (!inGrid(end)) return [];
  const blocked = blockedCells(objects);
  if (blocked.has(`${end.x},${end.y}`)) return [];
  const prev = new Map<string, string | null>([[`${start.x},${start.y}`, null]]);
  const queue: Point[] = [start];
  while (queue.length) {
    const p = queue.shift()!;
    if (p.x === end.x && p.y === end.y) {
      const path: Point[] = [];
      for (let k: string | null = `${p.x},${p.y}`; k; k = prev.get(k)!) { const [x, y] = k.split(',').map(Number); path.unshift({ x, y }); }
      return path;
    }
    for (const [dx, dy] of steps) {
      const n = { x: p.x + dx, y: p.y + dy };
      const key = `${n.x},${n.y}`;
      if (!inGrid(n) || prev.has(key) || blocked.has(key) || wallBetween(p, n)) continue;
      prev.set(key, `${p.x},${p.y}`);
      queue.push(n);
    }
  }
  return [];
}
/** Cells from which the creature can use an object (beside it, on the same side of any wall). */
export function usePoints(o: HouseObject): Point[] {
  const info = kindOf(o);
  if (info.mount) return [{ x: o.x, y: o.y }];
  const cells = footprint(o);
  const own = new Set(cells.map((c) => `${c.x},${c.y}`));
  const out: Point[] = [];
  for (const c of cells)
    for (const [dx, dy] of steps) {
      const n = { x: c.x + dx, y: c.y + dy };
      if (!inGrid(n) || own.has(`${n.x},${n.y}`) || wallBetween(c, n)) continue;
      if (!out.some((p) => p.x === n.x && p.y === n.y)) out.push(n);
    }
  // Prefer the front: away from the wall the object leans on (in front of a desk, at the foot
  // of the bed), then any side facing the observer.
  const back = cells.some((c) => c.y === 0 || wallBetween({ x: c.x, y: c.y - 1 }, c));
  const left = cells.some((c) => c.x === 0 || wallBetween({ x: c.x - 1, y: c.y }, c));
  const score = (p: Point) => {
    const below = cells.some((c) => c.x === p.x && c.y + 1 === p.y);
    const right = cells.some((c) => c.y === p.y && c.x + 1 === p.x);
    return (back && below ? 4 : 0) + (left && right ? 3 : 0) + (below || right ? 1 : 0);
  };
  return out.sort((a, b) => score(b) - score(a));
}
/** Walk to the best use point that can be reached (front first; a side if the front is blocked). */
export function approach(start: Point, object: HouseObject, objects: HouseObject[]): Point[] {
  let best: Point[] = [];
  for (const p of usePoints(object)) {
    const path = pathfind(start, p, objects);
    if (!path.length) continue;
    // Take the preferred spot unless it is a long detour compared with what we already have.
    if (!best.length) best = path;
    else if (path.length + 4 < best.length) best = path;
  }
  return best;
}
/**
 * A layout is valid when nothing overlaps, every object sits inside one room (never across a
 * wall or on a doorway), every object can be used and every doorway stays passable from where
 * the creature is. Rugs and flowers are walkable; wall pieces must hang on a wall.
 */
export function validLayout(objects: HouseObject[], position: Point): boolean {
  if (new Set(objects.map((o) => o.id)).size !== objects.length) return false;
  const taken = new Set<string>();
  for (const o of objects) {
    const info = kindOf(o);
    const room = roomAt(o);
    for (const c of cover(o)) {
      if (!inGrid(c) || roomAt(c).id !== room.id) return false;
      if (info.outdoor && !room.outdoor) return false;
      if (info.indoor && room.outdoor) return false;
    }
    if (info.mount === 'wall' && !wallSide(o)) return false;
    for (const c of footprint(o)) {
      const k = `${c.x},${c.y}`;
      if (taken.has(k) || isDoorCell(c) || (c.x === position.x && c.y === position.y)) return false;
      taken.add(k);
    }
  }
  const blocked = blockedCells(objects);
  if (blocked.has(`${position.x},${position.y}`)) return false;
  // Everything reachable from the creature's cell.
  const seen = new Set<string>([`${position.x},${position.y}`]);
  const queue = [position];
  while (queue.length) {
    const p = queue.shift()!;
    for (const [dx, dy] of steps) {
      const n = { x: p.x + dx, y: p.y + dy };
      const k = `${n.x},${n.y}`;
      if (!inGrid(n) || seen.has(k) || blocked.has(k) || wallBetween(p, n)) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  for (const k of doorCells) if (!seen.has(k)) return false;
  return objects.every((o) => usePoints(o).some((p) => seen.has(`${p.x},${p.y}`)));
}
/** First valid spot for a new object in the preferred rooms (used for approved resources). */
export function findPlacement(objects: HouseObject[], position: Point, object: HouseObject, prefer: RoomId[]): Point | null {
  for (const id of prefer) {
    const r = rooms.find((x) => x.id === id)!;
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) {
        const candidate = { ...object, x, y };
        if (validLayout([...objects, candidate], position)) return { x, y };
      }
  }
  return null;
}

// Default house. The eleven original ids are kept so records, activities and exposures stay valid.
export const houseObjects: HouseObject[] = [
  // Quarto
  { id: 'cama', label: 'Cama', kind: 'cama', x: 1, y: 0, color: '#a38ab9' },
  { id: 'criado', label: 'Mesa de cabeceira', kind: 'criado', x: 0, y: 0, color: '#a77d5e' },
  { id: 'guarda_roupa', label: 'Armário', kind: 'guarda_roupa', x: 0, y: 3, color: '#b48a68' },
  { id: 'bau', label: 'Armazenamento', kind: 'bau', x: 4, y: 0, color: '#b08767' },
  { id: 'tapete_quarto', label: 'Tapete do quarto', kind: 'tapete', x: 2, y: 2, color: '#c79bb0' },
  { id: 'janela_quarto', label: 'Janela do quarto', kind: 'janela', x: 3, y: 0, color: '#d9c3a5' },
  { id: 'quadro_quarto', label: 'Moldura do quarto', kind: 'quadro', x: 0, y: 2, color: '#b88b5e' },
  // Estúdio
  { id: 'terminal', label: 'Terminal de pesquisa', kind: 'terminal', x: 8, y: 0, color: '#91aab0' },
  { id: 'mesa', label: 'Mesa de trabalho', kind: 'mesa', x: 10, y: 0, color: '#b88b68' },
  { id: 'janela_estudio', label: 'Janela do estúdio', kind: 'janela', x: 12, y: 0, color: '#d9c3a5' },
  { id: 'quadro_estudio', label: 'Moldura do estúdio', kind: 'quadro', x: 7, y: 0, color: '#b88b5e' },
  { id: 'diario', label: 'Diário', kind: 'diario', x: 13, y: 4, color: '#b389a6' },
  { id: 'estante', label: 'Estante', kind: 'estante', x: 6, y: 4, color: '#bb946b' },
  { id: 'atelie', label: 'Ateliê', kind: 'atelie', x: 11, y: 3, color: '#d7ba90' },
  // Banheiro
  { id: 'higiene', label: 'Área de higiene', kind: 'higiene', x: 17, y: 0, color: '#8fbbba' },
  { id: 'pia_banheiro', label: 'Pia com espelho', kind: 'pia_banheiro', x: 15, y: 0, color: '#e8e4dc' },
  { id: 'toalheiro', label: 'Toalheiro', kind: 'toalheiro', x: 19, y: 3, color: '#e39a8f' },
  { id: 'janela_banheiro', label: 'Janela do banheiro', kind: 'janela', x: 19, y: 0, color: '#d9c3a5' },
  { id: 'tapete_banho', label: 'Tapete de banho', kind: 'tapete', x: 16, y: 2, w: 2, h: 1, color: '#9fc4c0' },
  // Sala
  { id: 'sofa', label: 'Sofá', kind: 'sofa', x: 1, y: 6, color: '#8fa37e' },
  { id: 'poltrona', label: 'Poltrona', kind: 'poltrona', x: 0, y: 8, color: '#c48a6a' },
  { id: 'mesa_centro', label: 'Mesa de centro', kind: 'mesa_centro', x: 2, y: 8, color: '#a77d5e' },
  { id: 'tapete_sala', label: 'Tapete da sala', kind: 'tapete', x: 1, y: 7, w: 3, h: 3, color: '#b8a2c8' },
  { id: 'descanso', label: 'Almofada de descanso', kind: 'descanso', x: 6, y: 9, color: '#9eae84' },
  { id: 'luminaria', label: 'Luminária de pé', kind: 'luminaria', x: 4, y: 6, color: '#e4c797' },
  { id: 'planta', label: 'Planta', kind: 'planta', x: 0, y: 10, color: '#91ad7e' },
  { id: 'janela_sala', label: 'Janela da sala', kind: 'janela', x: 0, y: 9, color: '#d9c3a5' },
  { id: 'quadro_sala', label: 'Moldura da sala', kind: 'quadro', x: 6, y: 6, color: '#b88b5e' },
  // Cozinha
  { id: 'geladeira', label: 'Despensa', kind: 'geladeira', x: 11, y: 6, color: '#dfe3dc' },
  { id: 'comida', label: 'Alimentação e água', kind: 'comida', x: 12, y: 6, color: '#d4ad78' },
  { id: 'pia_cozinha', label: 'Pia da cozinha', kind: 'pia_cozinha', x: 14, y: 6, color: '#c9b79a' },
  { id: 'fogao', label: 'Fogão', kind: 'fogao', x: 15, y: 6, color: '#c9b79a' },
  { id: 'mesa_cozinha', label: 'Mesa da cozinha', kind: 'mesa_cozinha', x: 17, y: 8, color: '#b88b68' },
  // Jardim
  { id: 'canteiro_1', label: 'Canteiro 1', kind: 'canteiro', x: 2, y: 13, color: '#7a5a43' },
  { id: 'canteiro_2', label: 'Canteiro 2', kind: 'canteiro', x: 4, y: 13, color: '#7a5a43' },
  { id: 'canteiro_3', label: 'Canteiro 3', kind: 'canteiro', x: 6, y: 13, color: '#7a5a43' },
  { id: 'banco', label: 'Banco do jardim', kind: 'banco', x: 10, y: 14, color: '#a77d5e' },
  { id: 'arvore', label: 'Árvore', kind: 'arvore', x: 17, y: 13, color: '#6f9a5e' },
  { id: 'flores_1', label: 'Flores', kind: 'flores', x: 13, y: 12, color: '#e7a6c0' },
  { id: 'flores_2', label: 'Flores', kind: 'flores', x: 8, y: 15, color: '#f0d27a' },
  { id: 'flores_3', label: 'Flores', kind: 'flores', x: 1, y: 15, color: '#b7a3e6' },
];
export const defaultPosition: Point = { x: 5, y: 8 };

/** Version-1 room (12×12, one room) default positions: used to detect what the creature moved. */
const v1Defaults: Record<string, Point> = { cama: { x: 1, y: 1 }, mesa: { x: 8, y: 2 }, terminal: { x: 8, y: 1 }, estante: { x: 1, y: 5 }, comida: { x: 2, y: 9 }, higiene: { x: 9, y: 9 }, diario: { x: 7, y: 3 }, atelie: { x: 9, y: 5 }, bau: { x: 1, y: 7 }, descanso: { x: 5, y: 6 }, planta: { x: 10, y: 1 } };
export type MigrationReport = { kept: string[]; movedKept: string[]; movedReset: string[]; exposures: { objectId: string; artifactId: string }[]; extras: string[] };
/**
 * Moves a version-1 single room into the house. Ids, labels, colours and exposed works are kept.
 * A move the creature made in the old room (offset from the old default) is re-applied in the new
 * room when it still forms a valid layout; otherwise the object goes to its new default spot.
 * Objects approved later (decorations) are placed in free spots of the living room or studio.
 */
export function migrateObjects(old: HouseObject[]): { objects: HouseObject[]; position: Point; report: MigrationReport } {
  const report: MigrationReport = { kept: [], movedKept: [], movedReset: [], exposures: [], extras: [] };
  let objects = houseObjects.map((o) => ({ ...o }));
  const position = { ...defaultPosition };
  for (const prev of old) {
    const target = objects.find((o) => o.id === prev.id);
    if (target) {
      target.label = prev.label;
      target.color = prev.color;
      if (prev.artifactId) { target.artifactId = prev.artifactId; report.exposures.push({ objectId: prev.id, artifactId: prev.artifactId }); }
      const was = v1Defaults[prev.id];
      if (was && (was.x !== prev.x || was.y !== prev.y)) {
        const moved = { ...target, x: target.x + prev.x - was.x, y: target.y + prev.y - was.y };
        const trial = objects.map((o) => (o.id === target.id ? moved : o));
        if (validLayout(trial, position)) { objects = trial; report.movedKept.push(prev.id); }
        else report.movedReset.push(prev.id);
      } else report.kept.push(prev.id);
      continue;
    }
    const extra: HouseObject = { ...prev };
    const spot = findPlacement(objects, position, extra, kindOf(extra).outdoor ? ['jardim'] : ['sala', 'estudio', 'quarto', 'cozinha']);
    if (spot) { objects.push({ ...extra, ...spot }); report.extras.push(prev.id); }
  }
  return { objects, position, report };
}

/** Objects a request may ask for (the observer approves or refuses; no money exists here). */
export const catalogue: { id: string; kind: string; category: string; rooms: RoomId[] }[] = [
  { id: 'telescopio', kind: 'telescopio', category: 'observação', rooms: ['jardim', 'sala', 'estudio'] },
  { id: 'toca_discos', kind: 'toca_discos', category: 'música', rooms: ['sala', 'estudio', 'quarto'] },
  { id: 'piano', kind: 'piano', category: 'música', rooms: ['sala', 'estudio'] },
  { id: 'aquario', kind: 'aquario', category: 'contemplação', rooms: ['sala', 'quarto', 'estudio'] },
  { id: 'vitrine', kind: 'vitrine', category: 'coleção', rooms: ['sala', 'estudio', 'quarto'] },
  { id: 'cavalete', kind: 'cavalete', category: 'arte', rooms: ['estudio', 'sala'] },
  { id: 'estante_grande', kind: 'estante_grande', category: 'livros', rooms: ['estudio', 'sala', 'quarto'] },
  { id: 'poltrona', kind: 'poltrona', category: 'descanso', rooms: ['quarto', 'estudio', 'sala'] },
  { id: 'luminaria', kind: 'luminaria', category: 'luz', rooms: ['quarto', 'estudio', 'sala', 'cozinha'] },
  { id: 'tapete', kind: 'tapete', category: 'decoração', rooms: ['quarto', 'estudio', 'sala', 'cozinha'] },
  { id: 'planta', kind: 'planta', category: 'plantas', rooms: ['sala', 'quarto', 'estudio', 'cozinha', 'banheiro', 'jardim'] },
  { id: 'quadro', kind: 'quadro', category: 'arte', rooms: ['sala', 'quarto', 'estudio', 'cozinha'] },
  { id: 'canteiro', kind: 'canteiro', category: 'jardim', rooms: ['jardim'] },
  { id: 'flores', kind: 'flores', category: 'jardim', rooms: ['jardim'] },
];
export const catalogueEntry = (id: string) => {
  const c = catalogue.find((x) => x.id === id);
  if (!c) return null;
  const k = kinds[c.kind];
  return { ...c, name: k.label, description: k.purpose, footprint: { w: k.w ?? 1, h: k.h ?? 1 }, mount: k.mount ?? 'chao', offers: k.offers ?? [], restrictions: k.outdoor ? 'só no jardim' : k.indoor ? 'só dentro de casa' : 'dentro ou fora' };
};
