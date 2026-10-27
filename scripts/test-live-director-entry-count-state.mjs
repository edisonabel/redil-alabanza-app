import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {build} from 'esbuild';
const {chromium}=createRequire(import.meta.url)('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const bundle=await build({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {useLiveDirectorEntryCount} from './src/hooks/useLiveDirectorEntryCount';
window.clock=1;performance.now=()=>window.clock*1000;window.plays=0;window.pauses=0;
function Harness(){const[opts,setOpts]=useState({enabled:true,identity:'a',ready:true,playing:false,bpm:120,meter:{numerator:4,denominator:4},unoSeconds:0});const count=useLiveDirectorEntryCount({...opts,getTime:()=>window.songTime??0,getGraph:()=>null,play:async()=>{window.plays++},pause:()=>window.pauses++});window.count={...count,update:p=>setOpts(o=>({...o,...p}))};return null;}createRoot(document.getElementById('root')).render(React.createElement(Harness));`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser'});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const page=await browser.newPage();const tick=()=>page.waitForTimeout(45);
try{await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForFunction(()=>window.count);
await page.evaluate(()=>{window.job=window.count.start().catch(e=>window.failure=e.name)});await tick();assert.equal(await page.evaluate(()=>window.plays),0);assert.equal(await page.evaluate(()=>window.count.pending),true);
for(let n=1;n<=4;n++){await page.evaluate(n=>window.clock=1.1+(n-1)*.5+.001,n);await tick();assert.equal(await page.evaluate(()=>window.count.beat),n);assert.equal(await page.evaluate(()=>window.plays),0);}
await page.evaluate(()=>window.clock=3.101);await tick();assert.equal(await page.evaluate(()=>window.plays),1);assert.equal(await page.evaluate(()=>window.count.pending),false);
await page.evaluate(()=>{window.clock=4;window.job=window.count.start().catch(e=>window.failure=e.name)});await tick();await page.evaluate(()=>{window.clock=4.2;window.count.cancel()});await tick();await page.evaluate(()=>window.clock=8);await tick();assert.equal(await page.evaluate(()=>window.plays),1);assert.equal(await page.evaluate(()=>window.failure),'AbortError');
await page.evaluate(()=>{window.clock=9;window.job=window.count.start().catch(e=>window.failure=e.name)});await tick();await page.evaluate(()=>window.count.update({identity:'b'}));await tick();await page.evaluate(()=>window.clock=15);await tick();assert.equal(await page.evaluate(()=>window.plays),1);
// A real RPP prelude is played once, without adding another synthetic bar.
await page.evaluate(()=>window.count.update({unoSeconds:4,playing:false}));await tick();await page.evaluate(()=>window.count.start());await tick();assert.equal(await page.evaluate(()=>window.plays),2);
await page.evaluate(()=>{window.songTime=2.501;window.count.update({playing:true})});await tick();assert.equal(await page.evaluate(()=>window.count.beat),2);
// A three-beat song gives exactly one 1–2–3 bar, with no fourth beat.
await page.evaluate(()=>window.count.update({unoSeconds:0,playing:false,meter:{numerator:3,denominator:4}}));await tick();
await page.evaluate(()=>{window.clock=20;window.job=window.count.start().catch(e=>window.failure=e.name)});await tick();
for(let n=1;n<=3;n++){await page.evaluate(n=>window.clock=20.1+(n-1)*.5+.001,n);await tick();assert.equal(await page.evaluate(()=>window.count.beat),n);assert.equal(await page.evaluate(()=>window.plays),2);}
await page.evaluate(()=>window.clock=21.601);await tick();assert.equal(await page.evaluate(()=>window.plays),3);assert.equal(await page.evaluate(()=>window.count.pending),false);
console.log('Counted pre-roll waits a full bar, cancels safely, rejects stale song starts and preserves recorded entry: ok');
}finally{await browser.close();}
