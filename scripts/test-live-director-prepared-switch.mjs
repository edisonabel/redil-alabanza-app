import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = await readFile(new URL('../public/workers/MultitrackWorkletProcessor.js', import.meta.url), 'utf8');
let Processor;
class MockProcessor { constructor() { this.messages=[]; this.port={postMessage:data=>this.messages.push({...data})}; } }
const sandbox={AudioWorkletProcessor:MockProcessor,registerProcessor:(_name,value)=>{Processor=value},sampleRate:48000,currentFrame:96000,Float32Array,Float64Array,Int32Array,SharedArrayBuffer,Atomics,Math,Number,Set,console};
vm.runInNewContext(source,sandbox);
const rate=48000,capacity=32768,minimumFrames=24000;
const close=(actual,expected,why)=>assert.ok(Math.abs(actual-expected)<1e-6,`${why}: ${actual} != ${expected}`);
function ring(trackIndex,value,targetFrame=0,available=capacity) {
  const sampleBuffer=new SharedArrayBuffer(capacity*4),indexBuffer=new SharedArrayBuffer(8);
  new Float32Array(sampleBuffer).fill(value);
  const indices=new Int32Array(indexBuffer),read=targetFrame%(capacity*2);
  indices[0]=read;indices[1]=(read+available)%(capacity*2);
  return {trackIndex,capacity,sampleRate:rate,channelCount:1,sampleBuffer,indexBuffer};
}
function setup(count=15) {
  const p=new Processor();
  if (process.argv.includes('--metering')) p.handleMessage({ type: 'music-meter-enabled', enabled: true });
  for(let i=0;i<count;i++) {
    p.configureTrack({...ring(i,(i+1)/1000),id:`stem-${i}`,usesSharedMemory:true,volume:1,isMuted:false});
    p.tracks[i].effectiveGain=1;
  }
  p.playing=true;p.publishMeterMessages=false;
  return p;
}
function render(p,frames=128) {
  const output=[new Float32Array(frames),new Float32Array(frames)];
  assert.equal(p.process([],[output]),true);
  sandbox.currentFrame+=frames;
  return output;
}
function prepare(p,{serial=1,boundaryFrame=64,targetFrame=480000,tracks=null,controlBuffer=new SharedArrayBuffer(24)}={}) {
  const configs=tracks||Array.from({length:p.trackCount},(_,i)=>ring(i,(i+1)/500,targetFrame));
  p.handleMessage({type:'prepare-section-switch',serial,boundarySeconds:boundaryFrame/rate,targetSeconds:targetFrame/rate,tracks:configs,minimumFrames,controlBuffer});
  return {configs,control:new Int32Array(controlBuffer,0,1),timing:controlBuffer.byteLength>=24?new Float64Array(controlBuffer,8,2):null};
}
const cases=[];
for(const targetFrame of [480000,16]) for(const boundaryFrame of [1,64,128,192,256]) {
  sandbox.currentFrame=96000;
  const p=setup(),sequenceBuffer=new SharedArrayBuffer(4),timeBuffer=new SharedArrayBuffer(8),levelBuffer=new SharedArrayBuffer(15*4);
  p.configureTelemetry({sequenceBuffer,timeBuffer,levelBuffer,trackCount:15,publishMeterMessages:false});
  const {configs,control,timing}=prepare(p,{boundaryFrame,targetFrame});
  const before=p.tracks.map(t=>t.indices);
  const result=[];
  for(let block=0;block<3;block++) result.push(...render(p)[0]);
  for(let frame=0;frame<result.length;frame++) close(result[frame],frame<boundaryFrame?.12:.24,'all fifteen stems switch at exact frame');
  assert.equal(control[0],1);
  for(let i=0;i<15;i++) {
    assert.notEqual(p.tracks[i].indices,before[i]);
    assert.equal(p.tracks[i].samples.buffer,configs[i].sampleBuffer);
    assert.equal(p.tracks[i].absoluteReadFrame,targetFrame+384-boundaryFrame);
    assert.equal(p.tracks[i].underrunFrames,0);
  }
  const messages=p.messages.filter(m=>m.type==='section-switch-complete');assert.equal(messages.length,1);
  close(messages[0].contextTime,2+boundaryFrame/rate,'context timestamp');
  close(timing[0],messages[0].contextTime,'shared commit context');
  const commitBlockEnd=Math.ceil(boundaryFrame/128)*128;
  close(timing[1],(targetFrame+commitBlockEnd-boundaryFrame)/rate,'shared commit position');
  close(new Float64Array(timeBuffer)[0],(targetFrame+384-boundaryFrame)/rate,'published clock');
  assert.equal(p.playing,true);assert.equal(p.readingBlocked,false);assert.equal(p.fadeInFramesRemaining,0);
  cases.push({targetFrame,boundaryFrame,allStems:15,underruns:0});
}
// A single unready stem must leave ALL active rings and the original output intact.
for(const fault of ['unready','bad-read','bad-write','incomplete','cancel','atomic-cancel','stale-cancel','late','wrong-rate']) {
  const p=setup(),old=p.tracks.map(t=>t.samples.buffer),targetFrame=480000;
  const configs=Array.from({length:15},(_,i)=>ring(i,(i+1)/500,targetFrame));
  if(fault==='unready') new Int32Array(configs[14].indexBuffer)[1]=(targetFrame%(capacity*2)+minimumFrames-1)%(capacity*2);
  if(fault==='bad-read') new Int32Array(configs[14].indexBuffer)[0]++;
  if(fault==='bad-write') new Int32Array(configs[14].indexBuffer)[1]=-1;
  if(fault==='incomplete') configs.pop();
  if(fault==='wrong-rate') configs[14].sampleRate=44100;
  const {control}=prepare(p,{tracks:configs,boundaryFrame:fault==='late'?0:64});
  if(fault==='cancel') p.handleMessage({type:'cancel-section-switch',serial:1});
  if(fault==='atomic-cancel') assert.equal(Atomics.compareExchange(control,0,0,-1),0);
  if(fault==='stale-cancel') p.handleMessage({type:'cancel-section-switch',serial:0});
  const output=render(p);
  if(fault==='stale-cancel') {
    assert.equal(control[0],1);close(output[0][64],.24,'stale cancellation must not cancel new plan');
  } else {
    assert.equal(control[0],-1,fault);
    for(let i=0;i<15;i++) assert.equal(p.tracks[i].samples.buffer,old[i],`${fault}: no partial track switch`);
    assert.ok(output[0].every(value=>Math.abs(value-.12)<1e-6),`${fault}: original audio continues`);
    assert.equal(p.messages.filter(m=>m.type==='section-switch-complete').length,0);
  }
  cases.push({rejection:fault});
}
// Ordinary graph/transport changes invalidate pending destinations immediately.
for(const type of ['PAUSE','PAUSE_AND_FLUSH','PAUSE_AND_ADVANCE','FLUSH_BUFFERS','transport','reset-tracks','remove-track','loop-region']) {
  const p=setup(),{control}=prepare(p);p.handleMessage({type,trackIndex:0,positionSeconds:0,playing:false});
  assert.equal(control[0],-1,`${type} must cancel pending destination`);assert.equal(p.pendingSectionSwitch,null);
}
// Replacing a plan invalidates the previous serial and only the replacement plays.
{
  const p=setup(),first=prepare(p),second=prepare(p,{serial:2,targetFrame:960000});
  assert.equal(first.control[0],-1);render(p);assert.equal(second.control[0],1);
  assert.equal(p.messages.find(m=>m.type==='section-switch-complete').serial,2);
}
// Switching buffers must preserve live faders, group trims, routing, solos and guide override.
{
  const p=setup();p.soloCount=1;
  for(let i=0;i<15;i++) Object.assign(p.tracks[i],{volume:.5,groupGain:.4,isMuted:i===3,isSolo:i===4,guideOverride:i===5,outputRoute:i%2?'left':'right',effectiveGain:.2});
  const before=p.tracks.map(t=>({volume:t.volume,groupGain:t.groupGain,isMuted:t.isMuted,isSolo:t.isSolo,guideOverride:t.guideOverride,outputRoute:t.outputRoute}));
  prepare(p);render(p);
  for(let i=0;i<15;i++) for(const [key,value] of Object.entries(before[i])) assert.equal(p.tracks[i][key],value,`${key} persists`);
  assert.equal(p.soloCount,1);
}
// Once committed, a late cancel cannot roll the atomic state back.
{
  const p=setup(),{control}=prepare(p);render(p);p.handleMessage({type:'cancel-section-switch',serial:1});assert.equal(control[0],1);
}
// Destination views and event envelopes are allocated on message, never during rendering.
{
  const p=setup();prepare(p);
  const saved={Float32Array:sandbox.Float32Array,Float64Array:sandbox.Float64Array,Int32Array:sandbox.Int32Array};
  for(const key of Object.keys(saved)) sandbox[key]=class { constructor(){throw new Error(`Unexpected render allocation: ${key}`);} };
  try { render(p); assert.equal(p.messages.filter(m=>m.type==='render-error').length,0);assert.equal(p.messages.filter(m=>m.type==='section-switch-complete').length,1); }
  finally { Object.assign(sandbox,saved); }
}
console.log(JSON.stringify({passed:true,cases,transportCancellationCases:8,allStemAtomicity:true,exactBoundaryPcm:true,sharedCommitTiming:true,preservedMix:true}));
// A different song replaces the entire track table at one sample boundary.
// Its saved mix and routing must replace the source mix even when counts differ.
for(const count of [2,18]){
 const p=setup(5);p.soloCount=1;p.tracks[0].isSolo=true;
 const configs=Array.from({length:count},(_,i)=>({...ring(i,.04,0),id:`destination-${i}`,usesSharedMemory:true,volume:.5,isMuted:i===0,outputRoute:'right',isCue:i===1}));
 const controlBuffer=new SharedArrayBuffer(24);
 p.handleMessage({type:'prepare-section-switch',serial:10,boundarySeconds:64/rate,targetSeconds:0,tracks:configs,minimumFrames,controlBuffer,replaceSong:true});
 assert.equal(p.trackCount,5,'Preparation must leave the source alone');
 render(p);assert.equal(new Int32Array(controlBuffer)[0],1);assert.equal(p.trackCount,count);assert.equal(p.soloCount,0);
 for(let i=0;i<count;i++){assert.equal(p.tracks[i].id,`destination-${i}`);assert.equal(p.tracks[i].volume,.5);assert.equal(p.tracks[i].isMuted,i===0);assert.equal(p.tracks[i].outputRoute,'right');assert.equal(p.tracks[i].samples.buffer,configs[i].sampleBuffer);}
}
{
 const p=setup(5),controlBuffer=new SharedArrayBuffer(24),configs=[{...ring(0,.1),usesSharedMemory:true,volume:1}];
 p.handleMessage({type:'prepare-section-switch',serial:11,boundarySeconds:64/rate,targetSeconds:0,tracks:configs,minimumFrames,controlBuffer,replaceSong:true,pauseAtTarget:true});
 const output=render(p);assert.equal(p.playing,false);assert.ok(output[0].slice(64).every(x=>x===0),'A synthetic entry must count before the destination starts');assert.equal(p.renderedFrames,64);
}
console.log('Prepared different-song switch: fewer/more stems, destination mix and paused entry: ok');
