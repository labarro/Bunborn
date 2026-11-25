# Roteamento cognitivo

O código fica em `worker/ai/`:
- `adapters.ts`: diferenças entre as APIs e classificação de erros.
- `health.ts`: circuit breaker e médias móveis.
- `router.ts`: categorias e pontuação.
- `cognition.ts`: orçamento, fallback e registro da rota.
- `admin.ts`: painel administrativo.

O catálogo fica em `shared/ai-catalog.ts`, e a homologação em `shared/model-quality.json`, gerado pelo benchmark.

## Princípios

- **Uma decisão é uma chamada lógica.** A categoria só orienta a escolha do modelo; a decisão nunca vira várias chamadas.
- **Roteamento determinístico.** Nenhuma chamada de IA é gasta para escolher o modelo.
- **Nenhum efeito antes de uma resposta válida.** O motor só aplica ações depois que uma resposta passou na validação do esquema e foi aceita. Tentativas que falham não produzem nada, então uma decisão nunca vira várias ações duplicadas.
- **A identidade vive no Bunborn.** Todo modelo recebe o mesmo contexto montado do estado persistente: nome, traços, memórias, projetos, mensagens, percepções e histórico recente. Nenhum provedor guarda sessão ou histórico próprio, e as instruções dizem que mecanismos diferentes podem processar ciclos diferentes, mas a história vem sempre do contexto.

## Categorias

A categoria sai de sinais do estado (`categorize`), na ordem abaixo. A primeira condição verdadeira vence.

| Categoria | Quando | Prioridade |
|---|---|---|
| comunicação | há mensagens pendentes | naturalidade, coerência com a personalidade |
| complexa | a decisão anterior pediu `complexNext`, ou a cada 24 decisões | qualidade de raciocínio (esforço "médio") |
| memória | consolidação pendente (mais de 24 h virtuais) | fidelidade aos dados e evidências |
| pesquisa | há pesquisa ou leitura entre os 6 registros mais recentes | uso correto de fontes |
| criatividade | projeto criativo ativo, ou vontade de criar ≥ 70 com tédio ≥ 60 | formatos estruturados e qualidade criativa (esforço "médio") |
| cotidiana | demais casos | eficiência e boa leitura do contexto |

## Pontuação

```
score = 0,55 · qualidade homologada na categoria
      + 0,25 · (sucesso recente × respostas válidas)   médias móveis com α = 0,2
      + 0,10 · velocidade                              1 − latência média / 30 s
      + 0,10 · folga de cota                           o menor entre requisições e tokens do dia
      − 0,15 · pressão de cota                         proporcional, quando a folga fica abaixo de 25%
      − 0,10 se degradado, − 0,05 se em teste de recuperação
```

**Evidência de produção:** `shared/production-evidence.json` soma ajustes à nota do benchmark quando um modelo se comporta mal na criatura real ao longo de muitos ciclos, o que o benchmark não mede. Cada ajuste registra a data e a evidência. Desde 25/11, o gpt-oss-120b e o gpt-oss-20b têm −0,3 em cotidiana e criatividade.

**Exclusões** (cada uma registrada com o motivo):
- provedor sem chave, ou provedor/modelo desligado pelo responsável;
- termos do provedor proíbem o ambiente (NVIDIA em produção), exceto quando o responsável liga `allowTrialInProduction`, como fez em 25/11;
- modelo não homologado para a categoria;
- circuit breaker aberto;
- contexto acima de 80% da janela do modelo;
- limite diário de requisições ou de tokens atingido.

**Afinidade:** se o modelo do ciclo anterior na mesma categoria estiver a até 0,08 do melhor, ele continua. Isso dá continuidade a conversas e projetos sem prender a escolha a um modelo indisponível, porque um modelo com breaker aberto já foi excluído antes.

**Modo manual:** o responsável pode fixar um modelo por categoria no painel. Se esse modelo estiver indisponível, o roteador volta à ordem automática.

## Fallback

- **Até 3 tentativas por ciclo.** Cada uma reserva orçamento local e global, chama o modelo, valida a resposta e só então registra o resultado.
- **Erros que passam para o próximo modelo:** 503/5xx, 429, timeout, rede, cota esgotada, JSON inválido, esquema incompatível e resposta truncada ou vazia.
- **Erros permanentes:** credencial inválida, incluindo o HTTP 400 "API key not valid" do Gemini, e modelo inexistente. Esses desabilitam o modelo e não são repetidos.
- **Quando todos falham:**
  - o estado é preservado;
  - um registro `erro` com código `cognicao_indisponivel` guarda a rota completa;
  - a simulação do corpo continua normalmente;
  - nenhuma decisão é inventada;
  - a próxima tentativa é marcada para quando o primeiro modelo sair do breaker (entre 2 e 30 min).

## Circuit breaker

Fica na tabela `model_health` (migração 0010), por modelo e por ambiente, e sobrevive a reinícios do Worker.

| Evento | Efeito |
|---|---|
| sobrecarga, timeout ou rede | `indisponivel`; espera de 2, 4, 8, 16, depois 30 min (máx.), com jitter de ±15%, respeitando `Retry-After` |
| limite por minuto (429) | espera de `Retry-After` ou 1, 2, 4, 8 min |
| cota diária esgotada | espera até a virada da cota |
| resposta inválida | 1ª e 2ª: `degradado`, ainda chamável; a partir da 3ª seguida: indisponível por 10 a 60 min |
| autenticação ou modelo inexistente | `desabilitado` até ação do responsável |
| sucesso | `operacional`; falhas zeradas; médias sobem 20% |

Quando chega a hora de nova tentativa, o modelo volta a ser chamável, com uma penalidade leve de "em teste". O primeiro sucesso o reintegra. Uma única falha move as médias só 20%, então não derruba um bom modelo; uma sequência de falhas abre o breaker, e o modelo deixa de ser chamado enquanto estiver indisponível.

## Orçamento

O livro-razão continua sendo as tabelas `budgets` e `calls`: local por ambiente, e compartilhado entre produção e homologação em `bunborn-budget`. Agora o controle é por modelo, com:
- RPM, RPD, TPM (tokens reservados no último minuto) e TPD (tokens efetivamente usados no dia, conforme o provedor informa);
- dia de cota próprio de cada provedor (Pacífico para o Gemini, UTC para Groq e NVIDIA);
- cerca de 10% de cada modelo reservados para quando há mensagens pendentes.

Mais modelos **não** aumentam o ritmo: continua no máximo uma decisão a cada 5 min em produção.

## Transparência

Cada `intencao` guarda em `route`: categoria e motivo, modelo e provedor escolhidos, motivos técnicos, candidatos elegíveis com pontuação, excluídos com motivo, tentativas (resultado, latência e tokens), número de fallbacks, tokens, latência e resultado da validação. Um ciclo em que todos falharam guarda a rota no registro `erro`.

A aba **Provedores** (só para o responsável) mostra as últimas 30 rotas. Esses são motivos técnicos de roteamento, e não intenções da criatura.

## Diagnóstico dos 503

Situação antes da arquitetura multiprovedor (produção, 145 chamadas de 24/11 01:13Z a 25/11 ~16:50Z):

- **Resultado das chamadas:** 91 com sucesso (63%), **38 HTTP 503** (26%) e 16 falhas de execução (timeouts e respostas fora do esquema). Todas no Gemini; o Flash também respondeu 503 durante as quedas do Lite (25/11 16:19Z).
- **Horário:** os 503 se concentram entre 11 e 16h UTC, pico de uso nos EUA e na Europa.
- **Janelas sem cognição:**
  - 24/11 12:56–23:37 (10,7 h). Agravada pela espera que dobrava até 6 h, corrigida em 25/11.
  - 24/11 06:21–08:59 (2,6 h).
  - 25/11 12:58 até pelo menos 16:50 (3,8 h).
  - Mais 7 janelas curtas, de 0,1 a 0,6 h.
- **Custo:** os 503 não gastaram tokens, mas contaram como requisições no nosso livro-razão. As falhas gastaram 27,6 mil tokens (4,5% do total), quase tudo em respostas truncadas ou inválidas.
- **Efeito na criatura:** enquanto o Gemini estava fora, ela não decidia. O corpo seguiu as regras (fome, sede e sono subiram, e houve sono involuntário), e a proteção determinística de descanso ficou registrada como regra, não como escolha.
- **Inatividade depois de dormir ou comer:** nos casos de 24 e 25/11, a maior parte vinha de regras do motor, já corrigidas em [COGNITION.md](COGNITION.md): unidades de tempo, despertar e saciedade. As paradas de horas inteiras vinham dos 503 somados à espera exponencial.
- **Não houve:** loops nem tempestades de tentativas, porque as tentativas são serializadas no Durable Object, uma por ciclo. Também não houve erros de autenticação nem cota diária esgotada.
