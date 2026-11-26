import Phaser from 'phaser';
import { HouseScene, type Callbacks } from './habitat/scene';
export type { CameraMode, Work } from './habitat/scene';
/** The isometric house (habitat v2). Canvas only; resizes with its container. */
export function createHabitat(parent: HTMLElement, cb: Callbacks) {
  const scene = new HouseScene(cb);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: parent.clientWidth || 640,
    height: parent.clientHeight || 430,
    pixelArt: true,
    roundPixels: true,
    backgroundColor: '#1d1828',
    scene: [scene],
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER },
    render: { antialias: false, powerPreference: 'low-power' },
    fps: { target: 60, min: 20 },
    disableContextMenu: true,
  });
  return { game, scene };
}
