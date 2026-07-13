import assert from 'node:assert/strict';
import { alignSectionCandidateSequence } from '../src/utils/globalSectionAlignment.ts';
import { resolveSectionMarkersByIdentity } from '../src/utils/sectionMarkerIdentity.ts';

const candidate = (startSec, confidence = 0.9, evidenceCount = 2) => ({
  startSec,
  confidence,
  evidenceCount,
  exactStart: true,
});

const starts = (matches) => matches.map((match) => match?.startSec ?? null);

const repeatedChorus = alignSectionCandidateSequence({
  candidateSets: [
    [candidate(10)],
    [candidate(30), candidate(70)],
    [candidate(50)],
    [candidate(30), candidate(70)],
  ],
  expectedStarts: [8, 28, 50, 72],
  durationSec: 95,
});
assert.deepEqual(starts(repeatedChorus), [10, 30, 50, 70], 'debe distinguir dos coros identicos');

const consecutiveRepeatedChorus = alignSectionCandidateSequence({
  candidateSets: [
    [candidate(8)],
    [candidate(30), candidate(35, 0.94, 1), candidate(62)],
    [candidate(30), candidate(35, 0.94, 1), candidate(62)],
  ],
  expectedStarts: [8, 31, 60],
  durationSec: 88,
});
assert.deepEqual(
  starts(consecutiveRepeatedChorus),
  [8, 30, 62],
  'no debe confundir una frase interna repetida con una segunda seccion completa',
);

const impossibleMiddleSection = alignSectionCandidateSequence({
  candidateSets: [
    [candidate(10)],
    [candidate(30)],
    [candidate(20, 0.55, 1)],
    [candidate(52)],
  ],
  expectedStarts: [10, 28, 40, 54],
  durationSec: 72,
});
assert.deepEqual(
  starts(impossibleMiddleSection),
  [10, 30, null, 52],
  'debe dejar sin confirmar una seccion imposible en vez de desplazar el resto',
);

const sparseRecognition = alignSectionCandidateSequence({
  candidateSets: [[], [candidate(26)], [], [candidate(70)]],
  expectedStarts: [5, 25, 48, 70],
  durationSec: 90,
});
assert.deepEqual(starts(sparseRecognition), [null, 26, null, 70], 'debe conservar anclas confiables con huecos');

const identifiedMarkers = resolveSectionMarkersByIdentity(
  [{ name: 'Verso' }, { name: 'Coro' }, { name: 'Verso' }, { name: 'Coro' }],
  [
    { sectionName: 'Coro', sectionOccurrence: 2, startSec: 70 },
    { sectionName: 'Verso', sectionOccurrence: 1, startSec: 10 },
    { sectionName: 'Coro', sectionOccurrence: 1, startSec: 30 },
    { sectionName: 'Verso', sectionOccurrence: 2, startSec: 50 },
  ],
);
assert.deepEqual(
  identifiedMarkers.map((marker) => marker?.startSec ?? null),
  [10, 30, 50, 70],
  'debe resolver marcadores repetidos por identidad aunque lleguen desordenados',
);

console.log('Global section alignment tests passed.');
