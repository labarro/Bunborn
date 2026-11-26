// The house scene (26/11). Draws ONLY what the persisted state says: where she is, what she is
// doing, what she placed and exposed. Body details (breathing, blinking, ears) are local cosmetics
// and never become records. The world (sky, light, weather, season) is computed from the virtual
// clock of the state (shared/world.ts), extrapolated between polls with the state's own multiplier.
import Phaser from 'phaser';
import type { Artifact, HabitatObject, State } from '../../shared/domain';
import { GRID, cover, footprint, kindOf, pathfind, roomAt, walls, wallSide, type Point } from '../../shared/house';
import { daylightLevel, growth, isRaining, periodOf, seasonOf, skyAt, species, sun, weatherAt, type Condition } from '../../shared/world';
import { expressionFor, isActive } from '../../shared/expression';
import { paint as paintRaster } from '../paint-raster';
import { drawRabbit, frameSet, FEET_X, FEET_Y, FRAME } from './rabbit';
import { defaultWalls, drawBackWalls, drawDoorFrame, drawFence, drawFloor, drawInnerWall, drawObject, iso, OX, OY, WORLD_H, WORLD_W, type Sprite } from './sprites';
import { hex, Px, shade } from './pixel';
import type { AmbientAudio } from './audio';

export type Work = { title: string; artifact: Artifact; version: number; realAt: number };
export type CameraMode = 'geral' | 'acompanhar' | 'livre';
export type Callbacks = { onSelect: (o: HabitatObject) => void; onRabbit: () => void; onMode: (m: CameraMode) => void };
export type Debug = { vm?: number; weather?: Condition };

const D_FLOOR = 20, D_RUG = 25, D_LIGHTPATCH = 26, D_WALLS = 40, D_WALLPIECE = 45, D_FOG = 940, D_RAIN = 950, D_DARK = 960, D_LIGHT = 970, D_FLASH = 980;
const depthOf = (x: number, y: number, k = 5) => 100 + (x + y) * 10 + k;
const cellCenter = (p: Point, z = 0) => { const c = iso(p.x + 0.5, p.y + 0.5); return { x: c.x, y: c.y - z }; };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mixHex = (a: number, b: number, t: number) => {
  const ca = Phaser.Display.Color.IntegerToColor(a), cb = Phaser.Display.Color.IntegerToColor(b);
  return Phaser.Display.Color.GetColor(Math.round(lerp(ca.red, cb.red, t)), Math.round(lerp(ca.green, cb.green, t)), Math.round(lerp(ca.blue, cb.blue, t)));
};
const cloudiness: Record<Condition, number> = { limpo: 0, nublado: 0.55, neblina: 0.45, chuva_leve: 0.65, chuva_forte: 0.8, tempestade: 0.92, neve: 0.6 };

export class HouseScene extends Phaser.Scene {
  private state: State | null = null;
  private works: Record<string, Work> = {};
  private debug: Debug = {};
  private cb: Callbacks;
  audio?: AmbientAudio;
  private staticKey = '';
  private statics: Phaser.GameObjects.GameObject[] = [];
  private objectImages = new Map<string, Phaser.GameObjects.Image>();
  private innerWalls: { img: Phaser.GameObjects.Image; axis: 'v' | 'h'; at: number; i: number }[] = [];
  private sky!: Phaser.GameObjects.Graphics;
  private skyRain!: Phaser.GameObjects.Graphics;
  private rain!: Phaser.GameObjects.Graphics;
  private fog!: Phaser.GameObjects.Graphics;
  private patches!: Phaser.GameObjects.Graphics;
  private dark!: Phaser.GameObjects.Rectangle;
  private flash!: Phaser.GameObjects.Rectangle;
  private lamps: { img: Phaser.GameObjects.Image; kind: 'lamp' | 'screen' }[] = [];
  private clouds: Phaser.GameObjects.Image[] = [];
  private drops: { gx: number; gy: number; t: number; speed: number; back: boolean }[] = [];
  private rabbit?: Phaser.GameObjects.Container;
  private bunny?: Phaser.GameObjects.Image;
  private icon?: Phaser.GameObjects.Image;
  private shownCell: Point | null = null;
  private rabbitKey = '';
  private furKey = '';
  private timers: Phaser.Time.TimerEvent[] = [];
  private moving = false;
  private mode: CameraMode = 'geral';
  private lastAtmos = 0;
  private dragging = false;
  private dragStart = { x: 0, y: 0, sx: 0, sy: 0 };
  private pinch = 0;
  private atmosKey = '';
  private nextThunder = 0;

  constructor(cb: Callbacks) {
    super('house');
    this.cb = cb;
  }
  create() {
    // Loose bounds: the house can be centred on any screen shape (portrait phones too).
    this.cameras.main.setBounds(-WORLD_W, -WORLD_H, WORLD_W * 3, WORLD_H * 3);
    this.cameras.main.setRoundPixels(true);
    this.sky = this.add.graphics().setDepth(0);
    this.skyRain = this.add.graphics().setDepth(6);
    this.patches = this.add.graphics().setDepth(D_LIGHTPATCH).setBlendMode(Phaser.BlendModes.ADD);
    this.rain = this.add.graphics().setDepth(D_RAIN);
    this.fog = this.add.graphics().setDepth(D_FOG);
    this.dark = this.add.rectangle(-WORLD_W, -WORLD_H, WORLD_W * 3, WORLD_H * 3, 0xffffff).setOrigin(0).setDepth(D_DARK).setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.flash = this.add.rectangle(-WORLD_W, -WORLD_H, WORLD_W * 3, WORLD_H * 3, 0xf4f1ff).setOrigin(0).setDepth(D_FLASH).setAlpha(0);
    this.makeShared();
    for (let i = 0; i < 160; i++) this.drops.push({ gx: 0, gy: 0, t: Math.random(), speed: 0.8 + Math.random() * 0.6, back: i % 3 === 0 });
    this.setupInput();
    this.scale.on('resize', () => this.fit(false));
    this.rebuild();
    this.fit(true);
  }
  /** Shared small textures: light glow, cloud puffs, mood icons. */
  private makeShared() {
    const glow = new Px(96, 96);
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
      const d = Math.hypot(x - 47.5, y - 47.5) / 48;
      if (d < 1) glow.set(x, y, [255, 255, 255, Math.round((Math.floor((1 - d) ** 1.6 * 7) / 7) * 120)]);
    }
    this.textures.addCanvas('glow', glow.canvas());
    for (let i = 0; i < 3; i++) {
      const c = new Px(48, 18);
      const blobs = [[10, 11, 8, 6], [22, 8, 10, 7], [34, 11, 8, 5], [18, 13, 12, 4], [29, 13, 10, 4]];
      for (const [x, y, rx, ry] of blobs) c.ellipse(x + i * 2 - 2, y, rx, ry, [255, 255, 255, 255]);
      for (let x = 0; x < 48; x++) for (let y = 12; y < 18; y++) if (c.alpha(x, y)) c.set(x, y, [214, 220, 232, 255]);
      this.textures.addCanvas('cloud' + i, c.canvas());
    }
    const icons: Record<string, (p: Px) => void> = {
      sede: (p) => { p.ellipse(4.5, 6, 3, 3, hex('#8ec5e8'), 0.3); p.rect(4, 1, 1, 3, hex('#8ec5e8')); },
      fome: (p) => { p.poly([[2, 3], [7, 3], [4.5, 9]], hex('#e9964f')); p.rect(3, 0, 1, 3, hex('#7fb069')); p.rect(5, 0, 1, 3, hex('#7fb069')); },
      coracao: (p) => { p.ellipse(3, 3.5, 2, 2, hex('#e597b4')); p.ellipse(6, 3.5, 2, 2, hex('#e597b4')); p.poly([[1, 4], [8, 4], [4.5, 8]], hex('#e597b4')); },
      duvida: (p) => { p.rect(3, 1, 3, 1, hex('#ead29e')); p.rect(6, 2, 1, 2, hex('#ead29e')); p.rect(4, 4, 2, 1, hex('#ead29e')); p.rect(4, 5, 1, 1, hex('#ead29e')); p.rect(4, 7, 1, 1, hex('#ead29e')); },
      exclama: (p) => { p.rect(4, 1, 1, 5, hex('#ead29e')); p.rect(4, 7, 1, 1, hex('#ead29e')); },
      tedio: (p) => { for (const x of [1, 4, 7]) p.rect(x, 6, 1, 1, hex('#ead29e')); },
      nota: (p) => { p.rect(5, 1, 1, 6, hex('#ead29e')); p.rect(5, 1, 3, 1, hex('#ead29e')); p.ellipse(4, 7, 1.6, 1.2, hex('#ead29e')); },
      brilho: (p) => { p.rect(4, 1, 1, 7, hex('#f6e7a1')); p.rect(1, 4, 7, 1, hex('#f6e7a1')); p.set(4, 4, hex('#ffffff')); },
      z: (p) => { p.rect(2, 2, 5, 1, hex('#d7d2f0')); p.line(6, 3, 2, 7, hex('#d7d2f0')); p.rect(2, 7, 5, 1, hex('#d7d2f0')); },
      bolha: (p) => { p.ellipse(4.5, 4.5, 3, 3, [230, 245, 250, 200]); p.set(3, 3, hex('#ffffff')); },
      gota: (p) => { p.ellipse(4.5, 5.5, 1.6, 2, hex('#9fd3ea')); },
    };
    for (const [name, draw] of Object.entries(icons)) { const p = new Px(9, 9); draw(p); p.outline(hex('#3a2c45')); this.textures.addCanvas('icon-' + name, p.canvas()); }
  }
  /** Rabbit spritesheet in her fur colour (regenerated only if the colour changes). */
  private ensureRabbit(fur: string) {
    const key = 'rabbit-' + fur;
    if (this.textures.exists(key)) return key;
    const frames = frameSet();
    const names = Object.keys(frames);
    const cols = 10;
    const sheet = new Px(cols * FRAME, Math.ceil(names.length / cols) * FRAME);
    names.forEach((n, i) => {
      const f = drawRabbit(frames[n], fur);
      const ox = (i % cols) * FRAME, oy = Math.floor(i / cols) * FRAME;
      for (let y = 0; y < FRAME; y++) for (let x = 0; x < FRAME; x++) { const c = f.get(x, y); if (c[3]) sheet.set(ox + x, oy + y, c); }
    });
    const tex = this.textures.addCanvas(key, sheet.canvas())!;
    names.forEach((n, i) => tex.add(n, 0, (i % cols) * FRAME, Math.floor(i / cols) * FRAME, FRAME, FRAME));
    return key;
  }

  // ---------- state ----------
  apply(state: State | null, works: Record<string, Work> = {}) {
    this.state = state;
    this.works = works;
    if (!this.sky) return;
    this.rebuild();
    this.placeRabbit();
    this.atmosphere(true);
  }
  setDebug(d: Debug) { this.debug = d; if (this.sky) { this.rebuild(); this.atmosphere(true); this.placeRabbit(true); } }
  vm() {
    if (this.debug.vm !== undefined) return this.debug.vm;
    const s = this.state;
    if (!s) return 9 * 60;
    return s.paused ? s.virtualMinutes : s.virtualMinutes + (Date.now() - s.updatedAt) / 60000 * s.multiplier;
  }
  weather() {
    const w = weatherAt(this.vm());
    return this.debug.weather ? { ...w, condition: this.debug.weather } : w;
  }
  private objects(): HabitatObject[] {
    return this.state?.objects ?? (this.registry.get('preview') as HabitatObject[] | undefined) ?? [];
  }

  /** Static layers: floor, walls, objects. Rebuilt only when something persistent changes. */
  private rebuild() {
    const objects = this.objects();
    const vm = this.vm();
    const season = seasonOf(vm);
    const garden = this.state?.house?.garden ?? {};
    const stages = Object.fromEntries(Object.entries(garden).map(([k, p]) => [k, growth(p, vm).stage + (growth(p, vm).moist ? 'm' : '')]));
    const workKey = Object.entries(this.works).map(([k, w]) => k + w.version).join();
    const key = JSON.stringify([objects, this.state?.house?.walls, season, stages, workKey]);
    if (key === this.staticKey) return;
    this.staticKey = key;
    for (const o of this.statics) o.destroy();
    this.statics = [];
    this.objectImages.clear();
    this.innerWalls = [];
    for (const l of this.lamps) l.img.destroy();
    this.lamps = [];
    const texKeys: string[] = [];
    const addTex = (name: string, s: Sprite | HTMLCanvasElement) => {
      const k = `${name}-${Math.random().toString(36).slice(2)}`;
      if (this.textures.exists(k)) this.textures.remove(k);
      this.textures.addCanvas(k, 'canvas' in s ? s.canvas : s);
      texKeys.push(k);
      return k;
    };
    // Old generated textures are released with the objects (no leak on every update).
    const oldKeys = (this.registry.get('texKeys') as string[] | undefined) ?? [];
    this.time.delayedCall(0, () => oldKeys.forEach((k) => this.textures.exists(k) && this.textures.remove(k)));
    this.registry.set('texKeys', texKeys);
    const floor = drawFloor(season);
    this.statics.push(this.add.image(0, 0, addTex('floor', floor)).setOrigin(0).setDepth(D_FLOOR));
    const colors = { ...defaultWalls, ...(this.state?.house?.walls ?? {}) };
    const back = drawBackWalls(objects, colors);
    this.statics.push(this.add.image(0, 0, addTex('walls', back)).setOrigin(0).setDepth(D_WALLS));
    // Interior walls (one piece per cell edge), door frames, the low front walls and the fence.
    const roomColor = (p: Point) => colors[roomAt(p).id];
    for (const w of walls)
      for (let i = w.from; i <= w.to; i++) {
        const p = w.axis === 'h' ? iso(i, w.at) : iso(w.at, i);
        const cell = w.axis === 'h' ? { x: i, y: w.at - 1 } : { x: w.at - 1, y: i };
        const depth = depthOf(cell.x, cell.y, 9);
        if (w.doors.includes(i)) {
          const fr = drawDoorFrame(w.axis, !!w.outer);
          const img = this.add.image(p.x, p.y, addTex('door', fr)).setOrigin(fr.ox / fr.canvas.width, fr.oy / fr.canvas.height).setDepth(depth);
          this.statics.push(img);
          continue;
        }
        const piece = drawInnerWall(w.axis, w.at, i, roomColor(w.axis === 'h' ? { x: i, y: w.at } : { x: w.at, y: i }), !!w.outer);
        const img = this.add.image(p.x, p.y, addTex('wall', piece)).setOrigin(piece.ox / piece.canvas.width, piece.oy / piece.canvas.height).setDepth(depth);
        this.statics.push(img);
        if (!w.outer) this.innerWalls.push({ img, axis: w.axis, at: w.at, i });
      }
    for (let y = 0; y <= 10; y++) {
      const piece = drawInnerWall('v', GRID.w, y, colors[roomAt({ x: 19, y }).id], true);
      const p = iso(GRID.w, y);
      this.statics.push(this.add.image(p.x, p.y, addTex('wall', piece)).setOrigin(piece.ox / piece.canvas.width, piece.oy / piece.canvas.height).setDepth(depthOf(19, y, 9)));
    }
    const fenceH = drawFence('h'), fenceV = drawFence('v');
    const fh = addTex('fence', fenceH), fv = addTex('fence', fenceV);
    for (let x = 0; x < GRID.w; x++) { const p = iso(x, GRID.h); this.statics.push(this.add.image(p.x, p.y, fh).setOrigin(fenceH.ox / 40, fenceH.oy / 40).setDepth(depthOf(x, GRID.h - 1, 9))); }
    for (let y = 11; y < GRID.h; y++) {
      const a = iso(0, y), b = iso(GRID.w, y);
      this.statics.push(this.add.image(a.x, a.y, fv).setOrigin(fenceV.ox / 40, fenceV.oy / 40).setDepth(depthOf(0, y, 1)));
      this.statics.push(this.add.image(b.x, b.y, fv).setOrigin(fenceV.ox / 40, fenceV.oy / 40).setDepth(depthOf(GRID.w - 1, y, 9)));
    }
    // Objects.
    for (const o of objects) {
      const info = kindOf(o);
      const plot = o.kind === 'canteiro' ? garden[o.id] : undefined;
      const g = plot ? growth(plot, vm) : null;
      const sprite = drawObject(o, {
        season,
        artwork: o.artifactId && this.works[o.artifactId] ? this.artCanvas(this.works[o.artifactId].artifact) : null,
        plant: plot && g ? { stage: g.stage, color: species[plot.species]?.color ?? '#e0574f', moist: g.moist } : null,
      });
      const at = iso(o.x, o.y);
      const cells = cover(o);
      const mx = Math.max(...cells.map((c) => c.x)), my = Math.max(...cells.map((c) => c.y));
      const depth = info.mount === 'floor' ? D_RUG : info.mount === 'wall' ? (o.y === 0 || o.x === 0 ? D_WALLPIECE : depthOf(o.x, o.y - (wallSide(o) === 'back' ? 1 : 0), 9.5)) : depthOf(mx, my);
      const img = this.add.image(at.x, at.y, addTex('obj', sprite)).setOrigin(sprite.ox / sprite.canvas.width, sprite.oy / sprite.canvas.height).setDepth(depth);
      img.setInteractive({ pixelPerfect: true, alphaTolerance: 1, useHandCursor: true });
      img.on('pointerup', () => { if (!this.dragging) this.cb.onSelect(o); });
      this.statics.push(img);
      this.objectImages.set(o.id, img);
      if (sprite.front) {
        const f = this.add.image(at.x, at.y, addTex('objf', sprite.front)).setOrigin(sprite.front.ox / sprite.front.canvas.width, sprite.front.oy / sprite.front.canvas.height).setDepth(depth + 2);
        this.statics.push(f);
      }
      if (o.kind === 'arvore' || o.kind === 'flores') img.setData('sway', true);
      // Light sources.
      const lamp = o.kind === 'criado' ? { u: 0.5, v: 0.5, z: 30, r: 1.1 } : o.kind === 'luminaria' ? { u: 0.5, v: 0.5, z: 44, r: 1.5 } : null;
      if (lamp) { const c = iso(o.x + lamp.u, o.y + lamp.v); const l = this.add.image(c.x, c.y - lamp.z * 0.4, 'glow').setScale(lamp.r * 1.05, lamp.r * 0.62).setDepth(D_LIGHT).setBlendMode(Phaser.BlendModes.ADD).setTint(0xffc777); this.lamps.push({ img: l, kind: 'lamp' }); }
      if (o.kind === 'terminal') { const c = iso(o.x + 0.6, o.y + 0.5); const l = this.add.image(c.x, c.y - 14, 'glow').setScale(0.5, 0.32).setDepth(D_LIGHT).setBlendMode(Phaser.BlendModes.ADD).setTint(0x7fe0d0); this.lamps.push({ img: l, kind: 'screen' }); }
    }
    this.lastAtmos = 0;
  }
  /** A small canvas with the work's real content, to hang in frames and on easels. */
  private artCanvas(a: Artifact): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    if (a.format === 'pintura') { paintRaster(cv, document.createElement('canvas'), a); return cv; }
    cv.width = cv.height = 16;
    const ctx = cv.getContext('2d')!;
    if (a.format === 'pixels') { cv.width = a.pixels[0].length; cv.height = a.pixels.length; a.pixels.forEach((row, y) => row.forEach((p, x) => { ctx.fillStyle = a.palette[p]; ctx.fillRect(x, y, 1, 1); })); return cv; }
    ctx.fillStyle = '#f6efe3'; ctx.fillRect(0, 0, 16, 16);
    if (a.format === 'texto') { ctx.fillStyle = '#8a7a8a'; for (let y = 3; y < 14; y += 2) ctx.fillRect(2, y, 8 + ((y * 7) % 5), 1); }
    else if (a.format === 'musica') { ctx.fillStyle = '#4a3f55'; a.notes.slice(0, 7).forEach((n, i) => ctx.fillRect(2 + i * 2, 14 - ((n.pitch - 36) / 60) * 12, 1, 2)); }
    else { ctx.fillStyle = a.color; ctx.fillRect(4, 4, 8, 8); }
    return cv;
  }

  // ---------- the rabbit ----------
  private clearTimers() { this.timers.forEach((t) => t.remove(false)); this.timers = []; }
  private every(ms: number, run: () => void, jitter = 0) {
    const go = () => { const t = this.time.delayedCall(ms + Math.random() * jitter, () => { run(); go(); }); this.timers.push(t); };
    go();
  }
  /** Where and how she is shown for the persisted activity (on the bed, in the tub, at the desk...). */
  private anchorFor(s: State) {
    const active = isActive(s);
    const kind = active ? s.activity.kind : 'livre';
    const target = s.objects.find((o) => o.id === s.activity.target);
    const centre = (o: HabitatObject) => { const cells = footprint(o); const x = cells.reduce((t, c) => t + c.x, 0) / cells.length, y = cells.reduce((t, c) => t + c.y, 0) / cells.length; return { x, y }; };
    if (active && target) {
      const onTop = (z: number, pose: string) => { const c = centre(target); const cells = footprint(target); const mx = Math.max(...cells.map((q) => q.x)), my = Math.max(...cells.map((q) => q.y)); return { at: c, z, pose, depth: depthOf(mx, my, 6), on: true }; };
      if (kind === 'dormir' && target.kind === 'cama') return onTop(15, 'lie');
      if (kind === 'higiene' && target.kind === 'higiene') return { ...onTop(5, 'groom'), depth: depthOf(Math.max(...footprint(target).map((q) => q.x)), Math.max(...footprint(target).map((q) => q.y)), 6) };
      if (kind === 'descansar' && ['sofa', 'poltrona', 'banco', 'descanso', 'cama'].includes(target.kind)) return onTop({ sofa: 14, poltrona: 14, banco: 12, descanso: 6, cama: 17 }[target.kind as 'sofa'] ?? 8, 'rest');
    }
    const pose = ({ comer: 'eat', beber: 'drink', higiene: 'groom', descansar: 'rest', dormir: 'lie', pesquisar: 'type', diario: 'write', criar: 'paint', organizar: 'tidy', observar: 'watch', jardinar: 'dig', tocar: 'play' } as Record<string, string>)[kind] ?? 'idle';
    return { at: { x: s.position.x, y: s.position.y }, z: 0, pose, depth: depthOf(s.position.x, s.position.y, 6), on: false, target: active ? target : undefined };
  }
  private facingTo(from: Point, to: Point) {
    const dx = to.x - from.x, dy = to.y - from.y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? { facing: 'front' as const, flip: true } : { facing: 'back' as const, flip: false };
    return dy > 0 ? { facing: 'front' as const, flip: false } : { facing: 'back' as const, flip: true };
  }
  placeRabbit(force = false) {
    const s = this.state;
    if (!s) { this.rabbit?.destroy(); this.rabbit = undefined; this.shownCell = null; return; }
    const fur = s.identity.traits.aparencia?.value?.match(/^#[0-9a-fA-F]{6}$/) ? s.identity.traits.aparencia.value : '#ece4f1';
    const tex = this.ensureRabbit(fur);
    const anchor = this.anchorFor(s);
    const mood = expressionFor(s);
    const key = JSON.stringify([s.position, s.activity.kind, s.activity.target, isActive(s), mood.key, fur]);
    if (key === this.rabbitKey && !force) return;
    this.rabbitKey = key;
    if (!this.rabbit || this.furKey !== fur) {
      this.rabbit?.destroy();
      this.furKey = fur;
      const shadow = this.add.ellipse(0, 1, 18, 6, 0x23162a, 0.28);
      this.bunny = this.add.image(0, 0, tex, 'front:sit0').setOrigin(FEET_X / FRAME, FEET_Y / FRAME);
      this.icon = this.add.image(4, -30, 'icon-z').setVisible(false);
      this.rabbit = this.add.container(0, 0, [shadow, this.bunny, this.icon]);
      this.rabbit.setSize(22, 28).setInteractive(new Phaser.Geom.Rectangle(-11, -26, 22, 28), Phaser.Geom.Rectangle.Contains);
      this.rabbit.on('pointerup', () => { if (!this.dragging) this.cb.onRabbit(); });
      if (this.shownCell === null) { const c = cellCenter(s.position); this.rabbit.setPosition(c.x, c.y); this.shownCell = { ...s.position }; }
    }
    this.clearTimers();
    this.tweens.killTweensOf(this.rabbit);
    const from = this.shownCell ?? s.position;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const route = from.x === s.position.x && from.y === s.position.y ? [] : pathfind(from, s.position, s.objects);
    const settle = () => {
      this.moving = false;
      this.shownCell = { ...s.position };
      const end = anchor.on ? cellCenter({ x: anchor.at.x, y: anchor.at.y }, anchor.z) : cellCenter(s.position);
      const finish = () => { this.rabbit!.setPosition(end.x, end.y).setDepth(anchor.depth); (this.rabbit!.list[0] as Phaser.GameObjects.Ellipse).setVisible(!anchor.on); this.behave(anchor, mood.key); };
      if (anchor.on && !reduced) {
        this.setFrame('crouch');
        this.tweens.add({ targets: this.rabbit, x: end.x, y: end.y - 6, duration: 160, ease: 'Sine.easeOut', onComplete: () => this.tweens.add({ targets: this.rabbit, y: end.y, duration: 120, ease: 'Sine.easeIn', onComplete: () => { this.audio?.sfx('hop'); finish(); } }) });
      } else finish();
    };
    if (route.length > 1 && !reduced) {
      this.moving = true;
      (this.rabbit.list[0] as Phaser.GameObjects.Ellipse).setVisible(true);
      const steps: Phaser.Types.Tweens.TweenBuilderConfig[] = [];
      route.slice(1).forEach((p, i) => {
        const a = route[i], A = cellCenter(a), B = cellCenter(p);
        const dir = this.facingTo(a, p);
        steps.push({ targets: this.rabbit, duration: 70, x: A.x, onStart: () => { this.setFrame('crouch', dir); this.rabbit!.setDepth(Math.max(depthOf(a.x, a.y, 6), depthOf(p.x, p.y, 6))); } });
        steps.push({ targets: this.rabbit, duration: 120, x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 - 7, ease: 'Sine.easeOut', onStart: () => this.setFrame('leap', dir) });
        steps.push({ targets: this.rabbit, duration: 110, x: B.x, y: B.y, ease: 'Sine.easeIn', onComplete: () => { this.setFrame('crouch', dir); this.audio?.sfx('hop'); } });
      });
      this.tweens.chain({ tweens: steps, onComplete: settle });
    } else {
      if (route.length === 0 && (from.x !== s.position.x || from.y !== s.position.y)) {
        // No visual route (e.g. a layout change while she stood there): fade, never walk through walls.
        this.tweens.add({ targets: this.rabbit, alpha: 0, duration: 150, yoyo: true, onYoyo: () => { const c = cellCenter(s.position); this.rabbit!.setPosition(c.x, c.y); } });
      }
      settle();
    }
  }
  private facing: { facing: 'front' | 'back'; flip: boolean } = { facing: 'front', flip: false };
  private setFrame(name: string, dir = this.facing) {
    this.facing = dir;
    this.bunny?.setFrame(`${dir.facing}:${name}`).setFlipX(dir.flip);
  }
  private puff(icon: string, dx = 0, dy = -30, life = 1600, rise = 14) {
    if (!this.rabbit) return;
    const p = this.add.image(this.rabbit.x + dx, this.rabbit.y + dy, 'icon-' + icon).setDepth(this.rabbit.depth + 1);
    this.tweens.add({ targets: p, y: p.y - rise, x: p.x + Phaser.Math.Between(-4, 4), alpha: 0, duration: life, onComplete: () => p.destroy() });
  }
  /** Activity and idle animations: local cosmetics that follow the persisted activity only. */
  private behave(anchor: ReturnType<HouseScene['anchorFor']>, mood: string) {
    const s = this.state!;
    const target = 'target' in anchor ? anchor.target : undefined;
    let dir = this.facing;
    if (target) {
      const cells = footprint(target).length ? footprint(target) : [{ x: target.x, y: target.y - (wallSide(target) === 'back' ? 1 : 0) }];
      const nearest = cells.sort((a, b) => Math.hypot(a.x - s.position.x, a.y - s.position.y) - Math.hypot(b.x - s.position.x, b.y - s.position.y))[0];
      dir = this.facingTo(s.position, nearest);
    } else if (anchor.on) dir = { facing: 'front', flip: false };
    this.facing = dir;
    const loop = (frames: string[], ms: number) => { let i = 0; this.setFrame(frames[0]); this.every(ms, () => { i = (i + 1) % frames.length; this.setFrame(frames[i]); }); };
    this.icon?.setVisible(false);
    const iconFor: Record<string, string> = { sedenta: 'sede', faminta: 'fome', contente: 'coracao', curiosa: 'duvida', frustrada: 'exclama', entediada: 'tedio' };
    if (iconFor[mood] && anchor.pose !== 'lie') {
      this.icon!.setTexture('icon-' + iconFor[mood]).setVisible(true).setPosition(this.facing.flip ? -6 : 6, anchor.pose === 'idle' || anchor.pose === 'watch' ? -31 : -27);
      this.tweens.add({ targets: this.icon, y: this.icon!.y - 2, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    switch (anchor.pose) {
      case 'lie': loop(['lie0', 'lie1'], 1500); this.every(1900, () => this.puff('z', 6, -14, 2200, 18), 600); break;
      case 'eat': loop(['eat0', 'eat1'], 220); this.every(2600, () => this.audio?.sfx('munch'), 900); break;
      case 'drink': { let down = true; this.setFrame('eat0'); this.every(700, () => { down = !down; this.setFrame(down ? 'eat1' : 'sit0'); if (down) this.audio?.sfx('lap'); }, 300); break; }
      case 'groom': loop(['groom0', 'groom1'], 260); this.every(700, () => this.puff('bolha', Phaser.Math.Between(-8, 8), -10, 1300, 12), 500); this.every(3000, () => this.audio?.sfx('water'), 1500); break;
      case 'rest': loop(['rest0', 'rest1'], 1300); break;
      case 'type': loop(['tall0', 'tall1'], 420); this.every(380, () => this.audio?.sfx('type'), 600); break;
      case 'write': loop(['paw0', 'paw1'], 480); this.every(4000, () => this.audio?.sfx('page'), 3000); break;
      case 'paint': loop(['paw0', 'paw1'], 300); this.every(900, () => this.puff('brilho', Phaser.Math.Between(-12, 8), -24, 1000, 8), 600); break;
      case 'tidy': loop(['dig0', 'dig1', 'sit0', 'crouch'], 380); break;
      case 'dig': loop(['dig0', 'dig1'], 330); break;
      case 'play': loop(['paw0', 'paw1'], 260); this.every(800, () => this.puff('nota', Phaser.Math.Between(-10, 10), -26, 1500, 16), 500); break;
      case 'watch': {
        loop(['tall0', 'tall1'], 1100);
        this.every(3200, () => { this.setFrame('tallBlink'); this.time.delayedCall(130, () => this.setFrame('tall0')); }, 2500);
        break;
      }
      default: {
        // Free time: just being there — breathing, blinking, ears, nose, a stretch now and then.
        const base = mood === 'dormindo' || mood === 'sonolenta' || mood === 'entediada' || mood === 'frustrada' ? 'droop' : mood === 'contente' ? 'happy' : mood === 'curiosa' ? 'big' : 'sit0';
        let breath = false;
        this.setFrame(base);
        this.every(1000, () => { breath = !breath; this.setFrame(breath && base === 'sit0' ? 'sit1' : base); });
        this.every(3400, () => { this.setFrame('blink'); this.time.delayedCall(120, () => this.setFrame(base)); }, 3000);
        this.every(5200, () => { this.setFrame(Math.random() < 0.5 ? 'earL' : 'earR'); this.time.delayedCall(180, () => this.setFrame(base)); }, 5000);
        this.every(2600, () => { this.setFrame('nose'); this.time.delayedCall(110, () => this.setFrame(base)); }, 2400);
        this.every(26000, () => { this.setFrame('stretch'); this.time.delayedCall(900, () => this.setFrame(base)); }, 20000);
        this.every(14000, () => { const d = this.facing; this.setFrame(base, { facing: d.facing, flip: !d.flip }); }, 12000);
      }
    }
  }

  // ---------- atmosphere ----------
  private atmosphere(force = false) {
    const vm = this.vm();
    const w = this.weather();
    const dl = daylightLevel(vm);
    const period = periodOf(vm);
    const cloud = cloudiness[w.condition];
    const key = [Math.round(vm / 3), w.condition].join();
    if (!force && key === this.atmosKey) return;
    this.atmosKey = key;
    const warm = period === 'amanhecer' || period === 'entardecer' ? 1 - Math.abs(dl - 0.5) * 2 : 0;
    // Sky gradient.
    const top = mixHex(mixHex(0x0d1330, 0x6fa8e0, dl), mixHex(0x2a2e3a, 0x7d8592, dl), Math.min(1, cloud * 1.05));
    let bottom = mixHex(mixHex(0x272c52, 0xcfe5f0, dl), mixHex(0x353a46, 0xa9afb8, dl), Math.min(1, cloud * 0.95));
    bottom = mixHex(bottom, 0xf0a77e, warm * 0.75);
    const horizon = OY + 30;
    this.sky.clear();
    this.sky.fillStyle(top).fillRect(-WORLD_W, -WORLD_H, WORLD_W * 3, WORLD_H);
    this.sky.fillGradientStyle(top, top, bottom, bottom, 1).fillRect(-WORLD_W, 0, WORLD_W * 3, horizon);
    // Below the horizon: far fields, lit like the hills (the lawn image covers the near ground).
    this.sky.fillStyle(mixHex(0x232a35, mixHex(0x7d9a74, 0x9aa69a, cloud * 0.5), dl)).fillRect(-WORLD_W, horizon, WORLD_W * 3, WORLD_H * 2);
    // Stars and moon at night, sun by day (behind the house, seen above the walls and in windows).
    const nightA = Math.max(0, (0.4 - dl) / 0.4) * (1 - cloud);
    if (nightA > 0.02) {
      for (let i = 0; i < 90; i++) {
        const x = ((i * 7919) % 1000) / 1000 * WORLD_W, y = ((i * 104729) % 1000) / 1000 * (horizon - 10);
        this.sky.fillStyle(0xfff6e0, nightA * (0.4 + ((i * 31) % 7) / 10)).fillRect(Math.round(x), Math.round(y), i % 9 === 0 ? 2 : 1, i % 9 === 0 ? 2 : 1);
      }
      const sky = skyAt(vm);
      const mx = WORLD_W * (0.15 + ((vm % 1440) / 1440) * 0.7), my = 40;
      this.sky.fillStyle(0xf7f1d8, nightA).fillCircle(mx, my, 9);
      const off = (sky.phase - 0.5) * 36;
      if (Math.abs(off) > 1) this.sky.fillStyle(top, nightA).fillCircle(mx + off, my, 9);
    }
    const sunNow = sun(vm);
    if (sunNow.height > 0) {
      const sx = WORLD_W * (0.1 + sunNow.azimuth * 0.8), sy = horizon - 20 - sunNow.height * 90;
      if (cloud < 0.6) { this.sky.fillStyle(0xfff2c2, (1 - cloud / 0.6) * 0.95).fillCircle(sx, sy, 11); this.sky.fillStyle(0xfff2c2, (1 - cloud / 0.6) * 0.25).fillCircle(sx, sy, 17); }
    }
    // Distant hills.
    const hill1 = mixHex(0x1d2340, 0x8cad8a, dl * (1 - cloud * 0.4)), hill2 = mixHex(0x252b4a, 0xa6c29a, dl * (1 - cloud * 0.4));
    this.sky.fillStyle(hill2);
    this.sky.fillPoints([0, 70, 110, 40, 240, 75, 360, 30, 500, 60, 640, 25, 800, 55, 900, 35].map((h, i, a) => i % 2 === 0 ? null : new Phaser.Geom.Point(a[i - 1] * WORLD_W / 900, horizon - h)).filter(Boolean).concat([new Phaser.Geom.Point(WORLD_W, horizon), new Phaser.Geom.Point(0, horizon)]) as Phaser.Geom.Point[], true);
    this.sky.fillStyle(hill1);
    this.sky.fillPoints([0, 30, 150, 12, 300, 40, 420, 18, 600, 36, 760, 14, 900, 30].map((h, i, a) => i % 2 === 0 ? null : new Phaser.Geom.Point(a[i - 1] * WORLD_W / 900, horizon - h)).filter(Boolean).concat([new Phaser.Geom.Point(WORLD_W, horizon), new Phaser.Geom.Point(0, horizon)]) as Phaser.Geom.Point[], true);
    // Clouds.
    const wanted = Math.round(cloud * 9) + (w.condition === 'limpo' ? 2 : 0);
    while (this.clouds.length < wanted) this.clouds.push(this.add.image(Math.random() * WORLD_W, 10 + Math.random() * (horizon - 60), 'cloud' + (this.clouds.length % 3)).setDepth(5).setScale(1 + Math.random()));
    while (this.clouds.length > wanted) this.clouds.pop()!.destroy();
    const cloudTint = mixHex(mixHex(0x3a3f5a, 0xffffff, dl), 0x8a8f9c, Math.max(0, cloud - 0.5));
    this.clouds.forEach((c) => c.setTint(cloudTint).setAlpha(0.85));
    // Ambient light: multiply tint (night blue, warm twilight, grey overcast); white by day.
    let ambient = mixHex(0x56609a, 0xffffff, Math.min(1, dl * 1.1));
    ambient = mixHex(ambient, 0xf1c39b, warm * 0.45);
    ambient = mixHex(ambient, 0xaab0bc, cloud * dl * 0.5);
    this.dark.setFillStyle(ambient).setVisible(ambient !== 0xffffff);
    // Lamps glow when it is dark; the screen always a little.
    const lampA = Phaser.Math.Clamp((0.6 - dl) / 0.45, 0, 1);
    for (const l of this.lamps) l.img.setAlpha(l.kind === 'lamp' ? lampA * 0.7 : 0.2 + lampA * 0.35);
    // Sunlight through the windows on the floor, moving with the sun.
    this.patches.clear();
    const sunny = (1 - cloud) * sunNow.height;
    if (sunny > 0.03) {
      const off = (0.5 - sunNow.azimuth) * 1.8;
      for (const o of this.objects()) if (o.kind === 'janela') {
        const side = wallSide(o);
        const quad: [number, number][] = side === 'back' ? [[o.x + 0.16, 0], [o.x + 0.84, 0], [o.x + 0.84 + off, 2.1], [o.x + 0.16 + off, 2.1]] : [[0, o.y + 0.16], [0, o.y + 0.84], [2.1, o.y + 0.84 - off], [2.1, o.y + 0.16 - off]];
        this.patches.fillStyle(0xfff0c4, 0.16 * sunny + 0.05).fillPoints(quad.map(([x, y]) => { const p = iso(x, y); return new Phaser.Geom.Point(p.x, p.y); }), true);
      }
    }
    // Fog over the outdoors.
    this.fog.clear();
    const fogA = w.condition === 'neblina' ? 0.32 : isRaining(w.condition) ? 0.08 : w.condition === 'neve' ? 0.12 : 0;
    if (fogA) {
      const band = [iso(-4, 11), iso(GRID.w + 4, 11), iso(GRID.w + 4, GRID.h + 4), iso(-4, GRID.h + 4)];
      this.fog.fillStyle(mixHex(0x6c7290, 0xe6eaf0, dl), fogA).fillPoints(band.map((p) => new Phaser.Geom.Point(p.x, p.y)), true);
      this.fog.fillStyle(mixHex(0x6c7290, 0xe6eaf0, dl), fogA * 0.8).fillRect(0, 0, WORLD_W, OY + 30);
    }
    this.audio?.ambience({ condition: w.condition, wind: w.wind, day: dl, period, season: seasonOf(vm) });
  }
  update(time: number, delta: number) {
    if (!this.sky) return;
    if (time - this.lastAtmos > 1500) { this.lastAtmos = time; this.atmosphere(); this.rebuildIfSeasonOrGarden(); this.fadeWalls(); }
    const w = this.weather();
    // Clouds drift with the wind.
    for (const c of this.clouds) { c.x += (0.004 + w.wind * 0.02) * delta; if (c.x > WORLD_W + 60) c.x = -60; }
    // Swaying plants outdoors.
    const sway = Math.sin(time / 700) * 0.012 * (0.3 + w.wind * 1.4);
    for (const img of this.objectImages.values()) if (img.getData('sway')) img.setRotation(sway);
    // Rain or snow: drops fall only where there is no roof (garden, lawn) and behind the walls.
    this.rain.clear();
    this.skyRain.clear();
    const rainy = isRaining(w.condition) || w.condition === 'neve';
    if (rainy) {
      const snow = w.condition === 'neve';
      const n = w.condition === 'chuva_leve' ? 70 : w.condition === 'chuva_forte' ? 140 : w.condition === 'tempestade' ? 160 : 90;
      const col = snow ? 0xf4f7fb : 0xbfd6ea;
      for (let i = 0; i < n; i++) {
        const d = this.drops[i];
        d.t += (delta / (snow ? 3200 : 520)) * d.speed;
        if (d.t >= 1 || d.gx === 0) {
          d.t = d.t >= 1 ? 0 : Math.random();
          if (d.back) { d.gx = Math.random() * WORLD_W; d.gy = Math.random() * (OY + 40); }
          else {
            const out = Math.random() < 0.6;
            d.gx = out ? Math.random() * GRID.w : -3 + Math.random() * (GRID.w + 6);
            d.gy = out ? 11 + Math.random() * 5 : GRID.h + Math.random() * 3;
          }
        }
        if (d.back) {
          const y = d.gy * d.t;
          if (snow) this.skyRain.fillStyle(col, 0.8).fillRect(d.gx + Math.sin(time / 500 + i) * 3, y, 1, 1);
          else this.skyRain.lineStyle(1, col, 0.7).lineBetween(d.gx, y, d.gx - 1 - w.wind * 3, y - 8);
          continue;
        }
        const g = iso(d.gx, d.gy);
        const z = (1 - d.t) * 140;
        if (snow) this.rain.fillStyle(col, 0.9).fillRect(g.x + Math.sin(time / 400 + i) * 4, g.y - z, 1, 1);
        else if (d.t > 0.95) this.rain.fillStyle(col, 0.7).fillRect(g.x - 1, g.y, 3, 1);
        else this.rain.lineStyle(1, col, 0.8).lineBetween(g.x, g.y - z, g.x - 1 - w.wind * 4, g.y - z - 10);
      }
    }
    if (w.condition === 'tempestade' && time > this.nextThunder) {
      this.nextThunder = time + 9000 + Math.random() * 16000;
      this.flash.setAlpha(0.45);
      this.tweens.add({ targets: this.flash, alpha: 0, duration: 420, ease: 'Quad.easeOut' });
      this.time.delayedCall(600 + Math.random() * 1500, () => this.audio?.sfx('thunder'));
    }
  }
  private lastSeason = '';
  private rebuildIfSeasonOrGarden() {
    const season = seasonOf(this.vm());
    if (season !== this.lastSeason) { this.lastSeason = season; this.rebuild(); }
    else if (this.state?.house?.garden && Object.keys(this.state.house.garden).length) this.rebuild();
  }
  /** Interior walls in front of her become see-through so a wall never hides her. */
  private fadeWalls() {
    const p = this.shownCell;
    for (const w of this.innerWalls) {
      const behind = p && (w.axis === 'h' ? (p.y === w.at - 1 || p.y === w.at - 2) && Math.abs(p.x - w.i) <= 1 : (p.x === w.at - 1 || p.x === w.at - 2) && Math.abs(p.y - w.i) <= 1);
      w.img.setAlpha(behind ? 0.35 : 1);
    }
    // Furniture drawn in front of her that covers her also becomes see-through.
    const r = this.rabbit;
    for (const img of this.objectImages.values()) {
      // Opaque pixels of the sprite over her body (feet, middle, head), not just its bounding box.
      const hit = (x: number, y: number) => { const lx = Math.floor(x - (img.x - img.displayOriginX)), ly = Math.floor(y - (img.y - img.displayOriginY)); return lx >= 0 && ly >= 0 && lx < img.width && ly < img.height && (this.textures.getPixelAlpha(lx, ly, img.texture.key) ?? 0) > 0; };
      const covers = !!r && img.depth > r.depth && img.depth < D_FOG && (hit(r.x, r.y - 4) || hit(r.x, r.y - 12) || hit(r.x, r.y - 20));
      img.setAlpha(covers ? 0.45 : 1);
    }
  }

  // ---------- camera ----------
  private houseBounds() {
    const l = iso(0, GRID.h).x - 20, r = iso(GRID.w, 0).x + 20, t = iso(0, 0).y - 70, b = iso(GRID.w, GRID.h).y + 20;
    return { x: l, y: t, w: r - l, h: b - t };
  }
  fitZoom() {
    const cam = this.cameras.main, hb = this.houseBounds();
    return Math.min(cam.width / hb.w, cam.height / hb.h);
  }
  private fit(initial: boolean) {
    if (!this.cameras?.main) return;
    if (this.mode === 'geral' || initial) this.setMode(this.mode === 'acompanhar' ? 'acompanhar' : 'geral');
  }
  setMode(m: CameraMode) {
    const cam = this.cameras.main;
    this.mode = m;
    cam.stopFollow();
    if (m === 'geral') {
      const hb = this.houseBounds();
      cam.setZoom(this.fitZoom());
      cam.centerOn(hb.x + hb.w / 2, hb.y + hb.h / 2);
    } else if (m === 'acompanhar' && this.rabbit) {
      cam.setZoom(Math.max(this.fitZoom() * 2.2, 2.5));
      cam.startFollow(this.rabbit, true, 0.08, 0.08, 0, 10);
    }
    this.cb.onMode(m);
  }
  zoomBy(f: number, at?: { x: number; y: number }) {
    const cam = this.cameras.main;
    const min = this.fitZoom() * 0.8, max = 6;
    const z = Phaser.Math.Clamp(cam.zoom * f, min, max);
    if (at && this.mode !== 'acompanhar') {
      const before = cam.getWorldPoint(at.x, at.y);
      cam.setZoom(z);
      const after = cam.getWorldPoint(at.x, at.y);
      cam.scrollX += before.x - after.x; cam.scrollY += before.y - after.y;
    } else cam.setZoom(z);
    if (this.mode === 'geral') { this.mode = 'livre'; this.cb.onMode('livre'); }
  }
  /** Centre on a room (inspection shortcut). */
  focusRoom(id: string) {
    const r = { quarto: [2.5, 2.5], estudio: [9.5, 2.5], banheiro: [16.5, 2.5], sala: [4.5, 8], cozinha: [14.5, 8], jardim: [10, 13] }[id];
    if (!r) return;
    const cam = this.cameras.main;
    cam.stopFollow();
    const c = iso(r[0], r[1]);
    cam.setZoom(Math.max(this.fitZoom() * 2, 2));
    cam.centerOn(c.x, c.y - 20);
    this.mode = 'livre';
    this.cb.onMode('livre');
  }
  private setupInput() {
    this.input.addPointer(1);
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => this.zoomBy(dy > 0 ? 0.88 : 1.14, { x: p.x, y: p.y }));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.dragging = false;
      this.dragStart = { x: p.x, y: p.y, sx: this.cameras.main.scrollX, sy: this.cameras.main.scrollY };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const a = this.input.pointer1, b = this.input.pointer2;
      if (a.isDown && b.isDown) {
        const d = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
        if (this.pinch) this.zoomBy(d / this.pinch, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        this.pinch = d;
        this.dragging = true;
        return;
      }
      this.pinch = 0;
      if (!p.isDown) return;
      if (!this.dragging && Math.hypot(p.x - this.dragStart.x, p.y - this.dragStart.y) > 5) {
        this.dragging = true;
        if (this.mode !== 'livre') { this.cameras.main.stopFollow(); this.dragStart.sx = this.cameras.main.scrollX; this.dragStart.sy = this.cameras.main.scrollY; this.mode = 'livre'; this.cb.onMode('livre'); }
      }
      if (this.dragging) {
        const z = this.cameras.main.zoom;
        this.cameras.main.setScroll(this.dragStart.sx - (p.x - this.dragStart.x) / z, this.dragStart.sy - (p.y - this.dragStart.y) / z);
      }
    });
    this.input.on('pointerup', () => { this.pinch = 0; this.time.delayedCall(0, () => { this.dragging = false; }); });
  }
}
