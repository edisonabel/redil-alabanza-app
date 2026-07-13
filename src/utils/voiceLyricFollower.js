const WORD_EDGE_PATTERN = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

export const normalizeVoiceToken = (value = '') => (
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(WORD_EDGE_PATTERN, '')
    .replace(/[^a-z0-9ñ]+/g, '')
);

const stripChordProMarkup = (line = '') => String(line || '')
  .replace(/\[[^\]]+\]/g, '')
  .replace(/\{[^}]+\}/g, '');

export const extractVoiceWordsFromLine = (line = '') => (
  stripChordProMarkup(line)
    .trim()
    .split(/\s+/)
    .map((display) => ({
      display,
      normalized: normalizeVoiceToken(display),
    }))
    .filter((word) => word.normalized)
    .map((word, wordIndex) => ({
      ...word,
      wordIndex,
    }))
);

export const buildVoiceLyricIndex = (sections = []) => {
  const words = [];

  (Array.isArray(sections) ? sections : []).forEach((section, sectionIndex) => {
    (Array.isArray(section?.lines) ? section.lines : []).forEach((line, lineIndex) => {
      extractVoiceWordsFromLine(line).forEach((word) => {
        words.push({
          ...word,
          globalIndex: words.length,
          sectionIndex,
          lineIndex,
          sectionName: String(section?.name || ''),
        });
      });
    });
  });

  return words;
};

export const findVoiceAnchorIndex = (words = [], sectionIndex = 0, lineIndex = 0) => {
  const exact = words.find((word) => (
    word.sectionIndex === sectionIndex && word.lineIndex === lineIndex
  ));
  if (exact) return exact.globalIndex;

  const sectionStart = words.find((word) => word.sectionIndex === sectionIndex);
  if (sectionStart) return sectionStart.globalIndex;

  const nextLyricSection = words.find((word) => word.sectionIndex > sectionIndex);
  return nextLyricSection?.globalIndex ?? Math.max(0, words.length - 1);
};

export const getVoiceSectionGate = ({
  words = [],
  sectionIndex = 0,
  currentIndex = 0,
  leadWords = 3,
  maxForwardWords = 12,
  nearEndProgress = 0.68,
  hasConfirmedWord = true,
} = {}) => {
  const lyricSectionIndexes = [...new Set(words.map((word) => word.sectionIndex))]
    .sort((left, right) => left - right);
  const resolvedSectionIndex = lyricSectionIndexes.find((index) => index >= sectionIndex);
  if (!Number.isInteger(resolvedSectionIndex)) return null;

  const sectionWords = words.filter((word) => word.sectionIndex === resolvedSectionIndex);
  if (sectionWords.length === 0) return null;

  const sectionStartIndex = sectionWords[0].globalIndex;
  const sectionEndIndex = sectionWords[sectionWords.length - 1].globalIndex;
  const boundedCurrentIndex = Math.min(
    sectionEndIndex,
    Math.max(sectionStartIndex, Number(currentIndex) || sectionStartIndex),
  );
  const remainingWords = hasConfirmedWord
    ? Math.max(0, sectionEndIndex - boundedCurrentIndex)
    : sectionWords.length;
  const sectionWordCount = sectionWords.length;
  const sectionProgress = hasConfirmedWord
    ? Math.min(
      1,
      Math.max(0, ((boundedCurrentIndex - sectionStartIndex) + 1) / sectionWordCount),
    )
    : 0;
  const currentWord = hasConfirmedWord ? words[boundedCurrentIndex] : null;
  const lastLyricLineIndex = sectionWords[sectionWords.length - 1].lineIndex;
  const onLastLyricLine = currentWord?.lineIndex === lastLyricLineIndex;
  const nextSectionIndex = lyricSectionIndexes.find((index) => index > resolvedSectionIndex);
  const nextSectionWords = Number.isInteger(nextSectionIndex)
    ? words.filter((word) => word.sectionIndex === nextSectionIndex)
    : [];
  const nextSectionStartIndex = nextSectionWords[0]?.globalIndex ?? null;
  const nextSectionEndIndex = nextSectionWords[nextSectionWords.length - 1]?.globalIndex ?? null;
  const boundaryMinProgress = sectionWordCount <= 2 ? 0.5 : 0.55;
  const nextSectionUnlocked = (
    remainingWords <= leadWords &&
    sectionProgress >= boundaryMinProgress &&
    nextSectionWords.length > 0
  );
  const nextSectionPrepared = nextSectionWords.length > 0 && (
    nextSectionUnlocked ||
    (onLastLyricLine && sectionProgress >= nearEndProgress) ||
    sectionProgress >= 0.9
  );
  const allowedEndIndex = nextSectionPrepared
    ? nextSectionWords[nextSectionWords.length - 1].globalIndex
    : sectionEndIndex;

  return {
    sectionIndex: resolvedSectionIndex,
    sectionStartIndex,
    sectionEndIndex,
    sectionWordCount,
    sectionProgress,
    onLastLyricLine,
    remainingWords,
    nextSectionUnlocked,
    nextSectionPrepared,
    nextSectionIndex: Number.isInteger(nextSectionIndex) ? nextSectionIndex : null,
    nextSectionStartIndex,
    nextSectionEndIndex,
    allowedSectionIndex: nextSectionPrepared ? nextSectionIndex : resolvedSectionIndex,
    forwardWindow: Math.max(
      0,
      Math.min(maxForwardWords, allowedEndIndex - boundedCurrentIndex),
    ),
  };
};

export const buildVoiceContextPhrases = (words = [], startIndex = 0, limit = 90) => {
  const phrases = [];
  const seen = new Set();
  const candidates = words.slice(Math.max(0, startIndex - 4));

  const addPhrase = (value) => {
    const phrase = String(value || '').trim();
    const key = normalizeVoiceToken(phrase);
    if (!key || seen.has(key) || phrases.length >= limit) return;
    seen.add(key);
    phrases.push(phrase);
  };

  candidates.forEach((word, index) => {
    if (word.normalized.length >= 3) addPhrase(word.display);
    const next = candidates[index + 1];
    if (next && word.normalized.length >= 3 && next.normalized.length >= 3) {
      addPhrase(`${word.display} ${next.display}`);
    }
  });

  return phrases.slice(0, limit);
};

const editDistance = (left = '', right = '') => {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array(right.length + 1).fill(0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1] + (
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1
      );
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        substitution,
      );
    }
    for (let index = 0; index < current.length; index += 1) {
      previous[index] = current[index];
    }
  }

  return previous[right.length];
};

const wordSimilarity = (left = '', right = '') => {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (Math.min(left.length, right.length) >= 5 && (left.startsWith(right) || right.startsWith(left))) {
    return 0.86;
  }
  const distance = editDistance(left, right);
  return Math.max(0, 1 - (distance / Math.max(left.length, right.length, 1)));
};

const sequenceSimilarity = (spokenWords, lyricWords) => {
  const rows = spokenWords.length + 1;
  const columns = lyricWords.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array(columns).fill(0));
  const gapCost = 0.72;

  for (let row = 1; row < rows; row += 1) matrix[row][0] = row * gapCost;
  for (let column = 1; column < columns; column += 1) matrix[0][column] = column * gapCost;

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const recencyWeight = 0.78 + (0.22 * (row / spokenWords.length));
      const substitutionCost = (1 - wordSimilarity(
        spokenWords[row - 1],
        lyricWords[column - 1],
      )) * recencyWeight;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + gapCost,
        matrix[row][column - 1] + gapCost,
        matrix[row - 1][column - 1] + substitutionCost,
      );
    }
  }

  return Math.max(
    0,
    1 - (matrix[rows - 1][columns - 1] / Math.max(spokenWords.length, lyricWords.length, 1)),
  );
};

export const findBestVoiceLyricMatch = ({
  transcript = '',
  lyricWords = [],
  currentIndex = 0,
  backwardWindow = 2,
  forwardWindow = 64,
  singleWordMaxJump = 3,
  searchStartIndex = null,
  searchEndIndex = null,
  minimumScoreOverride = null,
} = {}) => {
  const spoken = String(transcript || '')
    .trim()
    .split(/\s+/)
    .map(normalizeVoiceToken)
    .filter(Boolean)
    .slice(-8);

  if (spoken.length === 0 || lyricWords.length === 0) return null;

  const searchStart = Number.isInteger(searchStartIndex)
    ? Math.max(0, Math.min(lyricWords.length - 1, searchStartIndex))
    : Math.max(0, currentIndex - backwardWindow);
  const searchEnd = Number.isInteger(searchEndIndex)
    ? Math.max(searchStart, Math.min(lyricWords.length - 1, searchEndIndex))
    : Math.min(lyricWords.length - 1, currentIndex + forwardWindow);
  let best = null;

  for (let candidateEnd = searchStart; candidateEnd <= searchEnd; candidateEnd += 1) {
    const minLength = Math.max(1, spoken.length - 2);
    const maxLength = Math.min(spoken.length + 2, candidateEnd + 1);

    for (let candidateLength = minLength; candidateLength <= maxLength; candidateLength += 1) {
      const candidateStart = candidateEnd - candidateLength + 1;
      if (candidateStart < searchStart) continue;
      const candidate = lyricWords
        .slice(candidateStart, candidateEnd + 1)
        .map((word) => word.normalized);
      let score = sequenceSimilarity(spoken, candidate);

      const distanceFromCurrent = candidateEnd - currentIndex;
      if (distanceFromCurrent >= 0 && distanceFromCurrent <= 5) score += 0.035;
      if (distanceFromCurrent > 20) score -= Math.min(0.12, distanceFromCurrent * 0.0025);

      if (!best || score > best.rawScore + Number.EPSILON) {
        best = {
          globalIndex: candidateEnd,
          score: Math.max(0, Math.min(1, score)),
          rawScore: score,
          spokenWordCount: spoken.length,
        };
      }
    }
  }

  if (!best) return null;
  const jump = best.globalIndex - currentIndex;
  const minimumScore = Number.isFinite(minimumScoreOverride)
    ? minimumScoreOverride
    : spoken.length === 1
      ? (jump <= singleWordMaxJump ? 0.97 : 1.01)
      : spoken.length === 2
        ? 0.72
        : jump > 8
          ? 0.78
          : 0.6;

  return best.score >= minimumScore ? best : null;
};

export const appendVoiceTransitionVote = ({
  votes = [],
  sectionIndex,
  supportsNext,
  transcript = '',
  ambiguous = false,
  now = Date.now(),
  ttlMs = 3200,
  limit = 3,
} = {}) => {
  const transcriptKey = String(transcript || '')
    .trim()
    .split(/\s+/)
    .map(normalizeVoiceToken)
    .filter(Boolean)
    .join(' ');
  const recentVotes = (Array.isArray(votes) ? votes : [])
    .filter((vote) => now - Number(vote?.timestamp || 0) <= ttlMs);
  const previousVote = recentVotes[recentVotes.length - 1];
  if (!transcriptKey) return recentVotes;
  if (previousVote?.transcriptKey === transcriptKey) {
    if (supportsNext && !previousVote.supportsNext) {
      return [
        ...recentVotes.slice(0, -1),
        {
          ...previousVote,
          sectionIndex,
          supportsNext: true,
          ambiguous: Boolean(ambiguous),
          timestamp: now,
        },
      ];
    }
    return recentVotes;
  }

  return [
    ...recentVotes,
    {
      sectionIndex,
      supportsNext: Boolean(supportsNext),
      ambiguous: Boolean(ambiguous),
      transcriptKey,
      timestamp: now,
    },
  ].slice(-Math.max(1, limit));
};

export const hasVoiceTransitionConsensus = ({
  votes = [],
  sectionIndex,
  requiredVotes = 2,
} = {}) => (
  (Array.isArray(votes) ? votes : [])
    .filter((vote) => vote?.sectionIndex === sectionIndex && vote?.supportsNext)
    .length >= requiredVotes
);

export const evaluateVoiceSectionTransition = ({
  gate,
  currentMatch,
  nextMatch,
  isFinal = false,
  flexMinScore = 0.74,
  flexMinMargin = 0.08,
  boundaryMinScore = 0.68,
  boundaryMinMargin = 0.04,
} = {}) => {
  if (!gate?.nextSectionPrepared || !nextMatch) {
    return {
      supportsNext: false,
      ambiguous: false,
      strongFinal: false,
      requiredVotes: 2,
      currentScore: currentMatch?.score ?? 0,
      nextScore: nextMatch?.score ?? 0,
      scoreMargin: 0,
    };
  }

  const currentScore = currentMatch?.score ?? 0;
  const nextScore = nextMatch.score ?? 0;
  const scoreMargin = nextScore - currentScore;
  const spokenWordCount = nextMatch.spokenWordCount ?? 0;
  const enoughWords = spokenWordCount >= 2 || (
    gate.nextSectionUnlocked && spokenWordCount === 1 && nextScore >= 0.97
  );
  const regularSupport = enoughWords && (
    gate.nextSectionUnlocked
      ? nextScore >= boundaryMinScore && scoreMargin >= boundaryMinMargin
      : nextScore >= flexMinScore && scoreMargin >= flexMinMargin
  );
  const ambiguous = Boolean(
    gate.nextSectionUnlocked &&
    spokenWordCount >= 2 &&
    nextScore >= 0.9 &&
    scoreMargin >= -0.02 &&
    scoreMargin < boundaryMinMargin
  );
  const supportsNext = regularSupport || ambiguous;
  const strongFinal = Boolean(
    isFinal &&
    regularSupport &&
    (
      gate.nextSectionUnlocked
        ? nextScore >= 0.86 && scoreMargin >= 0.08
        : gate.sectionProgress >= 0.78 &&
          spokenWordCount >= 3 &&
          nextScore >= 0.9 &&
          scoreMargin >= 0.12
    )
  );

  return {
    supportsNext,
    ambiguous,
    strongFinal,
    requiredVotes: strongFinal ? 1 : ambiguous ? 3 : 2,
    currentScore,
    nextScore,
    scoreMargin,
  };
};
