// Measure the sum, then apply one static gain to every musical stem. No
// per-instrument compression or normalization: the source balance survives.
export const SONG_TARGET_LUFS = -18;
export const SONG_PEAK_DB = -3;
export const MAX_SONG_BOOST_DB = 12;
const MIX_FILES = ['song-level-a.wav', 'song-level-b.wav'];
export type LoudnessMeasurement = { integrated: number; peak: number };
type LevelFfmpeg = { exec: (args: string[]) => Promise<number>; deleteFile: (path: string) => Promise<unknown> };

export function parseLoudness(logs: string[]): LoudnessMeasurement {
  const text = logs.join('\n');
  const read = (key: string) => {
    const matches = [...text.matchAll(new RegExp(`"${key}"\\s*:\\s*"(-?inf|[-+0-9.]+)"`, 'g'))];
    const raw = matches.at(-1)?.[1];
    if (raw === '-inf') return -Infinity;
    const value = raw === undefined ? NaN : Number(raw);
    if (!Number.isFinite(value)) throw new Error('No se pudo medir el volumen. Vuelve a intentar la conversión.');
    return value;
  };
  return { integrated: read('input_i'), peak: read('input_tp') };
}

export function getSongGainDb(measurement: LoudnessMeasurement, highestStemPeak = -Infinity) {
  const peak = Math.max(measurement.peak, highestStemPeak);
  if (peak === -Infinity) return 0;
  // Short/silent passages can have no integrated reading. Still protect peaks.
  const desired = Number.isFinite(measurement.integrated) ? SONG_TARGET_LUFS - measurement.integrated : 0;
  return Math.min(MAX_SONG_BOOST_DB, desired, SONG_PEAK_DB - peak);
}

export class StemSongLevelAnalyzer {
  private ffmpeg: LevelFfmpeg;
  private logs: () => string[];
  private clearLogs: () => void;
  private mixIndex = -1;
  private highestPeak = -Infinity;
  private controls = new Map<string, number>();

  constructor(ffmpeg: LevelFfmpeg, logs: () => string[], clearLogs: () => void) {
    this.ffmpeg = ffmpeg;
    this.logs = logs;
    this.clearLogs = clearLogs;
  }

  async measure(path: string) {
    this.clearLogs();
    const code = await this.ffmpeg.exec(['-hide_banner', '-nostats', '-i', path, '-af',
      `loudnorm=I=${SONG_TARGET_LUFS}:TP=${SONG_PEAK_DB}:print_format=json`, '-f', 'null', '-']);
    if (code !== 0) throw new Error('Falló la medición de volumen. No se exportó una mezcla sin nivelar.');
    return parseLoudness(this.logs());
  }

  async add(id: string, path: string, isControl: boolean) {
    const measurement = await this.measure(path);
    if (isControl) {
      this.controls.set(id, Number.isFinite(measurement.peak)
        ? Math.min(MAX_SONG_BOOST_DB, SONG_PEAK_DB - measurement.peak) : 0);
      return;
    }
    this.highestPeak = Math.max(this.highestPeak, measurement.peak);
    const next = this.mixIndex === 0 ? 1 : 0;
    const args = this.mixIndex < 0
      ? ['-i', path, '-map', '0:a:0']
      : ['-i', MIX_FILES[this.mixIndex], '-i', path, '-filter_complex',
        '[0:a:0][1:a:0]amix=inputs=2:duration=longest:normalize=0[a]', '-map', '[a]'];
    // Float PCM prevents clipping while summing. Only two accumulators are
    // resident, regardless of the number of stems; no 15-file PCM cache.
    const code = await this.ffmpeg.exec(['-hide_banner', '-y', ...args,
      '-ac', '2', '-ar', '48000', '-c:a', 'pcm_f32le', MIX_FILES[next]]);
    if (code !== 0) throw new Error('No se pudo analizar la mezcla completa. Reduce el tamaño de los archivos y reintenta.');
    if (this.mixIndex >= 0) await this.ffmpeg.deleteFile(MIX_FILES[this.mixIndex]);
    this.mixIndex = next;
  }

  async finish() {
    const gain = this.mixIndex < 0 ? 0 : getSongGainDb(await this.measure(MIX_FILES[this.mixIndex]), this.highestPeak);
    return (id: string) => this.controls.get(id) ?? gain;
  }

  async cleanup() {
    for (const path of MIX_FILES) {
      try { await this.ffmpeg.deleteFile(path); } catch { /* File may not have been created. */ }
    }
  }
}
