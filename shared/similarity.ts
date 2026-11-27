// Deterministic text and sequence similarity (27/11): no AI calls, cheap on Worker CPU. Used to
// (a) diversify what comes back as memory, (b) tell her factually when a new diary entry resembles
// recent ones, (c) give the OBSERVER repetition indicators. Indicators, never judgements or goals.
const stop = new Set('a o e de da do das dos em no na nos nas um uma uns umas que se por para com como mais mas ao aos as os sua seu suas seus minha meu minhas meus isso esta este essa esse ja nao me eu ela ele foi ser estar ter ha sobre entre cada tambem quando onde ainda muito pela pelo pelas pelos lhe vez mim meu nesta neste nessa nesse pelo sem tem tao'.split(' '));
export const normalize = (t: string) => t.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
/** Content words (≥3 letters, no stop words). */
export const contentWords = (t: string) => new Set(normalize(t).split(' ').filter((w) => w.length > 2 && !stop.has(w)));
/** Word n-grams (structure, not only vocabulary). */
export function shingles(t: string, n = 3) {
  const w = normalize(t).split(' ').filter(Boolean);
  const s = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) s.add(w.slice(i, i + n).join(' '));
  return s;
}
export function jaccard<T>(a: Set<T>, b: Set<T>) {
  if (!a.size || !b.size) return 0;
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return i / (a.size + b.size - i);
}
/** First words, the "frame" of a text ("a manha de verao"). */
export const opening = (t: string, n = 3) => normalize(t).split(' ').slice(0, n).join(' ');
/** How close a text is to the closest of some earlier texts, with the reason. */
export function closest(text: string, earlier: { id?: string; content: string; realAt?: number }[]) {
  const w = contentWords(text), s = shingles(text), o = opening(text);
  let best = { words: 0, structure: 0, sameOpening: false, id: undefined as string | undefined, realAt: undefined as number | undefined };
  for (const e of earlier) {
    const words = jaccard(w, contentWords(e.content)), structure = jaccard(s, shingles(e.content));
    const sameOpening = o.length > 6 && opening(e.content) === o;
    if (words + structure + (sameOpening ? 0.15 : 0) > best.words + best.structure + (best.sameOpening ? 0.15 : 0)) best = { words, structure, sameOpening, id: e.id, realAt: e.realAt };
  }
  return best;
}
/** 64-bit SimHash (two 32-bit halves) of content words, for cheap near-duplicate grouping. */
export function simhash(text: string): [number, number] {
  const v = new Array(64).fill(0);
  for (const w of contentWords(text)) {
    let h1 = 2166136261, h2 = 5381;
    for (const c of w) { h1 = Math.imul(h1 ^ c.charCodeAt(0), 16777619); h2 = (Math.imul(h2, 33) + c.charCodeAt(0)) | 0; }
    for (let i = 0; i < 32; i++) { v[i] += (h1 >>> i) & 1 ? 1 : -1; v[32 + i] += (h2 >>> i) & 1 ? 1 : -1; }
  }
  let a = 0, b = 0;
  for (let i = 0; i < 32; i++) { if (v[i] > 0) a |= 1 << i; if (v[32 + i] > 0) b |= 1 << i; }
  return [a >>> 0, b >>> 0];
}
export function hamming(x: [number, number], y: [number, number]) {
  let d = 0;
  for (let n = (x[0] ^ y[0]) >>> 0; n; n &= n - 1) d++;
  for (let n = (x[1] ^ y[1]) >>> 0; n; n &= n - 1) d++;
  return d;
}
/**
 * Maximal Marginal Relevance: pick items by relevance while penalising similarity to what was
 * already picked. Nothing random: the same candidates always give the same selection.
 */
export function mmr<T>(items: { item: T; score: number; text: string }[], k: number, lambda = 0.6) {
  const chosen: { item: T; score: number; text: string; words: Set<string> }[] = [];
  const pool = items.map((x) => ({ ...x, words: contentWords(x.text) }));
  while (chosen.length < k && pool.length) {
    let bi = 0, bv = -Infinity;
    pool.forEach((p, i) => {
      const sim = chosen.length ? Math.max(...chosen.map((c) => jaccard(p.words, c.words))) : 0;
      const v = lambda * p.score - (1 - lambda) * sim;
      if (v > bv) { bv = v; bi = i; }
    });
    chosen.push(pool.splice(bi, 1)[0]);
  }
  return chosen.map((c) => c.item);
}
/** Most repeated action sequences (n consecutive decisions), e.g. "diario > descansar > diario". */
export function repeatedSequences(seq: string[], n = 3, min = 3) {
  const counts = new Map<string, number>();
  for (let i = n - 1; i < seq.length; i++) { const k = seq.slice(i - n + 1, i + 1).join(' > '); counts.set(k, (counts.get(k) ?? 0) + 1); }
  return [...counts].filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1]);
}
/** Average of each text's highest similarity to the previous `window` texts (0 = all different). */
export function rollingSimilarity(texts: string[], window = 10) {
  const sets = texts.map((t) => contentWords(t));
  const sims: number[] = [];
  for (let i = 1; i < texts.length; i++) sims.push(Math.max(...sets.slice(Math.max(0, i - window), i).map((p) => jaccard(sets[i], p))));
  return { average: sims.length ? sims.reduce((a, b) => a + b, 0) / sims.length : 0, high: sims.filter((x) => x >= 0.35).length, n: sims.length };
}
