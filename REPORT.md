# Relatório de homologação — Bunborn

Data: 24/11/2026 (UTC). Agente único. **Nenhum nascimento permanente foi executado; a produção está vazia e protegida.**

## 1. URLs e versões

| Ambiente | URL | Versão ativa | Estado |
|---|---|---|---|
| Produção | https://bunborn.devbarros.com | `8ffa74a1-5eaa-44c2-ae71-cdcf00fa33dc` (código `68e6b485`) | **Observatório público**; `state=null`; `BIRTH_ENABLED=false`; experimentos desativados |
| Homologação | https://bunborn-homologation.luiisaugustoobad.workers.dev | `67f1ff10-3f8d-42fe-bfc0-62bd30df17f8` (código `344e8231`) | Privada; criatura descartável; experimento de 24h ativo |

Os dois ambientes rodam o mesmo código-fonte testado. As versões finais incluem a configuração de secrets (cada `PUT` de secret gera uma versão nova). O código está no repositório https://github.com/labarro/Bunborn.

## 2. O que mudou nesta etapa

1. **Backup v2** corrigido nos sete pontos do handoff (ARCHITECTURE.md) e homologado com restauração real.
2. **Gateway fino + Durable Object** para respeitar os 10 ms de CPU do Worker Free.
3. **Orçamento**: reserva local antes da global (a homologação esgotada consumia a cota da produção).
4. **Motor**: resolução de entidades por UUID, id curto ou entityId (falha real vista nos ensaios); qualquer versão da obra comprova uma etapa; atividades concluídas durante ações administrativas passam a ser registradas; erros de ferramenta trazem detalhe factual; o piso de intervalo é informado à criatura.
5. **UI**: monitoramento com dados reais (limites do ambiente, uso compartilhado, Cron, experimento, armazenamento, ciclo); correção de layout.
6. **Observatório público em produção** (pedido do usuário): qualquer pessoa com o link observa tudo e pode deixar mensagens (≤ 500 caracteres, 3/h por IP, 30/h no total), registradas como `visitante`. Pausa, relógio, backup/restauração, recursos, verificação do motor e nascimento continuam exigindo a credencial do responsável. Cache de 30 s nas leituras públicas.
7. **Ferramentas operacionais**: métricas (CPU/D1), backup real, segurança remota, revisão visual, verificação com PC desligado, análise do experimento, secret scan.

## 3. Testes

- Locais: **45 unitários/integração** (17 novos) e **6 E2E** (Chromium + Worker + DO + D1, com observatório público). Todos aprovados.
- Remotos: **40/40** (produção pública para leitura e com 401 em toda a administração; homologação privada). Entre as verificações da primeira rodada (30/30) verificações de segurança/isolamento (`artifacts/remote-security.json`): 401 sem sessão ou com cookie forjado; 403 sem Origin ou com Origin estrangeira; cookie `HttpOnly; Secure; SameSite=Strict`; nenhum secret nos assets; CSP; produção vazia; preflight de nascimento recusado; experimentos, relógio, diagnóstico Gemini, ensaios, alvo de recuperação e restauração v1 recusados em produção; backup da homologação recusado na produção; manifesto adulterado ou com campo extra recusado; HTML em mensagem tratado como texto inerte; 3 ticks concorrentes → 0 chamadas extras.

## 4. Backup e restauração real

Homologação (criatura descartável nº 1) → `bunborn-recovery`, que estava vazio. 182.522 bytes, 16 segmentos assinados. 179 registros, 316 vínculos, 126 recuperações, 36 chamadas, 26 métricas. Export 9,6 s; restauração 11,4 s. **Digests de todos os segmentos, estado byte a byte, identidade, idade virtual (1.718,43 min), necessidades, 25 decisões, medidor (152.153 B / 179) e contagens por tipo: idênticos.** A primeira execução expôs uma reordenação de chaves do estado (conteúdo igual), corrigida antes da execução definitiva. Restauração em produção: nunca testada (proibido). D1 Time Travel: não executado.

## 5. Gemini: chamadas e tokens

Reservas incluem falhas; tokens são os reportados pela API e ficam desconhecidos (0) quando não há resposta.

| Contador (dia do Pacífico 2026-11-23) | Antes desta etapa | Ao iniciar o experimento |
|---|---|---|
| Global Lite | 29 reservas / 116.264 tokens | 29 / 116.264 |
| Global Flash | 9 / 18.761 | 9 / 18.761 |
| Homologação Lite / Flash | 28 / 111.589 · 8 / 15.772 | idem (preservados ao arquivar a criatura) |

Nesta etapa houve chamadas reais nos ensaios induzidos (TOOL_DB) e no experimento, incluindo **HTTP 503 reais ("This model is currently experiencing high demand")** em 3 ocasiões, todas registradas com backoff, sem retentativa silenciosa. Os números atualizados estão no Monitoramento e em `artifacts/experiment-analysis.json`; veja a seção 12 para os valores finais desta sessão.

## 6. CPU e limites Free

| Caminho | Antes | Agora |
|---|---|---|
| Cron do Worker | P99 13,7 ms (produção antiga, sem criatura) | P99 0,5–1,3 ms |
| HTTP do Worker | P99 12,5 ms; antigas até 96 ms | P99 4,7–7,1 ms, P99.9 8,8 ms |
| Durable Object | — | P99 26,9–41,8 ms; 0 erros, 0 `exceededCpu` em 255 invocações |

O Worker ficou dentro de 10 ms em todas as amostras observadas (o GraphQL é amostrado). O DO passou de 10 ms sem interrupção, mas a documentação oficial é ambígua sobre o limite de CPU do DO no plano Free: isso é **evidência empírica, não garantia** (ECONOMY.md). Workers Logs com CPU por rota não está disponível (403 no OAuth atual).

## 7. D1 e projeções de armazenamento

Medido: ~130 linhas escritas e ~315 lidas por decisão; ~6,0 KB lógicos e ~10,7 KB físicos por decisão; ~3 escritas/min com o Cron ocioso. Tamanhos atuais: produção 237.568 B; homologação ~254 KB (criatura nova); recuperação 491.520 B; tool-tests ~311 KB; budget 233.472 B. Projeções (ECONOMY.md): no ritmo máximo da produção (288/dia), o teto lógico de 180 MB chega em ~104 dias; a 96/dia, em ~312 dias; a 48/dia, depois de 1 ano (~187 MB físicos). Escritas D1 por conta no ritmo máximo da produção + homologação a 96/dia ≈ 59 mil/dia, abaixo das 100 mil. Ao atingir os tetos, a história é preservada e as operações são suspensas, nunca apagadas.

## 8. Ferramentas reais — cenários INDUZIDOS (`bunborn-tool-tests`)

| Cenário | Resultado |
|---|---|
| Pesquisa | Wikipedia "água": 3 fontes reais gravadas + conceito |
| Criação | Projeto `ensaio` + poema + desenho em pixels (a falha do handoff não se repetiu) |
| Música/objeto | 503 → `projeto_inexistente` (bug do motor com UUID) → corrigido → música e objeto criados |
| Leitura | `obra_inexistente` (mesmo bug) → corrigido → leitura do poema persistido |
| Revisão | Versão 2 do mesmo poema |
| Habitat | Planta movida; desenho exposto no ateliê |
| Conclusão | 503 → projeto `ensaio` v2 concluído citando a obra |
| Memória + mensagem | 503 → memória autobiográfica aceita + mensagem declarando o teste |

São cenários **induzidos**: provam as ferramentas com respostas reais do modelo, não interesses nem preferências.

## 9. Cognição real e o experimento autônomo de 24h

- **Criatura descartável nº 1** (25 decisões reais, relógio acelerado em passos controlados, 23:39–00:04Z de 23/11): manutenção física, organização, descanso, diário e reflexão repetida sobre a natureza simulada. Nenhum nome, interesse, pesquisa, projeto ou obra. Arquivada em `bunborn-recovery`. Seu registro de nascimento foi gravado por um código anterior com o texto "existência principal"; o histórico imutável não foi reescrito.
- **Criatura descartável nº 2**: nascida em 2026-11-24 00:35:04Z. Experimento **autônomo em tempo real** de 00:35:05Z até **2026-11-25 00:35:05Z**, teto de 110 chamadas, piso de 15 min, sem navegador nem processo local. O Cron da Cloudflare encerra e pausa sozinho no prazo ou no teto.
- **Influência do observador, declarada**: uma mensagem de teste de segurança (`<img …> teste de segurança (homologação)`) foi enfileirada às 00:36Z e consumida na 2ª decisão. Nenhuma outra mensagem ou direção.
- Primeiras decisões observadas: explorar e organizar o ambiente; comer e agendar beber na fila nova (uso real da fila); uma memória rejeitada por evidência inexistente.
- **Nada sobre personalidade ou interesses emergentes pode ser concluído ainda.** Ao fim das 24h, rode `node scripts/analyze-experiment.mjs` (repetição, ferramentas, rejeições, nome/interesses/projetos/obras, pesquisas, mensagens, intervalos, chamadas e tokens).

## 10. Funcionamento com o computador desligado

**Ainda não comprovado.** O Cron rodou em todos os minutos observados (heartbeats contínuos), mas isso aconteceu com o PC ligado. Procedimento pronto (README): desligue ou suspenda o PC por ≥ 1 h durante o experimento e depois rode `node scripts/verify-offline-window.mjs --windows-log homologation`. O script cruza a janela registrada pelo Windows com decisões, chamadas, ciclos e Cron registrados pela Cloudflare.

## 11. Capturas

`artifacts/visual/` (URLs reais, 24/11/2026): `production-{desktop,mobile}-{public,empty-authenticated}.png`, `homologation-desktop-{habitat,intencoes,linhadotempo,memorias,personalidade,acervo,monitoramento}.png`, `homologation-mobile-{habitat,linhadotempo,monitoramento}.png`. Sem erros de console e sem overflow. O Monitoramento e o layout foram corrigidos depois dessas capturas (redeploy seguinte); `artifacts/habitat-*.png` são fixtures locais do E2E.

## 12. Fechamento desta sessão

Retrato em 2026-11-24 01:07Z (0,53 h de experimento):

- Experimento: ativo, 3 decisões autônomas (todas Lite), intervalos de 15–16 min reais (a própria criatura pediu 15), 0 falhas, 3 atividades concluídas pelo motor, 1 memória rejeitada por evidência inexistente, sem nome, interesses, pesquisa, projeto ou obra até aqui. Intenções: explorar/organizar → comer e beber (fila) → explorar após saciar. Nenhuma conclusão sobre emergência.
- Gemini, dia do Pacífico 2026-11-23 (vira às 08:00 UTC): **global Lite 46 reservas / 188.149 tokens reportados; Flash 9 / 18.761**. Homologação local Lite 31 / 123.967; Flash 8 / 15.772. A diferença (Lite 15) veio dos ensaios induzidos no TOOL_DB, incluindo 4 reservas que terminaram em HTTP 503, sem tokens. Experimento: 3 sucessos / 12.378 tokens.
- Ensaios induzidos: 8/8 cenários com sucesso depois da correção do motor (e de retentativas pós-503).
- Versões finais da CPU: homologação Cron P99 1,2 ms / HTTP P99 3,1 ms; produção Cron P99 1,4 ms / HTTP P99 1,4 ms; DO P99 33,8 ms; duração do DO ≈ 72 GB-s em 2 h.

## 13. Limitações

Emergência não demonstrada; cotas Gemini reais não comprovadas por endpoint (tetos baseados no que o usuário informou); 503 do Gemini acontece; o limite de CPU do DO no Free é ambíguo na documentação; o GraphQL é amostrado; o armazenamento é finito; não há SLA; o backup v2 depende do `SESSION_SECRET`; a verificação com o PC desligado está pendente; a análise das 24h fica pendente até 25/11 00:35Z.

## 14. Nascimento e abertura ao público

O usuário fez o nascimento da criatura permanente em **2026-11-24 01:13:21Z**, pela cerimônia (desafio de uso único + frase de confirmação). Primeira decisão real: "Explorar o ambiente físico e compreender a disposição dos objetos ao meu redor". `BIRTH_ENABLED` foi fechado logo depois. A produção é um observatório público.

## 16. Depois do nascimento: o que a criatura fez sozinha

- **Nome escolhido espontaneamente: "Lumi"** (3ª decisão, 01:45Z, ~32 min depois do nascimento), com evidência de um registro próprio. Nenhum nome foi sugerido; a única mensagem recebida antes foi um "oi" de visitante.
- Uma decisão foi perdida às 01:39Z por uma ação malformada (`evidence` vazio). Corrigido com validação por ação.

## 17. Para visitantes (24/11)

Abas **Destaques** e **Diário de bordo** (sem IA, só registros), linha do tempo do mais recente para o mais antigo, contador anônimo de visitantes do dia, prévia de compartilhamento (`public/og-image.png`, Open Graph/Twitter). Produção liberada para usar todo o teto global de IA (440/16).

## 15. Interface depois do nascimento

- Coelho articulado e animado: respiração, piscadas, orelhas, pulos com amassa e estica virando para a direção do movimento, e poses para comer, beber, higiene, dormir (com "z"), pesquisar, criar, diário, organizar e observar. O deslocamento acontece somente quando há ação real registrada. `prefers-reduced-motion` é respeitado.
- Expressão derivada exclusivamente do estado simulado (`shared/expression.ts`: sono/energia, sede, fome, frustração, satisfação+conforto, curiosidade, tédio), exibida com o motivo factual. Não é sentimento declarado pelo modelo.
- "Entenda este registro" substitui "Origem e evidências": explica em linguagem simples quem registrou, o que ela pensou e por quê, o que tentou, o que falhou e por quê, a certeza declarada e em quantas lembranças se baseou. IDs e JSON ficam em "Detalhes técnicos".

## 18. Arquitetura multiprovedor (25/11)

Os detalhes estão em [AI_PROVIDERS.md](AI_PROVIDERS.md), [COGNITIVE_ROUTING.md](COGNITIVE_ROUTING.md) e [MODEL_BENCHMARKS.md](MODEL_BENCHMARKS.md).

**Diagnóstico e impacto**
1. **Erros 503:** 38 das 145 chamadas de produção (26%), todas no Gemini, concentradas entre 11 e 16h UTC. Também houve 16 falhas de execução (timeout e resposta fora do esquema).
2. **Impacto na criatura:**
   - janelas sem cognição de 10,7 h (24/11, agravada pela espera exponencial já corrigida), 3,8 h ou mais (25/11) e outras 8 curtas;
   - o corpo seguiu as regras durante as quedas;
   - 27,6 mil tokens (4,5%) gastos em respostas inválidas;
   - não houve loops.

**Provedores e modelos**
3. **Integrados:** Gemini, Groq e NVIDIA. A NVIDIA também está em produção, por autorização explícita do responsável, apesar dos termos de trial.
4. **Disponíveis na chave:** Gemini 49, Groq 11 (3 modelos de texto gratuitos), NVIDIA 30 (`artifacts/ai-discovery.json`).
5. **Avaliados:**
   - Gemini: 3.1 Flash Lite, 3 Flash e 3.5 Flash Lite.
   - Groq: gpt-oss-120b, gpt-oss-20b e Qwen 3.8 27B.
   - NVIDIA: Kimi K3.1 Pro, Nemotron 3 Ultra, Mistral Large 4, MiniMax M3.1, Step 5 e Nemotron 3.5 Lightning.
6. **Descartados:**
   - Kimi, Mistral e Step: timeout em 18 de 18;
   - Nemotron Lightning: formato válido em só 47%;
   - GLM 5.3 e Gemma 4: lentos demais;
   - safeguard e allam: classificador e janela de 4 mil tokens.

**Cotas e benchmark**
7. **Cotas:**
   - Groq (documentado): 30 RPM, 1K RPD, 8K TPM e 200K TPD por modelo.
   - Gemini (painel do responsável): Flash Lite 15/500, Flash 5/20.
   - NVIDIA: cerca de 40 RPM, sem limite diário publicado.
8. **Benchmark:** 9 cenários, 2 repetições, chamadas reais pelo motor real (matriz em MODEL_BENCHMARKS.md). O benchmark encontrou e corrigiu um defeito no contrato das ferramentas: as alternativas apareciam como listas.
9. **Melhor modelo por categoria:**
   - cotidiana: gpt-oss-120b;
   - complexa: Qwen 3.8, ou Nemotron Ultra se a latência não pesar;
   - memória: Qwen, gpt-oss-120b ou Nemotron;
   - pesquisa: nenhum homologado (Gemini Lite provisório e regra de segurança);
   - criatividade: Qwen, gpt-oss-20b ou MiniMax;
   - comunicação: Qwen.

**Roteamento e resiliência**
10. **Roteamento determinístico por categoria:** 0,55 de qualidade, 0,25 de confiabilidade, 0,10 de velocidade e 0,10 de folga de cota, menos penalidades.
11. **Critérios:** exclusões com motivo, afinidade de continuidade e modo manual.
12. **Fallback:** até 3 tentativas por ciclo, nenhum efeito antes de uma resposta válida, alternativa geral depois de falhas na categoria e suspensão segura quando tudo falha.
13. **Circuit breaker** persistente (`model_health`), com espera crescente, jitter, `Retry-After`, desabilitação por credencial e reintegração gradual.

**Consumo e capacidade**
14. **Tokens:** cerca de 3,5 mil por decisão no benchmark; cerca de 7,9 mil na Lumi, que tem um contexto maior. O contexto foi compactado em 25/11.
15. **Capacidade diária por provedor:**
   - Groq: cerca de 55 por modelo (cerca de 160 somados), limitados pelos tokens por dia; em contextos maiores, cai.
   - Gemini: até 440 + 16, quando disponível.
   - NVIDIA: limite interno de 300 por modelo.
16. **Capacidade combinada:** bem acima do ritmo de produção (no máximo 288 decisões por dia, a cada 5 min).

**Testes e evidências**
17. **Testes reais:**
   - descoberta e teste rápido de 14 modelos;
   - benchmark;
   - homologação ponta a ponta: 15 decisões em 16 ciclos com 5 modelos de 2 provedores, porque o Gemini ficou fora durante todo o teste.
18. **Testes de falhas:** 15 testes de roteamento e resiliência com falhas simuladas, mais E2E da área administrativa.
19. **Continuidade:** na homologação, o Nemotron (NVIDIA) respondeu ao observador às 17:52, e o Qwen (Groq) respondeu à pergunta "lembra do que me contou?" às 17:57 retomando os mesmos fatos. A identidade ficou sem mudanças.
20. **Monitoramento:** aba Provedores (só para o responsável) e o modelo de cada decisão nos detalhes técnicos da linha do tempo.

**Implantação**
21. Produção e homologação implantadas.
   - Migração aditiva 0010 aplicada nos 5 bancos, depois de um **backup assinado da produção** (`.wrangler/private/backups/production-b989f1dc….backup.json`).
   - Os secrets agora são gravados antes do código no deploy.
22. **Criatura permanente preservada.** Nada foi resetado nem restaurado. A Lumi voltou a decidir às 18:03Z (Nemotron Ultra, depois de o MiniMax responder 503), comeu (fome 100 → 0) e às 18:10Z decidiu dormir.

**Limitações e custo**
23. **Limitações:**
   - duas repetições por cenário;
   - pesquisa sem modelo homologado;
   - o contexto da Lumi (cerca de 7,9 mil tokens) chega perto do limite de 8 mil tokens por minuto da Groq; o roteador exclui a Groq quando não cabe e mostra o motivo;
   - os modelos da NVIDIA são lentos (10 a 45 s);
   - a NVIDIA em produção contraria os termos de trial (risco assumido pelo responsável).
24. **Custo zero:** contas sem faturamento vinculado (confirmação explícita do responsável); nenhum serviço pago contratado; bundle do Worker com 179 KiB comprimidos; ritmo de decisões sem aumento.

## 19. Auditoria cognitiva (25/11, noite)

Relatório completo, com evidências, métodos e limitações: [COGNITIVE_AUDIT.md](COGNITIVE_AUDIT.md).

**Causas encontradas:**
- 85% das memórias eram ecos automáticos do último ciclo, devolvidos como "memórias relevantes".
- O que ela pesquisava não voltava como conhecimento.
- O corpo chegava como percentuais e limiares, e o prompt tratava as barras como objetivo.
- As instruções de nascimento iam em todo ciclo.
- A estimativa de tokens errava a ponto de gerar 413 na Groq.

**O que mudou:**
- **Prompt em módulos:** o nascimento só vai na decisão 0.
- **Sensações em vez de números,** com a faixa baixa recalibrada depois de uma regressão medida.
- **Contexto em ordem de vida,** com `thread` (as últimas decisões e o resultado de cada ação) e `knowledge` (pesquisas).
- **Memória sem eco e com variedade.**
- **Orçamento:** estimativa por família de modelo, saída por categoria e por tipo de modelo, liquidação segura, reconciliação de órfãs, Retry-After em data HTTP e redação de identificadores de conta.

**Evidência** (benchmark com chamadas reais, anterior × nova):
- decisões justificadas com números de necessidade: 22% → 0%;
- decisões em que a necessidade aparece: 51% → 21%;
- coerência igual (≈0,97);
- iniciativa maior na NVIDIA;
- tokens −4% a −25%.

Na homologação ponta a ponta: 14 de 14 decisões, diário reflexivo, obra nova, projeto seguido por vários ciclos e resposta com continuidade ao observador.

**Implantação:** em 25/11 às 23:10Z, depois do backup assinado `production-45e088e1…`. Não houve migração, e nenhum registro foi alterado.
