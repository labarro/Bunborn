// Chromium review of the REAL deployed URLs (desktop + mobile). Read-only: it never opens the
// birth confirmation, never sends messages and never changes settings.
import { chromium } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { encryptedGeneratedSecrets } from './private-secrets.mjs';
import { baseFor } from './remote-client.mjs';
const secrets = await encryptedGeneratedSecrets();
const dir = 'artifacts/visual';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch();
const report = [];
const viewports = { desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 } };
async function session(env, viewport, authenticated) {
  const context = await browser.newContext({ viewport });
  if (authenticated) {
    const expires = String(Date.now() + 3600000);
    const value = expires + '.' + createHmac('sha256', secrets[env].session).update(expires).digest('hex');
    await context.addCookies([{ name: 'observador', value, domain: new URL(baseFor(env)).hostname, path: '/', httpOnly: true, secure: true, sameSite: 'Strict' }]);
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { context, page, errors };
}
async function shot(page, name, errors, extra = {}) {
  await page.waitForTimeout(1200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
  report.push({ name, overflow, errors: [...errors], ...extra });
  errors.length = 0;
}
for (const [vpName, viewport] of Object.entries(viewports)) {
  // Production: unauthenticated landing and authenticated empty refuge (birth reserved).
  let s = await session('production', viewport, false);
  await s.page.goto(baseFor('production'));
  await shot(s.page, `production-${vpName}-public`, s.errors);
  await s.context.close();
  s = await session('production', viewport, true);
  await s.page.goto(baseFor('production'));
  await s.page.getByText('Refúgio reservado').first().waitFor({ timeout: 20000 }).catch(() => undefined);
  const birthButton = s.page.getByRole('button', { name: /Refúgio reservado|Preparar o primeiro instante/ });
  const disabled = (await birthButton.count()) ? await birthButton.first().isDisabled() : null;
  await shot(s.page, `production-${vpName}-empty-authenticated`, s.errors, { birthButtonDisabled: disabled });
  await s.context.close();
  // Homologation: disposable creature under the 24h experiment.
  s = await session('homologation', viewport, true);
  await s.page.goto(baseFor('homologation'));
  await s.page.locator('canvas').first().waitFor({ timeout: 30000 }).catch(() => undefined);
  await shot(s.page, `homologation-${vpName}-habitat`, s.errors);
  const tabs = vpName === 'desktop' ? ['Intenções', 'Linha do tempo', 'Memórias', 'Personalidade', 'Acervo', 'Monitoramento'] : ['Linha do tempo', 'Monitoramento'];
  for (const tab of tabs) {
    if (vpName === 'mobile') await s.page.getByRole('button', { name: 'Abrir navegação' }).click();
    await s.page.getByRole('button', { name: tab, exact: true }).click();
    await shot(s.page, `homologation-${vpName}-${tab.normalize('NFD').replace(/[^a-zA-Z]/g, '').toLowerCase()}`, s.errors);
  }
  await s.context.close();
}
await browser.close();
await writeFile(`${dir}/report.json`, JSON.stringify({ checkedAt: new Date().toISOString(), report }, null, 2));
console.log(JSON.stringify(report, null, 1));
