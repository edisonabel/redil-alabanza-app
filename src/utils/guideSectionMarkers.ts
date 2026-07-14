import { getSectionKind } from './sectionVisuals.ts';

type GuideTranscriptWord = {
  word?: string;
  start?: number;
  end?: number;
};

type GuideSection = {
  name?: string;
  cueCount?: number;
};

type GuideCueKind = 'intro' | 'verse' | 'prechorus' | 'chorus' | 'interlude' | 'bridge' | 'outro';

type GuideCue = {
  kind: GuideCueKind;
  startSec: number;
  label: string;
};

export type GuideSectionMarker = {
  sectionName: string;
  startSec: number | null;
  confidence: number;
  method: 'guide-cue' | 'no-match';
  cueMarkers: number[];
};

const GUIDE_PRE_ROLL_SEC = 0.12;

const normalizeGuideWord = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z]/g, '')
  .trim();

const singleWordKind = (word = ''): GuideCueKind | null => {
  if (word === 'intro' || word === 'entrada') return 'intro';
  if (word === 'verso' || word === 'verse') return 'verse';
  if (word === 'coro' || word === 'chorus') return 'chorus';
  if (word === 'interludio' || word === 'interlude' || word === 'instrumental') return 'interlude';
  if (word === 'puente' || word === 'bridge') return 'bridge';
  if (word === 'salida' || word === 'final' || word === 'outro' || word === 'ending') return 'outro';
  return null;
};

export const extractGuideSectionCues = (transcriptWords: GuideTranscriptWord[] = []): GuideCue[] => {
  const words = (Array.isArray(transcriptWords) ? transcriptWords : [])
    .map((word) => ({
      word: normalizeGuideWord(word?.word),
      start: Number(word?.start),
      end: Number(word?.end),
    }))
    .filter((word) => word.word && Number.isFinite(word.start));
  const cues: GuideCue[] = [];

  for (let index = 0; index < words.length; index += 1) {
    const current = words[index];
    const next = words[index + 1];
    const isPreChorus = current.word === 'pre'
      && next?.word === 'coro'
      && Number(next.start) - Number(current.start) <= 2.5;

    if (isPreChorus) {
      cues.push({ kind: 'prechorus', startSec: current.start, label: 'Pre-coro' });
      index += 1;
      continue;
    }

    const kind = singleWordKind(current.word);
    if (!kind) continue;
    cues.push({ kind, startSec: current.start, label: current.word });
  }

  return cues;
};

const toGuideKind = (sectionName = ''): GuideCueKind | null => {
  const kind = getSectionKind(sectionName);
  if (kind === 'refrain') return 'chorus';
  if (
    kind === 'intro'
    || kind === 'verse'
    || kind === 'prechorus'
    || kind === 'chorus'
    || kind === 'interlude'
    || kind === 'bridge'
    || kind === 'outro'
  ) {
    return kind;
  }
  return null;
};

export const buildGuideSectionMarkers = ({
  sections,
  transcriptWords,
  durationSec = null,
}: {
  sections: GuideSection[];
  transcriptWords: GuideTranscriptWord[];
  durationSec?: number | null;
}): GuideSectionMarker[] => {
  const cues = extractGuideSectionCues(transcriptWords);
  let cursorSec = -1;

  const markers = (Array.isArray(sections) ? sections : []).map((section, index) => {
    const sectionName = String(section?.name || `Seccion ${index + 1}`);
    const kind = toGuideKind(sectionName);

    if (kind === 'intro') {
      const announcedIntro = cues.find((cue) => cue.kind === 'intro' && cue.startSec > cursorSec + 0.45);
      const startSec = announcedIntro ? Math.max(0, announcedIntro.startSec - GUIDE_PRE_ROLL_SEC) : 0;
      cursorSec = startSec;
      return {
        sectionName,
        startSec,
        confidence: announcedIntro ? 0.96 : 0.86,
        method: 'guide-cue',
        cueMarkers: [],
      };
    }

    if (!kind) {
      return { sectionName, startSec: null, confidence: 0, method: 'no-match', cueMarkers: [] };
    }

    const cue = cues.find((candidate) => (
      candidate.kind === kind && candidate.startSec > cursorSec + 0.45
    ));

    if (!cue) {
      return { sectionName, startSec: null, confidence: 0, method: 'no-match', cueMarkers: [] };
    }

    const startSec = Math.max(0, Math.round((cue.startSec - GUIDE_PRE_ROLL_SEC) * 1000) / 1000);
    cursorSec = startSec;
    return {
      sectionName,
      startSec,
      confidence: 0.96,
      method: 'guide-cue',
      cueMarkers: [],
    };
  });

  return markers.map((marker, index) => {
    if (marker.startSec == null) return marker;
    const cueCount = Math.max(1, Math.round(Number(sections[index]?.cueCount) || 1));
    const transitionCount = cueCount - 1;
    if (transitionCount <= 0) return marker;

    const nextMarker = markers.slice(index + 1).find((candidate) => candidate.startSec != null);
    const markerKind = toGuideKind(marker.sectionName);
    const nextDifferentCue = cues.find((cue) => (
      cue.startSec > Number(marker.startSec) + 0.45
      && cue.kind !== markerKind
    ));
    const rawEndSec = nextMarker?.startSec
      ?? (nextDifferentCue ? nextDifferentCue.startSec - GUIDE_PRE_ROLL_SEC : null)
      ?? (Number.isFinite(Number(durationSec)) ? Number(durationSec) : null);

    if (!Number.isFinite(Number(rawEndSec)) || Number(rawEndSec) <= Number(marker.startSec) + 0.75) {
      return marker;
    }

    const endSec = Number(rawEndSec);
    const interval = (endSec - Number(marker.startSec)) / cueCount;
    const expectedStarts = Array.from({ length: transitionCount }, (_, cueIndex) => (
      Number(marker.startSec) + interval * (cueIndex + 1)
    ));
    const availableCues = cues
      .map((cue) => Math.max(0, Math.round((cue.startSec - GUIDE_PRE_ROLL_SEC) * 1000) / 1000))
      .filter((cueStart) => (
        cueStart > Number(marker.startSec) + 0.45
        && cueStart < endSec - 0.45
      ));
    const maxCandidateDistance = Math.max(4, interval * 0.66);
    let previousCueStart = Number(marker.startSec);

    const cueMarkers = expectedStarts.map((expectedStart) => {
      const nearest = availableCues
        .filter((cueStart) => cueStart > previousCueStart + 0.75)
        .reduce<number | null>((best, cueStart) => {
          if (best == null) return cueStart;
          return Math.abs(cueStart - expectedStart) < Math.abs(best - expectedStart) ? cueStart : best;
        }, null);
      const selected = nearest != null && Math.abs(nearest - expectedStart) <= maxCandidateDistance
        ? nearest
        : Math.round(expectedStart * 1000) / 1000;
      previousCueStart = selected;
      return selected;
    });

    return { ...marker, cueMarkers };
  });
};

export const hasUsefulGuideMarkerCoverage = (markers: GuideSectionMarker[] = []) => {
  const candidates = markers.filter((marker) => !/^intro\b/i.test(marker.sectionName));
  const matched = candidates.filter((marker) => marker.method === 'guide-cue' && marker.startSec != null).length;
  return matched >= Math.max(2, Math.ceil(candidates.length * 0.65));
};
