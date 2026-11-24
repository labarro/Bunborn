import { boundedJson } from './provider';
export type SourceResult = {
  title: string;
  url: string;
  excerpt: string;
  accessedAt: number;
  source: string;
};
export async function research(
  source: 'wikipedia' | 'wikidata',
  query: string,
  now: number,
  fetcher: typeof fetch = fetch,
): Promise<SourceResult[]> {
  // Model never supplies a URL. Fixed origins and paths, redirects rejected.
  const url = new URL(
    source === 'wikipedia'
      ? 'https://pt.wikipedia.org/w/api.php'
      : 'https://www.wikidata.org/w/api.php',
  );
  const params =
    source === 'wikipedia'
      ? {
          action: 'query',
          format: 'json',
          generator: 'search',
          gsrsearch: query,
          gsrlimit: '3',
          prop: 'extracts|info',
          exintro: '1',
          explaintext: '1',
          exchars: '3500',
          inprop: 'url',
        }
      : { action: 'wbsearchentities', format: 'json', search: query, language: 'pt', limit: '3' };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = await fetcher(url, {
    headers: {
      'User-Agent': 'Bunborn/0.1 (artificial-life research; read-only)',
      Accept: 'application/json',
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error('pesquisa_http_' + response.status);
  const data = (await boundedJson(response, 64000)) as {
    query?: { pages?: Record<string, { title: string; extract?: string; pageid: number }> };
    search?: { id: string; label?: string; description?: string }[];
  };
  if (source === 'wikidata')
    return (data.search ?? [])
      .filter((p) => /^Q\d+$/.test(p.id))
      .slice(0, 3)
      .map((p) => ({
        title: p.label ?? p.id,
        url: 'https://www.wikidata.org/wiki/' + p.id,
        excerpt: (p.description ?? 'Sem descrição disponível.').slice(0, 3500),
        accessedAt: now,
        source,
      }));
  return Object.values(data.query?.pages ?? {})
    .slice(0, 3)
    .map((p) => ({
      title: p.title,
      url: 'https://pt.wikipedia.org/?curid=' + p.pageid,
      excerpt: (p.extract ?? 'Sem resumo disponível.').slice(0, 3500),
      accessedAt: now,
      source,
    }));
}
