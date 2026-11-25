// Turns artifacts/model-benchmarks.raw.json (real calls) into:
//   artifacts/model-benchmarks.json  — per model × category matrix with all metrics
//   shared/model-quality.json        — what the router may use (homologation decisions)
// Rules (documented in MODEL_BENCHMARKS.md):
//   row score  = 0.4·technical + 0.6·scenario expectation, only for valid decisions
//   quality    = mean row score over VALID replies (provider outages measure availability, not quality)
//   format     = valid / (valid + invalid replies); outages (503/429/timeout) excluded
//   homologated for a category when: ≥2 valid replies there, quality ≥ 0.55 and format ≥ 0.75
// Gemini Lite/Flash keep their production evidence (since 24/11) if the benchmark could not reach
// them because of provider overload — labeled explicitly, never presented as a benchmark result.
import { readFileSync, writeFileSync } from 'node:fs';
const raw = JSON.parse(readFileSync('artifacts/model-benchmarks.raw.json', 'utf8'));
// Corrected re-runs (node scripts/benchmark-summary.mjs file1 file2 …) replace the main rows of the same
// model+scenario: used after the tool-contract fix (unions rendered as lists made OpenAI-compatible
// models send artifact as an array). The replaced rows remain in the raw file for audit.
const overrides = process.argv.slice(2).flatMap((f) => JSON.parse(readFileSync(f, 'utf8')).rows);
const replaced = new Set(overrides.map((r) => r.model + '|' + r.scenario));
const corrections = { files: process.argv.slice(2), replacedPairs: [...replaced], replacedRows: raw.rows.filter((r) => replaced.has(r.model + '|' + r.scenario)).length };
raw.rows = [...raw.rows.filter((r) => !replaced.has(r.model + '|' + r.scenario)), ...overrides];
const previous = JSON.parse(readFileSync('shared/model-quality.json', 'utf8'));
const categories = ['cotidiana', 'complexa', 'memoria', 'pesquisa', 'criatividade', 'comunicacao'];
const outage = new Set(['sobrecarga', 'limite_taxa', 'cota_esgotada', 'timeout', 'rede']);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (x, d = 3) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);
const models = [...new Set(raw.rows.map((r) => r.model))];
const matrix = {};
const quality = { generatedAt: new Date().toISOString(), method: 'Benchmark do Bunborn com chamadas reais pelo motor real (tests/benchmark.live.test.ts); regras em scripts/benchmark-summary.mjs e MODEL_BENCHMARKS.md.', models: {} };
for (const model of models) {
  const rows = raw.rows.filter((r) => r.model === model);
  const valid = rows.filter((r) => r.valid);
  const invalid = rows.filter((r) => !r.valid && !outage.has(r.outcome));
  const outages = rows.filter((r) => !r.valid && outage.has(r.outcome));
  const perCategory = {};
  const scores = {};
  const homologated = [];
  for (const c of categories) {
    const cr = rows.filter((r) => r.category === c);
    if (!cr.length) continue;
    const cv = cr.filter((r) => r.valid);
    const ci = cr.filter((r) => !r.valid && !outage.has(r.outcome));
    const q = mean(cv.map((r) => 0.4 * r.technical + 0.6 * r.expectation));
    const format = cv.length + ci.length ? cv.length / (cv.length + ci.length) : null;
    perCategory[c] = { runs: cr.length, valid: cv.length, invalid: ci.length, outages: cr.length - cv.length - ci.length, quality: round(q), expectation: round(mean(cv.map((r) => r.expectation))), technical: round(mean(cv.map((r) => r.technical))), format: round(format) };
    if (q !== null) scores[c] = round(q);
    if (cv.length >= 2 && q >= 0.55 && format >= 0.75) homologated.push(c);
  }
  const lat = valid.map((r) => r.latencyMs).filter((x) => x !== null).sort((a, b) => a - b);
  matrix[model] = {
    provider: rows[0].provider,
    runs: rows.length, valid: valid.length, invalidReplies: invalid.length, outages: outages.length,
    availability: round(rows.length ? (rows.length - outages.length) / rows.length : 0),
    formatValidity: round(valid.length + invalid.length ? valid.length / (valid.length + invalid.length) : null),
    latencyMedianMs: lat.length ? lat[Math.floor(lat.length / 2)] : null,
    tokensMean: round(mean(valid.map((r) => r.tokens).filter((x) => x !== null)), 0),
    invalidActionsPerDecision: round(mean(valid.map((r) => r.invalidActions))),
    motorRejectionsPerDecision: round(mean(valid.map((r) => r.motorRejections))),
    outageKinds: Object.fromEntries([...new Set(outages.map((r) => r.outcome))].map((k) => [k, outages.filter((r) => r.outcome === k).length])),
    invalidKinds: Object.fromEntries([...new Set(invalid.map((r) => r.outcome))].map((k) => [k, invalid.filter((r) => r.outcome === k).length])),
    perCategory,
  };
  const prev = previous.models?.[model];
  if (!valid.length && prev && model.startsWith('gemini:gemini-3')) {
    quality.models[model] = { ...prev, note: 'Sem resposta no benchmark (Gemini sobrecarregado, HTTP 503); mantida a evidência de produção desde 24/11 com pontuação neutra.' };
  } else if (homologated.length) {
    const label = model.split(':').slice(1).join(':');
    const entry = model === 'gemini:gemini-3.5-flash-lite'
      ? { label: 'Gemini 3.5 Flash Lite', free: 'verificado', limits: { rpm: 8, rpd: 200, tpm: 200000, tpd: null, source: 'interno', resetsAt: '00:00 Pacífico' }, documentedLimits: 'não informado no painel; limite interno conservador (respondeu sem faturamento vinculado)' }
      : model.startsWith('nvidia:') ? { label } : undefined;
    quality.models[model] = { ...(entry ? { entry } : {}), scores, homologated };
  }
}
writeFileSync('artifacts/model-benchmarks.json', JSON.stringify({ at: raw.at, reps: raw.reps, scenarios: raw.scenarios, corrections, matrix }, null, 1));
writeFileSync('shared/model-quality.json', JSON.stringify(quality, null, 1) + '\n');
console.log('model | valid/runs | outages | format | median ms | tokens | ' + categories.join(' | '));
for (const [m, v] of Object.entries(matrix)) console.log([m, v.valid + '/' + v.runs, v.outages, v.formatValidity, v.latencyMedianMs, v.tokensMean, ...categories.map((c) => (v.perCategory[c]?.quality ?? '-') + (quality.models[m]?.homologated?.includes(c) ? '*' : ''))].join(' | '));
