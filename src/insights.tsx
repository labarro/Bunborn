import { useEffect, useState } from 'react';
// Public pages for casual visitors. Every sentence is assembled from stored counts and
// records returned by the API; nothing is interpreted or invented here.
type Highlights = {
  born: boolean;
  name?: string | null;
  description?: string;
  bornAt?: number;
  virtualMinutes?: number;
  decisions?: number;
  activity?: { kind: string; until: number };
  lastThought?: { intention: string; summary: string | null; at: number } | null;
  interests?: { topic: string; strength: number; status: string }[];
  artifacts?: { entityId: string; title: string; format: string | null; version: number; at: number }[];
  projects?: { title: string; status: string; steps: number; done: number }[];
  changes?: { kind: string; content: string; at: number; role: string | null; field: string | null }[];
  last24h?: Record<string, number>;
  previous24h?: Record<string, number>;
  visitors?: { today: number };
};
type Day = {
  day: string;
  decisions: number;
  diary: number;
  pauses: number;
  toolRejections: number;
  born: boolean;
  activities: { k: string; n: number }[];
  research: { query: string; cached: number }[];
  works: { title: string; version: number; format: string }[];
  identity: { field: string; value: string }[];
  interests: { topic: string; status: string }[];
  projects: { title: string; status: string }[];
  talks: Record<string, number>;
};
const formats: Record<string, string> = { texto: 'texto', pixels: 'desenho', musica: 'música', objeto: 'objeto' };
const activityNames: Record<string, string> = {
  comer: 'comeu', beber: 'bebeu água', dormir: 'dormiu', higiene: 'se limpou', descansar: 'descansou', observar: 'observou ao redor',
  organizar: 'organizou as coisas', pesquisar: 'pesquisou', criar: 'criou', diario: 'escreveu no diário',
};
const fields: Record<string, string> = { nome: 'nome', autodescricao: 'como se descreve', preferencia: 'uma preferência', valor: 'um valor', crenca: 'uma crença', estilo: 'um estilo', aparencia: 'a cor do pelo' };
const changeText: Record<string, (c: NonNullable<Highlights['changes']>[number]) => string> = {
  identidade: (c) => `Decidiu ${fields[c.field ?? ''] ?? 'algo sobre si'}: “${c.content}”`,
  interesse: (c) => `Interesse: ${c.content}`,
  projeto: (c) => `Projeto: ${c.content}`,
  artefato: (c) => `Criou ou revisou a obra “${c.content}”`,
  pesquisa: (c) => c.content.replace('Consulta externa:', 'Pesquisou:').replace('Consulta ao cache:', 'Releu uma pesquisa:'),
  diario: (c) => `Escreveu no diário: “${c.content.slice(0, 140)}${c.content.length > 140 ? '…' : ''}”`,
  conversa: (c) => (c.role === 'criatura' ? `Deixou uma mensagem: “${c.content}”` : c.role === 'visitante' ? 'Recebeu uma mensagem de um visitante' : 'Recebeu uma mensagem do responsável'),
  relacao: (c) => `Ligou duas ideias: ${c.content}`,
  recurso: (c) => `Pediu um objeto novo: ${c.content}`,
};
function usePublic<T>(path: string, every = 180000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/' + path, { credentials: 'same-origin' })
        .then((r) => r.json())
        .then((d) => alive && (setData(d as T), setError('')))
        .catch(() => alive && setError('Não foi possível carregar agora. Tente novamente em instantes.'));
    void load();
    const timer = setInterval(() => document.visibilityState === 'visible' && void load(), every);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [path, every]);
  return { data, error };
}
const ago = (ms: number) => {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} dia(s)`;
};
const diff = (a = 0, b = 0) => (b === 0 ? '' : a > b ? ` (↑ de ${b})` : a < b ? ` (↓ de ${b})` : ' (igual)');
export function HighlightsPanel() {
  const { data, error } = usePublic<Highlights>('highlights');
  if (error) return <p className="footnote">{error}</p>;
  if (!data) return <p className="footnote">Reunindo os destaques…</p>;
  if (!data.born) return <p className="insight-empty">A história ainda não começou. Quando a criatura nascer, os destaques aparecerão aqui.</p>;
  const realDays = Math.max(0, (Date.now() - (data.bornAt ?? Date.now())) / 86400000);
  const virtualDays = (data.virtualMinutes ?? 0) / 1440;
  const now = data.last24h ?? {}, before = data.previous24h ?? {};
  return (
    <div className="insights">
      <section className="insight-hero">
        <p className="insight-kicker">{data.name ? 'Ela se chama' : 'Ainda sem nome'}</p>
        <h2>{data.name ?? 'Um coelho que ainda não escolheu um nome'}</h2>
        <p>
          Vive há {realDays < 1 ? `${Math.round(realDays * 24)} horas` : `${realDays.toFixed(1)} dias`} no nosso tempo, o que equivale a{' '}
          {virtualDays.toFixed(1)} dias no tempo dela. Já tomou {data.decisions} decisões por conta própria.
        </p>
        {data.description && data.description !== 'Identidade ainda em formação.' ? <p className="insight-quote">“{data.description}”</p> : null}
      </section>
      {data.lastThought ? (
        <section className="insight-card">
          <h3>O que ela pensou por último · {ago(data.lastThought.at)}</h3>
          <p className="insight-quote">“{data.lastThought.intention}”</p>
          {data.lastThought.summary ? <p>Por quê: {data.lastThought.summary}</p> : null}
        </section>
      ) : null}
      <section className="insight-card">
        <h3>Últimas 24 horas</h3>
        <ul className="insight-stats">
          <li><strong>{now.intencao ?? 0}</strong> decisões{diff(now.intencao, before.intencao)}</li>
          <li><strong>{now.pesquisa ?? 0}</strong> pesquisas{diff(now.pesquisa, before.pesquisa)}</li>
          <li><strong>{now.artefato ?? 0}</strong> obras criadas ou revisadas{diff(now.artefato, before.artefato)}</li>
          <li><strong>{now.diario ?? 0}</strong> páginas de diário{diff(now.diario, before.diario)}</li>
          <li><strong>{now.conversa ?? 0}</strong> mensagens trocadas{diff(now.conversa, before.conversa)}</li>
        </ul>
        <p className="footnote">Comparado com as 24 horas anteriores, quando houver.</p>
      </section>
      <section className="insight-card">
        <h3>O que mudou desde ontem</h3>
        {data.changes?.length ? (
          <ul className="insight-list">
            {data.changes.map((c, i) => (
              <li key={i}>
                <time>{ago(c.at)}</time> {(changeText[c.kind] ?? ((x) => x.content))(c)}
              </li>
            ))}
          </ul>
        ) : (
          <p>Nada de novo além da rotina (comer, descansar, explorar). Isso também faz parte da história.</p>
        )}
      </section>
      <div className="insight-grid">
        <section className="insight-card">
          <h3>Interesses</h3>
          {data.interests?.length ? (
            <ul className="insight-list">
              {data.interests.map((i) => (
                <li key={i.topic}>
                  {i.topic} <span className="insight-meter" style={{ width: Math.max(8, i.strength * 100) + 'px' }} />
                </li>
              ))}
            </ul>
          ) : (
            <p>Nenhum interesse declarado ainda.</p>
          )}
        </section>
        <section className="insight-card">
          <h3>Obras mais recentes</h3>
          {data.artifacts?.length ? (
            <ul className="insight-list">
              {data.artifacts.map((a) => (
                <li key={a.entityId}>
                  “{a.title}” · {formats[a.format ?? ''] ?? 'obra'}
                  {a.version > 1 ? ` · versão ${a.version}` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p>Nenhuma obra ainda. Veja o Acervo quando houver.</p>
          )}
        </section>
        <section className="insight-card">
          <h3>Projetos</h3>
          {data.projects?.length ? (
            <ul className="insight-list">
              {data.projects.map((p) => (
                <li key={p.title}>
                  {p.title} · {p.done}/{p.steps} etapas{p.status === 'concluido' ? ' · concluído' : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p>Nenhum projeto em andamento.</p>
          )}
        </section>
      </div>
    </div>
  );
}
function daySentences(d: Day): string[] {
  const out: string[] = [];
  if (d.born) out.push('Nasceu neste dia.');
  out.push(d.decisions ? `Tomou ${d.decisions} decisões por conta própria.` : 'Não tomou decisões neste dia.');
  if (d.activities.length) out.push(`Rotina: ${d.activities.slice(0, 6).map((a) => `${activityNames[a.k] ?? a.k} ${a.n}×`).join(', ')}.`);
  if (d.research.length) out.push(`Pesquisou sobre: ${[...new Set(d.research.map((r) => r.query))].join(', ')}.`);
  if (d.works.length) out.push(`Obras: ${d.works.map((w) => `“${w.title}” (${formats[w.format] ?? 'obra'}${w.version > 1 ? `, versão ${w.version}` : ''})`).join(', ')}.`);
  if (d.diary) out.push(`Escreveu ${d.diary} página(s) no diário.`);
  for (const i of d.identity) out.push(`Decidiu ${fields[i.field] ?? 'algo sobre si'}: “${i.value}”.`);
  if (d.interests.length) out.push(`Interesses registrados: ${[...new Set(d.interests.map((i) => i.topic))].join(', ')}.`);
  if (d.projects.length) out.push(`Projetos: ${[...new Set(d.projects.map((p) => `${p.title} (${p.status})`))].join(', ')}.`);
  const received = (d.talks.visitante ?? 0) + (d.talks.observador ?? 0);
  if (received || d.talks.criatura) out.push(`Recebeu ${received} mensagem(ns) e escreveu ${d.talks.criatura ?? 0}.`);
  if (d.toolRejections) out.push(`Tentou ${d.toolRejections} coisa(s) que não deram certo e recebeu a explicação de cada uma.`);
  if (d.pauses) out.push(`Ficou ${d.pauses} vez(es) em pausa porque o serviço de IA estava ocupado ou no limite do dia.`);
  return out;
}
export function LogbookPanel() {
  const { data, error } = usePublic<{ born: boolean; days: Day[] }>('logbook?days=14', 600000);
  if (error) return <p className="footnote">{error}</p>;
  if (!data) return <p className="footnote">Abrindo o diário de bordo…</p>;
  if (!data.born) return <p className="insight-empty">O diário de bordo começa no dia do nascimento.</p>;
  return (
    <div className="insights">
      <p className="footnote">Resumo automático de cada dia (horário de Brasília), montado só a partir dos registros reais. Não é escrito pela criatura nem por uma IA.</p>
      {data.days.map((d) => (
        <section className="insight-card" key={d.day}>
          <h3>{new Date(d.day + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
          {daySentences(d).map((s, i) => (
            <p key={i}>{s}</p>
          ))}
        </section>
      ))}
    </div>
  );
}
// Counts this browser once per day (anonymous, salted hash on the server) and shows the total.
export function useVisitors(enabled: boolean) {
  const [today, setToday] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let key = '';
    try {
      key = 'bunborn-visit-' + new Date().toISOString().slice(0, 10);
      if (sessionStorage.getItem(key)) {
        void fetch('/api/highlights').then((r) => r.json() as Promise<Highlights>).then((d) => setToday(d.visitors?.today ?? null)).catch(() => undefined);
        return;
      }
    } catch {
      /* storage unavailable: count anyway */
    }
    void fetch('/api/visit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then((r) => r.json() as Promise<{ today?: number }>)
      .then((d) => {
        setToday(d.today ?? null);
        try {
          if (key) sessionStorage.setItem(key, '1');
        } catch {
          /* ignore */
        }
      })
      .catch(() => undefined);
  }, [enabled]);
  return today;
}
