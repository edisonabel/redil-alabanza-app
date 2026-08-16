import { readFile, writeFile } from 'node:fs/promises';

const path = 'scripts/__patch-live-director-output-layout.mjs';
let source = await readFile(path, 'utf8');

const startNeedle = "\nview = replaceOnce(\n  view,\n`  const transportIdentity";
const endNeedle = "\n\nview = replaceOnce(\n  view,\n`      const showRouteFlip";
const start = source.indexOf(startNeedle);
const end = source.indexOf(endNeedle, start + 1);
if (start === -1 || end === -1) {
  throw new Error('Expected transportIdentity patch block was not found in patcher.');
}

const simplerPatch = `
view = replaceOnce(
  view,
\`    autoPadStartedForTransportRef.current = '';\n    stopEngineRef.current();\`,
\`    autoPadStartedForTransportRef.current = '';\n    setOutputLayout('guide-left');\n    stopEngineRef.current();\`,
  'default output layout per song',
);`;

source = source.slice(0, start) + '\n' + simplerPatch + source.slice(end);
await writeFile(path, source, 'utf8');
console.log('Temporary transportIdentity patch made robust.');
