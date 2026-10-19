import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';

// Exercise the real rehearsal component and audio proxy, including COEP.
// Authentication is a fixture; REAL_AUDIO_URL uses the real R2 upstream.
const mediaUrl = process.env.REAL_AUDIO_URL || 'https://stems.alabanzaredilestadio.com/rehearsal-test.wav';
const appOrigin = 'https://alabanzaredilestadio.com';
const song = {id:'rehearsal-test',title:'Espera en Dios',artist:'Sarah Jerez',mp3:mediaUrl,sections:[{name:'Intro',lines:['[C]Intro']},{name:'Verso 1',lines:['[C]Letra de ensayo']}],sectionMarkers:[{sectionName:'Intro',startSec:0},{sectionName:'Verso 1',startSec:3}],playbackSources:[{id:'voice-test',label:'Voz de prueba',url:mediaUrl+'?voice-test=1'}]};
const frontend = await build({
  stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Rehearsal from './src/components/react/ModoEnsayoCompacto.jsx';createRoot(document.getElementById('root')).render(React.createElement(Rehearsal,{song:${JSON.stringify(song)},onGoBack:()=>{window.__wentBack=true}}));`,resolveDir:process.cwd(),loader:'jsx'},
  bundle:true,write:false,format:'esm',platform:'browser',define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},
  plugins:[{name:'fixture-auth',setup(b){
    b.onLoad({filter:/\/lib\/supabase\.js$/},()=>({contents:`export const supabase={removeChannel(){},channel(){return{on(){return this},subscribe(){return this},unsubscribe(){}}}};`,loader:'js'}));
  }}]

});
const dir=await mkdtemp(join(tmpdir(),'rehearsal-playback-test-'));
await build({entryPoints:[resolve('src/pages/api/mp3-proxy.ts')],outfile:join(dir,'proxy.mjs'),bundle:true,platform:'node',format:'esm',plugins:[{name:'fixture-auth',setup(b){
  b.onLoad({filter:/\/server\/api-security\.js$/},()=>({contents:`export async function requireAuthenticatedUser(){throw Object.assign(new Error('No autenticado'),{status:401})};export function securityErrorResponse(e){return new Response(e.message,{status:e.status})}`,loader:'js'}));
}}]});
const { GET }=await import(pathToFileURL(join(dir,'proxy.mjs')).href);
const originalFetch=globalThis.fetch;
const rangeRequests=[];
if(!process.env.REAL_AUDIO_URL){
  const samples=44100*8,wav=Buffer.alloc(44+samples*2);
  wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(44100,24);wav.writeUInt32LE(88200,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(16000*Math.sin(2*Math.PI*440*i/44100)),44+i*2);
  globalThis.fetch=async(url,init)=>{
    if(new URL(String(url)).pathname!==new URL(mediaUrl).pathname)return originalFetch(url,init);
    const range=new Headers(init?.headers).get('range');rangeRequests.push(range);
    const match=/bytes=(\d+)-(\d*)/.exec(range||'');const start=match?Number(match[1]):0;const end=match?.[2]?Math.min(Number(match[2]),wav.length-1):wav.length-1;
    const headers={'content-type':'audio/wav','content-length':String(end-start+1),'accept-ranges':'bytes'};
    if(match)headers['content-range']=`bytes ${start}-${end}/${wav.length}`;
    // Deliberately no Access-Control-Allow-Origin: proxy must not need it.
    return new Response(wav.subarray(start,end+1),{status:match?206:200,headers});
  };
}
let failAudio=false;let proxyRequests=0;let browser;
const statuses=[];
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,`http://${req.headers.host}`);
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
    if(url.pathname==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(frontend.outputFiles[0].text);return;}
    if(url.pathname==='/api/mp3-proxy'){
      proxyRequests++;
      const response=await GET({request:new Request(url,{headers:req.headers}),url,cookies:{},locals:failAudio?{}:{user:{id:'test-admin'}}});
      statuses.push(response.status);res.writeHead(response.status,Object.fromEntries(response.headers));
      if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();return;
    }
    res.setHeader('content-type','text/html');res.end('<!doctype html><div id="root"></div><script type="module" src="/bundle.js"></script>');
  }catch(e){console.error(e);res.writeHead(500);res.end('Test server error');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
  browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage();const errors=[];let directRequests=0;
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(60000);
  page.on('dialog',async d=>{errors.push('Unexpected dialog: '+d.message());await d.dismiss();});
  page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR:',e.message);});
  await page.setRequestInterception(true);
  page.on('request',async req=>{
    if(req.url().startsWith('https://stems.')){directRequests++;return req.abort();}
    if(req.url().startsWith(appOrigin)){
      try {
        const u=new URL(req.url());
        const response=await originalFetch(`http://127.0.0.1:${server.address().port}${u.pathname}${u.search}`,{headers:req.headers()});
        return req.respond({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
      }catch(error){console.error(error);return req.abort();}
    }
    return req.continue();
  });
  await page.setViewport({width:1440,height:1100});
  await page.goto(appOrigin+'/ensayo/rehearsal-test',{waitUntil:'domcontentloaded'});
  assert.equal(await page.evaluate(()=>crossOriginIsolated),true);
  await page.waitForSelector('audio[crossorigin]');
  await page.waitForFunction(()=>document.querySelector('audio[crossorigin]')?.duration>0,{timeout:60000});
  assert.equal(await page.$eval('audio[crossorigin]',a=>new URL(a.currentSrc).origin===location.origin),true);
  await page.evaluate(()=>{const a=document.querySelector('audio[crossorigin]');const c=new AudioContext();const source=c.createMediaElementSource(a);const analyser=c.createAnalyser();const mute=c.createGain();mute.gain.value=0;source.connect(analyser);analyser.connect(mute);mute.connect(c.destination);window.testAudio={c,analyser};return c.resume();});
  await page.click('button[aria-label="Reproducir ensayo"]');
  await page.waitForFunction(()=>document.querySelector('audio[crossorigin]')?.currentTime>0.2);
  // Exercise the real seek control, including React's native input handler.
  await page.$eval('input[aria-label="Posición de reproducción"]',el=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,3);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.waitForFunction(()=>document.querySelector('audio[crossorigin]')?.currentTime>3.2);
  const signal=await page.evaluate(()=>{const d=new Float32Array(testAudio.analyser.fftSize);testAudio.analyser.getFloatTimeDomainData(d);return Math.max(...d.map(Math.abs));});
  assert.ok(signal>0.001,`PCM must be nonzero: ${signal}`);
  await page.click('button[aria-label="Pausar ensayo"]');
  assert.equal(await page.$eval('audio[crossorigin]',a=>a.paused),true);
  await page.click('button[aria-label="Abrir fuentes de reproduccion"]');
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Voz de prueba')).click());
  await page.waitForFunction(()=>document.querySelector('audio[crossorigin]')?.currentSrc.includes('voice-test%3D1') && document.querySelector('audio[crossorigin]')?.duration>0);
  await page.click('button[aria-label="Reproducir ensayo"]');
  await page.waitForFunction(()=>document.querySelector('audio[crossorigin]')?.currentTime>0.2);
  await page.click('button[aria-label="Pausar ensayo"]');
  assert.equal(directRequests,0,'Rehearsal must not request R2 from the browser');
  assert.ok(statuses.some(s=>s===206),'Proxy must preserve byte-range playback');
  if(!process.env.REAL_AUDIO_URL)assert.ok(rangeRequests.some(Boolean),'Range must reach upstream');
  failAudio=true;
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('No se pudo cargar'));
  const before=proxyRequests;await new Promise(r=>setTimeout(r,500));assert.equal(proxyRequests,before,'No automatic retry loop');
  failAudio=false;await page.click('button[aria-label="Reproducir ensayo"]');
  await page.waitForFunction(()=>document.querySelector('audio[crossorigin]')?.currentTime>0.2);
  assert.equal(await page.$('[role="alert"]'),null,'Successful retry clears error');
  await page.click('button[aria-label="Volver"]');
  assert.equal(await page.evaluate(()=>window.__wentBack),true);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({pass:true,source:process.env.REAL_AUDIO_URL?'real R2 MP3':'fixture without CORS',signal,proxyRequests,statuses,directRequests,verified:['rehearsal under COEP','metadata','play','seek','PCM signal','pause','switch to voice source','visible error','bounded retry']}));
}finally{browser?.process()?.kill('SIGKILL');server.closeAllConnections();await new Promise(r=>server.close(r));globalThis.fetch=originalFetch;await rm(dir,{recursive:true,force:true});}
