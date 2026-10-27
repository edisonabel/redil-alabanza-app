import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StemSongLevelAnalyzer, getSongGainDb, SONG_TARGET_LUFS, SONG_PEAK_DB } from '../src/utils/stemSongLevel.ts';
const dir=mkdtempSync(join(tmpdir(),'song-level-'));
const ffmpeg=process.env.FFMPEG_BIN || '/opt/homebrew/bin/ffmpeg';
let logs=[];
const run = args => {
  try { execFileSync(ffmpeg,args,{cwd:dir,stdio:['ignore','ignore','pipe']}); return 0; }
  catch(e) { if(e.stderr) logs=String(e.stderr).split('\n'); return e.status || 1; }
};
// execFileSync does not return stderr on success; spawnSync does.
const {spawnSync}=await import('node:child_process');
const adapter={
  async exec(args){const r=spawnSync(ffmpeg,args,{cwd:dir,encoding:'utf8',maxBuffer:4e6});logs=r.stderr.split('\n');return r.status;},
  async deleteFile(path){unlinkSync(join(dir,path));}
};
async function gains(scale, withControl=true) {
  const analyzer=new StemSongLevelAnalyzer(adapter,()=>logs,()=>{logs=[];});
  try {
    for(const [id,freq,volume] of [['piano',440,scale],['banjo',700,scale/2],...(withControl?[['click',1200,4]]:[])]) {
      assert.equal(run(['-v','error','-y','-f','lavfi','-i',`sine=frequency=${freq}:duration=5:sample_rate=48000`,
        '-af',`volume=${volume}`,'-ac','2','-c:a','pcm_f32le',`${id}.wav`]),0);
      await analyzer.add(id,`${id}.wav`,id==='click');
    }
    const gain=await analyzer.finish();
    assert.equal(gain('piano'),gain('banjo'),'Every instrument must get identical gain');
    return gain;
  } finally {await analyzer.cleanup();}
}
try {
  assert.equal(SONG_TARGET_LUFS,-14);assert.equal(SONG_PEAK_DB,-2);
  assert.equal(getSongGainDb({integrated:-50,peak:-50}),24,'Quiet source gain remains bounded while allowing normalization');
  assert.equal(getSongGainDb({integrated:-18,peak:-8}),4,'A mix at the old target gets 4 dB more level');
  assert.equal(getSongGainDb({integrated:-18,peak:-2}),0,'Peak margin still controls the static gain');
  const quiet=await gains(0.5);
  const loud=await gains(2);
  assert.ok(Math.abs((quiet('piano')-loud('piano'))-12.0412)<0.15,'12 dB source difference should be compensated');
  const noClick=await gains(0.5,false);
  assert.ok(Math.abs(quiet('piano')-noClick('piano'))<0.01,'Loud click must not change music level');
  assert.notEqual(quiet('click'),quiet('piano'));
  assert.equal(existsSync(join(dir,'song-level-a.wav')),false);
  const analyzer=new StemSongLevelAnalyzer(adapter,()=>logs,()=>{logs=[];});
  assert.equal(run(['-v','error','-y','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','3','-c:a','pcm_f32le','silent.wav']),0);
  await analyzer.add('silent','silent.wav',false);
  const silence=await analyzer.finish();
  assert.equal(silence('silent'),0);
  await analyzer.cleanup();
  console.log('PASS: real FFmpeg loudness measurement, common gain, quiet/loud songs, click isolation, silence and cleanup.');
} finally {rmSync(dir,{recursive:true,force:true});}
