// What the creature SEES when she looks at a drawing she just made: visible colours and how much
// of the canvas each covers. Factual perception only, no advice; she learns from it (25/11: two
// production drawings came out as one flat colour and she never knew).
import type { Artifact, Stroke } from './domain';

// Up to 24x24 samples; fewer when the painting has many segments, so the worst case (160 strokes
// x 64 points) stays within a few ms of Worker CPU (measured 23 ms before this cap).
const gridFor = (segments: number) => Math.max(8, Math.min(24, Math.floor(Math.sqrt(150000 / Math.max(1, segments)))));
type Box = [number, number, number, number];
function boxOf(s: Stroke, line: number): Box {
  switch (s.tool) {
    case 'retangulo': return [s.x - line, s.y - line, s.x + s.w + line, s.y + s.h + line];
    case 'elipse': return [s.cx - s.rx - line, s.cy - s.ry - line, s.cx + s.rx + line, s.cy + s.ry + line];
    case 'texto': return [s.x, s.y - s.size, s.x + s.text.length * s.size * 0.55, s.y];
    default: {
      const r = s.tool === 'pincel' ? s.size / 2 : line;
      const xs = s.points.map((p) => p.x), ys = s.points.map((p) => p.y);
      return [Math.min(...xs) - r, Math.min(...ys) - r, Math.max(...xs) + r, Math.max(...ys) + r];
    }
  }
}

// line = outline width used by the renderer (src/ArtifactView.tsx).
function covers(s: Stroke, x: number, y: number, line: number): boolean {
  switch (s.tool) {
    case 'retangulo': {
      const inside = x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
      if (s.fill) return inside;
      const edge = line;
      return inside && (x - s.x < edge || s.x + s.w - x < edge || y - s.y < edge || s.y + s.h - y < edge);
    }
    case 'elipse': {
      if (s.rx <= 0 || s.ry <= 0) return false;
      const d = ((x - s.cx) / s.rx) ** 2 + ((y - s.cy) / s.ry) ** 2;
      return s.fill ? d <= 1 : Math.abs(Math.sqrt(d) - 1) * Math.min(s.rx, s.ry) <= line / 2;
    }
    case 'poligono': {
      let inside = false;
      const p = s.points;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++)
        if (p[i].y > y !== p[j].y > y && x < ((p[j].x - p[i].x) * (y - p[i].y)) / (p[j].y - p[i].y) + p[i].x) inside = !inside;
      return s.fill ? inside : near(p.concat(p[0]), x, y, line / 2);
    }
    case 'pincel':
      return near(s.points, x, y, s.size / 2);
    case 'texto':
      return x >= s.x && x <= s.x + s.text.length * s.size * 0.55 && y <= s.y && y >= s.y - s.size;
  }
}
function near(p: { x: number; y: number }[], x: number, y: number, r: number): boolean {
  if (p.length === 1) return (x - p[0].x) ** 2 + (y - p[0].y) ** 2 <= r * r;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = dx || dy ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
    if ((x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2 <= r * r) return true;
  }
  return false;
}

/** Share of the canvas per visible colour, largest first. */
export function visibleColours(a: Artifact): { color: string; share: number }[] | null {
  const counts = new Map<string, number>();
  let total = 0;
  if (a.format === 'pixels') {
    for (const row of a.pixels) for (const p of row) { const c = a.palette[p].toLowerCase(); counts.set(c, (counts.get(c) ?? 0) + 1); total++; }
  } else if (a.format === 'pintura') {
    const line = Math.max(a.width, a.height) / 200; // renderer: src/paint-raster.ts outlineWidth
    const boxes = a.strokes.map((st) => boxOf(st, line));
    const GRID = gridFor(a.strokes.reduce((t, st) => t + ('points' in st ? st.points.length : 1), 0));
    for (let gy = 0; gy < GRID; gy++)
      for (let gx = 0; gx < GRID; gx++) {
        const x = ((gx + 0.5) * a.width) / GRID, y = ((gy + 0.5) * a.height) / GRID;
        let c = a.background;
        for (let i = a.strokes.length - 1; i >= 0; i--) if (x >= boxes[i][0] && x <= boxes[i][2] && y >= boxes[i][1] && y <= boxes[i][3] && covers(a.strokes[i], x, y, line)) { c = a.strokes[i].color; break; }
        c = c.toLowerCase();
        counts.set(c, (counts.get(c) ?? 0) + 1);
        total++;
      }
  } else return null;
  return [...counts].map(([color, n]) => ({ color, share: n / total })).sort((p, q) => q.share - p.share);
}

/** One sentence of what she sees, or null for non-visual works. */
export function lookAt(a: Artifact): string | null {
  const colours = visibleColours(a);
  if (!colours) return null;
  const pct = (v: number) => Math.round(v * 100) + '%';
  if (colours.length === 1) return `ao olhar a obra: uma só cor (${colours[0].color}) cobre a tela inteira; nada mais aparece`;
  const parts = colours.slice(0, 5).map((c) => `${c.color} ${pct(c.share)}`);
  const extra = colours.length > 5 ? ` e mais ${colours.length - 5}` : '';
  const shapes = a.format === 'pintura' ? `${a.strokes.length} traços; ` : '';
  return `ao olhar a obra: ${shapes}${colours.length} cores visíveis (${parts.join(', ')}${extra})`;
}
