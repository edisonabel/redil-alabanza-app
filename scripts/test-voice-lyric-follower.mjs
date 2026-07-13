import {
  appendVoiceTransitionVote,
  buildVoiceLyricIndex,
  evaluateVoiceSectionTransition,
  extractVoiceWordsFromLine,
  findBestVoiceLyricMatch,
  findVoiceAnchorIndex,
  getVoiceSectionGate,
  hasVoiceTransitionConsensus,
} from '../src/utils/voiceLyricFollower.js';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const repeatedWords = buildVoiceLyricIndex([
  { name: 'Coro', lines: ['santo santo santo santo santo santo santo santo'] },
]);
const repeatedMatch = findBestVoiceLyricMatch({
  transcript: 'santo santo',
  lyricWords: repeatedWords,
  currentIndex: 0,
});
assert(
  repeatedMatch?.globalIndex === 1,
  `Una repetición cercana saltó al índice ${repeatedMatch?.globalIndex}.`,
);

const cumulativeWords = buildVoiceLyricIndex([
  { name: 'Verso', lines: ['uno dos tres cuatro cinco seis siete ocho nueve'] },
]);
const cumulativeMatch = findBestVoiceLyricMatch({
  transcript: 'uno dos tres cuatro cinco',
  lyricWords: cumulativeWords,
  currentIndex: 4,
  searchStartIndex: 0,
  searchEndIndex: 8,
});
assert(cumulativeMatch?.globalIndex === 4, 'Se perdió una transcripción acumulativa.');

const shortSong = buildVoiceLyricIndex([
  { name: 'Puente', lines: ['uno dos tres'] },
  { name: 'Coro', lines: ['cuatro cinco seis'] },
]);
const shortInitialGate = getVoiceSectionGate({
  words: shortSong,
  sectionIndex: 0,
  currentIndex: 0,
  hasConfirmedWord: false,
});
assert(!shortInitialGate?.nextSectionPrepared, 'Una sección corta se preparó sin escucharla.');
const shortFirstWordGate = getVoiceSectionGate({
  words: shortSong,
  sectionIndex: 0,
  currentIndex: 0,
  hasConfirmedWord: true,
});
assert(!shortFirstWordGate?.nextSectionUnlocked, 'Una sección corta se abrió demasiado pronto.');
const shortPenultimateGate = getVoiceSectionGate({
  words: shortSong,
  sectionIndex: 0,
  currentIndex: 1,
  hasConfirmedWord: true,
});
assert(shortPenultimateGate?.nextSectionUnlocked, 'La penúltima palabra no abrió la transición.');

const recoverySong = buildVoiceLyricIndex([
  {
    name: 'Verso largo',
    lines: [
      'uno dos tres cuatro cinco seis siete ocho nueve diez once doce',
      'trece catorce quince dieciséis diecisiete dieciocho diecinueve veinte',
    ],
  },
  {
    name: 'Coro',
    lines: ['inicio claro del coro uno dos tres cuatro frase profunda incorrecta'],
  },
]);
const recoveryGate = getVoiceSectionGate({
  words: recoverySong,
  sectionIndex: 0,
  currentIndex: 15,
  hasConfirmedWord: true,
});
assert(recoveryGate?.nextSectionPrepared, 'La última línea no preparó la recuperación.');
assert(!recoveryGate?.nextSectionUnlocked, 'La recuperación flexible autorizó el cruce demasiado pronto.');
const deepNextMatch = findBestVoiceLyricMatch({
  transcript: 'frase profunda incorrecta',
  lyricWords: recoverySong,
  currentIndex: 15,
  searchStartIndex: recoveryGate.nextSectionStartIndex,
  searchEndIndex: recoveryGate.nextSectionStartIndex + 7,
  minimumScoreOverride: 0.58,
});
assert(!deepNextMatch, 'Una frase profunda de la siguiente sección entró en el haz de transición.');

const flexibleDecision = evaluateVoiceSectionTransition({
  gate: recoveryGate,
  currentMatch: { score: 0.61, spokenWordCount: 3 },
  nextMatch: { score: 0.91, spokenWordCount: 3 },
  isFinal: true,
});
assert(flexibleDecision.supportsNext, 'Una entrada fuerte del siguiente coro no activó recuperación.');
assert(flexibleDecision.strongFinal, 'Una transcripción final fuerte no confirmó la recuperación.');
assert(flexibleDecision.requiredVotes === 1, 'La evidencia final fuerte pidió votos adicionales.');

const ambiguousBoundaryDecision = evaluateVoiceSectionTransition({
  gate: { ...shortPenultimateGate, nextSectionPrepared: true, nextSectionUnlocked: true },
  currentMatch: { score: 0.96, spokenWordCount: 3 },
  nextMatch: { score: 0.95, spokenWordCount: 3 },
});
assert(ambiguousBoundaryDecision.ambiguous, 'Un límite repetido no se clasificó como ambiguo.');
assert(ambiguousBoundaryDecision.requiredVotes === 3, 'Un límite ambiguo no exigió tres votos.');

const unsafeFlexibleDecision = evaluateVoiceSectionTransition({
  gate: recoveryGate,
  currentMatch: { score: 0.84, spokenWordCount: 3 },
  nextMatch: { score: 0.88, spokenWordCount: 3 },
});
assert(!unsafeFlexibleDecision.supportsNext, 'Una ventaja insuficiente autorizó un salto flexible.');

const chordPro = extractVoiceWordsFromLine('[G]Oh — re[D/F#]suena {comment: suave}');
assert(
  chordPro.map((word) => word.normalized).join(' ') === 'oh resuena',
  'Un acorde, directiva o signo aislado entró como letra.',
);
assert(
  chordPro.map((word) => word.wordIndex).join(',') === '0,1',
  'Los índices visuales de ChordPro dejaron de ser contiguos.',
);

const sectionsWithInstrumental = buildVoiceLyricIndex([
  { name: 'Intro', lines: ['[G] [D]'] },
  { name: 'Verso', lines: ['aquí empieza toda la letra del verso final'] },
  { name: 'Interludio', lines: ['[Am] [C]'] },
  { name: 'Coro', lines: ['nuevo canto para siempre amén'] },
  { name: 'Coro repetido', lines: ['nuevo canto para siempre amén'] },
]);
const introAnchor = findVoiceAnchorIndex(sectionsWithInstrumental, 0, 0);
const introGate = getVoiceSectionGate({
  words: sectionsWithInstrumental,
  sectionIndex: 0,
  currentIndex: introAnchor,
  hasConfirmedWord: false,
});
assert(introGate?.sectionIndex === 1, 'La introducción instrumental bloqueó el verso.');
const verseEnd = sectionsWithInstrumental
  .filter((word) => word.sectionIndex === 1)
  .at(-1).globalIndex;
const verseGate = getVoiceSectionGate({
  words: sectionsWithInstrumental,
  sectionIndex: 1,
  currentIndex: verseEnd - 1,
  hasConfirmedWord: true,
});
assert(verseGate?.nextSectionIndex === 3, 'El interludio bloqueó la ruta lírica.');
assert(
  verseGate?.nextSectionStartIndex === verseEnd + 1,
  'La siguiente sección lírica comienza en un índice incorrecto.',
);

let votes = [];
votes = appendVoiceTransitionVote({
  votes,
  sectionIndex: 3,
  supportsNext: true,
  transcript: 'nuevo canto',
  now: 1000,
});
votes = appendVoiceTransitionVote({
  votes,
  sectionIndex: 3,
  supportsNext: true,
  transcript: 'nuevo canto',
  now: 1200,
});
assert(votes.length === 1, 'Un parcial duplicado contó como un voto nuevo.');
votes = appendVoiceTransitionVote({
  votes,
  sectionIndex: 3,
  supportsNext: false,
  transcript: 'nuevo canto para',
  now: 1400,
});
votes = appendVoiceTransitionVote({
  votes,
  sectionIndex: 3,
  supportsNext: true,
  transcript: 'nuevo canto para siempre',
  now: 1600,
});
assert(
  hasVoiceTransitionConsensus({ votes, sectionIndex: 3, requiredVotes: 2 }),
  'Dos de tres observaciones no lograron confirmar la transición.',
);
const expiredVotes = appendVoiceTransitionVote({
  votes,
  sectionIndex: 3,
  supportsNext: true,
  transcript: 'amén',
  now: 6000,
  ttlMs: 3200,
});
assert(expiredVotes.length === 1, 'Los votos antiguos no caducaron.');

console.log('voice follower adversarial suite: ok');
