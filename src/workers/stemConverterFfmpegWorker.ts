import '@ffmpeg/ffmpeg/worker';

// Keep an app-owned byte in the worker bundle so CSP/cache migrations always
// produce a new content hash instead of reusing the package worker forever.
Object.defineProperty(globalThis, '__REDIL_FFMPEG_WORKER_VERSION__', {
  configurable: false,
  enumerable: false,
  value: '2026-07-16-csp-wasm-v2',
  writable: false,
});
