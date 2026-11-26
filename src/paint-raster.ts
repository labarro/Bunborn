// MS Paint-style rendering of the creature's paintings (observer's request, 26/11): hard aliased
// pixels, flat colours, shapes as straight as the Paint tools, freehand brush with the small
// tremor of a hand on a mouse, aliased Arial text. Each stroke is drawn on its own layer and
// thresholded (alpha >= 50%) so no edge is smoothed. Deterministic: the same work always looks
// the same. Only the look changes; what she painted, where and in which colour is untouched.
import type { Artifact, Stroke } from '../shared/domain';

export type Painting = Extract<Artifact, { format: 'pintura' }>;
/** Long side of the rendered picture, in real pixels (Paint documents are about this size). */
export const OUTPUT = 480;
export const outlineWidth = (scale: number, a: Painting) => Math.max(2, Math.round((Math.max(a.width, a.height) * scale) / 200));

function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
type Pt = { x: number; y: number };
/** Mouse tremor: the stroke is split into short segments, each nudged by about a pixel. */
function tremor(points: Pt[], scale: number, seed: number): Pt[] {
  const r = rng(seed);
  const out: Pt[] = [];
  const amp = 0.9;
  for (let i = 0; i < points.length; i++) {
    const a = { x: points[i].x * scale, y: points[i].y * scale };
    out.push(i === 0 || i === points.length - 1 ? a : { x: a.x + (r() - 0.5) * 2 * amp, y: a.y + (r() - 0.5) * 2 * amp });
    if (i === points.length - 1) break;
    const b = { x: points[i + 1].x * scale, y: points[i + 1].y * scale };
    const n = Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / 14);
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / (n + 1) + (r() - 0.5) * 2 * amp, y: a.y + ((b.y - a.y) * k) / (n + 1) + (r() - 0.5) * 2 * amp });
  }
  return out;
}
function draw(ctx: CanvasRenderingContext2D, s: Stroke, scale: number, line: number, seed: number) {
  ctx.fillStyle = ctx.strokeStyle = '#000';
  ctx.lineCap = ctx.lineJoin = 'round';
  switch (s.tool) {
    case 'pincel': {
      const p = tremor(s.points, scale, seed);
      const w = Math.max(1, s.size * scale);
      if (p.length === 1) { ctx.beginPath(); ctx.arc(p[0].x, p[0].y, w / 2, 0, Math.PI * 2); ctx.fill(); return; }
      ctx.lineWidth = w;
      ctx.beginPath();
      p.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.stroke();
      return;
    }
    case 'retangulo':
      ctx.lineJoin = 'miter';
      if (s.fill) ctx.fillRect(s.x * scale, s.y * scale, s.w * scale, s.h * scale);
      else { ctx.lineWidth = line; ctx.strokeRect(s.x * scale, s.y * scale, s.w * scale, s.h * scale); }
      return;
    case 'elipse':
      ctx.beginPath();
      ctx.ellipse(s.cx * scale, s.cy * scale, Math.max(0.5, s.rx * scale), Math.max(0.5, s.ry * scale), 0, 0, Math.PI * 2);
      if (s.fill) ctx.fill(); else { ctx.lineWidth = line; ctx.stroke(); }
      return;
    case 'poligono':
      ctx.lineJoin = 'miter';
      ctx.beginPath();
      s.points.forEach((q, i) => (i ? ctx.lineTo(q.x * scale, q.y * scale) : ctx.moveTo(q.x * scale, q.y * scale)));
      ctx.closePath();
      if (s.fill) ctx.fill(); else { ctx.lineWidth = line; ctx.stroke(); }
      return;
    case 'texto':
      ctx.font = `${Math.max(8, s.size * scale)}px Arial, Helvetica, sans-serif`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(s.text, s.x * scale, s.y * scale);
      return;
  }
}
const rgb = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/** Paints the work onto `canvas` (resized to the output size). `layer` is a scratch canvas. */
export function paint(canvas: HTMLCanvasElement, layer: HTMLCanvasElement, a: Painting) {
  const scale = OUTPUT / Math.max(a.width, a.height);
  const W = Math.max(1, Math.round(a.width * scale)), H = Math.max(1, Math.round(a.height * scale));
  canvas.width = layer.width = W;
  canvas.height = layer.height = H;
  const ctx = canvas.getContext('2d')!;
  const lc = layer.getContext('2d', { willReadFrequently: true })!;
  const image = ctx.createImageData(W, H);
  const px = image.data;
  const [br, bg, bb] = rgb(a.background);
  for (let i = 0; i < px.length; i += 4) { px[i] = br; px[i + 1] = bg; px[i + 2] = bb; px[i + 3] = 255; }
  const line = outlineWidth(scale, a);
  a.strokes.forEach((s, n) => {
    lc.clearRect(0, 0, W, H);
    draw(lc, s, scale, line, n * 7919 + 17);
    const mask = lc.getImageData(0, 0, W, H).data;
    const [r, g, b] = rgb(s.color);
    // Thin glyph stems (the i in "Samambaia") stay below 50% coverage: text uses a lower cut.
    const cut = s.tool === 'texto' ? 40 : 128;
    for (let i = 3; i < mask.length; i += 4) if (mask[i] >= cut) { px[i - 3] = r; px[i - 2] = g; px[i - 1] = b; }
  });
  ctx.putImageData(image, 0, 0);
}
