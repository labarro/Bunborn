// Optional ambient sound (26/11), synthesised in the browser with WebAudio: no audio files, no
// paid generation, nothing downloaded. Starts only after the observer turns it on (autoplay rules).
// Layers: rain, wind, birds by day, crickets on warm nights, thunder, small activity sounds and an
// optional, sparse generative melody. Independent volumes are kept in this browser only.
import type { Condition, Period, Season } from '../../shared/world';

export type Volumes = { master: number; ambience: number; sfx: number; music: number };
const KEY = 'bunborn-sound';
export function loadVolumes(): Volumes {
  try { return { master: 0.7, ambience: 0.6, sfx: 0.5, music: 0.25, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { master: 0.7, ambience: 0.6, sfx: 0.5, music: 0.25 }; }
}
export class AmbientAudio {
  private ctx: AudioContext;
  private master: GainNode; private amb: GainNode; private fx: GainNode; private mus: GainNode;
  private rainGain: GainNode; private windGain: GainNode; private windFilter: BiquadFilterNode;
  private noise: AudioBuffer;
  private env = { condition: 'limpo' as Condition, wind: 0, day: 1, period: 'manha' as Period, season: 'primavera' as Season };
  private timers: number[] = [];
  private lastSfx: Record<string, number> = {};
  constructor(volumes: Volumes) {
    this.ctx = new AudioContext();
    const c = this.ctx;
    this.master = c.createGain(); this.master.connect(c.destination);
    this.amb = c.createGain(); this.fx = c.createGain(); this.mus = c.createGain();
    for (const g of [this.amb, this.fx, this.mus]) g.connect(this.master);
    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = w * 0.6 + last * 2.5; }
    // Rain: band-passed noise. Wind: low-passed noise with a slow sweep.
    const rain = c.createBufferSource(); rain.buffer = this.noise; rain.loop = true;
    const rf = c.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 1400; rf.Q.value = 0.6;
    this.rainGain = c.createGain(); this.rainGain.gain.value = 0;
    rain.connect(rf).connect(this.rainGain).connect(this.amb); rain.start();
    const wind = c.createBufferSource(); wind.buffer = this.noise; wind.loop = true; wind.playbackRate.value = 0.5;
    this.windFilter = c.createBiquadFilter(); this.windFilter.type = 'lowpass'; this.windFilter.frequency.value = 400;
    this.windGain = c.createGain(); this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.amb); wind.start();
    this.setVolumes(volumes);
    this.loop(() => this.birds(), 2500, 6000);
    this.loop(() => this.crickets(), 1800, 2500);
    this.loop(() => this.melody(), 9000, 14000);
    this.loop(() => { const t = c.currentTime; this.windFilter.frequency.setTargetAtTime(250 + Math.random() * 500 * (0.4 + this.env.wind), t, 1.5); }, 2500, 2000);
  }
  setVolumes(v: Volumes) {
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(v.master, t, 0.1); this.amb.gain.setTargetAtTime(v.ambience, t, 0.1);
    this.fx.gain.setTargetAtTime(v.sfx, t, 0.1); this.mus.gain.setTargetAtTime(v.music, t, 0.1);
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode: volumes just are not remembered */ }
  }
  resume() { return this.ctx.resume(); }
  close() { this.timers.forEach((t) => clearTimeout(t)); void this.ctx.close(); }
  private loop(run: () => void, min: number, spread: number) {
    const go = () => { this.timers.push(window.setTimeout(() => { run(); go(); }, min + Math.random() * spread)); };
    go();
  }
  ambience(e: typeof this.env) {
    this.env = e;
    const t = this.ctx.currentTime;
    const rain = { chuva_leve: 0.18, chuva_forte: 0.36, tempestade: 0.5 }[e.condition as 'chuva_leve'] ?? 0;
    this.rainGain.gain.setTargetAtTime(rain, t, 2);
    this.windGain.gain.setTargetAtTime(0.04 + e.wind * 0.22, t, 2);
  }
  private tone(freq: number, dur: number, gain: number, type: OscillatorType, out: GainNode, slide = 0, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + Math.min(0.02, dur / 4)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
  }
  private burst(dur: number, gain: number, freq: number, out: GainNode, q = 1) {
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  private birds() {
    const e = this.env;
    if (e.day < 0.5 || e.condition !== 'limpo' && e.condition !== 'nublado' || e.season === 'inverno') return;
    const base = 2200 + Math.random() * 1500;
    for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) this.tone(base * (1 + Math.random() * 0.2), 0.09, 0.03, 'sine', this.amb, 1.3, i * 0.12);
  }
  private crickets() {
    const e = this.env;
    if (e.day > 0.2 || e.season === 'inverno' || e.condition !== 'limpo') return;
    for (let i = 0; i < 3; i++) this.tone(4300, 0.04, 0.012, 'square', this.amb, 1, i * 0.07);
  }
  private melody() {
    // Sparse pentatonic notes, softer at night; silent in storms.
    if (this.env.condition === 'tempestade') return;
    const scale = [261.6, 293.7, 329.6, 392, 440, 523.3];
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) this.tone(scale[Math.floor(Math.random() * scale.length)] * (this.env.day < 0.3 ? 0.5 : 1), 1.6, 0.05, 'triangle', this.mus, 1, i * 0.7);
  }
  /** Activity sounds, rate-limited so nothing becomes repetitive. */
  sfx(kind: 'hop' | 'munch' | 'lap' | 'water' | 'type' | 'page' | 'thunder') {
    const now = performance.now();
    const gap = { hop: 120, munch: 700, lap: 500, water: 1500, type: 90, page: 2500, thunder: 4000 }[kind];
    if (now - (this.lastSfx[kind] ?? 0) < gap) return;
    this.lastSfx[kind] = now;
    if (kind === 'hop') this.tone(180, 0.08, 0.06, 'sine', this.fx, 0.6);
    else if (kind === 'munch') this.burst(0.06, 0.05, 900, this.fx, 2);
    else if (kind === 'lap') this.tone(600, 0.07, 0.03, 'sine', this.fx, 1.6);
    else if (kind === 'water') this.burst(0.5, 0.05, 1800, this.fx, 0.5);
    else if (kind === 'type') this.burst(0.025, 0.04, 3000 + Math.random() * 1500, this.fx, 3);
    else if (kind === 'page') this.burst(0.25, 0.04, 2500, this.fx, 0.4);
    else { this.burst(1.8, 0.25, 90, this.amb, 0.3); this.burst(0.6, 0.12, 200, this.amb, 0.5); }
  }
  /** Plays one of her compositions (format musica) when she plays it in the house. */
  playMusic(notes: { pitch: number; beats: number }[], tempo: number) {
    let t = 0;
    for (const n of notes.slice(0, 64)) { const d = (n.beats * 60) / tempo; this.tone(440 * 2 ** ((n.pitch - 69) / 12), d, 0.08, 'triangle', this.mus, 1, t); t += d; }
  }
}
