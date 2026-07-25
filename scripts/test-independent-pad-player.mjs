import assert from 'node:assert/strict';
import { IndependentPadPlayer } from '../src/services/IndependentPadPlayer.ts';

class FakeAudio {
  constructor(name) {
    this.name = name;
    this.src = '';
    this.currentTime = 0;
    this.loop = false;
    this.preload = 'none';
    this.volume = 1;
    this.paused = true;
    this.loadCount = 0;
    this.playCount = 0;
    this.attributes = new Map();
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === 'src') this.src = '';
  }

  load() {
    this.loadCount += 1;
  }

  pause() {
    this.paused = true;
  }

  async play() {
    this.playCount += 1;
    this.paused = false;
  }
}

class FakeClock {
  constructor() {
    this.time = 0;
    this.nextId = 1;
    this.frames = new Map();
    this.timers = new Map();
  }

  scheduler = {
    now: () => this.time,
    requestFrame: (callback) => {
      const id = this.nextId++;
      this.frames.set(id, callback);
      return id;
    },
    cancelFrame: (id) => {
      this.frames.delete(id);
    },
    setTimer: (callback, delayMs) => {
      const id = this.nextId++;
      this.timers.set(id, { callback, at: this.time + delayMs });
      return id;
    },
    clearTimer: (id) => {
      this.timers.delete(id);
    },
  };

  advance(durationMs) {
    const target = this.time + durationMs;
    while (this.time < target) {
      this.time = Math.min(target, this.time + 16);
      const frames = [...this.frames.values()];
      this.frames.clear();
      frames.forEach((callback) => callback(this.time));

      const dueTimers = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= this.time);
      dueTimers.forEach(([id, timer]) => {
        this.timers.delete(id);
        timer.callback();
      });
    }
  }
}

class FakeAudioParam {
  constructor() {
    this.value = 0;
  }

  cancelScheduledValues() {}

  setValueAtTime(value) {
    this.value = value;
  }

  linearRampToValueAtTime(value) {
    this.value = value;
  }
}

class FakeGainNode {
  constructor() {
    this.gain = new FakeAudioParam();
  }

  connect() {}
}

class FakeSourceNode {
  connect() {}
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.destination = {};
    this.state = 'suspended';
  }

  createMediaElementSource() {
    return new FakeSourceNode();
  }

  createGain() {
    return new FakeGainNode();
  }

  async resume() {
    this.state = 'running';
  }

  async close() {
    this.state = 'closed';
  }
}

const loadedChannels = (player) => player.snapshot().channels.filter((channel) => channel.url);
const audibleChannels = (player) => player.snapshot().channels.filter((channel) => channel.level > 0.0001);

const audioA = new FakeAudio('A');
const audioB = new FakeAudio('B');
const clock = new FakeClock();
const player = new IndependentPadPlayer({
  audioElements: [audioA, audioB],
  outputMode: 'direct',
  transitionMs: 5_000,
  scheduler: clock.scheduler,
});

assert.equal((await player.switchTo('https://pads.test/C.m4a', 0.6)).status, 'started');
assert.equal(loadedChannels(player).length, 1, 'initial activation loads one channel');
clock.advance(5_200);
assert.equal(audibleChannels(player).length, 1, 'initial fade settles on one audible channel');

assert.equal((await player.switchTo('https://pads.test/D.m4a', 0.6)).status, 'started');
assert.equal(loadedChannels(player).length, 2, 'crossfade uses exactly two channels');
clock.advance(2_500);
assert.ok(audibleChannels(player).length <= 2, 'crossfade never exceeds two audible channels');
clock.advance(2_700);
assert.equal(loadedChannels(player).length, 1, 'outgoing decoder is unloaded after the fade');
assert.equal(player.snapshot().activeUrl, 'https://pads.test/D.m4a');

const loadsBeforeReuse = audioA.loadCount + audioB.loadCount;
assert.equal((await player.switchTo('https://pads.test/D.m4a', 0.4)).status, 'reused');
clock.advance(300);
assert.equal(
  audioA.loadCount + audioB.loadCount,
  loadsBeforeReuse,
  'same pad URL is reused without another media load',
);

await player.switchTo('https://pads.test/E.m4a', 0.5);
await player.switchTo('https://pads.test/F.m4a', 0.5);
await player.switchTo('https://pads.test/G.m4a', 0.5);
assert.ok(loadedChannels(player).length <= 2, 'rapid changes still retain only two media elements');
clock.advance(5_300);
assert.equal(loadedChannels(player).length, 1, 'rapid changes settle on one loaded pad');
assert.equal(player.snapshot().activeUrl, 'https://pads.test/G.m4a', 'latest command wins');

player.stop(5_000);
clock.advance(5_300);
assert.equal(loadedChannels(player).length, 0, 'stop unloads both pad resources');
assert.equal(audioA.paused, true);
assert.equal(audioB.paused, true);
assert.equal(audioA.src, '');
assert.equal(audioB.src, '');

await player.switchTo('https://pads.test/A.m4a', 0.5);
player.dispose();
assert.equal(player.snapshot().disposed, true);
assert.equal(loadedChannels(player).length, 0, 'dispose cannot leave detached audio playing');
assert.equal(clock.frames.size, 0);
assert.equal(clock.timers.size, 0);

const gainAudioA = new FakeAudio('gain-A');
const gainAudioB = new FakeAudio('gain-B');
const gainClock = new FakeClock();
const gainPlayer = new IndependentPadPlayer({
  audioElements: [gainAudioA, gainAudioB],
  audioContextFactory: () => new FakeAudioContext(),
  outputMode: 'gain',
  transitionMs: 5_000,
  scheduler: gainClock.scheduler,
});

await gainPlayer.switchTo('https://pads.test/ios-A.m4a', 0.45);
gainClock.advance(5_300);
await gainPlayer.switchTo('https://pads.test/ios-B.m4a', 0.45);
assert.equal(loadedChannels(gainPlayer).length, 2, 'iOS gain path also uses only A/B');
gainClock.advance(5_300);
assert.equal(loadedChannels(gainPlayer).length, 1, 'iOS gain path unloads its outgoing decoder');
assert.equal(gainAudioA.volume, 1, 'iOS gain path does not depend on media-element volume');
assert.equal(gainAudioB.volume, 1, 'both iOS media elements stay at physical volume 1');
gainPlayer.dispose();

console.log('Independent pad player lifecycle tests passed.');
