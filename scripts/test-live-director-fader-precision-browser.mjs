import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const { chromium } = require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const component = fileURLToPath(new URL('../src/components/react/live-director/ChannelStrip.tsx', import.meta.url));
const compiled = await build({
  stdin: { contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{PrecisionFaderSurface}from${JSON.stringify(component)};
function Harness(){const[value,setValue]=useState(.5),[disabled,setDisabled]=useState(false);window.faderTest={value,setValue,setDisabled};const metrics=window.faderMetrics||(window.faderMetrics={changes:[],starts:0,ends:0});return <div id="scroll" data-live-director-mixer-scroll="true" style={{width:280,overflowX:'auto'}}><div style={{width:800,height:450,position:'relative'}}><div id="rail" style={{position:'absolute',left:180,top:10,height:400,width:120}}><div data-fader-thumb="true" style={{position:'absolute',left:0,width:120,height:32,bottom:'calc('+(10+value*78)+'% - 16px)'}}/><PrecisionFaderSurface value={value} disabled={disabled} onChange={next=>{metrics.changes.push(next);setValue(next)}} label="Precision test" onInteractionStart={()=>metrics.starts++} onInteractionEnd={()=>metrics.ends++} style={{position:'absolute',inset:0,width:120}}/></div></div></div>};createRoot(document.getElementById('root')).render(<Harness/>);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', format: 'esm', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
});
const server = createServer((request, response) => {
  if (request.url === '/test.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(compiled.outputFiles[0].contents); return; }
  response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><div id="root"></div><script type="module" src="/test.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const value = () => page.evaluate(() => window.faderTest.value);
const setValue = async next => { await page.evaluate(next => window.faderTest.setValue(next), next); await page.waitForFunction(next => window.faderTest.value === next, next); };
const slider = page.getByRole('slider', { name: 'Precision test', exact: true });
const thumb = page.locator('[data-fader-thumb]');
const cases = [];
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await slider.waitFor(); await page.evaluate(() => { document.getElementById('scroll').scrollLeft = 100; });
  const rail = await slider.boundingBox(), travel = rail.height * .78;
  const center = async offset => { const box = await thumb.boundingBox(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 + offset }; };
  let grab = await center(10);
  await page.mouse.move(grab.x, grab.y); await page.mouse.down();
  assert.equal(await value(), .5, 'Grabbing away from the thumb center must not change the gain');
  await page.mouse.move(grab.x, grab.y - 3);
  const continuous = await value();
  assert.ok(Math.abs(continuous - (.5 + 3 / travel)) < 1e-8, 'Mouse movement must apply immediately, before pointerup and below the old 7px threshold');
  assert.ok(Math.abs(continuous * 100 - Math.round(continuous * 100)) > .001, 'Pointer values must retain fractional percentages');
  await page.mouse.up(); cases.push({ name: 'off-center-grab-and-live-float-drag', value: continuous });

  await setValue(.5); grab = await center(0);
  await page.mouse.move(grab.x, grab.y); await page.mouse.down(); await page.mouse.move(grab.x, grab.y - 10);
  await page.keyboard.down('Shift'); await page.mouse.move(grab.x, grab.y - 20);
  const fine = await value();
  assert.ok(Math.abs(fine - (.5 + 11 / travel)) < 1e-8, 'Shift must scale subsequent travel by 0.1 without jumping when enabled');
  await page.keyboard.up('Shift'); await page.mouse.up(); cases.push({ name: 'continuous-shift-fine-mode', value: fine });

  await setValue(.5);
  await page.mouse.click(rail.x + rail.width / 2, rail.y + rail.height * .12);
  assert.ok(Math.abs(await value() - 1) < 1e-8);
  let box = await thumb.boundingBox(); assert.ok(Math.abs(box.y + box.height / 2 - (rail.y + rail.height * .12)) < .1, 'Max pointer and thumb center must agree');
  await page.mouse.click(rail.x + rail.width / 2, rail.y + rail.height * .9);
  assert.ok(Math.abs(await value()) < 1e-8);
  box = await thumb.boundingBox(); assert.ok(Math.abs(box.y + box.height / 2 - (rail.y + rail.height * .9)) < .1, 'Min pointer and thumb center must agree');
  cases.push({ name: 'visual-and-pointer-endpoints-agree', pass: true });

  await setValue(.5); await slider.focus();
  await page.keyboard.press('ArrowUp'); assert.ok(Math.abs(await value() - .51) < 1e-9);
  await page.keyboard.press('Shift+ArrowDown'); assert.ok(Math.abs(await value() - .509) < 1e-9);
  assert.equal(await slider.getAttribute('aria-valuetext'), '50.9%');
  await page.keyboard.press('Home'); assert.equal(await value(), 0);
  await page.keyboard.press('End'); assert.equal(await value(), 1);
  cases.push({ name: 'keyboard-normal-fine-and-endpoints', pass: true });

  await setValue(.5); const touchGrab = await center(0);
  const touch = async (type, x, y) => slider.evaluate((element, { type, x, y }) => element.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 22, pointerType: 'touch', clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 })), { type, x, y });
  const initialScroll = await page.evaluate(() => document.getElementById('scroll').scrollLeft);
  await touch('pointerdown', touchGrab.x, touchGrab.y); await touch('pointermove', touchGrab.x - 80, touchGrab.y + 2); await touch('pointerup', touchGrab.x - 80, touchGrab.y + 2);
  assert.equal(await value(), .5, 'Horizontal touch scrolling must not change the gain');
  assert.equal(await page.evaluate(() => document.getElementById('scroll').scrollLeft), initialScroll + 80);
  cases.push({ name: 'touch-pan-preserves-volume', pass: true });

  const verticalGrab = await center(8);
  await touch('pointerdown', verticalGrab.x, verticalGrab.y); await touch('pointermove', verticalGrab.x, verticalGrab.y - 10);
  assert.ok(Math.abs(await value() - (.5 + 10 / travel)) < 1e-8, 'Vertical touch drag must update live without thumb recentering');
  await touch('pointerup', verticalGrab.x, verticalGrab.y - 10);
  cases.push({ name: 'touch-vertical-live-drag', pass: true });

  await setValue(.5); const tapGrab = await center(0);
  await touch('pointerdown', tapGrab.x, tapGrab.y); await touch('pointerup', tapGrab.x, tapGrab.y - 2);
  assert.equal(await value(), .5, 'A small touch jitter when tapping the thumb must not change gain');
  const interactionCounts = await page.evaluate(() => ({ starts: window.faderMetrics.starts, ends: window.faderMetrics.ends }));
  assert.equal(interactionCounts.starts, interactionCounts.ends, 'Each gesture must finish exactly once');
  await page.evaluate(() => window.faderTest.setDisabled(true));
  await page.waitForFunction(() => document.querySelector('[role="slider"]').getAttribute('aria-disabled') === 'true');
  await page.mouse.click(rail.x + rail.width / 2, rail.y + rail.height * .12);
  await slider.focus(); await page.keyboard.press('ArrowUp'); assert.equal(await value(), .5);
  cases.push({ name: 'jitter-disabled-and-capture-cleanup', ...interactionCounts });
  assert.deepEqual(errors, []);
  const result = { pass: true, cases, errors, note: 'Tests the actual reusable React pointer surface with controlled gain callbacks; actual audio graph integration is covered separately in the lab.' };
  await mkdir('.lab/results', { recursive: true }); await writeFile('.lab/results/fader-precision-check.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
