import assert from 'node:assert/strict';
import {
  getVoicePayloadScore,
  pickPreferredVoicePayload,
} from '../src/utils/voicePayload.js';

const driveFolder = 'https://drive.google.com/drive/folders/legacy-folder?usp=sharing';
const legacyEntries = JSON.stringify([
  { label: 'Voz guía', url: 'https://drive.google.com/file/d/guide-id/view?usp=sharing' },
  { label: 'Tercera voz', url: 'https://drive.google.com/file/d/third-id/view?usp=sharing' },
]);

assert.ok(getVoicePayloadScore(legacyEntries) > getVoicePayloadScore(driveFolder));
assert.equal(pickPreferredVoicePayload(driveFolder, legacyEntries), legacyEntries);

const currentR2Entries = [
  'Voz guía | https://stems.alabanzaredilestadio.com/voices/guide.m4a',
  'Tercera voz | https://stems.alabanzaredilestadio.com/voices/third.m4a',
].join('\n');
assert.ok(getVoicePayloadScore(currentR2Entries) > getVoicePayloadScore(legacyEntries));
assert.equal(pickPreferredVoicePayload(currentR2Entries, legacyEntries), currentR2Entries);

const managedPayload = JSON.stringify({
  entries: [{ label: 'Voz guía', url: 'https://example.com/voice.mp3' }],
  legacyUrl: driveFolder,
});
assert.equal(pickPreferredVoicePayload(managedPayload, legacyEntries), managedPayload);

const nestedLegacyPayload = JSON.stringify({
  entries: [{ name: 'Quinta voz', href: 'https://example.com/fifth.m4a' }],
});
assert.equal(pickPreferredVoicePayload('', nestedLegacyPayload), nestedLegacyPayload);

assert.equal(pickPreferredVoicePayload('', '-', null), '');

console.log('voice payload preference tests passed');
