import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../public/workers/AudioProducerWorker.js', import.meta.url), 'utf8');
const context = { self: { postMessage() {}, location: { origin: 'http://127.0.0.1', href: 'http://127.0.0.1/workers/AudioProducerWorker.js' } },
  Float32Array, Float64Array, Int32Array, Uint8Array, SharedArrayBuffer, Atomics, AbortController, DOMException, URL, TextDecoder, TextEncoder, setTimeout, clearTimeout, performance, console };
vm.runInNewContext(source + '\nglobalThis.Pipeline = ProducerTrackPipeline;', context);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture() {
  const pipeline = Object.create(context.Pipeline.prototype), decoded = [];
  Object.assign(pipeline, { isDestroyed: false, lookAheadToken: 0, decoderConfig: {},
    waitForDecoderRecovery: async () => {}, waitForDecoderBackpressure: async () => {},
    ensureDecoder: async () => {}, isDecoderUsable: () => true,
    decodeSample: sample => { decoded.push(sample.timestampUs); return true; },
  });
  return { pipeline, decoded };
}
for (const suspension of ['header-decoder-configuration', 'ring-backpressure', 'decoder-recovery']) {
  const { pipeline, decoded } = fixture(), reached = deferred(), release = deferred();
  const suspend = async () => { reached.resolve(); await release.promise; };
  if (suspension === 'header-decoder-configuration') pipeline.ensureDecoder = suspend;
  if (suspension === 'ring-backpressure') pipeline.waitForDecoderBackpressure = suspend;
  if (suspension === 'decoder-recovery') pipeline.waitForDecoderRecovery = suspend;
  // This is the original untagged header-load call, not a caller with an explicit token.
  const oldHead = pipeline.feedDemuxedSamples({ decoderConfig: {}, samples: [{ timestampUs: 10112000 }] });
  const rejection = assert.rejects(oldHead, error => error.name === 'AbortError');
  await reached.promise;
  pipeline.stopLookAhead = context.Pipeline.prototype.stopLookAhead;
  pipeline.clearReadyWatchdog = () => {};
  pipeline.stopLookAhead(); // the ordinary seek invalidates the old load
  release.resolve(); await rejection;
  assert.deepEqual(decoded, [], `${suspension}: old head must never reach the new decoder`);
  Object.assign(pipeline, { waitForDecoderRecovery: async () => {}, waitForDecoderBackpressure: async () => {}, ensureDecoder: async () => {} });
  await pipeline.feedDemuxedSamples({ samples: [{ timestampUs: 177000000 }, { timestampUs: 177021333 }] });
  assert.deepEqual(decoded, [177000000, 177021333], 'The current seek generation must still decode normally');
}
console.log(JSON.stringify({ pass: true, staleHeaderCancelledAtDecoderConfiguration: true, staleHeaderCancelledAtBackpressure: true, staleHeaderCancelledAtRecovery: true, newGenerationDecodes: true }));
