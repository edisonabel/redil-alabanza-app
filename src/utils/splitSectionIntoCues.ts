import type { DisplayCue, DisplaySection, DisplayTrack } from '../types/confidenceMonitor';
import { parseChordProLine } from './chordProLineUtils';
import { buildSectionShortLabel, getSectionKind, SECTION_VISUALS } from './sectionVisuals';

const MAX_LINES_PER_CUE = 4;
const PREFERRED_LINES = 3;

const trimEdgeBlankLines = (lines: string[] = []) => {
  let start = 0;
  let end = lines.length;

  while (start < end && !String(lines[start] || '').trim()) {
    start += 1;
  }

  while (end > start && !String(lines[end - 1] || '').trim()) {
    end -= 1;
  }

  return lines.slice(start, end);
};

function isChordOnly(line: string) {
  const withoutChords = line.replace(/\[([^\]]+)\]/g, '').trim();
  return withoutChords.length === 0;
}

function stripChordMarkup(line: string) {
  return String(line || '')
    .replace(/\[([^\]]+)\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function countChordTokens(line: string) {
  return Array.from(String(line || '').matchAll(/\[([^\]]+)\]/g)).length;
}

function estimateCueWeight(lines: string[] = []) {
  const contentWeight = lines.reduce((sum, line) => {
    const lyric = stripChordMarkup(line);
    const wordCount = lyric ? lyric.split(/\s+/).filter(Boolean).length : 0;
    const compactCharCount = lyric.replace(/\s+/g, '').length;
    const chordCount = countChordTokens(line);
    const punctuationCount = (lyric.match(/[,:;.!?]/g) || []).length;
    const lineBase = lyric ? 1.4 : chordCount > 0 ? 0.8 : 0.35;

    return (
      sum +
      lineBase +
      wordCount * 0.9 +
      compactCharCount * 0.028 +
      chordCount * 0.18 +
      punctuationCount * 0.08
    );
  }, 0);

  return Math.max(contentWeight + Math.max(0, lines.length - 1) * 0.2, 0.75);
}

function buildCueTimingWindows(
  rawCueGroups: string[][],
  marker?: { startSec: number; endSec: number } | null,
) {
  const hasTiming =
    marker &&
    Number.isFinite(marker.startSec) &&
    Number.isFinite(marker.endSec) &&
    marker.endSec >= marker.startSec;

  if (!hasTiming) {
    return rawCueGroups.map(() => ({ startSec: null, endSec: null }));
  }

  const totalDuration = marker.endSec - marker.startSec;
  if (totalDuration <= 0 || rawCueGroups.length === 0) {
    return rawCueGroups.map(() => ({ startSec: marker.startSec, endSec: marker.endSec }));
  }

  const cueWeights = rawCueGroups.map((group) => estimateCueWeight(group));
  const totalWeight = cueWeights.reduce((sum, weight) => sum + weight, 0);

  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    const equalDuration = totalDuration / rawCueGroups.length;
    return rawCueGroups.map((_, index) => ({
      startSec: marker.startSec + equalDuration * index,
      endSec:
        index === rawCueGroups.length - 1
          ? marker.endSec
          : marker.startSec + equalDuration * (index + 1),
    }));
  }

  let cursor = marker.startSec;
  return rawCueGroups.map((_, index) => {
    const startSec = cursor;
    const sliceDuration =
      index === rawCueGroups.length - 1
        ? marker.endSec - cursor
        : totalDuration * (cueWeights[index] / totalWeight);
    const endSec = index === rawCueGroups.length - 1 ? marker.endSec : cursor + sliceDuration;
    cursor = endSec;
    return { startSec, endSec };
  });
}

function chunkLines(lines: string[]) {
  const count = lines.length;
  if (count <= MAX_LINES_PER_CUE) return [lines];

  const chunks: string[][] = [];
  let pos = 0;

  while (pos < count) {
    const remaining = count - pos;
    if (remaining <= MAX_LINES_PER_CUE) {
      chunks.push(lines.slice(pos));
      break;
    }

    if (remaining === MAX_LINES_PER_CUE + 1) {
      const half = Math.ceil(remaining / 2);
      chunks.push(lines.slice(pos, pos + half));
      pos += half;
      continue;
    }

    chunks.push(lines.slice(pos, pos + PREFERRED_LINES));
    pos += PREFERRED_LINES;
  }

  return chunks;
}

export function splitSectionIntoCues(
  songId: string,
  sectionIndex: number,
  section: { name: string; note?: string; lines: string[] },
  marker?: { startSec: number; endSec: number } | null,
  occurrence = 1,
): DisplayCue[] {
  const kind = getSectionKind(section.name);
  const visual = SECTION_VISUALS[kind] || SECTION_VISUALS.default;
  const shortLabel = buildSectionShortLabel(section.name, kind, occurrence);
  const contentLines = trimEdgeBlankLines(Array.isArray(section?.lines) ? section.lines : []);

  if (contentLines.length === 0) {
    return [
      {
        id: `${songId}-s${sectionIndex}-c0`,
        type: 'empty',
        sectionIndex,
        sectionKind: kind,
        sectionLabel: section.name,
        sectionShortLabel: shortLabel,
        sectionColor: [...visual.rgb] as [number, number, number],
        cueIndex: 0,
        totalCuesInSection: 1,
        lines: [],
        rawLines: [],
        estimatedStartSec: marker?.startSec ?? null,
        estimatedEndSec: marker?.endSec ?? null,
      },
    ];
  }

  const nonEmptyLines = contentLines.filter((line) => String(line || '').trim() !== '');
  if (nonEmptyLines.length > 0 && nonEmptyLines.every((line) => isChordOnly(line))) {
    return [
      {
        id: `${songId}-s${sectionIndex}-c0`,
        type: 'instrumental',
        sectionIndex,
        sectionKind: kind,
        sectionLabel: section.name,
        sectionShortLabel: shortLabel,
        sectionColor: [...visual.rgb] as [number, number, number],
        cueIndex: 0,
        totalCuesInSection: 1,
        lines: nonEmptyLines.map(parseChordProLine),
        rawLines: nonEmptyLines,
        estimatedStartSec: marker?.startSec ?? null,
        estimatedEndSec: marker?.endSec ?? null,
      },
    ];
  }

  const phraseGroups: string[][] = [];
  let currentGroup: string[] = [];

  for (const line of contentLines) {
    if (!String(line || '').trim()) {
      if (currentGroup.length > 0) {
        phraseGroups.push(currentGroup);
        currentGroup = [];
      }
      continue;
    }

    currentGroup.push(line);
  }

  if (currentGroup.length > 0) {
    phraseGroups.push(currentGroup);
  }

  const totalNonEmpty = phraseGroups.flat().length;
  const keepIntact =
    ((kind === 'chorus' || kind === 'prechorus' || kind === 'bridge' || kind === 'refrain') &&
      totalNonEmpty <= MAX_LINES_PER_CUE) ||
    ((kind === 'outro' || kind === 'intro') && totalNonEmpty <= MAX_LINES_PER_CUE);

  let rawCueGroups: string[][];

  if (keepIntact) {
    rawCueGroups = [phraseGroups.flat()];
  } else if (phraseGroups.length > 1) {
    rawCueGroups = phraseGroups.flatMap((group) =>
      group.length <= MAX_LINES_PER_CUE ? [group] : chunkLines(group),
    );
  } else {
    rawCueGroups = chunkLines(phraseGroups[0] || nonEmptyLines);
  }

  const cueTimings = buildCueTimingWindows(rawCueGroups, marker);

  return rawCueGroups.map((group, cueIndex) => ({
    id: `${songId}-s${sectionIndex}-c${cueIndex}`,
    type: 'lyrics' as const,
    sectionIndex,
    sectionKind: kind,
    sectionLabel: section.name,
    sectionShortLabel: shortLabel,
    sectionColor: [...visual.rgb] as [number, number, number],
    cueIndex,
    totalCuesInSection: rawCueGroups.length,
    lines: group.map(parseChordProLine),
    rawLines: group,
    estimatedStartSec: cueTimings[cueIndex]?.startSec ?? null,
    estimatedEndSec: cueTimings[cueIndex]?.endSec ?? null,
  }));
}

export function buildDisplayTrack(song: {
  id: string;
  title: string;
  artist: string;
  key: string;
  bpm?: number;
  sections: Array<{ name: string; note?: string; lines: string[] }>;
  sectionMarkers?: Array<{ startSec?: number; endSec?: number; sectionName?: string }>;
  duration?: number;
}): DisplayTrack {
  const sections = Array.isArray(song?.sections) ? song.sections : [];
  const markers = Array.isArray(song?.sectionMarkers) ? song.sectionMarkers : [];
  const kindCounts = new Map<string, number>();
  const allCues: DisplayCue[] = [];
  const displaySections: DisplaySection[] = [];

  sections.forEach((section, idx) => {
    const kind = getSectionKind(section.name);
    const count = (kindCounts.get(kind) || 0) + 1;
    kindCounts.set(kind, count);

    const marker = markers[idx];
    const nextMarker = markers[idx + 1];
    const startSec = Number.isFinite(Number(marker?.startSec)) ? Number(marker?.startSec) : null;
    const endSec = Number.isFinite(Number(marker?.endSec))
      ? Number(marker?.endSec)
      : Number.isFinite(Number(nextMarker?.startSec))
        ? Number(nextMarker?.startSec)
        : Number.isFinite(Number(song?.duration))
          ? Number(song.duration)
          : null;
    const markerTiming =
      startSec != null && endSec != null
        ? {
            startSec,
            endSec,
          }
        : null;

    const visual = SECTION_VISUALS[kind] || SECTION_VISUALS.default;
    const shortLabel = buildSectionShortLabel(section.name, kind, count);
    const startCueIndex = allCues.length;
    const cues = splitSectionIntoCues(song.id, idx, section, markerTiming, count);
    allCues.push(...cues);

    displaySections.push({
      index: idx,
      kind,
      label: section.name,
      shortLabel,
      color: [...visual.rgb] as [number, number, number],
      startCueIndex,
      cueCount: cues.length,
      startSec: markerTiming?.startSec ?? null,
      endSec: markerTiming?.endSec ?? null,
    });
  });

  return {
    songId: song.id,
    title: song.title,
    artist: song.artist,
    key: song.key,
    bpm: song.bpm || null,
    cues: allCues,
    sections: displaySections,
    totalDurationSec: song.duration || null,
  };
}
