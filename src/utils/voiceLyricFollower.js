const WORD_EDGE_PATTERN = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

export const normalizeVoiceToken = (value = '') => (
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(WORD_EDGE_PATTERN, '')
    .replace(/[^a-z0-9ñ]+/g, '')
);

const stripChordProChords = (line = '') => String(line || '').replace(/\[[^\]]+\]/g, '');

export const extractVoiceWordsFromLine = (line = '') => (
  stripChordProChords(line)
    .trim()
    .split(/\s+/)
    .map((display, wordIndex) => ({
      display,
      normalized: normalizeVoiceToken(display),
      wordIndex,
    }))
    .filter((word) => word.normalized)
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
  return sectionStart?.globalIndex ?? 0;
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
} = {}) => {
  const spoken = String(transcript || '')
    .trim()
    .split(/\s+/)
    .map(normalizeVoiceToken)
    .filter(Boolean)
    .slice(-8);

  if (spoken.length === 0 || lyricWords.length === 0) return null;

  const searchStart = Math.max(0, currentIndex - backwardWindow);
  const searchEnd = Math.min(lyricWords.length - 1, currentIndex + forwardWindow);
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

      if (!best || score > best.score) {
        best = {
          globalIndex: candidateEnd,
          score: Math.max(0, Math.min(1, score)),
          spokenWordCount: spoken.length,
        };
      }
    }
  }

  if (!best) return null;
  const jump = best.globalIndex - currentIndex;
  const minimumScore = spoken.length === 1
    ? (jump <= 3 ? 0.97 : 1.01)
    : spoken.length === 2
      ? 0.72
      : jump > 8
        ? 0.78
        : 0.6;

  return best.score >= minimumScore ? best : null;
};
