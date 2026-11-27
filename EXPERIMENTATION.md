# Experimentação (27/11/2026)

A Lumi pode formular e executar experimentos cujos resultados são produzidos pelo motor da simulação, nunca pelo modelo de linguagem. Nada a obriga a experimentar.

## Ação `experimento`

| Ação | Campos | O que acontece |
|---|---|---|
| `iniciar` | `pergunta`, `hipotese`, `variavel`, `grupos` (até 4 canteiros, cada um com sua `condicao`) | Valida os canteiros, registra o experimento (`status: ativo`) e faz a primeira medição |
| `medir` | — | O motor mede de novo cada grupo |
| `concluir` | `conclusao` | Exige ao menos 2 medições; guarda a conclusão dela junto das medições |
| `abandonar` | — | Encerra sem conclusão |

Cada ação também inicia uma atividade curta no canteiro, porque medir exige ir até lá.

## Medições (do motor)

Para cada grupo, o motor registra:
- canteiro e condição declarada;
- espécie;
- crescimento (%) e estágio;
- horas de terra úmida;
- número de regas;
- se está à sombra;
- posição.

Também guarda o dia e a hora virtuais. Os valores saem de `growth()` e `bedLight()`, as mesmas regras que movem o jardim.

## Regras do mundo que podem ser descobertas

Regra 2 de crescimento, para plantas plantadas a partir de 27/11:
- uma hora com terra úmida conta inteira de dia e em sol pleno;
- conta 0,5 à sombra da árvore (até 2,5 células dela);
- conta 0,3 à noite;
- a terra fica úmida por 20 horas depois de regar, ou quando chove;
- nada morre sem cuidado.

As plantas que já existiam seguem a regra 1 (toda hora úmida conta igual), para não reescrever o passado.

**Variáveis possíveis:** rega (frequência), luz (mover um canteiro para perto ou para longe da árvore), espécie e momento do plantio.

## Hipótese, observação, resultado, interpretação

O registro separa:
- **o que é dela:** `hipotese` (antes) e `conclusao` (depois);
- **o que é do motor:** `medicoes`;
- **o alcance:** `escopo: "mundo virtual do Bunborn (regras da simulação)"`.

O prompt diz que o que vale neste mundo virtual não vale automaticamente para o mundo real. Conhecimento externo continua vindo de `pesquisar`.

## Validação

Coberto por `tests/learning.test.ts`:
- a sombra desacelera as plantas da regra 2;
- as plantas antigas mantêm o próprio passado;
- concluir sem conclusão é recusado;
- as medições são números do motor;
- o estado continua válido para backup.

## Limitações

- Os experimentos verificáveis hoje são só os de jardim. Clima e céu são observáveis, mas não manipuláveis.
- Não há análise estatística automática: a comparação das medições é dela.
