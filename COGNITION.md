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

## Retorno de erros

Rejeições de ferramentas trazem código e detalhe factual no ciclo seguinte: referências inexistentes (`missing`) com a lembrança de que campos de contexto e nomes de ferramentas não são registros; atividade em andamento com atividade atual, estação exigida, minutos virtuais restantes e fila. Isso foi introduzido depois de observar, nas 25 decisões reais da primeira criatura descartável, três tentativas seguidas de diário recusadas sem explicação e citações como `"diario"` e `"facts.decisionNumber:24"` como evidência. É informação sobre o ambiente; não sugere o que fazer nem impõe objetivos.

## Observações reais até agora

- Primeira criatura descartável (25 decisões reais com relógio controlado, de 23:39 a 00:04Z): manutenção física, organização, descanso, diário e reflexão repetida sobre a própria natureza simulada. Nenhum nome, interesse, pesquisa, projeto ou obra espontâneos. Repetição alta ("finalizar a alimentação" quatro vezes). Arquivada em `bunborn-recovery`. Seu registro de nascimento foi gravado por uma versão anterior do código com o texto da existência principal; o histórico é imutável e não foi corrigido retroativamente.
- Segunda criatura descartável: nascida em 24/11/2026 00:35:04Z para o experimento autônomo de 24h em tempo real. Resultados no relatório (`REPORT.md`), sempre separando comportamento espontâneo de influência do observador. Uma mensagem de teste de segurança (HTML inerte) foi enviada a ela; é influência explícita do observador.
- Cenários **induzidos** em banco separado demonstraram pesquisa, criação de projeto e obras (texto e pixels) e demais ferramentas (detalhes em TESTS.md). Por definição, não são interesses da criatura.

## Limites de autonomia

O modelo escolhe dentre ferramentas permitidas e pode recusar sugestões do observador. Autonomia é simulada, limitada por orçamento, infraestrutura e capacidades implementadas. Não afirmamos emergência até observar execuções reais e analisar repetição, coerência, diversidade e retomada por período prolongado. Testes dirigidos de nome, projetos e interesses demonstram somente os respectivos mecanismos.
