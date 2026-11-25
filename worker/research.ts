import { boundedJson } from './provider';
import type { researchSources } from '../shared/domain';
export type SourceResult = {
  title: string;
  url: string;
  excerpt: string;
  accessedAt: number;
  source: string;
};
export type ResearchSource = (typeof researchSources)[number];
const clip = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 3500);
const strip = (html: string) =>
  html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
// Model never supplies a URL: only the query text varies. Fixed origins and paths, no keys,
// redirects rejected, bounded responses.
const mediawiki = (host: string) => ({
  endpoint: `https://${host}/w/api.php`,
  params: (q: string) => ({ action: 'query', format: 'json', generator: 'search', gsrsearch: q, gsrlimit: '3', prop: 'extracts|info', exintro: '1', explaintext: '1', exchars: '3500', inprop: 'url' }),
  parse: (data: unknown, now: number, source: string) =>
    Object.values((data as { query?: { pages?: Record<string, { title: string; extract?: string; pageid: number }> } }).query?.pages ?? {})
      .slice(0, 3)
      .map((p) => ({ title: p.title, url: `https://${host}/?curid=${p.pageid}`, excerpt: clip(p.extract || 'Sem resumo disponível.'), accessedAt: now, source })),
});
export async function research(source: ResearchSource, query: string, now: number, fetcher: typeof fetch = fetch): Promise<SourceResult[]> {
  let url: URL;
  let parse: (body: string, now: number) => SourceResult[];
  const json = (fn: (data: unknown) => SourceResult[]) => (body: string) => fn(JSON.parse(body));
  if (source === 'wikipedia' || source === 'wikipedia_en' || source === 'wikcionario') {
    const host = source === 'wikipedia' ? 'pt.wikipedia.org' : source === 'wikipedia_en' ? 'en.wikipedia.org' : 'pt.wiktionary.org';
    const mw = mediawiki(host);
    url = new URL(mw.endpoint);
    for (const [k, v] of Object.entries(mw.params(query))) url.searchParams.set(k, v);
    if (source === 'wikcionario') url.searchParams.delete('exintro');
    parse = json((d) => mw.parse(d, now, source));
  } else if (source === 'wikidata') {
    url = new URL('https://www.wikidata.org/w/api.php');
    for (const [k, v] of Object.entries({ action: 'wbsearchentities', format: 'json', search: query, language: 'pt', limit: '3' })) url.searchParams.set(k, v);
    parse = json((d) =>
      ((d as { search?: { id: string; label?: string; description?: string }[] }).search ?? [])
        .filter((p) => /^Q\d+$/.test(p.id))
        .slice(0, 3)
        .map((p) => ({ title: p.label ?? p.id, url: 'https://www.wikidata.org/wiki/' + p.id, excerpt: clip(p.description ?? 'Sem descrição disponível.'), accessedAt: now, source })),
    );
  } else if (source === 'openlibrary') {
    url = new URL('https://openlibrary.org/search.json');
    for (const [k, v] of Object.entries({ q: query, limit: '3', fields: 'key,title,author_name,first_publish_year,subject' })) url.searchParams.set(k, v);
    parse = json((d) =>
      ((d as { docs?: { key: string; title: string; author_name?: string[]; first_publish_year?: number; subject?: string[] }[] }).docs ?? [])
        .filter((b) => /^\/works\/OL\d+W$/.test(b.key))
        .slice(0, 3)
        .map((b) => ({
          title: b.title,
          url: 'https://openlibrary.org' + b.key,
          excerpt: clip([b.author_name?.length ? 'Autoria: ' + b.author_name.slice(0, 3).join(', ') : '', b.first_publish_year ? 'Primeira publicação: ' + b.first_publish_year : '', b.subject?.length ? 'Assuntos: ' + b.subject.slice(0, 8).join(', ') : ''].filter(Boolean).join('. ') || 'Sem detalhes disponíveis.'),
          accessedAt: now,
          source,
        })),
    );
  } else {
    url = new URL('https://export.arxiv.org/api/query');
    for (const [k, v] of Object.entries({ search_query: 'all:' + query, start: '0', max_results: '3' })) url.searchParams.set(k, v);
    parse = (body) =>
      [...body.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, 3).flatMap(([, entry]) => {
        const id = /<id>\s*https?:\/\/arxiv\.org\/abs\/([\w.\/-]+?)\s*<\/id>/.exec(entry)?.[1];
        const title = /<title>([\s\S]*?)<\/title>/.exec(entry)?.[1];
        if (!id || !title) return [];
        return [{ title: clip(strip(title)).slice(0, 300), url: 'https://arxiv.org/abs/' + id, excerpt: clip(strip(/<summary>([\s\S]*?)<\/summary>/.exec(entry)?.[1] ?? 'Sem resumo disponível.')), accessedAt: now, source }];
      });
  }
  const response = await fetcher(url, {
    headers: { 'User-Agent': 'Bunborn/0.1 (artificial-life research; read-only)', Accept: source === 'arxiv' ? 'application/atom+xml' : 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error('pesquisa_http_' + response.status);
  const body = source === 'arxiv' ? (await response.text()).slice(0, 200000) : JSON.stringify(await boundedJson(response, 64000));
  return parse(body, now);
}
