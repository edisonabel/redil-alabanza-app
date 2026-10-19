import assert from 'node:assert/strict';
import { categorizeStemName, buildClassifiedStemFileName } from '../src/utils/stemCategories.ts';
import { sourceStemFromFile, buildSmartPlan, planGroupsToStems, getPlanOutputCount, rawSourcesToStems } from '../src/utils/stemConverterPlan.ts';
import { inferStemTracksFromFiles } from '../src/utils/liveDirectorSessionLoader.ts';
import { getSongGainDb, parseLoudness } from '../src/utils/stemSongLevel.ts';

for (const [name, category] of Object.entries({
  'Banjo.wav': 'banjo', 'Violín.wav': 'violin', 'Strings.wav': 'strings', 'Platillos.wav': 'cymbals',
  'Trompetas.wav': 'brass', 'Saxophone.wav': 'woodwinds', 'Organo.wav': 'organ',
  'Synth Bass.wav': 'synthBass', 'Electric Piano.wav': 'keys', 'Acoustic Guitar 2.wav': 'acoustic',
  'Guia vocal.wav': 'guide', 'Piano1.wav': 'piano', 'Coros.wav': 'choir', 'GE1.wav': 'electric', 'Guide.wav': 'guide', 'Click.wav': 'click', 'Cues.wav': 'cues',
})) assert.equal(categorizeStemName(name), category, name);
const names = ['Click.wav', 'Guide.wav', 'Cues.wav', 'EG1.wav', 'EG2.wav', 'Banjo.wav', 'Violin.wav',
  'Platillos.wav', 'Trompetas.wav', 'Pad.wav', 'Mystery.wav', 'Bass.wav', 'Piano.wav', 'Drums.wav', 'Organ.wav'];
const sources = names.map((name, i) => sourceStemFromFile(new File(['audio'], name), i));
const folderFile = new File(['audio'], 'Mystery.wav');
Object.defineProperty(folderFile, 'webkitRelativePath', {value: 'Click Song/Mystery.wav'});
assert.equal(sourceStemFromFile(folderFile, 0).category, 'unknown');
const plan = buildSmartPlan(sources);
assert.equal(getPlanOutputCount(plan), 15);
assert.ok(plan.every(group => group.action === 'keep'));
const merged = plan.map(group => group.category === 'electric' ? {...group, action: 'merge'} : group);
assert.equal(getPlanOutputCount(merged), 14);
assert.equal(planGroupsToStems(merged).find(stem => stem.sources.length > 1).sources.length, 2);
assert.equal(buildSmartPlan(sources, merged).find(g => g.category === 'electric').action, 'merge');
const changed = sources.map(source => source.category === 'unknown' ? {...source, category: 'banjo'} : source);
assert.equal(buildSmartPlan(changed, merged).find(g => g.category === 'electric').action, 'merge');
const moreGuitars = [...sources, sourceStemFromFile(new File(['audio'], 'EG3.wav'), 16)];
assert.equal(buildSmartPlan(moreGuitars, merged).find(g => g.category === 'electric').action, 'keep');
assert.throws(() => rawSourcesToStems(moreGuitars), /no se omitirá/);
const unsafe = { ...plan[0], category: 'electric', action: 'merge', sources: sources.slice(0, 2).map(s => ({...s, category: 'electric'})) };
assert.equal(planGroupsToStems([unsafe]).length, 2, 'Click and guide cannot merge even if mislabeled');
const classified = buildClassifiedStemFileName('Mystery.wav', 0, 'violin');
assert.equal(categorizeStemName(classified), 'violin');
const inferred = inferStemTracksFromFiles([new File(['audio'], classified), new File(['audio'], buildClassifiedStemFileName('Part2.wav', 1, 'violin'))]);
assert.deepEqual(inferred.matchedFiles.map(file => file.trackName), ['Violín', 'Violín 2']);
assert.equal(getSongGainDb({integrated: -24, peak: -10}), 6);
assert.equal(getSongGainDb({integrated: -10, peak: -1}), -8, 'Loud songs must attenuate');
assert.equal(getSongGainDb({integrated: -28, peak: -4}), 1, 'Peak headroom takes precedence');
assert.equal(getSongGainDb({integrated: -28, peak: -15}, -2), -1, 'Cancellation must not hide individual clipping');
assert.equal(getSongGainDb({integrated: -Infinity, peak: -Infinity}), 0);
assert.deepEqual(parseLoudness(['{"input_i":"-inf","input_tp":"-inf"}']), {integrated: -Infinity, peak: -Infinity});
assert.throws(() => parseLoudness(['failed']), /No se pudo medir/);
console.log('PASS: categories, default separation, explicit merges, file naming, 15 stems and song gain.');
