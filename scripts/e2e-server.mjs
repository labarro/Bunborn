import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
const root = process.cwd();
const dir = path.join(root, '.wrangler', 'e2e');
await mkdir(dir, { recursive: true });
const persist = path.join(dir, 'state-' + Date.now());
await writeFile(
  path.join(dir, 'wrangler.json'),
  JSON.stringify({
    name: 'bunborn-disposable-e2e',
    main: path.join(root, 'worker/index.ts'),
    compatibility_date: '2026-11-01',
    assets: {
      directory: path.join(root, 'dist'),
      binding: 'ASSETS',
      not_found_handling: 'single-page-application',
      run_worker_first: ['/api/*'],
    },
    d1_databases: [
      {
        binding: 'DB',
        database_name: 'disposable-e2e',
        database_id: '11111111-1111-1111-1111-111111111111',
        migrations_dir: path.join(root, 'migrations'),
      },
    ],
    durable_objects: { bindings: [{ name: 'COGNITION', class_name: 'CognitionCoordinator' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['CognitionCoordinator'] }],
    vars: {
      ENVIRONMENT: 'test',
      PUBLIC_OBSERVATION: 'true',
      FREE_TIER_CONFIRMED: 'false',
      MODEL_LITE: 'gemini-3.1-flash-lite',
      MODEL_FLASH: 'gemini-3-flash-preview',
      LITE_DAILY_LIMIT: '440',
      FLASH_DAILY_LIMIT: '16',
    },
  }),
);
// Explicit fixture credentials, never external API keys. Only for loopback disposable tests.
await writeFile(
  path.join(dir, '.dev.vars'),
  'OBSERVER_SECRET="fixture-observer-for-local-tests-only-123456"\nSESSION_SECRET="fixture-session-for-local-tests-only-abcdef"\n',
);
const cli = path.join(root, 'node_modules/wrangler/bin/wrangler.js');
const config = path.join(dir, 'wrangler.json');
const run = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      stdio: 'inherit',
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Wrangler exit ' + code)),
    );
  });
await run([
  'd1',
  'migrations',
  'apply',
  'DB',
  '--local',
  '--config',
  config,
  '--persist-to',
  persist,
]);
const child = spawn(
  process.execPath,
  [cli, 'dev', '--config', config, '--persist-to', persist, '--ip', '127.0.0.1', '--port', '8788'],
  { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    child.kill();
    process.exit();
  });
child.on('exit', (code) => process.exit(code ?? 0));
