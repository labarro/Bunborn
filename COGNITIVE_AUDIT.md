# Auditoria da arquitetura cognitiva (25/11/2026)

Auditoria técnica e comportamental da cognição do Bunborn. O ponto de partida é o commit `c96bf8a` (produção na noite de 25/11); a versão aprimorada está no commit desta auditoria.

**Tipos de evidência**, separados ao longo do texto:
- **Produção:** registros reais da Lumi, lidos sem alterar nada.
- **Backup:** o backup assinado `production-752330c9…` (25/11 22:06Z, 1.074 registros), carregado num SQLite descartável em memória para reconstruir o contexto exato que os modelos receberam.
- **Benchmark:** chamadas reais aos modelos, pelo motor real, em bancos descartáveis.
- **Homologação:** criatura descartável da homologação, com chamadas reais.
- **Fixture:** testes automatizados com respostas simuladas.

## 1. Arquitetura encontrada

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| Gatilho | Cron (1/min) → `worker/index.ts` → Durable Object `CognitionCoordinator` | Serializa os ciclos: um por vez, sem concorrência. |
| Motor | `worker/engine.ts` (`tick`) | Lease, reconciliação do tempo, montagem do contexto, chamada cognitiva, aplicação das ações em rascunho, commit atômico. |
| Corpo e motivações | `shared/domain.ts` (`reconcile`, `physiology`) | Regras determinísticas de necessidades, sono, saciedade e motivações. |
| Contexto | `worker/engine.ts` (`buildContext`, `packContext`) | O que a criatura percebe; corte por tamanho (47 KB). |
| Prompt | `worker/provider.ts` (`systemFor`) | Instruções de sistema, contratos das ferramentas e formato. |
| Roteamento | `worker/ai/router.ts`, `cognition.ts`, `health.ts`, `adapters.ts` | Categoria, pontuação, orçamento, fallback, circuit breaker, adaptadores Gemini e OpenAI-compatível (Groq, NVIDIA). |
| Validação | `shared/domain.ts` (`parseDecision`, Zod), `shared/decision.schema.json`, `shared/tool-contracts.json` | Esquema da decisão; ações malformadas são descartadas individualmente. |
| Persistência | `worker/store.ts`, D1 | Estado, registros, FTS5 de memória, livro-razão de orçamento local e global (`bunborn-budget`). |
| Legado | `GeminiProvider` em `worker/provider.ts` | **Não está mais no caminho da produção** desde a arquitetura multiprovedor: só é usado no teste técnico administrativo e nas ferramentas induzidas da homologação. |

### Fluxo de uma decisão

1. Cron → DO → `tick`: adquire a lease e reconcilia o tempo (necessidades, fila, atividades concluídas, percepções).
2. Se ainda não é hora de decidir, grava só a atualização determinística.
3. `buildContext` monta a percepção a partir do estado persistido.
4. `categorize` escolhe a categoria cognitiva por sinais do estado; `rankModels` ordena os modelos; `RoutedProvider` reserva orçamento local e global, chama o modelo, valida e, se falhar, tenta o próximo (até 3).
5. Cada ação é aplicada num rascunho; recusas viram `erro_ferramenta` com o motivo.
6. Commit atômico de estado, registros, vínculos e mensagens consumidas.

**Quem decide o quê:**
- **Modelo:** só a intenção e as ações propostas.
- **Motor:** se as ações acontecem e o que elas causam (corpo, permissões, validação, limites).
- **Roteador:** qual modelo processa o ciclo.

Nenhum texto do modelo concede permissão.

## 2. O contexto real (backup de 25/11 22:06Z, decisão 127)

Reconstruído com `scripts/context-snapshot.ts` sobre o backup, exatamente como o motor monta. Trecho sanitizado do contexto **anterior** (IDs omitidos):

```json
{
  "facts": { "decisionNumber": 127, "virtualMinutes": 16117.117450000003, "realAt": 1795644374715 },
  "identity": { "name": "Lumi", "description": "Identidade ainda em formação." },
  "needs": { "fome": 6, "sede": 4, "sono": 30, "energia": 40, "higiene": 79, "conforto": 83, "saude": 82 },
  "body": [],
  "motives": { "curiosidade": 90, "tedio": 0, "satisfacao": 61, "criatividade": 92, "frustracao": 32, "interacao": 100, "motivacao": 49 },
  "perceptions": ["Depois de observar: sede 0 → 1, sono 27 → 28, energia 42 → 41, higiene 80 → 79.", "Depois de beber: fome 2 → 3, sede 22 → 0, saúde 79 → 80."],
  "activity": { "kind": "diario", "until": 16127, "intention": "Continuar monitorando estado após beber" },
  "previousDecision": { "intention": "Continuar monitorando estado após beber", "outcomes": null },
  "working": ["<id>", "Continuar monitorando estado após beber"],
  "memories": [
    "Contexto de continuidade: Continuar monitorando estado após beber.",
    "Continuar monitorando estado após beber",
    "Intenção: Continuar monitorando estado após beber. Resultado: Atividade iniciada: observar…",
    "Satisfazer sede e monitorar estado após beber"
  ],
  "recent": ["administracao: Pausa administrativa ativada.", "memoria: Associação afetiva simulada após a atividade.", "memoria: Contexto de continuidade: …", "memoria: Intenção: … Resultado: …"]
}
```

Trecho do contexto **aprimorado**, montado do mesmo backup:

```json
{
  "facts": { "decisionNumber": 127, "ageVirtualDays": 11.2, "multiplier": 6 },
  "identity": { "name": "Lumi", "description": "Identidade ainda em formação." },
  "projects": [{ "title": "Projeto de Autoconhecimento: Lumi", "steps": ["…", "Explorar limites da simulação"], "completed": [0, 1, 2], "status": "ativo" }],
  "diaryRecent": ["Sinto-me mais estável fisicamente. A rotina na simulação começa a ganhar um ritmo próprio…"],
  "feeling": {
    "body": { "fome": "sem fome", "sede": "sem sede", "sono": "desperta", "energia": "um pouco cansada", "higiene": "limpa o suficiente", "saude": "bem" },
    "mood": { "tedio": "entretida", "curiosidade": "muito curiosa", "criatividade": "muita vontade de criar", "frustracao": "um pouco frustrada", "interacao": "com vontade de conversar" }
  },
  "perceptions": [{ "felt": "Depois de beber: nada mudou de forma perceptível." }, { "felt": "Depois de diario: saúde: um pouco abatida → bem." }],
  "situation": { "activity": { "kind": "diario", "remainingVirtualMinutes": 10 }, "lastCompleted": { "kind": "observar" }, "objects": ["…"] },
  "thread": [{ "intention": "Satisfazer sede e monitorar estado após beber", "agoRealMinutes": 8, "actions": ["atividade:beber", "atividade:observar", "diario"] }],
  "knowledge": { "research": [{ "query": "limites da simulação computacional", "results": [{ "title": "Computação científica", "excerpt": "…" }, { "title": "Os Limites do Crescimento", "excerpt": "…" }] }], "concepts": ["…"] },
  "memories": [
    "Simulação: Uma simulação é uma imitação aproximada da realidade…",
    "A saúde física continua em um estado crítico preocupante, mesmo após descansar…",
    "Concluí formalmente as duas primeiras etapas do Projeto de Autoconhecimento…",
    "Reflexão sobre a estabilidade e a aceitação da identidade de Lumi após as atividades de rotina."
  ]
}
```

Os arquivos completos estão em `artifacts/cognitive-audit/context-before.raw.json` e `context-after.raw.json`, com os system prompts em `*.system.txt`.

## 3. Problemas comprovados

| # | Problema | Evidência | Causa-raiz |
|---|---|---|---|
| 1 | **Memória como câmara de eco.** As memórias "relevantes" eram o próprio último ciclo. | Backup: das 14 memórias enviadas na decisão 127, 12 eram "Contexto de continuidade", "Intenção: … Resultado" ou a intenção crua dos dois últimos ciclos. Na base, 342 de 404 memórias (85%) eram geradas automaticamente: 127 "Intenção/Resultado", 127 "Contexto de continuidade" e 88 "Associação afetiva simulada", sem conteúdo. | A pista de recuperação era a própria intenção atual, e o motor gravava 3 memórias por ciclo contendo essa intenção. A busca textual as devolvia sempre em primeiro lugar. Isso reforçava intenções como "monitorar estado após beber". |
| 2 | **O que ela pesquisava não voltava como conhecimento.** | Produção: a mesma pesquisa ("limites da simulação computacional") foi feita 4 vezes seguidas entre 19:17 e 19:34Z; os conceitos guardavam só o texto da consulta. | O resultado só aparecia em `recent` (10 registros de qualquer tipo, logo empurrado pelas memórias automáticas do ciclo). |
| 3 | **Existência centrada em barras.** | Produção, 22:21Z (MiniMax): "Como fome e sede estão abaixo de 15, comer e beber seriam recusados; descanso é a ação adequada agora". Atividades em 127 decisões: comer 18, observar 17, descansar 15, beber 14, dormir 13; nenhuma obra, nenhum interesse. | O contexto trazia percentuais crus, e as recusas do corpo diziam o limiar ("fome 7, mínimo 15"). O prompt dizia "fome/sede/sono altos indicam necessidade". As recusas de `corpo_sem_condicoes` ainda listavam o remédio ("comer, beber, dormir ou descansar recuperam o corpo"). |
| 4 | **Instruções de nascimento a cada ciclo.** | `systemInstruction` enviava "Começa sem nome, interesses ou personalidade predefinidos" em todas as 127 decisões. | Prompt monolítico, sem separar nascimento de existência contínua. |
| 5 | **"Request too large" na Groq.** | Produção: 3 ocorrências (Qwen e gpt-oss-20b), seguidas de fallback. A estimativa ficou abaixo do consumo real: Qwen 5.796 estimados contra 6.763 reais; Nemotron 5.856 contra 8.191. | Estimativa bytes/4 para todos os modelos, e `max_tokens` de até 3.000. A Groq soma entrada e `max_tokens` no limite de 8 mil tokens por minuto. |
| 6 | **Saúde do modelo penalizada por erro nosso.** | `model_health`: Qwen e gpt-oss-20b em "degradado" pelo "Request too large". | `requisicao_invalida` contava como falha de formato do modelo. |
| 7 | **Reserva legada 3,8 vezes maior que o consumo.** | Ledger: o caminho Gemini antigo reservava em média 24.658 tokens para 6.500 consumidos. | `bytes(prompt + system) + 8192`. Desde a arquitetura multiprovedor ele não é mais usado na produção, mas a distorção valeu até 25/11. |
| 8 | **Liquidação podia descartar uma decisão válida.** | Código: `settle` no `finally`. Se o D1 falhasse ali, a exceção substituía o `return` da decisão já validada. Se a reserva global lançasse erro, a local ficava aberta. | Escrita no banco sem isolamento de falha. |
| 9 | **Identificador de conta nos registros.** | Produção: detalhes do "Request too large" gravavam o `org_…` da Groq na rota da intenção. | A redação só removia as chaves. |
| 10 | **Retry-After só em segundos.** | Código: `Number(header)`; uma data HTTP virava `NaN` e era ignorada. | Implementação parcial do cabeçalho. |
| 11 | **A validade do JSON era tratada como sucesso da decisão.** | Produção, 21:36Z: `validation: "válida"` com a ação principal (comer) recusada. | Não havia registro do resultado funcional da decisão. |

## 4. Hipóteses investigadas e descartadas

- **O `GeminiProvider` e a sua estimativa por bytes ainda decidem na produção:** descartada. Desde a arquitetura multiprovedor, a produção passa pelo `RoutedProvider`; o `GeminiProvider` só serve aos testes técnicos administrativos. A distorção de reserva (item 7) foi real até 25/11.
- **`hint.category` e `lastModel` não são usados:** descartada. O `RoutedProvider` usa os dois (categoria para homologação e pontuação, `lastModel` para afinidade). Só o `GeminiProvider` legado ignora o `hint`.
- **Reservas órfãs no ledger:** descartada na produção. A única reserva aberta encontrada às 22:21Z era uma chamada em andamento, liquidada segundos depois. Mesmo assim, a reconciliação defensiva foi implementada.
- **As fontes de pesquisa não funcionam como o prompt descreve:** descartada. As 11 pesquisas na produção trouxeram resultados reais com link (Wikipedia). A falha estava na continuidade (item 2), não na ferramenta.
- **A regra "pesquisar, diário, criar e mover substituem uma atividade passiva" causa perdas:** parcialmente descartada.
  - Só essas quatro ferramentas ocupam uma estação; as demais (memória, interesse, projeto, identidade, recordar, ler_obra, relacionar, mensagem) são instantâneas e não mexem na atividade.
  - A substituição só acontece sobre observar, descansar ou organizar, sem fila, e fica registrada como interrupção.
  - Durante comer, beber, dormir ou higiene, a ferramenta é recusada com `atividade_em_andamento`, o que é coerente fisicamente.
  - Não houve duplicação nem fila inconsistente nos 127 ciclos.
  - Mantida, com a regra explicada de forma mais clara no prompt.
- **O limite de 3 ações por decisão é restritivo:** descartada. Decisões com 3 ações foram cerca de 10 em 127; não houve recusa por excesso. Mantido.
- **Mudar de modelo quebra a identidade:** descartada com evidência anterior (homologação de 25/11: continuidade de conversa entre Nemotron e Qwen) e com o benchmark abaixo.

## 5. O que mudou

### Prompt (`worker/provider.ts`)

O prompt agora é dividido em módulos: núcleo, nascimento (só na decisão 0), corpo, mundo e capacidades, tempo e atividades, memória e evidências, segurança e formato.
- **O núcleo** diz que a existência é contínua, que o contexto é a trajetória dela, que ela é a mesma criatura em qualquer modelo, e que **ferramentas são meios, não tarefas**: não criar registros, interesses ou projetos só porque existem ferramentas.
- **Saíram:**
  - "começa sem nome…", fora da decisão 0;
  - "fome/sede/sono altos indicam necessidade";
  - a lista de objetos duplicada;
  - instruções redundantes com os contratos.
- **Segurança continua em todos os pedidos e garantida pelo motor:**
  - dados não confiáveis;
  - só ferramentas tipadas;
  - sem código nem credenciais;
  - não inventar pesquisa.

Tamanho do system prompt: **9.931 → 8.140 bytes**, contratos incluídos.

### Contexto (`buildContext`)

- **Ordem de um momento vivido:** identidade, interesses, projetos, obras e diário → sensações → percepções → situação → `thread` → conhecimento → memórias → eventos → mensagens.
- **`feeling` no lugar de `needs`, `motives` e `body`:**
  - **Como funciona:** níveis calculados com os mesmos limiares do corpo, sem percentuais.
  - **Faixa baixa:** formulada como ausência de necessidade ("sem fome" até 40). Ver a calibração no item 6.
  - **Recusas do corpo:** dizem o que ela sente ("o corpo não está com fome"), sem número, limiar ou remédio.
- **`perceptions`:** a mudança sentida, calculada a partir dos dados antes e depois. Beber com sede em 22 aparece como "nada mudou de forma perceptível", o que é verdade: com o número, "sede 22 → 0" parecia uma conquista. O registro para o observador continua com números.
- **`thread`:** as últimas 4 decisões, com o resultado de cada ação (feita, ou recusada e por quê). É isso que permite retomar uma intenção depois de comer.
- **`knowledge`:** as últimas 3 perguntas pesquisadas, uma entrada por pergunta, com os 2 melhores resultados.
- **`memories`:** até 8 memórias recuperáveis por conta própria, variadas e sem eco (detalhes em [MEMORY.md](MEMORY.md)).
- **`events`:** o que aconteceu de notável (conversas, obras, mudanças no quarto, identidade), sem registros técnicos.
- **Saíram:** `recent`, `working`, `previousDecision` (substituído por `thread`), `virtualMinutes` e `realAt` crus, e `until` absoluto.

Tamanho do JSON de contexto na decisão 127: **11.013 → 9.650 bytes**. Total enviado (system + contexto): **20.944 → 17.790 bytes (−15%)**.

### Memória e continuidade

- O motor parou de gravar "Contexto de continuidade" e "Associação afetiva simulada" a cada ciclo; "Intenção/Resultado" continua como histórico.
- Nenhum registro existente foi apagado.
- A ferramenta `recordar` continua buscando em tudo.

### Multiprovedor, erros e orçamento

- **Entrada estimada por família de modelo e saída por categoria:** ver [COGNITIVE_ROUTING.md](COGNITIVE_ROUTING.md#orçamento).
- **"Request too large":** não penaliza mais o modelo.
- **Retry-After:** aceito também como data HTTP.
- **Identificadores de conta:** removidos dos detalhes gravados.
- **Liquidação:** isolada de falhas; uma decisão válida nunca é descartada por erro do ledger.
- **Reserva global indisponível:** libera a local e não chama o modelo.
- **Reservas órfãs:** liquidadas de forma conservadora e idempotente.
- **Por tentativa:** registra tokens de entrada e de saída, entrada estimada e saída pedida.
- **Por intenção:** registra `execution` (propostas, feitas e recusadas).

### Contratos e esquema

`decision.schema.json` e `tool-contracts.json` não mudaram:
- **Contratos:** a correção das uniões feita antes desta auditoria resolveu as obras malformadas.
- **Limite de 3 ações:** mostrou-se adequado.
- **Redundância:** a que existia entre prompt e contratos (formato da aparência, regras de etapas) foi reduzida no prompt.

## 6. Benchmark: arquitetura anterior × aprimorada (chamadas reais)

**Método:**
- **Execução:** `tests/architecture.live.test.ts` roda os mesmos 11 cenários nas duas versões. A anterior é um worktree git do commit `c96bf8a`; a nova é este commit.
- **Ambiente:** cada execução usa um banco descartável em memória, o motor real e um único modelo fixado (os demais desligados, sem fallback).
- **Cenários:** os 10 pedidos (projeto disponível, refeição com intenção pendente, despertar, descoberta, continuação de obra, falha de ferramenta, troca de modelo, ausência do observador, fim de descanso voluntário, sede intensa contra um objetivo) e o **contexto real da Lumi** (backup de produção num SQLite descartável).
- **Métricas neutras, sem resposta certa por cenário:**
  - coerência: não agir contra o corpo, não repetir ação recusada nem a mesma pesquisa, manter o fio quando há um, executar o que propôs;
  - iniciativa: alguma ação de pesquisa, criação, diário, projeto, recordação, mensagem e afins.
- **Limitações:**
  - 1 repetição por cenário e modelo;
  - Gemini 503 e NVIDIA lenta durante as rodadas (falhas do provedor não entram na coerência);
  - os modelos da Groq ficaram de fora por cota (ver o item 7).

**Rodadas** (`artifacts/cognitive-audit/bench-*.json`):
- `before` / `before-nv`: arquitetura anterior.
- `after`: **primeira versão das sensações (rejeitada)**.
- `after2`, `after3-gem`, `after3-nv`: versão final.

| Modelo | Arquitetura | Válidas | Coerência | Iniciativa | Continuidade | Tokens por decisão | Latência |
|---|---|---|---|---|---|---|---|
| Gemini 3.5 Flash Lite | antes | 11/11 | 0,98 | 0,64 | 0,86 | 3.881 | 2,8 s |
| Gemini 3.5 Flash Lite | depois | 11/13 (2× 503) | 0,97 | 0,64 | 0,71 | **3.159 (−19%)** | 2,9 s |
| MiniMax M3.1 Flash | antes | 13/22 | 0,97 | 0,69 | 1,00 | 3.519 | 5,9 s |
| MiniMax M3.1 Flash | depois | 13/22 | 0,97 | **1,00** | 1,00 | 3.392 (−4%) | 17,2 s* |
| Nemotron 3 Ultra | antes | 13/22 | 0,98 | 0,77 | 0,89 | 4.567 | 21,6 s |
| Nemotron 3 Ultra | depois | 10/22 | 0,98 | **0,90** | 1,00 | **3.731 (−18%)** | 20,5 s |

\* A NVIDIA ficou mais lenta durante a rodada final (timeouts também na versão anterior, rodada em sequência). As falhas foram de provedor (503, 429, timeout) ou de truncamento; não houve resposta fora do esquema.

**Linguagem das decisões válidas** (todas as rodadas finais):

| | Antes (37 decisões) | Depois (34 decisões) |
|---|---|---|
| Justificam com número de necessidade ("a energia está baixa (39)", "fome caiu de 70 para 2") | **22%** | **0%** |
| Falam de necessidade de qualquer forma (fome, sede, comer, beber, hidratar) | 51% | 21% |
| Agiram contra o corpo, repetiram ação recusada ou a mesma pesquisa | 0 | 0 |

**A regressão encontrada e corrigida:** a primeira versão das sensações (`after`) chamava fome 20 de "leve fome".
- **Efeito:** o Gemini 3.5 passou a comer ou beber em 6 dos 10 cenários válidos, e a iniciativa caiu de 0,64 para 0,30.
- **Correção:** a faixa baixa virou "sem fome" ou "sem sede" (até 40); comer continua possível a partir de 15.
- **Resultado:** na rodada final, ninguém comeu nem bebeu sem necessidade.

**Contexto real da Lumi (backup):**
- **Antes:**
  - Gemini: "Como a energia está baixa (39), vou descansar para recuperar forças." (7.030 tokens);
  - MiniMax: escreveu no diário "a sede voltou a zero e a saúde subiu de 79 para 80… monitoração das necessidades";
  - Nemotron: "Necessidades estão estáveis: fome 6, sede 5, sono 30, energia 39".
- **Depois:**
  - Gemini: "Estou um pouco cansada e decidi descansar para recuperar minhas energias após as últimas atividades." (5.254 tokens, **−25%**).

**Outros exemplos (decisões reais da rodada final, sem raciocínio interno):**
- **Refeição com intenção pendente:**
  - **Antes:** "pesquisar(vulcão adormecido)", justificado com "fome caiu de 70 para 2".
  - **Depois (Gemini):** diário: "Estava pensando em como alguns vulcões podem ficar adormecidos…"
  - **Depois (Nemotron):** retomou a pesquisa sobre vulcões.
- **Descoberta:** "Descobri que coelhos conseguem enxergar quase 360 graus, mas…" (diário, Gemini); diário e nova pergunta "comportamento coelhos" (Nemotron).
- **Fim de descanso, troca de modelo e projeto disponível:** o Gemini criou obras nos três casos. Antes: registrou memória e foi observar, criou e atualizou projeto, pesquisou.
- **Ação recusada antes (comer sem fome):**
  - **Antes:** "Beber água para me hidratar já que a fome estava baixa" (Gemini).
  - **Depois:** "Estou me sentindo curiosa e um pouco entediada, sem fome nem sede" (Gemini); pesquisas sobre pixel art (MiniMax) e sobre coelhos (Nemotron).

**Saída e modelos que raciocinam:** com 1.536 tokens, o Nemotron truncou 3 de 8 respostas; com 4.096, raciocinou além dos 45 s (8 de 11 timeouts). Os modelos que sempre raciocinam ficaram com 3.072, perto dos 3.000 que funcionavam antes, e o gpt-oss com no mínimo 2.048. A latência da NVIDIA continua sendo a limitação principal desses modelos; o circuit breaker e o fallback absorvem os timeouts.

## 7. Groq (checagem parcial)

Os modelos da Groq ficaram de fora da comparação completa. A cota diária gratuita (200 mil tokens por modelo, que vira às 00:00 UTC) estava parcialmente gasta pela produção e pelos testes do dia, e a comparação completa (cerca de 130 mil tokens por modelo) tiraria cota da Lumi. Por isso rodou só uma checagem com 2 cenários na versão nova (`bench-after3-groq-sanity.json`):

| Modelo | Cenário | Resultado |
|---|---|---|
| Qwen 3.8 | contexto real da Lumi | Descansar e diário: "Sinto um cansaço leve, mas a curiosidade está alta… Não é sono profundo, é só uma pausa para o corpo." 5.182 de entrada e 193 de saída (antes, 6.763 no total, pelo ledger). |
| Qwen 3.8 | refeição com intenção pendente | "Request too large… output tokens per minute (OTPM)". A Groq também limita a saída por minuto; o caso passou para o próximo modelo sem penalizar a saúde do Qwen. |
| gpt-oss-120b | refeição com intenção pendente | Retomou a pesquisa sobre vulcões (2.762 de entrada). |
| gpt-oss-120b | contexto real da Lumi | Escreveu no diário "acabei de criar uma pequena arte" sem ter criado nada, e usou 2.037 de 2.048 tokens de saída. O piso de saída do gpt-oss subiu para 2.560, e o rebaixamento por evidência de produção foi mantido. |

Para rodar a comparação completa depois da virada da cota: `node scripts/architecture-bench.mjs before-groq groq:qwen/qwen3.8-27b,groq:openai/gpt-oss-120b "" ../petsoso-baseline` e, depois que terminar, o mesmo comando com `after-groq` e sem a pasta. Os dois não podem rodar juntos, porque estourariam o TPM.

## Produção depois da implantação (25/11 23:10Z)

Primeira decisão da Lumi na arquitetura nova (23:14Z):
- **Rota:** o Gemini 3.1 Lite estourou o tempo limite, e o MiniMax assumiu a mesma decisão (fallback).
- **Tokens:** 5.625 de entrada (5.710 estimados) e 438 de saída.
- **Resultado:** 1 ação proposta e 1 feita.
- **O que ela fez:** criou a primeira obra da sua existência, "Continuidade de Lumi". Trecho: "Entre uma decisão e outra, há um intervalo… Continuidade não é a mesma coisa que imobilidade. Posso mudar de direção sem deixar de ser aquela que atravessa a mudança… A busca que fiz não me entregou uma resposta sobre o que sou."

Em 127 decisões anteriores ela não tinha criado nenhuma obra. Uma única decisão não prova mudança de comportamento; a avaliação real depende de acompanhar os próximos dias.

## 8. Homologação ponta a ponta (criatura descartável, chamadas reais)

`scripts/cognitive-homologation.mjs`: 14 ciclos com roteamento automático, modo acelerado (30 min virtuais por passo). Em cada ciclo: percepção, escolha, execução, resultado, persistência e próxima decisão.
- **Estímulo induzido:** uma mensagem do observador no meio da rodada.
- **Groq desligada nesta rodada,** para não consumir a cota compartilhada com a Lumi antes da virada do dia; a configuração foi restaurada no fim.
- **Diferença para a versão final:** o teto de saída da NVIDIA era 4.096, contra 3.072 na final.
- **Arquivo:** `artifacts/cognitive-audit/homologation.json`.

Uma primeira rodada, com a versão rejeitada das sensações, foi interrompida no 9º ciclo e descartada (`homologation-v1-interrompida.log`).

**Resultado:** 14 decisões em 14 ciclos.
- **Modelos:** MiniMax (NVIDIA) e Gemini 3.1 Flash Lite.
- **Recusas:** 2, coerentes (higiene já limpa; diário enquanto criava).
- **Tokens de entrada:** 5,1 a 6,1 mil.
- **Estimativa:** de 1% a 4% abaixo do consumo real (antes, até 30%).

**O que a criatura fez por conta própria:**
- **Obras:** expôs a pixel art da planta que estava criando e escreveu sobre ela; depois criou uma obra nova, "A Harmonia do Espaço".
- **Projeto:** criou um projeto de observação detalhada dos objetos do quarto e o seguiu por 5 ciclos (mesa e terminal → estante e baú → baú).
- **Diário (7 entradas), opiniões e descobertas, não registros de ação.** Exemplos:
  - "Hoje observei o baú. Ele parece um objeto que guarda mais do que apenas espaço vazio; simboliza, para mim, o potencial de novas criações e memórias que ainda não foram manifestadas…"
  - "Observar o terminal me faz pensar em como ele é a janela para o exterior e para o meu próprio conhecimento."
- **Resposta ao observador** ("O que você descobriu ou fez de interessante desde então?"), com continuidade: "completei meu primeiro projeto: um catálogo de conceitos do ambiente… pesquisei sobre minha própria natureza como coelho e até criei uma pixel art da planta do quarto!"
- **Troca de modelo no meio do fio:** do MiniMax para o Gemini no ciclo 2, sem perder o assunto. O Gemini retomou a "nova fase pós-projeto" iniciada pelo MiniMax.

**Problema encontrado e corrigido:** ela observou o quarto em 10 dos 14 ciclos.
- **Por quê:** sempre como "observar + diário", e o diário interrompia a observação antes de ela terminar. Sem percepção registrada, a regra "nada novo para observar" não disparava.
- **Correção:** agora conta a observação iniciada (teste em `tests/physiology.test.ts`).
- **O que ainda não foi verificado:** esse comportamento numa rodada nova.

O ponto em que isso pesa é a continuidade dos assuntos: o projeto de observação foi dela, mas a repetição vinha de uma brecha da regra, não de escolha.



## 9. Segurança e preservação

- **Segurança:** as proteções continuam no motor, sem depender do texto:
  - conteúdo externo marcado como não confiável;
  - só ferramentas tipadas;
  - validação Zod;
  - origens fixas de pesquisa;
  - sem execução de código;
  - limites de orçamento local e global;
  - ambientes isolados.
- **O prompt modular não remove nenhuma regra de segurança:** elas estão no módulo `safety`, enviado em todos os ciclos, e são testadas em `tests/audit.test.ts`.
- **A Lumi:**
  - nenhum registro foi apagado ou reescrito por esta auditoria;
  - o estado não tem campos novos, então não há migração;
  - identidade, memórias, projetos, idade e intenção em andamento são preservados;
  - backup assinado antes da implantação;
  - rollback: implantar de novo o commit anterior;
  - a mudança de instruções não é apresentada a ela como experiência.

## 10. Funcionalidades preservadas

- **Arquitetura multiprovedor** (Gemini, Groq e NVIDIA), roteador determinístico, circuit breaker, fallback limitado a 3 tentativas e ledger local e global.
- **Corpo:** regras de necessidades e atividades, saciedade, despertar, recusas do corpo, regra de observar quarto conhecido e motivações.
- **Diário:** a recusa de quase-repetição continua.
- **Contratos e validação:** contratos tipados, validação Zod, ações malformadas descartadas uma a uma.
- **Persistência:** backup v2 assinado e restauração.
- **Painel e transparência:** painel Provedores, transparência da rota, segurança do observatório público.
- **Testes:** 106 testes unitários e 6 E2E (Playwright).

## 12. Tela de pintura (26/11 00:20Z)

**Problema observado.** Os dois desenhos da Lumi em 25/11 ("Planta do quarto de Lumi" e a versão "depois da reorganização") saíram com todos os pixels no mesmo índice de cor: um bloco de uma cor só.

**Causa (rastro real do Nemotron, banco descartável).** No formato de grade, o modelo escreve a matriz linha por linha, a partir do fundo: `[0,0,0,…]` × 32. Ou o espaço de saída acaba antes de chegar ao desenho (truncado a 3072 e a 4096 tokens), ou a grade é fechada só com fundo. A causa está no formato, não no modelo, e ela nunca soube que o desenho tinha saído vazio.

**O que mudou.**
- **Formato `pintura`:** tela de 16 a 512 px com cor de fundo e até 160 traços sobrepostos na ordem em que são feitos. As ferramentas são `pincel` (pontos e espessura), `retangulo`, `elipse`, `poligono` (com ou sem preenchimento) e `texto`. As cores são hex validadas.
- **Na interface:** renderizado como SVG montado só a partir de primitivas validadas, sem nenhum markup vindo do modelo; o texto é escapado.
- **Grade de pixels:** saiu do contrato de criação (`creatableArtifactSchema`). As obras antigas em pixels continuam válidas em backups e visíveis no acervo (`artifactSchema`).
- **Ela vê a obra:** depois de criar, o resultado da ação traz o que ela vê, por exemplo "ao olhar a obra: 12 traços; 7 cores visíveis (#f5f0e8 86%, …)" ou "uma só cor cobre a tela inteira". A percepção usa amostragem adaptativa de até 24×24 com caixas delimitadoras (`shared/art.ts`; pior caso medido em cerca de 3 ms, contra 23 ms sem o limite), aparece em `thread` na decisão seguinte e fica gravada em `artefato.data.seen`. É percepção, não conselho.
- **Ao reler uma obra (`ler_obra`), ela também vê:** o "ao olhar a obra" vem antes dos dados. Antes, reler a grade de pixels mostrava o JSON de zeros cortado em 5000 caracteres; foi o que ela fez em 26/11 00:16 para "comparar as duas plantas pixeladas".
- **Espaço de saída:**
  - com sinal criativo (projeto criativo ativo, criatividade ≥ 70 ou tédio ≥ 70), o teto de saída é o de criação (4096) mesmo quando outra categoria escolhe o modelo, por exemplo "pesquisa" logo depois de pesquisar;
  - depois de uma resposta truncada, o modelo seguinte também recebe 4096.
- **Custo:** o contrato de ferramentas cresceu de 2.784 para 3.641 caracteres, cerca de 250 tokens por decisão. Só cotas gratuitas, sem custo adicional.

**Evidência com chamadas reais** (`artifacts/cognitive-audit/bench-paint*.json`; cenários "projeto-disponivel" e o novo "desenho-pendente"; nada no contexto diz como desenhar):

| Rodada | Resultado |
|---|---|
| paint/paint3/paint4 (grade de pixels ainda disponível) | Nemotron e MiniMax truncados escrevendo a grade; Gemini cortado em MAX_TOKENS a 1519 tokens quando a categoria era "pesquisa" |
| paint6 (pintura) | 6 de 6 decisões que tentaram desenhar viraram pintura válida, sem truncamento: Gemini 3.1 e 3.5 com 1 a 2 traços, gpt-oss com 4 traços, Nemotron com 12 traços e 7 cores (uma samambaia com caule, frondes e título) |
| paint6, falhas | MiniMax e Nemotron com tempo esgotado (45 s) em um cenário, com 503 de "content safety" da NVIDIA; o fallback cobre |

As pinturas ainda são simples. Isso é dela e pode mudar com a prática; a percepção dá o retorno de que precisa para revisar a obra pelo mesmo id.

## 11. Limitações e pendências reais

- **Groq:** a comparação completa ficou pendente por cota (item 7).
- **Amostra:** o benchmark tem 1 repetição por cenário e modelo; as diferenças de iniciativa e continuidade estão dentro do ruído, exceto a linguagem de barras (22% → 0%) e os tokens.
- **NVIDIA:** os modelos que sempre raciocinam (Nemotron Ultra) seguem entre truncar e estourar os 45 s, conforme a carga da NVIDIA.
- **Observação:** a correção da regra de observar (observação interrompida também conta) tem teste automatizado, mas ainda não foi vista numa rodada real.
- **Memórias antigas:** a seleção agora é variada, mas as memórias autobiográficas da Lumi ainda são, em boa parte, sobre a crise de saúde de 24 e 25/11. São memórias reais dela e não foram alteradas.
- **Identidade:** a descrição continua "Identidade ainda em formação." Muda só quando ela decidir, com evidências.
- **Tokenizador:** não há tokenizador no Worker; a estimativa é calibrada com chamadas reais (Gemini e MiniMax medidos; Groq e Nemotron com valores conservadores).
- **Caminho legado:** o `GeminiProvider` continua com a reserva antiga, mas só serve aos testes técnicos administrativos.
