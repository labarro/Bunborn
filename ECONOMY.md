# Economia de custo zero

Documentação oficial revalidada em **24/11/2026** (as páginas da Cloudflare consultadas têm data de 13/11/2026). Nenhum faturamento habilitado, nenhum serviço pago contratado. Planos confirmados **pelo usuário**: Workers Free e Gemini Free sem faturamento. A API de billing da Cloudflare retorna 403 para o OAuth atual; não houve verificação independente.

## Serviços e limites Free usados

| Serviço | Limite Free oficial | Uso no Bunborn |
|---|---|---|
| Workers | 100.000 requests/dia; **10 ms CPU** por request HTTP ou Cron; 5 Cron Triggers por conta | Gateway fino; 2 Crons (um por ambiente) |
| Durable Objects (SQLite) | 100.000 requests/dia; 13.000 GB-s/dia; reset 00:00 UTC; "30 s de CPU por request (padrão)" | Executor único por ambiente |
| D1 | 5 milhões de linhas lidas/dia, 100.000 escritas/dia (**por conta**), 5 GB totais, 500 MB por banco | 5 bancos |
| Gemini `gemini-3.1-flash-lite` | 500 RPD / 15 RPM observados pelo usuário | Teto global do app: 440/dia, 12/min |
| Gemini `gemini-3-flash-preview` | 20 RPD / 5 RPM observados pelo usuário | Teto global do app: 16/dia, 4/min |
| Wikipedia/Wikidata | APIs públicas com política de uso | 1 consulta por ciclo, 3 resultados, cache de 24 h |

**Ambiguidade documentada sobre a CPU do DO**: a tabela de limites do DO diz "30 seconds (default)", mas o FAQ da mesma página diz que DOs têm "the same per invocation CPU limits as any Workers do". A medição real mostra o DO com P99 de 26,9–41,8 ms e **0 `exceededCpuErrors`** em 255 invocações. Isso indica que o limite de 10 ms do Worker não está sendo aplicado ao DO, mas **não é garantia contratual**. Se a Cloudflare passar a aplicar 10 ms ao DO, o sintoma será erro `exceededCpu` no ciclo, registrado como falha e seguido de backoff, sem perda de história.

## Orçamento cognitivo compartilhado

A mesma chave Gemini atende os dois ambientes, então existe um contador global em `bunborn-budget`, além do contador local de cada banco.

| Escopo | Lite/dia | Flash/dia |
|---|---|---|
| Global (soma dos ambientes) | 440 | 16 |
| Produção | 440 (pode usar todo o teto global) | 16 |
| Homologação | 80 | 8 |
| Ensaios induzidos (TOOL_DB) | contador local próprio de 80 | 8 |

- O dia segue `America/Los_Angeles` (vira às 08:00 UTC no inverno).
- A reserva **local** é feita primeiro e a **global** depois. Assim, um ambiente com a cota local esgotada não consome vagas globais da produção. Antes desta correção, cada tentativa negada da homologação gastava uma vaga global; hoje uma negação global fica registrada só localmente, como `negada_global`. Teste: `tests/features.test.ts`.
- Reservas incluem falhas antes da rede, HTTP 4xx/5xx e timeouts. **Reserva ≠ chamada recebida pelo Gemini.** Tokens são os que a API reporta (`usageMetadata`); em falha sem resposta, o consumo é desconhecido e fica 0 no contador. Nada é devolvido nem zerado.
- Se o Flash esgotar, a revisão complexa é adiada e o ciclo usa Lite, com um registro `orcamento`. Não há outro provedor nem fallback pago.
- Contadores no momento do início do experimento (dia do Pacífico 2026-11-23): global Lite 29 reservas / 116.264 tokens, Flash 9 / 18.761; homologação local Lite 28 / 111.589, Flash 8 / 15.772. Contagens posteriores estão em `artifacts/` e no relatório.

Desde 24/11 a produção pode usar todo o teto global (440/16), e o contador compartilhado continua limitando a soma. A homologação, com o experimento encerrado e pausado, não faz nenhuma chamada, então a cota fica livre para a produção automaticamente. O motor ainda reserva no máximo 400 Lite/12 Flash por dia sem mensagens pendentes (até 440/16 com mensagens).

## Ritmo e consumo

O piso entre decisões é imposto pelo servidor; dentro dele, a criatura escolhe o intervalo (até 60 min).

- **Produção**: piso de 5 min → no máximo 288 decisões/dia. Cabe no teto de 360 Lite + 12 Flash (Flash substitui um Lite a cada ~24 decisões ou quando a criatura pede revisão e há cota).
- **Homologação**: piso de 15 min → no máximo 96 decisões/dia, compatível com os 80 Lite locais e o teto de 110 chamadas do experimento de 24h.

## Medições reais por ciclo (D1)

Fonte: 23 decisões consecutivas da primeira criatura descartável (`cycle_metrics`, homologação).

| Métrica | Valor medido |
|---|---|
| Linhas lidas por decisão | média 315 (364–460 nas últimas) |
| Linhas escritas por decisão | média 130 (inclui FTS, índices e vínculos) |
| Banco compartilhado por decisão | ~8 leituras, ~8 escritas |
| Crescimento lógico por decisão | ~6,0 KB (máx. 10,4 KB) |
| Crescimento físico por decisão | ~10,7 KB (233.472 → 479.232 bytes em 23 decisões) |
| Cron ocioso (sem decisão) | ~3 linhas escritas/min/ambiente (produção vazia: 164 escritas em 55 min) |
| Banco vazio com migrações | ~225–237 KB |

## Projeções (lineares, a partir das medições acima)

Hipóteses: o tamanho por decisão permanece constante (cada ciclo grava um número limitado de registros), o banco começa com 0,25 MB e o fator físico/lógico fica em ~1,8. Não inclui obras muito grandes, que podem chegar a ~12 KB de texto ou 32×32 pixels cada. Esta é uma extrapolação, não uma promessa.

| Ritmo (decisões/dia) | 7 dias | 30 dias | 180 dias | 365 dias |
|---|---|---|---|---|
| 288 (máximo da produção) | 12 MB lóg. / 22 MB fís. | 52 / 92 MB | **teto lógico de 180 MB em ~104 dias** | — |
| 96 (média de 15 min) | 4 / 7 MB | 17 / 31 MB | 104 / 185 MB | teto lógico em ~312 dias |
| 48 (média de 30 min) | 2 / 4 MB | 9 / 15 MB | 52 / 92 MB | 105 / 187 MB |

- O teto lógico (180 MB) chega antes do limite físico de 500 MB por banco do D1. Ao atingi-lo, a existência suspende novas escritas de história; **nada é apagado**. A guarda física de 400 MB também suspende o ciclo.
- Escritas D1 por dia, por conta: ritmo máximo da produção ≈ 288×130 + 1.440×3 ≈ **41,8 mil**; homologação a 96/dia ≈ 16,8 mil; soma ≈ 59 mil, abaixo das 100 mil. Os dois ambientes no ritmo máximo somariam ~84 mil, próximo do limite. Por isso a homologação tem piso maior e o experimento é temporário.
- Leituras: ≈ 90 mil/dia por ambiente no ritmo máximo, muito abaixo de 5 milhões. Leituras FTS podem crescer com a história; o valor por ciclo fica registrado em `cycle_metrics` e deve ser acompanhado.
- Requests de Worker e DO: ~1.440 Cron + ~1.440 DO + uso da interface por ambiente/dia ≪ 100 mil.
- Duração do DO: ~288 × ~10 s de espera pelo modelo + 1.440 × ~0,3 s ≈ 3.300 s × 0,125 GB ≈ 415 GB-s/dia ≪ 13.000.

## Observatório público

Cada aba pública faz uma leitura a cada 3 min (~480 requests/dia; a do responsável, a cada 1 min). As 100 mil requests/dia do Workers Free são da conta inteira (Crons ~2.880/dia + DO + visitantes), o que comporta da ordem de 190 abas abertas 24 h/dia, ou muito mais visitas curtas. Com o cache de 30 s, um pico de visitantes não multiplica as leituras de D1 nem as requisições ao DO. Mensagens de visitantes têm limite (3/h por IP, 30/h no total, 24 pendentes) e não aumentam o teto diário além da reserva de mensagens já descrita (até 440 Lite/16 Flash globais). Excedido o limite de requests, as páginas falham até 00:00 UTC; o Cron e a existência não dependem delas.

## Garantias e limites

- Sem SLA no Free. Excesso de limite gera erro, nunca cobrança: suspensão com estado preservado.
- `FREE_TIER_CONFIRMED=true` é uma declaração humana; a API não prova a ausência de faturamento.
- Workers Logs (CPU por rota) não está acessível com o OAuth atual (403). As medições usam o GraphQL Analytics, que é amostrado (quantis aproximados).
- Memória histórica infinita é impossível em cotas finitas. Exporte periodicamente (backup v2 e `wrangler d1 export`).
