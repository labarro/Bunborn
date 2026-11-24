// Scans every file Git would version (tracked + untracked not ignored) for the REAL secret
// values (decrypted in memory, never printed) and for generic credential patterns.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { encryptedGeneratedSecrets, readGemini } from './private-secrets.mjs';
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const generated = await encryptedGeneratedSecrets();
const gemini = await readGemini();
const exact = [gemini.key, ...Object.values(generated).flatMap((e) => [e.observer, e.session])].filter((v) => v && v.length >= 20);
const patterns = [
  ['google-api-key', /AIza[0-9A-Za-z_-]{35}/],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['github-token', /gh[pousr]_[0-9A-Za-z]{36,}/],
  ['cloudflare-token-assignment', /CLOUDFLARE_API_TOKEN\s*[=:]\s*["']?[A-Za-z0-9_-]{30,}/],
  ['bearer-literal', /Bearer\s+[A-Za-z0-9._-]{40,}/],
  ['dpapi-blob', /01000000d08c9ddf0115d1118c7a00c04fc297eb/i],
];
const findings = [];
for (const file of files) {
  if (/[\\/]?(node_modules|\.wrangler|dist)[\\/]/.test(file)) { findings.push({ file, issue: 'should-be-ignored' }); continue; }
  let text;
  try { if (statSync(file).size > 20_000_000) continue; text = readFileSync(file, 'latin1'); } catch { continue; }
  if (exact.some((v) => text.includes(v))) findings.push({ file, issue: 'REAL SECRET VALUE' });
  if (file !== 'scripts/secret-scan.mjs') for (const [name, re] of patterns) if (re.test(text)) findings.push({ file, issue: name });
}
console.log(JSON.stringify({ scannedFiles: files.length, exactSecretsChecked: exact.length, findings }, null, 1));
if (findings.length) process.exitCode = 1;
