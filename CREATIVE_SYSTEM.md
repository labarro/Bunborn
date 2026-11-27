# Sistema criativo (27/11/2026)

## Formatos

Texto (até 12.000 caracteres), pintura (feita pelo Nemotron; ver COGNITIVE_AUDIT.md §12), música (até 128 notas) e objeto. O formato antigo de pixels continua válido para as obras existentes.

## Obras de longa duração

- **`obra_secao`:** acrescenta (`adicionar`) ou reescreve (`substituir`) uma seção `## título` de uma obra de texto existente, sem reenviar a obra inteira. Serve para capítulos, partes, anotações e rascunhos dentro da mesma obra.
- **Versões:** cada uso gera uma nova versão do mesmo artefato, com o texto completo guardado.
- **Contexto:** a obra aparece com a lista de seções (`sections`) e a última mudança (`lastChange`), não com o texto inteiro. Para ler o conteúdo, ela usa `ler_obra`.
- **Limite:** se a obra passar de 12.000 caracteres, a recusa sugere, como fato, começar outra obra (um segundo volume).

## Revisões verificáveis

Toda revisão (`criar` com um id existente, ou `obra_secao`) passa por `diffArtifact` (`shared/creative.ts`), que mede a mudança:

| Formato | O que se mede |
|---|---|
| Texto | caracteres a mais ou a menos, palavras novas e retiradas, % do vocabulário que mudou, número de seções |
| Pintura | traços novos ou alterados, removidos e mantidos; se a tela mudou |
| Música | número de notas, posições diferentes, andamento |

- **Sem alteração:** uma revisão idêntica é recusada (`revisao_sem_alteracao`) e nada é salvo; salvar a mesma coisa não conta como progresso.
- **O que fica gravado:** a versão de origem, o resumo da mudança, os detalhes, o objetivo declarado e a seção (quando houver).
- **Histórico:** é preservado, porque cada versão é um registro.

## Continuidade e liberdade

- Obras antigas podem ficar como estão: nada pede revisão e nenhuma qualidade crescente é exigida.
- A trajetória mostra ao observador as obras novas, as revisões com mudança medida e as obras longas com suas seções.

## Limites

- **Pintura incremental:** não existe pintura por camadas ou com edição localizada; cada versão é uma pintura completa feita pelo pintor.
- **Música:** não tem seções nomeadas; uma composição maior é uma revisão com mais notas.
- **Sem custo:** nenhuma API paga de geração.
