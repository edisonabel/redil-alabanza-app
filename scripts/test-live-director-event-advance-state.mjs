import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {build}=require('esbuild');
const {chromium}=require('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const bundle=await build({stdin:{contents:`
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useLiveDirectorEventAdvance} from './src/hooks/useLiveDirectorEventAdvance';
const log={starts:0,pauses:0,selections:[],handled:[],jobs:[]};
window.advanceLog=log;window.testClock=1000;performance.now=()=>window.testClock;
function Harness(){
 const [options,setOptions]=useState({enabled:true,identity:'event:a',songId:'a',nextSong:{id:'b',title:'B'},playing:false,ready:true,busy:false,hasArrangement:false,duration:10,startReady:false,request:null,startError:''});
 const advance=useLiveDirectorEventAdvance({...options,manualNavigation:window.manualNavigation??=( {current:false}),
 scheduleEnd:()=>{let resolve;const job={cancelled:false,completion:new Promise(r=>resolve=r),cancel(){job.cancelled=true;resolve(false)},resolve};log.jobs.push(job);return job;},
 selectSong:(id,options)=>log.selections.push({id,...options}),
 start:()=>{log.starts++;return new Promise((resolve,reject)=>{window.finishStart=resolve;window.failStart=reject;})},
 pause:()=>{log.pauses++},cancelSelection:()=>{},requestHandled:token=>log.handled.push(token)
 });
 window.advanceHarness={...advance,update:patch=>setOptions(prev=>({...prev,...patch}))};return null;
}
createRoot(document.getElementById('root')).render(React.createElement(Harness));`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser'});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--mute-audio']});
const page=await browser.newPage();
const tick=()=>page.waitForTimeout(100);
try{
 await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.waitForFunction(()=>window.advanceHarness);
 // A cancelled/sample-unconfirmed endpoint must never advance the event.
 await page.evaluate(()=>window.advanceHarness.update({playing:true}));await tick();
 await page.evaluate(()=>{window.advanceLog.jobs[0].resolve(false);window.advanceHarness.update({playing:false})});await tick();
 assert.equal(await page.evaluate(()=>window.advanceHarness.countdown),null);
 // End confirmation starts five seconds; a changed queue invalidates that destination.
 await page.evaluate(()=>window.advanceHarness.complete());await tick();
 assert.equal(await page.evaluate(()=>window.advanceHarness.countdown),5);
 await page.evaluate(()=>window.advanceHarness.update({nextSong:{id:'c',title:'C'}}));await tick();
 await page.evaluate(()=>window.testClock+=6000);await tick();
 assert.equal(await page.evaluate(()=>window.advanceLog.selections.length),0);
 // Pending transport preparation can be cancelled before an async selection commits.
 await page.evaluate(()=>window.advanceHarness.complete());await tick();
 await page.evaluate(()=>window.testClock+=5000);await tick();
 assert.deepEqual(await page.evaluate(()=>window.advanceLog.selections),[{id:'c',autoPlay:true}]);
 assert.equal(await page.evaluate(()=>window.advanceHarness.cancel()),true);await tick();
 assert.equal(await page.evaluate(()=>window.advanceHarness.pending),false);
 // An incoming request waits for all session preparation, rather than stale isReady.
 await page.evaluate(()=>window.advanceHarness.update({identity:'event:c',songId:'c',request:{songId:'c',token:1},ready:true,startReady:false}));await tick();
 assert.equal(await page.evaluate(()=>window.advanceLog.starts),0);
 await page.evaluate(()=>window.advanceHarness.update({startReady:true,busy:true}));await tick();
 assert.equal(await page.evaluate(()=>window.advanceLog.starts),0);
 await page.evaluate(()=>window.advanceHarness.update({busy:false}));await tick();
 assert.equal(await page.evaluate(()=>window.advanceLog.starts),1);
 await page.evaluate(()=>window.advanceHarness.cancel());await tick();
 await page.evaluate(()=>window.finishStart());await tick();
 assert.ok(await page.evaluate(()=>window.advanceLog.pauses>=1));
 assert.equal(await page.evaluate(()=>window.advanceHarness.pending),false);
 // Missing/failed stems leave the next song paused and consume only this request.
 await page.evaluate(()=>window.advanceHarness.update({request:{songId:'c',token:2},startReady:true,startError:'Falta un stem'}));await tick();
 assert.equal(await page.evaluate(()=>window.advanceLog.starts),1);
 assert.deepEqual(await page.evaluate(()=>window.advanceLog.handled),[2]);
 assert.match(await page.evaluate(()=>window.advanceHarness.notice),/Falta un stem/);
 // The next fresh request can start; replaying a consumed token never starts twice.
 await page.evaluate(()=>window.advanceHarness.update({request:{songId:'c',token:3},startError:''}));await tick();
 assert.equal(await page.evaluate(()=>window.advanceLog.starts),2);
 await page.evaluate(()=>window.finishStart());await tick();await tick();
 assert.equal(await page.evaluate(()=>window.advanceLog.starts),2);
 assert.deepEqual(await page.evaluate(()=>window.advanceLog.handled),[2,3]);
 // A failure arriving while play is still preparing also invalidates that async start.
 await page.evaluate(()=>window.advanceHarness.update({request:{songId:'c',token:4},startError:''}));await tick();
 assert.equal(await page.evaluate(()=>window.advanceLog.starts),3);
 const pausesBefore=await page.evaluate(()=>window.advanceLog.pauses);
 await page.evaluate(()=>window.advanceHarness.update({startError:'Se perdió un stem'}));await tick();
 await page.evaluate(()=>window.finishStart());await tick();
 assert.ok(await page.evaluate(()=>window.advanceLog.pauses)>pausesBefore);
 assert.deepEqual(await page.evaluate(()=>window.advanceLog.handled),[2,3,4]);
 console.log(JSON.stringify({pass:true,lateLoadFailureCancelsStart:true,unconfirmedEndpointIgnored:true,queueChangeCancels:true,asyncSelectionCancellable:true,waitsForCurrentSession:true,latePlayCancellation:true,failedStemDoesNotStart:true,requestConsumedOnce:true}));
}finally{await browser.close()}
