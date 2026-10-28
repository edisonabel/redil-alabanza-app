import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322'; // laboratorio Providencia (configurable)
const {chromium}=createRequire(import.meta.url)('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:1728,height:1000}}),errors=[],writes=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
try {
 await page.goto(`${LAB}/`);
 await page.waitForFunction(()=>window.__streamingEngineDumpOwner?.getTracks().length===15&&!document.querySelector('[data-live-director-control="edit-song"]')?.disabled,null,{timeout:90000});
 // El mapa de secciones es desplegable y empieza oculto; el botón junto a los íconos lo muestra.
 const mapToggle=page.locator('[data-live-director-control="section-map"]');
 assert.equal(await mapToggle.getAttribute('aria-pressed'),'false');assert.equal(await page.locator('[data-live-section-minimap]').count(),0,'Oculto por defecto');
 await mapToggle.click();assert.equal(await mapToggle.getAttribute('aria-pressed'),'true');
 const map=page.getByRole('slider',{name:'Mini-mapa de la canción'});
 await map.waitFor();assert.equal(await map.locator('[data-minimap-section]').count(),14);
 const colors=await map.locator('[data-minimap-section]').evaluateAll(els=>els.map(e=>getComputedStyle(e).backgroundColor));
 assert.ok(colors.every(c=>!['rgba(0, 0, 0, 0)','transparent'].includes(c)));
 assert.ok(new Set(colors).size>=4);assert.equal(await map.getAttribute('tabindex'),'0');
 await page.screenshot({path:'.lab/results/section-map-desktop.png'});
 await map.click({position:{x:(await map.boundingBox()).width/2,y:14}});
 await page.waitForFunction(()=>Math.abs(window.__streamingEngineDumpOwner.getCurrentTime()-170)<1,null,{timeout:10000});
 await page.waitForFunction(()=>document.querySelector('[data-live-section-minimap]')?.getAttribute('aria-disabled')==='false');
 await map.press('Home');await page.waitForFunction(()=>window.__streamingEngineDumpOwner.getCurrentTime()===0);
 await page.waitForFunction(()=>document.querySelector('[data-live-section-minimap]')?.getAttribute('aria-disabled')==='false');
 await map.press('ArrowRight');await page.waitForFunction(()=>window.__streamingEngineDumpOwner.getCurrentTime()===1);
 await map.click({position:{x:(await map.boundingBox()).width/2,y:14}});
 await page.waitForFunction(()=>Math.abs(window.__streamingEngineDumpOwner.getCurrentTime()-170)<1);
 await page.waitForFunction(()=>!document.querySelector('[data-live-director-control="play-pause"]')?.disabled);
 await page.locator('[data-live-director-control="play-pause"]').click();
 await page.waitForFunction(()=>window.__streamingEngineDumpOwner.getCurrentTime()>170.5);
 await page.locator('[data-live-director-control="play-pause"]').click();
 await page.waitForFunction(()=>!document.querySelector('[data-live-director-control="play-pause"]')?.disabled);
 const markerPosition=await page.locator('[data-live-minimap-playhead]').evaluate(node=>{
   const map=node.parentElement,r=node.getBoundingClientRect(),b=map.getBoundingClientRect();
   return {actual:(r.left+r.width/2-b.left)/b.width,expected:window.__streamingEngineDumpOwner.getCurrentTime()/Number(map.getAttribute('aria-valuemax'))};
 });
 assert.ok(Math.abs(markerPosition.actual-markerPosition.expected)<.004,'Paused minimap playhead must match the audio time');
 await page.getByRole('button',{name:'Editar canción',exact:true}).click();
 const editor=page.getByRole('region',{name:'Editar secciones de la canción'});
 assert.equal(await editor.locator('[data-arrangement-wave] path').count(),14);
 const original=await editor.locator('[data-arrangement-entry]').first().locator('path').first().getAttribute('d');
 await editor.getByRole('button',{name:'Opciones de sección 1',exact:true}).click();await editor.getByRole('button',{name:'Duplicar sección 1',exact:true}).click();
 const paths=await editor.locator('[data-arrangement-wave] path').evaluateAll(els=>els.map(e=>e.getAttribute('d')));
 assert.equal(paths.length,15);assert.equal(paths[0],original);assert.equal(paths[1],original);
 await editor.getByRole('button',{name:'Opciones de sección 2',exact:true}).click();await editor.getByRole('button',{name:'Mover sección 2 a la derecha',exact:true}).click();
 assert.equal(await editor.locator('[data-arrangement-wave] path').nth(2).getAttribute('d'),original);
 await editor.getByRole('button',{name:'Aplicar temporalmente',exact:true}).click();await editor.waitFor({state:'hidden'});
 assert.equal(await map.locator('[data-minimap-section]').count(),15);
 const mapIds=await map.locator('[data-minimap-section]').evaluateAll(els=>els.map(e=>e.dataset.minimapSection));assert.equal(new Set(mapIds).size,15);
 assert.equal(await map.getAttribute('aria-valuemax'),'344');
 for(const [width,height] of [[1728,1000],[1280,720],[844,390],[390,844]]) {
   await page.setViewportSize({width,height});
   if(height>width){await page.getByText("Modo horizontal obligatorio",{exact:true}).waitFor();continue;}
   if(await page.getByRole('button',{name:'Mostrar secciones',exact:true}).isVisible().catch(()=>false))await page.getByRole('button',{name:'Mostrar secciones',exact:true}).click();
   await page.screenshot({path:`.lab/results/section-map-${width}.png`});
   await page.getByRole('button',{name:'Editar canción',exact:true}).click();await editor.waitFor();
   const wave=editor.locator('[data-arrangement-wave]').first();assert.ok(await wave.isVisible());
   const card=editor.locator('[data-arrangement-entry]').first();assert.ok(await card.isVisible());
   const box=await editor.boundingBox();assert.ok(box.x>=-1&&box.x+box.width<=width+1);
   await page.screenshot({path:`.lab/results/editor-waves-${width}.png`});
   await editor.getByRole('button',{name:'Cancelar',exact:true}).click();await editor.waitFor({state:'hidden'});
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 const result={pass:true,minimapSections:14,colorsVisible:colors,keyboardSeek:true,pointerSeek:true,duplicateWavePreserved:true,reorderedWavePreserved:true,arrangementMinimapOccurrences:15,arrangementDuration:344,responsive:[1728,1280,844],portraitGuardPreserved:true,errors,writes};
 await writeFile('.lab/results/section-visuals-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} catch(e){await page.screenshot({path:'.lab/results/section-visuals-failure.png'});throw e;}finally{await browser.close();}
