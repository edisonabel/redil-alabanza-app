import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { transform } from 'esbuild';

const directory = new URL('../public/audio-runtime/', import.meta.url);
const [vendor, worker] = await Promise.all([
  readFile(new URL('../public/vendor/mp4box.all.min.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/workers/AudioProducerWorker.js', import.meta.url), 'utf8'),
]);
// The vendor is the same checked-in MP4Box distribution used in development.
// Supply its CommonJS scope without exposing `module` to the producer itself.
const source = `(()=>{const module={exports:{}};const exports=module.exports;\n${vendor}\nself.MP4Box=module.exports;})();\n${worker}`;
const { code } = await transform(source, { minify: true, target: 'es2018', legalComments: 'none' });
const hash = createHash('sha256').update(code).digest('hex').slice(0, 16);
const file = `producer.${hash}.js`;
await mkdir(directory, { recursive: true });
for (const entry of await readdir(directory)) {
  if (/^producer\.[a-f0-9]+\.js$/.test(entry) && entry !== file) await rm(new URL(entry, directory));
}
await writeFile(new URL(file, directory), code);
await writeFile(new URL('manifest.json', directory), JSON.stringify({ producerUrl: `/audio-runtime/${file}` }));
console.log(`Audio producer runtime: ${file} (${code.length} bytes; MP4Box included).`);
