# Mundo vivo (27/11/2026)

O mundo acontece por conta própria, mesmo quando a Lumi dorme. Os acontecimentos vêm de regras do motor (`shared/events.ts`) sobre o relógio virtual e o mundo já existente (`shared/world.ts`): clima, estações, céu e jardim.
- **Sem custo:** nenhum acontecimento chama IA.
- **Sem gravação para existir:** o mesmo instante sempre produz os mesmos acontecimentos.
- **Só o percebido é gravado:** o registro `ambiente` guarda o que ela de fato percebeu.

## Acontecimentos

| Tipo | Condição | Frequência | Como se percebe |
|---|---|---|---|
| Começa a chover / a chuva para | Troca de bloco do clima (4 h virtuais) entre seco e chuva | Conforme a cadeia do clima | Ouvido em qualquer lugar |
| Poças no caminho | Ao parar de chover; duram 6 h | Depois de cada chuva | Vistas (jardim ou janela) |
| Arco-íris | A chuva para de dia, com céu limpo ou nublado, em 45% desses casos; dura 40 min | Raro | Visto |
| Tempestade | Bloco de tempestade | Raro (mais no verão) | Ouvida |
| Neblina | Bloco de neblina | Mais no outono | Vista |
| Começa a nevar | Chuva com ar ≤ 2 °C | Raro (inverno) | Visto |
| Vento forte | Vento > 0,7 | Variável | Ouvido |
| O ar esquenta ou esfria bastante | Variação ≥ 7 °C entre blocos | Raro | Sentido |
| Lua cheia / céu muito estrelado | Noite limpa, fase da lua (ciclo de 16 dias) | Algumas noites por ciclo | Visto |
| Chuva de meteoros | Noite limpa, cerca de 12% das noites | Raro | Visto |
| Borboletas | Primavera ou verão, dia limpo, 50% dos dias, em hora fixa por dia | Comum | Vistas |
| Pássaros ao longe | Fora do inverno, sem chuva, 60% das manhãs | Comum | Ouvidos |
| Flores abrindo | Primeiros 4 dias da primavera | Sazonal | Vistas |
| Folhas caindo | Outono com vento | Sazonal | Vistas |
| Planta pronta para colher | Canteiro chega ao estágio 4 | Quando acontece | Vista |

Cada acontecimento tem um id persistente determinístico (por exemplo, `arco-iris:121`), início, fim, onde ocorre (céu, jardim, casa, ar), como pode ser percebido e se é raro. A lista é extensível: novos tipos entram em `weatherEvents` ou `dailyEvents`.

Há períodos tranquilos por construção. Os acontecimentos dependem das condições, não do ciclo cognitivo, e nada é gerado para evitar repetição.

## Percepção

`perceiveWorld` roda dentro do ciclo, sobre o intervalo desde o último ciclo. Para cada acontecimento, verifica qual era a atividade dela naquele instante:
- **Dormindo:** não percebe nada.
- **Sons e mudanças de temperatura:** chegam a qualquer cômodo.
- **Coisas para ver:** exigem que ela esteja no jardim ou olhando para fora (observando uma janela, um canteiro, a árvore, o banco ou o telescópio).

São no máximo 3 registros por ciclo, um por acontecimento (sem duplicar). O texto diz como foi percebido: "Viu pela janela: um arco-íris sobre o jardim.", "Ouviu: começa a chover.".

Uma borboleta que passou enquanto ela dormia existe no mundo (o observador vê em `/api/world`), mas não vira memória nem percepção dela.

## Integração cognitiva

O contexto traz:
- **`world.noticed`:** os últimos acontecimentos percebidos;
- **`world.changedSinceLastDecision`:** por exemplo, "manhã → tarde", "nublado → chuva leve";
- **estado atual:** período, estação, tempo, ar e vento.

Observar uma janela, o jardim ou o telescópio devolve o que se vê lá fora. Ela pode investigar, observar, ignorar ou recordar o que percebeu; nada pede reação.

## Interações e objetos

- **Base:** as interações da casa (HABITAT.md) continuam valendo.
- **`ir`:** caminhar até um cômodo ou objeto.
- **Experimentos:** usam os canteiros (EXPERIMENTATION.md).
- **Objetos pessoais:** livros, cadernos e pinturas continuam sendo artefatos reais expostos em objetos, e os objetos guardados ficam no inventário (`house.inventory`).
- **Não implementado:** o inventário ainda não tem "importância declarada" nem histórico de uso por objeto. O histórico de cada objeto vem dos registros `habitat` que o citam (aparece na inspeção).

## Representação visual

- **O que aparece na casa:** arco-íris (no céu, atrás das paredes), borboletas no jardim, pássaros cruzando o céu, poças no caminho e folhas caindo da árvore.
- **Fonte:** o mesmo `activeAt(vm)` que o motor usa, de modo que o que aparece corresponde ao estado do mundo.
- **Noite:** ficou menos escura (luz ambiente `#7179ad`, antes `#56609a`).
- **Marcador:** um marcador discreto acima da Lumi quando a câmera está afastada.

## Persistência e custo

Não há escrita para os acontecimentos em si. Só a percepção grava, com até 3 registros curtos por ciclo, e na prática bem menos: a maioria dos ciclos não percebe nada. Os cálculos varrem no máximo 3 dias virtuais.

## Limitações

- **Percepção de visão:** depende da atividade e da posição no momento do ciclo, não de um campo de visão.
- **Teste na prévia:** os acontecimentos visuais podem ser forçados apenas na prévia de desenvolvimento (`?events=`), para capturas, e isso fica identificado nelas.
