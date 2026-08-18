import assert from 'node:assert/strict';
import {
  getNextProPlayerRepeatMode,
  getProPlayerQueueAvailability,
  PRO_PLAYER_REPEAT_MODES,
  resolveProPlayerQueueIndex,
} from '../src/utils/proPlayerQueue.js';

assert.equal(resolveProPlayerQueueIndex({ currentIndex: 1, length: 4, direction: 'next' }), 2);
assert.equal(resolveProPlayerQueueIndex({ currentIndex: 1, length: 4, direction: 'previous' }), 0);
assert.equal(resolveProPlayerQueueIndex({ currentIndex: 3, length: 4, direction: 'next' }), null);
assert.equal(resolveProPlayerQueueIndex({ currentIndex: 0, length: 4, direction: 'previous' }), null);
assert.equal(resolveProPlayerQueueIndex({
  currentIndex: 3,
  length: 4,
  direction: 'next',
  repeatMode: PRO_PLAYER_REPEAT_MODES.ALL,
}), 0);
assert.equal(resolveProPlayerQueueIndex({
  currentIndex: 0,
  length: 4,
  direction: 'previous',
  repeatMode: PRO_PLAYER_REPEAT_MODES.ALL,
}), 3);

assert.equal(getNextProPlayerRepeatMode(PRO_PLAYER_REPEAT_MODES.OFF, true), PRO_PLAYER_REPEAT_MODES.ALL);
assert.equal(getNextProPlayerRepeatMode(PRO_PLAYER_REPEAT_MODES.ALL, true), PRO_PLAYER_REPEAT_MODES.ONE);
assert.equal(getNextProPlayerRepeatMode(PRO_PLAYER_REPEAT_MODES.ONE, true), PRO_PLAYER_REPEAT_MODES.OFF);
assert.equal(getNextProPlayerRepeatMode(PRO_PLAYER_REPEAT_MODES.OFF, false), PRO_PLAYER_REPEAT_MODES.ONE);
assert.equal(getNextProPlayerRepeatMode(PRO_PLAYER_REPEAT_MODES.ONE, false), PRO_PLAYER_REPEAT_MODES.OFF);

assert.deepEqual(getProPlayerQueueAvailability({ active: true, currentIndex: 0, length: 4 }), {
  hasPlaylist: true,
  canPrevious: false,
  canNext: true,
});
assert.deepEqual(getProPlayerQueueAvailability({
  active: true,
  currentIndex: 3,
  length: 4,
  repeatMode: PRO_PLAYER_REPEAT_MODES.ALL,
}), {
  hasPlaylist: true,
  canPrevious: true,
  canNext: true,
});

console.log('pro player queue: ok (anterior, siguiente, repetir lista y repetir una)');
