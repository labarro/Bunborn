// Tiny pixel painter (26/11): draws straight into an RGBA buffer with no anti-aliasing, so every
// sprite of the house is real pixel art (hard edges, flat tones, 1px outlines) generated at load
// time from code. No external image assets, no licences to track, nothing to download.
export type RGBA = [number, number, number, number];
export function hex(c: string, a = 255): RGBA {
  const n = Number.parseInt(c.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
/** Lighter (amount > 0) or darker (amount < 0), shifting hue slightly warm/cool like painted light. */
export function shade(c: RGBA, amount: number): RGBA {
  if (amount >= 0) return [clamp(c[0] + (255 - c[0]) * amount * 0.9 + 6 * amount), clamp(c[1] + (255 - c[1]) * amount * 0.85), clamp(c[2] + (255 - c[2]) * amount * 0.7), c[3]];
  const k = 1 + amount;
  return [clamp(c[0] * k * 0.96), clamp(c[1] * k * 0.97), clamp(c[2] * k + 10 * -amount), c[3]];
}
export const mix = (a: RGBA, b: RGBA, t: number): RGBA => [clamp(a[0] + (b[0] - a[0]) * t), clamp(a[1] + (b[1] - a[1]) * t), clamp(a[2] + (b[2] - a[2]) * t), clamp(a[3] + (b[3] - a[3]) * t)];

export class Px {
  readonly data: Uint8ClampedArray;
  constructor(readonly w: number, readonly h: number) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  set(x: number, y: number, c: RGBA) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || c[3] === 0) return;
    const i = (y * this.w + x) * 4;
    if (c[3] === 255) { this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2]; this.data[i + 3] = 255; return; }
    const a = c[3] / 255, b = this.data[i + 3] / 255, out = a + b * (1 - a);
    if (out <= 0) return;
    for (let k = 0; k < 3; k++) this.data[i + k] = clamp((c[k] * a + this.data[i + k] * b * (1 - a)) / out);
    this.data[i + 3] = clamp(out * 255);
  }
  get(x: number, y: number): RGBA {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return [0, 0, 0, 0];
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }
  alpha(x: number, y: number) {
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : this.data[(y * this.w + x) * 4 + 3];
  }
  clear(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data[(y * this.w + x) * 4 + 3] = 0;
  }
  rect(x: number, y: number, w: number, h: number, c: RGBA) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  /** Scanline polygon fill at pixel centres (no anti-aliasing). Optional per-pixel colour. */
  poly(points: [number, number][], c: RGBA | 'clear' | ((x: number, y: number) => RGBA)) {
    const ys = points.map((p) => p[1]);
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(this.h - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y++) {
      const cy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i], [xj, yj] = points[j];
        if ((yi > cy) !== (yj > cy)) xs.push(xi + ((cy - yi) * (xj - xi)) / (yj - yi));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let x = Math.ceil(xs[k] - 0.5); x <= Math.floor(xs[k + 1] - 0.5); x++) {
          if (c === 'clear') this.clear(x, y);
          else this.set(x, y, typeof c === 'function' ? c(x, y) : c);
        }
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGBA) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  /** Filled ellipse; `tone` gives 3-tone shading lit from the upper left. */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGBA, tone = 0, angle = 0) {
    const r = Math.max(rx, ry) + 1, cos = Math.cos(angle), sin = Math.sin(angle);
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const px = x + 0.5 - cx, py = y + 0.5 - cy;
        const u = (px * cos + py * sin) / rx, v = (-px * sin + py * cos) / ry;
        if (u * u + v * v > 1) continue;
        let col = c;
        if (tone) {
          const l = -(px / rx) * 0.55 - (py / ry) * 0.8;
          col = l > 0.55 ? shade(c, tone * 0.5) : l < -0.35 ? shade(c, -tone) : c;
        }
        this.set(x, y, col);
      }
  }
  /** 1px outline around everything drawn so far (outside edge), like hand-made sprites. */
  outline(c: RGBA, inside = false) {
    const mask = new Uint8Array(this.w * this.h);
    for (let i = 0; i < this.w * this.h; i++) mask[i] = this.data[i * 4 + 3] > 110 ? 1 : 0; // ignore soft shadows
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : mask[y * this.w + x]);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (inside) {
          if (at(x, y) && (!at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1))) this.set(x, y, c);
        } else if (!at(x, y) && (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1))) this.set(x, y, c);
      }
  }
  /** Deterministic speckle texture over drawn pixels only (wood grain, fabric, grass). */
  speckle(seed: number, density: number, c: RGBA, area?: [number, number, number, number]) {
    let t = seed >>> 0;
    const rnd = () => { t = (t + 0x6d2b79f5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
    const [ax, ay, aw, ah] = area ?? [0, 0, this.w, this.h];
    for (let y = ay; y < ay + ah; y++) for (let x = ax; x < ax + aw; x++) if (this.alpha(x, y) && rnd() < density) this.set(x, y, c);
  }
  canvas(): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = this.w; cv.height = this.h;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(this.w, this.h);
    img.data.set(this.data);
    ctx.putImageData(img, 0, 0);
    return cv;
  }
}

/** Isometric drawing in a sprite: tile 32×16; (u, v) in tiles from the footprint's top corner, z up in px. */
export class Iso {
  constructor(readonly px: Px, readonly ox: number, readonly oy: number) {}
  at(u: number, v: number, z = 0): [number, number] {
    return [this.ox + (u - v) * 16, this.oy + (u + v) * 8 - z];
  }
  /** Top face of a box. */
  top(u0: number, v0: number, u1: number, v1: number, z: number, c: RGBA | 'clear' | ((x: number, y: number) => RGBA)) {
    this.px.poly([this.at(u0, v0, z), this.at(u1, v0, z), this.at(u1, v1, z), this.at(u0, v1, z)], c);
  }
  /** Left visible face (the v = v1 side) and right visible face (u = u1). */
  left(u0: number, u1: number, v: number, z0: number, z1: number, c: RGBA | 'clear' | ((x: number, y: number) => RGBA)) {
    this.px.poly([this.at(u0, v, z1), this.at(u1, v, z1), this.at(u1, v, z0), this.at(u0, v, z0)], c);
  }
  right(u: number, v0: number, v1: number, z0: number, z1: number, c: RGBA | 'clear' | ((x: number, y: number) => RGBA)) {
    this.px.poly([this.at(u, v0, z1), this.at(u, v1, z1), this.at(u, v1, z0), this.at(u, v0, z0)], c);
  }
  /** A shaded box with crisp edges: light top, mid right face, darker left face, edge highlights. */
  box(u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, base: RGBA, opts: { edge?: boolean; grain?: number } = {}) {
    const topC = shade(base, 0.12), rightC = shade(base, -0.12), leftC = shade(base, -0.28);
    this.left(u0, u1, v1, z0, z1, leftC);
    this.right(u1, v0, v1, z0, z1, rightC);
    this.top(u0, v0, u1, v1, z1, topC);
    if (opts.grain) {
      const [lx0, ly0] = this.at(u0, v1, z1), [lx1] = this.at(u1, v1, z1);
      for (let k = 2; k < z1 - z0; k += opts.grain) this.px.line(lx0 + 1, ly0 + k, lx1 - 1, ly0 + k + (lx1 - lx0) / 2 - 1, shade(leftC, -0.1));
    }
    if (opts.edge !== false) {
      const dark = shade(base, -0.55), hi = shade(base, 0.35);
      const [a, b, c, d] = [this.at(u0, v1, z1), this.at(u1, v1, z1), this.at(u1, v0, z1), this.at(u0, v0, z1)];
      this.px.line(a[0], a[1], b[0], b[1], hi);
      this.px.line(b[0], b[1], c[0], c[1], hi);
      this.px.line(...this.at(u1, v1, z1), ...this.at(u1, v1, z0), dark);
      void d;
    }
  }
  /** Vertical flat panel on the left face plane (v fixed): drawers, books, screens. */
  panelL(u0: number, u1: number, v: number, z0: number, z1: number, c: RGBA) { this.left(u0, u1, v, z0, z1, c); }
  panelR(u: number, v0: number, v1: number, z0: number, z1: number, c: RGBA) { this.right(u, v0, v1, z0, z1, c); }
  /** Soft contact shadow on the floor under the footprint. */
  shadow(u0: number, v0: number, u1: number, v1: number, grow = 0.04, a = 46) {
    // Contact shadow: only under and just around the base, darker toward the back corner.
    this.top(u0 - grow, v0 - grow, u1 + grow, v1 + grow, 0, (x, y) => [35, 22, 40, Math.max(18, a - Math.max(0, (y - this.oy) * 0.6) - Math.abs(x - this.ox) * 0.15)]);
  }
  ellipseTop(u: number, v: number, z: number, rx: number, ry: number, c: RGBA, tone = 0) {
    const [x, y] = this.at(u, v, z);
    this.px.ellipse(x, y, rx, ry, c, tone);
  }
}
