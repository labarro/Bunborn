# Direção de arte do Bunborn

Um mundo pequeno, aconchegante e observável por muito tempo: pixel art isométrica 2D, luz macia, cores quentes, nenhuma imagem de terceiros. Tudo é desenhado por código no carregamento (`src/habitat/pixel.ts`, `sprites.ts`, `rabbit.ts`). Não há asset externo, licença a rastrear nem download.

## Identidade

- **Perspectiva:** isométrica 2:1, com célula de 32×16 px. Paredes do fundo têm 64 px de altura; paredes internas, 30 px (baixas, para não esconder a criatura); a parede da frente é um recorte de 9 px.
- **Pixel art de verdade:** sem suavização (`antialias: false`, `pixelArt`, `roundPixels`). Toda forma é rasterizada nos centros dos pixels e tem contorno de 1 px em `#3b2c3f`, nunca preto puro.
- **Volume em três tons:** topo mais claro (+12%), face direita média (−12%), face esquerda escura (−28%), com uma aresta de brilho nas bordas da frente. O escurecimento puxa levemente para o azul e o clareamento para o quente, como luz pintada.
- **Sombras de contato:** discretas (alfa de 46, menor para trás), só sob a base do objeto.
- **Formas reconhecíveis:** cada objeto tem um detalhe que o identifica (lombadas na estante, tela brilhante no terminal, colcha e travesseiro na cama, torneira na banheira, frutos nos canteiros). Nenhum móvel é só uma caixa.

## Paleta

| Uso | Cores |
|---|---|
| Madeiras | `#b88b68`, `#8a6149`, `#a77d5e` |
| Paredes (por cômodo, mudáveis por ela) | quarto `#d9c4d8`, estúdio `#cdd8c5`, banheiro `#c3dddb`, sala `#e6d1b6`, cozinha `#ecdcab` |
| Pisos | tábuas `#c09a80`, `#b78e72` e `#b9906f`; ladrilhos do banheiro `#e6eeec`/`#c9dcdc`; da cozinha `#e8d3b4`/`#c99a73` |
| Jardim | grama da primavera `#8fbf6a`, verão `#86b061`, outono `#a9a764`, inverno `#c7d1c4`; pedras `#cdbfae` |
| Tecidos | sofá `#8fa37e`, poltrona `#c48a6a`, tapetes `#c79bb0` e `#b8a2c8` |
| Luz | abajur `#ffc777`, tela `#7fe0d0`, sol na janela `#fff0c4` |
| Contorno | `#3b2c3f` (coelho `#3a2c45`) |

## Escala

- **Coelho:** cerca de 22 px de altura num quadro de 32×32, com os pés em (16, 29). Fica à altura do assento do sofá e metade da altura de uma mesa.
- **Móveis:** baixos com 6 a 20 px, mesas com 21 a 25 px, estantes e armários com 54 a 57 px, e a árvore com cerca de 60 px.

## Coelho

O corpo é paramétrico: elipses sombreadas para corpo, cabeça, coxa, patas, focinho e orelhas giradas a partir da base. Assim todos os quadros mantêm as mesmas proporções e a cor da pelagem dela (`identity.traits.aparencia`, em hex).
- **Direções:** `front` olha para a frente-esquerda e `back` para o fundo; o espelhamento dá as outras duas direções isométricas.
- **Quadros:** respirar, piscar, orelhas, focinho, orelhas caídas, agachar e saltar, comer, se lavar, descansar, espreguiçar, cavar, usar a pata (escrever, pintar, tocar), ficar em pé, deitar e dormir.
- **Animações:** são detalhes locais. Nunca geram registro nem chamada de IA, e só aparecem para a atividade que está persistida:
  - **dormir:** deitada sobre a cama;
  - **banho:** dentro da banheira, com a borda desenhada na frente dela;
  - **descanso:** no assento;
  - **demais atividades:** de frente para o objeto (terminal, diário, cavalete, canteiro, janela).

## Luz e tempo

- **Céu:** gradiente pelo nível de luz do dia, com tom quente ao amanhecer e ao entardecer e cinza na chuva. À noite, estrelas e lua com fase; de dia, o sol com seu trajeto. Ao longe, morros em duas camadas e nuvens em pixel.
- **Janelas:** são furos nas paredes, por onde se vê esse céu (e a chuva). Durante o dia, a luz do sol entra pelas janelas e forma manchas no piso que se deslocam com o sol.
- **Ambiente:** uma camada multiplicativa: branca de dia, azul à noite, quente no crepúsculo, cinza com o tempo fechado. Abajur e luminária acendem com a escuridão, com halos em faixas suaves (aditivos), e a tela do terminal tem um brilho frio.
- **Clima:** chuva só onde não há telhado, mais uma camada atrás das paredes para aparecer nas janelas. Neve, neblina sobre o lado de fora, relâmpago (um clarão breve) e plantas balançando conforme o vento.
- **Efeitos:** contidos. Nenhum filtro cobre a leitura dos sprites.

## Convenções para objetos e ambientes futuros

1. Adicione o tipo em `kinds` (`shared/house.ts`): pegada, montagem, o que oferece, onde pode ficar, se é estação, se muda de cor. Se puder ser pedido, inclua-o em `catalogue`.
2. Desenhe em `drawObject` (`src/habitat/sprites.ts`) com `Iso.box`, `panelL`/`panelR`, `ellipseTop` e detalhes pixel a pixel. Siga a ordem de três tons, use contorno e sombra de contato, e inclua um detalhe que identifique o objeto.
3. Se o objeto puder expor obras, use `placeArt`, que desenha os pixels reais da obra, nunca uma imagem genérica.
4. Confira na prévia de desenvolvimento (`npm run dev` → `/preview.html?vm=600&room=sala&zoom=1.6`), de dia e de noite, com e sem chuva, antes de publicar.
5. Não copie assets, personagens nem ambientes de jogos de referência. As referências (Stardew Valley, Unpacking, A Little to the Left, The Sims, Animal Crossing) servem só como nível de aconchego.
