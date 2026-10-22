import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url), { build } = require('esbuild');
const EVENT = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222', SONG = '33333333-3333-4333-8333-333333333333';
const state = { admin: false, role: 'talkback', assigned: true, member: true, authenticated: true, dbError: false, records: new Map(), writes: 0, markerRevision: 0, noMarkers: false };
const db = { from(table) {
  const filters = {}; const q = { select() { return q; }, eq(key, value) { filters[key] = value; return q; }, limit() { return q; }, maybeSingle() { return Promise.resolve(result()); }, then(yes, no) { return Promise.resolve(result()).then(yes, no); } };
  function result() {
    if (state.dbError) return { error: new Error('db unavailable') };
    if (table === 'perfiles') return { data: { is_admin: state.admin } };
    if (table === 'asignaciones') return { data: state.assigned && filters.evento_id === EVENT ? [{ roles: { codigo: state.role } }] : [] };
    if (table === 'playlists') return { data: { id: filters.evento_id } };
    if (table === 'playlist_canciones') return { data: state.member ? { id: 'item' } : null };
    if (table === 'canciones') return { data: { section_markers: state.noMarkers ? null : [{ id: 'intro', sectionName: 'Intro', startSec: state.markerRevision }, { id: 'coro', sectionName: 'Coro', startSec: 16 }], multitrack_session: { sectionOffsetSeconds: 0 } } };
    throw new Error('Unexpected table ' + table);
  }
  return q;
} };
const security = `export class ApiSecurityError extends Error { constructor(message,status=403){super(message);this.status=status;} } export const serviceRoleClient=globalThis.__accessDb; export async function requireAuthenticatedUser(){if(!globalThis.__accessState.authenticated)throw new ApiSecurityError('Unauthorized',401);return {id:'user'};} export function assertRequestBodySize(){} export function securityErrorResponse(e){return new Response(JSON.stringify({error:e.message}),{status:e.status||500});}`;
const s3 = `export class GetObjectCommand{constructor(input){this.input=input;this.kind='get'}} export class PutObjectCommand{constructor(input){this.input=input;this.kind='put'}} export class S3Client{async send(command){const s=globalThis.__accessState,i=command.input,key=i.Key;const old=s.records.get(key);if(command.kind==='get'){if(!old)throw Object.assign(new Error('missing'),{name:'NoSuchKey',$metadata:{httpStatusCode:404}});return {ETag:old.etag,Body:{transformToString:async()=>old.body}};}if((i.IfNoneMatch==='*'&&old)||(i.IfMatch&&i.IfMatch!==old?.etag))throw {$metadata:{httpStatusCode:412}};s.writes++;const etag='"revision-'+s.writes+'"';s.records.set(key,{body:i.Body,etag});return {ETag:etag}}}`;
async function endpoint(file) {
  const output = await build({ entryPoints: [file], bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{ name: 'isolated-boundaries', setup(b) {
    b.onResolve({ filter: /api-security\.js$|auth-cookies\.js$|supabase-user-client\.js$|supabase-env\.js$|^@aws-sdk\/client-s3$/ }, args => ({ path: args.path, namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path.includes('api-security') ? security : args.path.includes('auth-cookies') ? 'export const getServerAuthTokens=()=>({accessToken:"test"});' : args.path.includes('supabase-user-client') ? 'export const createSupabaseUserClient=()=>globalThis.__accessDb;' : args.path.includes('supabase-env') ? 'export const readEnv=()=>"test";' : s3 }));
  } }] });
  const module = { exports: {} }; const context = { module, exports: module.exports, require, Response, Request, URLSearchParams, URL, console: { error() {} }, __accessState: state, __accessDb: db };
  vm.runInNewContext(output.outputFiles[0].text, context); return module.exports;
}
const arrangement = await endpoint('src/pages/api/live-director-event-arrangement.ts'), mix = await endpoint('src/pages/api/live-director-event-mix.ts');
async function get(endpoint, event = EVENT, permission = false) {
  return endpoint.GET({ cookies: {}, url: new URL(`http://localhost/api?evento_id=${event}&cancion_id=${SONG}${permission ? '&permission=1' : ''}`) });
}
async function put(endpoint, payload) { return endpoint.PUT({ cookies: {}, url: new URL('http://localhost/api'), request: new Request('http://localhost/api', { method: 'PUT', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(payload) }) }); }
const mixPayload = { evento_id: EVENT, cancion_id: SONG, mix: { tracks: [{ id: 'drums', volume: .7, enabled: true }] } };
const saved = await (await get(arrangement)).json(); assert.equal(saved.canEdit, true);
const payload = { evento_id: EVENT, cancion_id: SONG, revision: '', arrangement: { version: 1, entries: [{ id: 'a', sectionId: 'coro' }, { id: 'b', sectionId: 'coro' }], sourceSignature: saved.sourceSignature } };
for (const role of ['bateria', 'lider_alabanza', 'gestor_secuencias', 'lider_vocal']) {
  state.role = role;
  assert.equal((await (await get(arrangement)).json()).canEdit, false, role);
  assert.equal((await (await get(mix, EVENT, true)).json()).canEdit, false, role);
  const before = state.writes; assert.equal((await put(arrangement, payload)).status, 403); assert.equal((await put(mix, mixPayload)).status, 403); assert.equal(state.writes, before);
}
state.role = 'talkback';
let response = await put(arrangement, payload); assert.equal(response.status, 200); const v1 = await response.json();
assert.equal((await put(arrangement, payload)).status, 409, 'Create cannot overwrite an existing version');
assert.equal((await put(arrangement, { ...payload, revision: v1.revision, arrangement: { ...payload.arrangement, entries: [{ id: 'x', sectionId: 'alien' }] } })).status, 400);
assert.equal((await put(arrangement, { ...payload, revision: v1.revision, arrangement: { ...payload.arrangement, entries: [] } })).status, 400);
state.markerRevision++; assert.equal((await put(arrangement, { ...payload, revision: v1.revision })).status, 409); state.markerRevision--;
response = await put(arrangement, { ...payload, revision: v1.revision, arrangement: { ...payload.arrangement, entries: null } }); assert.equal(response.status, 200);
const restored = await (await get(arrangement)).json(); assert.equal(restored.arrangement.entries, null);
assert.equal((await put(arrangement, { ...payload, revision: v1.revision })).status, 409, 'Stale edit cannot overwrite a newer saved revision');
assert.equal((await put(mix, mixPayload)).status, 200);
assert.equal((await (await get(arrangement)).json()).revision, restored.revision, 'Mix writes cannot overwrite section arrangements');
state.assigned = false; assert.equal((await put(arrangement, payload)).status, 403, 'Global director role does not grant event access');
assert.equal((await get(arrangement)).status, 403);
state.admin = true; assert.equal((await (await get(arrangement, OTHER)).json()).canEdit, true); assert.equal((await (await get(arrangement, OTHER)).json()).arrangement, null, 'Different event is isolated');
assert.equal((await put(arrangement, { ...payload, evento_id: OTHER })).status, 200, 'Administrator retains explicit event write access');
state.noMarkers = true; const noMarkers = await (await get(arrangement, OTHER)).json(); assert.equal(noMarkers.canEdit, false);
assert.equal((await put(arrangement, { ...payload, evento_id: OTHER })).status, 409); state.noMarkers = false;
state.member = false; assert.equal((await put(arrangement, { ...payload, evento_id: OTHER })).status, 404); state.member = true;
state.authenticated = false; assert.equal((await get(arrangement)).status, 401); state.authenticated = true;
state.dbError = true; assert.equal((await get(arrangement)).status, 503);
console.log(JSON.stringify({ pass: true, eventDirectorAndAdminOnly: true, assignedMusiciansReadOnly: true, roleOutsideEventDenied: true, forgedWritesDenied: true, conflictsRejected: true, originalSongUntouched: true, mixesAndArrangementsIsolated: true, mockStorageOnly: true }));
