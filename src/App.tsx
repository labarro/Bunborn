import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  Archive,
  BookOpen,
  Brain,
  ChevronRight,
  Clock,
  Download,
  Feather,
  Flower2,
  Heart,
  Home,
  Lightbulb,
  MessageCircle,
  Moon,
  Network,
  Pause,
  Play,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sprout,
  Terminal,
  User,
  Volume2,
  X,
} from 'lucide-react';
import {
  categoryLabels,
  initialObjects,
  type Artifact,
  type HabitatObject,
  type RecordEntry,
  type State,
} from '../shared/domain';
import { ArtifactView } from './ArtifactView';
import {BirthRitual} from './BirthRitual';
import { expressionFor } from '../shared/expression';
import { Explanation } from './explain';
import {exportExistence,restoreExistence}from'./backups';
const Habitat = lazy(() => import('./HabitatView'));
type Data = {
  state: State | null;
  recent: RecordEntry[];
  usage: { day: string; model: string; calls: number; tokens: number }[];
  ready: boolean;
  environment: string;
  environmentId?:string;
  pending?: { id: string; content: string; at: number }[];
};
type Tab =
  | 'Habitat'
  | 'Estado interno'
  | 'Intenções'
  | 'Linha do tempo'
  | 'Diário'
  | 'Memórias'
  | 'Conhecimentos'
  | 'Personalidade'
  | 'Interesses'
  | 'Projetos'
  | 'Acervo'
  | 'Conversas'
  | 'Recursos'
  | 'Monitoramento';
const groups = [
  {
    title: 'A pequena existência',
    items: [
      ['Habitat', Home],
      ['Estado interno', Heart],
      ['Intenções', Lightbulb],
    ],
  },
  {
    title: 'O que fica',
    items: [
      ['Linha do tempo', Clock],
      ['Diário', Feather],
      ['Memórias', Brain],
      ['Conhecimentos', Network],
    ],
  },
  {
    title: 'Quem se torna',
    items: [
      ['Personalidade', User],
      ['Interesses', Sprout],
      ['Projetos', BookOpen],
      ['Acervo', Archive],
    ],
  },
  {
    title: 'Do lado de fora',
    items: [
      ['Conversas', MessageCircle],
      ['Recursos', Flower2],
      ['Monitoramento', Activity],
    ],
  },
] as const;
const tabKind: Record<string, string> = {
  'Estado interno': 'comportamento',
  Intenções: 'intencao',
  'Linha do tempo': 'todos',
  Diário: 'diario',
  Memórias: 'memoria',
  Conhecimentos: 'conhecimento',
  Personalidade: 'personalidade',
  Interesses: 'interesse',
  Projetos: 'projeto',
  Acervo: 'artefato',
  Conversas: 'conversa',
  Recursos: 'recurso',
  Monitoramento: 'erro',
};
const activityLabels: Record<string, string> = {
  observar: 'Observando',
  comer: 'Comendo',
  beber: 'Bebendo água',
  dormir: 'Dormindo',
  higiene: 'Cuidando da higiene',
  descansar: 'Descansando',
  pesquisar: 'Pesquisando',
  criar: 'Criando',
  diario: 'Escrevendo no diário',
  organizar: 'Organizando',
};
const needLabels: Record<string, string> = {
  fome: 'Fome',
  sede: 'Sede',
  sono: 'Sono',
  energia: 'Energia',
  higiene: 'Higiene',
  conforto: 'Conforto',
  saude: 'Saúde simulada',
  curiosidade: 'Curiosidade',
  tedio: 'Tédio',
  satisfacao: 'Satisfação',
  criatividade: 'Criatividade',
  frustracao: 'Frustração',
  interacao: 'Vontade de interação',
  motivacao: 'Motivação',
};
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch('/api/' + path, {
    credentials: 'same-origin',
    ...(body !== undefined
      ? {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const value = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? 'Não foi possível acessar o habitat.');
  return value;
}
function virtualTime(s: State | null) {
  const minutes = s?.virtualMinutes ?? 0;
  return {
    day: Math.floor(minutes / 1440) + 1,
    time: `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(Math.floor(minutes) % 60).padStart(2, '0')}`,
    age: `${Math.floor(minutes / 1440)} dias, ${Math.floor(minutes / 60) % 24} horas`,
  };
}
const formatDate = (n: number) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(n);
function Empty({
  title = 'Uma história por escrever',
  text = 'Os registros aparecerão aqui quando houver experiências reais nesta existência.',
}: {
  title?: string;
  text?: string;
}) {
  return (
    <div className="empty">
      <Sprout size={32} strokeWidth={1.25} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
export function App() {
  const [birthOpen,setBirthOpen]=useState(false);
  const [auth, setAuth] = useState(false),
    [publicObs, setPublicObs] = useState(false),
    [configured, setConfigured] = useState<boolean | null>(null),
    [data, setData] = useState<Data | null>(null),
    [tab, setTab] = useState<Tab>('Habitat'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loginOpen, setLoginOpen] = useState(false),
    [secret, setSecret] = useState(''),
    [settings, setSettings] = useState(false),
    [selected, setSelected] = useState<HabitatObject | null>(null),
    [mobileNav, setMobileNav] = useState(false);
  const [records, setRecords] = useState<RecordEntry[]>([]),
    [next, setNext] = useState<number | null>(null),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('todas'),
    [message, setMessage] = useState(''),
    [monitor, setMonitor] = useState<unknown>(null),
    [multiplier, setMultiplier] = useState(6),
    [notice, setNotice] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const state = data?.state ?? null;
  const clock = virtualTime(state);
  const refresh = useCallback(async () => {
    const value = await api<Data>('state');
    setData(value);
    setMultiplier(value.state?.multiplier ?? 6);
  }, []);
  useEffect(() => {
    if (!loginOpen && !settings) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('.modal');
    const focusables = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not([hidden]),select,textarea,a[href]',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);
    focusables()[0]?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLoginOpen(false);
        setSettings(false);
      }
      if (event.key === 'Tab') {
        const items = focusables();
        const first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      previous?.focus();
    };
  }, [loginOpen, settings]);
  useEffect(() => {
    void api<{ authenticated: boolean; configured: boolean; publicObservation?: boolean }>('session')
      .then((s) => {
        setAuth(s.authenticated);
        setPublicObs(!!s.publicObservation);
        setConfigured(s.configured);
        if (s.authenticated || s.publicObservation) void refresh().catch((e) => setError(e.message));
      })
      .catch(() => {
        setConfigured(false);
        setError('Backend indisponível. Inicie o Worker para conectar a existência.');
      });
  }, [refresh]);
  useEffect(() => {
    if (!auth && !publicObs) return;
    // Public visitors poll less often: Workers Free allows 100k requests/day per account.
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh().catch((e) => setError(e.message));
    }, auth ? 60000 : 180000);
    return () => clearInterval(interval);
  }, [auth, publicObs, refresh]);
  const load = useCallback(
    async (append = false, after = 0) => {
      if ((!auth && !publicObs) || tab === 'Habitat') return;
      const latest = [
        'Projetos',
        'Interesses',
        'Acervo',
        'Personalidade',
        'Conhecimentos',
        'Recursos',
      ].includes(tab);
      const result = await api<{ records: RecordEntry[]; next: number | null }>(
        `records?kind=${tabKind[tab]}&after=${after}&latest=${latest}&q=${encodeURIComponent(query)}`,
      );
      setRecords((old) => (append ? [...old, ...result.records] : result.records));
      setNext(result.next ?? null);
      if (tab === 'Monitoramento') setMonitor(await api('monitor'));
    },
    [auth, publicObs, tab, query],
  );
  useEffect(() => {
    setRecords([]);
    setNext(null);
    const timer = setTimeout(() => void load().catch((e) => setError(e.message)), query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, state?.revision]);
  async function perform(work: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await work();
      if (auth || publicObs) await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha na operação.');
    } finally {
      setBusy(false);
    }
  }
  async function login() {
    await perform(async () => {
      await api('login', { secret });
      setSecret('');
      setAuth(true);
      setLoginOpen(false);
      await refresh();
    });
  }
  async function download() {
    await perform(async () => {
      if (!state?.paused)
        throw new Error(
          'Pause administrativamente a existência antes de exportar um backup consistente.',
        );
      const blob = await exportExistence();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'existencia.backup.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setNotice('Backup exportado. Você pode retomar a existência quando quiser.');
    });
  }
  function navigate(t: Tab) {
    setTab(t);
    setQuery('');
    setFilter('todas');
    setMobileNav(false);
  }
  const lastIntention = data?.recent.find((r) => r.kind === 'intencao');
  const lastEvents = (data?.recent ?? [])
    .filter((r) => !['memoria', 'intencao'].includes(r.kind))
    .slice(0, 4);
  const displayRecords =
    filter === 'todas' ? records : records.filter((r) => r.category === filter);
  const latestEntities = new Map<string, RecordEntry>();
  for (const r of displayRecords) latestEntities.set(r.entityId, r);
  const visible = [
    'Projetos',
    'Interesses',
    'Acervo',
    'Personalidade',
    'Conhecimentos',
    'Recursos',
  ].includes(tab)
    ? [...latestEntities.values()]
    : displayRecords;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
        <button
          className="mobile-nav-close icon-button"
          aria-label="Fechar navegação"
          onClick={() => setMobileNav(false)}
        >
          <X size={20} />
        </button>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate('Habitat');
          }}
        >
          <span className="brand-icon">
            <img src="/bunborn-mark.svg" alt=""/>
          </span>
          <span>
            Bunborn<small>uma história por nascer</small>
          </span>
        </a>
        <nav aria-label="Áreas de observação">
          {groups.map((group) => (
            <div className="nav-group" key={group.title}>
              <p>{group.title}</p>
              {group.items.map(([name, Icon]) => (
                <button
                  key={name}
                  className={tab === name ? 'nav-item active' : 'nav-item'}
                  onClick={() => navigate(name)}
                >
                  <Icon size={17} strokeWidth={1.6} />
                  <span>{name}</span>
                  {name === 'Conversas' &&
                  data?.recent.some((r) => r.kind === 'conversa' && r.data.role === 'criatura') ? (
                    <span className="nav-dot" />
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <ShieldCheck size={16} />
          <span>
            Autonomia simulada.
            <br />
            História de verdade.
          </span>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button
            className="mobile-menu icon-button"
            aria-label="Abrir navegação"
            onClick={() => setMobileNav(!mobileNav)}
          >
            <BookOpen size={20} />
          </button>
          <div className="breadcrumb">
            O observatório <ChevronRight size={14} />
            <span>{tab}</span>
          </div>
          <div className="top-actions">
            {data?.environmentId==='homologation'?<span className="environment-badge">Homologação · descartável</span>:null}
            <span className={`connection ${auth || publicObs ? 'connected' : ''}`}>
              <i />
              {auth ? 'Observação conectada (responsável)' : publicObs ? 'Observatório público' : 'Sem conexão com a existência'}
            </span>
            <button
              className="icon-button"
              aria-label="Configurações e backups"
              onClick={() => setSettings(true)}
            >
              <Settings size={19} />
            </button>
            {!auth ? (
              <button className="small-button" onClick={() => setLoginOpen(true)}>
                {publicObs ? 'Entrar como responsável' : 'Conectar'}
              </button>
            ) : null}
          </div>
        </header>
        <div className="page-content">
          <div className="page-title">
            <div>
              <p className="chapter">Um mundo pequeno. Uma história só.</p>
              <h1>{tab === 'Habitat' ? 'O tempo também mora aqui.' : tab}</h1>
              <p className="subtitle">
                {tab === 'Habitat'
                  ? 'Você pode ficar um pouco. Ou voltar para descobrir o que mudou.'
                  : 'Experiências preservadas, com origens e mudanças que podem ser acompanhadas.'}
              </p>
            </div>
            <div className="clock-block">
              <Moon size={18} />
              <div>
                <strong>
                  {state ? `Dia ${clock.day} · ${clock.time}` : 'Antes do primeiro dia'}
                </strong>
                <span>
                  {state
                    ? `Tempo virtual · ${state.multiplier}× o tempo real`
                    : 'O nascimento ainda não aconteceu'}
                </span>
              </div>
            </div>
          </div>
          {error ? (
            <div className="alert" role="alert">
              <span>{error}</span>
              <button aria-label="Fechar aviso" onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          ) : null}
          {notice ? (
            <div className="notice" role="status">
              {notice}
              <button onClick={() => setNotice('')}>Fechar</button>
            </div>
          ) : null}
          {tab === 'Habitat' ? (
            <>
              <div className="habitat-grid">
                <section className="habitat-panel" aria-label="Habitat virtual isométrico">
                  <div className="scene-top">
                    <span className="scene-label">
                      <span className="little-window" />O pequeno refúgio
                    </span>
                    <span className="scene-status">
                      {state?.paused
                        ? 'Tempo em pausa'
                        : state
                          ? 'Último estado registrado'
                          : 'Ambiente preparado'}
                    </span>
                  </div>
                  <div className="scene-container">
                    <Suspense fallback={<div className="scene-loading">Preparando o refúgio…</div>}>
                      <Habitat state={state} onSelect={setSelected} />
                    </Suspense>
                  </div>
                  <div className="scene-bottom">
                    <div className="creature-avatar">
                      <span />
                    </div>
                    <div>
                      <h2>
                        {state?.identity.name ??
                          (state ? 'Ainda sem nome' : 'Uma existência por começar')}
                      </h2>
                      <p>
                        {state
                          ? state.activity.until > state.virtualMinutes
                            ? (activityLabels[state.activity.kind] ?? state.activity.kind)
                            : 'Entre atividades'
                          : 'Nenhuma criatura criada. Nenhuma atividade inventada.'}
                        {state ? (
                          <span className="expression-note" title={'Derivada do estado simulado: ' + expressionFor(state).reason}>
                            {' · '}
                            {expressionFor(state).label}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <span className="simulation-badge">Vida artificial</span>
                  </div>
                  {selected ? (
                    <div className="object-tooltip">
                      <button
                        className="icon-button"
                        onClick={() => setSelected(null)}
                        aria-label="Fechar objeto"
                      >
                        <X size={16} />
                      </button>
                      <strong>{selected.label}</strong>
                      <p>{objectDescription(selected.kind)}</p>
                      <small>
                        Posição {selected.x}, {selected.y}
                        {selected.artifactId ? ' · Há uma criação exposta' : ''}
                      </small>
                    </div>
                  ) : null}
                </section>
                <aside className="field-notes">
                  <div className="section-heading">
                    <Feather size={18} />
                    <h2>Caderno de observação</h2>
                  </div>
                  <div className="intention-note">
                    <span className="note-label">Uma intenção, nas próprias palavras</span>
                    {lastIntention ? (
                      <>
                        <blockquote>“{lastIntention.content}”</blockquote>
                        <p>{String(lastIntention.data.summary ?? '')}</p>
                        <small>Justificativa declarada pela criatura</small>
                      </>
                    ) : (
                      <>
                        <blockquote>Ainda não há palavras por aqui.</blockquote>
                        <p>
                          As primeiras intenções serão registradas depois do nascimento e de uma
                          decisão real de IA.
                        </p>
                      </>
                    )}
                  </div>
                  <div className="recent-heading">
                    <h3>Pequenos acontecimentos</h3>
                    <Clock size={15} />
                  </div>
                  {lastEvents.length ? (
                    <div className="mini-timeline">
                      {lastEvents.map((r) => (
                        <article key={r.id}>
                          <span className="timeline-dot" />
                          <time>{formatDate(r.realAt)}</time>
                          <p>{r.content}</p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="quiet-note">
                      <span>✧</span>
                      <p>
                        Por enquanto, só o silêncio de um lugar pronto para receber uma história.
                      </p>
                    </div>
                  )}
                  <button className="text-button" onClick={() => navigate('Linha do tempo')}>
                    Abrir a linha do tempo <BookOpen size={15} />
                  </button>
                </aside>
              </div>
              <div className="below-habitat">
                <section className="wellbeing">
                  <div className="section-heading">
                    <Heart size={18} />
                    <h2>Como está por dentro</h2>
                    <button onClick={() => navigate('Estado interno')}>Ver tudo</button>
                  </div>
                  <div className="needs-preview">
                    {['energia', 'fome', 'sono', 'conforto'].map((k) => (
                      <Need
                        key={k}
                        name={needLabels[k]}
                        value={state?.needs[k]}
                        positive={['energia', 'conforto'].includes(k)}
                      />
                    ))}
                  </div>
                  <p className="footnote">
                    Necessidades e emoções são estados computacionais simulados.
                  </p>
                </section>
                <section className="existence-note">
                  <Sprout size={24} strokeWidth={1.3} />
                  <div>
                    <h3>{state ? 'Uma história que continua' : 'O primeiro instante é único.'}</h3>
                    <p>
                      {state
                        ? `${clock.age} de tempo virtual. A criatura existe no backend; a janela de observação pode ser fechada.`
                        : auth
                          ? 'Conecte o backend, configure a API e inicie o nascimento uma única vez. Os interesses, o nome e os projetos virão das experiências.'
                          : 'A história ainda não começou. Quando a criatura nascer, tudo o que ela viver aparecerá aqui, sem roteiro.'}
                    </p>
                    {auth && !state ? (
                      <button
                        className="small-button"
                        disabled={busy || !data?.ready}
                        onClick={() =>setBirthOpen(true)}
                      >
                        {data?.ready
                          ? 'Preparar o primeiro instante'
                          : 'Refúgio reservado · aguardando homologação'}
                      </button>
                    ) : null}
                  </div>
                </section>
              </div>
            </>
          ) : (
            <section className="records-panel">
              <div className="records-toolbar">
                <div className="section-heading">
                  <span className="record-count">{visible.length}</span>
                  <h2>{tab === 'Linha do tempo' ? 'Registro completo' : tab}</h2>
                </div>
                <div className="filters">
                  {tab === 'Memórias' ? (
                    <select
                      aria-label="Categoria de memória"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="todas">Todas as categorias</option>
                      {Object.entries(categoryLabels).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {tab === 'Memórias' ? (
                    <label className="search">
                      <Search size={16} />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Buscar lembranças…"
                      />
                    </label>
                  ) : null}
                  <button
                    className="icon-button"
                    aria-label="Atualizar registros"
                    onClick={() => void perform(() => load())}
                  >
                    <Activity size={17} />
                  </button>
                </div>
              </div>
              {tab === 'Estado interno' ? (
                <>
                  <div className="all-needs">
                    {Object.entries(state?.needs ?? {}).map(([k, v]) => (
                      <Need
                        key={k}
                        name={needLabels[k]}
                        value={v}
                        positive={!['fome', 'sede', 'sono'].includes(k)}
                      />
                    ))}
                  </div>
                  <h3 className="subheading">Motivações simuladas</h3>
                  <div className="all-needs">
                    {Object.entries(state?.motives ?? {}).map(([k, v]) => (
                      <Need
                        key={k}
                        name={needLabels[k]}
                        value={v}
                        positive={!['tedio', 'frustracao'].includes(k)}
                      />
                    ))}
                  </div>
                  <p className="footnote">
                    Motivações iniciais são parâmetros funcionais. Interesses e identidade começam
                    vazios. Alterações são regras explícitas ou consequências de ações registradas.
                  </p>
                </>
              ) : null}
              {tab === 'Conversas' ? (
                <form
                  className="message-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void perform(async () => {
                      await api('message', { content: message, id: crypto.randomUUID() });
                      setMessage('');
                      setNotice(
                        'Mensagem guardada. A criatura poderá considerá-la em um próximo ciclo; não é obrigada a responder.',
                      );
                    });
                  }}
                >
                  <label htmlFor="message">Deixe algo para ela encontrar</label>
                  <textarea
                    id="message"
                    maxLength={auth ? 2000 : 500}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Uma pergunta, uma descoberta, uma sugestão…"
                  />
                  <div>
                    <span>Ela poderá responder, adiar ou seguir outra intenção.</span>
                    <button disabled={(!auth && !publicObs) || !state || busy || !message.trim()}>
                      Deixar mensagem
                    </button>
                  </div>
                </form>
              ) : null}
              {tab === 'Conversas' && data?.pending?.length ? (
                <div className="pending-messages">
                  <h3>Mensagens aguardando percepção</h3>
                  {data.pending.map((m) => (
                    <article key={m.id}>
                      <time>{formatDate(m.at)} · {(m as { author?: string }).author === 'visitante' ? 'visitante' : 'responsável'}</time>
                      <p>{m.content}</p>
                    </article>
                  ))}
                </div>
              ) : null}
              {tab === 'Conhecimentos' && visible.length ? (
                <KnowledgeMap records={visible} />
              ) : null}
              {tab === 'Recursos' ? (
                <div className="inventory">
                  {(state?.objects ?? initialObjects).map((o) => (
                    <button
                      key={o.id}
                      onClick={() => {
                        setSelected(o);
                        navigate('Habitat');
                      }}
                    >
                      <Flower2 size={16} />
                      {o.label}
                      <small>
                        {o.x}, {o.y}
                      </small>
                    </button>
                  ))}
                </div>
              ) : null}
              {tab === 'Monitoramento' ? (
                <>
                  <MonitorPanel monitor={monitor as MonitorData | null} />
                  {monitor ? (
                    <details>
                      <summary>Inspecionar registros técnicos</summary>
                      <pre>{JSON.stringify(monitor, null, 2)}</pre>
                    </details>
                  ) : null}
                  <button
                    disabled={!auth || !state || busy}
                    onClick={() =>
                      void perform(async () => {
                        const result = await api<{ status: string }>('tick', {});
                        setNotice('Motor: ' + result.status);
                      })
                    }
                  >
                    Solicitar verificação do motor
                  </button>
                </>
              ) : null}
              {tab === 'Monitoramento' ? null : !visible.length ? (
                <Empty
                  title={
                    tab === 'Diário'
                      ? 'As páginas ainda estão em branco'
                      : tab === 'Projetos'
                        ? 'Projetos começam com uma intenção'
                        : 'Uma história por escrever'
                  }
                />
              ) : (
                <div className={`record-list ${tab === 'Acervo' ? 'gallery' : ''}`}>
                  {visible.map((r) => (
                    <article className={`record-entry kind-${r.kind}`} key={r.id}>
                      <div className="entry-meta">
                        <span>
                          {r.kind === 'memoria'
                            ? (categoryLabels[r.category] ?? r.category)
                            : r.kind === 'conversa'
                              ? r.data.role === 'criatura'
                                ? 'Criatura'
                                : r.data.role === 'visitante'
                                  ? 'Visitante'
                                  : 'Responsável'
                              : r.kind}
                        </span>
                        <time>{formatDate(r.realAt)}</time>
                        <span>Dia {Math.floor(r.virtualAt / 1440) + 1}</span>
                      </div>
                      <h3>{r.content}</h3>
                      {r.kind === 'artefato' ? (
                        <>
                          <ArtifactView artifact={r.data.artifact as Artifact} />
                          <p className="muted">
                            {String(r.data.motivation ?? '')} · Versão {String(r.data.version)}
                          </p>
                        </>
                      ) : null}
                      {r.kind === 'projeto' ? (
                        <>
                          <p className="muted">
                            {String(r.data.status)} · prazo {String(r.data.horizon)}
                          </p>
                          <ol className="project-steps">
                            {((r.data.steps as string[]) ?? []).map((step, i) => (
                              <li
                                key={i}
                                className={
                                  ((r.data.completed as number[]) ?? []).includes(i) ? 'done' : ''
                                }
                              >
                                {step}
                              </li>
                            ))}
                          </ol>
                        </>
                      ) : null}
                      {r.kind === 'interesse' ? (
                        <p className="muted">
                          {String(r.data.status)} · força{' '}
                          {Math.round(Number(r.data.strength) * 100)}% · origem{' '}
                          {String(r.data.originId)}
                        </p>
                      ) : null}
                      {r.kind === 'identidade' ? (
                        <p className="muted">
                          Característica declarada · {String(r.data.field)} · versão{' '}
                          {String(r.data.version)}
                        </p>
                      ) : null}
                      {r.kind === 'recurso' ? (
                        <>
                          <p>{String(r.data.reason ?? '')}</p>
                          <span className="tag">{String(r.data.status)}</span>
                          {r.data.status === 'pendente' ? (
                            <div className="resource-actions">
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void perform(() =>
                                    api('resource', { id: r.entityId, approve: true }),
                                  )
                                }
                              >
                                Aprovar objeto virtual
                              </button>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void perform(() =>
                                    api('resource', { id: r.entityId, approve: false }),
                                  )
                                }
                              >
                                Rejeitar
                              </button>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                      {r.kind === 'intencao' ? <p>{String(r.data.summary ?? '')}</p> : null}
                      <Sources record={r} />
                      <Explanation record={r} />
                    </article>
                  ))}
                </div>
              )}
              {next ? (
                <button
                  className="load-more"
                  disabled={busy}
                  onClick={() => void perform(() => load(true, next))}
                >
                  Carregar registros mais antigos
                </button>
              ) : null}
            </section>
          )}
          <footer className="page-footer">
            <span>
              <Sprout size={14} /> Observar quem se torna.
            </span>
            <p>
              Uma simulação de vida artificial. Não é evidência de consciência ou experiência
              subjetiva.
            </p>
          </footer>
        </div>
      </main>
      {loginOpen ? (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="login-title">
            <button
              className="modal-close icon-button"
              aria-label="Fechar conexão"
              onClick={() => setLoginOpen(false)}
            >
              <X size={20} />
            </button>
            <Sprout size={28} />
            <h2 id="login-title">Entre no observatório</h2>
            <p>A existência é privada. Use a credencial do observador configurada no backend.</p>
            {configured === false ? (
              <p className="alert">
                Configure OBSERVER_SECRET e SESSION_SECRET como secrets no Worker. Consulte o
                README.
              </p>
            ) : null}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void login();
              }}
            >
              <label htmlFor="observer-secret">Credencial do observador</label>
              <input
                id="observer-secret"
                type="password"
                autoComplete="current-password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
              <button disabled={busy || !secret}>Conectar ao habitat</button>
            </form>
            {error ? <p role="alert">{error}</p> : null}
            <small>A chave Gemini permanece exclusivamente no backend.</small>
          </section>
        </div>
      ) : null}
      {settings ? (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <button
              className="modal-close icon-button"
              aria-label="Fechar configurações"
              onClick={() => setSettings(false)}
            >
              <X size={20} />
            </button>
            <Settings size={25} />
            <h2 id="settings-title">Cuidar da continuidade</h2>
            <p>A pausa congela o relógio e as decisões. A identidade permanece preservada.</p>
            <label htmlFor="multiplier">Velocidade do tempo virtual</label>
            <select
              id="multiplier"
              value={multiplier}
              onChange={(e) => setMultiplier(Number(e.target.value))}
            >
              {[1, 2, 3, 6, 9, 12].map((n) => (
                <option key={n} value={n}>
                  {n}×
                </option>
              ))}
            </select>
            <div className="settings-actions">
              <button
                disabled={!auth || !state || busy}
                onClick={() =>
                  void perform(() =>
                    api('settings', { paused: state?.paused ?? false, multiplier }),
                  )
                }
              >
                Salvar velocidade
              </button>
              <button
                disabled={!auth || !state || busy}
                onClick={() =>
                  void perform(() => api('settings', { paused: !state?.paused, multiplier }))
                }
              >
                {state?.paused ? <Play size={15} /> : <Pause size={15} />}{' '}
                {state?.paused ? 'Retomar existência' : 'Pausar administrativamente'}
              </button>
              <button disabled={!auth || !state || busy} onClick={() => void download()}>
                <Download size={15} /> Exportar existência completa
              </button>
              <button disabled={!auth || !!state || busy} onClick={() => fileRef.current?.click()}>
                Restaurar em banco vazio
              </button>
              <input
                hidden
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  void perform(async () => {
                    await restoreExistence(file);
                    setNotice('Existência restaurada. Nenhum novo nascimento foi criado.');
                  });
                }}
              />
              {auth ? (
                <button
                  onClick={() =>
                    void perform(async () => {
                      await api('logout', {});
                      setAuth(false);
                      setData(null);
                      setSettings(false);
                    })
                  }
                >
                  Sair do observatório
                </button>
              ) : null}
            </div>
            <small>
              Não há botão de reset. Aprovar um recurso cria apenas um objeto virtual; não contrata
              serviços.
            </small>
            {error ? <p role="alert">{error}</p> : null}
          </section>
        </div>
      ) : null}
      {birthOpen?<BirthRitual onClose={()=>setBirthOpen(false)} onBorn={async()=>{await refresh();setNotice('O nascimento foi registrado. Esta história agora tem continuidade.');}}/>:null}
    </div>
  );
}
function Need({ name, value, positive }: { name: string; value?: number; positive: boolean }) {
  return (
    <div className="need">
      <div>
        <span>{name}</span>
        <strong>{value === undefined ? '—' : `${Math.round(value)}%`}</strong>
      </div>
      <div className="meter">
        <i
          style={{
            width: `${value ?? 0}%`,
            background:
              value === undefined
                ? ''
                : positive
                  ? value < 30
                    ? '#b58a99'
                    : '#a8ba96'
                  : value > 75
                    ? '#b58a99'
                    : '#b4a1c8',
          }}
        />
      </div>
    </div>
  );
}
function objectDescription(kind: string) {
  return (
    (
      {
        cama: 'Permite dormir e recuperar sono e energia.',
        comida: 'Alimento e água renováveis para atender fome e sede.',
        higiene: 'Recupera higiene e contribui para o conforto.',
        terminal: 'Acesso somente de leitura às ferramentas de pesquisa autorizadas.',
        mesa: 'Local de trabalho e continuidade de projetos.',
        estante: 'Lugar para conhecimentos e criações expostas.',
        diario: 'Espaço de registro de reflexões espontâneas.',
        atelie: 'Criação de textos, pixel art, notas musicais e objetos.',
        bau: 'Armazenamento e organização de objetos.',
        descanso: 'Recuperação de energia e conforto.',
        planta: 'Decoração que pode ser reorganizada pela criatura.',
      } as Record<string, string>
    )[kind] ?? 'Recurso virtual aprovado pelo observador, sem contratação externa.'
  );
}
function Sources({ record }: { record: RecordEntry }) {
  const results = (record.data.results ?? record.data.sources) as
    { url?: string; title?: string; accessedAt?: number }[] | undefined;
  if (!Array.isArray(results)) return null;
  return (
    <div className="sources">
      {results
        .filter(
          (s) =>
            typeof s === 'object' &&
            s.url &&
            /^https:\/\/(pt\.wikipedia\.org|www\.wikidata\.org)\//.test(s.url),
        )
        .map((s, i) => (
          <a key={i} href={s.url} target="_blank" rel="noreferrer">
            {s.title ?? 'Fonte consultada'}
            {s.accessedAt ? <small> · {formatDate(s.accessedAt)}</small> : null}
          </a>
        ))}
    </div>
  );
}
function KnowledgeMap({ records }: { records: RecordEntry[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const nodes = records
    .filter((r) => r.kind === 'conceito')
    .slice(0, 18)
    .map((r, i) => {
      const angle = i * 2.39996,
        radius = 50 + Math.sqrt(i) * 25;
      return { r, x: 350 + Math.cos(angle) * radius, y: 165 + Math.sin(angle) * radius * 0.65 };
    });
  const edges = records.filter((r) => r.kind === 'relacao');
  return (
    <div className="knowledge-map">
      <svg viewBox="0 0 700 330" aria-label="Mapa de consultas e relações declaradas">
        <title>Mapa de conhecimentos</title>
        {edges.map((e) => {
          const a = nodes.find((n) => n.r.entityId === e.data.from),
            b = nodes.find((n) => n.r.entityId === e.data.to);
          return a && b ? (
            <line
              key={e.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="#aa94bc"
              strokeDasharray={e.data.status === 'hipotese' ? '5 4' : undefined}
            >
              <title>
                {e.content} · {String(e.data.status)}
              </title>
            </line>
          ) : null;
        })}
        {nodes.map(({ r, x, y }) => (
          <g key={r.id}>
            <circle
              cx={x}
              cy={y}
              r={selected === r.id ? 11 : 7}
              fill="#8e759f"
              role="button"
              tabIndex={0}
              aria-label={r.content}
              onClick={() => setSelected(r.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setSelected(r.id);
              }}
            />
            <text x={x + 12} y={y + 4} fill="#564763" fontSize="12">
              {r.content.slice(0, 22)}
            </text>
          </g>
        ))}
      </svg>
      <p>
        Pontos são consultas realizadas. Linhas são relações declaradas com evidência; linhas
        tracejadas indicam hipóteses. Não representam domínio comprovado.
      </p>
      {selected ? <p>{records.find((r) => r.id === selected)?.content}</p> : null}
    </div>
  );
}

type Usage = { day: string; model: string; calls: number; tokens: number };
type MonitorData = {
  usage: Usage[];
  sharedUsage: Usage[];
  limits: { lite: number; flash: number; logicalBytesCap: number; physicalBytesGuard: number };
  storage: { bytes: number; records: number } | null;
  heartbeat: { scheduled_at: number; completed_at: number; status: string; count: number } | null;
  experiment: { started_at: number; ends_at: number; max_calls: number; status: string; mode: string } | null;
  metrics: { started_at: number; status: string; rows_read: number; rows_written: number; db_size: number | null }[];
  calls: { status: string }[];
};
const when = (ms: number) => new Date(ms).toLocaleString('pt-BR');
// Only values returned by /api/monitor. Reservations are not the same as calls received by Gemini.
function MonitorPanel({ monitor }: { monitor: MonitorData | null }) {
  if (!monitor) return <p className="footnote">Carregando dados técnicos reais…</p>;
  const usageRows = (rows: Usage[]) =>
    rows.map((u) => (
      <div key={u.day + u.model}>
        <span>
          {u.model}
          <small>dia do Pacífico {u.day}</small>
        </span>
        <strong>{u.calls} reservas</strong>
        <span>{u.tokens.toLocaleString('pt-BR')} tokens reportados</span>
      </div>
    ));
  const last = monitor.metrics[0];
  return (
    <div className="monitor-panel">
      <div className="technical-summary">
        <ShieldCheck />
        <div>
          <h3>Teto de orçamento deste ambiente</h3>
          <p>
            Flash Lite: até {monitor.limits.lite}/dia. Flash: até {monitor.limits.flash}/dia. Reservas são
            gravadas antes da chamada e incluem falhas; tokens podem ser desconhecidos quando não há
            resposta. Renovação à meia-noite do Pacífico.
          </p>
        </div>
      </div>
      <h3 className="monitor-heading">Uso deste ambiente</h3>
      <div className="usage-list">{usageRows(monitor.usage)}</div>
      <h3 className="monitor-heading">Uso compartilhado (todos os ambientes, mesma chave)</h3>
      <div className="usage-list">{usageRows(monitor.sharedUsage)}</div>
      <dl className="monitor-facts">
        <div>
          <dt>Execução agendada</dt>
          <dd>
            {monitor.heartbeat
              ? `${monitor.heartbeat.count} despertares; último ${when(monitor.heartbeat.completed_at)} (${monitor.heartbeat.status})`
              : 'Nenhum despertar registrado'}
          </dd>
        </div>
        <div>
          <dt>Experimento</dt>
          <dd>
            {monitor.experiment
              ? `${monitor.experiment.status} · ${monitor.experiment.mode} · até ${when(monitor.experiment.ends_at)} · teto ${monitor.experiment.max_calls} chamadas`
              : 'Nenhum'}
          </dd>
        </div>
        <div>
          <dt>Armazenamento lógico</dt>
          <dd>
            {monitor.storage
              ? `${(monitor.storage.bytes / 1e6).toFixed(2)} MB em ${monitor.storage.records} registros (teto ${monitor.limits.logicalBytesCap / 1e6} MB; estimativa, não tamanho físico)`
              : '—'}
          </dd>
        </div>
        <div>
          <dt>Último ciclo medido</dt>
          <dd>
            {last
              ? `${when(last.started_at)} · ${last.status} · ${last.rows_read} leituras / ${last.rows_written} escritas D1${last.db_size ? ` · banco ${(last.db_size / 1e6).toFixed(2)} MB` : ''}`
              : 'Nenhum ciclo medido'}
          </dd>
        </div>
      </dl>
    </div>
  );
}
