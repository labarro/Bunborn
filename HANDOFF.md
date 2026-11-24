# Bunborn — passagem de trabalho

Estado em 24/11/2026 ~01:00 UTC. Este documento prevalece sobre os demais. Relatório completo: `REPORT.md`.

## Regras (inalteradas)

- Agente único, sem subagentes. Não recriar o projeto. A criatura é um coelho em pixel art sem nome, interesses ou personalidade impostos; Bunborn é o nome do app.
- Só serviços gratuitos (Workers Free e Gemini Free sem faturamento, confirmados pelo usuário). Sem modelos locais, sem provedores alternativos.
- **NUNCA executar o nascimento permanente.** Reservado ao usuário (README → Procedimento de nascimento).
- Não apresentar fixtures, cenários induzidos ou tempo acelerado como autonomia. Repositório público: nunca versionar secrets.

## Acesso

Workspace `C:\projects\petsoso` (PowerShell + Git Bash, Node 24.13). Cloudflare OAuth (conta `c94a2b1ed3c401c62b4a8b112479ca18`) e GitHub (`labarro/Bunborn`) autenticados. Secrets em DPAPI em `.wrangler/private/` (helpers: `scripts/private-secrets.mjs`, `remote-client.mjs`, `copy-observer-secret.ps1`). O OAuth não tem Billing Read nem Workers Observability (403).

Bancos D1: `artifacts/cloudflare-resources.json`. Migrações 0001–0008 em production, homologation, tool-tests e recovery; budget na 0003.

## Estado remoto

- **URLs**: produção em **https://bunborn.devbarros.com** (Custom Domain declarado em `wrangler.production.jsonc` via `routes`, para que deploys não o removam; `https://bunborn-production.luiisaugustoobad.workers.dev` continua como endereço alternativo); homologação em https://bunborn-homologation.luiisaugustoobad.workers.dev.

- **Produção**: **criatura permanente nascida pelo usuário em 2026-11-24 01:13:21Z**. `BIRTH_ENABLED` foi liberado para o nascimento e fechado logo depois (`false`). **Observatório público** (`PUBLIC_OBSERVATION=true`: leitura + mensagens de visitantes com limite; administração só com credencial). `EXPERIMENT_ENABLED=false`; limites 360/12. Não há reset: nunca recriar, restaurar por cima ou migrar destrutivamente.
- **Homologação**: código final; `MIN_DECISION_MINUTES=15`; limites 80/8. **Experimento autônomo de 24h ativo** com a criatura descartável nº 2 (nascida 2026-11-24 00:35:04Z; fim 2026-11-25 00:35:05Z; teto de 110 chamadas). O Cron encerra e pausa sozinho. Uma mensagem de teste de segurança foi enviada a ela (influência declarada).
- **bunborn-recovery**: contém a criatura descartável nº 1 (25 decisões), restaurada e verificada idêntica. Para repetir o teste de restauração, use `scripts/sql/wipe-recovery.sql` **só neste banco** (o arquivo assinado também está em `.wrangler/private/backups/`).
- **bunborn-tool-tests**: criatura de ensaios induzidos (projeto `ensaio`, poema v2, pixels, música, objeto, pesquisa "água").
- Cotas: nunca foram zeradas. Ao arquivar a criatura nº 1, `budgets`/`calls`/métricas/heartbeats da homologação foram preservados.

## Pendências

1. Depois de 2026-11-25 00:35Z: `node scripts/analyze-experiment.mjs` e `node scripts/real-homologation.mjs status`; atualizar REPORT.md §9/§12 sem exagerar a emergência.
2. Verificação com o PC desligado: o usuário desliga ou suspende o PC por ≥ 1 h durante o experimento, depois `node scripts/verify-offline-window.mjs --windows-log homologation`.
3. Acompanhar `node scripts/remote-metrics.mjs 24` (CPU do DO: ambiguidade documental; leituras FTS crescendo com a história).
4. Depois das 24h, considerar `EXPERIMENT_ENABLED=false` e cota 0 na homologação, para a produção usar a cota global inteira.
5. Opcional: scripts antigos `check:models`/`test:gemini` não usam o ledger compartilhado; não usá-los.

## Interface

Coelho articulado em `src/habitat.ts` (respiração, piscar, orelhas, pulos com amassa e estica, poses por atividade). Expressão derivada do estado simulado em `shared/expression.ts`; deslocamento só em ações reais. "Entenda este registro" (`src/explain.tsx`) traduz registros para leigos sem adicionar significado; os detalhes técnicos ficam recolhidos.

Commits: **sem** linha `Co-Authored-By` (pedido do usuário).

## Comandos

`npm test` (45), `npm run test:e2e` (6), `npm run build`, `node scripts/deploy.mjs <amb>`, `node scripts/remote-security.mjs`, `node scripts/remote-backup.mjs`, `node scripts/visual-review.mjs`, `node scripts/secret-scan.mjs` (rodar antes de todo commit). Arquivos JSONC do Wrangler: use um parser JSONC.
