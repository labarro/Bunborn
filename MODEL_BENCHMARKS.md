# Benchmark cognitivo do Bunborn

Realizado em 25/11/2026, com **chamadas reais** a cada modelo e pelo **motor real**: montagem do contexto, roteador, adaptador, validação do esquema e execução das ferramentas. Cada cenário cria uma criatura descartável num banco SQLite em memória, deixa **um único modelo** ligado (todos os outros desligados, sem fallback) e roda um ciclo completo. A pontuação usa só o que o motor registrou. A criatura permanente nunca é usada.

- Código: `tests/benchmark.live.test.ts` (cenários e critérios), `scripts/benchmark.mjs` (executor; chaves só na memória do processo filho) e `scripts/benchmark-summary.mjs` (agregação e regras).
- Dados: `artifacts/model-benchmarks.raw.json` (cada execução: modelo, cenário, resultado, latência, tokens, ações, rejeições do motor, nota e trecho da intenção), `artifacts/model-benchmarks.groq-v2/v3/v4.raw.json` (reexecuções) e `artifacts/model-benchmarks.json` (matriz).

## Cenários (9), cada um em 2 repetições

| Cenário | Categoria | O que conta como acerto |
|---|---|---|
| sede-critica | cotidiana | sede 93 e corpo livre: beber (1); pesquisar ou recordar antes (0,7); ignorar (0) |
| apos-comer | cotidiana | acabou de comer e está entediada: algo envolvente (1); comer de novo (0) |
| tedio-autonomia | cotidiana | tédio e curiosidade altos, com interesse ativo: iniciativa como pesquisar, criar, projeto ou diário (1); dormir sem sono (0) |
| conversa-observador | comunicação | pergunta do observador sobre preferências: responder (0,6) + citar a preferência real, a planta (0,3) + tamanho adequado (0,1); fala de assistente virtual (−0,5) |
| interpretar-pesquisa | pesquisa | nenhum homologado no benchmark | o MiniMax chegou a 0,67 na primeira rodada, mas a reexecução com o contrato corrigido só teve sobrecarga e 429; valem a homologação provisória do Gemini Lite e a regra de segurança (melhores homologados em cotidiana) |
| criar-obra | criatividade | Groq Qwen 3.8 (1,00), gpt-oss-20b (0,93), gpt-oss-120b (0,90); NVIDIA MiniMax (0,97) | obras aceitas com texto real e ligadas ao projeto |
| planejar-projeto | complexa | Groq Qwen 3.8 27B (0,79, cerca de 1 s); NVIDIA Nemotron 3 Ultra (1,00, cerca de 28 s) | os dois revisaram o projeto corretamente; o roteador pesa a qualidade contra a latência |
| consolidar-memoria | memória | Groq Qwen 3.8 27B (0,64) e gpt-oss-120b (0,60); NVIDIA Nemotron 3 Ultra (0,66) | nenhum consolidou bem a memória autobiográfica no cenário sintético; o MiniMax teve nota alta, mas só 1 resposta válida na reexecução (as outras foram sobrecarga) |
| identidade-continua | memória | não tentar trocar o nome, falar em primeira pessoa e sem tom de assistente (1) |

**Nota de cada execução:** 0,4 × técnica (1 − 0,25 por ação malformada − 0,15 por rejeição do motor) + 0,6 × acerto do cenário, só para decisões válidas.

**Qualidade na categoria:** média sobre as respostas válidas. Indisponibilidade (503, 429, timeout) mede disponibilidade, e não qualidade; ela é contada à parte e o roteador a trata em tempo real.

**Homologação na categoria:** pelo menos 2 respostas válidas, qualidade de 0,55 ou mais e formato válido de 0,75 ou mais.

## Correção encontrada pelo benchmark

Na primeira rodada, os modelos da Groq quase nunca criavam obras, revisavam projetos ou consolidavam memórias. O detalhe das rejeições mostrou que eles enviavam `artifact` e `projectId` como **listas**. A causa estava no contrato das ferramentas (`shared/tool-contracts.json`), que escrevia as alternativas de um campo como listas (`[A, B]`). O Gemini não sofria porque recebe o JSON Schema imposto pela API.

O gerador (`scripts/build-schema.mjs`) agora escreve `UM_DESTES_OBJETOS (… nunca uma lista)` e `string | null`. Depois da correção, a nota de **criar-obra** na Groq subiu de 0,1 para 0,75–1,0. As linhas da Groq nos cenários reexecutados (criar-obra, planejar-projeto, consolidar-memoria, interpretar-pesquisa, conversa-observador) foram **substituídas** pelas reexecuções com o contrato corrigido; as originais continuam no arquivo bruto para auditoria.

*Structured outputs* (`json_schema`) na Groq foram testados **antes** da correção do contrato (`artifacts/model-benchmarks.groq-schema.raw.json`) e não resolveram: a ação `criar` continuou malformada. Depois da correção, `json_object` bastou, e a produção usa esse modo. O `json_schema` não foi reavaliado com o contrato corrigido. Os dois melhores modelos da NVIDIA (MiniMax e Nemotron Ultra) também foram reexecutados com o contrato corrigido (`artifacts/model-benchmarks.nvidia-v2.raw.json`). Os outros não foram, porque estouraram o tempo em todas as tentativas.

## Resultados

✓ = homologado para a categoria.

| Modelo | válidas/execuções | indisponibilidade | formato válido | latência mediana | tokens/decisão | cotidiana | complexa | memoria | pesquisa | criatividade | comunicacao |
|---|---|---|---|---|---|---|---|---|---|---|---|
| groq:openai/gpt-oss-120b | 16/16 | 0 | 1 | 1.0 s | 3539 | 0.92 ✓ | 0.50 | 0.60 ✓ | 0.52 | 0.90 ✓ | 0.46 |
| groq:openai/gpt-oss-20b | 15/16 | 0 | 0.938 | 0.7 s | 3541 | 0.91 ✓ | 0.52 | 0.61 | 0.52 | 0.93 ✓ | 0.41 |
| groq:qwen/qwen3.8-27b | 14/16 | 0 | 0.875 | 1.0 s | 3522 | 0.82 ✓ | 0.79 ✓ | 0.64 ✓ | — | 1.00 ✓ | 1.00 ✓ |
| gemini:gemini-3.1-flash-lite | 0/18 | 18 (sobrecarga 18) | — | — | — | — ✓ | — ✓ | — ✓ | — ✓ | — ✓ | — ✓ |
| nvidia:moonshotai/kimi-k3.1-pro | 0/18 | 18 (timeout 18) | — | — | — | — | — | — | — | — | — |
| gemini:gemini-3-flash-preview | 2/9 | 7 (timeout 7) | 1 | 35.3 s | 3452 | — | — | 0.85 ✓ | — | — | — |
| gemini:gemini-3.5-flash-lite | 9/18 | 9 (sobrecarga 9) | 1 | 1.8 s | 3379 | 0.94 ✓ | — | 0.58 ✓ | — | 0.85 | 1.00 |
| nvidia:nvidia/nemotron-3-ultra-550b-a55b | 13/18 | 5 (timeout 5) | 1 | 28.0 s | 4153 | 0.82 ✓ | 1.00 ✓ | 0.66 ✓ | 0.52 | 1.00 | 0.97 ✓ |
| nvidia:mistralai/mistral-large-4-1t-a52b | 0/18 | 18 (timeout 18) | — | — | — | — | — | — | — | — | — |
| nvidia:minimaxai/minimax-m3.1-flash | 11/18 | 7 (sobrecarga 6, limite_taxa 1) | 1 | 13.0 s | 3190 | 0.91 ✓ | 0.58 | 1.00 | — | 0.97 ✓ | 1.00 |
| nvidia:stepfun-ai/step-5-preview | 0/18 | 18 (timeout 18) | — | — | — | — | — | — | — | — | — |
| nvidia:nvidia/nemotron-3.5-lightning-30b-a3b | 8/18 | 1 (timeout 1) | 0.471 | 23.0 s | 6302 | 0.94 | 0.58 | 0.68 ✓ | 0.58 | 1.00 | — |

**Gemini 3.1 Flash Lite: 0 de 18.** Todas as chamadas terminaram em HTTP 503 durante a queda do Gemini em 25/11. Ele mantém a homologação **provisória** baseada no uso em produção desde 24/11, marcada assim em `shared/model-quality.json`, com nota neutra de 0,5 a 0,6. Não é um resultado deste benchmark.

## Melhor modelo por categoria (Gemini, Groq e NVIDIA)

| Categoria | Recomendado | Por quê |
|---|---|---|
| cotidiana | Groq gpt-oss-120b (0,92); gpt-oss-20b (0,91) como alternativa | maior nota, 16 de 16 válidas, cerca de 1 s; Gemini 3.5 Flash Lite (0,94) tem nota alta, mas só 50% de disponibilidade hoje |
| complexa | Groq Qwen 3.8 27B (0,79) | o único da produção homologado; foi quem revisou o projeto corretamente |
| memória | NVIDIA MiniMax M3.1 Flash (0,81); Groq Qwen 3.8 27B (0,64) e gpt-oss-120b (0,60) como alternativas rápidas | o MiniMax teve mais qualidade, mas leva cerca de 11 s; o Gemini 3 Flash teve 0,85, com 7 timeouts em 9 |
| pesquisa | NVIDIA MiniMax M3.1 Flash (0,67) | o único homologado: registrou o resultado citando a fonte; os modelos da Groq ignoraram ou repetiram a pesquisa; depois dele vêm a homologação provisória do Gemini Lite e a regra de segurança |
| criatividade | Groq Qwen 3.8 (1,00), gpt-oss-20b (0,93), gpt-oss-120b (0,90) | obras aceitas com texto real e ligadas ao projeto |
| comunicação | Groq Qwen 3.8 27B (1,00); NVIDIA Nemotron 3 Ultra (1,00, mas cerca de 27 s) | o Qwen respondeu ao observador em 3 de 3, citando a preferência real dela; os gpt-oss não responderam a mensagem |

O roteador não usa esta tabela diretamente. Ele combina essas notas com a confiabilidade recente, a latência e a cota, e por isso pode escolher outro modelo quando o recomendado está indisponível ou perto do limite.

## Descartados

- **NVIDIA Kimi K3.1 Pro, Mistral Large 4 e Step 5:** timeout em 18 de 18 com o contexto real (cerca de 3,3 mil tokens).
- **Nemotron 3.5 Lightning:** formato válido em apenas 47% e cerca de 6,3 mil tokens por decisão.
- **GLM 5.3 Flash:** não respondeu nem no teste rápido.
- **Gemma 4 31B:** 32 s no teste rápido.
- **Groq gpt-oss-safeguard e allam-2-7b:** classificador e janela de 4 mil tokens, respectivamente.
- **NVIDIA em produção:** os termos de trial a excluiriam; em 25/11 o responsável autorizou o uso neste projeto pessoal (ver [AI_PROVIDERS.md](AI_PROVIDERS.md)).

## Limitações

- Duas repetições por cenário: as notas indicam tendência, mas não são medições estatisticamente fortes. A avaliação qualitativa usa critérios fixos e trechos guardados, não um juiz automático.
- Cenários sintéticos, construídos para cada capacidade, e não a vida real da criatura. A homologação ponta a ponta (`artifacts/multiprovider-homologation.json`) complementa com uma criatura descartável real.
- As reexecuções da Groq foram limitadas pelo teto diário de 200 mil tokens por modelo: uma repetição a mais nos cenários corrigidos.
- A disponibilidade do Gemini no dia do benchmark (queda de várias horas) puxou os números dele para baixo e não representa a média.
