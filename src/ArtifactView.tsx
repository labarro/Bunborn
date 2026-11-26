import { useEffect, useRef, useState } from 'react';
import type { Artifact } from '../shared/domain';
import { PaintingView } from './Painting';
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
  if (artifact.format === 'pintura') return <PaintingView artifact={artifact} />;
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
