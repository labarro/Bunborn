// Verifies autonomous operation while THIS computer was off or asleep.
// Usage:
//   node scripts/verify-offline-window.mjs --windows-log [homologation|production]
//       uses the latest shutdown/sleep -> boot/wake interval from the Windows System log
//   node scripts/verify-offline-window.mjs <fromISO> <toISO> [homologation|production]
// Evidence comes only from Cloudflare (D1 rows written by the Worker and Cron analytics);
// nothing here runs during the window itself. Read-only.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile } from 'node:fs/promises';
import { cf, accountId, cloudflareToken } from './cloudflare.mjs';
const run = promisify(execFile);
const args = process.argv.slice(2);
let from, to, source;
const envName = args.find((a) => ['homologation', 'production'].includes(a)) ?? 'homologation';
if (args[0] === '--windows-log') {
  // 6006/1074 = shutdown/restart initiated, 42 = sleep; 6005 = boot, 1 (Power-Troubleshooter) = wake.
  const ps = `$e=Get-WinEvent -FilterHashtable @{LogName='System';Id=6005,6006,1074,42,1;StartTime=(Get-Date).AddDays(-7)} -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne 1 -or $_.ProviderName -eq 'Microsoft-Windows-Power-Troubleshooter' } | Select-Object Id,ProviderName,@{n='t';e={$_.TimeCreated.ToUniversalTime().ToString('o')}}; $e | ConvertTo-Json -Compress`;
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, maxBuffer: 2000000 });
  const events = [].concat(JSON.parse(stdout || '[]')).sort((a, b) => a.t.localeCompare(b.t));
  const downIds = new Set([6006, 1074, 42]), upIds = new Set([6005, 1]);
  for (let i = events.length - 1; i >= 0 && !from; i--) if (upIds.has(events[i].Id)) for (let j = i - 1; j >= 0; j--) if (downIds.has(events[j].Id)) { from = events[j].t; to = events[i].t; source = `Windows System log: event ${events[j].Id} -> ${events[i].Id}`; break; }
  if (!from) throw new Error('no shutdown/sleep -> boot/wake pair found in the last 7 days');
} else {
  [from, to] = args;
  source = 'manual window supplied by the observer';
}
const start = new Date(from), end = new Date(to);
if (!(end > start)) throw new Error('invalid window');
const resources = JSON.parse(await readFile('artifacts/cloudflare-resources.json', 'utf8'));
const db = resources.databases['bunborn-' + envName];
const q = async (sql, params = []) => (await cf(`/accounts/${accountId}/d1/database/${db}/query`, { method: 'POST', body: JSON.stringify({ sql, params }) }))[0].results;
const [s, e] = [start.getTime(), end.getTime()];
const decisions = await q("SELECT COUNT(*) AS n, MIN(real_at) AS first, MAX(real_at) AS last FROM records WHERE kind='intencao' AND real_at BETWEEN ? AND ?", [s, e]);
const records = await q('SELECT kind, COUNT(*) AS n FROM records WHERE real_at BETWEEN ? AND ? GROUP BY kind ORDER BY n DESC', [s, e]);
const calls = await q('SELECT model, status, COUNT(*) AS n, SUM(actual_tokens) AS tokens FROM calls WHERE at BETWEEN ? AND ? GROUP BY model, status', [s, e]);
const cycles = await q('SELECT COUNT(*) AS n, SUM(rows_read) AS reads, SUM(rows_written) AS writes FROM cycle_metrics WHERE started_at BETWEEN ? AND ?', [s, e]);
const token = await cloudflareToken();
const gql = await (await fetch('https://api.cloudflare.com/client/v4/graphql', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ query: `query{viewer{accounts(filter:{accountTag:"${accountId}"}){workersInvocationsAdaptive(limit:10000,filter:{datetime_geq:"${start.toISOString()}",datetime_leq:"${end.toISOString()}",scriptName:"bunborn-${envName}",eventType:"cron"}){sum{requests} dimensions{datetimeMinute status}}}}}` }) })).json();
const minutes = gql.data?.viewer.accounts[0].workersInvocationsAdaptive ?? [];
const expectedMinutes = Math.floor((e - s) / 60000);
const report = {
  checkedAt: new Date().toISOString(), environment: envName, window: { from: start.toISOString(), to: end.toISOString(), minutes: expectedMinutes, source },
  cloudflareCron: { minutesWithInvocation: new Set(minutes.map((m) => m.dimensions.datetimeMinute)).size, expectedMinutes, statuses: minutes.reduce((acc, m) => ((acc[m.dimensions.status] = (acc[m.dimensions.status] ?? 0) + m.sum.requests), acc), {}), analyticsErrors: gql.errors?.map((x) => x.message) ?? null },
  d1Evidence: { decisions: decisions[0], recordsByKind: records, geminiCalls: calls, measuredCycles: cycles[0] },
};
report.verdict = report.d1Evidence.decisions.n > 0 && report.cloudflareCron.minutesWithInvocation > 0
  ? 'Autonomous activity was recorded by Cloudflare inside a window in which this computer was off/asleep.'
  : 'No autonomous decision recorded inside the window (check experiment status, budget, backoff, or window length vs. decision interval).';
await writeFile(`artifacts/offline-window-${envName}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
