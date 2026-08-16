import { readFile, writeFile } from 'node:fs/promises';

const path = 'scripts/__patch-live-director-output-layout.mjs';
let source = await readFile(path, 'utf8');
const before = 'String(activeQueueSongId || songId || "").trim()}:${isManualTempoMode ? "tempo" : "stems"}';
const after = "String(activeQueueSongId || songId || '').trim()}:${isManualTempoMode ? 'tempo' : 'stems'}";
if (!source.includes(before)) {
  throw new Error('Expected transportIdentity patch anchor was not found in patcher.');
}
source = source.replaceAll(before, after);
await writeFile(path, source, 'utf8');
console.log('Temporary patch anchor corrected.');
