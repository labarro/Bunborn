// Living world (27/11): things that happen around the house on their own, derived from the virtual
// clock and the world rules (shared/world.ts). Nothing here calls AI and nothing must be stored for
// an event to exist: the same time always gives the same events. What IS stored is what the
// creature actually perceived (engine, kind 'ambiente'), because a butterfly passing while she
// sleeps exists in the world but is not her experience.
import { DAY, WEATHER_BLOCK, daylightLevel, isRaining, periodOf, seasonOf, skyAt, temperature, weatherAt } from './world.ts';

export type Where = 'ceu' | 'jardim' | 'casa' | 'ar';
/** How it can be perceived: seen through a window or outdoors, heard anywhere awake, felt indoors. */
export type Sense = 'ver' | 'ouvir' | 'sentir';
export type WorldEvent = { id: string; kind: string; label: string; start: number; end: number; where: Where; sense: Sense; rare?: boolean };

const H = 60;
function hash(n: number) {
  let t = (n * 0x9e3779b1) >>> 0;
  t = Math.imul(t ^ (t >>> 16), 0x85ebca6b);
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}
const dayStart = (vm: number) => Math.floor(vm / DAY) * DAY;

/** Weather transitions inside [a, b): rain starting or stopping, storms, fog, snow, rainbows, puddles. */
function weatherEvents(a: number, b: number): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (let blk = Math.floor(a / WEATHER_BLOCK); blk * WEATHER_BLOCK < b; blk++) {
    const t = blk * WEATHER_BLOCK;
    if (t < a) continue;
    const prev = weatherAt(t - 1).condition, now = weatherAt(t).condition;
    if (prev === now) continue;
    const rainNow = isRaining(now), rainBefore = isRaining(prev);
    if (rainNow && !rainBefore) out.push({ id: `chuva-inicio:${blk}`, kind: 'chuva_comeca', label: 'começa a chover', start: t, end: t + 30, where: 'ar', sense: 'ouvir' });
    if (!rainNow && rainBefore) {
      out.push({ id: `chuva-fim:${blk}`, kind: 'chuva_para', label: 'a chuva para', start: t, end: t + 30, where: 'ar', sense: 'ouvir' });
      out.push({ id: `poca:${blk}`, kind: 'pocas', label: 'poças no caminho do jardim', start: t, end: t + 6 * H, where: 'jardim', sense: 'ver' });
      // A rainbow needs the sun out right after the rain.
      if (daylightLevel(t) > 0.6 && (now === 'limpo' || now === 'nublado') && hash(blk * 3 + 1) < 0.45)
        out.push({ id: `arco-iris:${blk}`, kind: 'arco_iris', label: 'um arco-íris sobre o jardim', start: t, end: t + 40, where: 'ceu', sense: 'ver', rare: true });
    }
    if (now === 'tempestade') out.push({ id: `tempestade:${blk}`, kind: 'tempestade', label: 'trovões de uma tempestade', start: t, end: t + WEATHER_BLOCK, where: 'ar', sense: 'ouvir' });
    if (now === 'neblina') out.push({ id: `neblina:${blk}`, kind: 'neblina', label: 'neblina cobrindo o jardim', start: t, end: t + WEATHER_BLOCK, where: 'jardim', sense: 'ver' });
    if (now === 'neve' && prev !== 'neve') out.push({ id: `neve:${blk}`, kind: 'neve', label: 'começa a nevar', start: t, end: t + WEATHER_BLOCK, where: 'ar', sense: 'ver', rare: true });
    const w = weatherAt(t);
    if (w.wind > 0.7) out.push({ id: `vento:${blk}`, kind: 'vento_forte', label: 'vento forte balançando a árvore', start: t, end: t + WEATHER_BLOCK, where: 'jardim', sense: 'ouvir' });
    const dt = temperature(t) - temperature(t - WEATHER_BLOCK);
    if (Math.abs(dt) >= 7) out.push({ id: `temp:${blk}`, kind: dt > 0 ? 'esquenta' : 'esfria', label: dt > 0 ? 'o ar esquenta bastante' : 'o ar esfria bastante', start: t, end: t + 2 * H, where: 'casa', sense: 'sentir' });
  }
  return out;
}
/** Per day: night sky, garden life, seasonal touches. Each has a fixed hour from a hash of the day. */
function dailyEvents(day: number): WorldEvent[] {
  const t0 = day * DAY, out: WorldEvent[] = [];
  const season = seasonOf(t0 + 12 * H);
  const sky = skyAt(t0 + 22 * H);
  const night = t0 + 22 * H;
  const clearAt = (t: number) => { const c = weatherAt(t).condition; return c === 'limpo'; };
  if (clearAt(night)) {
    if (sky.moon === 'lua cheia') out.push({ id: `lua-cheia:${day}`, kind: 'lua_cheia', label: 'lua cheia clareando o jardim', start: night - 2 * H, end: night + 5 * H, where: 'ceu', sense: 'ver' });
    if (sky.moon === 'lua nova') out.push({ id: `ceu-estrelado:${day}`, kind: 'ceu_estrelado', label: 'céu sem lua, muito estrelado', start: night - 2 * H, end: night + 5 * H, where: 'ceu', sense: 'ver' });
    if (sky.meteors) out.push({ id: `meteoros:${day}`, kind: 'meteoros', label: 'uma chuva de meteoros cruza o céu', start: night, end: night + 2 * H, where: 'ceu', sense: 'ver', rare: true });
  }
  const butterflyAt = t0 + (10 + Math.floor(hash(day * 11) * 6)) * H;
  if ((season === 'primavera' || season === 'verao') && clearAt(butterflyAt) && hash(day * 7) < 0.5)
    out.push({ id: `borboletas:${day}`, kind: 'borboletas', label: 'borboletas sobre as flores do jardim', start: butterflyAt, end: butterflyAt + 50, where: 'jardim', sense: 'ver' });
  const birdsAt = t0 + (6 + Math.floor(hash(day * 13) * 4)) * H;
  if (season !== 'inverno' && !isRaining(weatherAt(birdsAt).condition) && hash(day * 5) < 0.6)
    out.push({ id: `passaros:${day}`, kind: 'passaros', label: 'pássaros cantando ao longe', start: birdsAt, end: birdsAt + 40, where: 'ar', sense: 'ouvir' });
  if (season === 'primavera' && (day % 14) < 4)
    out.push({ id: `flores:${day}`, kind: 'flores_abrem', label: 'flores novas abrindo no jardim', start: t0 + 7 * H, end: t0 + 18 * H, where: 'jardim', sense: 'ver' });
  if (season === 'outono' && weatherAt(t0 + 15 * H).wind > 0.35)
    out.push({ id: `folhas:${day}`, kind: 'folhas_caem', label: 'folhas caindo da árvore', start: t0 + 14 * H, end: t0 + 17 * H, where: 'jardim', sense: 'ver' });
  return out;
}
/** Every world event overlapping [a, b) (virtual minutes), oldest first. */
export function eventsBetween(a: number, b: number): WorldEvent[] {
  if (b <= a) return [];
  const span = Math.min(b - a, 3 * DAY); // never scan more than three virtual days
  const from = b - span;
  const out = weatherEvents(from - 6 * H, b).filter((e) => e.end > from && e.start < b);
  for (let d = Math.floor((from - DAY) / DAY); d * DAY < b; d++) out.push(...dailyEvents(d).filter((e) => e.end > from && e.start < b));
  return out.sort((x, y) => x.start - y.start);
}
export const activeAt = (vm: number) => eventsBetween(vm - 1, vm + 1).filter((e) => e.start <= vm && e.end > vm);

/**
 * Could she perceive this event? Asleep: nothing. Sounds and felt changes reach her anywhere in the
 * house. Sights need her outdoors, or looking out (observing a window, the garden or the sky).
 */
export function perceives(e: WorldEvent, ctx: { awake: boolean; outdoors: boolean; lookingOut: boolean; night: boolean }) {
  if (!ctx.awake) return null;
  if (e.sense === 'ouvir') return 'ouviu';
  if (e.sense === 'sentir') return 'sentiu';
  if (ctx.outdoors) return 'viu no jardim';
  if (ctx.lookingOut) return 'viu pela janela';
  return null;
}
export { dayStart, periodOf };
