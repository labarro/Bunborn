# Memória e continuidade

## Categorias

| Categoria      | Conteúdo e origem                                                        |
| -------------- | ------------------------------------------------------------------------ |
| Episódica      | Resultados de ciclos e acontecimentos observados                         |
| Semântica      | Fatos do ambiente, resumos externos e conhecimentos propostos com status |
| Procedimental  | Procedimentos que o modelo decide registrar com evidência                |
| Afetiva        | Associação explícita entre resultado de atividade e motivações simuladas |
| Autobiográfica | Narrativas declaradas e índices de consolidação identificados por origem |
| Identidade     | Nome, preferências, valores, crenças e suas versões evidenciadas         |
| Prospectiva    | Metas, projetos, solicitações e intenções futuras                        |
| Trabalho       | Contexto de atividade e continuidade imediata entre ciclos               |

As categorias existem no esquema e podem ser propostas pela criatura. Algumas são produzidas pelo motor com origem `observacao`, `regra_afetiva` ou `consolidacao_deterministica`; não são confundidas com declarações espontâneas. Registros de identidade/projeto também são recuperáveis por FTS mesmo quando não são linhas de tipo `memoria`.

## Metadados

Cada registro inclui ID imutável, ID da entidade, tipo, categoria, texto, dados estruturados, timestamp real, minutos virtuais, importância, confiança, associações e origem. Sequência global organiza o histórico. Frequência e última recuperação ficam em `retrievals`, evitando alterações nos registros originais. A pontuação de relevância é calculada no momento da consulta; não se armazena um número supostamente verdadeiro para todos os contextos.

IDs de evidência precisam existir em registros históricos antes de uma proposta cognitiva os usar. O motor pode ligar observações que criou no mesmo commit. Conteúdo com origem externa sempre guarda referências HTTP de domínios permitidos; conteúdo gerado pelo modelo sem consulta não é tratado como fonte externa.

## Recuperação limitada (revista na auditoria cognitiva de 25/11)

1. **Pista de recuperação:** até 24 palavras da intenção atual, dos interesses, dos projetos ativos, das perguntas pesquisadas e da última entrada do diário. Antes eram 16 palavras só da intenção e da memória de trabalho, o que trazia de volta o próprio último ciclo.
2. **Busca:** o FTS5 (`unicode61 remove_diacritics 2`) recupera registros por correspondência; a consulta é montada com tokens escapados, nunca com SQL do modelo. Somam-se as memórias recentes e as importantes, para que memórias antigas relevantes continuem alcançáveis.
3. **O que pode voltar sozinho:** memórias dela (`memoria` de origem criatura, consolidação ou motor), diário, conversas e leituras. Ficam de fora os registros técnicos do motor: os resumos "Intenção/Resultado" de cada ciclo, "Contexto de continuidade", "Associação afetiva", intenções cruas e percepções numéricas. Eles continuam no banco e na ferramenta `recordar`. Também ficam de fora o que já está à vista: entradas de `diaryRecent` e pesquisas mostradas em `knowledge`.
4. **Pontuação:** 50% correspondência textual, 30% importância e 20% recência exponencial (escala de 14 dias reais).
5. **Variedade:** dentre até 24 candidatas, uma quase-repetição (40% ou mais das palavras de 4+ letras em comum) de uma memória já escolhida não ocupa outra vaga.
6. **Envio:** até 8 memórias de até 420 caracteres, e os contadores de recuperação são atualizados.

**Por que mudou:** no contexto real da Lumi em 25/11, as 14 memórias recuperadas eram quase todas o eco do último ciclo ("Contexto de continuidade: Continuar monitorando estado após beber" e similares); 342 de 404 memórias (85%) eram desse tipo. Isso alimentava a repetição de intenções voltadas a necessidades. Desde 25/11 o motor não grava mais as duas memórias sem conteúdo de cada ciclo; o resumo "Intenção/Resultado" continua sendo gravado como histórico. A continuidade de curto prazo agora vem de `thread` (as últimas 4 decisões e o resultado de cada ação).

Esquecimento é redução de acessibilidade na recuperação, não exclusão. Histórico do observador pode ser percorrido por sequência e exportado integralmente. Memórias importantes permanecem candidatas mesmo antigas. Não há embeddings ou similaridade vetorial; associação textual e links explícitos são a alternativa gratuita adotada. Sinônimos sem palavras compartilhadas são uma limitação conhecida.

## Consolidação

O contexto informa quando uma revisão diária virtual é devida. A criatura pode registrar uma síntese autobiográfica com IDs. Durante repouso, o motor também gera índice determinístico com até seis trechos e associações, sem inventar interpretação. Fontes originais ficam intactas. Não há compactação destrutiva do histórico nem resumo substituindo episódios silenciosamente.

## Versões e backups

Versões de entidades são linhas novas com `entity_id` estável. `world` contém o estado corrente, com revisão; checkpoints guardam uma cópia do estado a cada 24 decisões. Um checkpoint sozinho não contém todo o histórico e não é backup externo.

Referências: a criatura pode citar uma entidade pelo `entityId`, pelo id curto ou pelo UUID de qualquer versão. As três formas resolvem para a mesma entidade do tipo esperado, e qualquer versão real de uma obra do projeto comprova uma etapa. Referências inexistentes são rejeitadas, e o erro lista quais faltaram (`detail.missing`).

**Backup v2 segmentado** (detalhes em ARCHITECTURE.md): manifesto com contagens e cursores congelados, segmentos de até 80 linhas com SHA-256, selo HMAC sobre JSON canônico, restauração somente em banco vazio, retomável e idempotente sob concorrência. Homologado de verdade em 24/11/2026: a criatura descartável (179 registros, 316 vínculos, 126 recuperações, 36 chamadas, 26 métricas) foi exportada e restaurada no banco isolado `bunborn-recovery`; todos os 16 digests de segmento, o estado (byte a byte), a identidade, a idade virtual, as necessidades, as decisões, o medidor de armazenamento e as contagens por tipo coincidiram (`artifacts/backup-restore-real.json`). Testes locais cobrem mais de 2.000 registros, adulteração, retomada e concorrência.

O backup v2 depende do `SESSION_SECRET` do ambiente. Trocar esse secret invalida backups antigos. Por isso, guarde também `npx wrangler d1 export DB --remote --config wrangler.production.jsonc --output existencia.backup.sql`.

## Limites de armazenamento

Teto lógico de 180 MB (gatilho no D1) e guarda física de 400 MB (verificada pelo Worker antes da cognição). Ao atingir qualquer um, novas operações geradoras de história são suspensas; **nada é apagado** e não há limite arbitrário de quantidade de registros. O medidor lógico é heurístico (bytes de conteúdo + dados + associações + 500 por registro), e o tamanho físico real, com FTS e índices, é ~1,8× maior nas medições. Projeções em ECONOMY.md: no ritmo máximo da produção, o teto lógico chega em ~104 dias; a 15 min por decisão, em ~312 dias. Memória histórica infinita não é possível em cotas finitas.


## Continuidade entre modelos (25/11)

A memória e a identidade vivem só no estado persistente do Bunborn: registros, traços e projetos. Cada ciclo monta o mesmo contexto, seja qual for o modelo (Gemini, Groq ou NVIDIA em homologação). Nenhum provedor guarda conversa ou sessão.

Cada decisão registra em `route` qual mecanismo a processou, como dado técnico, separado das intenções dela. A afinidade de modelo por categoria reduz trocas desnecessárias em conversas e projetos sem prender a criatura a um provedor fora do ar.


## Recuperação com habituação e diversidade (27/11)

As 5 memórias mais recuperadas tinham entre 171 e 254 recuperações cada: entravam em quase toda decisão. A seleção agora:
- **Habituação:** uma memória mostrada há pouco (decaimento de 3 horas) e muitas vezes (log da contagem) perde posição, sem ser apagada, e volta depois de algumas horas sem aparecer.
- **MMR:** relevância menos a semelhança com o que já foi escolhido (λ = 0,6).
- **Quantidade:** 6 memórias de até 320 caracteres.

Nada é aleatório. Detalhes em COGNITIVE_DIVERSITY.md.


## Conceitos e consultas (28/11)

Uma pesquisa deixou de criar automaticamente um `conceito`. A consulta e o resultado continuam como `pesquisa` e `memoria` com fontes, e conceitos agora vêm só da ação `conceito` dela. Os conceitos antigos gerados a partir de buscas foram preservados e aparecem no Neural Atlas como consultas. O contexto traz os conceitos declarados e as relações entre eles (NEURAL_ATLAS.md).
