// Transporta las pistas con tono de una canción y las deja listas como los stems de siempre (AAC 256 kbps,
// 48 kHz, faststart). Una por vez: cada pista ocupa mucha memoria mientras se procesa.
import ffmpegCoreURL from '@ffmpeg/core?url';
import ffmpegCoreWasmURL from '@ffmpeg/core/wasm?url';
import ffmpegWorkerURL from '../workers/stemConverterFfmpegWorker?worker&url';
import { pitchShiftAudioBuffer } from './pitchShift/rubberbandEngine';
import { encodeAudioBufferToFloat32Wav } from './pitchShift/wavEncoder';

export type EventKeyProgress = { index: number; total: number; name: string; progress: number };
type Track = { id: string; name?: string; url: string };

// Si el navegador rechaza el convertidor, ffmpeg no avisa y se queda esperando para siempre.
const LOAD_TIMEOUT_MS = 120000;
function loadOrFail(loading: Promise<unknown>, signal?: AbortSignal) {
  let timer: ReturnType<typeof setTimeout> | undefined, onAbort: (() => void) | undefined;
  const failure = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('No se pudo iniciar el convertidor de audio. Recarga la página e inténtalo otra vez.')), LOAD_TIMEOUT_MS);
    onAbort = () => reject(signal?.reason ?? new DOMException('Cancelado', 'AbortError'));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  return Promise.race([loading, failure]).finally(() => { clearTimeout(timer); if (onAbort) signal?.removeEventListener('abort', onAbort); });
}

export async function transposeTracks(tracks: Track[], semitones: number, options: {
  signal?: AbortSignal; onProgress?: (progress: EventKeyProgress) => void;
  deliver: (track: Track, m4a: Uint8Array) => Promise<void>;
}) {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ffmpeg = new FFmpeg();
  try {
    await loadOrFail(ffmpeg.load({ classWorkerURL: ffmpegWorkerURL, coreURL: ffmpegCoreURL, wasmURL: ffmpegCoreWasmURL }), options.signal);
    const decoder = new OfflineAudioContext(2, 48000, 48000);
    for (let index = 0; index < tracks.length; index += 1) {
      const track = tracks[index], name = track.name || track.id, total = tracks.length;
      const report = (progress: number) => options.onProgress?.({ index, total, name, progress });
      options.signal?.throwIfAborted();
      report(0);
      const response = await fetch(track.url, { signal: options.signal });
      if (!response.ok) throw new Error(`No se pudo leer la pista «${name}» (${response.status}).`);
      const audio = await decoder.decodeAudioData(await response.arrayBuffer());
      const shifted = await pitchShiftAudioBuffer(audio, semitones, { material: 'melodic', signal: options.signal,
        onProgress: ({ phase, progress }) => report(phase === 'load' ? 0 : phase === 'study' ? progress * .3 : .3 + progress * .55) });
      await ffmpeg.writeFile('in.wav', encodeAudioBufferToFloat32Wav(shifted));
      report(.88);
      const code = await ffmpeg.exec(['-hide_banner', '-y', '-i', 'in.wav', '-vn', '-map_metadata', '-1', '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '256k',
        '-ar', '48000', '-ac', String(shifted.numberOfChannels === 1 ? 1 : 2), '-movflags', '+faststart', 'out.m4a']);
      if (code !== 0) throw new Error(`No se pudo codificar la pista «${name}».`);
      const output = await ffmpeg.readFile('out.m4a');
      if (typeof output === 'string') throw new Error(`No se pudo codificar la pista «${name}».`);
      report(.94);
      await options.deliver(track, output);
      await ffmpeg.deleteFile('in.wav'); await ffmpeg.deleteFile('out.m4a');
      report(1);
    }
  } finally { ffmpeg.terminate(); }
}
