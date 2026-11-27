# Aprendizado (27/11/2026)

Aqui, "aprendizado profundo" significa a criatura usar experiências, conhecimentos e prática em decisões futuras. Nenhum peso de modelo é treinado ou alterado.

## Arquitetura

| Camada | Registro | Quem cria | Como volta ao contexto |
|---|---|---|---|
| Experiência episódica | `percepcao`, `ambiente`, `atividade_concluida`, resultados em `thread` | Motor (fatos) | Percepções recentes; resultado de cada ação (feita ou recusada e por quê) |
| Informação nova | `pesquisa`, `leitura` | Ferramentas reais | `knowledge.research` |
| Conceitos e relações | `conceito`, `relacao` | Ela | `knowledge.concepts` |
| Memória pessoal | `memoria`, `diario` | Ela | Recuperação com habituação e MMR (COGNITIVE_DIVERSITY.md) |
| Procedimento | `procedimento` | Ela, com evidências | `knowledge.procedures`, quando o contexto é relevante |
| Habilidade | `habilidade` | Ela, com evidências | `knowledge.skills` |
| Experimento | `experimento` | Ela (pergunta, hipótese, conclusão) e o motor (medições) | `knowledge.experiments`, se ativo |

## Habilidades emergentes

- **Sem lista fixa:** não existe árvore de habilidades, pontos ou níveis. Uma habilidade só existe quando ela a declara com `habilidade` (nome, descrição, técnicas, limitações), citando evidências que existem (obras, experimentos, pesquisas, registros).
- **Atualização:** pede ao menos uma evidência nova (`nova_evidencia_necessaria`).
- **Declarada × avaliada:**
  - a habilidade em si é declarada pela criatura;
  - as evidências são registros reais resolvidos pelo motor;
  - a "avaliação técnica" mostrada ao observador é só a contagem dessas evidências, sem nenhum nível inventado.
- **Sem retroatividade:** nenhuma habilidade foi atribuída à Lumi nem inferida do histórico. A lista começa vazia.

## Aprendizado procedural

- **O que é:** `procedimento` guarda um modo de fazer que ela descobriu (título, contexto entre pintura, escrita, música, jardim, pesquisa, experimento, organização ou outro, até 8 passos), com evidências.
- **Quando volta:** só quando o contexto da decisão é relevante.
  - criatividade ≥ 55 ou criando → pintura, escrita e música;
  - canteiros plantados ou estar no jardim → jardim;
  - pesquisando ou curiosidade ≥ 60 → pesquisa;
  - experimento ativo → experimento.

  No máximo 3 procedimentos.
- **Não é regra:** um procedimento não vira comportamento obrigatório. Ela pode tentar outro modo e registrar uma versão nova.

## Aprender com erros

- **O que conta:** recusas de ferramenta (com o motivo), percepções do corpo, revisões sem alteração e experimentos com resultado medido.
- **O que não conta:** falhas técnicas de provedor (HTTP 503, tempo esgotado) não aparecem para ela como experiência, porque acontecem antes de existir uma decisão.

## Conhecimento e ação

O contexto aproxima o que ela sabe do que está fazendo: procedimentos e habilidades por contexto, experimentos ativos com a última medição e obras longas com suas seções. Nada obriga a usar o conhecimento mais recente.

## Evidências e limitações

- Os mecanismos são testados de forma determinística em `tests/learning.test.ts`. Os testes com modelos reais estão no relatório.
- Escrever um texto "sobre aprender" não conta como aprendizado. Contam a aplicação e a mudança de ação, que o observador vê nos registros e na trajetória.
- **Associações:** dependem das evidências que ela cita. Não há grafo automático de conhecimento além de `relacao` e `record_links`.
