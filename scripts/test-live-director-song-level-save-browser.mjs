// La mezcla final se guarda: «Nivel canción» va en la mezcla del evento y vuelve al abrir la canción en otro
// equipo (otra pestaña sin nada local), y el fader Master se recuerda en este equipo.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322';
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const ready = count => page.waitForFunction(count => window.__streamingEngineDumpOwner?.getTracks().length === count && !document.querySelector('[data-live-director-control="play-pause"]').disabled, count, { timeout: 90000 });
const chooser = page.locator('[aria-label="Canción de prueba"]');
const levelButton = page.locator('[data-live-director-control="song-level"]');
const readLevel = async () => {
  await levelButton.click();
  const value = Number(await page.getByRole('slider', { name: 'Nivel de canción en decibelios' }).inputValue());
  await page.getByRole('button', { name: 'Cerrar nivel de canción' }).click();
  return value;
};
try {
  await page.goto(`${LAB}/?labEvent=lab-playback-preview&labRetainView=1`); await ready(15);
  await page.evaluate(() => { localStorage.removeItem('redil:live-director:master-volume:v1'); sessionStorage.clear(); });
  await page.reload(); await ready(15);
  const ids = await chooser.locator('option').evaluateAll(options => options.map(option => option.value));

  // Nivel canción −6 dB: se guarda en la mezcla del evento.
  await levelButton.click();
  await page.getByRole('slider', { name: 'Nivel de canción en decibelios' }).fill('-6');
  await page.getByRole('button', { name: 'Cerrar nivel de canción' }).click();
  await page.waitForFunction(id => window.__labMixes?.[id]?.songLevelDb === -6, ids[0], { timeout: 5000 })
    .catch(async () => { throw new Error(`No se guardó el nivel: ${JSON.stringify(await page.evaluate(id => window.__labMixes?.[id], ids[0]))}`); });

  // Sin nada guardado en la pestaña (como otro equipo), al volver a la canción vuelve el nivel guardado.
  await chooser.selectOption(ids[1]); await ready(14);
  await page.evaluate(() => sessionStorage.clear());
  await chooser.selectOption(ids[0]); await ready(15);
  assert.equal(await readLevel(), -6, 'El nivel guardado vuelve al abrir la canción');

  // Volver a 0 también se guarda.
  await levelButton.click();
  await page.getByRole('button', { name: 'Restaurar 0 dB' }).click();
  await page.getByRole('button', { name: 'Cerrar nivel de canción' }).click();
  await page.waitForFunction(id => window.__labMixes?.[id] && window.__labMixes[id].songLevelDb === undefined, ids[0], { timeout: 5000 });

  // Master: se recuerda en este equipo al recargar.
  const master = page.getByRole('slider', { name: 'Master volume' }).first();
  await master.focus(); for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowDown');
  const masterValue = Number(await master.getAttribute('aria-valuenow'));
  assert.ok(masterValue < 100, `El Master bajó (${masterValue})`);
  await page.reload(); await ready(15);
  assert.equal(Number(await page.getByRole('slider', { name: 'Master volume' }).first().getAttribute('aria-valuenow')), masterValue, 'El Master se recuerda');
  await page.evaluate(() => localStorage.removeItem('redil:live-director:master-volume:v1'));
  assert.deepEqual(errors, []);
  console.log('song level and master save passed');
} finally { await browser.close(); }
