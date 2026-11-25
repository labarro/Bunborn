# Provedores de IA

O Bunborn usa três provedores gratuitos. Nenhum deles é "o principal": o roteador (ver [COGNITIVE_ROUTING.md](COGNITIVE_ROUTING.md)) escolhe o modelo por categoria cognitiva, com base em qualidade medida no benchmark próprio ([MODEL_BENCHMARKS.md](MODEL_BENCHMARKS.md)), confiabilidade recente, cota restante e latência.

Legenda de origem das informações: **documentado** (documentação/console oficial, com data), **verificado** (medido por chamadas nossas), **interno** (limite conservador que impomos), **desconhecido**.

## Custo zero

As três contas estão em planos gratuitos **sem faturamento vinculado**. O responsável confirmou isso digitando `FREE` em `scripts/configure-gemini.ps1` e `scripts/configure-providers.ps1`, e a confirmação fica em `.wrangler/private/*-free-confirmation.json`. Sem cobrança vinculada, uma chamada fora da franquia é recusada pelo provedor, e nunca cobrada. Nenhum serviço pago foi contratado e nenhuma assinatura foi feita.

## Credenciais

| Secret | Onde fica | Ambientes |
|---|---|---|
| `GEMINI_API_KEY` | DPAPI local (`.wrangler/private/gemini.dpapi`) → secret do Worker | produção, homologação |
| `GROQ_API_KEY` | DPAPI local (`.wrangler/private/groq.dpapi`) → secret do Worker | produção, homologação |
| `NVIDIA_API_KEY` | DPAPI local (`.wrangler/private/nvidia.dpapi`) → secret do Worker | produção e homologação (ver a decisão abaixo) |

- O responsável digitou as chaves com entrada oculta (`Read-Host -AsSecureString`). Elas nunca passaram pelo chat.
- `scripts/deploy.mjs` lê as chaves na memória e as envia pela API do Cloudflare como secrets.
- Nenhuma chave vai para o frontend, o D1, o git, os registros ou a criatura.
- Mensagens de erro dos provedores passam por um filtro que troca qualquer chave por `[redacted]`.
- O painel mostra só "chave configurada (oculta)".
- `AI_PROVIDERS` (variável do wrangler) liga ou desliga cada provedor por ambiente.
- O painel **Provedores** desliga provedores e modelos individualmente sem novo deploy.

## Google Gemini

- **Endpoint:** `https://generativelanguage.googleapis.com/v1beta`, com saída JSON e JSON Schema nativo (`responseJsonSchema`).
- **Modelos da chave:** 49 aceitam `generateContent` (`artifacts/ai-discovery.json`, verificado em 25/11).
- **Avaliados:** `gemini-3.1-flash-lite` e `gemini-3-flash-preview`, que já eram usados, e `gemini-3.5-flash-lite`, novo. O `gemma-4-31b-it` respondeu, mas levou 32 s no teste rápido e ficou fora.
- **Limites documentados pelo responsável (painel do AI Studio):**
  - Flash Lite: 15 RPM, 500 RPD, 250 mil TPM.
  - Flash: 5 RPM, 20 RPD.
- **Limites internos:** Flash Lite 12 RPM e 440 RPD; Flash 4 RPM e 16 RPD. O dia da cota vira à meia-noite do Pacífico.
- **Disponibilidade medida:** 26% das chamadas reais de produção terminaram em HTTP 503 ("high demand"), concentradas entre 11h e 16h UTC. Ver o diagnóstico em [COGNITIVE_ROUTING.md](COGNITIVE_ROUTING.md#diagnóstico-dos-503).
- **Dados:** no nível gratuito, o Google pode usar entradas e saídas para melhorar produtos.

## Groq

- **Endpoint:** `https://api.groq.com/openai/v1` (compatível com OpenAI), com `response_format: json_object`.
- **Modelos gratuitos da chave** (documentado em console.groq.com/docs/rate-limits e verificado em `/v1/models`, 25/11/2026): `openai/gpt-oss-120b`, `openai/gpt-oss-20b` e `qwen/qwen3.8-27b`.
- **Fora de uso:**
  - `gpt-oss-safeguard-20b` é um classificador (3 RPM).
  - `allam-2-7b` não tem documentação de plano gratuito e tem janela de 4 mil tokens.
  - Os modelos Whisper e Orpheus são de áudio.
- **Limites documentados (Free):** 30 RPM, 1.000 RPD, **8 mil TPM e 200 mil TPD** por modelo, contados por organização. Tokens em cache não contam.
- **Limites internos:** 20 RPM, 900 RPD, 7 mil TPM e 180 mil TPD por modelo. O dia da cota vira às 00:00 UTC.
- **Restrição que manda:** com o contexto real da Lumi, uma decisão usava de 6,0 a 6,8 mil tokens (média do ledger de produção, 25/11) e passou a usar cerca de 5,3 mil depois da auditoria cognitiva (benchmark sobre o backup real). Com 8 mil TPM, cabe **uma decisão por minuto por modelo**; com 200 mil TPD, cerca de **37 decisões por dia por modelo**. O Qwen também tem limite de tokens de saída por minuto (OTPM), que apareceu num "Request too large" em 25/11. O orçamento confere TPM e TPD antes de cada chamada, e as respostas 429 com `retry-after` são respeitadas.
- **Raciocínio:** gpt-oss com `reasoning_effort` low (medium em decisões complexas ou criativas); Qwen com `reasoning_effort: none`.
- **Dados** (console.groq.com/docs/your-data, 25/11/2026): por padrão não guarda entradas nem saídas de inferência. Pode registrar por até 30 dias só para confiabilidade ou investigação de abuso, o que pode ser desligado em Data Controls.

## NVIDIA API Catalog

- **Endpoint:** `https://integrate.api.nvidia.com/v1` (compatível com OpenAI), com `json_object`.
- **Catálogo da chave:** 30 modelos (`artifacts/ai-discovery.json`).
- **Avaliados:** `moonshotai/kimi-k3.1-pro`, `nvidia/nemotron-3-ultra-550b-a55b`, `mistralai/mistral-large-4-1t-a52b`, `minimaxai/minimax-m3.1-flash`, `stepfun-ai/step-5-preview` e `nvidia/nemotron-3.5-lightning-30b-a3b`.
- **Descartado:** `z-ai/glm-5.3-flash`, que não respondeu em 60 s no teste rápido.
- **Limites:** cerca de 40 RPM, segundo relatos em fóruns; não há limite diário publicado (desconhecido). Limites internos: 20 RPM e 300 RPD.
- **Termos** (NVIDIA API Trial Terms of Service, seção 1.2): o acesso é "for limited trial purposes only and without use of the API Service or Generated Content in production". A seção 2.2 dá à NVIDIA licença sobre o conteúdo enviado e o gerado.
- **Decisão:** em 25/11/2026, o responsável, informado da restrição, **autorizou explicitamente o uso da NVIDIA também na produção**. O Bunborn é um projeto pessoal e sem fins lucrativos.
  - O catálogo continua marcando esses modelos como trial (`productionAllowed: false`), porque é o que os termos dizem.
  - Na produção, eles só entram no roteamento enquanto a opção do responsável "Permitir provedores de trial em produção" (`allowTrialInProduction`) estiver ligada. Ela pode ser desligada no painel a qualquer momento, sem novo deploy.
  - O risco contratual (os termos de trial) é assumido pelo responsável.
- **Latência medida:** 4 a 45 s, com timeouts frequentes nos modelos grandes.

## Minimização de dados

Cada chamada leva só o contexto cognitivo da criatura, o mesmo para qualquer provedor: estado, memórias selecionadas, projetos, mensagens e resultados de ferramentas. Nunca leva credenciais, configuração administrativa, IPs de visitantes nem dados de outros projetos.

As mensagens de visitantes já são públicas por definição. O conteúdo externo continua marcado como não confiável, então funciona como dado e nunca como instrução.
