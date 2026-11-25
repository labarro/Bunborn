// Runs the Bunborn cognitive benchmark with real calls. Keys are read from DPAPI into the child
// process environment only (never printed, never written). Disposable in-memory databases only.
// Usage: node scripts/benchmark.mjs [modelFilter,...] [reps]
import { spawn } from 'node:child_process';
import { readGemini, readProviderKey } from './private-secrets.mjs';
const env = {
  ...process.env,
  BENCH: '1',
  BENCH_GEMINI: (await readGemini()).key,
  BENCH_GROQ: (await readProviderKey('groq')) ?? '',
  BENCH_NVIDIA: (await readProviderKey('nvidia')) ?? '',
  BENCH_MODELS: process.argv[2] ?? '',
  BENCH_REPS: process.argv[3] ?? '2',
  BENCH_SCENARIOS: process.argv[4] ?? '',
  BENCH_OUT: process.argv[5] ?? 'artifacts/model-benchmarks.raw.json',
  BENCH_STRUCTURED: process.argv[6] ?? '',
};
const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/benchmark.live.test.ts', '--reporter=dot', '--testTimeout=14400000'], { env, stdio: 'inherit', windowsHide: true });
child.on('exit', (code) => process.exit(code ?? 1));
