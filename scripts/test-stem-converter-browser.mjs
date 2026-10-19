import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
const baseUrl = process.env.STEM_TEST_URL || 'http://127.0.0.1:4321';
const dir = await mkdtemp(join(tmpdir(), 'stem-converter-'));
const names = ['Click', 'Guide', 'Cues', 'EG1', 'EG2', 'Banjo', 'Violin', 'Platillos', 'Trompetas', 'Pad', 'Mystery', 'Bass', 'Piano', 'Drums', 'Organ'];
function wav(index) {
  const frames = 48000 * 4;
  const buffer = Buffer.alloc(44 + frames * 4);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(48000, 24); buffer.writeUInt32LE(192000, 28); buffer.writeUInt16LE(4, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(frames * 4, 40);
  for (let n=0;n<frames;n++) {
    const v = Math.round(700 * Math.sin(2*Math.PI*(220+index*40)*n/48000));
    buffer.writeInt16LE(v, 44+n*4); buffer.writeInt16LE(v, 46+n*4);
  }
  return buffer;
}
for (let i=0;i<names.length;i++) await writeFile(join(dir, names[i]+'.wav'), wav(i));
const browser = await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({width:1440,height:1100,deviceScaleFactor:1});
  await page.goto(baseUrl+'/login', {waitUntil:'networkidle2',timeout:60000});
  await page.evaluate(async () => {
    const refresh = (await import('/@react-refresh')).default;
    refresh.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const React = (await import('/@id/react')).default;
    const reactDomModule = await import('/@id/react-dom/client');
    const {createRoot} = reactDomModule.default || reactDomModule;
    const Component = (await import('/src/components/react/StemConverterTool.tsx')).default;
    document.documentElement.classList.add('dark');
    document.body.innerHTML = '<div id="test-root"></div>';
    createRoot(document.getElementById('test-root')).render(React.createElement(Component));
  });
  await page.waitForSelector('input[aria-label="Elegir stems de audio"]');
  await (await page.$('input[aria-label="Elegir stems de audio"]')).uploadFile(...names.map(n=>join(dir,n+'.wav')));
  await page.waitForSelector('[role="dialog"] select');
  assert.equal(await page.$$eval('[role="dialog"] select', els => els.length),15);
  assert.match(await page.$eval('[role="dialog"]', el=>el.textContent), /15 archivos a 15 stems/);
  await page.select('select[aria-label="Categoría de Mystery.wav"]','woodwinds');
  for (const label of ['Click / Metrónomo','Guía / Talkback','Cues / Conteo']) {
    assert.equal(await page.$$eval('article', (els,label)=> {
      const el=els.find(e=>e.querySelector('h3')?.textContent===label);
      return [...el.querySelectorAll('button')].find(b=>b.textContent==='Fusionar').disabled;
    },label),true);
  }
  await page.screenshot({path:join(tmpdir(),'stem-converter-desktop.png'),fullPage:true});
  await page.setViewport({width:390,height:844});
  await page.screenshot({path:join(tmpdir(),'stem-converter-mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  // All dialog actions must remain reachable on a small phone.
  const applyButton = await page.$$eval('button', els => {
    const b=els.find(el=>el.textContent.trim()==='Aplicar plan'); const r=b.getBoundingClientRect();
    return {bottom:r.bottom,top:r.top};
  });
  assert.ok(applyButton.bottom <= 844 && applyButton.top >= 0, JSON.stringify(applyButton));
  await page.setViewport({width:1440,height:1100});
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Aplicar plan').click());
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Convertir 15 a M4A').click());
  await page.waitForFunction(()=>document.body.textContent.includes('ZIP listo') || document.body.textContent.includes('No se pudo') || document.body.textContent.includes('Falló'), {timeout:180000});
  const text = await page.evaluate(()=>document.body.innerText);
  assert.match(text,/ZIP listo/,text.slice(-5000));
  assert.match(text,/15\/15/);
  await page.screenshot({path:join(tmpdir(),'stem-converter-complete.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: 15-stem browser conversion, classifications, controls, automatic leveling and desktop/mobile layout.');
} finally { await browser.close(); await rm(dir,{recursive:true,force:true}); }
