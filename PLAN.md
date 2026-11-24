# Plano de execução

## Contrato

Uma existência principal, nascimento explícito e único, **reservado ao usuário**; observação em português; nenhuma IA local, serviço pago ou faturamento. Implantação privada gratuita autorizada (Workers Free e Gemini Free sem faturamento confirmados pelo usuário). Testes apenas em existências descartáveis e bancos isolados.

## Arquitetura decidida antes da implementação

React/TypeScript/Vite; Phaser carregado sob demanda para habitat procedural em pixel art. Worker único serve assets e API no mesmo domínio. Cron de um minuto desperta motor; decisões em média a cada cinco minutos, sem dependência de navegador. D1 guarda estado singleton, registros imutáveis, versões, caixa de mensagens, reservas de orçamento e lease com fencing. Sem frameworks de agentes, embeddings, Vectorize ou Workers AI (um Durable Object SQLite foi adicionado depois como executor único, por causa da CPU; ver Decisões): recuperação textual indexada e pontuação de recência/importância/associações bastam. Ambos os Gemini compartilham estado e identidade.

## Etapas e aceitação

1. Fundação: migração, configuração segura, autenticação por secret do observador e cookie assinado, nenhum segredo no bundle.
2. Nascimento: singleton idempotente, relógio 6x, necessidades determinísticas, atividades recuperáveis, nenhuma morte.
3. Memória: oito categorias, busca limitada, consolidação vinculada a experiências, histórico preservado e exportação/restauração.
4. Autonomia: provedor real Gemini com JSON validado; ferramentas de pesquisa isoladas, interesses e projetos com evidência.
5. Criação: texto, pixels, música, objetos estruturados; versões reais, sem código arbitrário.
6. Habitat: isometria procedural, caminho com colisões, objetos funcionais e reposicionamento validado.
7. Observação: estado vazio honesto, todas as categorias navegáveis, mensagens, mapa e recursos.
8. Confiabilidade: reservas transacionais, lease, backoff, limites, backups e monitoramento.
9. Homologação: testes de integração com D1 local, fluxos de API, falhas, relógios controlados e revisão em navegador. Evidências emergentes reais somente após API configurada e observação prolongada.

## Referências consultadas em 2026-11-23

- [Generative Agents, Park et al.](https://arxiv.org/abs/2304.03442): percepção, recuperação, reflexão e planejamento; adaptar para um agente, sem copiar identidades do experimento.
- [Modelos Gemini](https://ai.google.dev/gemini-api/docs/models): `gemini-3.1-flash-lite`, `gemini-3-flash-preview`; disponibilidade do projeto ainda não homologada.
- [Structured output](https://ai.google.dev/gemini-api/docs/structured-output): JSON schema e validação adicional no servidor.
- [Cotas](https://ai.google.dev/gemini-api/docs/rate-limits): projeto, RPM/TPM/RPD, meia-noite America/Los_Angeles. Painel do projeto é autoridade sobre cotas observadas.
- [Preços](https://ai.google.dev/gemini-api/docs/pricing): não usar grounding Google nos modelos escolhidos; nenhuma troca automática de modelo.
- [Workers](https://developers.cloudflare.com/workers/platform/limits/), [Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/): 100 mil requests/dia Free, 10 ms CPU por invocação; tempo de rede não é CPU. Medição de CPU em produção é pendência.
- [D1 preços](https://developers.cloudflare.com/d1/platform/pricing/), [limites](https://developers.cloudflare.com/d1/platform/limits/), [batch](https://developers.cloudflare.com/d1/worker-api/d1-database/): 5 milhões linhas lidas/dia, 100 mil escritas/dia, 5 GB totais; limite por banco Free deve ser respeitado. Batch transacional e índices.
- [Vectorize](https://developers.cloudflare.com/vectorize/platform/pricing/): Free disponível, 30 milhões dimensões consultadas/mês e 5 milhões armazenadas; dispensável aqui.
- [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/): SQLite disponível em Free; dispensável aqui.
- [Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/): 10 mil neurons/dia Free; dispensável e sem integração.
- [MediaWiki](https://www.mediawiki.org/wiki/API:Search), [rate limits](https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits/FAQ), [Wikidata](https://www.wikidata.org/wiki/Wikidata:Data_access): leitura pública, User-Agent, timeout, backoff e cache.
- [OpenAlex](https://help.openalex.org/api/authentication/): uso casual sem chave, maior cota com chave gratuita; adiado para evitar mais secret/risco de orçamento.
- [arXiv](https://info.arxiv.org/help/api/tou.html): regras de uso e espaçamento; adiado. [Gutenberg](https://www.gutenberg.org/policy/robot_access.html): página indisponível na consulta (503), scraping não adotado. RSS arbitrário não adotado por SSRF.

## Limitações de contrato

Gratuidade e persistência histórica infinita não podem ser garantidas indefinidamente em cotas finitas. Não existe SLA de execução contínua em serviços Free. Suspender com estado preservado é preferível a cobrança, perda de história ou acontecimentos inventados. Cotas reais, CPU e emergência de personalidade não são verificáveis sem implantação e credenciais.

## Decisões durante implementação

- CSS autoral no lugar de Tailwind: tema pequeno e específico, sem biblioteca adicional de UI; React e Phaser mantidos.
- Workers Static Assets no lugar de Pages separado: frontend e API na mesma origem e um único deployment gratuito, simplificando cookies e CSRF.
- Exportação paginada para não exceder limite de consultas por invocação; restauração grande via SQL D1 nativo.
- Vitest atualizado para 5.1.1 após auditoria identificar vulnerabilidades transitivas na linha 3; Node 24 atende aos requisitos oficiais de migração.
- Referências adicionais consultadas: [Soar semântica](https://soar.eecs.umich.edu/soar_manual/06_SemanticMemory/), [Soar episódica](https://soar.eecs.umich.edu/soar_manual/07_EpisodicMemory/), [Oudeyer/Kaplan](https://www.frontiersin.org/journals/neurorobotics/articles/10.3389/neuro.12.006.2007/full), [Phaser Scenes](https://docs.phaser.io/phaser/concepts/scenes), [Vite](https://vite.dev/guide/), [migração Vitest](https://vitest.dev/guide/migration/).

## Direção visual

Habitat central em uma janela de observação, ameixa #292238, névoa #eee9f2, madeira #b88b68, musgo #a5bc8b, lavanda #b8a2d0 e ouro #dfbd7c. Tipografia de sistema humanista, títulos arredondados; pixels criados por primitivas, sem imagens remotas. Navegação lateral discreta, cenário amplo, caderno lateral de registros. A identidade visual é do ambiente; criatura começa sem identidade pessoal. Evitar métricas e atividades fictícias em estado vazio.

## Decisões da homologação (24/11/2026)

- **Worker como gateway fino + Durable Object executor**: o Worker Free tem 10 ms de CPU e as medições pré-mudança passavam disso (P99 de 12,5–96 ms no HTTP; 13,7 ms no Cron da produção antiga). Agora o Worker só autentica e encaminha. Leituras não entram na fila serial do DO; tarefas, sim.
- **Backup v2 com segmentos em tabela própria** (migração 0007), cadeia validada no selo, restauração idempotente em SQL, retomável e invisível enquanto parcial.
- **Reserva local antes da global**: evita que a homologação esgotada consuma a cota da produção.
- **Resolvedor de entidades** por UUID, id curto ou entityId (bug real revelado por ensaio induzido).
- **Erros de ferramenta com detalhe factual**: resposta à repetição observada nas decisões reais, sem roteirizar comportamento.
- **Piso de 15 min na homologação** para o experimento de 24h caber em 80 Lite/dia locais e 110 chamadas; produção mantém 5 min.
- **Nova criatura descartável para as 24h**: a primeira nasceu com um código anterior, cujo texto de nascimento era o da existência principal, e acumulou tempo acelerado. Foi arquivada (restaurada e verificada em `bunborn-recovery` + arquivos assinados locais). Os contadores de cota da homologação foram preservados.
- Referências revalidadas em 24/11/2026: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).
