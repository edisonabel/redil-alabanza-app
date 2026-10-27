import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { buildPreparedReaperProject } from '../src/utils/reaperPreparation.js';
const song={id:'song-1',titulo:'Cristo nuestra esperanza (Versión)',section_markers:[{sectionName:'Intro 1',startSec:2}],multitrack_session:{tracks:[{id:'click'}]}};
globalThis.__reaperFixture={song,puts:[],clientConfigs:[],admin:true,user:true,sessionUpdates:[],allowSessionUpdate:false,stored:''};
const dir=await mkdtemp(join(tmpdir(),'alabanza-reaper-upload-'));
try{
 await build({entryPoints:['src/pages/api/admin-reaper-project.js'],outfile:join(dir,'handler.mjs'),platform:'node',format:'esm',bundle:true,plugins:[{name:'offline-services',setup(b){
  b.onResolve({filter:/^(@aws-sdk\/client-s3|@supabase\/supabase-js)$/},args=>({path:args.path,namespace:'fixtures'}));
  b.onLoad({filter:/.*/,namespace:'fixtures'},args=>({loader:'js',contents:args.path.includes('aws-sdk')?`
export class GetObjectCommand{constructor(input){this.input=input}}
export class ListObjectsV2Command{constructor(input){this.input=input}}
export class PutObjectCommand{constructor(input){this.input=input}}
export class S3Client{constructor(config){globalThis.__reaperFixture.clientConfigs.push(config)}async send(command){if(command instanceof PutObjectCommand){globalThis.__reaperFixture.puts.push(command.input);return {}}if(command instanceof GetObjectCommand){const bytes=new TextEncoder().encode(globalThis.__reaperFixture.stored);return {Body:{transformToByteArray:async()=>bytes}}}return {Contents:[]}}}
`:`export function createClient(){return {auth:{getUser:async()=>({data:{user:globalThis.__reaperFixture.user?{id:'user-1'}:null}})},from(table){return {select(){return this},eq(){return this},async maybeSingle(){if(table==='perfiles')return {data:{is_admin:globalThis.__reaperFixture.admin}};if(table==='canciones')return {data:globalThis.__reaperFixture.song};throw new Error('Unexpected table')},update(value){if(table==='canciones'&&globalThis.__reaperFixture.allowSessionUpdate&&Object.keys(value).join()==='multitrack_session'){return {eq:async()=>{globalThis.__reaperFixture.sessionUpdates.push(value.multitrack_session);return {error:null}}}}throw new Error('Catalog write forbidden')},upsert(){throw new Error('Catalog write forbidden')}}}}}` }));
  b.onLoad({filter:/server\/supabase-env\.js$/},()=>({loader:'js',contents:`export const getSupabaseServerEnv=()=>({supabaseUrl:'https://fixture.invalid',supabaseAnonKey:'fixture'});export const getSupabaseServiceRoleKey=()=> 'fixture';export const readEnv=()=> 'fixture';`}));
 }}]});
 const {POST,PUT}=await import(pathToFileURL(join(dir,'handler.mjs')));
 const prepared=buildPreparedReaperProject({song,tracks:[{name:'Click',mediaPath:'Media/01 Click/01 - Click.wav',durationSeconds:10}]}).projectText;
 const upload=(body=prepared,options={})=>POST({request:new Request('https://fixture.invalid/api/admin-reaper-project?songId=song-1',{method:'POST',headers:{origin:options.origin||'https://fixture.invalid','x-file-name':options.name||'Test.RPP'},body}),cookies:{get:()=>options.anonymous?null:{value:'fixture-token'}}});
 const oldError=console.error;console.error=()=>{};
 try{
  assert.equal((await upload(prepared,{anonymous:true})).status,401);
  globalThis.__reaperFixture.admin=false;assert.equal((await upload()).status,403);globalThis.__reaperFixture.admin=true;
  assert.equal((await upload(prepared,{origin:'https://other.invalid'})).status,403);
  assert.equal((await upload(prepared.replace('ALABANZA_MAPA_V1:song-1','ALABANZA_MAPA_V1:wrong'))).status,422);
  assert.equal(globalThis.__reaperFixture.puts.length,0,'No storage writes for wrong song or denied requests');
  const response=await upload(prepared,{name:'Mi proyecto de prueba.RPP'});assert.equal(response.status,201);
  const result=await response.json();assert.equal(result.analysis.review.status,'needs-review');
  assert.equal(result.analysis.review.appliedToPlayback,false);
  assert.equal(globalThis.__reaperFixture.puts.length,1);
  assert.equal(globalThis.__reaperFixture.clientConfigs.at(-1).requestChecksumCalculation,'WHEN_REQUIRED','R2 client avoids unsupported automatic SDK checksum headers');
  assert.ok(globalThis.__reaperFixture.puts[0].Key.startsWith('live-director/reaper-projects/song-1/'));
  assert.match(globalThis.__reaperFixture.puts[0].Key,/Mi proyecto de prueba\.RPP$/,'S3 receives the raw key so it can encode it exactly once when signing');
  assert.equal(globalThis.__reaperFixture.puts[0].Metadata,undefined,'Unicode song titles are not sent as unsigned/non-ASCII S3 metadata headers');
  assert.equal((await upload('Not a REAPER file')).status,422);
  // Apply: instructions travel apart from the chosen sections and only inside UNO–FIN AUDIO.
  globalThis.__reaperFixture.stored=prepared.replaceAll('[BORRADOR] ','').replace('  MARKER 1 ',`  MARKER 50 1 "UNO" 0 0 1\n  MARKER 60 5 "[INSTRUCCIÓN] Hits" 0 0 1\n  MARKER 61 12 "[INSTRUCCION] Pausa" 0 0 1\n  MARKER 1 `);
  globalThis.__reaperFixture.allowSessionUpdate=true;
  const apply=await PUT({request:new Request('https://fixture.invalid/api/admin-reaper-project',{method:'PUT',headers:{origin:'https://fixture.invalid','content-type':'application/json'},body:JSON.stringify({songId:'song-1',key:'live-director/reaper-projects/song-1/Mapa.RPP',markerIds:[1]})}),cookies:{get:()=>({value:'fixture-token'})}});
  const applied=await apply.json();assert.equal(apply.status,200,JSON.stringify(applied));
  const saved=globalThis.__reaperFixture.sessionUpdates.at(-1);
  assert.deepEqual(saved.sectionMarkers.map(marker=>marker.sectionName),['Intro 1'],'Instructions are never applied as sections');
  assert.deepEqual(saved.instructionMarkers,[{id:'reaper-cue-60',name:'Hits',startSec:5}],'Only instructions inside UNO–FIN AUDIO are applied');
  assert.deepEqual(applied.instructionMarkers,saved.instructionMarkers);
 }finally{console.error=oldError}
 console.log('REAPER upload: authentication, admin role, origin, song binding, draft review, RPP storage, no catalog writes and apply with separate instructions passed.');
}finally{delete globalThis.__reaperFixture;await rm(dir,{recursive:true,force:true})}
