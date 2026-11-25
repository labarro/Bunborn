// Responsible observer's view of the multiprovider cognition. Technical, kept out of the habitat.
// Keys are never shown (the API only says whether a provider is configured).
import { useEffect, useState } from 'react';

type Health = { state: string; consecutive_failures: number; next_probe_at: number; success_ewma: number; valid_ewma: number; latency_ewma: number; calls: number; successes: number; invalid: number; last_error: string | null; last_used_at: number | null };
type Model = {
  key: string; id: string; provider: string; label: string; free: string; productionAllowed: boolean; termsNote: string; documentedLimits: string;
  limits: { rpm: number; rpd: number; tpm: number; tpd: number | null; source: string; resetsAt: string };
  usage: { day: string; callsShared: number; tokensShared: number; remainingCallsEstimate: number; remainingTokensEstimate: number | null };
  quality: Record<string, number>; homologated: string[]; health: Health | null; enabled: boolean;
};
type Config = { disabledProviders: string[]; disabledModels: string[]; strategy: 'auto' | 'manual'; manual: Record<string, string>; allowTrialInProduction: boolean; dailyCaps: Record<string, number> };
type Route = { category: string; categoryReason: string; selected: string | null; reasons: string[]; eligible: { model: string; score: number }[]; excluded: { key: string; reason: string }[]; attempts: { model: string; outcome: string; latencyMs: number; tokens: number; detail?: string }[]; fallbacks: number; tokens: number; latencyMs: number; validation: string };
type Overview = { environment: string; providers: { id: string; label: string; configured: boolean; enabled: boolean; dataPolicy: string; terms: string }[]; categories: string[]; config: Config; models: Model[]; recent: { seq: number; at: number; kind: string; content: string; model: string | null; route: Route }[]; note: string };

const stateLabel: Record<string, string> = { operacional: 'Operacional', degradado: 'Degradado', indisponivel: 'Indisponível', em_teste: 'Em teste de recuperação', desabilitado: 'Desabilitado' };
const pct = (n: number) => Math.round(n * 100) + '%';
const time = (ms: number) => new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function ProvidersPanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const load = () =>
    fetch('/api/ai', { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<Overview>) : Promise.reject(new Error('http_' + r.status))))
      .then((d) => (setData(d), setError('')))
      .catch(() => setError('Não foi possível carregar os provedores (é preciso entrar como responsável).'));
  useEffect(() => {
    void load();
  }, []);
  const save = async (config: Config) => {
    setSaving(true);
    try {
      const r = await fetch('/api/ai/config', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config) });
      if (!r.ok) throw new Error();
      await load();
    } catch {
      setError('Não foi possível salvar a configuração.');
    } finally {
      setSaving(false);
    }
  };
  if (error) return <p className="insight-empty">{error}</p>;
  if (!data) return <p className="insight-empty">Carregando provedores…</p>;
  const c = data.config;
  const toggle = (list: string[], item: string) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  return (
    <div className="providers">
      <section className="insight-card">
        <h3>Provedores ({data.environment})</h3>
        <ul className="provider-list">
          {data.providers.map((p) => (
            <li key={p.id}>
              <label>
                <input type="checkbox" checked={!c.disabledProviders.includes(p.id)} disabled={saving || !p.configured} onChange={() => void save({ ...c, disabledProviders: toggle(c.disabledProviders, p.id) })} />
                <strong>{p.label}</strong> — {p.configured ? 'chave configurada (oculta)' : 'sem chave neste ambiente'}
              </label>
              <small>{p.terms}</small>
              <small>Dados: {p.dataPolicy}</small>
            </li>
          ))}
        </ul>
        <label className="provider-option">
          <input type="checkbox" checked={c.strategy === 'manual'} disabled={saving} onChange={() => void save({ ...c, strategy: c.strategy === 'manual' ? 'auto' : 'manual' })} />
          Seleção manual por categoria (desmarcado = roteamento automático por pontuação)
        </label>
        <label className="provider-option">
          <input type="checkbox" checked={c.allowTrialInProduction} disabled={saving} onChange={() => void save({ ...c, allowTrialInProduction: !c.allowTrialInProduction })} />
          Permitir provedores de trial (NVIDIA) em produção — os termos deles proíbem uso em produção
        </label>
        {c.strategy === 'manual' ? (
          <div className="provider-manual">
            {data.categories.map((cat) => (
              <label key={cat}>
                {cat}
                <select value={c.manual[cat] ?? ''} disabled={saving} onChange={(e) => void save({ ...c, manual: { ...c.manual, [cat]: e.target.value } })}>
                  <option value="">automático</option>
                  {data.models.filter((m) => m.homologated.includes(cat)).map((m) => (
                    <option key={m.key} value={m.key}>{m.label}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        ) : null}
        <p className="provider-note">{data.note}</p>
      </section>
      <section className="insight-card">
        <h3>Modelos</h3>
        <div className="provider-table-wrap">
          <table className="provider-table">
            <thead>
              <tr><th>Modelo</th><th>Estado</th><th>Uso hoje (estimado)</th><th>Sucesso / válidas</th><th>Latência</th><th>Homologado para</th><th>Ativo</th></tr>
            </thead>
            <tbody>
              {data.models.map((m) => (
                <tr key={m.key}>
                  <td><strong>{m.label}</strong><small>{m.documentedLimits}</small>{!m.productionAllowed ? <small>Somente fora da produção (termos).</small> : null}</td>
                  <td>{stateLabel[m.health?.state ?? 'operacional']}{m.health?.next_probe_at && m.health.next_probe_at > Date.now() ? <small>próxima tentativa {time(m.health.next_probe_at)}</small> : null}{m.health?.last_error ? <small title={m.health.last_error}>{m.health.last_error.slice(0, 60)}</small> : null}</td>
                  <td>{m.usage.callsShared}/{m.limits.rpd} req{m.limits.tpd ? <small>{Math.round(m.usage.tokensShared / 1000)}k/{Math.round(m.limits.tpd / 1000)}k tokens</small> : null}</td>
                  <td>{m.health ? pct(m.health.success_ewma) + ' / ' + pct(m.health.valid_ewma) : '—'}<small>{m.health ? m.health.successes + ' de ' + m.health.calls : ''}</small></td>
                  <td>{m.health ? (m.health.latency_ewma / 1000).toFixed(1) + ' s' : '—'}</td>
                  <td>{m.homologated.length ? m.homologated.map((h) => h + ' ' + (m.quality[h] ?? 0).toFixed(2)).join(', ') : 'não homologado'}</td>
                  <td><input type="checkbox" aria-label={'Ativar ' + m.label} checked={m.enabled} disabled={saving} onChange={() => void save({ ...c, disabledModels: toggle(c.disabledModels, m.key) })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="insight-card">
        <h3>Roteamento das últimas decisões</h3>
        <p className="provider-note">Motivos técnicos de seleção do modelo, não intenções da criatura.</p>
        <ul className="route-list">
          {data.recent.map((r) => (
            <li key={r.seq}>
              <strong>{time(r.at)} · {r.route.category}</strong> → {r.route.selected ?? 'nenhum modelo respondeu'}
              <small>{r.route.reasons.slice(0, 2).join('; ')}{r.route.fallbacks ? ` · ${r.route.fallbacks} fallback(s)` : ''} · {r.route.tokens} tokens · {(r.route.latencyMs / 1000).toFixed(1)} s · {r.route.validation}</small>
              {r.route.attempts.length > 1 ? <small>Tentativas: {r.route.attempts.map((a) => a.model.split(':')[1] + ' (' + a.outcome + ')').join(' → ')}</small> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
