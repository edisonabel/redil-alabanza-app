import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});
const deadline=setTimeout(()=>{console.error('Browser regression test exceeded 90 seconds');browser.process()?.kill('SIGKILL');},90000);
try {
  const page=await browser.newPage();
  const errors=[];const saves=[];let missingRequests=0;
  page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});
  page.on('console',m=>{if(m.type()==='error')console.log('BROWSER',m.text().slice(0,600));});
  await page.setViewport({width:1440,height:900});
  await page.setRequestInterception(true);
  page.on('request',req=>{
    if(req.url().includes('/missing-stem-')) {missingRequests++;return req.respond({status:404,body:'Not found',headers:{'Access-Control-Allow-Origin':'*'}});}
    if(req.url().includes('/api/live-director-upload-permission'))return req.respond({status:200,contentType:'application/json',body:JSON.stringify({allowed:true})});
    if(req.url().includes('/api/live-director-song-session') && req.method()!=='GET') {
      saves.push(req.postData());return req.respond({status:409,contentType:'application/json',body:JSON.stringify({error:'Unexpected test save'})});
    }
    return req.continue();
  });
  await page.goto(`${process.env.LIVE_DIRECTOR_TEST_URL || 'http://127.0.0.1:4321'}/login`,{waitUntil:'networkidle2',timeout:60000});
  console.log('Mounting component');
  await page.evaluate(async()=>{
    Object.defineProperty(window,'AudioDecoder',{value:undefined,configurable:true});
    const refresh=(await import('/@react-refresh')).default;
    refresh.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>t=>t;window.__vite_plugin_react_preamble_installed__=true;
    const React=(await import('/@id/react')).default;
    const reactDomModule=await import('/@id/react-dom/client');
    const {createRoot}=reactDomModule.default || reactDomModule;
    const {LiveDirectorView}=await import('/src/components/react/LiveDirectorView.tsx');
    const {normalizePersistedLiveDirectorSession}=await import('/src/utils/liveDirectorSongSession.ts');
    const songId='ac2e5fd9-eba8-4d47-b5e4-6b00e85454ab';
    const initialSession=normalizePersistedLiveDirectorSession({songId,songTitle:'Missing files fixture',mode:'folder',tracks:[
      {id:'click',name:'Click',url:location.origin+'/missing-stem-click.m4a',sourceFileName:'01-click.m4a',volume:0.4},
      {id:'custom-10-banjo-banjo',name:'10 Banjo Banjo',url:location.origin+'/missing-stem-banjo.m4a',sourceFileName:'10-banjo--Banjo.m4a',volume:0.7}
    ]});
    if(initialSession.tracks[1].name!=='Banjo')throw new Error('Persisted label not repaired');
    document.body.innerHTML='<div id="test-root"></div>';document.documentElement.classList.add('dark');
    const root=createRoot(document.getElementById('test-root'));
    const props={songId,songTitle:'Missing files fixture',initialSession,onBack:()=>{window.__wentBack=true;},requiresSongContext:true};
    window.__switchSong=()=>root.render(React.createElement(LiveDirectorView,{...props,songId:'be0aa6b3-6043-4810-ba16-6bfba8bc9dd5',initialSession:null}));
    root.render(React.createElement(LiveDirectorView,props));
  });
  console.log('Waiting for visible error');
  await page.waitForFunction(()=>document.body.textContent.includes('Error de audio'),{timeout:30000});
  assert.match(await page.evaluate(()=>document.body.textContent),/Faltan archivos/);
  const afterFailure=missingRequests;
  await new Promise(r=>setTimeout(r,4500));
  assert.equal(missingRequests,afterFailure,'Failure must not restart the download');
  assert.equal(await page.evaluate(()=>document.body.textContent.includes('Preparando motor')),false);
  await page.screenshot({path:'/tmp/live-director-missing-error.png'});
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='REINTENTAR CARGA').click());
  await page.waitForFunction(()=>document.body.textContent.includes('Error de audio'),{timeout:30000});
  assert.ok(missingRequests>afterFailure,'Explicit retry must work');
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Volver').click());
  assert.equal(await page.evaluate(()=>window.__wentBack),true);
  const beforeSwitch=missingRequests;
  await page.evaluate(()=>window.__switchSong());
  await new Promise(r=>setTimeout(r,1600));
  assert.equal(missingRequests,beforeSwitch,'Changing songs must not restart the old tracks');
  assert.equal(saves.length,0,'Previous song tracks must never autosave to the new song');
  assert.equal(await page.evaluate(()=>document.body.textContent.includes('Preparando motor')),false);
  assert.deepEqual(errors,[]);
  console.log(`PASS: real 404 stops loading, stable error, explicit retry, Back, clean persisted labels and navigation without cross-song saves (${missingRequests} fixture requests).`);
} finally {browser.process()?.kill('SIGKILL');clearTimeout(deadline);}
