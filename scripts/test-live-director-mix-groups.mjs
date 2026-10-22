import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const { build } = createRequire(import.meta.url)('esbuild');
const { outputFiles } = await build({ entryPoints: ['src/utils/liveDirectorMixGroups.ts'], bundle: true, write: false, platform: 'node', format: 'cjs' });
const scope = { module: { exports: {} }, exports: {} }; vm.runInNewContext(outputFiles[0].text, scope);
const { MIX_GROUPS, inferMixGroup } = scope.module.exports;
const cases = {
  keys: ['Piano 1', 'Piano 2', 'Electric Piano', 'Órgano', 'Órganos', 'Organ 2', 'Hammond', 'Keys', 'Keyboard 3', 'Teclados', 'Pads', 'Synth', 'Rhodes', 'Colchones'],
  acoustic: ['Acoustic Gtr', 'Acoustic Gtr 2', 'Guitarras acústicas', 'AG2', 'Gtr AC'],
  electric: ['Electric Gtr', 'Electric Gtr 2', 'Guitarras eléctricas', 'EG3', 'Lead Gtr'],
  bass: ['Bass', 'Bass 2', 'Bajos', 'Bajo eléctrico', 'Synth Bass', 'Bass Synth', 'Electric Bass', 'Acoustic Bass', 'Sub Bass', 'Contrabajo'],
  vocals: ['Background Vocals', 'Voces', 'Choir', 'Coros', 'BGV2', 'Vox'],
  rhythm: ['Drums', 'Baterías', 'Bass Drum', 'Percussion', 'Percusión', 'Platillos', 'Cymbals', 'Kick', 'Snare', 'Tom', 'Hi Hat', 'Overheads', 'Shaker', 'Claps', 'Cajón'],
  other: ['Extras FX', 'Full Mix', 'Violin', 'Trompeta', 'Stem desconocido'],
  cues: ['Click', 'Guide', 'Guía vocal', 'Vox Guide', 'Talkback', 'Cues', 'Metronome', 'BPM', 'Conteo', 'Countin'],
};
let count = 0;
for (const [group, names] of Object.entries(cases)) for (const name of names) {
  assert.equal(inferMixGroup({ id: 'custom', name }), group, name); count++;
}
assert.equal(inferMixGroup({ id: 'bass-2', name: 'Stem 02' }), 'bass');
assert.equal(inferMixGroup({ id: 'custom-17', name: 'Stem 17', sourceFileName: '03-cymbals.m4a' }), 'rhythm');
assert.equal(inferMixGroup({ id: 'custom-18', name: 'Stem 18', sourceFileName: '07-organ.m4a' }), 'keys');
assert.equal(MIX_GROUPS.filter(g => !['other', 'cues'].includes(g.id)).length, 6);
assert.equal(MIX_GROUPS.length, 8); assert.equal(new Set(MIX_GROUPS.map(g => g.id)).size, 8);
console.log(JSON.stringify({ pass: true, familyCases: count, musicalBuses: 6, maximumIncludingCuesAndOther: 8 }));
