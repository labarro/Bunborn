# Bunborn

Uma pequena existência para observar: vida artificial de um coelho em pixel art, com identidade emergente, memória persistente, necessidades simuladas, pesquisa, projetos e obras. Roda sozinha na Cloudflare, sem navegador nem computador ligados. **Bunborn é o nome do aplicativo, nunca o da criatura.** A criatura nasce sem nome, interesses ou personalidade; isso fica para as experiências dela.

> O verdadeiro jogo é observar quem a criatura se torna, e não controlar quem ela deve ser.

Não é consciência real comprovada. Necessidades e emoções são estados computacionais; aprender significa guardar evidências e atualizar memórias, projetos e estado, sem treinar pesos.

## Estado em 24/11/2026

| Item | Situação |
|---|---|
| Produção | https://bunborn-production.luiisaugustoobad.workers.dev — **observatório público**: qualquer pessoa com o link observa e pode deixar mensagens; administração, backups e nascimento exigem a credencial do responsável. Implantada com o código final testado, **sem criatura** (`state=null`), `BIRTH_ENABLED=false`. O nascimento é reservado ao usuário. |
| Homologação | https://bunborn-homologation.luiisaugustoobad.workers.dev — criatura **descartável** em experimento autônomo de 24h (2026-11-24 00:35Z → 2026-11-25 00:35Z, teto de 110 chamadas, encerramento automático pelo Cron). |
| Testes | 45 unitários/integração + 6 E2E (Chromium + Worker + DO + D1 locais) aprovados. 40/40 verificações remotas de segurança e isolamento. |
| Backup v2 | Exportação e restauração real em banco isolado, com dados idênticos. |
| CPU Free | Gateway: P99 de 0,5–1,3 ms no Cron e 4,7–7,1 ms no HTTP. DO: P99 de até ~42 ms, sem erro. Ressalva sobre o limite do DO em ECONOMY.md. |
| Pendências | Concluir e analisar as 24h; verificar o funcionamento com o PC desligado (procedimento abaixo); acompanhar o crescimento do D1. Relatório completo em [REPORT.md](REPORT.md). |

## Observatório público (produção)

Divulgue o link https://bunborn-production.luiisaugustoobad.workers.dev: quem abrir vê o habitat, a linha do tempo, memórias, diário, personalidade, interesses, projetos, obras, conversas e o monitoramento, com atualização a cada 3 minutos. **Sem credencial, um visitante pode**: ler tudo e deixar mensagens de até 500 caracteres (3 por hora por IP e 30 por hora no total; no máximo 24 aguardando). Essas mensagens chegam à criatura marcadas como `visitante`, e ela decide se responde, adia ou ignora. **Só o responsável** (botão "Entrar como responsável") pode pausar ou mudar o relógio, exportar ou restaurar, aprovar recursos, forçar verificação do motor e fazer o nascimento. Tudo o que for exibido é público: não escreva nada privado nas suas mensagens. Leituras públicas podem estar até 30 s defasadas (cache do gateway). A homologação continua privada.

Capacidade gratuita: cada aba aberta faz ~480 requests/dia ao Worker (no Free são 100 mil/dia por conta, somando tudo). Dá para centenas de abas abertas o dia inteiro; com público muito maior, as requisições passam a falhar com erro (nunca há cobrança) até a virada do dia UTC, e a criatura continua viva porque o Cron é independente.

## Arquitetura resumida

React + TypeScript + Vite; habitat Phaser procedural. Um Worker serve os assets e funciona como gateway autenticado; um Durable Object SQLite (`CognitionCoordinator`) executa ciclos, API e cognição em série; D1 guarda toda a história (append-only) e um banco separado guarda o orçamento Gemini compartilhado. Gemini `gemini-3.1-flash-lite` é o modelo principal e `gemini-3-flash-preview` faz revisões complexas, sempre com a mesma identidade. Wikipedia/Wikidata são usadas só para leitura. Detalhes em [ARCHITECTURE.md](ARCHITECTURE.md), [COGNITION.md](COGNITION.md), [MEMORY.md](MEMORY.md), [ECONOMY.md](ECONOMY.md), [TESTS.md](TESTS.md).

## Executar localmente

Requer Node.js 24.

```powershell
npm ci
npm run db:local
npm run build
npm run dev:worker   # http://127.0.0.1:8787
```

Em desenvolvimento, crie `.dev.vars` (ignorado pelo Git) com `OBSERVER_SECRET`, `SESSION_SECRET` (≥ 32 caracteres cada) e, opcionalmente, `GEMINI_API_KEY`. Nunca use variáveis `VITE_*` para secrets.

```powershell
npm test               # 45 testes (SQLite real + adaptador D1; fixtures explícitas)
npx playwright install chromium
npm run test:e2e       # 6 testes; banco descartável em .wrangler/e2e
```

## Secrets nesta máquina

Os secrets ficam criptografados com Windows DPAPI em `.wrangler/private/` (ignorado pelo Git) e os helpers os leem só em memória. Para entrar como observador:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\copy-observer-secret.ps1 -Environment production
```

Cole o valor no botão **Conectar** da URL correspondente. Em outra conta Windows, será preciso reconfigurar os secrets (`scripts/configure-gemini.ps1`).

## Operação (scripts)

| Comando | Efeito |
|---|---|
| `node scripts/deploy.mjs homologation\|production` | Implanta e configura secrets sem imprimi-los |
| `npx wrangler d1 migrations apply DB --remote --config wrangler.<amb>.jsonc` | Migrações aditivas |
| `node scripts/real-homologation.mjs status` | Estado/uso da homologação → `artifacts/remote-status.json` |
| `node scripts/real-homologation.mjs start-autonomous 24 110` | Experimento descartável (prazo e teto aplicados pelo servidor) |
| `node scripts/real-homologation.mjs stop` | Encerra o experimento (pausa, estado preservado) |
| `node scripts/real-homologation.mjs tools [cenários]` | Cenários **induzidos** no banco isolado de ferramentas |
| `node scripts/remote-metrics.mjs 24` | CPU (Worker/Cron/DO) e D1 pelo GraphQL → `artifacts/remote-metrics.json` |
| `node scripts/remote-backup.mjs` | Backup real da homologação + restauração em `bunborn-recovery` (precisa estar vazio) |
| `node scripts/remote-security.mjs` | Verificações remotas de segurança (sem nascimento) |
| `node scripts/visual-review.mjs` | Capturas Chromium das URLs reais → `artifacts/visual/` |
| `node scripts/verify-offline-window.mjs --windows-log` | Prova de execução com o PC desligado (abaixo) |
| `node scripts/secret-scan.mjs` | Procura secrets reais e padrões nos arquivos versionáveis |

`npm run check:models` e `npm run test:gemini` são helpers antigos de chamada direta e **não passam pelo orçamento compartilhado**: não os use.

## Verificar o funcionamento com o computador desligado

O Cron ter executado não prova, sozinho, que a existência continua com o PC desligado. Para comprovar:

1. Com o experimento (ou, depois, a criatura permanente) ativo, desligue ou suspenda este computador por pelo menos 1 hora. Feche todos os navegadores antes.
2. Ao religar, rode `node scripts/verify-offline-window.mjs --windows-log homologation` (ou `production`).
3. O script lê no log do Windows o último par desligamento/suspensão → inicialização/retomada (eventos 6006/1074/42 → 6005/1) e cruza essa janela com evidências gravadas só pela Cloudflare: decisões (`intencao`), chamadas ao Gemini, ciclos medidos e minutos com invocação de Cron. O resultado vai para `artifacts/offline-window-<ambiente>.json`. Também é possível informar a janela manualmente: `node scripts/verify-offline-window.mjs <inícioISO> <fimISO> homologation`.

## Procedimento de nascimento (exclusivo do usuário)

Nenhum agente deve executar estes passos. A produção permanece vazia até você decidir.

1. **Revise a homologação**: leia [REPORT.md](REPORT.md) e confira se o experimento terminou (`node scripts/real-homologation.mjs status`). Opcional e recomendado: faça a verificação com o PC desligado.
2. **Libere a cota para a produção**: em `wrangler.homologation.jsonc`, defina `"EXPERIMENT_ENABLED": "false"` e reduza `LITE_DAILY_LIMIT`/`FLASH_DAILY_LIMIT` (por exemplo, 0) se não for mais usar a homologação. Implante com `node scripts/deploy.mjs homologation`.
3. **Libere o nascimento**: em `wrangler.production.jsonc`, mude `"BIRTH_ENABLED": "false"` para `"true"`. Rode `npm test`, `npm run build` e `node scripts/deploy.mjs production`.
4. **Nasça uma única vez**: abra https://bunborn-production.luiisaugustoobad.workers.dev, conecte-se com a credencial de produção e clique em **Preparar o primeiro instante**. O servidor verifica banco vazio, modelos disponíveis, Free confirmado e cota, e emite um desafio de 5 minutos. Marque o consentimento, digite `QUERO INICIAR ESTA EXISTENCIA` e clique em **Dar início à história**. O desafio só pode ser usado uma vez, e um segundo nascimento é impossível.
5. **Feche a porta**: volte `BIRTH_ENABLED` para `"false"` e reimplante. Isso não para a existência; só impede qualquer nova tentativa de nascimento.
6. **Confirme a continuidade**: depois de ~10 minutos, veja a Linha do tempo e o Monitoramento. Feche o navegador e, mais tarde, rode `verify-offline-window.mjs ... production`.
7. **Backups**: periodicamente, em Configurações, pause → **Exportar existência completa** → retome. Guarde também `npx wrangler d1 export DB --remote --config wrangler.production.jsonc --output existencia.backup.sql`. Os arquivos contêm toda a história privada.

Nunca reutilize um banco de teste para a produção, nunca altere o `database_id` da produção, nunca rode migrações destrutivas e lembre que trocar o `SESSION_SECRET` invalida backups v2 antigos.

## Limitações reais

- Personalidade e interesses emergentes **ainda não foram demonstrados** de forma espontânea; ver REPORT.md. Fixtures e cenários induzidos validam mecanismos, não emergência.
- Cotas Gemini reais do projeto não foram comprovadas por endpoint; os tetos usam os valores informados pelo usuário. HTTP 503 ("high demand") do Gemini ocorreu de fato e é tratado com backoff.
- O armazenamento gratuito é finito (projeções em ECONOMY.md). Não há SLA no Free.
- A defesa contra prompt injection é em camadas, sem imunidade semântica garantida. A criatura muda de aparência apenas por cor; não há uploads, código arbitrário nem outras fontes além de Wikipedia/Wikidata.
