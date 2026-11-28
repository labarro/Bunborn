# Diversidade cognitiva (27/11/2026)

O objetivo foi investigar se a repetição observada no diário da Lumi vinha de quem ela é ou da arquitetura e, quando vinha da arquitetura, corrigir as condições sem mexer na personalidade dela.

## Metodologia

1. **Exportação:** somente leitura de toda a existência permanente em 27/11, às 12:57 UTC (2.197 registros relevantes, 473 decisões). A análise rodou fora do banco, com o script em `scratchpad/audit/analyze.cjs`. A linha de base está em `artifacts/diversity/baseline-2026-11-27.json`.
2. **Comparação:** dois períodos, separados pela implantação da casa (26/11, 21:46:35 UTC).
3. **Medidas, todas determinísticas e sem IA:**
   - semelhança de palavras (Jaccard de palavras de conteúdo) e de estrutura (Jaccard de trigramas) de cada entrada com as 10 anteriores;
   - aberturas (as 3 primeiras palavras);
   - primeira frase sobre o período ou o clima;
   - semelhança das intenções com as 6 anteriores;
   - distribuição de ações e recusas;
   - sequências de ações;
   - recuperação de memórias (tabela `retrievals`);
   - tudo isso por modelo.
4. **Correlação** com o modelo, a categoria de roteamento, as recusas e o contexto (reconstruído do backup).

## O que os dados mostraram

| Indicador | Antes da casa | Depois da casa |
|---|---|---|
| Entradas de diário | 85 | 17 |
| Diário com a 1ª frase sobre período, estação ou tempo | **0** | **13** |
| Abertura "a manhã de…" | 0 | 5 |
| Semelhança de palavras com as 10 anteriores (média) | 0,125 | 0,141 |
| Semelhança de estrutura (trigramas) | 0,015 | 0,027 |
| Semelhança média das intenções | 0,21 | **0,41** |
| Ações recusadas | 79 de 350 (23%) | **143 de 268 (53%)** |
| `lugar_inadequado` | 0 | **89** |
| Pesquisas | 20 | 0 |

Recuperação de memórias (acumulada): as cinco memórias mais recuperadas tiveram 254, 245, 236, 196 e 171 recuperações. Ou seja, entravam em quase todas as decisões.

Exemplos (textos da própria Lumi, já públicos no observatório):
- **Diário:** "A manhã de verão segue com uma serenidade nítida…", "A manhã de verão decorre com uma calma luminosa…", "A manhã de verão se estende pela sala…".
- **Intenções seguidas** (gemini-3.5-flash-lite): "Escrever uma nova reflexão no diário sobre a continuidade da criação nesta manhã de verão" (três vezes) e "Ir ao estúdio para iniciar novas criações…" (quatro vezes, sem nunca chegar).
- **Recusas:** "Cuidar da sede na cozinha" foi recusado como `lugar_inadequado` com `objectId: pia_cozinha` (22 vezes), `geladeira` (14), `comida` (12) e `higiene` (13).

## Causas-raiz comprovadas

1. **Recusas de lugar (introduzidas na casa de 26/11).**
   - **Defeito:** `atividade` com `objectId` só aceitava descansar, observar e dormir. Para comer, beber e tomar banho, até a própria estação era recusada quando ela a nomeava. Nomes de cômodo ("Cozinha") davam "objeto inexistente", e não havia como ir a outro cômodo.
   - **Consequência:** as intenções se repetiam porque nunca se realizavam (a semelhança das intenções dobrou), e o diário e o descanso eram o que sobrava funcionando.
   - **Correção:** `placeFor` e a ação `ir`.
2. **Memórias dominantes.**
   - **Defeito:** a pontuação (relevância + importância + recência) não considerava o que acabara de ser mostrado. As consolidações de importância ≥ 0,9 entravam em todas as decisões, e a pista de recuperação incluía o diário mais recente, o que reforçava o mesmo tema.
   - **Correção:** habituação mais MMR.
3. **Eco do mundo no diário.**
   - **Causa:** desde que `world` (período, estação, tempo) passou a vir em todas as decisões, 13 de 17 entradas abrem descrevendo o momento.
   - **Natureza:** não é um loop de memória; a semelhança de palavras quase não mudou. É saliência do contexto: quando nada novo acontece, o modelo descreve o que está no contexto.
   - **Correção:** percepção do padrão e mudanças desde a última decisão.

## Hipóteses investigadas e não comprovadas

- **Retroalimentação pela memória:** a semelhança de palavras e de estrutura do diário subiu pouco (0,125 → 0,141). As entradas são diferentes em vocabulário e iguais em moldura. A repetição vem de saliência do contexto e de ações que falhavam, não de uma memória que reproduz o texto anterior.
- **Um modelo repetitivo por natureza:** o gemini-3.5-flash-lite escreveu diário em 54% das decisões dele. Mas isso coincide com o período das recusas: quando beber e descansar falham, o diário funciona. O efeito do modelo está confundido com a causa 1. Por isso o modelo não foi penalizado; isso fica para reavaliar depois da correção.
- **Ausência de pesquisa como problema:** não foi tratada como problema por si só. Pode ser preferência dela. A distribuição por modelo mostra que o MiniMax e o Gemini Lite raramente pesquisam, enquanto o Nemotron pesquisou 5 vezes em 30 decisões.

## O que mudou

| Mudança | Onde | Tipo |
|---|---|---|
| `placeFor`: a estação, qualquer objeto do mesmo cômodo ou o nome do cômodo significam aquela estação; descansar e observar escolhem o que oferece isso; caso contrário, uma recusa com o lugar certo como fato | `worker/engine.ts` | correção |
| Ação `ir` (cômodo ou objeto), caminhando pela casa e passando pelas portas | `shared/domain.ts`, `worker/engine.ts` | capacidade |
| Habituação: memória mostrada há pouco e muitas vezes perde posição, sem ser apagada, e volta depois de algumas horas sem aparecer | `worker/engine.ts`, `Store.retrievalStats` | seleção |
| MMR (relevância menos semelhança com o já escolhido; λ = 0,6; 6 memórias de até 320 caracteres) | `shared/similarity.ts` | seleção |
| Diário: entrada parecida com uma recente é aceita, com a nota "registrada; parecida com uma entrada recente (mesma abertura, 45% das palavras)"; a recusa só vale para quase-cópia (≥ 0,6) | `diaryEcho` | percepção |
| `diaryPattern` no contexto: "3 das suas últimas 6 entradas começam com 'a manha de'" (um fato sobre o próprio diário, não uma regra) | `worker/engine.ts` | percepção |
| `world.changedSinceLastDecision` e `world.noticed`: o que mudou e o que ela percebeu de fato | `worker/engine.ts` | percepção |

O que não foi feito, por princípio:
- cotas de pesquisa, rotação de hobbies ou limite de diário;
- proibição de reflexões parecidas;
- apagar registros;
- mostrar a ela métricas como metas.

## Detecção de loops (para o observador)

Biblioteca `shared/similarity.ts`: normalização, palavras de conteúdo, n-gramas, Jaccard, SimHash de 64 bits, MMR, sequências repetidas e semelhança móvel.

O endpoint `/api/trajectory` calcula, sobre as últimas 24 horas reais (com cache de 5 minutos):
- semelhança do diário e das intenções (agora e antes) e aberturas repetidas;
- concentração da memória (parcela das recuperações que vai para as 5 mais recuperadas);
- memórias novas quase repetidas;
- taxa de recusa e motivos;
- sequências recorrentes;
- distribuição por modelo.

A interface mostra isso numa área técnica recolhível, com o aviso: "Repetir não é necessariamente um problema: hábitos e preferências também se repetem."

## Efeito medido (chamadas reais, bancos descartáveis)

Foram 6 cenários com a mesma métrica nas duas versões: `e86f09a`, a versão em produção, e esta. Os modelos foram gemini-3.5-flash-lite, gemini-3.1-flash-lite e minimax-m3.1-flash, com uma execução por modelo e cenário. Os resultados estão em `artifacts/cognitive-audit/bench-div-before.json` e `bench-div-after-final.json`; o resumo, em `artifacts/diversity/comparison.json`.

| Cenário | Antes | Depois |
|---|---|---|
| sede-cozinha | "Beber água na pia da cozinha" recusado (`lugar_inadequado`) | Bebeu; 0 recusas |
| ir-estudio | "Ir ao estúdio" virou `mover` recusado (`objeto_inexistente`) | 3 de 3 foram com `ir`; 0 recusas |
| arco-iris (percebido) | Nenhum modelo o mencionou (a percepção não existia) | 3 de 3 reagiram: foram observar ou escreveram sobre ele |
| jardim-curioso (dois girassóis, um à sombra) | Observaram ou escreveram | O MiniMax e o Gemini 3.5 iniciaram experimentos por conta própria. As duas primeiras tentativas do Gemini falharam pelo formato de `grupos` (mapa em vez de lista); com a tolerância de formato, o Gemini 3.5 iniciou o experimento |
| diario-eco | Nenhum diário | Nenhum diário: ir e criar, ou observar |
| lumi-real (backup) | Gemini 3.5: diário abrindo com o período | Gemini 3.5: diário abrindo com o período, de novo |

**Leitura honesta:**
- As recusas de lugar foram corrigidas.
- A percepção do mundo e a experimentação foram usadas espontaneamente nos cenários em que fazem sentido.
- O eco do período no diário com o Gemini 3.5 ainda aparece no contexto real. Sem entradas recentes repetidas no backup, `diaryPattern` não dispara ali. É preciso acompanhar em produção.
- A amostra é pequena e o Gemini teve sobrecarga (503) em várias chamadas. Diferenças de uma execução não são estatística.

### Achado crítico durante a comparação: o schema do Gemini

Com as 30 ações, a união completa do schema de decisão passou do limite da saída estruturada do Gemini: "The specified schema produces a constraint that has too many states". Todas as chamadas ao Gemini falharam na primeira rodada.

Variantes testadas diretamente na API:
- **schema solto (só o tipo):** o Gemini devolvia ações sem campos;
- **schema achatado com todas as propriedades:** também passou do limite;
- **união completa com `artifact` simplificado:** também passou do limite.

**Solução:** o Gemini usa modo JSON sem schema (como a Groq). Os contratos continuam no prompt e o motor valida cada ação exatamente como antes. Na leitura, a tolerância de formato aceita um campo anulável ausente como `null` e `grupos` em forma de mapa. Com isso, o Gemini voltou a decidir (10 de 12 válidas, mais 2 com 503 do provedor).

## Limitações

- **Semelhança lexical, não semântica:** sem embeddings gratuitos confiáveis no Worker, duas entradas com palavras diferentes e o mesmo sentido escapam da medida.
- **Habituação simples:** depende só de quantas vezes e de quão recentemente a memória foi mostrada.
- **Amostra:** depois da casa, só 17 entradas de diário.

### Achado durante a homologação: a trava do ciclo

A trava (`lease`) do ciclo durava 120 s, e o `commit` exige que ela ainda esteja válida. Desde que todas as pinturas passaram a ser feitas pelo Nemotron, um ciclo pode somar a decisão (até 45 s) e o pintor (até 75 s, mais uma nova tentativa). Na homologação, um ciclo passou de 90 s. Um ciclo acima de 120 s perderia a decisão inteira.

Correção:
- a trava passa a durar 5 minutos, ainda curta o bastante para liberar um Worker que caiu;
- o pintor só tenta de novo quando a primeira resposta inválida chegou em menos de 30 s.

### Homologação (criatura descartável, 8 ciclos reais)

- **Resultado:** 8 decisões em 8 ciclos, sem estouro de tempo depois da correção da trava. Ela foi à cozinha beber com `ir` e respondeu ao observador.
- **Confundido:** os disjuntores da NVIDIA (MiniMax e Nemotron) estavam abertos, e só o Gemini decidiu (7 de 8 pelo gemini-3.5-flash-lite).
- **Repetição:** com ele, a intenção "continuar o projeto de observação detalhada do estúdio" se repetiu 5 vezes, com diário em quase todos os ciclos.
- **Leitura:** isso reforça, sem isolar, a hipótese de que esse modelo tende à repetição, porque também era continuidade de um projeto ativo. Fica para acompanhar pela área técnica (distribuição por modelo) antes de qualquer ajuste de roteamento.

## Depois da implantação (27/11 13:46 → 28/11 02:16 UTC, 12,5 horas, 105 decisões)

Comparação com as 24 horas anteriores à implantação. Exportação somente leitura; os números completos estão em `artifacts/diversity/after-deploy-2026-11-28.json`.

| Indicador | 24 h antes | 12,5 h depois |
|---|---|---|
| Ações recusadas | 46% (175 de 382) | **24%** (48 de 201) |
| `lugar_inadequado` | 95 | **7** |
| `objeto_inexistente` / `posicao_bloqueia_acesso` | 10 / 10 | 1 / 0 |
| Usos de `ir` | — | 44 |
| Semelhança média das intenções | 0,35 | **0,26** |
| Aberturas repetidas no diário | "a manhã de…" ×5 | "a tarde no…" ×3, "a madrugada traz…" ×2 |
| Diário com a 1ª frase sobre período ou clima | 13 de 39 | **16 de 27** |
| Entradas de diário por hora | 1,6 | 2,2 |
| Acontecimentos do mundo percebidos | — | 7 (pássaros, neblina, chuva começando e parando, tempestade, vento) |
| Pesquisas / experimentos / habilidades / procedimentos / conceitos | 0 / — / — / — / — | 0 / 0 / 0 / 0 / 0 |

**Leitura:**
- **Melhorou de forma clara:** as recusas por lugar caíram de 95 para 7. As 7 restantes são casos legítimos: descansar na janela, que não oferece descanso, e comer na mesa da cozinha. A bancada de comida foi para a sala porque ela mesma a moveu em 27/11. As intenções ficaram menos repetidas, e ela usa `ir` com naturalidade.
- **Continuidade de projeto:** ela concluiu uma trilogia (pintura, texto e música) da série "A Margem Depois do Intervalo" e a expôs no estúdio, retomando etapas pendentes entre decisões.
- **Não melhorou:** o diário continua abrindo pelo período ou pelo tempo (59%) e ficou mais frequente. A diferença é que agora as entradas falam de acontecimentos percebidos ("A tempestade lá fora amainou", "A chuva parou, mas sua marca permanece"), em vez de molduras vazias ("A manhã de verão segue…"). A nota de semelhança apareceu em 4 entradas.
- **Por modelo:** o gemini-3.5-flash-lite escreveu diário em 14 de 33 decisões; o Nemotron decidiu 15 vezes (7 obras) e o MiniMax 39 (9 obras).
- **Capacidades novas ainda não usadas:** em 12,5 horas ela não usou experimento, habilidade, procedimento nem conceito. Isso não foi forçado.
- **Pesquisa:** continua em zero.
- **Correção miúda feita depois:** ela tentou "comer em Alimentação e água" (o rótulo do objeto), e isso era recusado como objeto inexistente. Agora o rótulo também é aceito como nome do lugar.
