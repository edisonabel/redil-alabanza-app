import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:1728,height:1000}});
const errors=[],failures=[],writes=[];
page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message)});
page.on('console',message=>{if(message.type()==='error')console.log('CONSOLE',message.text().slice(0,500))});
page.on('requestfailed',r=>{failures.push(new URL(r.url()).pathname);});
page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push({method:r.method(),path:new URL(r.url()).pathname});});
try{
 const response=await page.goto('http://127.0.0.1:4322/',{waitUntil:'domcontentloaded',timeout:60000});assert.equal(response.status(),200);
 await page.waitForSelector('[data-live-director-control="play-pause"]',{timeout:60000});
 await page.waitForFunction(()=>!document.querySelector('[data-live-director-control="play-pause"]').disabled,{timeout:90000});
 const state=await page.evaluate(()=>({isolated:crossOriginIsolated,text:document.body.textContent.slice(0,2500),ready:!document.querySelector('[data-live-director-control="play-pause"]').disabled}));
 assert.equal(state.isolated,true);
 assert.match(state.text,/Providencia/);
  const engine=await page.evaluate(()=>window.__streamingEngineDumpOwner?.getDiagnostics());
  assert.equal(engine?.trackCount,15);
  assert.equal(engine?.engineRoute,'streaming-worker');
 console.log(JSON.stringify({phase:'ready',...state}));
 await mkdir('.lab/results',{recursive:true});await page.screenshot({path:'.lab/results/desktop.png',fullPage:true});
 await page.click('[data-live-director-control="play-pause"]');
 await page.waitForFunction(()=>window.__streamingEngineDumpOwner?.getIsPlaying() && window.__streamingEngineDumpOwner.getCurrentTime()>1 && Object.values(window.__streamingEngineDumpOwner.getSharedTelemetry()?.levels || window.__streamingEngineDumpOwner.getTrackMeterLevels()).some(level=>level>0.001),null,{timeout:20000});
 await page.screenshot({path:'.lab/results/playing.png',fullPage:true});
 await page.click('[data-live-director-control="play-pause"]');
 await page.selectOption('select[aria-label="Canción de prueba"]',{label:'Tu palabra (JCA)'});
 await page.waitForFunction(()=>window.__streamingEngineDumpOwner?.getTracks().length===14 && document.querySelector('[data-live-director-control="play-pause"]') && !document.querySelector('[data-live-director-control="play-pause"]').disabled,{timeout:90000});
 await page.selectOption('select[aria-label="Canción de prueba"]',{label:'Providencia'});
 await page.waitForFunction(()=>window.__streamingEngineDumpOwner?.getTracks().length===15 && document.querySelector('[data-live-director-control="play-pause"]') && !document.querySelector('[data-live-director-control="play-pause"]').disabled,{timeout:90000});
 await page.setViewportSize({width:844,height:390});await page.screenshot({path:'.lab/results/landscape.png',fullPage:true});
 const post=await page.request.post('http://127.0.0.1:4322/api/live-director-song-session',{data:{test:true}});assert.equal(post.status(),405);
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[],'UI must not write production or local APIs');
 const result={pass:true,errors,failures,writes,tracks:engine.trackCount,engineRoute:engine.engineRoute,audioMetersNonzero:true,isolated:state.isolated,writeGuard:post.status(),browser:browser.version()};
 await writeFile('.lab/results/browser-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){await mkdir('.lab/results',{recursive:true});await page.screenshot({path:'.lab/results/failure.png',fullPage:true});console.log((await page.locator('body').innerText()).slice(0,1800));throw error;}
finally{await browser.close();}
