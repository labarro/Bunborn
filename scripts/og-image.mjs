// Renders public/og-image.png (1200x630) used when the link is shared (WhatsApp, redes).
// Pure local rendering with Chromium; no remote assets. Run: node scripts/og-image.mjs
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const mark = await readFile('public/bunborn-mark.svg', 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;width:1200px;height:630px;background:radial-gradient(circle at 30% 40%,#3b2e4f 0,#292238 60%,#1f1a2b 100%);font-family:'Segoe UI',system-ui,sans-serif;color:#eee9f2;display:flex;align-items:center;gap:64px;padding:0 96px;box-sizing:border-box;overflow:hidden}
.mark svg{width:300px;height:300px;image-rendering:pixelated;filter:drop-shadow(0 18px 30px rgba(0,0,0,.35))}
h1{font-size:96px;margin:0 0 12px;letter-spacing:-1px}
p{font-size:36px;margin:0 0 28px;color:#d9cfe6;line-height:1.3;max-width:640px}
.tag{display:inline-block;font-size:26px;padding:10px 20px;border-radius:999px;background:#b8a2d0;color:#292238;font-weight:600}
.stars span{position:absolute;width:6px;height:6px;background:#dfbd7c;opacity:.7}
</style></head><body><div class="stars"><span style="left:80px;top:70px"></span><span style="left:1100px;top:110px"></span><span style="left:1020px;top:540px"></span><span style="left:160px;top:560px"></span></div>
<div class="mark">${mark}</div><div><h1>Bunborn</h1><p>Um coelho em pixel art que vive, pensa e cria sozinho. Observe quem ele se torna.</p><span class="tag">Vida artificial · ao vivo</span></div></body></html>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.screenshot({ path: 'public/og-image.png' });
await browser.close();
console.log('public/og-image.png');
