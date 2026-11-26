// Runs tests/architecture.live.test.ts with real calls. Keys come from DPAPI into the child
// environment only (never printed or written). Disposable in-memory databases only.
// Usage: node scripts/architecture-bench.mjs <label> <models,...> [scenarios] [cwd]
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { readGemini, readProviderKey } from './private-secrets.mjs';
const [label, models, scenarios = '', cwd = process.cwd()] = process.argv.slice(2);
const backup = resolve(process.cwd(), '.wrangler/private/backups/production-ec69d046-df76-4aff-9a4e-2376dc8a0c4b.backup.json');
const env = { ...process.env, BENCH: '1', ARCH_LABEL: label, ARCH_MODELS: models, ARCH_SCENARIOS: scenarios, ARCH_BACKUP: backup, ARCH_OUT: resolve(process.cwd(), `artifacts/cognitive-audit/bench-${label}.json`), BENCH_GEMINI: (await readGemini()).key, BENCH_GROQ: (await readProviderKey('groq')) ?? '', BENCH_NVIDIA: (await readProviderKey('nvidia')) ?? '' };
const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/architecture.live.test.ts', '--reporter=dot', '--testTimeout=14400000'], { cwd, env, stdio: 'inherit', windowsHide: true });
child.on('exit', (code) => process.exit(code ?? 1));
