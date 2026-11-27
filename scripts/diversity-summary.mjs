// Summarises the before/after real-call comparison of the cognitive diversity work (27/11).
// Usage: node scripts/diversity-summary.mjs [beforeLabel] [afterLabel]
import { readFileSync, writeFileSync } from 'node:fs';
const [b = 'div-before', a = 'div-after'] = process.argv.slice(2);
const load = (l) => JSON.parse(readFileSync(`artifacts/cognitive-audit/bench-${l}.json`, 'utf8')).rows;
const sum = (rows) => {
  const by = {};
  for (const r of rows) {
    const s = (by[r.scenario] ??= { runs: 0, valid: 0, actions: 0, refused: 0, refusalCodes: {}, diary: 0, periodOpener: 0, sameOpening: 0, executedAvg: 0, intentions: [] });
    s.runs++;
    if (r.valid) s.valid++;
    s.actions += r.actions.length;
    s.refused += r.refusals.length;
    for (const c of r.refusals) s.refusalCodes[c] = (s.refusalCodes[c] ?? 0) + 1;
    if (r.diaryEcho) { s.diary++; if (r.diaryEcho.periodOpener) s.periodOpener++; if (r.diaryEcho.sameOpening) s.sameOpening++; }
    s.executedAvg += r.executed;
    s.intentions.push(`${r.model.split(':')[1]}: ${r.intention ?? '—'} [${r.actions.join(', ')}]`);
  }
  for (const s of Object.values(by)) s.executedAvg = Math.round((s.executedAvg / s.runs) * 100) / 100;
  return by;
};
const out = { before: sum(load(b)), after: sum(load(a)) };
writeFileSync('artifacts/diversity/comparison.json', JSON.stringify(out, null, 1));
for (const sc of Object.keys(out.after)) {
  const x = out.before[sc] ?? {}, y = out.after[sc];
  console.log(`\n## ${sc}\nantes: válidas ${x.valid}/${x.runs}, ações ${x.actions}, recusadas ${x.refused} ${JSON.stringify(x.refusalCodes)}, diário ${x.diary} (abre com período ${x.periodOpener}, mesma abertura ${x.sameOpening}), execução média ${x.executedAvg}`);
  console.log(`depois: válidas ${y.valid}/${y.runs}, ações ${y.actions}, recusadas ${y.refused} ${JSON.stringify(y.refusalCodes)}, diário ${y.diary} (abre com período ${y.periodOpener}, mesma abertura ${y.sameOpening}), execução média ${y.executedAvg}`);
  for (const i of x.intentions ?? []) console.log('  antes  · ' + i.slice(0, 170));
  for (const i of y.intentions) console.log('  depois · ' + i.slice(0, 170));
}
