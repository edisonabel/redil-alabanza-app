// Guide instructions (Sube intensidad, Hits…): spoken with the section-name lead and mix, never as sections.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildSync } from 'esbuild';

const bundle = buildSync({
  stdin: { contents: `export { DynamicGuidePlayer } from './src/services/DynamicGuidePlayer.ts';
export { nextGuideInstruction, guideVoiceLead } from './src/utils/liveDirectorGuideCues.ts';
export { normalizePersistedLiveDirectorSession, shouldRefreshLiveDirectorSession } from './src/utils/liveDirectorSongSession.ts';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'iife', globalName: 'Guide',
});
const scope = { performance, Promise, console };
vm.runInNewContext(bundle.outputFiles[0].text, scope);
const { DynamicGuidePlayer, nextGuideInstruction, guideVoiceLead, normalizePersistedLiveDirectorSession, shouldRefreshLiveDirectorSession } = scope.Guide;

// Minimal Web Audio stand-in: records where and when each voice starts.
const param = () => ({ value: 1, setValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
const node = () => ({ gain: param(), connect(target) { this.target = target; return target; }, disconnect() {} });
const started = [];
const context = {
  currentTime: 100,
  createGain: node, createChannelMerger: node,
  createBufferSource() {
    const source = { ...node(), playbackRate: param(), stopped: false,
      start(when) { this.when = when; started.push(this); }, stop() { this.stopped = true; } };
    return source;
  },
};
const ducks = [];
const graph = { context, destination: node(), readState: () => ({ gain: .8, route: 'left' }), setOverride() {},
  scheduleRecordedGuideDuck: (...args) => { ducks.push(args); return Promise.resolve(); }, clearRecordedGuideDuck() {} };
const player = new DynamicGuidePlayer(graph);
for (const [key, duration] of [['build', 1.2], ['hits', .6], ['coro-1', 1.2], ['intro', .6]]) {
  player.buffers.set(key, { duration }); player.available.add(key);
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

// Same anticipation as a section name with an equal voice length (lead = max(voice + .15, 4 beats)).
assert.equal(guideVoiceLead(1.2, 120), 2);
player.update({ id: 'jump', boundary: 10, name: 'Coro 1' }, 0, 120); await flush();
const sectionVoice = started.at(-1);
player.updateInstructions([{ id: 'c1', name: 'Sube intensidad', startSec: 10 }], 0, 120);
const instructionVoice = started.at(-1);
assert.notEqual(instructionVoice, sectionVoice);
assert.equal(instructionVoice.when, sectionVoice.when, 'Instruction uses the section-name lead');
assert.equal(instructionVoice.target, player.gain, 'Instruction goes through the same guide gain and route');
assert.equal(ducks.length, 1, 'Instructions do not open a recorded-guide duck window');

const count = started.length;
player.updateInstructions([{ id: 'c1', name: 'Sube intensidad', startSec: 10 }], .1, 120);
assert.equal(started.length, count, 'Each instruction is spoken once');
player.updateInstructions([{ id: 'far', name: 'Hits', startSec: 30 }], .1, 120);
assert.equal(started.length, count, 'Not scheduled more than 8 s ahead');

player.update({ id: 'other', boundary: 12, name: 'Intro' }, .2, 120); await flush();
assert.equal(instructionVoice.stopped, false, 'A section cue change never cancels an instruction');

player.updateInstructions([{ id: 'late', name: 'Hits', startSec: .9 }], .5, 120);
assert.ok(player.events.some(event => event.key === 'hits' && event.status === 'late'), 'Too-late instruction is skipped');
player.updateInstructions([{ id: 'unknown', name: 'Coreografía', startSec: 5 }], .5, 120);
assert.ok(player.events.some(event => event.key === 'Coreografía' && event.status === 'missing'));

player.pause();
assert.equal(instructionVoice.stopped, true, 'Pause silences scheduled instructions');
player.updateInstructions([{ id: 'c1', name: 'Sube intensidad', startSec: 10 }], 0, 120);
assert.equal(started.at(-1).when, context.currentTime + 8, 'After pause or seek the instruction can speak again');

assert.equal(player.speakNow('Hits'), true);
assert.ok(Math.abs(started.at(-1).when - (context.currentTime + .05)) < 1e-9 && started.at(-1).target === player.gain, 'Manual instruction speaks now');
assert.equal(player.speakNow('Nada'), false);

const cues = [{ id: 'a', name: 'Pausa', startSec: 20 }, { id: 'b', name: 'Hits', startSec: 40 }];
assert.equal(nextGuideInstruction(cues, 10).id, 'a');
assert.equal(nextGuideInstruction(cues, 25).id, 'b');
assert.equal(nextGuideInstruction(cues, 41), null);

// Persisted session keeps instructions apart from section markers.
const base = { songId: 's', updatedAt: 'u', tracks: [{ id: 'guide', name: 'Guide', url: 'https://fixture.invalid/g.m4a' }],
  sectionMarkers: [{ id: 'reaper-1', sectionName: 'Intro', startSec: 2 }] };
const session = normalizePersistedLiveDirectorSession({ ...base,
  instructionMarkers: [{ id: 'reaper-cue-9', name: 'Hits', startSec: 40 }, { id: 'reaper-cue-8', name: 'Pausa', startSec: 20 }, { name: '', startSec: 3 }] });
assert.deepEqual(JSON.parse(JSON.stringify(session.instructionMarkers)), [{ id: 'reaper-cue-8', name: 'Pausa', startSec: 20 }, { id: 'reaper-cue-9', name: 'Hits', startSec: 40 }]);
assert.equal(session.sectionMarkers.length, 1, 'Instructions never become section markers');
assert.equal(normalizePersistedLiveDirectorSession(base).instructionMarkers, undefined, 'Older sessions stay unchanged');
assert.equal(shouldRefreshLiveDirectorSession(normalizePersistedLiveDirectorSession(base), session), true, 'New instructions refresh the open session');
console.log('Guide instructions: section-name lead and mix, no duck, independent of section cues, pause/seek, manual cue and session persistence passed.');
