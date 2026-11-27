// Long works and real revisions (27/11). A revision must change something verifiable; the change is
// measured here (no AI) and stored with the new version, so "revised 5 times" can be told apart
// from "saved the same thing 5 times".
import type { Artifact } from './domain.ts';
import { contentWords, jaccard } from './similarity.ts';

export type Change = { summary: string; identical: boolean; details: Record<string, number> };
export function diffArtifact(prev: Artifact | null | undefined, next: Artifact): Change {
  if (!prev) return { summary: 'primeira versão', identical: false, details: {} };
  if (JSON.stringify(prev) === JSON.stringify(next)) return { summary: 'idêntica à versão anterior', identical: true, details: {} };
  if (prev.format !== next.format) return { summary: `formato mudou de ${prev.format} para ${next.format}`, identical: false, details: {} };
  if (next.format === 'texto' && prev.format === 'texto') {
    const a = contentWords(prev.content), b = contentWords(next.content);
    let added = 0, removed = 0;
    for (const w of b) if (!a.has(w)) added++;
    for (const w of a) if (!b.has(w)) removed++;
    const delta = next.content.length - prev.content.length;
    const sections = (t: string) => (t.match(/^##\s+.+$/gm) ?? []).length;
    return { summary: `${delta >= 0 ? '+' : ''}${delta} caracteres, ${added} palavras novas, ${removed} retiradas, ${Math.round((1 - jaccard(a, b)) * 100)}% do vocabulário mudou${sections(next.content) !== sections(prev.content) ? `, seções ${sections(prev.content)} → ${sections(next.content)}` : ''}`, identical: false, details: { delta, added, removed, sections: sections(next.content) } };
  }
  if (next.format === 'pintura' && prev.format === 'pintura') {
    const a = new Set(prev.strokes.map((s) => JSON.stringify(s))), b = new Set(next.strokes.map((s) => JSON.stringify(s)));
    let kept = 0;
    for (const s of b) if (a.has(s)) kept++;
    const canvas = prev.width !== next.width || prev.height !== next.height || prev.background !== next.background;
    return { summary: `${b.size - kept} traços novos ou alterados, ${a.size - kept} removidos, ${kept} mantidos${canvas ? ', tela mudou' : ''}`, identical: false, details: { added: b.size - kept, removed: a.size - kept, kept } };
  }
  if (next.format === 'musica' && prev.format === 'musica') {
    const key = (n: { pitch: number; beats: number }) => `${n.pitch}:${n.beats}`;
    let same = 0;
    for (let i = 0; i < Math.min(prev.notes.length, next.notes.length); i++) if (key(prev.notes[i]) === key(next.notes[i])) same++;
    return { summary: `${next.notes.length} notas (antes ${prev.notes.length}), ${Math.max(prev.notes.length, next.notes.length) - same} posições diferentes${prev.tempo !== next.tempo ? `, andamento ${prev.tempo} → ${next.tempo}` : ''}`, identical: false, details: { notes: next.notes.length, changed: Math.max(prev.notes.length, next.notes.length) - same } };
  }
  return { summary: 'alterada', identical: false, details: {} };
}
/** Replace or add one "## Section" of a text work without resending the whole work. */
export function editSection(content: string, title: string, body: string, mode: 'adicionar' | 'substituir') {
  const lines = content.split('\n');
  const head = (l: string) => /^##\s+/.test(l);
  const at = lines.findIndex((l) => head(l) && l.replace(/^##\s+/, '').trim().toLocaleLowerCase('pt-BR') === title.trim().toLocaleLowerCase('pt-BR'));
  if (at < 0) return `${content.trimEnd()}\n\n## ${title.trim()}\n${body.trim()}\n`;
  let end = lines.findIndex((l, i) => i > at && head(l));
  if (end < 0) end = lines.length;
  const current = lines.slice(at + 1, end).join('\n').trim();
  const next = mode === 'substituir' ? body.trim() : `${current}\n\n${body.trim()}`.trim();
  return [...lines.slice(0, at + 1), next, '', ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n');
}
/** Section titles of a text work (its structure, sent instead of the whole text). */
export const sectionsOf = (content: string) => (content.match(/^##\s+(.+)$/gm) ?? []).map((l) => l.replace(/^##\s+/, '').trim());
