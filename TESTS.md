# Testes e evidências

Execução: **24/11/2026 (UTC)**, Windows 11, Node.js 24.13.0, Wrangler 4, Chromium do Playwright. Legenda: **fixture** = resposta programada, sem IA; **induzido** = Gemini real com instrução de teste dizendo qual ferramenta usar; **autônomo** = Gemini real sem direção. Nenhum nascimento em produção.

## Resumo

| Camada | Ambiente | Resultado |
|---|---|---|
| TypeScript + build | local | Aprovado (main ~357 KB, Phaser ~1.217 KB antes do gzip) |
| Motor, memória, ferramentas | SQLite real + adaptador D1 (batch atômico síncrono) | **49 aprovados**, 1 de rede ignorado por padrão |
| Backup v2 | idem, com >2.000 registros | 6 testes (incluídos nos 45) |
| E2E | Chromium + Worker + **DO** + D1 locais (Wrangler), observatório público ligado | **6 aprovados** |
| Segurança remota | produção (pública) e homologação (privada) | **40/40** (`artifacts/remote-security.json`) |
| Restauração real | homologação → `bunborn-recovery` | Dados idênticos (`artifacts/backup-restore-real.json`) |
| Ferramentas reais | `bunborn-tool-tests`, **induzido** | Ver tabela abaixo (`artifacts/tool-tests-induced.json`) |
| CPU Free | GraphQL Analytics (amostrado) | Ver seção CPU |
| Revisão visual | URLs reais, 1440×1000 e 390×844 | 14 telas, 0 erros de console, 0 overflow (`artifacts/visual/`) |
| Experimento autônomo 24h | homologação, criatura descartável | Em andamento; ver REPORT.md |
| PC desligado | — | **Não verificado ainda**: exige desligar este PC; procedimento no README |

## Testes novos desta etapa

`tests/backup-v2.test.ts` (fixtures, bancos isolados):
1. Exporta 2.601 registros enquanto heartbeats do Cron continuam; roundtrip JSON; restaura num banco vazio. Todas as tabelas, a linha `world` (byte a byte), o medidor e o FTS ficam idênticos; heartbeats não são restaurados.
2. Rejeita estado adulterado, cabeçalho adulterado, secret de outro ambiente, origem de teste em produção e linha adulterada; aplicar com upload incompleto falha.
3. Recusa sobrescrever banco populado; bloqueia leituras/escritas durante a importação; recusa outra restauração simultânea.
4. Retoma uma restauração parcialmente aplicada (alvo já não vazio) e aplica três requisições concorrentes por rodada sem duplicar nada.
5. Páginas concorrentes e repetidas concordam; páginas fora da cadeia nunca são assinadas.
6. Cancelamento invalida o snapshot.

`tests/features.test.ts` (fixtures; o Gemini só aparece como resposta HTTP simulada):
- Fila de atividades: até 4, continuar não reinicia a duração, conclusão na ordem, a 5ª é rejeitada, `interromper` limpa a fila.
- Atividades concluídas durante uma mudança administrativa são registradas, não descartadas.
- Referência a entidade criada antes no mesmo ciclo; evidência inventada é rejeitada com `detail.missing`; ferramenta de estação durante outra atividade explica atividade, estação e minutos restantes.
- Entidades citadas por UUID, id curto ou entityId resolvem sem duplicação (revisão v2, conclusão de projeto citando a v1 da obra).
- Memória antiga sob 360 recentes é recuperada por texto e por vínculo explícito.
- Orçamento compartilhado: o esgotamento local não consome vagas globais; o teto global vale sob 6 requisições concorrentes (3 aceitas, 3 `orcamento_global_suspenso`, 5 requisições de rede no total).
- Fallback Flash→Lite com registro quando o Flash está esgotado.
- Nonce de nascimento: uso único, expiração, frase obrigatória; sem configuração Gemini nada nasce.
- Experimento para sozinho por prazo e por teto de chamadas; produção recusa relógio controlado.

Correção do adaptador de teste: o batch anterior cedia o controle (`await`) dentro da transação e permitia `BEGIN` aninhado em testes concorrentes, o que não acontece no D1. Agora executa de forma síncrona e atômica.

E2E de observatório público: visitante sem credencial lê estado/registros, recebe 400 acima de 500 caracteres e 429 na 4ª mensagem da hora, as mensagens ficam marcadas como `visitante`; configurações, backup, nascimento, tick, recursos e exportação retornam 401 sem sessão.

E2E novo: exportação v2 assinada pelo gateway + DO, escrita recusada durante o congelamento, cookie forjado retorna 401, restauração recusada sobre banco populado.

`tests/insights.test.ts`: destaques e diário de bordo refletem só os registros armazenados; existência não nascida não gera resumo; o contador de visitas conta cada visitante uma vez por dia e não guarda o IP. `features.test.ts` também cobre a validação por ação, reproduzindo a falha real de produção: a ação válida é executada e a malformada vira `acao_malformada`. O E2E do visitante cobre destaques, diário de bordo e contador sem credencial.

## Multiprovedor (25/11)

**Falhas simuladas** (`tests/routing.test.ts`, 14 testes): todas as respostas de provedor vêm de fetchers de fixture, sem nenhuma chamada real.
- Categorização determinística.
- Seleção por qualidade e por categoria, sem ordem fixa de provedores.
- Exclusões com motivo: não homologado, breaker aberto, cota de tokens, desligado.
- Termos da NVIDIA fora da produção.
- Afinidade de continuidade e seleção manual.
- Pressão de cota.
- Classificação de erros (503, 429 por minuto, 429 diário, 401/400 de chave, 400) com as chaves mascaradas.
- Breaker com espera crescente, jitter e `Retry-After`, desabilitação por credencial, tolerância a uma resposta inválida isolada e recuperação.
- Persistência do breaker depois de um reinício (novo `Store` sobre o mesmo D1).
- No motor real:
  - Gemini 503 → outro modelo responde no mesmo ciclo, com **uma única decisão aplicada**;
  - JSON inválido → próximo modelo; credencial inválida não é repetida no ciclo seguinte;
  - **todos os provedores fora**: estado preservado, `cognicao_indisponivel` com a rota, nenhuma decisão inventada, o corpo continua e a cognição volta sozinha depois do breaker;
  - o mesmo contexto de identidade chega ao Gemini e à Groq;
  - orçamento reservado por modelo, com provedor e categoria.

**E2E:** `/api/ai` e `/api/ai/config` dão 401 sem sessão. Com sessão, a resposta não contém nenhuma chave, e a configuração é validada: modelo desconhecido é rejeitado.

**Chamadas reais:**
- `scripts/ai-discover.mjs`: catálogos dos três provedores (`artifacts/ai-discovery.json`).
- `scripts/ai-smoke.ts`: disponibilidade, JSON, latência e tokens de 14 modelos (`artifacts/ai-smoke.json`).
- Benchmark do Bunborn (`scripts/benchmark.mjs`): cenários num motor real com bancos descartáveis (`artifacts/model-benchmarks.json`, ver [MODEL_BENCHMARKS.md](MODEL_BENCHMARKS.md)).
- Homologação ponta a ponta na criatura descartável da homologação (`scripts/multiprovider-homologation.mjs`, `artifacts/multiprovider-homologation.json`).

## Restauração real (homologação → recuperação isolada)

Execução 2 (definitiva), 24/11/2026 00:33Z, backup `25224e31…`: 182.522 bytes, 16 segmentos; 179 registros, 316 vínculos, 126 recuperações, 36 chamadas, 2 orçamentos, 26 métricas, 1 experimento, 2 operações. Export 9,6 s; restauração 11,4 s (6 chamadas de apply). Digests de todos os segmentos, estado (mesma ordem de chaves), identidade, idade virtual (1.718,43 min), necessidades, 25 decisões, medidor (152.153 bytes / 179) e contagens por tipo: **idênticos**. A execução 1 (`backup-restore-real-run1.json`) revelou que o estado restaurado tinha as chaves reordenadas pelo Zod (conteúdo igual). Corrigido: agora se persiste o JSON assinado exato, e o manifesto é estrito.

Nenhuma restauração foi testada em produção. D1 Time Travel (7 dias no Free) existe, mas não foi executado.

## Ferramentas reais induzidas (`bunborn-tool-tests`)

| Cenário | Resultado real |
|---|---|
| research | `pesquisar` Wikipedia "água": 3 fontes reais gravadas (curid 5313, 13963, 1604421) + conceito |
| create | Projeto `ensaio` (etapas, sem marcar concluído) + poema (texto) + desenho (pixels) |
| music_object | 1ª tentativa: HTTP 503 do Gemini; 2ª: `projeto_inexistente` — **bug do motor** (o modelo citou o UUID real do projeto). Após a correção: música + objeto criados |
| read | Antes da correção: `obra_inexistente` (UUID real citado). Depois: leitura do poema persistido |
| revise | Versão 2 do mesmo `artefato:texto-ensaio` |
| habitat | Planta reposicionada e desenho exposto no ateliê |
| complete | Depois de um 503: projeto `ensaio` v2 concluído citando a obra |
| memory_message | Depois de um 503: memória autobiográfica aceita + mensagem ao observador declarando o teste |

Todos são **induzidos**: provam que as ferramentas funcionam com respostas reais do modelo, não preferências da criatura.

## CPU (GraphQL Analytics, amostrado, µs → ms)

| Caminho | Antes | Depois do gateway + DO |
|---|---|---|
| Cron do Worker | produção antiga: P50 5,8 / P90 10,5–10,7 / **P99 13,7 ms** | P50 0,54–0,6 / P99 0,5–1,3 ms |
| HTTP do Worker | 0afdbddd: P99 12,5 ms; versões antigas até 84,7–96,1 ms | P50 0,9–1,4 / P99 4,7–7,1 / P99.9 8,8 ms (334 requests) |
| Durable Object | — | P50 3,0–4,0 / P90 4,5–7,9 / P99 26,9–41,8 ms, 0 erros, 0 `exceededCpu` |

Conclusões: o Worker ficou dentro de 10 ms em todas as amostras observadas pós-gateway (amostragem, não prova exaustiva). O DO passa de 10 ms sem ser interrompido; ressalva documental em ECONOMY.md. Startup (`startupCpuTimeUs`) é medido à parte e não é CPU por invocação.

## Revisão visual (URLs reais)

`artifacts/visual/*.png`: produção pública e autenticada (vazia, botão de nascimento desabilitado: "Refúgio reservado · aguardando homologação"), homologação com habitat, intenções, linha do tempo, memórias, personalidade, acervo e monitoramento (desktop), habitat, linha do tempo e monitoramento (mobile). Defeitos corrigidos: faixa vazia sob o habitat (grid `align-items: start`); Monitoramento mostrava 440/16 em vez dos limites do ambiente, só o uso local e um estado vazio enganoso. Agora mostra limites reais, uso local e compartilhado, Cron, experimento, armazenamento e último ciclo. A cerimônia de nascimento não foi aberta em produção (bloqueada pelo servidor). `artifacts/habitat-*.png` e `coelho-fixture.png` são capturas **locais de fixture** geradas pelo E2E; `habitat-desktop-before.png` e `mobile-review.png` são históricas.

## Reprodução

```powershell
npm ci; npm run typecheck; npm test; npm run build
npx playwright install chromium; npm run test:e2e
node scripts/remote-security.mjs      # remoto, sem nascimento
node scripts/remote-metrics.mjs 24
node scripts/secret-scan.mjs
```

## Limites de inferência

Fixtures e cenários induzidos não provam emergência. As 25 decisões reais da primeira criatura usaram relógio virtual acelerado em passos controlados (~28,6 h virtuais em ~25 min reais). O experimento de 24h usa tempo real e só será avaliado com os registros dele. Reservas de cota não equivalem a chamadas recebidas pelo Gemini.
