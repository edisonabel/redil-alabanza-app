import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import JSZip from 'jszip';
import { parseReaperProject } from '../src/utils/reaperProjectParser.js';

// Offline fixture: never opens the authenticated app or contacts catalog/storage.
const wav = Buffer.alloc(44+44100*12*2);
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(44100,24);wav.writeUInt32LE(88200,28);
wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
for(let i=0;i<44100*12;i++) wav.writeInt16LE(i%22050<200 ? Math.round(10000*Math.sin(i/10)) : 0,44+i*2);
const song={id:'fixture-song',titulo:'Prueba multitrack de nombre muy largo para revisar responsividad',bpm:120,metrica:'4/4',section_markers:[{sectionName:'Intro 1',startSec:1},{sectionName:'Coro 1',startSec:5}],multitrack_session:{sectionOffsetSeconds:1,tracks:[{name:'Click',url:'fixture:click',sourceFileName:'Click.wav'},{name:'Guide',url:'fixture:guide',sourceFileName:'Guide.wav'},{name:'Piano',url:'fixture:piano',sourceFileName:'Piano.wav'}]}};
const assistant=await readFile('public/downloads/Alabanza-Asistente.lua','utf8');
const guide=await readFile('public/downloads/Alabanza-REAPER-Instrucciones.md','utf8');
const visualGuide=Buffer.from('%PDF-1.4 fixture guide');
const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Workspace from './src/components/AdminReaperWorkspace.jsx';import{parseReaperProject,reviewReaperProject}from'./src/utils/reaperProjectParser.js';window.renderWorkspace=(songs,admin=true)=>{window.__root??=createRoot(document.getElementById('root'));window.__root.render(<Workspace songs={songs} isAdmin={admin}/>)};window.parser=parseReaperProject;window.review=reviewReaperProject;`,resolveDir:process.cwd(),loader:'jsx'},jsx:'automatic',bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"production"'}});
const cssName=(await readdir('dist/_astro')).find(name=>/^global\..*\.css$/.test(name));
let css=await readFile(`dist/_astro/${cssName}`,'utf8');
css += await readFile(`dist/_astro/${(await readdir('dist/_astro')).find(name=>/^Layout\..*\.css$/.test(name))}`,'utf8');
css=css.replace(/url\(([^)]+)\)/g,'none');
await mkdir('.lab/results',{recursive:true});
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--mute-audio']});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewport({width:1440,height:1000});
 await page.setContent(`<html><head><style>${css}</style></head><body><div id="root" style="display:flex;height:100vh;flex-direction:column"></div></body></html>`);
 await page.evaluate(({wavB64,assistant,guide,visualGuide,song})=>{
  const binary=Uint8Array.from(atob(wavB64),c=>c.charCodeAt(0));
  window.__requests=[];window.__failedAudio=false;
  const originalCreate=URL.createObjectURL.bind(URL);window.__blobs=new Map();
  URL.createObjectURL=blob=>{const url=originalCreate(blob);window.__blobs.set(url,blob);return url};
  const originalClick=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){if(this.download){window.__downloadBlob=window.__blobs.get(this.href);window.__downloadName=this.download}else originalClick.call(this)};
  window.fetch=async(url,options={})=>{
   window.__requests.push({url:String(url),method:options.method||'GET'});
   if(String(url).startsWith('fixture:'))return window.__failedAudio?new Response('failed',{status:503}):new Response(binary,{headers:{'content-type':'audio/wav'}});
   if(String(url).endsWith('.lua'))return new Response(assistant);
   if(String(url).endsWith('.md'))return new Response(guide);
   if(String(url).endsWith('.pdf'))return new Response(Uint8Array.from(atob(visualGuide),c=>c.charCodeAt(0)),{headers:{'content-type':'application/pdf'}});
   if(String(url).includes('admin-reaper-project')){
    if(options.method==='POST'){
     const parsed=window.parser(await options.body.text());
     return Response.json({analysis:{...parsed,review:window.review(parsed,song)},project:{key:'saved.RPP',fileName:'Prueba.RPP',size:100,updatedAt:'2026-10-23T12:00:00Z'}},{status:201});
    }
    return Response.json({projects:[]});
   }
   throw new Error('Unexpected request '+url);
  };
 },{wavB64:wav.toString('base64'),assistant,guide,visualGuide:visualGuide.toString('base64'),song});
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.evaluate(song=>window.renderWorkspace([song]),song);
 await page.waitForSelector('button');
 const download=await page.$('button.bg-brand');assert.ok(download);
 await download.click();
 await page.waitForFunction(()=>window.__downloadBlob,{timeout:30000});
 const zipData=await page.evaluate(()=>new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(window.__downloadBlob)}));
 const zip=await JSZip.loadAsync(Buffer.from(zipData,'base64'));
 const projectEntry=Object.keys(zip.files).find(name=>name.endsWith('.RPP'));
 const projectText=await zip.file(projectEntry).async('string');
 const parsed=parseReaperProject(projectText);
 assert.equal(parsed.items.length,3);assert.ok(parsed.items.every(item=>item.length===12&&item.position===0&&item.rate===1));
 assert.equal(parsed.markers[0].timeSeconds,2);assert.equal(parsed.markers.at(-1).timeSeconds,12);
 for(const item of parsed.items)assert.ok(zip.file(`${projectEntry.split('/')[0]}/${item.source}`),'Every RPP source resolves in the ZIP');
 assert.ok(Object.keys(zip.files).some(name=>name.endsWith('Alabanza-Asistente.lua')));
 assert.ok(Object.keys(zip.files).some(name=>name.endsWith('Guia-visual-REAPER.pdf')));
 await writeFile('.lab/results/reaper-prepared-fixture.RPP',projectText);
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Ya guardé mi RPP'))?.click());
 const upload=await page.$('input[type=file]');
 await upload.uploadFile(resolve('.lab/results/reaper-prepared-fixture.RPP'));
 // Si no se puede aplicar, lo dice y da el motivo (aquí, los marcadores sin confirmar del borrador).
 await page.waitForFunction(()=>document.body.textContent.includes('Todavía no se puede aplicar'));
 const blocked=await page.$eval('[data-reaper-apply-blocked]',el=>el.textContent);
 assert.match(blocked,/No se puede aplicar porque:/);assert.match(blocked,/marcadores por confirmar/);
 await page.click('summary');
 assert.equal(await page.$$eval('tbody tr',rows=>rows.length),2);
 await page.screenshot({path:'.lab/results/reaper-preparation-desktop.png',fullPage:false});
 await page.evaluate(()=>document.documentElement.classList.add('dark'));
 await page.screenshot({path:'.lab/results/reaper-preparation-dark.png',fullPage:false});
 await page.evaluate(()=>document.documentElement.classList.remove('dark'));
 await page.$eval('input[type=file]',el=>el.scrollIntoView({block:'start'}));
 await page.screenshot({path:'.lab/results/reaper-preparation-report.png',fullPage:false});
 for(const width of [390,768]){
  await page.setViewport({width,height:844});
  await page.$eval('h2',el=>el.scrollIntoView({block:'start'}));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`No page overflow at ${width}`);
  await page.screenshot({path:`.lab/results/reaper-preparation-${width}.png`,fullPage:false});
 }
 // Error remains recoverable and button becomes usable again.
 await page.evaluate(()=>[...document.querySelectorAll('nav button')].find(button=>button.textContent.includes('Preparar'))?.click());
 await page.evaluate(()=>{window.__failedAudio=true;window.__downloadBlob=null});
 await (await page.$('button.bg-brand')).click();
 await page.waitForFunction(()=>document.querySelector('[role=alert]')?.textContent.includes('HTTP 503'));
 assert.equal(await page.$eval('button.bg-brand',button=>button.disabled),false);
 await page.evaluate(()=>window.renderWorkspace([]));
 await page.waitForFunction(()=>document.querySelector('select')?.disabled===true);
 assert.equal(await page.$eval('button.bg-brand',button=>button.disabled),true);
 await page.evaluate(()=>window.renderWorkspace([],false));
 await page.waitForFunction(()=>document.querySelector('#root').childElementCount===0);
 assert.deepEqual(errors,[]);
 await writeFile('.lab/results/reaper-prepared-fixture.RPP',projectText);
 await writeFile('.lab/results/reaper-prepared-fixture.zip',Buffer.from(zipData,'base64'));
 console.log('Offline REAPER UI: real WAV metadata, complete ZIP with matching sources, upload report, responsive layouts, recoverable failure and non-admin/empty states passed.');
}finally{await browser.close()}
