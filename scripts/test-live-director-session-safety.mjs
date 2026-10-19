import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertSongOwnsStemUrls, isSongOwnedStemKey, isMissingStemError } from '../src/utils/liveDirectorSessionSafety.ts';
import { cleanExportedStemLabels, buildClassifiedStemFileName, readExportedStemCategory } from '../src/utils/stemCategories.ts';
const song='ac2e5fd9-eba8-4d47-b5e4-6b00e85454ab';
const other='be0aa6b3-6043-4810-ba16-6bfba8bc9dd5';
const url=id=>`https://stems.alabanzaredilestadio.com/secuencias/${id}-song/stems/click.m4a`;
assert.doesNotThrow(()=>assertSongOwnsStemUrls(song,[{url:url(song)}]));
assert.throws(()=>assertSongOwnsStemUrls(song,[{url:url(other)}]),{status:409});
assert.throws(()=>assertSongOwnsStemUrls(song,[{url:url(song),optimizedUrl:url(other)}]),{status:409});
assert.ok(isSongOwnedStemKey(`secuencias/${song}-song/stems/click.m4a`,song));
assert.equal(isSongOwnedStemKey(`secuencias/${other}-song/manifest.json`,song),false);
assert.equal(isSongOwnedStemKey(`secuencias/${song}0-song/manifest.json`,song),false);
assert.ok(isMissingStemError(new Error('Failed to fetch (404)')));
assert.ok(isMissingStemError(new Error('outer',{cause:new Error('Range fetch failed (410)')})));
assert.equal(isMissingStemError(new Error('Decoder configuration failed')),false);
const labels=cleanExportedStemLabels([
  {id:'custom-10-banjo-banjo',name:'10 Banjo Banjo',sourceFileName:'10-banjo--Banjo.m4a',url:url(other),volume:0.72},
  {id:'custom-11-violin-violin',name:'11 Violin Violin',sourceFileName:'11-violin--Violin.m4a'},
  {id:'custom-12-fx-fxx',name:'12 Fx Fxx',sourceFileName:'12-fx--FxX.m4a'},
  {id:'custom-13-banjo-banjo',name:'13 Banjo Banjo',sourceFileName:'13-banjo--Banjo.m4a'},
  {id:'custom-solo',name:'Solo principal',sourceFileName:'14-violin--Solo.m4a'},
]);
assert.deepEqual(labels.map(t=>t.name),['Banjo','Violín','FX','Banjo 2','Solo principal']);
assert.equal(labels[0].url,url(other));assert.equal(labels[0].id,'custom-10-banjo-banjo');assert.equal(labels[0].volume,0.72);
assert.equal(buildClassifiedStemFileName('Banjo.wav',9,'banjo'),'10-banjo.m4a');
assert.equal(buildClassifiedStemFileName('10-banjo--Banjo.m4a',9,'banjo'),'10-banjo.m4a');
assert.equal(readExportedStemCategory('10-banjo.m4a'),'banjo');
assert.equal(readExportedStemCategory('11-violin--Violin.m4a'),'violin');
const view=await readFile(new URL('../src/components/react/LiveDirectorView.tsx',import.meta.url),'utf8');
assert.match(view,/manualSession.songId !== songId/,'Autosave must reject the previous song state during navigation');
const api=await readFile(new URL('../src/pages/api/live-director-song-session.js',import.meta.url),'utf8');
assert.match(api,/assertSongOwnsStemUrls\(songId, tracks\)/);
assert.match(api,/isSongOwnedStemKey\(key, songId\)/);
console.log('PASS: session ownership, cross-song protection, missing-file detection and legacy label repair.');
