// Summarizes artifacts/cognitive-audit/bench-*.json into a before/after comparison.
// Usage: node scripts/architecture-summary.mjs before after [before2 after2 ...]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const labels = process.argv.slice(2);
const rows = labels.flatMap((l) => (existsSync(`artifacts/cognitive-audit/bench-${l}.json`) ? JSON.parse(readFileSync(`artifacts/cognitive-audit/bench-${l}.json`, 'utf8')).rows : []));
const arch = (r) => (String(r.arch).startsWith('before') ? 'antes' : 'depois');
const mean = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
const groups = {};
for (const r of rows) (groups[arch(r) + '|' + r.model] ??= []).push(r);
const table = Object.entries(groups).map(([k, rs]) => {
  const [a, model] = k.split('|');
  const ok = rs.filter((r) => r.valid);
  return {
    arquitetura: a, modelo: model, execucoes: rs.length, validas: ok.length, falhasProvedor: rs.filter((r) => !r.valid).map((r) => r.outcome).join(',') || '-',
    coerencia: mean(ok.map((r) => r.coherence)),
    iniciativa: mean(ok.map((r) => (r.engaged ? 1 : 0))),
    continuidade: mean(ok.filter((r) => r.continuity !== null).map((r) => (r.continuity ? 1 : 0))),
    cuidadoSemNecessidade: ok.filter((r) => r.careWithoutNeed).length,
    necessidadeIntensaIgnorada: ok.filter((r) => r.intenseIgnored).length,
    repetiuRecusada: ok.filter((r) => r.repeatRefused).length,
    repetiuPesquisa: ok.filter((r) => r.repeatResearch).length,
    acoesExecutadas: mean(ok.map((r) => r.executed)),
    tokensTotais: mean(ok.map((r) => r.tokens).filter((x) => x != null)),
    tokensEntrada: mean(ok.map((r) => r.tokensIn).filter((x) => x != null)),
    tokensSaida: mean(ok.map((r) => r.tokensOut).filter((x) => x != null)),
    latenciaMs: mean(ok.map((r) => r.latencyMs).filter((x) => x != null)),
  };
}).sort((x, y) => (x.modelo + x.arquitetura).localeCompare(y.modelo + y.arquitetura));
const scenarios = [...new Set(rows.map((r) => r.scenario))];
const pairs = scenarios.map((s) => ({ cenario: s, ...Object.fromEntries(['antes', 'depois'].map((a) => [a, rows.filter((r) => r.scenario === s && arch(r) === a).map((r) => `${r.model.split(':')[1].split('/').pop()}: ${r.valid ? r.actions.map((x) => x.slice(0, 70)).join(' + ') || '(nenhuma ação)' : 'sem decisão (' + r.outcome + ')'}`)])) }));
writeFileSync('artifacts/cognitive-audit/comparison.json', JSON.stringify({ table, pairs }, null, 1));
console.table(table.map(({ arquitetura, modelo, validas, execucoes, coerencia, iniciativa, continuidade, cuidadoSemNecessidade, repetiuRecusada, repetiuPesquisa, tokensTotais, latenciaMs }) => ({ a: arquitetura, m: modelo.split('/').pop(), ok: validas + '/' + execucoes, coer: coerencia, inic: iniciativa, cont: continuidade, cuid: cuidadoSemNecessidade, recus: repetiuRecusada, pesq: repetiuPesquisa, tok: tokensTotais, ms: latenciaMs })));
