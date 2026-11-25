// Bundles a TypeScript script with esbuild (already a dependency) and runs it with Node.
// Usage: node scripts/run-ts.mjs scripts/ai-smoke.ts [args]
// Output goes next to the source (scripts/.tmp-*.mjs, git-ignored) so the relative external
// ./private-secrets.mjs keeps resolving against .wrangler/private.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
const [entry, ...rest] = process.argv.slice(2);
const outfile = 'scripts/.tmp-' + entry.split(/[\\/]/).pop().replace(/\.ts$/, '.mjs');
await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error',
  external: ['./private-secrets.mjs'],
  loader: { '.json': 'json' },
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
process.argv = [process.argv[0], outfile, ...rest];
await import(pathToFileURL(outfile).href);
