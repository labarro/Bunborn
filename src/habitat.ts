import Phaser from 'phaser';
import {
  approach,
  initialObjects,
  type HabitatObject,
  type Point,
  type State,
} from '../shared/domain';
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
    this.pet?.destroy();
    this.pet = undefined;
    if (!state) {
      this.label?.setText('O habitat está pronto. A história ainda não começou.');
      return;
    }
    this.label?.setText('');
    const active = state.activity.until > state.virtualMinutes;
    const pos = iso(this.lastPosition);
    const c = this.add.container(pos.x, pos.y);
    const g = this.add.graphics();
    const tint = color(state.identity.traits.aparencia?.value ?? '#e8e1ef');
    const shade = Phaser.Display.Color.IntegerToColor(tint).darken(15).color;
    g.fillStyle(0x191224, 0.25).fillEllipse(0, 3, 29, 9);
    // A rabbit's silhouette stays recognizable even when it changes its coat color.
    g.fillStyle(0xf7eef6).fillRect(10, -14, 8, 8).fillRect(12, -16, 4, 11);
    g.fillStyle(shade).fillRect(-10, -17, 22, 15).fillRect(-7, -20, 16, 5);
    g.fillStyle(tint)
      .fillRect(-9, -48, 6, 24)
      .fillRect(-8, -51, 4, 4)
      .fillRect(3, -51, 6, 26)
      .fillRect(4, -54, 4, 4);
    g.fillStyle(0xd6a5ba).fillRect(-7, -46, 2, 16).fillRect(5, -49, 2, 18);
    g.fillStyle(tint).fillRect(-12, -30, 24, 19).fillRect(-9, -33, 18, 5).fillRect(-9, -12, 18, 5);
    g.fillStyle(0xf8f0f5).fillRect(-8, -31, 7, 3).fillRect(-11, -3, 9, 5).fillRect(4, -3, 10, 5);
    g.fillStyle(0x322b43);
    if (active && state.activity.kind === 'dormir') {
      g.fillRect(-7, -23, 4, 1).fillRect(4, -23, 4, 1);
    } else {
      g.fillRect(-7, -26, 3, 4).fillRect(4, -26, 3, 4);
      g.fillStyle(0xffffff).fillRect(-7, -26, 1, 1).fillRect(4, -26, 1, 1);
    }
    g.fillStyle(0xd8acbf).fillRect(-10, -19, 4, 2).fillRect(7, -19, 4, 2);
    g.fillStyle(0xf9f2f6).fillRect(-5, -18, 10, 5);
    g.fillStyle(0xc48aab).fillRect(-1, -20, 3, 2);
    g.fillStyle(0x8e759c).fillRect(0, -17, 1, 3).fillRect(-2, -14, 2, 1).fillRect(1, -14, 2, 1);
    g.fillStyle(0xb5a4bd).fillRect(-16, -18, 5, 1).fillRect(12, -18, 5, 1);
    c.add(g);
    this.pet = c;
    const target = state.objects.find((o) => o.id === state.activity.target);
    const route = target ? approach(this.lastPosition, target, state.objects) : [];
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (
      !reduced &&
      route.length > 1 &&
      route[route.length - 1].x === state.position.x &&
      route[route.length - 1].y === state.position.y
    ) {
      this.tweens.chain({
        targets: c,
        tweens: route.slice(1).flatMap((p, i) => {
          const from = iso(route[i]),
            to = iso(p);
          return [
            {
              x: (from.x + to.x) / 2,
              y: (from.y + to.y) / 2 - 5,
              duration: 90,
              ease: 'Sine.easeOut',
            },
            { ...to, duration: 90, ease: 'Sine.easeIn' },
          ];
        }),
      });
    } else c.setPosition(iso(state.position).x, iso(state.position).y);
    this.lastPosition = state.position;
    c.setDepth(500 + state.position.x + state.position.y);
    if (active) {
      const label =
        state.activity.kind === 'dormir'
          ? 'z z'
          : state.activity.kind === 'pesquisar'
            ? '⌕'
            : state.activity.kind === 'criar'
              ? '✦'
              : '';
      if (label)
        c.add(
          this.add.text(17, -55, label, {
            fontFamily: 'system-ui',
            fontSize: '12px',
            color: '#ead29e',
          }),
        );
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
