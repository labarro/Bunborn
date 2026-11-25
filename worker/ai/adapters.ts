// Provider adapters: every API difference lives here, never in the simulation engine.
// Each adapter receives the same request and returns raw text plus measured metadata,
// or throws a classified ProviderFailure.
import type { ModelEntry, ProviderId } from '../../shared/ai-catalog';

export type FailureKind =
  | 'sobrecarga' // 503/502/500/504, "high demand"
  | 'limite_taxa' // 429 per-minute
  | 'cota_esgotada' // 429 daily/quota exhausted
  | 'timeout'
  | 'rede'
  | 'autenticacao' // 401/403: permanent until fixed
  | 'modelo_inexistente' // 404
  | 'requisicao_invalida' // 400: incompatible request for this model
  | 'resposta_invalida' // unparseable / schema mismatch / truncated / empty
  | 'configuracao'; // missing key, disabled
export class ProviderFailure extends Error {
  constructor(public kind: FailureKind, public status: number, public retryAfterMs: number | null, public detail: string) {
    super(kind);
  }
  get recoverable() {
    return !['autenticacao', 'modelo_inexistente', 'configuracao'].includes(this.kind);
  }
}
export type CognitiveRequest = { system: string; prompt: string; schema: unknown; maxOutput: number; reasoning: 'baixo' | 'medio' };
export type CognitiveReply = { text: string; tokensIn: number; tokensOut: number; tokensTotal: number; latencyMs: number; finish: string };
export type Keys = Partial<Record<ProviderId, string>>;
const redact = (text: string, keys: Keys) => Object.values(keys).reduce((t, k) => (k ? t.split(k).join('[redacted]') : t), text);

export function classifyHttp(status: number, body: string, retryAfter: string | null, keys: Keys): ProviderFailure {
  const detail = redact(body, keys).slice(0, 600);
  const seconds = Number(retryAfter);
  const retry = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
  if (status === 401 || status === 403 || /API key not valid|API_KEY_INVALID|invalid api key|invalid_api_key/i.test(body)) return new ProviderFailure('autenticacao', status, null, detail);
  if (status === 404) return new ProviderFailure('modelo_inexistente', status, null, detail);
  // Groq answers 429 'Request too large' when prompt + max_tokens exceed tokens/minute: retrying
  // the same request cannot succeed, so it is an incompatible request, not a temporary rate limit.
  if (status === 413 || /Request too large/i.test(body)) return new ProviderFailure('requisicao_invalida', status, null, detail);
  if (status === 429) {
    const daily = /per day|daily|PerDay|RESOURCE_EXHAUSTED.*(day|quota)|quota exceeded|tokens per day|TPD|RPD/i.test(body);
    return new ProviderFailure(daily ? 'cota_esgotada' : 'limite_taxa', status, retry, detail);
  }
  if (status === 400 || status === 422) return new ProviderFailure('requisicao_invalida', status, null, detail);
  if (status === 408) return new ProviderFailure('timeout', status, retry, detail);
  return new ProviderFailure('sobrecarga', status, retry, detail);
}
async function readBounded(response: Response, max: number) {
  const text = await response.text();
  if (text.length > max) throw new ProviderFailure('resposta_invalida', response.status, null, 'resposta_excessiva');
  return text;
}
async function send(url: string, init: RequestInit, timeoutMs: number, fetcher: typeof fetch, keys: Keys) {
  let response: Response;
  try {
    response = await fetcher.call(globalThis, url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') throw new ProviderFailure('timeout', 0, null, 'sem resposta em ' + timeoutMs + ' ms');
    throw new ProviderFailure('rede', 0, null, redact(e instanceof Error ? e.message : String(e), keys).slice(0, 200));
  }
  if (!response.ok) throw classifyHttp(response.status, await response.text().catch(() => ''), response.headers.get('retry-after'), keys);
  return response;
}
/** Extracts the JSON object from a reply that may carry fences or stray text. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw new ProviderFailure('resposta_invalida', 200, null, 'JSON inválido: ' + trimmed.slice(0, 160));
  }
}

export async function callModel(model: ModelEntry, req: CognitiveRequest, keys: Keys, fetcher: typeof fetch = fetch, timeoutMs = 45000): Promise<CognitiveReply> {
  const key = keys[model.provider];
  if (!key) throw new ProviderFailure('configuracao', 0, null, 'chave ausente: ' + model.provider);
  const started = Date.now();
  if (model.provider === 'gemini') {
    const response = await send(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.id)}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            ...(model.structured === 'json_schema' ? { responseJsonSchema: req.schema } : {}),
            maxOutputTokens: Math.min(req.maxOutput, model.maxOutput),
            ...(model.reasoning === 'configuravel' && model.id.startsWith('gemini-3') ? { thinkingConfig: { thinkingLevel: req.reasoning === 'medio' ? 'low' : 'minimal' } } : {}),
          },
        }),
      },
      timeoutMs,
      fetcher,
      keys,
    );
    const raw = JSON.parse(await readBounded(response, 256000)) as {
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number; thoughtsTokenCount?: number };
    };
    const c = raw.candidates?.[0];
    const u = raw.usageMetadata ?? {};
    const text = c?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? '').join('') ?? '';
    const reply = { text, tokensIn: u.promptTokenCount ?? 0, tokensOut: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), tokensTotal: u.totalTokenCount ?? 0, latencyMs: Date.now() - started, finish: c?.finishReason ?? 'desconhecido' };
    if (reply.finish !== 'STOP' || !text) throw Object.assign(new ProviderFailure('resposta_invalida', 200, null, 'finishReason ' + reply.finish), { reply });
    return reply;
  }
  // OpenAI-compatible chat completions (Groq, NVIDIA).
  const base = model.provider === 'groq' ? 'https://api.groq.com/openai/v1' : 'https://integrate.api.nvidia.com/v1';
  const reasoningOss = model.id.startsWith('openai/gpt-oss');
  const body: Record<string, unknown> = {
    model: model.id,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.prompt },
    ],
    temperature: 0.7,
    max_tokens: Math.min(req.maxOutput, model.maxOutput),
    // json_schema (structured outputs) where the model supports it: nested tool contracts such as
    // criar/artifact were malformed with json_object alone (benchmark 25/11).
    response_format: model.structured === 'texto' ? undefined : model.structured === 'json_schema' ? { type: 'json_schema', json_schema: { name: 'decisao', schema: req.schema, strict: false } } : { type: 'json_object' },
  };
  if (reasoningOss) body.reasoning_effort = req.reasoning === 'medio' ? 'medium' : 'low';
  if (model.provider === 'groq' && model.id.startsWith('qwen/')) body.reasoning_effort = 'none';
  const response = await send(base + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body) }, timeoutMs, fetcher, keys);
  const raw = JSON.parse(await readBounded(response, 512000)) as {
    choices?: { message?: { content?: string | null }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const choice = raw.choices?.[0];
  const text = (choice?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const u = raw.usage ?? {};
  const reply = { text, tokensIn: u.prompt_tokens ?? 0, tokensOut: u.completion_tokens ?? 0, tokensTotal: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0), latencyMs: Date.now() - started, finish: choice?.finish_reason ?? 'desconhecido' };
  if (reply.finish === 'length' || !text) throw Object.assign(new ProviderFailure('resposta_invalida', 200, null, reply.finish === 'length' ? 'resposta truncada' : 'resposta vazia'), { reply });
  return reply;
}
