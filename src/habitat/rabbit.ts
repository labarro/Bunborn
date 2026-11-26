// The rabbit (26/11): a parametric pixel-art body drawn frame by frame (pose, ears, eyes,
// breathing, facing), so every animation keeps the same proportions and her fur colour.
// Frames are 32×32 with the feet at (16, 29). Facing 'front' looks toward the viewer-left (+y),
// 'back' looks away (−x); mirroring gives the other two isometric directions.
import { hex, Px, shade, type RGBA } from './pixel';

export type Pose = 'sit' | 'crouch' | 'leap' | 'lie' | 'eat' | 'groom' | 'rest' | 'stretch' | 'dig' | 'paw' | 'tall';
export type Eyes = 'open' | 'closed' | 'half' | 'happy' | 'big';
export type FrameSpec = { pose: Pose; facing: 'front' | 'back'; eyes?: Eyes; breath?: number; earL?: number; earR?: number; nose?: number; step?: number };
export const FRAME = 32, FEET_X = 16, FEET_Y = 29;

export function drawRabbit(spec: FrameSpec, furHex: string): Px {
  const px = new Px(FRAME, FRAME);
  const fur = hex(furHex), dark = shade(fur, -0.22), light = shade(fur, 0.35);
  const belly: RGBA = hex('#fbf3f6'), pink = hex('#dca3b8'), eye = hex('#2f2740'), nose = hex('#d4859f');
  const b = spec.breath ?? 0;
  const front = spec.facing === 'front';
  // Body and head geometry per pose (centre x, y, radii).
  let body = { x: 18, y: 22.5 - b * 0.4, rx: 7.2, ry: 5.6 + b * 0.4 };
  let head = { x: 12, y: 15.5 - b * 0.5, r: 5 };
  let earBase = { x: 12.5, y: 11.5 - b * 0.5 }, earLen = 7, earTilt = 0;
  let legs = true;
  switch (spec.pose) {
    case 'crouch': body = { x: 18, y: 24, rx: 7.8, ry: 4.8 }; head = { x: 11.5, y: 18, r: 5 }; earBase = { x: 12, y: 14 }; earTilt = 0.5; break;
    case 'leap': body = { x: 17, y: 18, rx: 8.4, ry: 4.6 }; head = { x: 10, y: 12.5, r: 5 }; earBase = { x: 11, y: 8.5 }; earTilt = 0.9; legs = false; break;
    case 'lie': body = { x: 17, y: 25, rx: 9.2, ry: 4 + b * 0.3 }; head = { x: 9.5, y: 23, r: 4.8 }; earBase = { x: 11, y: 20 }; earTilt = 1.35; earLen = 7.5; legs = false; break;
    case 'eat': head = { x: 10.5, y: 18.5 + (spec.nose ?? 0) * 0.5, r: 5 }; earBase = { x: 11.5, y: 14.5 }; earTilt = 0.35; break;
    case 'rest': body = { x: 18, y: 23.5, rx: 7.8, ry: 5 + b * 0.3 }; head = { x: 12, y: 17.5, r: 5 }; earBase = { x: 13, y: 13.5 }; earTilt = 0.8; break;
    case 'stretch': body = { x: 16.5, y: 23.5, rx: 9.2, ry: 4.2 }; head = { x: 8.5, y: 20, r: 4.8 }; earBase = { x: 9.5, y: 16 }; earTilt = 0.6; break;
    case 'dig': head = { x: 10, y: 19.5, r: 5 }; earBase = { x: 11, y: 15.5 }; earTilt = 0.3; break;
    case 'tall': case 'paw': case 'groom': body = { x: 18, y: 21.5 - b * 0.4, rx: 6.6, ry: 6.6 + b * 0.4 }; head = { x: 13, y: 12.5 - b * 0.5, r: 5 }; earBase = { x: 13.5, y: 8.5 }; break;
  }
  const L = (spec.earL ?? 0) + earTilt, R = (spec.earR ?? 0) + earTilt;
  const ear = (dx: number, tilt: number, inner: boolean) => {
    // Ears lean back (toward +x) as tilt grows; drawn as rotated ellipses from the base.
    const len = earLen;
    const a = -Math.PI / 2 + tilt + (dx > 0 ? 0.12 : -0.05);
    const cx = earBase.x + dx + Math.cos(a) * len * 0.55, cy = earBase.y + Math.sin(a) * len * 0.55;
    px.ellipse(cx, cy, len * 0.62, 1.9, fur, 0.25, a);
    if (inner) px.ellipse(cx + Math.cos(a) * 0.3, cy + Math.sin(a) * 0.3 + 0.2, len * 0.42, 0.75, pink, 0, a);
  };
  // Far ear first, body, then near ear (layering gives depth).
  ear(front ? 2.2 : -1.5, R, front);
  // Tail (back view shows it fully; front view peeks out behind).
  if (!front) px.ellipse(body.x + body.rx - 1.5, body.y + 1, 2.8, 2.6, belly, 0.2);
  // Hind leg / thigh.
  if (legs) px.ellipse(body.x + 2.5, body.y + 2.6, 4.2, 3, dark, 0);
  px.ellipse(body.x, body.y, body.rx, body.ry, fur, 0.3);
  if (front) {
    // Belly and chest, lit side.
    px.ellipse(body.x - body.rx * 0.45, body.y + body.ry * 0.25, body.rx * 0.45, body.ry * 0.6, belly, 0.15);
    px.ellipse(body.x + body.rx - 1, body.y - 0.5, 2.2, 2.2, belly, 0.1);
  }
  // Feet / front paws.
  if (legs) {
    const s = spec.step ?? 0;
    if (spec.pose === 'paw' || spec.pose === 'groom') {
      const up = spec.pose === 'groom' ? 4 : 2 + s * 2;
      px.ellipse(head.x - 2.5, head.y + up, 1.8, 1.4, belly);
      px.ellipse(body.x - body.rx + 3, body.y + body.ry - 1, 1.8, 1.2, belly);
    } else if (spec.pose === 'dig') {
      px.ellipse(body.x - body.rx + 1 - s, body.y + body.ry - 0.5, 2, 1.2, belly);
      px.ellipse(body.x - body.rx + 3.5, body.y + body.ry, 1.8, 1.1, belly);
    } else {
      px.ellipse(body.x - body.rx + 2.5, body.y + body.ry - 0.6, 2, 1.2, belly);
      px.ellipse(body.x - body.rx + 5, body.y + body.ry - 0.2, 1.9, 1.1, front ? belly : dark);
    }
    px.ellipse(body.x + body.rx - 2.5, body.y + body.ry - 0.3, 2.8, 1.2, dark);
  } else if (spec.pose === 'leap') {
    px.ellipse(body.x + body.rx, body.y + 3, 3.2, 1.3, dark, 0, 0.5);
    px.ellipse(body.x - body.rx + 1, body.y + 3.5, 2.2, 1.1, belly, 0, -0.4);
  }
  // Head with cheek and muzzle.
  px.ellipse(head.x, head.y, head.r + 0.4, head.r, fur, 0.3);
  if (front) {
    px.ellipse(head.x - 2.6, head.y + 1.8, 2.4, 1.8, belly, 0.1);
    px.ellipse(head.x - 0.5, head.y + 2.6, 1.6, 0.9, shade(pink, 0.35));
  } else {
    px.ellipse(head.x + 1.2, head.y - 1.2, 2.2, 1.6, light, 0);
  }
  ear(front ? -0.6 : 1.4, L, front);
  // Face.
  if (front) {
    const ex = Math.round(head.x - 2.2), ey = Math.round(head.y - 0.8);
    const e = spec.eyes ?? 'open';
    if (e === 'closed') { px.set(ex - 1, ey + 1, eye); px.set(ex, ey + 1, eye); px.set(ex + 1, ey + 1, eye); }
    else if (e === 'half') { px.rect(ex - 1, ey, 3, 2, eye); px.set(ex - 1, ey, shade(fur, -0.1)); }
    else if (e === 'happy') { px.set(ex - 1, ey + 1, eye); px.set(ex, ey, eye); px.set(ex + 1, ey + 1, eye); }
    else if (e === 'big') { px.rect(ex - 1, ey - 1, 3, 4, eye); px.set(ex - 1, ey - 1, hex('#ffffff')); px.set(ex, ey - 1, hex('#ffffff')); }
    else { px.rect(ex - 1, ey - 1, 2, 3, eye); px.set(ex - 1, ey - 1, hex('#ffffff')); }
    const n = spec.nose ?? 0;
    px.set(Math.round(head.x - 5.1), Math.round(head.y + 1.2 - n * 0.5), nose);
    px.set(Math.round(head.x - 4.4), Math.round(head.y + 1.6 - n * 0.5), shade(nose, -0.2));
    px.set(Math.round(head.x - 3.2), Math.round(head.y + 3.3), shade(fur, -0.35));
  }
  px.outline(hex('#3a2c45'));
  return px;
}

/** Every frame the scene uses, by name. Hops, breathing, blinking, ears, activities, sleep. */
export function frameSet(): Record<string, FrameSpec> {
  const out: Record<string, FrameSpec> = {};
  for (const facing of ['front', 'back'] as const) {
    const f = (name: string, spec: Omit<FrameSpec, 'facing'>) => (out[`${facing}:${name}`] = { ...spec, facing });
    f('sit0', { pose: 'sit', breath: 0 }); f('sit1', { pose: 'sit', breath: 1 });
    f('blink', { pose: 'sit', eyes: 'closed' }); f('happy', { pose: 'sit', eyes: 'happy' }); f('big', { pose: 'sit', eyes: 'big' }); f('half', { pose: 'sit', eyes: 'half' });
    f('earL', { pose: 'sit', earL: 0.35 }); f('earR', { pose: 'sit', earR: -0.3 }); f('nose', { pose: 'sit', nose: 1 });
    f('droop', { pose: 'sit', earL: 0.9, earR: 0.9, eyes: 'half' });
    f('crouch', { pose: 'crouch' }); f('leap', { pose: 'leap' });
    f('eat0', { pose: 'eat', nose: 0 }); f('eat1', { pose: 'eat', nose: 1 });
    f('groom0', { pose: 'groom', eyes: 'closed' }); f('groom1', { pose: 'groom', eyes: 'closed', step: 1, earL: 0.2 });
    f('rest0', { pose: 'rest', eyes: 'half', breath: 0 }); f('rest1', { pose: 'rest', eyes: 'half', breath: 1 });
    f('stretch', { pose: 'stretch', eyes: 'closed' });
    f('dig0', { pose: 'dig', step: 0 }); f('dig1', { pose: 'dig', step: 1 });
    f('paw0', { pose: 'paw', step: 0 }); f('paw1', { pose: 'paw', step: 1 });
    f('tall0', { pose: 'tall', breath: 0 }); f('tall1', { pose: 'tall', breath: 1 }); f('tallBlink', { pose: 'tall', eyes: 'closed' });
    f('lie0', { pose: 'lie', eyes: 'closed', breath: 0 }); f('lie1', { pose: 'lie', eyes: 'closed', breath: 1 });
  }
  return out;
}
