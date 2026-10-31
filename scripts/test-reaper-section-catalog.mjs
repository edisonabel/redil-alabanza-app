// Section names offered by the REAPER helper must reach an existing dynamic guide voice.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildSync } from 'esbuild';
import { parseReaperProject, reviewReaperProject } from '../src/utils/reaperProjectParser.js';

const bundle = buildSync({
  stdin: { contents: `export * from './src/utils/guideSectionCatalog.ts';
export { resolveGuideCue } from './src/utils/liveDirectorGuideCues.ts';
export { normalizePersistedLiveDirectorSession, resolveLiveDirectorSessionSections } from './src/utils/liveDirectorSongSession.ts';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'iife', globalName: 'Guide',
});
const scope = {}; vm.runInNewContext(bundle.outputFiles[0].text, scope);
const { buildGuideSectionCatalog, renderReaperSectionCatalogLua, replaceReaperSectionCatalog, resolveGuideCue,
  normalizePersistedLiveDirectorSession, resolveLiveDirectorSessionSections } = scope.Guide;

const manifest = JSON.parse(await readFile('public/audio/guide-es/manifest.json', 'utf8'));
const keys = new Set(manifest.map(asset => asset.key));
// The bundle runs in its own realm; plain copies keep deepEqual about values only.
const catalog = JSON.parse(JSON.stringify(buildGuideSectionCatalog(manifest)));
const helper = await readFile('public/downloads/Alabanza-Asistente.lua', 'utf8');
assert.equal(replaceReaperSectionCatalog(helper, renderReaperSectionCatalogLua(catalog)), helper,
  'The helper list is stale: run npm run reaper:sections');

const sectionTypes = catalog.filter(type => type.kind === 'section'), instructionTypes = catalog.filter(type => type.kind === 'instruction');
// Every voice that is not a count-in digit is offered, directly or as a numbered appearance, in the group of its manifest kind.
for (const asset of manifest) {
  assert.ok(['section', 'instruction', 'count'].includes(asset.kind), `${asset.key} has no kind in the manifest`);
  if (asset.kind !== 'count') assert.equal(catalog.find(type => type.key === asset.key)?.kind ?? 'section', asset.kind, `${asset.key} is in the wrong group`);
}
for (const key of keys) {
  if (/^\d+$/.test(key)) continue;
  const type = catalog.find(row => row.key === key || (row.numbered && key.startsWith(`${row.key}-`) && /^\d+$/.test(key.slice(row.key.length + 1))));
  assert.ok(type, `Voice ${key} has no option in the REAPER menu`);
}
for (const type of catalog) {
  assert.equal(resolveGuideCue(type.label, keys), type.key);
  // Todos los coros dicen «Coro»; el resto usa su voz numerada. «Coro2» pegado es «Coro 2».
  for (let n = 1; keys.has(`${type.key}-${n}`); n++) {
    const expected = type.key === 'coro' ? 'coro' : `${type.key}-${n}`;
    assert.equal(resolveGuideCue(`${type.label} ${n}`, keys), expected);
    assert.equal(resolveGuideCue(`${type.label}${n}`, keys), expected);
  }
}

// Names produced by the real helper for every menu option (stubbed REAPER API).
const lua = ['lua', ['scripts/test-reaper-assistant.lua']];
let run = spawnSync(...lua, { encoding: 'utf8' });
if (run.error?.code === 'ENOENT') run = spawnSync('npm', ['exec', '--yes', '--package=fengari-node-cli', '--', 'fengari', ...lua[1]], { encoding: 'utf8' });
assert.equal(run.status, 0, `REAPER helper test failed:\n${run.stdout}\n${run.stderr}`);
const options = run.stdout.split('\n').filter(line => line.startsWith('OPTION\t')).map(line => {
  const [, key, names] = line.split('\t');
  return { key, names: names.split('|') };
});
assert.deepEqual(options.map(row => row.key), sectionTypes.map(row => row.key), 'The section dropdown offers exactly the generated sections');
const cueMarkers = run.stdout.split('\n').filter(line => line.startsWith('CUE\t')).map(line => line.split('\t'));
assert.deepEqual(cueMarkers.map(([, key]) => key), instructionTypes.map(row => row.key), 'The instruction dropdown offers exactly the generated instructions');
const created = [];
for (const { key, names } of options) {
  names.forEach((name, index) => {
    const numbered = `${key}-${index + 1}`;
    // Appearance N uses its own recorded voice when one exists (Coro 2), else the type voice.
    assert.equal(resolveGuideCue(name, keys), keys.has(numbered) && /\d$/.test(name) && key !== 'coro' ? numbered : key, `${name} → ${key}`);
    created.push(name);
  });
}
assert.equal(new Set(created.map(name => name.toLowerCase())).size, created.length, 'Automatic numbering never repeats a name');

// RPP round trip: helper names survive parsing, review and the Live Director section map.
const markers = created.map((name, index) => `  MARKER ${index + 1} ${10 + index * 4} "${name}" 0 0 1`);
const cueLines = cueMarkers.map(([, , name], index) => `  MARKER ${700 + index} ${220 + index * 3} "${name}" 0 0 1`);
const rpp = `<REAPER_PROJECT 0.1 "7.82" 0 0
  <NOTES 0 2
    |ALABANZA_MAPA_V1:song-1
  >
  TEMPO 72 4 4 0
  MARKER 900 2 "UNO" 0 0 1
${markers.join('\n')}
${cueLines.join('\n')}
  MARKER 901 400 "FIN AUDIO" 0 0 1
>`;
const project = parseReaperProject(rpp);
assert.deepEqual(project.markers.filter(marker => !/^(UNO|FIN AUDIO)$/.test(marker.name)).map(marker => marker.name), created,
  'Instruction markers never appear among sections');
assert.deepEqual(project.instructions.map(cue => cue.name), instructionTypes.map(type => type.label));
for (const [index, cue] of project.instructions.entries()) assert.equal(resolveGuideCue(cue.name, keys), instructionTypes[index].key, `${cue.name} reaches its voice`);
const review = reviewReaperProject(project, { id: 'song-1', section_markers: [], multitrack_session: { tracks: [{ id: 'guide' }] } });
for (const code of ['duplicate-name', 'duplicate-time', 'drafts', 'removed', 'order', 'instruction-outside']) {
  assert.ok(!review.issues.some(issue => issue.code === code), `Unexpected review issue ${code}`);
}
const session = normalizePersistedLiveDirectorSession({
  songId: 'song-1', updatedAt: 'now', tracks: [{ id: 'guide', name: 'Guide', url: 'https://fixture.invalid/guide.m4a' }],
  sectionMarkers: project.markers.filter(marker => !/^(UNO|FIN AUDIO)$/.test(marker.name))
    .map(marker => ({ id: `reaper-${marker.id}`, sectionName: marker.name, startSec: marker.timeSeconds })),
});
const sections = resolveLiveDirectorSessionSections(session, []);
assert.equal(sections.length, created.length);
for (const section of sections) assert.ok(resolveGuideCue(section.name, keys), `${section.name} reaches no voice in Live Director`);
// Tag está en el menú con su número (la voz en español de la biblioteca es «Repetir (Tag)») y Coro Final
// dice «Coro», sin aviso de voz en el asistente; «Final» sola sigue siendo el final.
assert.ok(sectionTypes.some(type => type.label === 'Tag' && type.key === 'repetir' && type.numbered), 'Tag en el menú de REAPER');
for (const [name, voice] of [['Tag', 'repetir'], ['Tag 1', 'repetir'], ['tag 2', 'repetir'], ['Tag2', 'repetir'], ['Coro Final', 'coro'], ['coro final', 'coro'], ['Verso Final', 'verso'], ['Final', 'ending']]) {
  assert.equal(resolveGuideCue(name, keys), voice, name);
}
assert.match(helper, /without_final/, 'El asistente reconoce «Coro Final»');
console.log(`REAPER menus: ${sectionTypes.length} sections (${created.length} numbered names) and ${instructionTypes.length} instructions, all resolve to guide voices through RPP and Live Director.`);
