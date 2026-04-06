export type ChordProLineSegment = {
  chord: string;
  lyric: string;
};

export type ChordOnlyWordGroup = {
  type: 'chord-only';
  name: string;
};

export type ChordInlineDescriptor = {
  name: string;
  charOffset: number;
};

export type ChordLyricWordGroup = {
  type: 'word';
  word: string;
  start: number;
  end: number;
  chords: ChordInlineDescriptor[];
};

export type ChordWordGroup = ChordOnlyWordGroup | ChordLyricWordGroup;

export const parseChordProLine = (line = ''): ChordProLineSegment[] => {
  if (!line) return [];

  const segments: ChordProLineSegment[] = [];
  const regex = /\[([^\]]+)\]/g;
  let currentChord = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    const lyric = line.slice(lastIndex, match.index);
    if (lyric || currentChord) {
      segments.push({ chord: currentChord, lyric });
    }
    currentChord = match[1].trim();
    lastIndex = match.index + match[0].length;
  }

  const tail = line.slice(lastIndex);
  if (tail || currentChord) {
    segments.push({ chord: currentChord, lyric: tail });
  }

  return segments.length > 0 ? segments : [{ chord: '', lyric: line }];
};

export const buildWordGroups = (segments: ChordProLineSegment[] = []): ChordWordGroup[] => {
  const classified: Array<
    | { type: 'chord-only'; name: string }
    | { type: 'chord-lyric'; chord: string | null; lyric: string }
  > = [];

  segments.forEach((seg) => {
    const lyric = seg.lyric || '';
    const chord = seg.chord || '';
    if (!lyric.trim()) {
      if (chord) classified.push({ type: 'chord-only', name: chord });
    } else {
      classified.push({ type: 'chord-lyric', chord: chord || null, lyric });
    }
  });

  const result: ChordWordGroup[] = [];
  let i = 0;

  while (i < classified.length) {
    if (classified[i].type === 'chord-only') {
      result.push({ type: 'chord-only', name: classified[i].name });
      i += 1;
      continue;
    }

    let groupText = '';
    const groupChords: Array<{ name: string; pos: number }> = [];

    while (i < classified.length && classified[i].type === 'chord-lyric') {
      if (classified[i].chord) {
        groupChords.push({ name: classified[i].chord, pos: groupText.length });
      }
      groupText += classified[i].lyric;
      i += 1;
    }

    const words: ChordLyricWordGroup[] = [];
    const wordRegex = /\S+/g;
    let wordMatch: RegExpExecArray | null;

    while ((wordMatch = wordRegex.exec(groupText)) !== null) {
      words.push({
        type: 'word',
        word: wordMatch[0],
        start: wordMatch.index,
        end: wordMatch.index + wordMatch[0].length,
        chords: [],
      });
    }

    const insertBefore = new Map<number, string[]>();

    groupChords.forEach((chord) => {
      const inIdx = words.findIndex((word) => chord.pos >= word.start && chord.pos < word.end);
      if (inIdx >= 0) {
        words[inIdx].chords.push({
          name: chord.name,
          charOffset: chord.pos - words[inIdx].start,
        });
        return;
      }

      const nextIdx = words.findIndex((word) => word.start > chord.pos);
      const key = nextIdx >= 0 ? nextIdx : words.length;
      if (!insertBefore.has(key)) insertBefore.set(key, []);
      insertBefore.get(key)?.push(chord.name);
    });

    words.forEach((word, idx) => {
      (insertBefore.get(idx) || []).forEach((name) => result.push({ type: 'chord-only', name }));
      result.push(word);
    });

    (insertBefore.get(words.length) || []).forEach((name) =>
      result.push({ type: 'chord-only', name }),
    );
  }

  return result;
};
