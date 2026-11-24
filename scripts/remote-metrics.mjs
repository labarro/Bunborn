// Read-only Cloudflare analytics: Worker/Cron/Durable Object CPU, D1 usage and sizes.
// Usage: node scripts/remote-metrics.mjs [hours=24] [outfile]
// CPU values from GraphQL are MICROSECONDS. Quantiles are sampled (adaptive) estimates.
import { cloudflareToken, accountId, cf } from './cloudflare.mjs';
import { readFile, writeFile } from 'node:fs/promises';
const hours = Math.max(1, Math.min(168, Number(process.argv[2]) || 24));
const outfile = process.argv[3] ?? 'artifacts/remote-metrics.json';
const token = await cloudflareToken();
const end = new Date(), start = new Date(end - hours * 3600000);
const scripts = ['bunborn-homologation', 'bunborn-production'];
async function gql(query) {
  const response = await fetch('https://api.cloudflare.com/client/v4/graphql', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(60000) });
  const value = await response.json();
  if (value.errors?.length) return { errors: value.errors.map((e) => e.message) };
  return value.data.viewer.accounts[0];
}
const range = `datetime_geq:"${start.toISOString()}",datetime_leq:"${end.toISOString()}"`;
const scriptFilter = `scriptName_in:${JSON.stringify(scripts)}`;
const workers = await gql(`query{viewer{accounts(filter:{accountTag:"${accountId}"}){
 workersInvocationsAdaptive(limit:200,filter:{${range},${scriptFilter}}){sum{requests errors subrequests cpuTimeUs startupCpuTimeUs} quantiles{cpuTimeP50 cpuTimeP90 cpuTimeP99 cpuTimeP999 startupCpuTimeUsP50 startupCpuTimeUsP99 wallTimeP50 wallTimeP99} dimensions{scriptVersion eventType status}}
 durableObjectsInvocationsAdaptiveGroups(limit:200,filter:{${range},${scriptFilter}}){sum{requests errors wallTime} quantiles{cpuTimeP50 cpuTimeP90 cpuTimeP99 cpuTimeP999 wallTimeP50 wallTimeP99} dimensions{scriptVersion type status}}
 durableObjectsPeriodicGroups(limit:100,filter:{${range}}){sum{cpuTime activeTime duration exceededCpuErrors exceededMemoryErrors rowsRead rowsWritten} dimensions{namespaceId}}
}}}`);
const scheduled = {};
for (const script of scripts) {
  const rows = await gql(`query{viewer{accounts(filter:{accountTag:"${accountId}"}){workersInvocationsScheduled(limit:10000,filter:{${range},scriptName:"${script}"}){cpuTimeUs status datetime}}}}`);
  if (rows.errors) { scheduled[script] = rows; continue; }
  const list = rows.workersInvocationsScheduled ?? [];
  const cpu = list.map((r) => r.cpuTimeUs).sort((a, b) => a - b);
  const q = (p) => (cpu.length ? cpu[Math.min(cpu.length - 1, Math.floor(p * cpu.length))] : null);
  const statuses = {};
  for (const r of list) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
  scheduled[script] = { invocations: list.length, statuses, cpuUs: { p50: q(0.5), p90: q(0.9), p99: q(0.99), max: cpu.at(-1) ?? null }, over10ms: cpu.filter((c) => c > 10000).length, first: list.at(-1)?.datetime ?? null, last: list[0]?.datetime ?? null };
}
const resources = JSON.parse(await readFile('artifacts/cloudflare-resources.json', 'utf8'));
const d1 = await gql(`query{viewer{accounts(filter:{accountTag:"${accountId}"}){d1AnalyticsAdaptiveGroups(limit:200,filter:{date_geq:"${start.toISOString().slice(0, 10)}",date_leq:"${end.toISOString().slice(0, 10)}"}){sum{readQueries writeQueries rowsRead rowsWritten} dimensions{databaseId date}}}}}`);
const databases = {};
for (const [name, id] of Object.entries(resources.databases)) {
  const result = await cf(`/accounts/${accountId}/d1/database/${id}`);
  databases[name] = { uuid: id, file_size: result.file_size, num_tables: result.num_tables, daily: (d1.d1AnalyticsAdaptiveGroups ?? []).filter((g) => g.dimensions.databaseId === id).map((g) => ({ date: g.dimensions.date, ...g.sum })) };
}
const report = { checkedAt: end.toISOString(), periodStart: start.toISOString(), hours, units: 'cpu/wall values in microseconds; quantiles are sampled estimates', workers, scheduled, d1Errors: d1.errors ?? null, databases };
await writeFile(outfile, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ checkedAt: report.checkedAt, hours, scheduled, workers: workers.errors ?? { http: workers.workersInvocationsAdaptive, durableObjects: workers.durableObjectsInvocationsAdaptiveGroups, periodic: workers.durableObjectsPeriodicGroups }, sizes: Object.fromEntries(Object.entries(databases).map(([k, v]) => [k, v.file_size])) }, null, 1));
