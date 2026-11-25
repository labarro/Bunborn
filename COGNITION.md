# Cognição simulada

## Natureza do sistema

Uma identidade persistente, dois modelos como modos de processamento. Nenhum subagente, prompt de personalidade pré-fabricada ou lista de hobbies. O ambiente sabe como funcionar; a criatura ainda não possui nome nem preferências pessoais no nascimento. Curiosidade e criatividade iniciais são parâmetros operacionais, não interesses definidos.

Aprender significa guardar evidências e atualizar representações recuperáveis. Não se modificam pesos de modelos. Justificativas são relatos públicos estruturados, não acesso ao raciocínio privado do modelo. O projeto não afirma consciência, sofrimento ou experiência subjetiva.

## Referências e adaptação

- [Generative Agents](https://arxiv.org/abs/2304.03442): inspiração para percepção, memória relevante, reflexão e planos que se mantêm entre ciclos. Não herdamos personagens, horários ou interesses do estudo.
- [Soar — memória semântica](https://soar.eecs.umich.edu/soar_manual/06_SemanticMemory/) e [episódica](https://soar.eecs.umich.edu/soar_manual/07_EpisodicMemory/): separar conhecimento contextual de conhecimento generalizado. Não usamos o runtime Soar nem alegamos implementar sua teoria cognitiva.
- [Oudeyer e Kaplan, 2007](https://www.frontiersin.org/journals/neurorobotics/articles/10.3389/neuro.12.006.2007/full): distinguir exploração de homeostase e evitar reduzir toda iniciativa à satisfação de necessidades. Aqui motivação é sinal funcional para decisões do modelo, não algoritmo de reinforcement learning.
- Memória autobiográfica é uma narrativa versionada apoiada em episódios. A página DOI de Conway e Pleydell-Pearce (2000) não pôde ser inspecionada por bloqueio de robôs nesta sessão; não foi usada como evidência de implementação.

## Contrato de decisão

`decisionSchema` exige intenção, justificativa curta, próximo intervalo real, pedido opcional de cognição complexa e até três ferramentas. O servidor impõe um piso entre chamadas bem-sucedidas: 5 min reais em produção e 15 min na homologação (por cota); o piso vigente é informado em `facts.minimumRealMinutesBetweenDecisions`. O máximo proposto é 60 min. Revisões complexas ocorrem aproximadamente a cada 24 decisões ou por solicitação validada por orçamento.

O contexto recupera no máximo 14 memórias, 12 interesses, 10 projetos, 10 conceitos, 8 resumos de artefatos, 10 acontecimentos e 8 mensagens. Conteúdos grandes são reduzidos; limite adicional de 56 KB do contexto evita gastos imprevisíveis. O modelo pode decidir ficar sem ações; o tempo e a identidade continuam.

Ferramentas: atividade física, pesquisa, relação entre conceitos existentes, leitura de obra persistida, recuperação dirigida de memórias, diário, mensagem ao observador, memória, identidade, interesse, projeto, criação, mover objeto, expor obra e solicitar recurso virtual. Não existem ferramentas de terminal, rede arbitrária, publicação ou pagamento.

Leitura de obras recupera o conteúdo real, permitindo revisão e continuidade, e não apenas um título. Os dois resultados mais recentes de leitura ficam disponíveis no próximo contexto. Há seleção adicional por bytes, reduzindo listas de menor prioridade sem remover os registros do banco; o contexto informa quantos itens foram omitidos. Uma ferramenta não pode gastar chamadas Gemini adicionais por conta própria.

## Evidências e identidade

Toda alteração declarada de identidade requer IDs de registros existentes. Um campo pode mudar no máximo uma vez por hora real e mudanças posteriores precisam apresentar evidência nova. Nome escolhido é preservado: alterações posteriores são rejeitadas nesta versão. As demais características possuem versão e valor anterior. Aparência aceita uma cor hexadecimal.

Interesses são textos abertos com origem rastreável, força limitada a mudanças de 0,1 e necessidade de nova evidência em revisões. Força disponível no contexto decai exponencialmente com tempo virtual, escala de 30 dias; isso é regra explícita, não um dado observado. O estado declarado (ativo, adormecido ou abandonado) vem de decisão da criatura. Ela pode retomar o mesmo ID sem perder história.

Personalidade distingue declarações (`identidade`) de observações (`comportamento`: contagens reais das últimas 24 atividades físicas). Não há classificador que invente traços inferidos. Esses espaços podem divergir; o observador vê ambos e as origens.

Projetos possuem etapas, horizonte e status. Conclusão exige todas as etapas e ao menos um artefato associado; marcar etapa nova requer citar um artefato real do projeto. Isso verifica existência de produção, não sua qualidade intelectual. Obras são versionadas pelo mesmo ID e podem ser retomadas. Mudanças de plano permanecem no histórico.

## Necessidades e consequências

Fome, sede e sono crescem com tempo virtual; energia e higiene diminuem; conforto depende de carências; saúde se recupera ou cai conforme conforto, sempre sem morte. Comer, beber, dormir, higiene e repouso restauram seus atributos ao longo da duração registrada. Baixo conforto afeta saúde; fome e sono são visíveis no contexto para que influenciem a escolha do modelo sem determinar uma sequência fixa.

Pesquisa reduz tédio e aumenta curiosidade; produção eleva satisfação/criatividade; falha de ferramenta eleva frustração; mensagem emitida reduz vontade de interação. Valores e regras são declarados em código e não devem ser apresentados como emoções humanas medidas. A qualidade de desempenho cognitivo sob privação ainda precisa de avaliação real; não há promessa de que o modelo obedecerá a cada influência.

## Pesquisa e reflexão

Pesquisa retorna resumos públicos reais e os guarda com fonte e horário. Cache é identificado e conserva a data da consulta original. Consulta sem resultado é registrada sem fabricação de conhecimento. Fontes consultadas não significam fatos confirmados; há hipóteses, opiniões, ficção e incerteza. Relações entre conceitos exigem dois conceitos já registrados e evidência; status indica alegação, nunca verdade científica automaticamente verificada.

Reflexão pode gerar diário ou memória autobiográfica mediante evidências. Durante descanso, uma consolidação determinística diária agrupa trechos de memórias selecionadas, identificada como índice sem nova inferência. A narrativa interpretativa precisa ser escrita pelo modelo e permanece declarada, não medida.

## Expressão visual

O rosto, as orelhas e o ícone do coelho são uma projeção legível do estado simulado (`shared/expression.ts`), calculada com limiares fixos de sono/energia, sede, fome, frustração, satisfação+conforto, curiosidade e tédio. Não é um sentimento declarado pela criatura nem uma inferência do modelo; a interface mostra o motivo (por exemplo, "sono 78, energia 22").

## Corpo e fisiologia (25/11)

Necessidades são regras do corpo, não escolhas. Por hora virtual acordada: fome +5, sede +6, sono +3,5, energia −3 (−3 a mais com fome/sede ≥ 80; −2 a mais com saúde < 50), higiene −1,5. Comer tira 100 de fome em ~20 min, beber 100 de sede em ~15 min, dormir tira 15 de sono e dá 12 de energia por hora, descansar dá 15 de energia. Fome ou sede ≥ 90 tiram 4 de saúde por hora cada (sono ≥ 95 tira 2); a saúde nunca fica abaixo de 10 (a criatura é imortal). Com sono 100 ou energia ≤ 5 ela adormece sozinha por 4 h virtuais (registro `corpo`, origem `simulacao_deterministica`), e não consegue interromper esse sono enquanto o sono estiver acima de 60. Com energia ≤ 15, sono ≥ 95, fome ≥ 95 ou sede ≥ 95, tarefas exigentes (pesquisar, criar, projeto, relacionar, mover, organizar) são recusadas com `corpo_sem_condicoes`. O contexto traz `body`: fatos do corpo em linguagem simples, sem dizer o que fazer.

Motivo: em produção, Lumi chegou a fome, sede e sono 100 com saúde 30. Comer 10 min tirava só 15 pontos e nada tinha consequência.

Sono limita a energia disponível: o teto de energia é 100 − 2×(sono − 60) quando o sono passa de 60 (sono 80 → 60, 95 → 30, 100 → 20). Antes era possível ter sono 97 com energia 76.

## Capacidades reais (25/11)

`pesquisar` consulta fontes reais, sem chave e com origens fixas (o modelo só escolhe o texto da busca): Wikipedia em português e em inglês, Wikidata, Wikcionário, Open Library (livros) e arXiv (artigos científicos). `criar` gera obras em texto ou em pixels (até 32x32 com paleta própria), `mover` reposiciona móveis e `expor` coloca uma obra num objeto. Essas capacidades estão descritas como fatos do ambiente no prompt, sem sugerir temas. Pesquisar, escrever no diário, criar e mover substituem automaticamente uma atividade passiva (observar, descansar, organizar), e a substituição é registrada como interrupção. Antes, essas ações eram recusadas com `atividade_em_andamento` sempre que ela estava observando, o que explica o diário bloqueado várias vezes. Comer, beber, dormir, higiene, criar e pesquisar em andamento continuam bloqueando, assim como o sono involuntário.

## Revisão de 25/11: tempo parado, motivações e backup

- **Unidades de tempo:** ela escolhia "dormir 60" (minutos virtuais, ou seja, 10 min reais) e "nextMinutes 60" (minutos reais), e por isso acordava e ficava 50 min parada. Agora, quando a atividade e a fila terminam, a próxima decisão vem assim que o ritmo mínimo permite (5 min em produção); `nextMinutes` passou a ser só a espera máxima enquanto ela está ocupada. O contexto explica as unidades (`timeUnits`) e diz se a atividade ainda está em andamento (`activityStatus`).
- **Motivações com dinâmica:**
  - Tédio: sobe 4/h parada e 1,5/h em atividade passiva; cai com pesquisar, criar, diário, mensagens e mover móveis.
  - Frustração: cai 3/h (antes só subia).
  - Satisfação: volta para 50 com o tempo e cai enquanto há necessidade crítica.
  - Motivação: acompanha energia, saúde, satisfação e frustração.
  - Curiosidade e vontade de criar: crescem com o tédio e diminuem ao pesquisar ou criar.
- **Backup:** o esquema estrito do estado não aceitava os campos novos `involuntary` e `lastDecisionAt`, e um backup feito depois de 25/11 02:27Z seria recusado na restauração. Corrigido, e o estado real de produção foi conferido contra o esquema.

## Falhas do provedor (25/11)

Sobrecarga (503), timeout e resposta malformada esperam 5, 10 e depois 20 min, no máximo. Antes, a espera dobrava até 6 h: 7 erros 503 seguidos deixaram Lumi parada por 5h20 em 24/11. Uma intenção longa demais agora é cortada no limite em vez de descartar a decisão. Uma atividade escrita como tipo (`{type:"observar"}`) é lida como `atividade`. Rejeições repetitivas ganharam detalhe: `ja_registrado` para identidade, e etapas de projeto aceitam como evidência qualquer trabalho próprio novo (`etapa_sem_evidencia`).

## Validação por ação

Uma ação malformada (por exemplo, `evidence` vazio) não invalida mais a decisão inteira: as demais ações são executadas, e a malformada vira uma rejeição `acao_malformada` com o campo problemático, visível para a criatura no ciclo seguinte.

## Retorno de erros

Rejeições de ferramentas trazem código e detalhe factual no ciclo seguinte: referências inexistentes (`missing`) com a lembrança de que campos de contexto e nomes de ferramentas não são registros; atividade em andamento com atividade atual, estação exigida, minutos virtuais restantes e fila. Isso foi introduzido depois de observar, nas 25 decisões reais da primeira criatura descartável, três tentativas seguidas de diário recusadas sem explicação e citações como `"diario"` e `"facts.decisionNumber:24"` como evidência. É informação sobre o ambiente; não sugere o que fazer nem impõe objetivos.

## Observações reais até agora

- Primeira criatura descartável (25 decisões reais com relógio controlado, de 23:39 a 00:04Z): manutenção física, organização, descanso, diário e reflexão repetida sobre a própria natureza simulada. Nenhum nome, interesse, pesquisa, projeto ou obra espontâneos. Repetição alta ("finalizar a alimentação" quatro vezes). Arquivada em `bunborn-recovery`. Seu registro de nascimento foi gravado por uma versão anterior do código com o texto da existência principal; o histórico é imutável e não foi corrigido retroativamente.
- **Criatura permanente (produção)**, nascida em 24/11/2026 01:13:21Z pelo usuário: na 3ª decisão (01:45Z) escolheu sozinha o nome **"Lumi"**, citando como evidência um registro próprio, sem sugestão de ninguém. Antes disso, uma decisão (01:39Z) foi perdida por uma ação com `evidence` vazio, o que motivou a validação por ação. Uma mensagem "oi" de visitante chegou antes do nome.
- Segunda criatura descartável: nascida em 24/11/2026 00:35:04Z para o experimento autônomo de 24h em tempo real. Resultados no relatório (`REPORT.md`), sempre separando comportamento espontâneo de influência do observador. Uma mensagem de teste de segurança (HTML inerte) foi enviada a ela; é influência explícita do observador.
- Cenários **induzidos** em banco separado demonstraram pesquisa, criação de projeto e obras (texto e pixels) e demais ferramentas (detalhes em TESTS.md). Por definição, não são interesses da criatura.

## Limites de autonomia

O modelo escolhe dentre ferramentas permitidas e pode recusar sugestões do observador. Autonomia é simulada, limitada por orçamento, infraestrutura e capacidades implementadas. Não afirmamos emergência até observar execuções reais e analisar repetição, coerência, diversidade e retomada por período prolongado. Testes dirigidos de nome, projetos e interesses demonstram somente os respectivos mecanismos.
