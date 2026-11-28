# Neural Atlas (28/11/2026)

O Neural Atlas é o mapa interativo do que a Lumi pesquisou, aprendeu, relacionou, usou e lembrou. Ele é construído **somente a partir dos registros persistentes do Bunborn**.

**Não é a rede neural interna do Gemini, da Groq ou da NVIDIA**, nem acesso ao raciocínio privado dos modelos. Também não é medida de inteligência ou de consciência.

## O mapa anterior

| Problema | Causa |
|---|---|
| Pontos amontoados no centro, nomes cortados ("limites da simulação c"), textos sobrepostos | Posicionamento simples em SVG, rótulos sem controle de colisão |
| Nenhuma linha | Zero registros `relacao`: a ação `relacionar` exigia dois conceitos, e os "conceitos" eram as próprias buscas |
| "Conceitos" como "continuidade philosophical identity persistence memory" e "limites da simulação computacional" ×4 | Cada pesquisa gravava automaticamente um `conceito` com o texto da consulta |

## Dados: o que existe e de onde vem

| Tipo de nó | Registro de origem | Quem cria |
|---|---|---|
| Consulta | `pesquisa`, agrupada pelo texto normalizado (minúsculas, sem acento); os `conceito` antigos com `researchId` entram aqui | Ferramenta de pesquisa |
| Conhecimento com fonte | `memoria` com `status: fonte_consultada` (resultado da pesquisa, com links) | Motor, a partir da fonte |
| Conceito | `conceito` sem `researchId`, criado pela nova ação `conceito` (nome, descrição, aliases, evidências) | Ela |
| Interesse, projeto, obra, experimento, habilidade, procedimento | Os registros já existentes (última versão de cada entidade) | Ela |
| Memória | `memoria` dela citada como evidência, ou entre as 24 mais lembradas | Ela |

Mudanças no motor:
- uma pesquisa **não cria mais** um conceito; a consulta e o resultado continuam como `pesquisa` e `memoria` com fontes;
- a nova ação `conceito` registra uma ideia que ela entendeu, com evidências;
- `relacionar` liga dois conceitos.

**Sem migração destrutiva.** Os 20 `conceito` antigos continuam no banco e aparecem como as consultas que são. Nenhum dado foi alterado.

## Ligações e origens

Cada ligação tem uma origem identificável e um estilo próprio:

| Origem | Exemplos | Visual |
|---|---|---|
| `fonte` | conceito "fundamentado em" um conhecimento com fonte; `relacionar` com status `fonte_consultada` | linha cheia, mais brilhante |
| `declarada` | evidências citadas por ela (interesse, projeto, conceito); `relacionar` como opinião | linha cheia |
| `motor` | consulta "resultou em" conhecimento; obra "faz parte de" projeto; memória "lembra" o registro associado | linha fina |
| `hipotese` | `relacionar` com status `hipotese` | tracejada dourada |
| `inferida` | "termos em comum": consultas ou conceitos com Jaccard ≥ 0,34 nas palavras de conteúdo (até 2 por nó) | pontilhada, discreta, marcada "inferida pelo sistema; não é uma associação dela" |

Nenhuma ligação é criada para evitar nós isolados, e os nós sem ligações continuam visíveis. Os termos parecidos não são fundidos: aparecem como ligações inferidas, e a decisão de que são o mesmo conceito fica com ela (`aliases`).

## Áreas (agrupamentos)

São determinísticas e surgem dos dados:
- consultas, conhecimentos e conceitos ligados entre si se unem primeiro (union-find);
- os demais nós seguem os vizinhos por propagação de rótulos;
- cada área tem o nome do seu nó mais central (interesses, projetos e conceitos têm prioridade), em palavras inteiras.

Na Lumi, em 28/11: "Filosofia da identidade em simulações" (29), "arte pós-internet new media art" (10), "A falta que habita o código" (7), "Projeto de Autoconhecimento" (6), "sono e saúde virtual" (4) e outras.

As cores são estáveis: cada área começa no espaço da paleta dado pelo hash do seu id e passa ao próximo livre, de modo que duas áreas nunca dividem a mesma cor. A paleta usa violeta, azul, ciano, verde, rosa e dourado sobre um céu escuro.

## Visual

- **Desenho:** canvas 2D próprio, com d3-force para o layout (cerca de 17 KB comprimido no pacote do Atlas, carregado só quando a aba é aberta). Não há WebGL nem biblioteca paga.
- **Neurônios:** núcleo com gradiente claro, halo suave e anéis conforme o tipo (consulta com um anel, conceito com dois). As formas também variam: ◆ interesse ou projeto, ■ obra, ▲ experimento, ⬡ habilidade ou procedimento.
- **Sinapses:** curvas quadráticas com gradiente entre as cores das duas áreas, um brilho largo e fraco sob a linha fina, e espessura e opacidade conforme a origem. Um ponto indica a direção quando a relação é direcional.
- **Céu:** gradiente profundo e estrelas com cintilação lenta. O cintilar é decorativo e não tem significado.
- **Tamanho do nó:** o critério é escolhido nos filtros e mostrado na legenda:
  - ligações, que medem estrutura e não domínio do assunto;
  - fontes e evidências;
  - vezes lembrada;
  - vezes consultada.
- **Detalhe por distância:** acima de 400 nós com zoom afastado, o Atlas desenha pontos e linhas simples.

## Layout

- **Forças:** repulsão proporcional ao tamanho, atração por ligação (mais fraca nas inferidas), colisão e atração suave para a âncora da área (espiral áurea).
- **Posições preservadas:** são guardadas neste navegador (`localStorage`). Nós novos nascem perto dos vizinhos, e a simulação de uma rede conhecida só se acomoda, sem se reorganizar inteira.
- **Reorganizar:** um botão recalcula tudo quando o observador quiser.
- **Câmera:** é enquadrada no primeiro carregamento e quando o layout assenta. Depois que o observador move a câmera, as atualizações automáticas nunca a reposicionam.

## Interação

- **Navegar:** zoom com roda ou pinça, arrastar a vista, arrastar nós, e selecionar nó ou ligação.
- **Destacar:** passar o cursor destaca o nó, suas ligações e seus vizinhos, e escurece o resto.
- **Rótulos:** colocados por prioridade (foco, vizinhos, tamanho, tipo) sem sobreposição e somente quando cabem inteiros na tela. A quantidade cresce com o zoom, e o nome completo está sempre no cursor e no painel.
- **Painel de detalhes:**
  - tipo, área e origem;
  - primeiro registro e atualização;
  - descrição real ("Ainda não há descrição registrada" quando não houver);
  - contagens, confiança e estado;
  - fontes com links (só http/https);
  - ligações navegáveis, cada uma com sua origem.
- **Ligação selecionada:** o painel explica a origem, e as inferidas e hipóteses são ditas como tais.
- **Busca:** por nome, alias ou descrição (tecla `/`); Enter centraliza o primeiro resultado.
- **Teclado:** `+` e `-` para zoom, `0` para a visão geral, `Esc` para limpar a seleção, `F` para tela cheia.
- **Tela cheia (modo imersivo):** os controles ficam discretos nas bordas.
- **Camadas:** Conhecimentos, Experiências, Interesses, Projetos, Aprendizado e Tudo. Uma camada só aparece se houver dados para ela; Aprendizado está oculta enquanto não houver habilidades, procedimentos ou experimentos.
- **Filtros:** tipos, origens das ligações, nós isolados e critério de tamanho, com opção de restaurar o padrão. Os filtros não destroem as posições.
- **Indicadores** (na legenda, cada um com o método): consultas, conhecimentos com fonte, conceitos declarados, relações dela, hipóteses abertas, nós usados em algo, novos em 7 dias, áreas. Não há índice de inteligência e a densidade não é medida de nada.

## Atividade registrada

Os eventos vêm de registros dos últimos 3 dias:
- **aquisição:** pesquisa, resultado com fonte ou conceito novo;
- **associação:** relação nova;
- **aplicação:** obra, projeto, experimento, habilidade ou procedimento que cita evidências;
- **revisão:** nova versão de um conceito;
- **recuperação de memória:** última vez que cada memória foi lembrada (`retrievals.last_at`).

A página consulta `/api/atlas` a cada minuto (com cache de 60 s no servidor). Eventos novos viram pulsos nos nós (anel na cor do tipo de evento), nós novos surgem com uma animação, e uma associação nova percorre a própria sinapse. Nada pulsa sem um registro.

**Limite:** o histórico completo de recuperações não era gravado, só a contagem e a última vez. Por isso a recuperação aparece apenas no momento mais recente de cada memória.

## Reprodução histórica

Uma linha do tempo vai do nascimento até agora, com reproduzir, pausar, arrastar, velocidade (1×, 2×, 4×, 8×) e volta ao presente. Nós e ligações aparecem no instante do primeiro registro (`real_at`), que é confiável. Os acontecimentos anteriores a 24/11 não existem, porque a Lumi nasceu nesse dia.

## Integração com a cognição

- **Contexto:** `knowledge.concepts` traz só os conceitos declarados (até 10, com descrição curta). `knowledge.relations` traz as relações entre eles (até 10). O grafo completo nunca vai ao modelo.
- **Prompt:** "conceito registra uma ideia que você entendeu, com evidências (uma busca, sozinha, não é um conceito), e relacionar liga dois conceitos. Nada disso é obrigatório."
- **Aprendizado:** habilidades, procedimentos e experimentos (LEARNING.md) entram no mapa pelas evidências que citam.

## Desempenho e custo

| Rede | FPS no layout | Depois de assentar ou com zoom |
|---|---|---|
| Lumi (103 nós, 70 ligações) | 60 | 60 |
| Sintética, 600 nós | 60 | 60 |
| Sintética, 1.500 nós | 51 | ≥ 40 |

Medido em Chromium headless sem GPU. O heap ficou em 16 MB.

- **Servidor:** uma consulta indexada por minuto, compartilhada por todos os visitantes (cache), sem escrita no D1 e sem chamada de IA.
- **Tamanho:** a resposta da Lumi tem cerca de 70 KB. As obras vão sem conteúdo, só com o formato.

## Testes

- **Automáticos** (`tests/atlas.test.ts`):
  - consultas antigas e novas são consultas, normalizadas e contadas;
  - toda ligação tem origem válida e extremidades reais;
  - inferências e hipóteses ficam marcadas;
  - nós isolados permanecem;
  - URLs `javascript:` são descartadas;
  - os agrupamentos são determinísticos;
  - sem registros recentes não há atividade;
  - camadas sem dados ficam ocultas;
  - as cores não colidem;
  - os rótulos não se sobrepõem nem saem da tela;
  - a pesquisa não cria conceito, a ação `conceito` cria, e as relações voltam no contexto e no endpoint.
- **Revisão visual:** prévia de desenvolvimento (`/atlas-preview.html`), com dados do backup, uma rede pequena e redes sintéticas identificadas como tal. Capturas em `artifacts/atlas/`.

## Limites

- **Rede pequena:** a de hoje é pequena, porque reflete o que existe (15 consultas, 15 conhecimentos com fonte, nenhum conceito declarado ainda). Ela cresce com o que a Lumi fizer.
- **Agrupamentos:** são por estrutura e termos, sem embeddings.
- **Posições:** ficam neste navegador, e outro navegador começa do zero.
- **Desempenho acima de alguns milhares de nós:** não foi testado.
