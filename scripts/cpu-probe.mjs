// Generates a small, controlled set of authenticated READ requests (no model calls, no writes
// other than rate-limit counters) so Cloudflare analytics can attribute CPU to the gateway path.
import { remoteClient } from './remote-client.mjs';
const rounds = Math.min(30, Number(process.argv[2]) || 15);
const startedAt = new Date().toISOString();
for (const env of ['homologation', 'production']) {
  const client = await remoteClient(env);
  for (let i = 0; i < rounds; i++) {
    await client.request('state');
    await client.request('records?kind=todos');
    await client.request('monitor');
    await fetch(client.base + '/api/session');
  }
}
console.log(JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), rounds, requestsPerEnv: rounds * 4 }));
