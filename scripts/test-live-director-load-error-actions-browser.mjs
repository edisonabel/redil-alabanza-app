// Una secuencia que no carga se puede administrar o borrar desde el error, y el mensaje se entiende.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322';
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.route('**/api/live-director-upload-permission**', route => route.fulfill({ json: { canManageUploads: true } }));
  await page.route('**/lab-media/0/3.m4a', route => route.abort());
  await page.goto(`${LAB}/`);
  const alert = page.getByRole('alertdialog');
  await alert.waitFor({ timeout: 90000 });
  console.log('error:', (await alert.innerText()).replace(/\n+/g, ' | ').slice(0, 220));
  const stems = alert.locator('[data-live-director-error-action="stems"]');
  assert.equal(await stems.count(), 1, 'Administrar stems desde el error');
  assert.equal(await alert.locator('[data-live-director-error-action="delete"]').count(), 1, 'Borrar secuencia desde el error');
  await stems.click();
  assert.equal(await alert.count(), 0, 'El error se aparta para administrar');
  console.log('load error actions passed');
} finally { await browser.close(); }
