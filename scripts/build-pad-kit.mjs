// Arma un kit de pads para Live Director a partir de 12 archivos (uno por tonalidad):
//   node scripts/build-pad-kit.mjs <carpeta> <id-del-kit> [salida]
// Cada pad queda como el conversor de stems (AAC-LC 256 kbps, 48 kHz, estéreo, faststart) y dura 90 s:
// se toma un tramo estable y sus últimos 8 s se funden (potencia constante) sobre los primeros, así el
// final empalma con el comienzo y el bucle no se nota. Todos quedan a -18 LUFS con pico ≤ -1 dBTP, para
// que cambiar de kit o de tonalidad no salte de volumen. También guarda la portada del MP3 (cover.jpg).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [source, kitId, outRoot = '.lab/pad-kits'] = process.argv.slice(2);
if (!source || !/^[a-z0-9-]+$/.test(kitId || '')) throw new Error('Uso: node scripts/build-pad-kit.mjs <carpeta> <id-del-kit> [salida]');
const START = 30, LOOP = 90, XFADE = 8, TARGET_LUFS = -18, CEILING_DBTP = -1;
// Nombres como Playback: bemoles para las negras.
const KEY_FILES = { C: 'C', 'C#': 'Db', Db: 'Db', D: 'D', 'D#': 'Eb', Eb: 'Eb', E: 'E', F: 'F', 'F#': 'Gb', Gb: 'Gb', G: 'G', 'G#': 'Ab', Ab: 'Ab', A: 'A', 'A#': 'Bb', Bb: 'Bb', B: 'B' };
const out = resolve(outRoot, kitId), work = resolve(out, '.work');
mkdirSync(work, { recursive: true });
const run = args => execFileSync('ffmpeg', ['-hide_banner', '-nostats', '-v', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const files = readdirSync(source).filter(name => /\.(mp3|wav|aiff?|m4a|flac)$/i.test(name));
const done = new Map();
for (const name of files) {
  const match = /^([A-G](?:#|b)?)(?=[\s._-]|$)/.exec(name);
  const key = match && KEY_FILES[match[1]];
  if (!key) { console.warn(`Sin tonalidad reconocible: ${name}`); continue; }
  if (done.has(key)) throw new Error(`Tonalidad repetida ${key}: ${done.get(key)} y ${name}`);
  const input = join(source, name), loop = join(work, `${key}.wav`);
  run(['-ss', String(START), '-t', String(LOOP + XFADE), '-i', input, '-vn', '-filter_complex', [
    'aresample=48000,aformat=channel_layouts=stereo,asplit=3[a][b][c]',
    `[a]atrim=0:${XFADE},asetpts=PTS-STARTPTS,afade=t=in:d=${XFADE}:curve=qsin[head]`,
    `[b]atrim=${LOOP}:${LOOP + XFADE},asetpts=PTS-STARTPTS,afade=t=out:d=${XFADE}:curve=qsin[tail]`,
    '[head][tail]amix=inputs=2:normalize=0[xf]',
    `[c]atrim=${XFADE}:${LOOP},asetpts=PTS-STARTPTS[body]`,
    '[xf][body]concat=n=2:v=0:a=1[loop]',
  ].join(';'), '-map', '[loop]', '-c:a', 'pcm_f32le', loop]);
  // ebur128 escribe su resumen en stderr.
  const log = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', loop, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' }).stderr || '';
  const summary = log.slice(log.lastIndexOf('Summary:'));
  const integrated = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]), peak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]);
  if (!Number.isFinite(integrated) || !Number.isFinite(peak)) throw new Error(`No se pudo medir ${name}`);
  const gain = Math.min(TARGET_LUFS - integrated, CEILING_DBTP - peak);
  run(['-i', loop, '-af', `volume=${gain.toFixed(2)}dB`, '-vn', '-map_metadata', '-1', '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '256k',
    '-ar', '48000', '-ac', '2', '-movflags', '+faststart', join(out, `${key}.m4a`)]);
  done.set(key, name);
  console.log(`${key}.m4a ← ${name} · ${integrated.toFixed(1)} LUFS, pico ${peak.toFixed(1)} → ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB`);
}
const first = files.find(name => /\.mp3$/i.test(name));
if (first) {
  try { run(['-i', join(source, first), '-an', '-vf', 'scale=512:512:flags=lanczos', '-q:v', '3', join(out, 'cover.jpg')]); } catch { console.warn('Sin portada en el MP3.'); }
}
rmSync(work, { recursive: true, force: true });
writeFileSync(join(out, 'keys.json'), JSON.stringify([...done.keys()].sort()));
const missing = Object.values(KEY_FILES).filter((key, index, all) => all.indexOf(key) === index && !done.has(key));
console.log(`${kitId}: ${done.size}/12 tonalidades${missing.length ? ` · faltan ${missing.join(', ')}` : ''}`);
