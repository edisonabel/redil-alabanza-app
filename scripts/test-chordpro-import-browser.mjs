// Panel «Importar ChordPro» con el componente real y Supabase simulado: nunca toca la base de datos.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

const bundle = await build({
  stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Panel from './src/components/AdminChordProImport.jsx';
window.renderPanel=(songs)=>{window.__root??=createRoot(document.getElementById('root'));window.__updated=[];window.__root.render(<Panel songs={songs} isAdmin onSongUpdated={s=>window.__updated.push(s)}/>)};`,
  resolveDir: process.cwd(), loader: 'jsx' },
  jsx: 'automatic', bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'supabase-fixture', setup(b) {
    b.onResolve({ filter: /lib\/supabase$/ }, () => ({ path: 'supabase', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `
export const supabase={from(table){const call={table,filters:[]};const q={
  update(v){call.update=v;return q},eq(c,v){call.filters.push(['eq',c,v]);return q},is(c,v){call.filters.push(['is',c,v]);return q},select(c){call.select=c;return q},
  then(ok,ko){window.__calls.push(call);return Promise.resolve(window.__answer(call)).then(ok,ko)}};return q}};` }));
  } }],
});
const astro = existsSync('dist/_astro') ? readdirSync('dist/_astro') : [];
const css = astro.filter((name) => /^(global|Layout)\..*\.css$/.test(name)).map((name) => readFileSync(`dist/_astro/${name}`, 'utf8')).join('\n').replace(/url\(([^)]+)\)/g, 'none');
const pixel = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const drafts = { version: 1, createdAt: '2026-10-26T19:00:00Z', model: 'gpt-5.5', songs: [
  { name: 'Bendito Jesus', files: ['1.webp', '2.png'], status: 'listo', match: { id: 'b', titulo: 'Bendito Jesús' }, review: [],
    chordpro: '[Verso 1]\n[B]Por tí es mi cla[F#]mor\n', stats: { lines: 1, verified: 1 }, images: [pixel] },
  { name: 'La Gloria de la Cruz', files: ['gloria.pdf'], status: 'listo', match: { id: 'g', titulo: 'La Gloria de la Cruz' },
    review: [{ line: 3, text: '[C#m]¿Cómo es', reason: 'Las dos lecturas no coinciden (C#m E / C#m E A).' }, { section: 'Puente', reason: 'Nombre de sección deducido: la hoja no lo indica.' }],
    chordpro: '[Intro]\n[C#m] [E] [A]\n[C#m]¿Cómo es\n', stats: { lines: 1, verified: 0 }, images: [pixel] },
  { name: 'Captura 1', files: ['c1.png'], status: 'sin-coincidencia', match: null, review: [], chordpro: '[Coro]\n[A]Santo\n', stats: { lines: 1, verified: 1 }, images: [pixel] },
  { name: 'Aquella Cruz', files: ['aquella.webp'], status: 'omitida', match: { id: 'a', titulo: 'Aquella Cruz' }, review: [], notes: 'Ya tiene ChordPro: no se transcribe.' },
] };
const songs = [
  { id: 'b', titulo: 'Bendito Jesús', chordpro: null }, { id: 'g', titulo: 'La Gloria de la Cruz', chordpro: '' },
  { id: 's', titulo: 'Santo', chordpro: '{title: Santo}' }, { id: 'a', titulo: 'Aquella Cruz', chordpro: '[Coro]\n[F]Aquella' },
];

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setContent(`<html><head><style>${css}</style></head><body><div id="root"></div></body></html>`);
  await page.evaluate(() => {
    window.__calls = [];
    const db = { b: null, g: '[Coro]\n[A]Guardado por otra persona', s: '{title: Santo}' };
    window.__answer = (call) => {
      const id = call.filters.find(([, c]) => c === 'id')[2];
      if (!call.update) return { data: [{ id, chordpro: db[id] }], error: null };
      const guard = call.filters.find(([, c]) => c === 'chordpro');
      const ok = guard[0] === 'is' ? db[id] === null : db[id] === guard[2];
      if (ok) db[id] = call.update.chordpro;
      return { data: ok ? [{ id }] : [], error: null };
    };
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate((list) => window.renderPanel(list), songs);
  // Flujo simple: canción → ⌘V → Transcribir → Guardar (API y base de datos simuladas).
  await page.evaluate(() => {
    window.__api = [];
    window.fetch = async (url, options) => {
      const body = JSON.parse(options.body); window.__api.push({ url, body });
      return Response.json({ songId: body.songId, chordpro: '{title: Bendito Jesús}\n\n[Verso 1]\n[B]Por tí es mi cla[F#]mor\n', stats: { lines: 1, verified: 1 },
        review: [{ reason: 'La hoja no nombra estas secciones; revisa los nombres deducidos: Verso 1.' }, { line: 4, reason: 'Posición sin verificar.' }],
        usage: { input: 4200, output: 900 }, mode: body.precise ? 'preciso' : 'normal' });
    };
  });
  await page.type('input[aria-label="Buscar canción"]', 'bendito');
  const options0 = await page.$$eval('[aria-label="Canciones sin ChordPro"] button', (nodes) => nodes.map((n) => n.textContent));
  assert.deepEqual(options0, ['Bendito Jesús'], 'Solo canciones sin ChordPro');
  await page.type('input[aria-label="Buscar canción"]', 'x'); // «benditox»: nada
  assert.equal(await page.$('[aria-label="Canciones sin ChordPro"]'), null);
  await page.$eval('input[aria-label="Buscar canción"]', (input) => { input.value = ''; });
  await page.evaluate(() => { const i = document.querySelector('input[aria-label="Buscar canción"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'aquella'); i.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await page.$('[aria-label="Canciones sin ChordPro"]'), null, 'Aquella Cruz ya tiene ChordPro: no se ofrece');
  await page.evaluate(() => { const i = document.querySelector('input[aria-label="Buscar canción"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'bendito'); i.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('[aria-label="Canciones sin ChordPro"] button');
  // ⌘V con una captura en el portapapeles.
  await page.evaluate(async () => {
    const blob = await (await fetch.call(window, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=').catch(() => null))?.blob?.();
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='), (c) => c.charCodeAt(0))], 'captura.png', { type: 'image/png' }));
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
  await page.waitForSelector('[aria-label="Capturas pegadas"] img');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((n) => n.textContent.includes('Transcribir con IA')).click());
  await page.waitForSelector('textarea[aria-label="ChordPro propuesto"]');
  const sent = await page.evaluate(() => window.__api[0]);
  assert.equal(sent.url, '/api/admin-chordpro-image'); assert.equal(sent.body.songId, 'b');
  assert.equal(sent.body.files.length, 1); assert.match(sent.body.files[0].data, /^data:image\/png;base64,/);
  assert.match(await page.$eval('[aria-label="Por revisar"]', (n) => n.textContent), /nombres deducidos: Verso 1/);
  assert.equal(sent.body.precise, false, 'Por defecto, lectura barata');
  // Con líneas dudosas aparece la relectura precisa, solo a pedido.
  await page.evaluate(() => [...document.querySelectorAll('button')].find((n) => n.textContent.includes('Releer con más precisión')).click());
  await page.waitForFunction(() => window.__api.length === 2 && document.querySelector('textarea[aria-label="ChordPro propuesto"]'));
  assert.equal(await page.evaluate(() => window.__api[1].body.precise), true);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].some((n) => n.textContent.includes('Releer con más precisión'))), false, 'Después de la precisa no se ofrece otra vez');
  await page.screenshot({ path: '.lab/results/chordpro-quick-import.png', fullPage: true });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((n) => n.textContent.includes('Guardar en «Bendito Jesús»')).click());
  await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.includes('ChordPro guardado en «Bendito Jesús»'));
  const quickSave = await page.evaluate(() => window.__calls.at(-1));
  assert.deepEqual(quickSave.filters, [['eq', 'id', 'b'], ['is', 'chordpro', null]], 'Guardado protegido también en el flujo simple');
  assert.match(quickSave.update.chordpro, /\[B\]Por tí es mi cla\[F#\]mor/);
  await page.evaluate(() => { window.__calls = []; window.__updated = []; });

  // Importación masiva (plegada): sigue funcionando.
  const input = await page.waitForSelector('input[aria-label="Seleccionar borradores.json"]');
  await page.evaluate(() => { const original = File.prototype.text; window.__text = original; });
  await input.uploadFile(await (async () => { const { writeFileSync, mkdirSync } = await import('node:fs'); mkdirSync('.lab/results', { recursive: true }); writeFileSync('.lab/results/borradores-fixture.json', JSON.stringify(drafts)); return '.lab/results/borradores-fixture.json'; })());
  await page.waitForSelector('[aria-label="Canciones importadas"] li button');
  const listed0 = 0; void listed0;
  const listed = await page.$$eval('[aria-label="Canciones importadas"] li button', (nodes) => nodes.map((n) => n.textContent));
  assert.equal(listed.length, 3, 'Pendientes: la omitida no aparece');
  assert.ok(listed.some((t) => t.includes('Bendito Jesús')) && listed.some((t) => t.includes('Captura 1')));
  // Solo la lista sin revisión pendiente entra en «aprobar las listas».
  const bulk = await page.$$eval('button', (nodes) => nodes.find((n) => n.textContent.includes('sin revisión pendiente'))?.textContent);
  assert.match(bulk, /Aprobar 1 lista sin revisión/);
  // La que tiene líneas por revisar muestra cada motivo y su línea.
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Canciones importadas"] li button')].find((n) => n.textContent.includes('Gloria')).click());
  const review = await page.$eval('[aria-label="Por revisar"]', (n) => n.textContent);
  assert.match(review, /Línea 3:.*no coinciden/); assert.match(review, /\[Puente\]: Nombre de sección deducido/);
  // Si alguien guardó ChordPro mientras tanto, la base de datos no actualiza nada y no se sobrescribe.
  await page.evaluate(() => [...document.querySelectorAll('button')].find((n) => n.textContent.includes('Aprobar y guardar')).click());
  await page.waitForFunction(() => [...document.querySelectorAll('[role="status"]')].some((n) => n.textContent.includes('no se sobrescribe')));
  const guarded = await page.evaluate(() => window.__calls);
  assert.ok(!guarded.some((call) => call.update), 'Con ChordPro guardado por otra persona no se intenta escribir');
  // Sin coincidencia: se elige la canción (solo aparecen las que no tienen ChordPro) y se guarda lo editado.
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Canciones importadas"] li button')].find((n) => n.textContent.includes('Captura 1')).click());
  const options = await page.$$eval('select[aria-label="Canción del catálogo"] option', (nodes) => nodes.map((n) => n.textContent));
  assert.ok(options.includes('Santo') && !options.includes('Aquella Cruz'), 'Solo canciones sin ChordPro');
  await page.select('select[aria-label="Canción del catálogo"]', 's');
  await page.$eval('textarea', (t) => { const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, '[Coro]\n[A]Santo, santo\n'); t.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((n) => n.textContent.includes('Aprobar y guardar')).click());
  await page.waitForFunction(() => window.__updated.length === 1);
  const saved = await page.evaluate(() => ({ call: window.__calls.at(-1), updated: window.__updated[0] }));
  assert.equal(saved.call.update.chordpro, '[Coro]\n[A]Santo, santo', 'Guarda el texto editado');
  assert.deepEqual(saved.call.filters, [['eq', 'id', 's'], ['eq', 'chordpro', '{title: Santo}']], 'Solo si el valor sigue siendo el leído');
  assert.equal(saved.updated.id, 's');
  await page.screenshot({ path: '.lab/results/chordpro-import-panel.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Importar ChordPro (navegador): flujo simple (canción, ⌘V, IA, guardar), pendientes, motivos por línea, no sobrescribe, emparejar a mano y guardar lo editado passed.');
} finally { await browser.close(); }
