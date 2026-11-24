import { expect, it } from 'vitest';
import { research } from '../worker/research';
it.skipIf(process.env.LIVE_RESEARCH !== '1')(
  'LIVE read-only Wikipedia and Wikidata transport, no cognitive inference',
  async () => {
    for (const source of ['wikipedia', 'wikidata'] as const) {
      const results = await research(source, 'água', Date.now());
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].url).toMatch(/^https:\/\//);
      expect(results[0].excerpt.length).toBeGreaterThan(0);
    }
  },
  30000,
);
