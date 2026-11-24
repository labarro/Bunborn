import Phaser from 'phaser';
import {
  approach,
  initialObjects,
  type HabitatObject,
  type Point,
  type State,
} from '../shared/domain';
import { expressionFor, isActive } from '../shared/expression';
const iso = (p: Point) => ({ x: 320 + (p.x - p.y) * 20, y: 142 + (p.x + p.y) * 10 });
const color = (hex: string) => Number.parseInt(hex.replace('#', ''), 16);
export class HabitatScene extends Phaser.Scene {
  private world: State | null = null;
  private scenery?: Phaser.GameObjects.Graphics;
  private pet?: Phaser.GameObjects.Container;
  private objectKey = '';
  private lastPosition: Point = { x: 5, y: 5 };
  private label?: Phaser.GameObjects.Text;
  private onSelect: (object: HabitatObject) => void;
  constructor(onSelect: (object: HabitatObject) => void) {
    super('habitat');
    this.onSelect = onSelect;
  }
  create() {
    this.scenery = this.add.graphics();
    this.draw();
    this.label = this.add
      .text(320, 403, 'O habitat está pronto. A história ainda não começou.', {
        fontFamily: 'system-ui',
        fontSize: '11px',
        color: '#b8acc9',
      })
      .setOrigin(0.5);
    this.apply(this.world);
  }
  apply(state: State | null) {
    this.world = state;
    if (!this.scenery) return;
    const key = JSON.stringify(state?.objects ?? initialObjects);
    if (key !== this.objectKey) {
      this.objectKey = key;
      this.draw();
    }
    this.clearPet();
    if (!state) {
      this.label?.setText('O habitat está pronto. A história ainda não começou.');
      return;
    }
    this.label?.setText('');
    this.buildRabbit(state);
  }
  private petTimers: Phaser.Time.TimerEvent[] = [];
  private petParts: Phaser.GameObjects.GameObject[] = [];
  private clearPet() {
    this.petTimers.forEach((t) => t.remove(false));
    this.petTimers = [];
    if (this.petParts.length) this.tweens.killTweensOf(this.petParts);
    this.petParts = [];
    this.pet?.destroy(true);
    this.pet = undefined;
  }
  private every(min: number, max: number, run: () => void) {
    const schedule = () => {
      const timer = this.time.delayedCall(Phaser.Math.Between(min, max), () => {
        run();
        schedule();
      });
      this.petTimers.push(timer);
    };
    schedule();
  }
  // Articulated pixel rabbit. Motion reflects REAL state only: position changes come from
  // recorded actions; idle breathing/blinking is cosmetic; the expression is derived from the
  // simulated needs/motives (shared/expression.ts), never invented.
  private buildRabbit(state: State) {
    const active = isActive(state);
    const kind = active ? state.activity.kind : 'livre';
    const mood = expressionFor(state);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tint = color(state.identity.traits.aparencia?.value ?? '#e8e1ef');
    const shade = Phaser.Display.Color.IntegerToColor(tint).darken(15).color;
    const rects = (g: Phaser.GameObjects.Graphics, fill: number, list: number[][], ox = 0, oy = 0) => {
      g.fillStyle(fill);
      for (const [x, y, w, h] of list) g.fillRect(x - ox, y - oy, w, h);
    };
    const start = iso(this.lastPosition);
    const c = this.add.container(start.x, start.y);
    const shadow = this.add.graphics().fillStyle(0x191224, 0.25).fillEllipse(0, 3, 29, 9);
    const bodyBox = this.add.container(0, 0);
    const torso = this.add.graphics();
    rects(torso, 0xf7eef6, [[10, -14, 8, 8], [12, -16, 4, 11]]);
    rects(torso, shade, [[-10, -17, 22, 15], [-7, -20, 16, 5]]);
    rects(torso, tint, [[-9, -12, 18, 5]]);
    rects(torso, 0xf8f0f5, [[-11, -3, 9, 5], [4, -3, 10, 5]]);
    const head = this.add.container(0, -22);
    const ear = (px: number, list: number[][], inner: number[][]) => {
      const box = this.add.container(px, -9);
      const g = this.add.graphics();
      rects(g, tint, list, px, -31);
      rects(g, 0xd6a5ba, inner, px, -31);
      box.add(g);
      return box;
    };
    const leftEar = ear(-6, [[-9, -48, 6, 24], [-8, -51, 4, 4]], [[-7, -46, 2, 16]]);
    const rightEar = ear(6, [[3, -51, 6, 26], [4, -54, 4, 4]], [[5, -49, 2, 18]]);
    const skull = this.add.graphics();
    rects(skull, tint, [[-12, -30, 24, 19], [-9, -33, 18, 5]], 0, -22);
    rects(skull, 0xf8f0f5, [[-8, -31, 7, 3]], 0, -22);
    rects(skull, 0xf9f2f6, [[-5, -18, 10, 5]], 0, -22);
    rects(skull, 0xc48aab, [[-1, -20, 3, 2]], 0, -22);
    rects(skull, 0xb5a4bd, [[-16, -18, 5, 1], [12, -18, 5, 1]], 0, -22);
    const face = this.add.graphics();
    type Eyes = 'aberto' | 'fechado' | 'meio' | 'feliz' | 'grande';
    const dark = 0x322b43, mouth = 0x8e759c;
    const drawFace = (eyes: Eyes) => {
      face.clear();
      if (eyes === 'fechado') rects(face, dark, [[-7, -23, 4, 1], [4, -23, 4, 1]], 0, -22);
      else if (eyes === 'meio') rects(face, dark, [[-7, -24, 3, 2], [4, -24, 3, 2]], 0, -22);
      else if (eyes === 'feliz')
        rects(face, dark, [[-7, -24, 1, 1], [-6, -25, 1, 1], [-5, -24, 1, 1], [4, -24, 1, 1], [5, -25, 1, 1], [6, -24, 1, 1]], 0, -22);
      else if (eyes === 'grande') {
        rects(face, dark, [[-8, -27, 4, 5], [4, -27, 4, 5]], 0, -22);
        rects(face, 0xffffff, [[-8, -27, 2, 2], [4, -27, 2, 2]], 0, -22);
      } else {
        rects(face, dark, [[-7, -26, 3, 4], [4, -26, 3, 4]], 0, -22);
        rects(face, 0xffffff, [[-7, -26, 1, 1], [4, -26, 1, 1]], 0, -22);
      }
      rects(face, mood.key === 'contente' ? 0xe597b4 : 0xd8acbf, [[-10, -19, 4, 2], [7, -19, 4, 2]], 0, -22);
      if (mood.key === 'contente')
        rects(face, mouth, [[0, -17, 1, 2], [-3, -15, 1, 1], [-2, -14, 2, 1], [1, -14, 2, 1], [3, -15, 1, 1]], 0, -22);
      else if (mood.key === 'frustrada') {
        rects(face, mouth, [[0, -17, 1, 2], [-2, -14, 5, 1], [-3, -13, 1, 1], [3, -13, 1, 1]], 0, -22);
        rects(face, dark, [[-8, -29, 2, 1], [-6, -28, 2, 1], [5, -28, 2, 1], [7, -29, 2, 1]], 0, -22);
      } else if (mood.key === 'entediada' || mood.key === 'sonolenta') rects(face, mouth, [[0, -17, 1, 2], [-1, -14, 3, 1]], 0, -22);
      else rects(face, mouth, [[0, -17, 1, 3], [-2, -14, 2, 1], [1, -14, 2, 1]], 0, -22);
    };
    const baseEyes: Eyes =
      mood.key === 'dormindo'
        ? 'fechado'
        : mood.key === 'sonolenta' || mood.key === 'entediada' || kind === 'descansar'
          ? 'meio'
          : mood.key === 'contente'
            ? 'feliz'
            : mood.key === 'curiosa'
              ? 'grande'
              : 'aberto';
    drawFace(baseEyes);
    head.add([leftEar, rightEar, skull, face]);
    bodyBox.add([torso, head]);
    c.add([shadow, bodyBox]);
    this.pet = c;
    this.petParts.push(c, bodyBox, head, leftEar, rightEar);
    // Ear posture from the derived expression.
    const droop = mood.key === 'dormindo' ? 1.05 : ['sonolenta', 'frustrada', 'entediada'].includes(mood.key) ? 0.45 : 0;
    leftEar.setRotation(-droop);
    rightEar.setRotation(droop);
    if (mood.key === 'dormindo') bodyBox.setScale(1.06, 0.88);
    // Small state icon above the head (pixel graphics/text, no remote assets).
    const icon = this.add.container(15, -58);
    c.add(icon);
    this.petParts.push(icon);
    const ig = this.add.graphics();
    if (mood.key === 'sedenta') rects(ig, 0x8ec5e8, [[2, 0, 2, 2], [1, 2, 4, 2], [0, 4, 6, 3], [1, 7, 4, 1]]);
    else if (mood.key === 'faminta') {
      rects(ig, 0x7fb069, [[3, 0, 1, 3], [5, 0, 1, 3]]);
      rects(ig, 0xe9964f, [[2, 3, 5, 3], [3, 6, 3, 2], [4, 8, 1, 2]]);
    } else if (mood.key === 'contente')
      rects(ig, 0xe597b4, [[1, 0, 2, 2], [4, 0, 2, 2], [0, 1, 7, 2], [1, 3, 5, 1], [2, 4, 3, 1], [3, 5, 1, 1]]);
    icon.add(ig);
    const symbols: Record<string, string> = { curiosa: '?', frustrada: '!', entediada: '…' };
    if (symbols[mood.key]) icon.add(this.add.text(0, -4, symbols[mood.key], { fontFamily: 'system-ui', fontSize: '12px', color: '#ead29e' }));
    const activitySymbols: Record<string, string> = { pesquisar: '⌕', criar: '✦', diario: '✎', higiene: '✧' };
    const tool = activitySymbols[kind]
      ? this.add.text(-24, -50, activitySymbols[kind], { fontFamily: 'system-ui', fontSize: '12px', color: '#ead29e' })
      : undefined;
    if (tool) {
      c.add(tool);
      this.petParts.push(tool);
    }
    // Movement: hop along the real route to the recorded position.
    const target = state.objects.find((o) => o.id === state.activity.target);
    const route = target ? approach(this.lastPosition, target, state.objects) : [];
    const hops =
      !reduced &&
      route.length > 1 &&
      route[route.length - 1].x === state.position.x &&
      route[route.length - 1].y === state.position.y;
    this.lastPosition = state.position;
    c.setDepth(500 + state.position.x + state.position.y);
    const fx = (text: string, x: number, y: number, size: number) => {
      const t = this.add.text(c.x + x, c.y + y, text, { fontFamily: 'system-ui', fontSize: size + 'px', color: '#ead29e' }).setDepth(c.depth + 1);
      this.petParts.push(t);
      return t;
    };
    const startLoops = () => {
      if (reduced) return;
      const slow = mood.key === 'dormindo' || mood.key === 'sonolenta' ? 1.6 : 1;
      const baseY = bodyBox.scaleY;
      this.tweens.add({ targets: bodyBox, scaleY: baseY * (mood.key === 'dormindo' ? 1.05 : 1.035), duration: 1100 * slow, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      if (mood.key === 'dormindo') {
        this.every(1400, 2200, () => {
          const z = fx('z', 10, -44, 11);
          this.tweens.add({ targets: z, y: z.y - 22, x: z.x + 8, alpha: 0, duration: 2200, onComplete: () => z.destroy() });
        });
        return;
      }
      this.every(2400, 5600, () => {
        drawFace('fechado');
        this.time.delayedCall(130, () => {
          if (face.active) drawFace(baseEyes);
        });
      });
      this.every(3000, 8000, () => {
        const which = Math.random() < 0.5 ? leftEar : rightEar;
        this.tweens.add({ targets: which, rotation: which.rotation + (which === leftEar ? -0.28 : 0.28), duration: 140, yoyo: true });
      });
      if (icon.length) this.tweens.add({ targets: icon, y: icon.y - 3, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      if (tool) this.tweens.add({ targets: tool, y: tool.y - 3, alpha: 0.5, duration: 700, yoyo: true, repeat: -1 });
      if (kind === 'comer') this.tweens.add({ targets: head, y: head.y + 2, duration: 170, yoyo: true, repeat: -1, repeatDelay: 120 });
      else if (kind === 'beber') this.tweens.add({ targets: head, y: head.y + 3, rotation: 0.08, duration: 600, yoyo: true, repeat: -1, repeatDelay: 300 });
      else if (kind === 'higiene') this.tweens.add({ targets: head, rotation: 0.12, duration: 260, yoyo: true, repeat: -1, repeatDelay: 80 });
      else if (kind === 'pesquisar' || kind === 'diario') this.tweens.add({ targets: head, y: head.y + 1, duration: 420, yoyo: true, repeat: -1, repeatDelay: 500 });
      else if (kind === 'criar')
        this.every(500, 1100, () => {
          const spark = fx('✦', Phaser.Math.Between(-22, 14), -Phaser.Math.Between(20, 50), 9);
          this.tweens.add({ targets: spark, alpha: 0, y: spark.y - 8, duration: 900, onComplete: () => spark.destroy() });
        });
      else if (kind === 'organizar') this.tweens.add({ targets: bodyBox, y: -4, duration: 200, yoyo: true, repeat: -1, repeatDelay: 700, ease: 'Sine.easeOut' });
      else if (kind === 'observar' || kind === 'livre') this.every(2800, 6000, () => c.setScale(-c.scaleX, 1));
    };
    if (hops) {
      const steps = route.slice(1).flatMap((p, i) => {
        const from = iso(route[i]),
          to = iso(p);
        return [
          {
            targets: bodyBox,
            scaleX: 1.12,
            scaleY: 0.86,
            duration: 60,
            onStart: () => c.setScale(to.x === from.x ? c.scaleX : to.x > from.x ? -1 : 1, 1),
          },
          {
            targets: c,
            x: (from.x + to.x) / 2,
            y: (from.y + to.y) / 2 - 7,
            duration: 110,
            ease: 'Sine.easeOut',
            onStart: () => bodyBox.setScale(0.92, 1.1),
          },
          { targets: c, x: to.x, y: to.y, duration: 110, ease: 'Sine.easeIn' },
          { targets: bodyBox, scaleX: 1.1, scaleY: 0.88, duration: 60, yoyo: true },
        ];
      });
      this.tweens.chain({
        tweens: steps,
        onComplete: () => {
          bodyBox.setScale(1, mood.key === 'dormindo' ? 0.88 : 1);
          startLoops();
        },
      });
    } else {
      c.setPosition(iso(state.position).x, iso(state.position).y);
      startLoops();
    }
  }
  private draw() {
    const g = this.scenery!;
    g.clear();
    this.children.list.filter((o) => o.getData('objectHit')).forEach((o) => o.destroy());
    g.fillStyle(0x292238).fillRect(0, 0, 640, 430);
    // A quiet courtyard surrounds the room. Every mark is deterministic pixel geometry.
    g.fillStyle(0x30283e);
    for (let i = 0; i < 18; i++) g.fillRect(32 + i * 34, 355 + (i % 3) * 9, 18, 2);
    g.fillStyle(0x1c1729, 0.5);
    g.fillEllipse(320, 335, 490, 65);
    // Two back walls.
    const poly = (points: number[], fill: number) => {
      g.fillStyle(fill);
      g.fillPoints(
        Array.from(
          { length: points.length / 2 },
          (_, i) => new Phaser.Geom.Point(points[i * 2], points[i * 2 + 1]),
        ),
        true,
      );
    };
    poly([80, 142, 320, 22, 320, 142, 80, 262], 0x61516e);
    poly([320, 22, 560, 142, 560, 262, 320, 142], 0x75607c);
    for (let i = 0; i < 12; i++) {
      const p = iso({ x: 0, y: i });
      g.lineStyle(1, 0x77627f, 0.45).lineBetween(p.x, p.y - 110, p.x, p.y);
      const q = iso({ x: i, y: 0 });
      g.lineStyle(1, 0x89718c, 0.4).lineBetween(q.x, q.y - 110, q.x, q.y);
    }
    // Window on left wall, evening sky and a plant ledge.
    poly([139, 131, 229, 86, 229, 156, 139, 201], 0x443d59);
    poly([145, 133, 223, 94, 223, 152, 145, 191], 0x91a5b3);
    poly([148, 152, 220, 116, 220, 148, 148, 184], 0xa9b8b9);
    g.lineStyle(4, 0xd0bbaa).lineBetween(184, 114, 184, 172).lineBetween(145, 162, 223, 123);
    g.lineStyle(5, 0xb18b74).lineBetween(135, 205, 233, 156);
    g.fillStyle(0xe5d2a5).fillRect(207, 109, 4, 4);
    // Wall pictures, trailing leaves and wall light.
    poly([411, 93, 441, 108, 441, 142, 411, 127], 0xb99576);
    poly([415, 100, 437, 111, 437, 135, 415, 124], 0xbfc49c);
    g.fillStyle(0x96aa8b);
    for (let i = 0; i < 8; i++) g.fillRect(475 + (i % 2) * 5, 123 + i * 5, 6, 4);
    g.fillStyle(0xd4b47f).fillRect(358, 94, 5, 15);
    poly([349, 95, 361, 90, 375, 102, 362, 106], 0xe4c797);
    g.fillStyle(0xf4dba0, 0.06).fillEllipse(362, 135, 70, 60);
    // Floor has distinct plank joins, a dark edge and a soft rug.
    poly([80, 262, 320, 382, 560, 262, 560, 272, 320, 392, 80, 272], 0x604857);
    for (let x = 0; x < 12; x++)
      for (let y = 0; y < 12; y++) {
        const p = iso({ x, y });
        poly(
          [p.x, p.y, p.x + 20, p.y + 10, p.x, p.y + 20, p.x - 20, p.y + 10],
          (x + y) % 3 === 0 ? 0xb48e7b : (x + y) % 3 === 1 ? 0xbf9983 : 0xb99480,
        );
        g.lineStyle(1, 0x8b6b63, 0.45).lineBetween(p.x - 19, p.y + 10, p.x, p.y + 19);
        if ((x * 7 + y * 3) % 4 === 0) g.fillStyle(0x977569, 0.35).fillRect(p.x - 4, p.y + 9, 9, 1);
      }
    poly([260, 232, 340, 192, 440, 242, 360, 282], 0x8d8597);
    poly([270, 232, 340, 197, 430, 242, 360, 277], 0x9c95a7);
    g.lineStyle(1, 0xbdb0bd, 0.6);
    for (let i = 0; i < 5; i++) g.lineBetween(285 + i * 15, 233 - i * 7, 361 + i * 15, 271 - i * 7);
    for (const o of [...(this.world?.objects ?? initialObjects)].sort(
      (a, b) => a.x + a.y - b.x - b.y,
    ))
      this.drawObject(o, poly);
    // Small foreground garden belongs to the environment, not an invented preference.
    g.fillStyle(0x789073).fillRect(84, 292, 12, 5).fillRect(88, 287, 5, 14);
    g.fillStyle(0x9eb180).fillRect(78, 282, 10, 6).fillRect(94, 282, 9, 6);
  }
  private drawObject(o: HabitatObject, poly: (p: number[], c: number) => void) {
    const g = this.scenery!,
      p = iso(o),
      x = p.x,
      y = p.y + 8,
      c = color(o.color);
    const box = (w: number, d: number, h: number, top = c) => {
      poly([x - w, y - h, x, y - h - d, x + w, y - h, x, y - h + d], top);
      poly(
        [x - w, y - h, x, y - h + d, x, y + d, x - w, y],
        Phaser.Display.Color.IntegerToColor(top).darken(18).color,
      );
      poly(
        [x, y - h + d, x + w, y - h, x + w, y, x, y + d],
        Phaser.Display.Color.IntegerToColor(top).darken(8).color,
      );
    };
    g.fillStyle(0x3f2e3e, 0.2).fillEllipse(x, y + 4, 43, 18);
    switch (o.kind) {
      case 'cama':
        box(23, 12, 9, 0x926f67);
        poly([x - 24, y - 12, x - 3, y - 23, x + 24, y - 10, x + 3, y + 3], 0xc7b3cf);
        poly([x - 19, y - 15, x - 4, y - 22, x + 7, y - 17, x - 8, y - 9], 0xeadce2);
        poly([x - 9, y - 8, x + 6, y - 15, x + 23, y - 7, x + 8, y + 1], 0xa189b0);
        g.fillStyle(0x7f6263).fillRect(x - 25, y - 28, 3, 21);
        break;
      case 'terminal':
      case 'mesa':
        box(23, 12, 22, 0xc29e7d);
        g.fillStyle(0x7d6261)
          .fillRect(x - 20, y - 6, 3, 16)
          .fillRect(x + 16, y - 7, 3, 14);
        if (o.kind === 'terminal') {
          g.fillStyle(0x454256).fillRect(x - 9, y - 49, 24, 20);
          g.fillStyle(0x91beb6).fillRect(x - 7, y - 47, 20, 15);
          g.fillStyle(0xc6e0c9)
            .fillRect(x - 4, y - 43, 10, 2)
            .fillRect(x - 4, y - 38, 14, 1);
          g.fillStyle(0x615465).fillRect(x, y - 29, 5, 9);
          poly([x - 8, y - 21, x + 6, y - 28, x + 18, y - 22, x + 3, y - 15], 0xddd0c0);
        } else {
          g.fillStyle(0xd8cbad).fillRect(x - 7, y - 28, 15, 8);
          g.fillStyle(0x65576f).fillRect(x + 10, y - 30, 4, 10);
        }
        break;
      case 'estante':
        box(24, 11, 54, 0x9d7c65);
        g.fillStyle(0x624c54)
          .fillRect(x - 20, y - 45, 19, 16)
          .fillRect(x - 20, y - 24, 19, 15);
        for (let i = 0; i < 5; i++)
          g.fillStyle([0x9db39c, 0xc3a2b0, 0xd7bc91, 0x8d9ab0, 0xb99482][i]).fillRect(
            x - 18 + i * 3,
            y - 43 + (i % 2) * 3,
            2,
            12,
          );
        g.fillStyle(0xd6bc91).fillRect(x - 16, y - 22, 7, 12);
        g.fillStyle(0xa6b6bd).fillRect(x - 7, y - 22, 4, 12);
        break;
      case 'higiene':
        box(20, 10, 15, 0xc0cfcb);
        g.fillStyle(0x719a9a).fillEllipse(x, y - 15, 27, 12);
        g.fillStyle(0xa9d0cc).fillEllipse(x, y - 16, 22, 8);
        g.fillStyle(0xdde2d3)
          .fillRect(x + 7, y - 31, 3, 15)
          .fillRect(x + 1, y - 32, 9, 3);
        break;
      case 'comida':
        box(22, 11, 15, 0xb99373);
        g.fillStyle(0xd7c7a5).fillEllipse(x - 9, y - 16, 17, 9);
        g.fillStyle(0x9e7c50).fillEllipse(x - 9, y - 17, 11, 5);
        g.fillStyle(0x89b6c0).fillEllipse(x + 10, y - 17, 12, 7);
        g.fillStyle(0xb9d5d6).fillEllipse(x + 10, y - 18, 8, 4);
        break;
      case 'atelie':
        g.fillStyle(0x916e61)
          .fillRect(x - 14, y - 45, 3, 47)
          .fillRect(x + 10, y - 45, 3, 47);
        poly([x - 14, y - 47, x + 13, y - 39, x + 13, y - 14, x - 14, y - 22], 0xe1d4b5);
        g.fillStyle(0xb5b0bd).fillRect(x - 7, y - 36, 11, 10);
        g.fillStyle(0x9ead92).fillRect(x - 4, y - 29, 12, 6);
        g.fillStyle(0x987968).fillRect(x - 18, y - 20, 35, 4);
        break;
      case 'planta':
        box(9, 6, 11, 0xbf927d);
        g.fillStyle(0x879d7d).fillRect(x - 2, y - 41, 4, 30);
        g.fillStyle(0xa6b28b)
          .fillRect(x - 15, y - 34, 13, 7)
          .fillRect(x + 2, y - 27, 14, 6)
          .fillRect(x - 10, y - 43, 9, 7)
          .fillRect(x + 2, y - 42, 9, 8);
        break;
      case 'descanso':
        box(22, 13, 6, 0x909e80);
        poly([x - 18, y - 9, x, y - 18, x + 18, y - 9, x, y], 0xb1bc99);
        break;
      case 'diario':
        box(12, 7, 17, 0xa88570);
        poly([x - 9, y - 20, x + 2, y - 25, x + 11, y - 20, x, y - 14], 0xc7b4c4);
        g.lineStyle(1, 0x81627f).lineBetween(x, y - 24, x, y - 16);
        break;
      default:
        box(17, 10, o.kind === 'bau' ? 18 : 14, c);
        g.fillStyle(0xe3c087).fillRect(x - 2, y - 7, 4, 4);
    }
    if (o.artifactId) {
      g.fillStyle(0xefcf94).fillRect(x + 14, y - 34, 5, 5);
    }
    const hit = this.add
      .zone(x, y - 20, 45, 55)
      .setInteractive({ useHandCursor: true })
      .setData('objectHit', true);
    hit.on('pointerdown', () => this.onSelect(o));
  }
}
export function createHabitat(parent: HTMLElement, onSelect: (o: HabitatObject) => void) {
  const scene = new HabitatScene(onSelect);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: 640,
    height: 430,
    parent,
    pixelArt: true,
    roundPixels: true,
    backgroundColor: '#292238',
    scene: [scene],
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: { antialias: false },
  });
  return { game, scene };
}
