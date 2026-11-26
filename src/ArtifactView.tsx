import { useEffect, useRef, useState } from 'react';
import type { Artifact } from '../shared/domain';
export function ArtifactView({ artifact }: { artifact: Artifact }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const audio = useRef<AudioContext | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(
    () => () => {
      void audio.current?.close();
    },
    [],
  );
  useEffect(() => {
    if (artifact.format !== 'pixels' || !canvas.current) return;
    const ctx = canvas.current.getContext('2d')!;
    artifact.pixels.forEach((row, y) =>
      row.forEach((p, x) => {
        ctx.fillStyle = artifact.palette[p];
        ctx.fillRect(x, y, 1, 1);
      }),
    );
  }, [artifact]);
  if (artifact.format === 'texto') return <p className="artifact-text">{artifact.content}</p>;
  if (artifact.format === 'pixels')
    return (
      <canvas
        aria-label="Pixel art criada pela criatura"
        role="img"
        ref={canvas}
        width={artifact.pixels[0].length}
        height={artifact.pixels.length}
        className="pixel-art"
      />
    );
  if (artifact.format === 'pintura')
    // Built from validated primitives only (hex colours, numbers, plain text): no raw SVG markup.
    return (
      <svg className="painting" viewBox={`0 0 ${artifact.width} ${artifact.height}`} role="img" aria-label="Pintura criada pela criatura">
        <rect width={artifact.width} height={artifact.height} fill={artifact.background} />
        {artifact.strokes.map((s, i) => {
          const paint = 'fill' in s && s.fill ? { fill: s.color } : { fill: 'none', stroke: s.color, strokeWidth: Math.max(1, Math.min(artifact.width, artifact.height) / 100) };
          switch (s.tool) {
            case 'pincel':
              return s.points.length === 1
                ? <circle key={i} cx={s.points[0].x} cy={s.points[0].y} r={s.size / 2} fill={s.color} />
                : <polyline key={i} points={s.points.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={s.color} strokeWidth={s.size} strokeLinecap="round" strokeLinejoin="round" />;
            case 'retangulo':
              return <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} {...paint} />;
            case 'elipse':
              return <ellipse key={i} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} {...paint} />;
            case 'poligono':
              return <polygon key={i} points={s.points.map((p) => `${p.x},${p.y}`).join(' ')} {...paint} />;
            case 'texto':
              return <text key={i} x={s.x} y={s.y} fontSize={s.size} fill={s.color} fontFamily="sans-serif">{s.text}</text>;
          }
        })}
      </svg>
    );
  if (artifact.format === 'objeto')
    return (
      <svg className="object-art" viewBox="0 0 100 100" role="img" aria-label={artifact.shape}>
        <path
          fill={artifact.color}
          d={
            artifact.shape === 'vaso'
              ? 'M30 20 H70 L65 35 Q85 85 50 85 Q15 85 35 35 Z'
              : artifact.shape === 'quadro'
                ? 'M15 15 H85 V85 H15 Z'
                : 'M50 10 L85 75 L50 90 L15 75 Z'
          }
        />
      </svg>
    );
  async function play() {
    if (artifact.format !== 'musica') return;
    if (playing) {
      await audio.current?.close();
      audio.current = null;
      setPlaying(false);
      return;
    }
    const ctx = new AudioContext();
    audio.current = ctx;
    await ctx.resume();
    let t = ctx.currentTime;
    for (const note of artifact.notes) {
      const duration = (note.beats * 60) / artifact.tempo;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 440 * 2 ** ((note.pitch - 69) / 12);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + duration);
      t += duration;
    }
    setPlaying(true);
    window.setTimeout(
      () => {
        if (audio.current === ctx) {
          setPlaying(false);
          void ctx.close();
          audio.current = null;
        }
      },
      Math.ceil((t - ctx.currentTime) * 1000),
    );
  }
  return (
    <div className="music-art">
      <span className="note-bars">▂ ▅ ▃ ▇ ▄ ▆ ▂ ▅</span>
      <p>
        {artifact.notes.length} notas · {artifact.tempo} bpm · síntese original
      </p>
      <button onClick={() => void play()}>{playing ? 'Parar' : 'Ouvir composição'}</button>
    </div>
  );
}
