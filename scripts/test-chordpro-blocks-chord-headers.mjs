import assert from 'node:assert/strict';
import { parseChordProToBlocks } from '../src/utils/parseChordProToBlocks.ts';

const titles = (text) => parseChordProToBlocks(text).map((block) => block.fullTitle);
const lyrics = (text) => parseChordProToBlocks(text).flatMap((block) => block.lines.map((line) => line.lyrics));

// A chord at the start of a line is not the chorus marker "C".
const sheet = `[Coro 1]
[G]Bendito sea el nombre del Señor,
Se [Em]haga tu perfecta
[C]voluntad en mí.
[C]
[Verso 2]
[Em]Cómo he de creer`;
assert.deepEqual(titles(sheet), ['CORO 1', 'VERSO 2']);
assert.deepEqual(lyrics(sheet).slice(0, 3), ['Bendito sea el nombre del Señor,', 'Se haga tu perfecta', 'voluntad en mí.']);

// Real section headers keep working.
assert.deepEqual(titles('[V1]\nHola\n[C]\nAdiós'), ['V1']);
assert.deepEqual(titles('[Coro]\na\n[Chorus 2]\nb\n[Puente]\nc\n[Bridge]\nd\n[Final]\ne\n[Pr]\nf\n[Estribillo]\ng'),
  ['CORO', 'CHORUS 2', 'PUENTE', 'BRIDGE', 'FINAL', 'PR', 'ESTRIBILLO']);
assert.deepEqual(titles('{soc}\nSanto\n{eoc}\nCORO 2\nOtra'), ['CORO 1', 'CORO 2']);

console.log('chordpro blocks: chord headers ok');
