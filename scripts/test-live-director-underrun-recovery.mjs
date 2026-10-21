import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=await readFile(new URL('../public/workers/MultitrackWorkletProcessor.js',import.meta.url),'utf8');
let Processor;
class MockProcessor {constructor(){this.messages=[];this.port={postMessage:data=>this.messages.push(data)};}}
vm.runInNewContext(source,{AudioWorkletProcessor:MockProcessor,registerProcessor:(_name,value)=>{Processor=value},sampleRate:48000,Float32Array,Int32Array,SharedArrayBuffer,Atomics,Math,Number,console});
function configure(p,index,available,shared=true,muted=false){
  const samples=new Float32Array(shared?new SharedArrayBuffer(32768*4):new ArrayBuffer(32768*4));samples.fill(0.25);
  const indices=new Int32Array(new SharedArrayBuffer(8));indices[1]=available;
  p.configureTrack({trackIndex:index,id:'t'+index,capacity:samples.length,sampleRate:48000,channelCount:1,usesSharedMemory:shared,sampleBuffer:samples.buffer,indexBuffer:indices.buffer,volume:1,isMuted:muted});
  if(!shared){p.tracks[index].localSamples.set(samples);p.tracks[index].localWriteIndex=available;}
  return n=>{if(shared)Atomics.store(indices,1,n);else p.tracks[index].localWriteIndex=n;};
}
function render(p){const output=[new Float32Array(128),new Float32Array(128)];assert.equal(p.process([],[output]),true);return output;}
const cases=[];
for(const shared of [true,false])for(const muted of [true,false])for(const gapBlocks of [1,4,30]){
  const p=new Processor();const fill=configure(p,0,512,shared,muted);configure(p,1,24000,shared);
  p.playing=true;p.publishMeterMessages=false;
  for(let i=0;i<4+gapBlocks;i++)render(p);
  assert.equal(p.tracks[1].absoluteReadFrame-p.tracks[0].absoluteReadFrame,128*gapBlocks);
  fill(640);render(p); // A small refill must be discarded and acknowledged.
  const consumed=shared?Atomics.load(p.tracks[0].indices,0):p.tracks[0].localReadIndex;
  assert.equal(consumed,640,'Stale PCM must release ring space even with no renderable frames');
  fill(24000);for(let i=0;i<100;i++)render(p);
  assert.equal(p.tracks[0].absoluteReadFrame,p.tracks[1].absoluteReadFrame,'Recovered track must return to exact master position');
  assert.equal(p.tracks[0].recoveringUnderrun,false);
  cases.push({shared,muted,gapBlocks,remainingDriftFrames:0});
}
const p=new Processor();configure(p,0,0);p.playing=true;render(p);
assert.equal(p.tracks[0].recoveringUnderrun,true);
p.flushAllBuffers({targetSample:2048});
assert.equal(p.tracks[0].recoveringUnderrun,false,'Seek must clear previous underrun recovery');
assert.equal(p.tracks[0].absoluteReadFrame,2048);
const fault=new Processor();configure(fault,0,512);fault.playing=true;
fault.mixSharedTrack=()=>{throw new Error('Controlled test fault');};
assert.ok(render(fault).every(c=>c.every(value=>value===0)));
render(fault);assert.equal(fault.messages.filter(m=>m.type==='render-error').length,1);
assert.equal(fault.readingBlocked,true,'Fault stays safely silent pending explicit recovery');
console.log(JSON.stringify({passed:true,cases,renderFaultEvents:1,seekResetsRecovery:true}));
