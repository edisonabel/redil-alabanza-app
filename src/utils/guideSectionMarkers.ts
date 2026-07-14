import { getSectionKind } from './sectionVisuals.ts';

type GuideTranscriptWord = {
  word?: string;
  start?: number;
  end?: number;
};

type GuideSection = {
  name?: string;
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
}: {
  sections: GuideSection[];
  transcriptWords: GuideTranscriptWord[];
}): GuideSectionMarker[] => {
  const cues = extractGuideSectionCues(transcriptWords);
  let cursorSec = -1;

  return (Array.isArray(sections) ? sections : []).map((section, index) => {
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
};

export const hasUsefulGuideMarkerCoverage = (markers: GuideSectionMarker[] = []) => {
  const candidates = markers.filter((marker) => !/^intro\b/i.test(marker.sectionName));
  const matched = candidates.filter((marker) => marker.method === 'guide-cue' && marker.startSec != null).length;
  return matched >= Math.max(2, Math.ceil(candidates.length * 0.65));
};
