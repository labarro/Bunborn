// The virtual world around the house (26/11): time of day, seasons, weather, sky and garden.
// Everything is a pure function of the virtual clock (state.virtualMinutes), so the engine and the
// browser always agree, nothing has to be stored for it, and no AI call is involved. Closing the
// browser changes nothing: the next view recomputes the same sky.
export const DAY = 1440;
export const SEASON_DAYS = 14;
export type Season = 'primavera' | 'verao' | 'outono' | 'inverno';
export const seasons: Season[] = ['primavera', 'verao', 'outono', 'inverno'];
export const seasonLabel: Record<Season, string> = { primavera: 'primavera', verao: 'verão', outono: 'outono', inverno: 'inverno' };
export const seasonOf = (vm: number): Season => seasons[((Math.floor(vm / DAY / SEASON_DAYS) % 4) + 4) % 4];
/** 0..1 progress inside the season, for gradual changes (leaves turning, first snow). */
export const seasonProgress = (vm: number) => ((vm / DAY) % SEASON_DAYS) / SEASON_DAYS;
const daylight: Record<Season, [number, number]> = { primavera: [6, 18.5], verao: [5.5, 19.5], outono: [6.5, 18], inverno: [7, 17.5] };
export const hourOf = (vm: number) => ((vm % DAY) + DAY) % DAY / 60;
export const dayOf = (vm: number) => Math.floor(vm / DAY) + 1;
export type Period = 'madrugada' | 'amanhecer' | 'manha' | 'tarde' | 'entardecer' | 'noite';
export const periodLabel: Record<Period, string> = { madrugada: 'madrugada', amanhecer: 'amanhecer', manha: 'manhã', tarde: 'tarde', entardecer: 'entardecer', noite: 'noite' };
export function periodOf(vm: number): Period {
  const h = hourOf(vm);
  const [rise, set] = daylight[seasonOf(vm)];
  if (h < rise - 1) return 'madrugada';
  if (h < rise + 1) return 'amanhecer';
  if (h < 12) return 'manha';
  if (h < set - 1) return 'tarde';
  if (h < set + 0.75) return 'entardecer';
  return h < 22 ? 'noite' : 'madrugada';
}
/** Sun height 0 (below horizon) .. 1 (noon), and its azimuth 0 (east, morning) .. 1 (west). */
export function sun(vm: number) {
  const h = hourOf(vm);
  const [rise, set] = daylight[seasonOf(vm)];
  if (h <= rise || h >= set) return { height: 0, azimuth: h <= rise ? 0 : 1 };
  const t = (h - rise) / (set - rise);
  return { height: Math.sin(Math.PI * t), azimuth: t };
}
/** How bright it is outside, 0 (night) .. 1, with a soft twilight. */
export function daylightLevel(vm: number) {
  const h = hourOf(vm);
  const [rise, set] = daylight[seasonOf(vm)];
  const edge = (x: number) => Math.max(0, Math.min(1, x));
  return Math.min(edge((h - (rise - 0.75)) / 1.5), edge(((set + 0.75) - h) / 1.5));
}

// Deterministic noise: the same virtual time always gives the same world.
function hash(n: number) {
  let t = (n * 0x9e3779b1) >>> 0;
  t = Math.imul(t ^ (t >>> 16), 0x85ebca6b);
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}
export type Condition = 'limpo' | 'nublado' | 'neblina' | 'chuva_leve' | 'chuva_forte' | 'tempestade' | 'neve';
export const conditionLabel: Record<Condition, string> = { limpo: 'céu limpo', nublado: 'nublado', neblina: 'neblina', chuva_leve: 'chuva leve', chuva_forte: 'chuva forte', tempestade: 'tempestade', neve: 'neve' };
/** Weather changes in blocks of 4 virtual hours, following a gentle chain (no jumps from sun to storm). */
export const WEATHER_BLOCK = 240;
const chain: Record<Exclude<Condition, 'neve'>, [Exclude<Condition, 'neve'>, number][]> = {
  limpo: [['limpo', 0.62], ['nublado', 0.3], ['neblina', 0.08]],
  nublado: [['nublado', 0.4], ['limpo', 0.3], ['chuva_leve', 0.22], ['neblina', 0.08]],
  neblina: [['nublado', 0.45], ['limpo', 0.35], ['neblina', 0.2]],
  chuva_leve: [['chuva_leve', 0.35], ['nublado', 0.35], ['chuva_forte', 0.22], ['limpo', 0.08]],
  chuva_forte: [['chuva_leve', 0.45], ['chuva_forte', 0.25], ['tempestade', 0.2], ['nublado', 0.1]],
  tempestade: [['chuva_forte', 0.6], ['chuva_leve', 0.4]],
};
/** Seasons tilt the chain: wetter spring, stormier summer, foggy autumn, colder winter. */
const tilt: Record<Season, Partial<Record<Exclude<Condition, 'neve'>, number>>> = {
  primavera: { chuva_leve: 1.3 },
  verao: { limpo: 1.2, tempestade: 1.6, neblina: 0.5 },
  outono: { neblina: 1.8, nublado: 1.2 },
  inverno: { nublado: 1.3, chuva_forte: 0.7, tempestade: 0.4 },
};
const baseCache = new Map<number, Exclude<Condition, 'neve'>>();
function baseCondition(block: number): Exclude<Condition, 'neve'> {
  const hit = baseCache.get(block);
  if (hit) return hit;
  // Restart the chain every 48 blocks (8 virtual days) from a hashed state: bounded work.
  const start = block - (((block % 48) + 48) % 48);
  const order = Object.keys(chain) as Exclude<Condition, 'neve'>[];
  let c = order[Math.floor(hash(start * 7 + 3) * 3)]; // limpo | nublado | neblina
  for (let b = start + 1; b <= block; b++) {
    const season = seasonOf(b * WEATHER_BLOCK);
    const options = chain[c].map(([k, p]) => [k, p * (tilt[season][k] ?? 1)] as const);
    const total = options.reduce((t, [, p]) => t + p, 0);
    let r = hash(b * 13 + 1) * total;
    for (const [k, p] of options) { r -= p; if (r <= 0) { c = k; break; } }
  }
  if (baseCache.size > 4000) baseCache.clear();
  baseCache.set(block, c);
  return c;
}
/** Temperature in °C (simulated, perceived only; it is not a need). */
export function temperature(vm: number) {
  const base: Record<Season, number> = { primavera: 19, verao: 26, outono: 17, inverno: 8 };
  const h = hourOf(vm);
  const daily = -Math.cos(((h - 3) / 24) * Math.PI * 2) * 5;
  const c = baseCondition(Math.floor(vm / WEATHER_BLOCK));
  const wet = c === 'chuva_forte' || c === 'tempestade' ? -3 : c === 'chuva_leve' || c === 'nublado' ? -1.5 : 0;
  return Math.round((base[seasonOf(vm)] + daily + wet + (hash(Math.floor(vm / DAY)) - 0.5) * 4) * 10) / 10;
}
export function weatherAt(vm: number) {
  const block = Math.floor(vm / WEATHER_BLOCK);
  let condition: Condition = baseCondition(block);
  const temp = temperature(vm);
  if (temp <= 2 && (condition === 'chuva_leve' || condition === 'chuva_forte')) condition = 'neve';
  // Wind: 0..1, stronger in storms, slowly varying.
  const wind = Math.min(1, hash(block * 5 + 11) * 0.5 + (condition === 'tempestade' ? 0.6 : condition === 'chuva_forte' ? 0.3 : 0));
  // Progress inside the block and the next condition, for smooth visual transitions.
  const next = baseCondition(block + 1);
  const progress = (vm - block * WEATHER_BLOCK) / WEATHER_BLOCK;
  return { condition, wind, temp, next, progress };
}
export const isRaining = (c: Condition) => c === 'chuva_leve' || c === 'chuva_forte' || c === 'tempestade';
export function feltTemperature(t: number) {
  return t < 5 ? 'frio' : t < 14 ? 'fresco' : t < 24 ? 'ameno' : t < 30 ? 'quente' : 'muito quente';
}
/** Moon phase 0..1 (0 new, 0.5 full) on a 16-day virtual cycle, and the night sky events. */
export function skyAt(vm: number) {
  const day = Math.floor(vm / DAY);
  const phase = (day % 16) / 16;
  const names = ['lua nova', 'lua crescente', 'quarto crescente', 'lua gibosa crescente', 'lua cheia', 'lua gibosa minguante', 'quarto minguante', 'lua minguante'];
  const moon = names[Math.round(phase * 8) % 8];
  const meteors = hash(day * 31 + 7) < 0.12; // a few nights per season
  return { phase, moon, meteors };
}
/** One sentence of what is visible outside now: given to observar at windows, garden and telescope. */
export function outsideView(vm: number, through: 'janela' | 'jardim' | 'telescopio' = 'janela') {
  const w = weatherAt(vm);
  const p = periodOf(vm);
  const s = skyAt(vm);
  const night = p === 'noite' || p === 'madrugada';
  const parts = [`${periodLabel[p]} de ${seasonLabel[seasonOf(vm)]}`, conditionLabel[w.condition], `ar ${feltTemperature(w.temp)}`];
  if (w.wind > 0.6) parts.push('vento forte');
  else if (w.wind > 0.35) parts.push('brisa');
  if (night && (w.condition === 'limpo' || w.condition === 'neblina')) {
    parts.push(s.moon);
    if (through === 'telescopio') parts.push(s.meteors ? 'uma chuva de meteoros cruza o céu' : 'muitas estrelas nítidas');
  } else if (night && through === 'telescopio') parts.push('nuvens cobrem o céu');
  return parts.join(', ');
}

// Garden: species and deterministic growth. Rain waters the beds too.
export const species: Record<string, { label: string; hours: number; color: string }> = {
  girassol: { label: 'girassol', hours: 60, color: '#f2c94c' },
  tomate: { label: 'tomate', hours: 72, color: '#e0574f' },
  cenoura: { label: 'cenoura', hours: 48, color: '#ef8c3a' },
  lavanda: { label: 'lavanda', hours: 54, color: '#a98bd6' },
  morango: { label: 'morango', hours: 64, color: '#e2475f' },
  alface: { label: 'alface', hours: 36, color: '#8cc76a' },
};
export type Plot = { species: string; plantedAt: number; waterings: number[] };
const MOIST_HOURS = 20;
/** Growth 0..1 and stage 0 (seed) .. 4 (ready). A dry bed simply waits; nothing dies. */
export function growth(plot: Plot, vm: number) {
  const sp = species[plot.species];
  if (!sp) return { progress: 0, stage: 0, moist: false };
  let grown = 0;
  let moist = false;
  const lastHour = Math.floor((vm - plot.plantedAt) / 60);
  for (let i = 0; i < lastHour && grown < sp.hours; i++) {
    const at = plot.plantedAt + i * 60;
    const watered = plot.waterings.some((t) => t <= at && at - t < MOIST_HOURS * 60) || isRaining(weatherAt(at).condition);
    if (watered) grown++;
  }
  moist = plot.waterings.some((t) => t <= vm && vm - t < MOIST_HOURS * 60) || isRaining(weatherAt(vm).condition);
  const progress = Math.min(1, grown / sp.hours);
  return { progress, stage: Math.min(4, Math.floor(progress * 4 + 1e-9)), moist };
}
export const stageLabel = ['semente', 'broto', 'crescendo', 'quase pronta', 'pronta para colher'];
