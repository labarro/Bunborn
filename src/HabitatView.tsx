import { useEffect, useRef, useState } from 'react';
import { Crosshair, EyeOff, Home, Maximize2, Minus, Plus, Volume2, VolumeX } from 'lucide-react';
import { createHabitat, type CameraMode, type Work } from './habitat';
import type { HabitatObject, State } from '../shared/domain';
import { expressionFor } from '../shared/expression';
import { rooms } from '../shared/house';
import { conditionLabel, feltTemperature, periodLabel, periodOf, seasonLabel, seasonOf, weatherAt } from '../shared/world';
import { AmbientAudio, loadVolumes, type Volumes } from './habitat/audio';

const vmOf = (s: State | null) => (s ? (s.paused ? s.virtualMinutes : s.virtualMinutes + ((Date.now() - s.updatedAt) / 60000) * s.multiplier) : 9 * 60);

export default function HabitatView({
  state,
  works = {},
  onSelect,
  onRabbit,
}: {
  state: State | null;
  works?: Record<string, Work>;
  onSelect: (o: HabitatObject) => void;
  onRabbit?: () => void;
}) {
  const shell = useRef<HTMLDivElement>(null);
  const parent = useRef<HTMLDivElement>(null);
  const engine = useRef<ReturnType<typeof createHabitat> | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  const rabbit = useRef(onRabbit);
  rabbit.current = onRabbit;
  const audio = useRef<AmbientAudio | null>(null);
  const [mode, setMode] = useState<CameraMode>('geral');
  const [sound, setSound] = useState(false);
  const [soundPanel, setSoundPanel] = useState(false);
  const [volumes, setVolumes] = useState<Volumes>(loadVolumes);
  const [immersive, setImmersive] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [clock, setClock] = useState(() => vmOf(state));
  useEffect(() => {
    if (!parent.current) return;
    const instance = createHabitat(parent.current, { onSelect: (o) => select.current(o), onRabbit: () => rabbit.current?.(), onMode: setMode });
    engine.current = instance;
    return () => {
      engine.current = null;
      instance.game.destroy(true);
      audio.current?.close();
      audio.current = null;
    };
  }, []);
  useEffect(() => {
    engine.current?.scene.apply(state, works);
  }, [state, works]);
  useEffect(() => {
    const t = setInterval(() => setClock(vmOf(state)), 10000);
    setClock(vmOf(state));
    return () => clearInterval(t);
  }, [state]);
  // Her own composition sounds when she plays it (and only if sound is on).
  const played = useRef('');
  useEffect(() => {
    if (!state || state.activity.kind !== 'tocar' || state.activity.until <= state.virtualMinutes || !audio.current) return;
    const key = state.activity.target + state.activity.until;
    const music = Object.values(works).find((w) => w.artifact.format === 'musica');
    if (played.current === key || !music || music.artifact.format !== 'musica') return;
    played.current = key;
    audio.current.playMusic(music.artifact.notes, music.artifact.tempo);
  }, [state, works]);
  // Immersive mode: fullscreen, controls hide until the pointer moves.
  useEffect(() => {
    if (!immersive) { setChrome(true); return; }
    let t = window.setTimeout(() => setChrome(false), 2500);
    const wake = () => { setChrome(true); clearTimeout(t); t = window.setTimeout(() => setChrome(false), 2500); };
    window.addEventListener('pointermove', wake);
    const exit = () => { if (!document.fullscreenElement) setImmersive(false); };
    document.addEventListener('fullscreenchange', exit);
    return () => { clearTimeout(t); window.removeEventListener('pointermove', wake); document.removeEventListener('fullscreenchange', exit); };
  }, [immersive]);
  async function toggleSound() {
    if (sound) { audio.current?.close(); audio.current = null; setSound(false); if (engine.current) engine.current.scene.audio = undefined; return; }
    const a = new AmbientAudio(volumes);
    await a.resume();
    audio.current = a;
    if (engine.current) engine.current.scene.audio = a;
    setSound(true);
    setSoundPanel(true);
  }
  function setVolume(k: keyof Volumes, v: number) {
    const next = { ...volumes, [k]: v };
    setVolumes(next);
    audio.current?.setVolumes(next);
  }
  async function fullscreen(imm = false) {
    if (document.fullscreenElement) { await document.exitFullscreen(); setImmersive(false); return; }
    await shell.current?.requestFullscreen?.().catch(() => undefined);
    setImmersive(imm);
  }
  const w = weatherAt(clock);
  const caption = `${periodLabel[periodOf(clock)]} · ${seasonLabel[seasonOf(clock)]} · ${conditionLabel[w.condition]} · ${feltTemperature(w.temp)}`;
  const scene = engine.current?.scene;
  return (
    <div className={`habitat-shell${immersive ? ' immersive' : ''}${chrome ? '' : ' chrome-hidden'}`} ref={shell}>
      <div
        className="phaser-host"
        ref={parent}
        role="img"
        aria-label={
          state
            ? `Casa do coelho ${state.identity.name ?? 'sem nome'}. Atividade registrada: ${state.activity.kind}. Expressão: ${expressionFor(state).label.toLowerCase()} (${expressionFor(state).reason}). Lá fora: ${caption}.`
            : 'Casa isométrica vazia, preparada para o nascimento.'
        }
      />
      <div className="habitat-caption" aria-live="polite">{caption}</div>
      <div className="habitat-tools" role="toolbar" aria-label="Câmera e som">
        <button className={mode === 'geral' ? 'on' : ''} onClick={() => scene?.setMode('geral')} title="Ver a casa inteira" aria-label="Ver a casa inteira"><Home size={15} /></button>
        <button className={mode === 'acompanhar' ? 'on' : ''} onClick={() => scene?.setMode('acompanhar')} title="Acompanhar a criatura" aria-label="Acompanhar a criatura" disabled={!state}><Crosshair size={15} /></button>
        <button onClick={() => scene?.zoomBy(1.25)} title="Aproximar" aria-label="Aproximar"><Plus size={15} /></button>
        <button onClick={() => scene?.zoomBy(0.8)} title="Afastar" aria-label="Afastar"><Minus size={15} /></button>
        <select aria-label="Ir para um cômodo" value="" onChange={(e) => { if (e.target.value) scene?.focusRoom(e.target.value); }}>
          <option value="">Cômodos</option>
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <button onClick={() => void fullscreen(false)} title="Tela cheia" aria-label="Tela cheia"><Maximize2 size={15} /></button>
        <button onClick={() => void fullscreen(true)} title="Observação imersiva (sem interface)" aria-label="Observação imersiva"><EyeOff size={15} /></button>
        <button className={sound ? 'on' : ''} onClick={() => void toggleSound()} title={sound ? 'Desligar som' : 'Ligar som ambiente'} aria-label={sound ? 'Desligar som' : 'Ligar som ambiente'}>{sound ? <Volume2 size={15} /> : <VolumeX size={15} />}</button>
      </div>
      {sound && soundPanel ? (
        <div className="sound-panel" role="group" aria-label="Volumes">
          {([['master', 'Geral'], ['ambience', 'Ambiente'], ['sfx', 'Efeitos'], ['music', 'Música']] as [keyof Volumes, string][]).map(([k, label]) => (
            <label key={k}>{label}<input type="range" min={0} max={1} step={0.05} value={volumes[k]} onChange={(e) => setVolume(k, Number(e.target.value))} /></label>
          ))}
          <button className="text-button" onClick={() => setSoundPanel(false)}>Fechar</button>
        </div>
      ) : null}
    </div>
  );
}
