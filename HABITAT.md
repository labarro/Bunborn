# Habitat (casa v2, 26/11/2026)

O habitat deixou de ser um cômodo único de 12×12 e virou uma casa isométrica pequena, com seis ambientes ligados por portas. O motor continua sendo a fonte de verdade: posições, acessos, atividades, jardim e obras expostas vêm do estado persistido. O navegador só desenha o que o estado diz.

## Arquitetura

| Parte | Arquivo | Papel |
|---|---|---|
| Planta, objetos e regras | `shared/house.ts` | Grade 20×16, cômodos, paredes nas bordas, portas, tipos de objeto, pegada, `pathfind`, `approach`, `validLayout`, `migrateObjects`, catálogo |
| Mundo | `shared/world.ts` | Período do dia, estações, clima, temperatura sentida, céu (lua, meteoros) e crescimento das plantas: tudo calculado a partir de `virtualMinutes` |
| Motor | `worker/engine.ts` | Migração única, ferramentas da casa, percepção de observar, contexto do cômodo e do mundo |
| Aprovação de pedidos | `worker/http.ts` (`/api/resource`) | Item do catálogo vira o objeto daquele tipo, colocado num cômodo onde caiba |
| Obras na casa | `worker/http.ts` (`/api/state` → `works`) | Conteúdo real das obras expostas e da música que estiver tocando |
| Renderização | `src/habitat/*.ts` | Pintor de pixels, sprites, coelho paramétrico, cena Phaser, áudio |
| Interface | `src/HabitatView.tsx`, `src/App.tsx` | Câmera, cômodos, tela cheia, modo imersivo, som e inspeção |

## Distribuição dos cômodos

```
 y\x  0 ............ 5 | 6 ............ 13 | 14 ........ 19
 0-5  Quarto            | Estúdio            | Banheiro
      porta (3,5)-(3,6) | porta (9,5)-(9,6)  | porta (16,5)-(16,6)
 6-10 Sala (0-9)                  arco (9..10, 7-8)   Cozinha (10-19)
      porta da frente (4,10)-(4,11)        porta dos fundos (15,10)-(15,11)
11-15 Jardim (ao ar livre, com cerca)
```

Portas internas:
- **Quarto–estúdio:** (5,3)-(6,3).
- **Estúdio–banheiro:** (13,2)-(14,2).

**Paredes.** As paredes ficam nas bordas entre células. As do fundo (y = 0 e x = 0) são altas e têm janelas. As internas são baixas (30 px) e ficam translúcidas quando ela está logo atrás delas. A da frente e a do lado direito são um recorte baixo, para que nenhuma parede esconda a criatura.

## Sistema de objetos

Cada objeto do estado guarda `id`, `label`, `kind`, `color`, `x`, `y` e, se precisar, `w` e `h` e `artifactId`. O tipo (`kinds` em `shared/house.ts`) define:
- **pegada** (1×1, 2×1, 1×2, 2×2 ou 3×3);
- **montagem:**
  - `floor`: tapetes e flores, pisáveis;
  - `wall`: janelas e molduras, presas a uma parede;
  - sem montagem: o objeto ocupa células;
- **o que oferece:** `dormir`, `descansar`, `observar`, `expor`, `tocar`, `jardinar`;
- **onde pode ficar:** dentro de casa, fora ou nos dois;
- **se é uma estação do corpo:** essas não podem ser guardadas;
- **se a cor pode mudar.**

Os onze ids da versão 1 continuam iguais (`cama`, `comida`, `higiene`, `terminal`, `mesa`, `estante`, `diario`, `atelie`, `bau`, `descanso`, `planta`). Por isso registros, atividades e obras expostas continuam válidos. Objetos novos da casa padrão:
- **Quarto:** mesa de cabeceira com abajur, armário, tapete, janela e moldura.
- **Estúdio:** janela e moldura.
- **Banheiro:** pia com espelho, toalheiro, tapete e janela.
- **Sala:** sofá, poltrona, mesa de centro, tapete, luminária, janela e moldura.
- **Cozinha:** despensa, pia, fogão e mesa.
- **Jardim:** 3 canteiros, banco, árvore e flores.

**Ponto de uso.** Ela usa um objeto a partir de uma célula vizinha, do mesmo lado de qualquer parede. A frente tem preferência: na frente do terminal, ao pé da cama, diante da banheira (`usePoints`). Se a frente estiver bloqueada, vale um lado.

## Navegação

- **Caminho:** `pathfind` é uma busca em largura sobre as células livres e só passa por portas.
- **Escolha do destino:** `approach` escolhe o melhor ponto de uso alcançável.
- **Visual dos saltos:** os saltos seguem esse mesmo caminho, sem atravessar paredes nem móveis. Se não houver caminho visual (por exemplo, quando a casa muda com ela parada), o coelho some e reaparece no lugar; ele nunca atravessa paredes.
- **Falhas gráficas:** um erro na parte gráfica nunca trava o motor, porque a simulação não depende do navegador.

`validLayout` só aceita um arranjo se:
- nada se sobrepõe;
- cada objeto cabe inteiro num único cômodo, sem atravessar paredes;
- nada fica em cima de porta;
- objetos de parede estão numa parede;
- coisas de fora ficam fora e coisas de dentro ficam dentro;
- todas as portas continuam alcançáveis;
- todo objeto pode ser usado a partir de onde ela está.

## Interações e personalização

As ferramentas tipadas (contratos em `shared/tool-contracts.json`) são:

| Ação | O que faz |
|---|---|
| `atividade` com `objectId` | Descansar ou observar num objeto que ofereça isso (sofá, poltrona, banco, janela, árvore, canteiro, telescópio) |
| `mover` | Reposiciona um objeto, também entre cômodos, e traz de volta um objeto guardado |
| `decorar` | Muda a cor de um objeto que permita ou das paredes de um cômodo |
| `guardar` | Tira um objeto de cena (estações do corpo e janelas não podem ser guardadas) |
| `expor` | Coloca uma obra num objeto: cavalete, estante, molduras, baú, mesas, vitrine |
| `jardim` | Plantar, regar ou colher num canteiro |
| `catalogo` | Mostra, sob demanda, o que pode ser pedido |
| `recurso` com `catalogId` | Pede um item do catálogo; o observador aprova ou recusa |
| `tocar` | Toca uma composição dela (formato `musica`) num instrumento que exista |

Nada disso é obrigatório: o prompt diz isso com essas palavras. As recusas trazem o motivo como fato. Por exemplo, ao tentar mover algo que não existe, ela recebe: "mover reposiciona objetos da casa…".

## Persistência

Tudo fica em `state`:
- **objetos e posições:** `objects`;
- **cores das paredes:** `house.walls`;
- **objetos guardados:** `house.inventory`;
- **canteiros:** `house.garden`, com espécie, momento do plantio e regas.

Céu, clima, estação, estágio das plantas e animações não são gravados, porque são recalculados a partir do relógio virtual. Assim não há escrita extra no D1. Fechar ou atualizar o navegador não desfaz nada, porque a interface remonta a casa a partir do estado.

O relógio visual é estendido entre duas consultas usando o próprio `updatedAt` e o `multiplier` do estado; o relógio local nunca é uma fonte independente. Com o tempo em pausa, o relógio fica parado.

## Integração cognitiva

O contexto traz:
- **`situation.room`:** o cômodo em que ela está;
- **`situation.objects`:** os objetos desse cômodo, com posição;
- **`otherRooms`:** os demais objetos, só por id;
- **`garden`, `stored` e `wallColors`:** só quando existem;
- **`world`:** período, estação, tempo, ar e vento.

A casa inteira não é enviada a cada decisão. A observação devolve o que ela vê: o lado de fora (tempo, lua, estrelas, meteoros pela luneta, estágio dos canteiros) ou o cômodo, com as obras expostas.

`nada_novo_para_observar` agora também considera o tempo lá fora: uma mudança de período ou de clima é algo novo para ver.
- **Assinatura:** toda observação iniciada guarda a assinatura da casa e do mundo, e a próxima só é aceita se essa assinatura mudar.
- **Empate corrigido:** na homologação de 26/11, mover um objeto e observar no mesmo ciclo gerava um empate de horário que liberava observações seguidas. Isso está corrigido e coberto por teste.

Medido no contexto real da Lumi (backup de 26/11): sistema mais contexto passou de 24.392 para 26.161 bytes (+7%, cerca de 520 tokens por decisão).

## Migração (versão 1 → casa)

A migração acontece uma única vez, dentro do ciclo travado (`migrateHouse`), quando `state.house?.version !== 2`:
- **Mantido:** ids, rótulos, cores e obras expostas.
- **Movimentos dela:** quando ela tinha movido um objeto no quarto antigo, o deslocamento é reaplicado no cômodo novo se ainda formar um arranjo válido. Senão, o objeto vai para a posição padrão e isso fica registrado.
- **Decorações aprovadas:** vão para lugares livres da sala ou do estúdio.

**Registro.** A migração é registrada como `habitat` de origem `sistema`, com o texto "Alteração externa do ambiente (desenvolvimento do Bunborn, não uma escolha sua)…", sem sugerir como ela deve se sentir.

**Lumi (produção, 26/11):**
- 9 objetos mantidos no lugar padrão;
- a estante, que ela tinha movido, preservada com o mesmo deslocamento;
- a mesa de volta ao padrão, porque o deslocamento cairia em cima do terminal;
- as 3 obras expostas mantidas (estante, ateliê e baú).

## Clima, estações e céu

- **Clima:** muda em blocos de 4 horas virtuais, seguindo uma cadeia suave (nunca do sol direto à tempestade). As condições são limpo, nublado, neblina, chuva leve, chuva forte, tempestade e neve (chuva com temperatura ≤ 2 °C).
- **Estações:** duram 14 dias virtuais. Elas inclinam a cadeia do clima (primavera mais úmida, verão com tempestades, outono com neblina, inverno frio) e mudam a duração do dia, a cor da grama e a árvore.
- **Temperatura:** é só percebida; não é uma necessidade.
- **Lua:** ciclo de 16 dias.
- **Meteoros:** algumas noites por estação.
- **Sem custo:** sem API meteorológica e sem IA.

## Jardim

**Espécies:** girassol, tomate, cenoura, lavanda, morango e alface.

**Crescimento:** é determinístico.
- **Regras:** cada hora virtual com terra úmida conta. A terra fica úmida por 20 horas depois de uma rega, ou quando chove. O estágio vai de 0 (semente) a 4 (pronta).
- **Sem cobrança:** terra seca só faz a planta esperar; nada morre e nada é cobrado dela.
- **Colheita:** colher libera o canteiro e gera um registro `jardim`. Não existe necessidade nova.

## Limitações

- **Microscópio e bancada científica:** ficaram fora do catálogo de propósito, para não apresentar experimentos simulados como ciência.
- **Música:** o toca-discos e o teclado tocam composições que já existem; compor continua sendo `criar` no formato `musica`.
- **Pintura do coelho:** é paramétrica. A cor vem do traço `aparencia` (hex), quando ela definir um.
- **Iluminação:** é uma camada multiplicativa mais luzes aditivas, sem sombras dinâmicas projetadas por objeto.
- **Paredes internas:** ficam translúcidas só quando ela está logo atrás.
- **Desempenho:** medido apenas em Chromium headless sem GPU (44 FPS de dia, 32 FPS na tempestade, 51 MB de heap).
