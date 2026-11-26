import { z } from 'zod';
import { birth, tick, administer, safeError } from './engine';
import { Store, entry, decode, type Row } from './store';
import { configured, equalSecret, rateLimit, sameOrigin, session, sessionCookie } from './auth';
import { boundedJson, type Env } from './provider';
import { exportBackup, exportManifest, exportPage, restoreBackup } from './backup';
import {runCycle,scheduledRun,startExperiment,stopExperiment,experimentInfo,birthPreflight,confirmedBirth,diagnoseGemini} from './operations';
import {isFrozen,restoreLocked,beginExport,exportSegment,sealExport,cancelExport,beginRestore,uploadRestoreSegment,applyRestore} from './segmented-backup';
import {runToolTest} from './tool-tests';
import {coordinate}from'./coordination';
import { aiOverview, saveAiConfig } from './ai/admin';
import { highlights, logbook, recordVisit, visitorsToday, forgetInsights } from './insights';
export const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
const kinds = [
  'nascimento',
  'memoria',
  'intencao',
  'atividade',
  'pesquisa',
  'diario',
  'conversa',
  'identidade',
  'interesse',
  'projeto',
  'artefato',
  'habitat',
  'recurso',
  'conceito',
  'relacao',
  'comportamento',
  'erro',
  'erro_ferramenta',
  'interrupcao',
  'administracao',
  'recuperacao',
  'checkpoint',
  'personalidade',
  'conhecimento',
];
export async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname;
  if (request.method === 'POST' && !sameOrigin(request, env))
    return json({ error: 'origem_nao_autorizada' }, 403);
  if (path === '/api/session' && request.method === 'GET')
    return json({ authenticated: await session(env, request), configured: configured(env), publicObservation: env.PUBLIC_OBSERVATION === 'true' });
  if (path === '/api/login' && request.method === 'POST') {
    if (!configured(env))
      return json(
        {
          error:
            'Configure OBSERVER_SECRET e SESSION_SECRET como secrets de pelo menos 32 caracteres.',
        },
        503,
      );
    // Global and per-IP caps. IP is hashed; never persisted in plaintext.
    const hash = [
      ...new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(request.headers.get('cf-connecting-ip') ?? 'local'),
        ),
      ),
    ]
      .slice(0, 16)
      .map((n) => n.toString(16))
      .join('');
    if (
      !(await rateLimit(env, 'login:' + hash, 5, 900000)) ||
      !(await rateLimit(env, 'login:global', 30, 900000))
    )
      return json({ error: 'Muitas tentativas. Aguarde 15 minutos.' }, 429);
    const body = z
      .object({ secret: z.string().max(256) })
      .parse(await boundedJson(request as unknown as Response, 1024));
    if (!(await equalSecret(body.secret, env.OBSERVER_SECRET!)))
      return json({ error: 'Credencial incorreta.' }, 401);
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        'set-cookie': await sessionCookie(env),
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    });
  }
  const authenticated = await session(env, request);
  // Public observatory: anyone may read and leave rate-limited messages; administration,
  // backups, birth and engine controls always require the responsible observer.
  if (!authenticated && !isPublicRoute(env, request.method, path)) return json({ error: 'autenticacao_necessaria' }, 401);
  if(path.startsWith('/api/backup/')){
    let target=env;if(url.searchParams.get('target')==='recovery'){if(env.ENVIRONMENT_ID!=='homologation'||!env.RESTORE_DB)return json({error:'recuperacao_nao_autorizada'},403);target={...env,DB:env.RESTORE_DB};}
    if(request.method==='GET'&&path==='/api/backup/inspect'){const repo=new Store(target.DB);return json({state:await repo.state(),counts:(await target.DB.prepare('SELECT kind,COUNT(*) AS n FROM records GROUP BY kind').all()).results,usage:await repo.usage(),storage:await target.DB.prepare('SELECT * FROM storage_meter').first()});}
    if(request.method!=='POST')return json({error:'metodo_nao_permitido'},405);
    const body=await boundedJson(request as unknown as Response,200000) as Record<string,unknown>;
    if(path==='/api/backup/begin')return json(await beginExport(target));
    if(path==='/api/backup/page'){const b=z.object({id:z.string().uuid(),table:z.string(),after:z.number().int().nonnegative()}).parse(body);return json(await exportSegment(target,b.id,b.table,b.after));}
    if(path==='/api/backup/seal')return json(await sealExport(target,z.string().uuid().parse(body.id)));
    if(path==='/api/backup/cancel'){await cancelExport(target,z.string().uuid().parse(body.id));return json({cancelled:true});}
    if(path==='/api/backup/restore/begin')return json(await beginRestore(target,body));
    if(path==='/api/backup/restore/page')return json(await uploadRestoreSegment(target,body));
    if(path==='/api/backup/restore/apply'){const applied=await applyRestore(target,z.string().uuid().parse(body.id));forgetInsights(target);return json(applied);}
    return json({error:'rota_inexistente'},404);
  }
  if(request.method==='POST'&&path!=='/api/logout'&&await isFrozen(env))return json({error:'backup_ou_restauracao_em_andamento'},409);
  // A restore in progress must never expose a partially imported history.
  if(request.method==='GET'&&await restoreLocked(env)){if(path==='/api/state')return json({state:null,recent:[],usage:[],pending:[],restoring:true,ready:false,birthEnabled:false,environmentId:env.ENVIRONMENT_ID??env.ENVIRONMENT,environment:env.ENVIRONMENT});return json({error:'restauracao_em_andamento'},409);}
  const store = new Store(env.DB);
  if (request.method === 'GET') {
    if (path === '/api/state') {
      const [state, recent, usage, pending] = await Promise.all([
        store.state(),
        store.recent(24),
        store.usage(),
        env.DB.prepare(
          'SELECT id,content,at,author FROM inbox WHERE consumed=0 ORDER BY at DESC LIMIT 24',
        ).all(),
      ]);
      // Works shown in the house (exposed on objects, or the composition being played): their real
      // content, so frames and easels show what she actually made (never a placeholder image).
      const ids = [...new Set((state?.objects ?? []).map((o) => o.artifactId).filter((x): x is string => !!x))];
      if (state?.activity.kind === 'tocar') {
        const played = await env.DB.prepare("SELECT data FROM records WHERE kind='musica' ORDER BY seq DESC LIMIT 1").first<{ data: string }>();
        const id = played ? (JSON.parse(played.data) as { artifactId?: string }).artifactId : undefined;
        if (id) ids.push(id);
      }
      const works: Record<string, { title: string; artifact: unknown; version: number; realAt: number }> = {};
      if (ids.length) {
        const rows = await env.DB.prepare(`SELECT entity_id, content, data, real_at FROM records WHERE kind='artefato' AND entity_id IN (${ids.map(() => '?').join(',')}) ORDER BY seq DESC LIMIT 40`).bind(...ids).all<{ entity_id: string; content: string; data: string; real_at: number }>();
        for (const r of rows.results) if (!works[r.entity_id]) { const d = JSON.parse(r.data) as { artifact: unknown; version?: number }; works[r.entity_id] = { title: r.content, artifact: d.artifact, version: d.version ?? 1, realAt: r.real_at }; }
      }
      return json({
        state,
        recent,
        usage,
        works,
        pending: pending.results,
        ready: !!env.GEMINI_API_KEY && env.FREE_TIER_CONFIRMED === 'true'&&env.BIRTH_ENABLED!=='false',
        birthEnabled:env.BIRTH_ENABLED==='true',
        environmentId:env.ENVIRONMENT_ID??env.ENVIRONMENT,
        environment: env.ENVIRONMENT,
      });
    }
    if (path === '/api/highlights') return json({ ...(await highlights(env)), visitors: await visitorsToday(env) });
    if (path === '/api/logbook') return json(await logbook(env, Math.min(14, Math.max(1, Number(url.searchParams.get('days')) || 7))));
    if (path === '/api/records') {
      const kind = url.searchParams.get('kind') ?? 'memoria';
      if (!kinds.includes(kind) && kind !== 'todos')
        return json({ error: 'categoria_invalida' }, 400);
      const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
      const search = (url.searchParams.get('q') ?? '').slice(0, 200);
      let records;
      if (search) records = await store.memories(search, Date.now(), 40);
      else if (url.searchParams.get('latest') === 'true') {
        const before = after || Number.MAX_SAFE_INTEGER;
        const condition =
          kind === 'personalidade'
            ? "kind IN ('identidade','comportamento')"
            : kind === 'conhecimento'
              ? "kind IN ('conceito','relacao')"
              : 'kind=?';
        const statement = env.DB.prepare(
          `SELECT * FROM records WHERE seq IN (SELECT MAX(seq) FROM records WHERE ${condition} GROUP BY entity_id) AND seq<? ORDER BY seq DESC LIMIT 80`,
        );
        records = (
          await (
            condition === 'kind=?' ? statement.bind(kind, before) : statement.bind(before)
          ).all<Row>()
        ).results.map(decode);
      } else if (['todos', 'personalidade', 'conhecimento'].includes(kind)) {
        const condition =
          kind === 'personalidade'
            ? " AND kind IN ('identidade','comportamento')"
            : kind === 'conhecimento'
              ? " AND kind IN ('conceito','relacao')"
              : '';
        records = (
          await env.DB.prepare(
            'SELECT * FROM records WHERE seq<?' + condition + ' ORDER BY seq DESC LIMIT 80',
          )
            .bind(after || Number.MAX_SAFE_INTEGER)
            .all<Row>()
        ).results.map(decode);
      } else
        // Newest first; the cursor walks backwards through older records.
        records = (
          await env.DB.prepare('SELECT * FROM records WHERE kind=? AND seq<? ORDER BY seq DESC LIMIT 80')
            .bind(kind, after || Number.MAX_SAFE_INTEGER)
            .all<Row>()
        ).results.map(decode);
      return json({
        records,
        next: records.length === 80 ? records[records.length - 1]?.seq : null,
      });
    }
    if (path === '/api/export') {
      if (url.searchParams.has('manifest')) return json(await exportManifest(env));
      if (url.searchParams.has('table'))
        return json(
          await exportPage(
            env,
            url.searchParams.get('table')!,
            Number(url.searchParams.get('after')) || 0,
            Number(url.searchParams.get('upper')) || 0,
            Number(url.searchParams.get('revision')) || 0,
          ),
        );
      return exportBackup(env);
    }
    if (path === '/api/monitor') {
      const [lease, calls, retrievals, counts, storage] = await Promise.all([
        env.DB.prepare('SELECT expires FROM lease WHERE id=1').first(),
        env.DB.prepare(
          'SELECT id,model,at,reserved_tokens,actual_tokens,status FROM calls ORDER BY at DESC LIMIT 50',
        ).all(),
        env.DB.prepare('SELECT * FROM retrievals ORDER BY last_at DESC LIMIT 50').all(),
        env.DB.prepare('SELECT kind,COUNT(*) AS count FROM records GROUP BY kind').all(),
        env.DB.prepare('SELECT bytes,records FROM storage_meter WHERE id=1').first(),
      ]);
      return json({
        lease,
        calls: calls.results,
        retrievals: retrievals.results,
        counts: counts.results,
        storage,
        usage: await store.usage(),
        sharedUsage:env.BUDGET_DB?await new Store(env.BUDGET_DB).usage():await store.usage(),
        experiment:await experimentInfo(env),
        heartbeat:await env.DB.prepare('SELECT * FROM heartbeats WHERE id=1').first(),
        metrics:(await env.DB.prepare('SELECT * FROM cycle_metrics ORDER BY started_at DESC LIMIT 50').all()).results,
        limits: {
          lite: Math.min(440, Number(env.LITE_DAILY_LIMIT)),
          flash: Math.min(16, Number(env.FLASH_DAILY_LIMIT)),
          logicalBytesCap:180000000,
          physicalBytesGuard:400000000,
        },
        integration:
          'Cotas efetivas e CPU em produção exigem homologação. Nenhum serviço pago é acionado automaticamente.',
      });
    }
    if (path === '/api/ai') {
      if (!authenticated) return json({ error: 'nao_autorizado' }, 401);
      return json(await aiOverview(env));
    }
    return json({ error: 'rota_inexistente' }, 404);
  }
  if (request.method !== 'POST') return json({ error: 'metodo_nao_permitido' }, 405);
  if (authenticated && !(await rateLimit(env, 'write', 30, 60000)))
    return json({ error: 'limite_de_operacoes' }, 429);
  if (path === '/api/ai/config') {
    // Only the responsible observer; the creature has no tool that reaches this.
    if (!authenticated) return json({ error: 'nao_autorizado' }, 401);
    return json(await saveAiConfig(env, await boundedJson(request as unknown as Response, 20000)));
  }
  if (path === '/api/visit') {
    // Public write: bounded per visitor and globally so a script cannot burn the free quotas.
    if (!(await rateLimit(env, 'visit:' + (await ipHash(request)), 4, 3600000)) || !(await rateLimit(env, 'visit:global', 600, 3600000)))
      return json(await visitorsToday(env));
    return json(await recordVisit(env, request));
  }
  if (path === '/api/logout')
    return new Response('{}', {
      headers: { 'set-cookie': 'observador=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' },
    });
  if (path === '/api/birth') {if(env.ENVIRONMENT_ID)return json({error:'Use a confirmação explícita de nascimento.'},409);const state=await birth(env);forgetInsights(env);return json({ state });}
  if(path==='/api/birth/prepare')return json(await coordinate(env,{kind:'birth-preflight'}));
  if(path==='/api/birth/confirm'){const b=z.object({challenge:z.string().uuid(),confirmation:z.literal('QUERO INICIAR ESTA EXISTENCIA')}).strict().parse(await boundedJson(request as unknown as Response,1000));const born=await coordinate(env,{kind:'birth-confirm',data:b});forgetInsights(env);return json(born);}
  if (path === '/api/tick') return json(await coordinate(env,{kind:'cycle'}));
  if(path==='/api/diagnostics/gemini'){const b=z.object({model:z.enum(['lite','flash'])}).strict().parse(await boundedJson(request as unknown as Response,1000));return json(await coordinate(env,{kind:'diagnostic',data:b}));}
  if(path==='/api/diagnostics/tools'){const b=await boundedJson(request as unknown as Response,2000) as Record<string,unknown>;return json(await coordinate(env,{kind:'tools',data:b}));}
  if(path==='/api/experiment'){const b=z.object({action:z.enum(['start','stop','step']),hours:z.number().min(1).max(72).optional(),maxCalls:z.number().int().min(1).max(180).optional(),mode:z.enum(['autonomo','acelerado']).optional(),virtualMinutes:z.number().min(0).max(720).optional(),model:z.enum(['lite','flash']).optional()}).strict().parse(await boundedJson(request as unknown as Response,2000));return json(await coordinate(env,{kind:b.action==='start'?'experiment-start':b.action==='stop'?'experiment-stop':'experiment-step',data:b}));}
  if (path === '/api/restore')
    {if(env.ENVIRONMENT_ID==='production')return json({error:'Use backup assinado de origem production.'},403);const restored=await restoreBackup(env, await boundedJson(request as unknown as Response, 8000000));forgetInsights(env);return json(restored);}
  const body = await boundedJson(request as unknown as Response, 5000);
  if (path === '/api/message') {
    const b = z
      .object({ content: z.string().trim().min(1).max(authenticated ? 2000 : 500), id: z.string().uuid() })
      .strict()
      .parse(body);
    if (!authenticated) {
      const visitor = await ipHash(request);
      if (!(await rateLimit(env, 'visit-message:' + visitor, 3, 3600000)) || !(await rateLimit(env, 'visit-message:global', 30, 3600000)))
        return json({ error: 'Muitas mensagens agora. Tente mais tarde.' }, 429);
    }
    if (!(await store.state())) return json({ error: 'A criatura ainda não nasceu.' }, 409);
    const pending = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM inbox WHERE consumed=0',
    ).first<{ count: number }>();
    if ((pending?.count ?? 0) >= 24)
      return json({ error: 'A caixa de mensagens está cheia; aguarde a criatura.' }, 429);
    await env.DB.prepare('INSERT INTO inbox(id,content,at,author) VALUES(?,?,?,?) ON CONFLICT DO NOTHING')
      .bind(b.id, b.content, Date.now(), authenticated ? 'responsavel' : 'visitante')
      .run();
    return json({ queued: true });
  }
  if (path === '/api/settings') {
    const b = z
      .object({ paused: z.boolean(), multiplier: z.number().int().min(1).max(12) })
      .strict()
      .parse(body);
    return json({
      state: await administer(env, async (s) => {
        s.paused = b.paused;
        s.multiplier = b.multiplier;
        return [
          entry(
            s,
            'administracao',
            b.paused ? 'Pausa administrativa ativada.' : 'Configuração temporal atualizada.',
            b,
          ),
        ];
      }),
    });
  }
  if (path === '/api/resource') {
    const b = z
      .object({ id: z.string().max(200), approve: z.boolean() })
      .strict()
      .parse(body);
    return json({
      state: await administer(env, async (s, repo) => {
        const old = await repo.entity(b.id);
        if (!old || old.kind !== 'recurso' || old.data.status !== 'pendente')
          throw new Error('pedido_invalido');
        if (b.approve) {
          // House v2: a catalogue request becomes that object, placed in a room where it fits;
          // anything else becomes a generic decoration. The creature decides later where it goes.
          const { catalogueEntry, findPlacement, kinds } = await import('../shared/house');
          const item = typeof old.data.catalogId === 'string' ? catalogueEntry(old.data.catalogId) : null;
          const kind = item?.kind ?? 'decoracao';
          const object = { id: old.entityId, label: old.content.slice(0, 80), kind, x: 0, y: 0, color: item ? '#b88b68' : '#b8a2d0' };
          const place = findPlacement(s.objects, s.position, object, item?.rooms ?? (kinds[kind].outdoor ? ['jardim'] : ['sala', 'estudio', 'quarto', 'cozinha']));
          if (!place) throw new Error('sem_espaco');
          s.objects.push({ ...object, ...place });
        }
        return [
          entry(
            s,
            'recurso',
            old.content,
            { ...old.data, status: b.approve ? 'aprovado' : 'rejeitado', approvedAt: Date.now() },
            { entityId: old.entityId, origin: 'observador' },
          ),
        ];
      }),
    });
  }
  return json({ error: 'rota_inexistente' }, 404);
}
export const publicGet = new Set(['/api/state', '/api/records', '/api/monitor', '/api/highlights', '/api/logbook']);
export function isPublicRoute(env: Env, method: string, path: string) {
  if (env.PUBLIC_OBSERVATION !== 'true') return false;
  return (method === 'GET' && publicGet.has(path)) || (method === 'POST' && (path === '/api/message' || path === '/api/visit'));
}
async function ipHash(request: Request) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(request.headers.get('cf-connecting-ip') ?? 'local'));
  return [...new Uint8Array(bytes)].slice(0, 16).map((n) => n.toString(16).padStart(2, '0')).join('');
}
// Error boundary shared by the gateway Worker and the Durable Object executor.
export async function handleApi(request: Request, env: Env): Promise<Response> {
  try {
    return await api(request, env);
  } catch (e) {
    return json({ error: safeError(e) }, e instanceof z.ZodError ? 400 : 409);
  }
}
