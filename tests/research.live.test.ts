import { expect, it } from 'vitest';
import { research } from '../worker/research';
import { researchSources } from '../shared/domain';
it.skipIf(process.env.LIVE_RESEARCH !== '1')(
  'LIVE read-only transport for every research source, no cognitive inference',
  async () => {
    for (const source of researchSources) {
      const results = await research(source, source === 'arxiv' || source === 'wikipedia_en' || source === 'openlibrary' ? 'rabbit' : 'água', Date.now());
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].url).toMatch(/^https:\/\//);
      expect(results[0].excerpt.length).toBeGreaterThan(0);
    }
  },
  60000,
);
