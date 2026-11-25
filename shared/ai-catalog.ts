// Catalog of cognitive models. Every field says where it comes from:
//   documentado  = provider's official docs/console (date in `checked`)
//   verificado   = measured by our own calls (benchmarks / homologation)
//   interno      = conservative internal limit we impose (provider publishes nothing usable)
//   desconhecido = not known; never treated as permission.
// A model is only routable after homologation for a category (shared/model-quality.json).
export const categories = ['cotidiana', 'complexa', 'memoria', 'pesquisa', 'criatividade', 'comunicacao'] as const;
export type Category = (typeof categories)[number];
export const categoryLabels: Record<Category, string> = {
  cotidiana: 'Cognição cotidiana',
  complexa: 'Cognição complexa',
  memoria: 'Memória e consolidação',
  pesquisa: 'Pesquisa',
  criatividade: 'Criatividade',
  comunicacao: 'Comunicação',
};
export type ProviderId = 'gemini' | 'groq' | 'nvidia';
export type Limits = { rpm: number; rpd: number; tpm: number; tpd: number | null; source: 'documentado' | 'interno'; resetsAt: string };
export type ModelEntry = {
  id: string;
  provider: ProviderId;
  label: string;
  free: 'documentado' | 'verificado' | 'desconhecido';
  context: number | null;
  maxOutput: number;
  structured: 'json_schema' | 'json_object' | 'texto';
  reasoning: 'nenhum' | 'configuravel' | 'sempre';
  /** Provider terms allow use in our public production observatory. */
  productionAllowed: boolean;
  termsNote: string;
  /** Limits we enforce (never above the documented ones). */
  limits: Limits;
  documentedLimits: string;
  checked: string;
};
export type ProviderEntry = { id: ProviderId; label: string; baseUrl: string; secret: string; dataPolicy: string; terms: string };
export const providers: ProviderEntry[] = [
  { id: 'gemini', label: 'Google Gemini (AI Studio, nível gratuito)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', secret: 'GEMINI_API_KEY', dataPolicy: 'No nível gratuito o Google pode usar entradas e saídas para melhorar produtos (termos do Gemini API).', terms: 'Uso gratuito permitido com limites; já em uso.' },
  { id: 'groq', label: 'Groq (plano Free)', baseUrl: 'https://api.groq.com/openai/v1', secret: 'GROQ_API_KEY', dataPolicy: 'Por padrão não retém entradas/saídas de inferência; registro temporário de até 30 dias só para confiabilidade/abuso, desativável em Data Controls (console.groq.com/docs/your-data, 25/11/2026).', terms: 'Plano Free com limites por organização; sem restrição de uso automatizado além dos limites e da política de uso aceitável.' },
  { id: 'nvidia', label: 'NVIDIA API Catalog (trial)', baseUrl: 'https://integrate.api.nvidia.com/v1', secret: 'NVIDIA_API_KEY', dataPolicy: 'Termos de trial: NVIDIA recebe licença sobre conteúdo enviado/gerado; não armazena ao fim da sessão salvo monitoramento de segurança/abuso.', terms: 'NVIDIA API Trial Terms 1.2: acesso "for limited trial purposes only and without use of the API Service or Generated Content in production". Por isso fica fora da produção por padrão.' },
];
const groqFree: Limits = { rpm: 20, rpd: 900, tpm: 7800, tpd: 180000, source: 'interno', resetsAt: '00:00 UTC' };
const nvidiaTrial: Limits = { rpm: 20, rpd: 300, tpm: 60000, tpd: null, source: 'interno', resetsAt: 'desconhecido' };
export const catalog: ModelEntry[] = [
  { id: 'gemini-3.1-flash-lite', provider: 'gemini', label: 'Gemini 3.1 Flash Lite', free: 'verificado', context: 1048576, maxOutput: 8192, structured: 'json_schema', reasoning: 'configuravel', productionAllowed: true, termsNote: 'Nível gratuito do AI Studio.', limits: { rpm: 12, rpd: 440, tpm: 200000, tpd: null, source: 'interno', resetsAt: '00:00 Pacífico' }, documentedLimits: '15 RPM, 500 RPD, 250k TPM (painel do AI Studio informado pelo responsável)', checked: '2026-11-25' },
  { id: 'gemini-3-flash-preview', provider: 'gemini', label: 'Gemini 3 Flash (preview)', free: 'verificado', context: 1048576, maxOutput: 8192, structured: 'json_schema', reasoning: 'configuravel', productionAllowed: true, termsNote: 'Nível gratuito do AI Studio.', limits: { rpm: 4, rpd: 16, tpm: 200000, tpd: null, source: 'interno', resetsAt: '00:00 Pacífico' }, documentedLimits: '5 RPM, 20 RPD, 250k TPM (painel do AI Studio informado pelo responsável)', checked: '2026-11-25' },
  { id: 'openai/gpt-oss-120b', provider: 'groq', label: 'GPT-OSS 120B (Groq)', free: 'documentado', context: 131072, maxOutput: 4096, structured: 'json_object', reasoning: 'configuravel', productionAllowed: true, termsNote: 'Plano Free da Groq.', limits: groqFree, documentedLimits: '30 RPM, 1K RPD, 8K TPM, 200K TPD (console.groq.com/docs/rate-limits, 25/11/2026)', checked: '2026-11-25' },
  { id: 'openai/gpt-oss-20b', provider: 'groq', label: 'GPT-OSS 20B (Groq)', free: 'documentado', context: 131072, maxOutput: 4096, structured: 'json_object', reasoning: 'configuravel', productionAllowed: true, termsNote: 'Plano Free da Groq.', limits: groqFree, documentedLimits: '30 RPM, 1K RPD, 8K TPM, 200K TPD (console.groq.com/docs/rate-limits, 25/11/2026)', checked: '2026-11-25' },
  { id: 'qwen/qwen3.8-27b', provider: 'groq', label: 'Qwen 3.8 27B (Groq)', free: 'documentado', context: 131072, maxOutput: 4096, structured: 'json_object', reasoning: 'configuravel', productionAllowed: true, termsNote: 'Plano Free da Groq.', limits: groqFree, documentedLimits: '30 RPM, 1K RPD, 8K TPM, 200K TPD (console.groq.com/docs/rate-limits, 25/11/2026)', checked: '2026-11-25' },
];
// NVIDIA models are added after discovery against the real /v1/models catalog of the key
// (scripts/ai-discover.mjs); entries share the trial limits and productionAllowed=false.
export const nvidiaCandidates = ['moonshotai/kimi-k2-instruct', 'deepseek-ai/deepseek-v3.1', 'qwen/qwen3-235b-a22b', 'nvidia/llama-3.3-nemotron-super-49b-v1.5', 'meta/llama-3.3-70b-instruct'];
export function nvidiaEntry(id: string, label = id): ModelEntry {
  return { id, provider: 'nvidia', label: label + ' (NVIDIA)', free: 'desconhecido', context: null, maxOutput: 4096, structured: 'json_object', reasoning: 'nenhum', productionAllowed: false, termsNote: 'Trial: proibido uso em produção (seção 1.2).', limits: nvidiaTrial, documentedLimits: '~40 RPM relatado em fóruns; sem limite diário publicado; termos de trial', checked: '2026-11-25' };
}
export const modelKey = (m: Pick<ModelEntry, 'provider' | 'id'>) => m.provider + ':' + m.id;
