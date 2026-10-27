// Converts the user's Spanish guide WAVs to the library format in public/audio/guide-es:
// mono PCM16 24 kHz, edge silence trimmed, peak normalized to 0.75 (see README.md there).
// Usage: node scripts/prepare-guide-cues.mjs "<carpeta Guide Cues>" [--check]
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// About -60 dB at the edges, keeping 40 ms of natural decay like the existing voices.
const RATE = 24000, PEAK = 0.75, SILENCE = 0.001, TAIL = 0.04;
// Instruction voices: library key, label and the source file name in «Guide Cues».
export const GUIDE_INSTRUCTIONS = [
  ['build', 'Build', 'Spanish - Build (Sube Intensidad).wav'],
  ['break', 'Break', 'Spanish - Break (Pausa).wav'],
  ['hits', 'Hits', 'Spanish - Hits.wav'],
  ['drums-in', 'Drums In', 'Spanish - Drums In (Entra Bateria).wav'],
  ['all-in', 'All In', 'Spanish - All In (Toda La Banda).wav'],
  ['key-change-up', 'Key Change Up', 'Spanish - Key Change Up (Sube Tono).wav'],
  ['key-change-down', 'Key Change Down', 'Spanish - Key Change Down (Baja Tono).wav'],
  ['softly', 'Softly', 'Spanish - Softly (Suave).wav'],
  ['a-capella', 'A Capella', 'Spanish - A Capella.wav'],
  ['swell', 'Swell', 'Spanish - Swell.wav'],
  ['big-ending', 'Big Ending', 'Spanish - Big Ending (Final Grande).wav'],
  ['hold', 'Hold', 'Spanish - Hold (Sostener).wav'],
  ['last-time', 'Last Time', 'Spanish - Last Time (Ultima Vez).wav'],
  ['keys', 'Keys', 'Spanish - Keys (Teclado).wav'],
  ['bass', 'Bass', 'Spanish - Bass (Bajo).wav'],
  ['drums', 'Drums', 'Spanish - Drums (Bateria).wav'],
  ['guitar', 'Guitar', 'Spanish - Guitar (Guitara).wav'],
];

export function prepareGuideSample(path) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 64 << 20 });
  const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  if (!peak) throw new Error(`${path} está en silencio.`);
  let start = 0, end = samples.length;
  while (start < end && Math.abs(samples[start]) < peak * SILENCE) start++;
  while (end > start && Math.abs(samples[end - 1]) < peak * SILENCE) end--;
  const trimmed = samples.subarray(start, Math.min(samples.length, end + Math.round(TAIL * RATE)));
  const data = Buffer.alloc(trimmed.length * 2);
  trimmed.forEach((value, index) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value / peak * PEAK)) * 32767), index * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8); header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return { wav: Buffer.concat([header, data]), duration: Number((trimmed.length / RATE).toFixed(4)) };
}

if (process.argv[1]?.endsWith('prepare-guide-cues.mjs')) {
  const folder = process.argv[2];
  if (!folder) throw new Error('Indica la carpeta «Guide Cues».');
  const manifestPath = 'public/audio/guide-es/manifest.json';
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const [key, label, source] of GUIDE_INSTRUCTIONS) {
    const { wav, duration } = prepareGuideSample(join(folder, source));
    const existing = manifest.find(asset => asset.key === key);
    if (process.argv.includes('--check')) { console.log(`${key}\t${duration}\t${existing?.duration ?? '-'}`); continue; }
    // Existing voices (hold, last-time) keep their committed audio; only the type is added.
    if (!existing) {
      await writeFile(`public/audio/guide-es/${key}.wav`, wav);
      manifest.push({ key, label, url: `/audio/guide-es/${key}.wav`, duration, source });
    }
  }
  if (!process.argv.includes('--check')) {
    for (const asset of manifest) asset.kind = GUIDE_INSTRUCTIONS.some(([key]) => key === asset.key) ? 'instruction' : /^\d+$/.test(asset.key) ? 'count' : 'section';
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Manifest: ${manifest.length} voces.`);
  }
}
