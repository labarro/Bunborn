// Procedural pixel-art sprites for the house (26/11). Each object is drawn once per look (kind,
// colour, size, state) into its own texture, with contact shadow, 3-tone shading, outlines and
// recognisable details. Art direction: ART_DIRECTION.md.
import type { HouseObject } from '../../shared/house';
import { GRID, kindOf, rooms, walls, wallSide, type RoomId } from '../../shared/house';
import { hex, Iso, mix, Px, shade, type RGBA } from './pixel';

export const TILE_W = 32, TILE_H = 16;
export const WALL_H = 64; // back (outer) walls
export const INNER_H = 30; // interior walls: lower, so they never hide her for long
export const FRONT_H = 9; // front outer wall: a low cut-away
export const MARGIN = 72;
export const OX = MARGIN + GRID.h * 16 + 48, OY = MARGIN + WALL_H + 24;
export const WORLD_W = OX + GRID.w * 16 + MARGIN + 48, WORLD_H = OY + (GRID.w + GRID.h) * 8 + MARGIN + 40;
export const iso = (x: number, y: number) => ({ x: OX + (x - y) * 16, y: OY + (x + y) * 8 });

export const outline: RGBA = hex('#3b2c3f');
export const defaultWalls: Record<RoomId, string> = { quarto: '#d9c4d8', estudio: '#cdd8c5', banheiro: '#c3dddb', sala: '#e6d1b6', cozinha: '#ecdcab', jardim: '#cdd8c5' };
const wood = hex('#b88b68'), darkWood = hex('#8a6149'), cream = hex('#f3e8d6'), metal = hex('#b9c3c8');

export type Sprite = { canvas: HTMLCanvasElement; ox: number; oy: number; front?: { canvas: HTMLCanvasElement; ox: number; oy: number } };
export type Look = { artwork?: HTMLCanvasElement | null; season?: string; plant?: { stage: number; color: string; moist: boolean } | null; lit?: boolean };

const HMAX = 84;
function canvasFor(w: number, h: number) {
  const px = new Px((w + h) * 16 + 4, (w + h) * 8 + HMAX + 4);
  return { px, I: new Iso(px, h * 16 + 2, HMAX) };
}
function finish(px: Px, I: Iso): Sprite {
  return { canvas: px.canvas(), ox: I.ox, oy: I.oy };
}
/** Book spines along a shelf plank (left face), deterministic colours. */
function books(I: Iso, u0: number, u1: number, v: number, z: number, seed: number) {
  const colors = ['#9db39c', '#c3a2b0', '#d7bc91', '#8d9ab0', '#b98a6b', '#c96f5f', '#6f8fa8', '#e2c46f'];
  let u = u0 + 0.04, i = seed;
  while (u < u1 - 0.06) {
    const w = 0.07 + ((i * 7) % 3) * 0.025, h = 8 + ((i * 5) % 4);
    I.left(u, Math.min(u1 - 0.03, u + w), v, z, z + h, hex(colors[i % colors.length]));
    const [x, y] = I.at(u + w / 2, v, z + h - 2);
    I.px.set(x, y, shade(hex(colors[i % colors.length]), 0.4));
    u += w + 0.015; i++;
  }
}

export function drawObject(o: HouseObject, look: Look = {}): Sprite {
  const info = kindOf(o);
  const w = o.w ?? info.w ?? 1, h = o.h ?? info.h ?? 1;
  const c = hex(o.color);
  if (info.mount === 'wall') return drawWallPiece(o, look);
  const { px, I } = canvasFor(w, h);
  if (info.mount !== 'floor' && o.kind !== 'flores') I.shadow(0.06, 0.06, w - 0.06, h - 0.06);
  const k = o.kind;
  if (k === 'cama') {
    // Frame, mattress, quilt in her colour, pillow, headboard against the back wall.
    I.box(0.05, 0.1, w - 0.05, h - 0.05, 0, 9, darkWood);
    I.box(0.08, 0.12, w - 0.08, h - 0.1, 9, 15, cream, { edge: false });
    I.box(0.6, 0.12, w - 0.06, h - 0.08, 13, 17, c);
    for (let u = 0.8; u < w - 0.1; u += 0.32) { const [x0, y0] = I.at(u, h - 0.08, 15); I.px.line(x0, y0, x0, y0 - 2, shade(c, -0.25)); }
    I.ellipseTop(0.33, 0.5, 18, 7, 3.5, hex('#fbf4ec'), 0.35);
    I.box(0.0, 0.05, 0.14, h, 0, 30, darkWood, { grain: 6 });
    I.box(w - 0.12, 0.08, w - 0.02, h - 0.02, 0, 13, darkWood);
  } else if (k === 'criado') {
    I.box(0.2, 0.2, 0.85, 0.85, 0, 16, wood, { grain: 5 });
    I.panelL(0.28, 0.78, 0.85, 4, 12, shade(wood, -0.2));
    { const [x, y] = I.at(0.53, 0.85, 8); I.px.rect(x - 1, y, 3, 1, hex('#e9d29f')); }
    // Lamp: base, stem, shade (lit at night).
    I.ellipseTop(0.5, 0.5, 17, 3, 1.5, hex('#8a7a6a'));
    { const [x, y] = I.at(0.5, 0.5, 17); I.px.rect(x, y - 9, 1, 9, hex('#6d5f55')); I.px.poly([[x - 4, y - 9], [x + 5, y - 9], [x + 3, y - 15], [x - 2, y - 15]], hex(look.lit ? '#ffe3a3' : '#e9cf9c')); I.px.line(x - 4, y - 9, x + 5, y - 9, shade(hex('#e9cf9c'), -0.3)); }
  } else if (k === 'guarda_roupa') {
    I.box(0.1, 0.05, 0.9, h - 0.05, 0, 54, c, { grain: 9 });
    I.panelR(0.9, 0.12, h / 2 - 0.04, 6, 50, shade(c, -0.05));
    I.panelR(0.9, h / 2 + 0.04, h - 0.12, 6, 50, shade(c, -0.05));
    for (const v of [h / 2 - 0.12, h / 2 + 0.12]) { const [x, y] = I.at(0.9, v, 28); I.px.rect(x, y, 1, 4, hex('#e2c387')); }
    I.box(0.06, 0.02, 0.94, h - 0.02, 54, 57, shade(c, -0.15));
  } else if (k === 'bau') {
    I.box(0.12, 0.18, 0.9, 0.85, 0, 13, c, { grain: 4 });
    I.box(0.1, 0.16, 0.92, 0.87, 13, 18, shade(c, 0.05));
    I.panelL(0.15, 0.88, 0.87, 12, 14, hex('#6b4d3c'));
    { const [x, y] = I.at(0.52, 0.87, 12); I.px.rect(x - 1, y - 1, 3, 4, hex('#e3c087')); I.px.set(x, y + 1, hex('#7b5a3c')); }
  } else if (k === 'tapete') {
    I.top(0.12, 0.12, w - 0.12, h - 0.12, 1, shade(c, -0.2));
    I.top(0.2, 0.2, w - 0.2, h - 0.2, 1, c);
    I.top(0.42, 0.42, w - 0.42, h - 0.42, 1, shade(c, 0.18));
    if (w >= 2 && h >= 2) I.top(w / 2 - 0.25, h / 2 - 0.25, w / 2 + 0.25, h / 2 + 0.25, 1, shade(c, -0.12));
    px.speckle(o.x * 31 + o.y, 0.05, shade(c, -0.3));
  } else if (k === 'terminal') {
    // Desk + monitor (screen glows) + keyboard + mug.
    I.box(0.05, 0.08, 0.95, 0.92, 22, 25, wood);
    for (const [u, v] of [[0.12, 0.85], [0.88, 0.85], [0.88, 0.15]]) I.box(u - 0.05, v - 0.05, u + 0.03, v + 0.03, 0, 22, darkWood, { edge: false });
    I.box(0.25, 0.15, 0.45, 0.75, 25, 27, hex('#5d5868'));
    I.box(0.3, 0.12, 0.38, 0.8, 27, 47, hex('#4a4656'));
    I.panelR(0.38, 0.17, 0.75, 30, 45, hex('#8fd0c3'));
    for (let z = 33; z < 44; z += 3) { const [x, y] = I.at(0.38, 0.28, z); I.px.line(x, y, x + 4 + (z % 4), y + 2, hex('#d8f3e6')); }
    I.top(0.55, 0.3, 0.8, 0.7, 25.5, hex('#d8d0c4'));
    I.ellipseTop(0.75, 0.82, 27, 2, 1, hex('#c96f5f'));
  } else if (k === 'mesa') {
    I.box(0.04, 0.1, w - 0.04, 0.92, 21, 25, c, { grain: 0 });
    for (const [u, v] of [[0.1, 0.86], [w - 0.1, 0.86], [w - 0.1, 0.16], [0.1, 0.16]]) I.box(u - 0.05, v - 0.05, u + 0.04, v + 0.04, 0, 21, shade(c, -0.25), { edge: false });
    I.box(0.2, 0.2, 0.55, 0.55, 25, 33, hex('#e8d9b8'));
    I.box(0.25, 0.25, 0.5, 0.5, 33, 35, hex('#c3a2b0'));
    I.ellipseTop(0.9, 0.5, 26, 3, 2, hex('#7f9fb3'));
    { const [x, y] = I.at(0.9, 0.5, 26); I.px.rect(x - 1, y - 8, 1, 7, hex('#d85f4f')); I.px.rect(x + 1, y - 7, 1, 6, hex('#4f8fd8')); I.px.rect(x, y - 9, 1, 8, hex('#e2c46f')); }
    I.top(1.2, 0.3, 1.75, 0.75, 25.5, hex('#f6f0e2'));
    for (let i = 0; i < 3; i++) { const [x, y] = I.at(1.3 + i * 0.12, 0.45, 26); I.px.set(x, y, hex(['#d85f4f', '#4f8fd8', '#7fb069'][i])); }
  } else if (k === 'diario') {
    I.box(0.12, 0.12, 0.9, 0.9, 19, 22, c);
    for (const [u, v] of [[0.18, 0.84], [0.84, 0.84], [0.84, 0.18]]) I.box(u - 0.04, v - 0.04, u + 0.03, v + 0.03, 0, 19, shade(c, -0.3), { edge: false });
    I.top(0.3, 0.3, 0.75, 0.72, 22.5, hex('#f6efe3'));
    { const [a, b] = I.at(0.52, 0.3, 23), [c2, d] = I.at(0.52, 0.72, 23); I.px.line(a, b, c2, d, hex('#a58aa0')); }
    for (let i = 0; i < 3; i++) { const [x, y] = I.at(0.36, 0.42 + i * 0.09, 23); I.px.line(x, y, x + 4, y + 2, hex('#b9a9b8')); }
    { const [x, y] = I.at(0.8, 0.5, 23); I.px.line(x, y, x + 3, y - 6, hex('#4a3f55')); }
    I.ellipseTop(0.22, 0.7, 23, 2, 1, hex('#f2d27a'));
  } else if (k === 'estante' || k === 'estante_grande') {
    I.box(0.1, 0.2, w - 0.1, 0.85, 0, 56, c, { edge: true });
    for (const z of [3, 18, 33]) { I.panelL(0.16, w - 0.16, 0.85, z, z + 13, shade(c, -0.42)); books(I, 0.18, w - 0.18, 0.85, z, o.x * 3 + z); }
    I.box(0.08, 0.18, w - 0.08, 0.87, 56, 59, shade(c, -0.12));
    if (look.artwork) placeArt(px, I, look.artwork, 0.35, 0.86, 48, 10, 'L');
  } else if (k === 'atelie' || k === 'cavalete') {
    // Easel legs, canvas with the exposed work (real pixels) and a palette stool.
    const leg = hex('#8f6b52');
    { const [a, b] = I.at(0.3, 0.75, 0), [c2, d] = I.at(0.5, 0.45, 50); I.px.line(a, b, c2, d, leg); I.px.line(a + 1, b, c2 + 1, d, leg); }
    { const [a, b] = I.at(0.8, 0.45, 0), [c2, d] = I.at(0.5, 0.45, 50); I.px.line(a, b, c2, d, leg); }
    { const [a, b] = I.at(0.45, 0.2, 0), [c2, d] = I.at(0.5, 0.45, 48); I.px.line(a, b, c2, d, shade(leg, -0.2)); }
    I.left(0.18, 0.82, 0.55, 18, 44, hex('#efe6d2'));
    I.left(0.18, 0.82, 0.56, 17, 18, leg);
    if (look.artwork) placeArt(px, I, look.artwork, 0.22, 0.56, 42, 22, 'L');
    else { const [x, y] = I.at(0.4, 0.56, 33); I.px.line(x, y, x + 6, y + 1, hex('#c3a2b0')); I.px.line(x + 2, y + 3, x + 8, y + 5, hex('#9db39c')); }
    if (k === 'atelie') { I.ellipseTop(0.85, 0.85, 8, 5, 2.5, hex('#d9b98a'), 0.3); for (let i = 0; i < 4; i++) { const [x, y] = I.at(0.78 + i * 0.05, 0.82, 9); I.px.set(x, y, hex(['#d85f4f', '#4f8fd8', '#f2d27a', '#7fb069'][i])); } }
  } else if (k === 'higiene') {
    // Bathtub in two layers: the back/inside (with water) and the front rim drawn over her when bathing.
    I.box(0.05, 0.12, w - 0.05, 0.9, 0, 4, shade(metal, -0.2));
    I.box(0.08, 0.15, w - 0.08, 0.88, 4, 17, hex('#eef3f2'));
    I.top(0.18, 0.25, w - 0.18, 0.78, 17, hex('#7fb9c4'));
    I.top(0.22, 0.29, w - 0.22, 0.74, 14, hex('#a6d6dc'));
    { const [x, y] = I.at(w - 0.2, 0.3, 17); I.px.rect(x, y - 8, 2, 8, metal); I.px.rect(x - 3, y - 9, 5, 2, metal); }
    const back = finish(px, I);
    const f = canvasFor(w, h);
    f.I.left(0.08, w - 0.08, 0.88, 4, 17, hex('#eef3f2'));
    f.I.right(w - 0.08, 0.15, 0.88, 4, 17, shade(hex('#eef3f2'), -0.1));
    f.I.top(0.08, 0.78, w - 0.08, 0.88, 17, hex('#ffffff'));
    for (let i = 0; i < 6; i++) { const [x, y] = f.I.at(0.3 + i * 0.25, 0.8, 18); f.px.ellipse(x, y, 2, 1.5, hex('#ffffff'), 0.2); }
    return { ...back, front: { canvas: f.px.canvas(), ox: f.I.ox, oy: f.I.oy } };
  } else if (k === 'pia_banheiro') {
    I.box(0.2, 0.15, 0.85, 0.75, 0, 20, hex('#d8cfc3'));
    I.box(0.15, 0.12, 0.88, 0.78, 20, 24, hex('#f1ede6'));
    I.ellipseTop(0.5, 0.45, 24.5, 5, 2.5, hex('#bcd9dc'));
    { const [x, y] = I.at(0.5, 0.18, 24); I.px.rect(x, y - 5, 2, 5, metal); }
    // Mirror on the wall behind.
    I.left(0.25, 0.8, 0.08, 32, 52, hex('#a8c6cf'));
    { const [a, b] = I.at(0.35, 0.08, 48), [c2, d] = I.at(0.5, 0.08, 38); I.px.line(a, b, c2, d, hex('#e3f1f3')); }
  } else if (k === 'toalheiro') {
    I.box(0.3, 0.3, 0.7, 0.7, 0, 3, metal);
    { const [x, y] = I.at(0.5, 0.5, 3); I.px.rect(x, y - 30, 1, 30, metal); }
    I.box(0.25, 0.35, 0.75, 0.55, 18, 30, c);
    I.box(0.28, 0.4, 0.72, 0.6, 12, 24, shade(c, 0.25));
  } else if (k === 'sofa' || k === 'poltrona' || k === 'banco') {
    const out = k === 'banco';
    const base = out ? hex(o.color) : c;
    if (out) {
      I.box(0.1, 0.3, w - 0.1, 0.8, 9, 12, base, { grain: 0 });
      for (const u of [0.25, w - 0.25]) I.box(u - 0.06, 0.4, u + 0.06, 0.7, 0, 9, hex('#4d4a52'));
      I.box(0.1, 0.18, w - 0.1, 0.3, 12, 26, base);
    } else {
      I.box(0.08, 0.15, w - 0.08, 0.9, 0, 9, shade(base, -0.25));
      I.box(0.1, 0.18, w - 0.1, 0.88, 9, 14, base);
      I.box(0.08, 0.1, w - 0.08, 0.32, 9, 28, shade(base, -0.06));
      I.box(0.02, 0.12, 0.2, 0.9, 9, 21, shade(base, -0.1));
      I.box(w - 0.2, 0.12, w - 0.02, 0.9, 9, 21, shade(base, -0.1));
      for (let u = 0.25; u < w - 0.25; u += k === 'sofa' ? 0.8 : 1) I.box(u, 0.34, Math.min(w - 0.22, u + 0.72), 0.86, 14, 17, shade(base, 0.12));
      I.ellipseTop(w - 0.45, 0.42, 21, 4, 3, shade(base, 0.3), 0.3);
    }
  } else if (k === 'mesa_centro') {
    I.box(0.15, 0.15, 0.85, 0.85, 10, 13, wood);
    for (const [u, v] of [[0.22, 0.78], [0.78, 0.78], [0.78, 0.22]]) I.box(u - 0.04, v - 0.04, u + 0.03, v + 0.03, 0, 10, darkWood, { edge: false });
    I.ellipseTop(0.4, 0.45, 14, 3, 1.5, hex('#f3e8d6'));
    I.top(0.55, 0.55, 0.75, 0.72, 13.5, hex('#c96f5f'));
    if (look.artwork) placeArt(px, I, look.artwork, 0.45, 0.6, 22, 7, 'L');
  } else if (k === 'descanso') {
    I.ellipseTop(0.5, 0.5, 3, 13, 7, shade(c, -0.25));
    I.ellipseTop(0.5, 0.5, 6, 12, 6, c, 0.3);
    { const [x, y] = I.at(0.5, 0.5, 6); I.px.set(x, y, shade(c, -0.35)); I.px.line(x - 6, y, x - 2, y, shade(c, -0.15)); }
  } else if (k === 'planta') {
    I.box(0.3, 0.3, 0.7, 0.7, 0, 11, hex('#c48e72'));
    I.box(0.28, 0.28, 0.72, 0.72, 11, 13, hex('#a8735a'));
    I.ellipseTop(0.5, 0.5, 13, 5, 2, hex('#5a4a3a'));
    leaves(px, I, 0.5, 0.5, 14, hex('#7ea06c'), 18, o.x + o.y);
  } else if (k === 'luminaria') {
    I.ellipseTop(0.5, 0.5, 1, 4, 2, hex('#6d5f55'), 0.3);
    { const [x, y] = I.at(0.5, 0.5, 1); I.px.rect(x, y - 38, 1, 38, hex('#5d5048')); I.px.poly([[x - 6, y - 38], [x + 7, y - 38], [x + 4, y - 48], [x - 3, y - 48]], hex(look.lit ? '#ffe7b0' : o.color)); I.px.line(x - 6, y - 38, x + 7, y - 38, shade(hex(o.color), -0.35)); }
  } else if (k === 'geladeira') {
    I.box(0.15, 0.15, 0.9, 0.85, 0, 50, c);
    { const [a, b] = I.at(0.9, 0.2, 30), [c2, d] = I.at(0.9, 0.8, 30); I.px.line(a, b, c2, d, shade(c, -0.3)); }
    { const [x, y] = I.at(0.9, 0.3, 36); I.px.rect(x, y, 1, 8, hex('#9aa4a8')); }
    { const [x, y] = I.at(0.9, 0.3, 22); I.px.rect(x, y, 1, 5, hex('#9aa4a8')); }
    I.top(0.3, 0.3, 0.55, 0.55, 50.5, hex('#d7bc91'));
  } else if (k === 'comida') {
    // Counter with a food bowl, a water bowl and a jar of greens.
    I.box(0.05, 0.12, w - 0.05, 0.9, 0, 20, hex('#c8a57f'));
    I.panelL(0.12, w / 2 - 0.05, 0.9, 3, 17, shade(hex('#c8a57f'), -0.18));
    I.panelL(w / 2 + 0.05, w - 0.12, 0.9, 3, 17, shade(hex('#c8a57f'), -0.18));
    I.box(0.02, 0.1, w - 0.02, 0.92, 20, 23, hex('#efe4d0'));
    I.ellipseTop(0.55, 0.55, 24, 6, 3, hex('#e7d7b5'));
    I.ellipseTop(0.55, 0.55, 25, 4, 2, hex('#9e7c50'));
    for (let i = 0; i < 4; i++) { const [x, y] = I.at(0.48 + i * 0.05, 0.5, 26); I.px.set(x, y, hex(i % 2 ? '#7fb069' : '#e98c3a')); }
    I.ellipseTop(1.35, 0.55, 24, 6, 3, hex('#d9e6e8'));
    I.ellipseTop(1.35, 0.55, 25, 4, 2, hex('#7fbfd0'));
    I.box(1.7, 0.2, 1.85, 0.4, 23, 33, hex('#cfe0d4'));
    leaves(px, I, 1.77, 0.3, 34, hex('#7fb069'), 6, 3);
  } else if (k === 'pia_cozinha' || k === 'fogao') {
    I.box(0.05, 0.12, 0.95, 0.9, 0, 20, hex('#c8a57f'));
    I.panelL(0.12, 0.88, 0.9, 3, 17, shade(hex('#c8a57f'), -0.18));
    I.box(0.02, 0.1, 0.98, 0.92, 20, 23, hex('#efe4d0'));
    if (k === 'pia_cozinha') { I.top(0.25, 0.3, 0.75, 0.75, 23.2, hex('#9fb6bc')); const [x, y] = I.at(0.5, 0.2, 23); I.px.rect(x, y - 6, 1, 6, metal); I.px.rect(x, y - 6, 4, 1, metal); }
    else { for (const [u, v] of [[0.32, 0.35], [0.68, 0.35], [0.32, 0.7], [0.68, 0.7]]) I.ellipseTop(u, v, 23.5, 3, 1.5, hex('#4a4656')); I.panelL(0.2, 0.8, 0.9, 6, 14, hex('#5a5560')); }
  } else if (k === 'mesa_cozinha') {
    I.box(0.08, 0.15, w - 0.08, 0.85, 18, 21, c);
    for (const [u, v] of [[0.15, 0.8], [w - 0.15, 0.8], [w - 0.15, 0.2]]) I.box(u - 0.04, v - 0.04, u + 0.03, v + 0.03, 0, 18, shade(c, -0.3), { edge: false });
    I.ellipseTop(0.6, 0.5, 21.5, 4, 2, hex('#f3e8d6'));
    I.ellipseTop(1.3, 0.45, 22, 3, 2, hex('#e0574f'), 0.3);
    I.box(0.35, 0.92, 0.75, 1.0, 0, 12, shade(c, -0.15));
    if (look.artwork) placeArt(px, I, look.artwork, 1.1, 0.6, 30, 8, 'L');
  } else if (k === 'canteiro') {
    I.box(0.06, 0.06, 0.94, 0.94, 0, 6, hex('#8a6149'), { grain: 0 });
    I.top(0.14, 0.14, 0.86, 0.86, 6, look.plant?.moist ? hex('#4e3a2c') : hex('#6b4f3a'));
    px.speckle(o.x * 7 + o.y, 0.12, hex('#5a4231'));
    const p = look.plant;
    if (p) drawCrop(px, I, p.stage, hex(p.color));
  } else if (k === 'arvore') {
    I.ellipseTop(0.5, 0.5, 0, 14, 7, [35, 22, 40, 60]);
    { const [x, y] = I.at(0.5, 0.5, 0); I.px.rect(x - 2, y - 30, 5, 30, hex('#7a5a43')); I.px.rect(x - 2, y - 30, 2, 30, hex('#5e4433')); }
    const s = look.season ?? 'primavera';
    const leaf = s === 'outono' ? hex('#d98a3d') : s === 'inverno' ? hex('#c9d3d6') : s === 'verao' ? hex('#5f9a52') : hex('#7fb069');
    const [x, y] = I.at(0.5, 0.5, 44);
    if (s !== 'inverno') {
      px.ellipse(x - 6, y + 4, 11, 9, leaf, 0.3); px.ellipse(x + 6, y + 2, 11, 10, leaf, 0.3); px.ellipse(x, y - 7, 12, 10, leaf, 0.35);
      px.speckle(o.x * 13, 0.05, shade(leaf, -0.3), [x - 18, y - 18, 36, 30]);
      if (s === 'primavera') px.speckle(o.y * 17 + 3, 0.04, hex('#f6c6d6'), [x - 18, y - 18, 36, 30]);
    } else { for (const [dx, dy] of [[-8, -6], [7, -9], [0, -14], [-12, 2], [11, 0]]) px.line(x, y + 8, x + dx, y + dy, hex('#6e5444')); px.ellipse(x, y - 6, 9, 3, hex('#f4f7f8')); }
  } else if (k === 'flores') {
    for (let i = 0; i < 9; i++) {
      const u = 0.15 + ((i * 37) % 70) / 100, v = 0.15 + ((i * 53) % 70) / 100;
      const [x, y] = I.at(u, v, 0);
      px.line(x, y, x, y - 4, hex('#6f9a5e'));
      px.set(x - 1, y - 2, hex('#7fb069'));
      const col = i % 3 === 0 ? shade(c, 0.3) : c;
      px.set(x, y - 5, col); px.set(x - 1, y - 5, col); px.set(x + 1, y - 5, col); px.set(x, y - 6, col); px.set(x, y - 5, hex('#f6e7a1'));
    }
  } else if (k === 'telescopio') {
    { const [a, b] = I.at(0.3, 0.8, 0), [c2, d] = I.at(0.5, 0.5, 26); px.line(a, b, c2, d, hex('#4d4a52')); }
    { const [a, b] = I.at(0.8, 0.7, 0), [c2, d] = I.at(0.5, 0.5, 26); px.line(a, b, c2, d, hex('#4d4a52')); }
    { const [a, b] = I.at(0.5, 0.2, 0), [c2, d] = I.at(0.5, 0.5, 26); px.line(a, b, c2, d, hex('#3c3a42')); }
    const [x, y] = I.at(0.5, 0.5, 28);
    for (let t = 0; t < 14; t++) px.ellipse(x - 8 + t, y + 4 - t * 0.7, 2.6 - t * 0.05, 2.6 - t * 0.05, hex('#b98a6b'), 0.3);
    px.ellipse(x + 6, y - 6, 3, 3, hex('#e2c387'), 0.3);
  } else if (k === 'toca_discos' || k === 'piano') {
    if (k === 'piano') {
      I.box(0.08, 0.2, w - 0.08, 0.8, 0, 22, hex('#3f3a44'));
      I.top(0.15, 0.55, w - 0.15, 0.78, 22.5, hex('#f6f2ea'));
      for (let u = 0.2; u < w - 0.15; u += 0.12) { const [x, y] = I.at(u, 0.6, 23); px.set(x, y, hex('#2a2530')); px.set(x + 1, y, hex('#2a2530')); }
      I.box(0.08, 0.15, w - 0.08, 0.35, 22, 34, hex('#4a4450'));
    } else {
      I.box(0.15, 0.15, 0.85, 0.85, 0, 18, c);
      I.box(0.12, 0.12, 0.88, 0.88, 18, 22, hex('#4a3f3a'));
      I.ellipseTop(0.45, 0.5, 22.5, 7, 3.5, hex('#1f1b22'));
      I.ellipseTop(0.45, 0.5, 23, 2, 1, hex('#d85f4f'));
      { const [x, y] = I.at(0.78, 0.3, 23); px.line(x, y, x - 5, y + 4, metal); }
    }
  } else if (k === 'aquario') {
    I.box(0.15, 0.15, 0.85, 0.85, 0, 16, darkWood);
    I.box(0.12, 0.2, 0.88, 0.8, 16, 36, hex('#9fd3e0'), { edge: false });
    px.speckle(o.x + 5, 0.05, hex('#d7f1f6'), [0, 0, px.w, px.h - 30]);
    { const [x, y] = I.at(0.5, 0.8, 26); px.ellipse(x - 3, y, 2, 1, hex('#f29a4a')); px.ellipse(x + 4, y - 4, 2, 1, hex('#f2d27a')); }
    leaves(px, I, 0.3, 0.6, 17, hex('#5f9a52'), 8, 2);
  } else if (k === 'vitrine') {
    I.box(0.12, 0.25, 0.88, 0.8, 0, 46, c);
    for (const z of [6, 20, 34]) I.panelL(0.18, 0.82, 0.8, z, z + 11, hex('#cfe3e6'));
    if (look.artwork) placeArt(px, I, look.artwork, 0.32, 0.81, 30, 9, 'L');
  } else {
    // decoracao: a vase with a little arrangement.
    I.ellipseTop(0.5, 0.5, 0, 6, 3, [35, 22, 40, 60]);
    { const [x, y] = I.at(0.5, 0.5, 0); px.ellipse(x, y - 7, 5, 7, c, 0.35); px.rect(x - 2, y - 15, 5, 2, shade(c, -0.2)); }
    leaves(px, I, 0.5, 0.5, 15, hex('#7fb069'), 8, o.x);
  }
  if (k !== 'tapete' && k !== 'flores' && k !== 'canteiro') px.outline(outline);
  return finish(px, I);
}

function leaves(px: Px, I: Iso, u: number, v: number, z: number, c: RGBA, size: number, seed: number) {
  const [x, y] = I.at(u, v, z);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + seed;
    const r = size * (0.35 + ((i * 13 + seed) % 5) * 0.08);
    const lx = x + Math.cos(a) * r * 0.7, ly = y - size * 0.5 + Math.sin(a) * r * 0.45;
    px.line(x, y, lx, ly, shade(c, -0.25));
    px.ellipse(lx, ly, 3.2, 1.8, i % 2 ? c : shade(c, 0.15), 0.25, a);
  }
}
function drawCrop(px: Px, I: Iso, stage: number, fruit: RGBA) {
  const green = hex('#6faa55');
  for (let i = 0; i < 4; i++) {
    const [x, y] = I.at(0.3 + (i % 2) * 0.4, 0.3 + Math.floor(i / 2) * 0.4, 6);
    if (stage === 0) { px.set(x, y, hex('#3b2a1e')); px.set(x + 1, y, hex('#3b2a1e')); continue; }
    const hgt = [0, 3, 7, 10, 12][stage];
    px.line(x, y, x, y - hgt, shade(green, -0.15));
    px.ellipse(x - 2, y - hgt / 2, 2, 1, green); px.ellipse(x + 2, y - hgt / 2 - 1, 2, 1, green);
    if (stage >= 3) px.ellipse(x, y - hgt, 2, 1.5, green, 0.2);
    if (stage === 4) { px.ellipse(x, y - hgt - 1, 2, 2, fruit, 0.3); px.set(x - 1, y - hgt - 2, shade(fruit, 0.5)); }
  }
}
/** Paints a work (its real pixels, scaled down) on a sprite face, with a thin frame. */
function placeArt(px: Px, I: Iso, art: HTMLCanvasElement, u: number, v: number, zTop: number, size: number, face: 'L' | 'R') {
  const ctx = art.getContext('2d')!;
  const data = ctx.getImageData(0, 0, art.width, art.height).data;
  const n = size;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const sx = Math.floor((i / n) * art.width), sy = Math.floor((j / n) * art.height);
      const k = (sy * art.width + sx) * 4;
      const col: RGBA = [data[k], data[k + 1], data[k + 2], 255];
      const [x, y] = face === 'L' ? I.at(u + i / 16 / 2, v, zTop - j) : I.at(u, v + i / 16 / 2, zTop - j);
      px.set(x, y, col);
    }
  const [x0, y0] = I.at(u, v, zTop + 1), [x1, y1] = I.at(u + n / 32, v, zTop + 1);
  px.line(x0, y0, x1, y1, hex('#6b4d3c'));
  px.line(x0, y0 + n + 1, x1, y1 + n + 1, hex('#6b4d3c'));
}

/** Window or frame hanging on a wall plane (back = along x, left = along y). */
function drawWallPiece(o: HouseObject, look: Look): Sprite {
  const side = wallSide(o) ?? 'back';
  const { px, I } = canvasFor(1, 1);
  const outer = o.y === 0 || o.x === 0;
  const zBase = outer ? 18 : 6, zTop = outer ? 50 : 26;
  const plane = (a: number, b: number, z0: number, z1: number, c: RGBA | 'clear' | ((x: number, y: number) => RGBA)) => (side === 'back' ? I.left(a, b, 0.02, z0, z1, c) : I.right(0.02, a, b, z0, z1, c));
  const pt = (t: number, z: number) => (side === 'back' ? I.at(t, 0.02, z) : I.at(0.02, t, z));
  if (o.kind === 'janela') {
    const frame = hex(o.color);
    plane(0.1, 0.9, zBase - 2, zTop + 2, frame);
    // Glass is a hole: the sky behind the wall shows through. Mullions, sill and curtains:
    plane(0.16, 0.84, zBase + 1, zTop - 1, 'clear');
    { const [a, b] = pt(0.5, zBase + 1), [c2, d] = pt(0.5, zTop - 1); px.line(a, b, c2, d, frame); }
    { const [a, b] = pt(0.16, (zBase + zTop) / 2), [c2, d] = pt(0.84, (zBase + zTop) / 2); px.line(a, b, c2, d, frame); }
    plane(0.06, 0.94, zBase - 4, zBase - 2, shade(frame, -0.2));
    const curtain = hex('#e9d7c8');
    plane(0.04, 0.16, zBase, zTop + 4, curtain);
    plane(0.84, 0.96, zBase, zTop + 4, curtain);
    plane(0.04, 0.96, zTop + 4, zTop + 6, shade(frame, -0.3));
  } else {
    // Frame with the exposed work, or an empty mat.
    const frame = hex(o.color);
    const z0 = outer ? 24 : 9, z1 = outer ? 44 : 25;
    plane(0.22, 0.78, z0 - 2, z1 + 2, frame);
    plane(0.27, 0.73, z0, z1, hex('#efe6d2'));
    if (look.artwork) {
      const ctx = look.artwork.getContext('2d')!;
      const d = ctx.getImageData(0, 0, look.artwork.width, look.artwork.height).data;
      const n = z1 - z0;
      for (let j = 0; j < n; j++) for (let i = 0; i < 16; i++) {
        const sx = Math.floor((i / 16) * look.artwork.width), sy = Math.floor((j / n) * look.artwork.height), k = (sy * look.artwork.width + sx) * 4;
        const t = 0.28 + (i / 16) * 0.44;
        const [x, y] = pt(t, z1 - j);
        px.set(x, y, [d[k], d[k + 1], d[k + 2], 255]);
      }
    }
  }
  px.outline(outline);
  return finish(px, I);
}

/** Walls of the house: outer back walls (with window holes) and interior walls per segment. */
export function drawBackWalls(objects: HouseObject[], colors: Partial<Record<RoomId, string>>): Sprite {
  const px = new Px(WORLD_W, WORLD_H);
  const I = new Iso(px, OX, OY);
  const roomColor = (x: number, y: number) => hex(colors[(rooms.find((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1)?.id ?? 'sala') as RoomId] ?? defaultWalls[(rooms.find((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1)?.id ?? 'sala') as RoomId]);
  // Back wall along y = 0 (x 0..19) and left wall along x = 0 (y 0..10).
  for (let x = 0; x < GRID.w; x++) {
    const c = roomColor(x, 0);
    I.left(x, x + 1, 0, 0, WALL_H, (px2, py) => ((px2 + py) % 7 === 0 ? shade(c, -0.05) : c));
    I.left(x, x + 1, 0, 0, 16, shade(c, -0.14));
    I.left(x, x + 1, 0, 0, 3, shade(hex('#8a6149'), 0));
    I.left(x, x + 1, 0, 16, 17, shade(c, -0.3));
  }
  for (let y = 0; y <= 10; y++) {
    const c = roomColor(0, y);
    I.right(0, y, y + 1, 0, WALL_H, (px2, py) => ((px2 - py) % 7 === 0 ? shade(c, -0.12) : shade(c, -0.08)));
    I.right(0, y, y + 1, 0, 16, shade(c, -0.22));
    I.right(0, y, y + 1, 0, 3, shade(hex('#8a6149'), -0.1));
    I.right(0, y, y + 1, 16, 17, shade(c, -0.36));
  }
  // Wall caps (thickness on top) and the corner post.
  I.top(0, -0.12, GRID.w, 0, WALL_H, hex('#7c6372'));
  I.top(-0.12, -0.12, 0, 11, WALL_H, hex('#6d5565'));
  // Window holes (the sky shows through).
  for (const o of objects) if (o.kind === 'janela') {
    const side = wallSide(o);
    if (side === 'back') I.left(o.x + 0.16, o.x + 0.84, 0, 19, 49, 'clear');
    else I.right(0, o.y + 0.16, o.y + 0.84, 19, 49, 'clear');
  }
  return { canvas: px.canvas(), ox: 0, oy: 0 };
}
/** One interior wall piece on a cell edge (its own sprite, for depth and fading). */
export function drawInnerWall(axis: 'v' | 'h', a: number, b: number, color: string, low = false): Sprite {
  const hgt = low ? FRONT_H : INNER_H;
  const px = new Px(40, hgt + 28);
  const I = new Iso(px, 20, hgt + 8);
  const c = hex(color);
  if (axis === 'h') {
    I.left(0, 1, 0.06, 0, hgt, shade(c, -0.1));
    I.left(0, 1, 0.06, 0, Math.min(hgt, 9), shade(c, -0.22));
    I.top(0, -0.06, 1, 0.06, hgt, hex('#9b8191'));
  } else {
    I.right(0.06, 0, 1, 0, hgt, shade(c, -0.18));
    I.right(0.06, 0, 1, 0, Math.min(hgt, 9), shade(c, -0.3));
    I.top(-0.06, 0, 0.06, 1, hgt, hex('#8f7586'));
  }
  void a; void b;
  return { canvas: px.canvas(), ox: 20, oy: hgt + 8 };
}
/** Door frame posts at a doorway (so doorways read as doors, not missing wall). */
export function drawDoorFrame(axis: 'v' | 'h', low: boolean): Sprite {
  const hgt = low ? 26 : INNER_H + 4;
  const px = new Px(40, hgt + 28);
  const I = new Iso(px, 20, hgt + 8);
  const post = hex('#8a6149');
  if (axis === 'h') { I.box(-0.04, -0.04, 0.06, 0.06, 0, hgt, post); I.box(0.94, -0.04, 1.04, 0.06, 0, hgt, post); I.box(-0.04, -0.06, 1.04, 0.06, hgt - 3, hgt, post); }
  else { I.box(-0.04, -0.04, 0.06, 0.06, 0, hgt, post); I.box(-0.04, 0.94, 0.06, 1.04, 0, hgt, post); I.box(-0.06, -0.04, 0.06, 1.04, hgt - 3, hgt, post); }
  return { canvas: px.canvas(), ox: 20, oy: hgt + 8 };
}
export const pathCells = (() => {
  const set = new Set<string>();
  for (let x = 4; x <= 15; x++) set.add(`${x},12`);
  for (const p of ['4,11', '15,11', '10,13', '9,13', '12,13', '12,14', '13,15']) set.add(p);
  return set;
})();
/** Floors: planks, tiles, grass and stone path; the outdoor ground follows the season. */
export function drawFloor(season: string): Sprite {
  const px = new Px(WORLD_W, WORLD_H);
  const I = new Iso(px, OX, OY);
  const grass = season === 'inverno' ? hex('#c7d1c4') : season === 'outono' ? hex('#a9a764') : season === 'verao' ? hex('#86b061') : hex('#8fbf6a');
  // Ground beyond the house (a lawn that fades out) — drawn first.
  // The lawn surrounds the house (not behind the back walls) and fades into the far ground.
  const farGround = mix(shade(grass, -0.35), hex('#5f6f62'), 0.4);
  for (let x = -9; x < GRID.w + 9; x++)
    for (let y = -2; y < GRID.h + 9; y++) {
      if (x >= 0 && x < GRID.w && y >= 0 && y < GRID.h) continue;
      if (x < 0 && y < 11) continue;
      if (y < 0) continue;
      const far = Math.max(-x - 1, x - GRID.w, y - GRID.h, 0);
      const t = Math.min(1, far / 7);
      const base = (x + y) % 2 ? shade(grass, -0.06) : shade(grass, -0.02);
      I.top(x, y, x + 1, y + 1, 0, mix(base, farGround, t));
    }
  for (let x = 0; x < GRID.w; x++)
    for (let y = 0; y < GRID.h; y++) {
      const r = rooms.find((q) => x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1)!;
      const key = `${x},${y}`;
      if (r.id === 'jardim') {
        if (pathCells.has(key)) {
          I.top(x, y, x + 1, y + 1, 0, shade(grass, -0.08));
          for (const [du, dv, s] of [[0.15, 0.15, 0.32], [0.55, 0.2, 0.28], [0.25, 0.55, 0.3], [0.6, 0.58, 0.3]]) I.top(x + du, y + dv, x + du + s, y + dv + s, 0, (x * 3 + y + du * 10) % 2 ? hex('#cdbfae') : hex('#bfb09f'));
        } else {
          I.top(x, y, x + 1, y + 1, 0, (x + y) % 2 ? grass : shade(grass, 0.05));
        }
        continue;
      }
      if (r.id === 'banheiro' || r.id === 'cozinha') {
        const a = r.id === 'banheiro' ? hex('#e6eeec') : hex('#e8d3b4'), b = r.id === 'banheiro' ? hex('#c9dcdc') : hex('#c99a73');
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) I.top(x + i / 2, y + j / 2, x + (i + 1) / 2, y + (j + 1) / 2, 0, (i + j + x + y) % 2 ? a : b);
        continue;
      }
      const plank = r.id === 'estudio' ? hex('#b78e72') : r.id === 'quarto' ? hex('#c09a80') : hex('#b9906f');
      for (let i = 0; i < 4; i++) {
        const tone = (x * 5 + y * 3 + i * 7) % 3;
        I.top(x + i / 4, y, x + (i + 1) / 4, y + 1, 0, tone === 0 ? plank : tone === 1 ? shade(plank, 0.06) : shade(plank, -0.06));
      }
      const [a1, b1] = I.at(x, y + 1, 0), [a2, b2] = I.at(x + 1, y + 1, 0);
      px.line(a1, b1 - 1, a2, b2 - 1, shade(plank, -0.2));
      if ((x * 7 + y * 11) % 5 === 0) { const [kx, ky] = I.at(x + 0.6, y + 0.4, 0); px.set(kx, ky, shade(plank, -0.3)); }
    }
  grassTufts(px, I, grass);
  return { canvas: px.canvas(), ox: 0, oy: 0 };
}
function grassTufts(px: Px, I: Iso, grass: RGBA) {
  for (let i = 0; i < 260; i++) {
    const x = ((i * 7919) % 2400) / 100 - 2, y = 11 + ((i * 104729) % 700) / 100 - 0.5;
    if (x >= 0 && x < GRID.w && pathCells.has(`${Math.floor(x)},${Math.floor(y)}`)) continue;
    const [sx, sy] = I.at(x, y, 0);
    px.set(sx, sy, shade(grass, -0.22)); px.set(sx + 1, sy - 1, shade(grass, -0.12)); px.set(sx - 1, sy - 1, shade(grass, 0.12));
  }
}
/** Low fence around the garden edges. */
export function drawFence(axis: 'v' | 'h'): Sprite {
  const px = new Px(40, 40);
  const I = new Iso(px, 20, 28);
  const c = hex('#d9c3a5');
  if (axis === 'h') { for (const u of [0.1, 0.5, 0.9]) I.box(u - 0.04, -0.04, u + 0.04, 0.04, 0, 12, c); I.box(0, -0.03, 1, 0.03, 7, 9, shade(c, -0.1)); }
  else { for (const v of [0.1, 0.5, 0.9]) I.box(-0.04, v - 0.04, 0.04, v + 0.04, 0, 12, c); I.box(-0.03, 0, 0.03, 1, 7, 9, shade(c, -0.1)); }
  px.outline(outline);
  return { canvas: px.canvas(), ox: 20, oy: 28 };
}
export { walls };
