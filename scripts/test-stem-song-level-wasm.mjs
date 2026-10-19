import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { StemSongLevelAnalyzer } from '../src/utils/stemSongLevel.ts';
const require=createRequire(import.meta.url);
// Exercise the exact browser FFmpeg core in-process, without a browser/profile.
// Emscripten's worker build only needs location when wasm bytes are supplied.
const previousSelf=globalThis.self;
globalThis.self={location:{href:require.resolve('@ffmpeg/core')}};
const core=await require('@ffmpeg/core')({wasmBinary:readFileSync(require.resolve('@ffmpeg/core/wasm'))});
let logs=[];
core.setLogger(({message})=>logs.push(message));
const adapter={
  async exec(args){core.reset();return core.exec(...args);},
  async deleteFile(path){core.FS.unlink(path);}
};
try {
  const analyzer=new StemSongLevelAnalyzer(adapter,()=>logs,()=>{logs=[];});
  for(let i=0;i<15;i++) {
    assert.equal(await adapter.exec(['-hide_banner','-f','lavfi','-i',`sine=frequency=${300+i*30}:duration=3:sample_rate=48000`,
      '-af',`volume=${i<3?2:0.15}`,'-ac','2','-c:a','pcm_f32le',`stem-${i}.wav`]),0);
    await analyzer.add(`stem-${i}`,`stem-${i}.wav`,i<3);
  }
  const gain=await analyzer.finish();
  assert.equal(gain('stem-3'),gain('stem-14'));
  assert.notEqual(gain('stem-0'),gain('stem-14'));
  for(let i=0;i<15;i++) {
    assert.equal(await adapter.exec(['-hide_banner','-i',`stem-${i}.wav`,'-af',`volume=${gain(`stem-${i}`).toFixed(4)}dB`,
      '-c:a','aac','-profile:a','aac_low','-b:a','256k','-ar','48000','-movflags','+faststart',`out-${i}.m4a`]),0,logs.slice(-5).join('\n'));
    const bytes=core.FS.readFile(`out-${i}.m4a`);
    const buffer=Buffer.from(bytes);
    assert.ok(buffer.indexOf('moov')<buffer.indexOf('mdat'),'Fast Start must remain enabled');
    const measured=await analyzer.measure(`out-${i}.m4a`);
    assert.ok(measured.peak < 0,`Encoded stem peak ${measured.peak}`);
    core.FS.unlink(`stem-${i}.wav`);core.FS.unlink(`out-${i}.m4a`);
  }
  await analyzer.cleanup();
  assert.equal(core.FS.readdir('/').some(name=>name.startsWith('song-level-')),false);
  console.log('PASS: browser WASM core, 15 stems, LUFS measurement, AAC-LC encoding, peak headroom, Fast Start and cleanup.');
} finally {globalThis.self=previousSelf;}
