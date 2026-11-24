import { expect, test } from '@playwright/test';
import { born } from '../../shared/domain';
const origin = 'http://127.0.0.1:8788';
test.describe.serial('Disposable local Worker + D1 + browser', () => {
  test('renders honest empty habitat on desktop and mobile without runtime errors', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'O tempo também mora aqui.' })).toBeVisible();
    await expect(page.locator('canvas')).toBeVisible();
    await expect(
      page.getByText('Nenhuma criatura criada. Nenhuma atividade inventada.'),
    ).toBeVisible();
    await page.screenshot({ path: 'artifacts/habitat-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: 'Abrir navegação' })).toBeVisible();
    await expect
      .poll(() => page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().right))
      .toBeLessThanOrEqual(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: 'artifacts/habitat-mobile.png', fullPage: true });
    expect(errors).toEqual([]);
  });
  test('authenticates with HttpOnly session, protects origins, and blocks birth without Gemini', async ({
    request,
  }) => {
    // Public observatory: reading is open; administration is not.
    expect((await request.get('/api/state')).status()).toBe(200);
    for (const path of ['/api/settings', '/api/backup/begin', '/api/birth/prepare', '/api/tick', '/api/resource'])
      expect((await request.post(path, { headers: { origin }, data: {} })).status(), path).toBe(401);
    expect((await request.get('/api/export')).status()).toBe(401);
    expect((await request.post('/api/login', { data: { secret: 'wrong' } })).status()).toBe(403);
    const login = await request.post('/api/login', {
      headers: { origin },
      data: { secret: 'fixture-observer-for-local-tests-only-123456' },
    });
    expect(login.status()).toBe(200);
    expect(login.headers()['set-cookie']).toContain('HttpOnly');
    const birth = await request.post('/api/birth', { headers: { origin }, data: {} });
    expect(birth.status()).toBe(409);
    expect((await birth.json()).error).toBe('configuracao_pendente');
    expect((await (await request.get('/api/state')).json()).state).toBeNull();
  });
  test('restores disposable fixture, persists messages idempotently and preserves pause', async ({
    request,
    page,
  }) => {
    await request.post('/api/login', {
      headers: { origin },
      data: { secret: 'fixture-observer-for-local-tests-only-123456' },
    });
    const now = Date.now();
    const state = born(now);
    state.paused = true;
    const backup = {
      format: 'bunborn',
      version: 1,
      state,
      records: [
        {
          id: 'birth-fixture',
          entityId: 'birth-fixture',
          kind: 'nascimento',
          category: 'episodica',
          content: 'Nascimento FIXTURE descartável; não IA real.',
          data: { fixture: true },
          realAt: now,
          virtualAt: 0,
          importance: 1,
          confidence: 1,
          associations: [],
          origin: 'fixture',
        },
      ],
      budgets: [],
      calls: [],
      inbox: [],
      retrievals: [],
    };
    expect(
      (await request.post('/api/restore', { headers: { origin }, data: backup })).status(),
    ).toBe(200);
    expect(
      (await request.post('/api/restore', { headers: { origin }, data: backup })).status(),
    ).toBe(409);
    const msg = {
      content: '<script>window.hacked=true</script> Mensagem fixture',
      id: crypto.randomUUID(),
    };
    await request.post('/api/message', { headers: { origin }, data: msg });
    await request.post('/api/message', { headers: { origin }, data: msg });
    const tick = await request.post('/api/tick', { headers: { origin }, data: {} });
    expect((await tick.json()).status).toBe('pausado');
    const exported = await (await request.get('/api/export')).json();
    expect(exported.records).toHaveLength(1);
    expect(exported.inbox).toHaveLength(1);
    expect(exported.state.bornAt).toBe(now);
    await page.goto('/');
    await expect(page.getByText('Observatório público')).toBeVisible();
    await page.getByRole('button', { name: 'Entrar como responsável', exact: true }).click();
    await page
      .getByLabel('Credencial do observador')
      .fill('fixture-observer-for-local-tests-only-123456');
    await page.getByRole('button', { name: 'Conectar ao habitat' }).click();
    await expect(page.getByText('Observação conectada')).toBeVisible();
    await expect(page.getByText('Tempo em pausa')).toBeVisible();
    await expect(
      page.getByRole('img', {
        name: /^Habitat do coelho sem nome. Atividade registrada: observar. Expressão:/,
      }),
    ).toBeVisible();
    await page.screenshot({ path: 'artifacts/coelho-fixture.png', fullPage: true });
    await page.getByRole('button', { name: 'Linha do tempo', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Nascimento FIXTURE descartável; não IA real.' }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => Boolean((window as unknown as { hacked?: boolean }).hacked)),
    ).toBe(false);
    await page.getByRole('button', { name: 'Configurações e backups' }).click();
    await expect(page.getByRole('button', { name: 'Restaurar em banco vazio' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Exportar existência completa' })).toBeEnabled();
  });
  test('exports a signed v2 backup through gateway + Durable Object and freezes writes meanwhile', async ({
    request,
  }) => {
    expect((await request.get('/api/export', { headers: { cookie: 'observador=9999999999999.forged' } })).status()).toBe(401);
    await request.post('/api/login', {
      headers: { origin },
      data: { secret: 'fixture-observer-for-local-tests-only-123456' },
    });
    const begin = await request.post('/api/backup/begin', { headers: { origin }, data: {} });
    expect(begin.status()).toBe(200);
    const manifest = await begin.json();
    expect(manifest.version).toBe(2);
    const frozen = await request.post('/api/message', { headers: { origin }, data: { content: 'durante backup', id: crypto.randomUUID() } });
    expect(frozen.status()).toBe(409);
    let rows = 0;
    for (const table of Object.keys(manifest.upper)) {
      let after = 0;
      do {
        const page = await (await request.post('/api/backup/page', { headers: { origin }, data: { id: manifest.id, table, after } })).json();
        rows += page.count;
        after = page.next ?? 0;
      } while (after);
    }
    const seal = await (await request.post('/api/backup/seal', { headers: { origin }, data: { id: manifest.id } })).json();
    expect(seal.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(seal.headers.reduce((n: number, h: { count: number }) => n + h.count, 0)).toBe(rows);
    expect(rows).toBe(Object.values(manifest.counts as Record<string, number>).reduce((a, b) => a + b, 0));
    const after = await request.post('/api/message', { headers: { origin }, data: { content: 'depois do backup', id: crypto.randomUUID() } });
    expect(after.status()).toBe(200);
    // Target is populated: a restore must refuse to overwrite it.
    const refused = await request.post('/api/backup/restore/begin', { headers: { origin }, data: { manifest, seal } });
    expect((await refused.json()).error).toBe('restauracao_exige_banco_vazio');
  });
  test('visitors without credentials observe and leave rate-limited messages marked as visitor', async ({ playwright }) => {
    test.setTimeout(120000);
    const visitor = await playwright.request.newContext({ baseURL: origin });
    // Public reads may be up to 30 s stale (gateway cache); the restored fixture appears after that.
    await expect.poll(async () => (await (await visitor.get('/api/state')).json()).state, { timeout: 45000, intervals: [3000] }).not.toBeNull();
    expect((await visitor.get('/api/records?kind=todos')).status()).toBe(200);
    expect((await visitor.post('/api/message', { headers: { origin }, data: { content: 'x'.repeat(501), id: crypto.randomUUID() } })).status()).toBe(400);
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await visitor.post('/api/message', { headers: { origin }, data: { content: 'Olá de um visitante ' + i, id: crypto.randomUUID() } })).status());
    expect(statuses).toEqual([200, 200, 200, 429]);
    await expect.poll(async () => ((await (await visitor.get('/api/state')).json()).pending as { author: string }[]).filter((m) => m.author === 'visitante').length, { timeout: 45000, intervals: [3000] }).toBeGreaterThanOrEqual(3);
    expect((await visitor.post('/api/settings', { headers: { origin }, data: { paused: false, multiplier: 6 } })).status()).toBe(401);
    const highlights = await (await visitor.get('/api/highlights')).json();
    expect(highlights.born).toBe(true);
    expect(highlights.decisions).toBe(0);
    const book = await (await visitor.get('/api/logbook?days=7')).json();
    expect(book.days[0].born).toBe(true);
    const first = await (await visitor.post('/api/visit', { headers: { origin }, data: {} })).json();
    const again = await (await visitor.post('/api/visit', { headers: { origin }, data: {} })).json();
    expect(first.today).toBeGreaterThanOrEqual(1);
    expect(again.today).toBe(first.today);
    await visitor.dispose();
  });
  test('serves CSP and no credentials in static assets', async ({ request }) => {
    const response = await request.get('/');
    expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    const html = await response.text();
    expect(html).not.toContain('fixture-observer');
    expect(html).not.toContain('GEMINI_API_KEY');
  });
});
