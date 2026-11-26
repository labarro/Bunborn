import { useEffect, useRef } from 'react';
import { paint, type Painting } from './paint-raster';

// The creature's painting, drawn like MS Paint (see paint-raster.ts). Canvas only: her text is
// painted as pixels, never inserted as markup.
export function PaintingView({ artifact }: { artifact: Painting }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current) paint(canvas.current, document.createElement('canvas'), artifact);
  }, [artifact]);
  return <canvas ref={canvas} className="painting" role="img" aria-label="Pintura criada pela criatura" />;
}
