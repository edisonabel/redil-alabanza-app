import assert from 'node:assert/strict';import{createRequire}from'node:module';import{build}from'esbuild';import{readFile,writeFile,mkdir}from'node:fs/promises';
const LAB = process.env.LD_LAB_URL || 'http://127.0.0.1:4322'; // laboratorio Providencia (configurable)
const{chromium,webkit}=createRequire(import.meta.url)('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const bundle=await build({entryPoints:['src/services/DynamicGuidePlayer.ts','src/utils/liveDirectorGuideCues.ts'],bundle:true,write:false,outdir:'/tmp/jump-count-test',format:'iife',globalName:'CountGuide'});
const playerBundle=bundle.outputFiles.find(f=>f.path.endsWith('DynamicGuidePlayer.js')).text;
const utilBundle=bundle.outputFiles.find(f=>f.path.endsWith('liveDirectorGuideCues.js')).text.replace('var CountGuide =','var CountRules =');
const results=[];
for(const[name,type]of[['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch({headless:true,...(name==='chromium'?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--autoplay-policy=no-user-gesture-required','--mute-audio']}:{})});
 try{const page=await browser.newPage();await page.route(`${LAB}/jump-count-test`,r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Count test</title>'}));
 // Serve real voice assets from disk, independent of a dev server or auth.
 await page.route('**/audio/guide-es/**',async route=>{const path=new URL(route.request().url()).pathname;await route.fulfill({body:await readFile('public'+path),contentType:path.endsWith('.json')?'application/json':'audio/wav'});});
 await page.goto(`${LAB}/jump-count-test`);await page.addScriptTag({content:playerBundle});await page.addScriptTag({content:utilBundle});
 const result=await page.evaluate(async()=>{
  const context=new AudioContext({sampleRate:48000});await context.resume();
  const code=`class Probe extends AudioWorkletProcessor{constructor(){super();this.l=0;this.r=0;this.port.onmessage=()=>{this.port.postMessage({left:this.l,right:this.r});this.l=0;this.r=0;};}process(inputs){const a=inputs[0];if(a){for(const v of a[0]||[])this.l=Math.max(this.l,Math.abs(v));for(const v of a[1]||[])this.r=Math.max(this.r,Math.abs(v));}return true;}}registerProcessor('count-probe',Probe);`;
  const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));await context.audioWorklet.addModule(url);URL.revokeObjectURL(url);
  const probe=new AudioWorkletNode(context,'count-probe',{channelCount:2,channelCountMode:'explicit'}),silence=context.createGain();silence.gain.value=0;probe.connect(silence).connect(context.destination);
  const ducks=[],starts=[],stops=[];let state={gain:.5,route:'left'},confirmation='normal',confirm;
  const graph={context,destination:probe,readState:()=>state,setOverride:()=>{},scheduleRecordedGuideDuck:(start,end,boundary,voiceEnd)=>{ducks.push({start,end,boundary,voiceEnd});return confirmation==='hold'?new Promise(r=>confirm=r):Promise.resolve()},clearRecordedGuideDuck:()=>{}};
  const player=new CountGuide.DynamicGuidePlayer(graph);await player.load(new AbortController().signal);
  const create=context.createBufferSource.bind(context);context.createBufferSource=()=>{const node=create(),start=node.start.bind(node),stop=node.stop.bind(node);node.start=(at)=>{const key=[...player.buffers].find(([,b])=>b===node.buffer)?.[0];starts.push({key,at,rate:node.playbackRate.value,duration:node.buffer.duration});start(at)};node.stop=()=>{stops.push({at:context.currentTime});stop()};return node;};
  const tick=()=>new Promise(r=>setTimeout(r,40));const read=()=>new Promise(r=>{probe.port.onmessage=e=>r(e.data);probe.port.postMessage('read')});
  const sections=[{id:'intro'},{id:'verse'},{id:'chorus'},{id:'bridge'}],rules={following:CountRules.shouldCountGuideJump(sections,'intro','verse'),skip:CountRules.shouldCountGuideJump(sections,'intro','chorus'),back:CountRules.shouldCountGuideJump(sections,'chorus','intro'),same:CountRules.shouldCountGuideJump(sections,'chorus','chorus')};
  const before=context.currentTime;player.update({id:'jump:chorus',name:'Coro 1',boundary:4,countIn:true},0,120,{numerator:4,denominator:4});await tick();const four=starts.slice();
  await new Promise(r=>setTimeout(r,1750));const left=await read();player.pause();await tick();await read();
  state={gain:.4,route:'right'};const first=starts.length,threeBase=context.currentTime;player.update({id:'jump:intro',name:'Intro',boundary:4,countIn:true},0,120,{numerator:3,denominator:4});await tick();const three=starts.slice(first);await new Promise(r=>setTimeout(r,2100));const right=await read();player.pause();await tick();await read();
  state={gain:0,route:'left'};const muteBase=starts.length;player.update({id:'jump:muted',name:'Intro',boundary:4,countIn:true},0,120,{numerator:4,denominator:4});await tick();await new Promise(r=>setTimeout(r,1600));const muted=await read();player.pause();
  state={gain:.5,route:'left'};await tick();await read();const cancelAt=starts.length;player.update({id:'jump:cancel',name:'Intro',boundary:4,countIn:true},0,120,{numerator:4,denominator:4});await tick();const stoppedBefore=stops.length;player.pause();const cancelStops=stops.length-stoppedBefore;await new Promise(r=>setTimeout(r,2300));const cancelled=await read();
  const normalAt=starts.length;player.update(null,0,120,{numerator:4,denominator:4});await tick();const normalStarts=starts.length-normalAt;
  const followingAt=starts.length;player.update({id:'jump:following',name:'Verso 1',boundary:3,countIn:false},0,120,{numerator:4,denominator:4});await tick();const following=starts.slice(followingAt);player.pause();
  const lateAt=starts.length;player.update({id:'jump:late',name:'Intro',boundary:.8,countIn:true},0,120,{numerator:4,denominator:4});await tick();const late=starts.slice(lateAt);player.pause();
  const sixAt=starts.length,sixBase=context.currentTime;player.update({id:'jump:six',name:'Intro',boundary:4,countIn:true},0,120,{numerator:6,denominator:8});await tick();const six=starts.slice(sixAt);player.pause();const shortAt=starts.length;player.update({id:'jump:short',name:'Intro',boundary:1.5,countIn:true},0,120,{numerator:4,denominator:4});await tick();const short=starts.slice(shortAt);player.pause();
  confirmation='hold';const unconfirmedAt=starts.length;player.update({id:'jump:confirm',name:'Intro',boundary:4,countIn:true},0,120,{numerator:4,denominator:4});await tick();const beforeConfirmation=starts.length-unconfirmedAt;player.pause();confirm();await tick();const afterCancelledConfirmation=starts.length-unconfirmedAt;
  const events=player.events.slice();player.dispose();await context.close();return{rules,before,four,threeBase,three,sixBase,six,short,left,right,muted,cancelStops,cancelled,normalStarts,following,late,beforeConfirmation,afterCancelledConfirmation,events,ducks};
 });
 assert.deepEqual(result.rules,{following:false,skip:true,back:true,same:true});
 assert.deepEqual(result.four.map(x=>x.key),['coro','1','2','3','4']);assert.deepEqual(result.three.map(x=>x.key),['intro','1','2','3']);assert.deepEqual(result.six.map(x=>x.key),['intro','1','2','3','4','5','6']);assert.deepEqual(result.short.map(x=>x.key),['intro']);for(let i=0;i<6;i++)assert.ok(Math.abs(result.six[i+1].at-(result.sixBase+2.5+i*.25))<.03);
 for(const[voices,base,beats]of[[result.four,result.before,4],[result.three,result.threeBase,3]]){const numbers=voices.filter(x=>/^\d+$/.test(x.key));for(let i=0;i<beats;i++){assert.ok(Math.abs(numbers[i].at-(base+4-(beats-i)*.5))<.03);assert.equal(numbers[i].rate,1,'Cada número suena entero, sin acelerarlo');}assert.ok(voices[0].at+voices[0].duration<numbers[0].at);}
 assert.ok(result.left.left>.05);assert.equal(result.left.right,0);assert.ok(result.right.right>.05);assert.equal(result.right.left,0);assert.deepEqual(result.muted,{left:0,right:0});assert.equal(result.cancelStops,5);assert.deepEqual(result.cancelled,{left:0,right:0});assert.equal(result.normalStarts,0);assert.deepEqual(result.following.map(x=>x.key),['verso-1']);assert.deepEqual(result.late,[]);assert.equal(result.beforeConfirmation,0);assert.equal(result.afterCancelledConfirmation,0);
 results.push({name,...result});console.log(name+' spoken Spanish jump count, 4/4 and 3/4, routing, normal-next exclusion and cancellation passed');
 }finally{await browser.close();}
}
await mkdir('.lab/results',{recursive:true});await writeFile('.lab/results/jump-count.json',JSON.stringify({pass:true,results},null,2));
