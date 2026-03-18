import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, Pause, Play, Radio, RadioReceiver, Repeat, Repeat1, SlidersHorizontal } from 'lucide-react';
import { supabase } from '../../lib/supabase';
const FONT_PRESETS = {
  grande: {
    section: 'text-[0.78rem] sm:text-[0.82rem] tracking-[0.3em]',
    chord: 'text-[1rem] sm:text-[1.06rem]',
    lyric: 'text-[1.1rem] sm:text-[1.18rem]',
    lineGap: 'gap-y-1.5',
  },
  enorme: {
    section: 'text-[0.88rem] sm:text-[0.94rem] tracking-[0.32em]',
    chord: 'text-[1.18rem] sm:text-[1.28rem]',
    lyric: 'text-[1.32rem] sm:text-[1.44rem]',
    lineGap: 'gap-y-2',
  },
};
const FONT_SCALE_SEQUENCE = ['grande', 'enorme'];
const SHARP_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_TO_SHARP = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
const TRANSPOSE_OPTIONS = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6];
const LATIN_TO_AMERICAN = {
  Do: 'C',
  'Do#': 'C#',
  Reb: 'C#',
  Re: 'D',
  'Re#': 'D#',
  Mib: 'D#',
  Mi: 'E',
  Fa: 'F',
  'Fa#': 'F#',
  Solb: 'F#',
  Sol: 'G',
  'Sol#': 'G#',
  Lab: 'G#',
  La: 'A',
  'La#': 'A#',
  Sib: 'A#',
  Si: 'B',
  Dob: 'B',
};
const normalizeSectionLabel = (value = '') => String(value || '').trim().toLowerCase();
const stripAccents = (value = '') => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const toRgba = (rgb = [161, 161, 170], alpha = 1) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
const SECTION_VISUALS = {
  intro: { short: 'I', rgb: [34, 211, 238] },
  verse: { short: 'V', rgb: [99, 102, 241] },
  prechorus: { short: 'Pr', rgb: [234, 179, 8] },
  chorus: { short: 'C', rgb: [249, 115, 22] },
  interlude: { short: 'It', rgb: [239, 68, 68] },
  bridge: { short: 'P', rgb: [236, 72, 153] },
  refrain: { short: 'Rf', rgb: [34, 197, 94] },
  outro: { short: 'F', rgb: [14, 165, 233] },
  vamp: { short: 'Vp', rgb: [248, 113, 113] },
  default: { short: 'S', rgb: [148, 163, 184] },
};
const getSectionKind = (sectionName = '') => {
  const normalized = normalizeSectionLabel(stripAccents(sectionName));
  if (normalized.includes('pre coro') || normalized.includes('pre-coro') || normalized.includes('prechorus') || normalized.includes('pre chorus')) return 'prechorus';
  if (normalized.includes('verso') || normalized.includes('verse')) return 'verse';
  if (normalized.includes('coro') || normalized.includes('chorus')) return 'chorus';
  if (normalized.includes('interludio') || normalized.includes('interlude') || normalized.includes('instrumental')) return 'interlude';
  if (normalized.includes('puente') || normalized.includes('bridge')) return 'bridge';
  if (normalized.includes('refran') || normalized.includes('refrain') || normalized.includes('tag')) return 'refrain';
  if (normalized.includes('outro') || normalized.includes('final') || normalized.includes('ending') || normalized.includes('fin')) return 'outro';
  if (normalized.includes('vamp')) return 'vamp';
  if (normalized.includes('intro') || normalized.includes('entrada')) return 'intro';
  return 'default';
};
const buildSectionShortLabel = (sectionName = '', kind = 'default', occurrence = 1) => {
  const source = stripAccents(sectionName);
  const explicitNumber = source.match(/(\d+)/)?.[1];
  const fallbackNumber = explicitNumber || occurrence;
  if (kind === 'verse') return `V${fallbackNumber}`;
  if (kind === 'intro') return 'I';
  if (kind === 'prechorus') return 'Pr';
  if (kind === 'chorus') return 'C';
  if (kind === 'interlude') return 'It';
  if (kind === 'bridge') return 'P';
  if (kind === 'refrain') return 'Rf';
  if (kind === 'outro') return 'F';
  if (kind === 'vamp') return 'Vp';
  const compact = source.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();
  return compact || `S${fallbackNumber}`;
};
const repairMarkerTimeline = (markers = [], durationHint = 0) => {
  if (!Array.isArray(markers) || markers.length < 2) return Array.isArray(markers) ? markers : [];
  const working = markers.map((marker) => ({
    ...marker,
    startSec: Number.isFinite(Number(marker?.startSec)) ? Math.max(0, Number(marker.startSec)) : null,
  }));
  const hasOutOfOrderValue = working.some((marker, index) => (
    Number.isFinite(marker.startSec) &&
    working.slice(index + 1).some((nextMarker) => (
      Number.isFinite(nextMarker.startSec) && nextMarker.startSec < marker.startSec
    ))
  ));
  if (!hasOutOfOrderValue) {
    return working;
  }
  const repaired = working.map((marker, index) => {
    const isOutOfOrder = Number.isFinite(marker.startSec) &&
      working.slice(index + 1).some((nextMarker) => (
        Number.isFinite(nextMarker.startSec) && nextMarker.startSec < marker.startSec
      ));
    return isOutOfOrder
      ? { ...marker, startSec: null, repaired: true }
      : marker;
  });
  let index = 0;
  while (index < repaired.length) {
    if (Number.isFinite(repaired[index].startSec)) {
      index += 1;
      continue;
    }
    const gapStart = index;
    while (index < repaired.length && !Number.isFinite(repaired[index].startSec)) {
      index += 1;
    }
    const gapEnd = index - 1;
    const prevMarker = repaired[gapStart - 1];
    const nextMarker = repaired[index];
    const gapCount = gapEnd - gapStart + 1;
    const prevStart = Number.isFinite(prevMarker?.startSec) ? prevMarker.startSec : null;
    const nextStart = Number.isFinite(nextMarker?.startSec) ? nextMarker.startSec : null;
    let segmentStart = prevStart;
    let segmentEnd = nextStart;
    if (segmentStart == null && segmentEnd == null) {
      segmentStart = 0;
      segmentEnd = Math.max(durationHint || 0, gapCount * 12);
    } else if (segmentStart == null) {
      segmentStart = 0;
    } else if (segmentEnd == null) {
      segmentEnd = Math.max(segmentStart + gapCount * 12, durationHint || (segmentStart + gapCount * 12));
    }
    const step = Math.max(1, (segmentEnd - segmentStart) / (gapCount + 1));
    for (let offset = 0; offset < gapCount; offset += 1) {
      repaired[gapStart + offset] = {
        ...repaired[gapStart + offset],
        startSec: Math.max(0, Math.round(segmentStart + step * (offset + 1))),
        repaired: true,
      };
    }
  }
  return repaired;
};
const formatSeconds = (value) => {
  const total = Math.max(0, Math.floor(value));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};
const AUDIO_SOURCE_EXT_RE = /\.(mp3|wav|m4a|aac|ogg|flac)(\?.*)?$/i;
const isAudioSourceUrl = (value = '') => {
  const source = String(value || '').trim();
  if (!source) return false;
  return AUDIO_SOURCE_EXT_RE.test(source);
};
const normalizePlaybackSourceEntry = (entry, index, fallbackKind = 'sequence') => {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const trimmedEntry = entry.trim();
    if (!isAudioSourceUrl(trimmedEntry)) return null;
    return {
      id: `${fallbackKind}-${index}-${trimmedEntry}`,
      label: fallbackKind === 'original' ? 'Musica original' : `Secuencia ${index + 1}`,
      url: trimmedEntry,
      kind: fallbackKind,
    };
  }
  if (typeof entry === 'object') {
    const rawUrl = String(entry.url || entry.src || entry.href || entry.link || '').trim();
    if (!isAudioSourceUrl(rawUrl)) return null;
    const rawKind = String(entry.kind || entry.type || fallbackKind || 'sequence').trim().toLowerCase();
    const kind = rawKind === 'original' ? 'original' : 'sequence';
    const label = String(
      entry.label ||
      entry.name ||
      entry.title ||
      (kind === 'original' ? 'Musica original' : `Secuencia ${index + 1}`)
    ).trim();
    return {
      id: String(entry.id || `${kind}-${index}-${rawUrl}`),
      label: label || (kind === 'original' ? 'Musica original' : `Secuencia ${index + 1}`),
      url: rawUrl,
      kind,
    };
  }
  return null;
};
const parseSequenceSourceEntries = (rawValue = '') => {
  const source = String(rawValue || '').trim();
  if (!source) return [];
  if ((source.startsWith('[') || source.startsWith('{'))) {
    try {
      const parsed = JSON.parse(source);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object') return [parsed];
    } catch (_error) {
      // fallback to plain-text parsing
    }
  }
  if (isAudioSourceUrl(source)) {
    return [source];
  }
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [maybeLabel, ...rest] = line.split('|');
      if (rest.length === 0) return line;
      return {
        label: maybeLabel.trim(),
        url: rest.join('|').trim(),
      };
    });
};
const buildPlaybackSources = (song) => {
  const sources = [];
  const seenUrls = new Set();
  const pushSource = (entry, index, fallbackKind = 'sequence') => {
    const normalized = normalizePlaybackSourceEntry(entry, index, fallbackKind);
    if (!normalized || seenUrls.has(normalized.url)) return;
    seenUrls.add(normalized.url);
    sources.push(normalized);
  };
  pushSource({
    id: 'original',
    label: 'Musica original',
    url: song?.mp3,
    kind: 'original',
  }, 0, 'original');
  const collectionCandidates = [];
  if (Array.isArray(song?.playbackSources)) {
    collectionCandidates.push(...song.playbackSources);
  }
  if (Array.isArray(song?.sequenceSources)) {
    collectionCandidates.push(...song.sequenceSources);
  }
  if (Array.isArray(song?.sequences)) {
    collectionCandidates.push(...song.sequences);
  }
  const rawLinkSecuencias = song?.linkSecuencias || song?.link_secuencias || '';
  if (rawLinkSecuencias) {
    collectionCandidates.push(...parseSequenceSourceEntries(rawLinkSecuencias));
  }
  collectionCandidates.forEach((entry, index) => {
    pushSource(entry, index, 'sequence');
  });
  return sources;
};
const formatChordAccidentals = (value = '') => (
  String(value || '')
    .replace(/#/g, '\u266F')
    .replace(/b/g, '\u266D')
);
const splitChordDisplayParts = (value = '') => {
  const chord = String(value || '').trim();
  if (!chord) return null;
  const chordMatch = chord.match(/^([A-G])([#b]?)([^/]*?)(?:\/([A-G])([#b]?)(.*))?$/);
  if (!chordMatch) {
    return {
      root: chord,
      accidental: '',
      suffix: '',
      bass: null,
    };
  }
  const [, root, accidental = '', suffix = '', bassRoot, bassAccidental = '', bassSuffix = ''] = chordMatch;
  return {
    root,
    accidental,
    suffix,
    bass: bassRoot
      ? {
          root: bassRoot,
          accidental: bassAccidental,
          suffix: bassSuffix,
        }
      : null,
  };
};
function ChordDisplay({ chord, sizeClass = '' }) {
  const parts = splitChordDisplayParts(chord);
  if (!parts) return null;
  const fallbackLabel = formatChordAccidentals(chord);
  const rootLabel = parts.root.length === 1 ? parts.root : fallbackLabel;
  return (
    <span className={`ensayo-chord-token font-black leading-none ${sizeClass}`.trim()}>
      <span className="ensayo-chord-root">{rootLabel}</span>
      {(parts.accidental || parts.suffix) && (
        <span className="ensayo-chord-suffix">
          {formatChordAccidentals(`${parts.accidental}${parts.suffix}`)}
        </span>
      )}
      {parts.bass && (
        <span className="ensayo-chord-bass">
          <span className="ensayo-chord-bass-divider">/</span>
          <span className="ensayo-chord-root">{parts.bass.root}</span>
          {(parts.bass.accidental || parts.bass.suffix) && (
            <span className="ensayo-chord-suffix">
              {formatChordAccidentals(`${parts.bass.accidental}${parts.bass.suffix}`)}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
const normalizeKeyToAmerican = (rawKey = '') => {
  const source = String(rawKey || '').trim();
  if (!source) return '-';
  const normalizedSource = source
    .replace(/\u266F/g, '#')
    .replace(/\u266D/g, 'b')
    .replace(/\s+/g, '');
  if (LATIN_TO_AMERICAN[normalizedSource]) {
    return LATIN_TO_AMERICAN[normalizedSource];
  }
  const upperRoot = normalizedSource.charAt(0).toUpperCase() + normalizedSource.slice(1);
  const rootMatch = upperRoot.match(/^([A-G][#b]?)/);
  if (!rootMatch) return source;
  const root = FLAT_TO_SHARP[rootMatch[1]] || rootMatch[1];
  return root;
};
const transposeChordToken = (token, steps = 0) => {
  if (!token || !steps) return token;
  const match = String(token).match(/^([A-G][#b]?)(.*)$/);
  if (!match) return token;
  let [, root, suffix] = match;
  root = FLAT_TO_SHARP[root] || root;
  const rootIndex = SHARP_NOTES.indexOf(root);
  if (rootIndex === -1) return token;
  let nextIndex = (rootIndex + steps) % 12;
  if (nextIndex < 0) nextIndex += 12;
  let nextSuffix = suffix;
  if (suffix.startsWith('/')) {
    const bassMatch = suffix.match(/^\/([A-G][#b]?)(.*)$/);
    if (bassMatch) {
      let [, bassRoot, bassSuffix] = bassMatch;
      bassRoot = FLAT_TO_SHARP[bassRoot] || bassRoot;
      const bassIndex = SHARP_NOTES.indexOf(bassRoot);
      if (bassIndex >= 0) {
        let nextBassIndex = (bassIndex + steps) % 12;
        if (nextBassIndex < 0) nextBassIndex += 12;
        nextSuffix = `/${SHARP_NOTES[nextBassIndex]}${bassSuffix}`;
      }
    }
  } else if (suffix.includes('/')) {
    nextSuffix = suffix.replace(/\/([A-G][#b]?)/, (_match, bassRoot) => {
      const normalizedBass = FLAT_TO_SHARP[bassRoot] || bassRoot;
      const bassIndex = SHARP_NOTES.indexOf(normalizedBass);
      if (bassIndex === -1) return `/${bassRoot}`;
      let nextBassIndex = (bassIndex + steps) % 12;
      if (nextBassIndex < 0) nextBassIndex += 12;
      return `/${SHARP_NOTES[nextBassIndex]}`;
    });
  }
  return `${SHARP_NOTES[nextIndex]}${nextSuffix}`;
};
const transposeChordProLine = (line, steps = 0) => {
  if (!line || !steps) return line;
  return String(line).replace(/\[([^\]]+)\]/g, (_match, chord) => `[${transposeChordToken(chord, steps)}]`);
};
const parseChordProLine = (line) => {
  if (!line) return [];
  const segments = [];
  const regex = /\[([^\]]+)\]/g;
  let currentChord = '';
  let lastIndex = 0;
  let match;
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
const buildChordOverlayLine = (line) => {
  const segments = parseChordProLine(line);
  if (!segments.length) {
    return { mode: 'plain', text: line || '' };
  }
  const hasChord = segments.some((segment) => segment.chord);
  const lyricLine = segments.map((segment) => segment.lyric || '').join('');
  const hasVisibleLyric = lyricLine.trim().length > 0;
  if (!hasChord) {
    return { mode: 'plain', text: lyricLine || line || '' };
  }
  if (!hasVisibleLyric) {
    return {
      mode: 'instrumental',
      chords: segments.map((segment) => segment.chord).filter(Boolean),
    };
  }
  let charIndex = 0;
  const chordMarks = [];
  segments.forEach((segment) => {
    if (segment.chord) {
      chordMarks.push({
        chord: segment.chord,
        index: charIndex,
      });
    }
    charIndex += (segment.lyric || '').length;
  });
  return {
    mode: 'segments',
    segments,
  };
};
export default function ModoEnsayoCompacto({
  song,
  contextTitle = '',
  onGoBack,
  globalSyncMode = false,
}) {
  if (!song) return null;
  const [headerHidden, setHeaderHidden] = useState(false);
  const [fontScale, setFontScale] = useState('enorme');
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeSectionManualIndex, setActiveSectionManualIndex] = useState(0);
  const [collapsedSections, setCollapsedSections] = useState({});
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioReady, setAudioReady] = useState(false);
  const [transposeSteps, setTransposeSteps] = useState(0);
  const [isMetronomeOn, setIsMetronomeOn] = useState(false);
  const [loopState, setLoopState] = useState(0);
  const [isLandscapeCompact, setIsLandscapeCompact] = useState(false);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [showPlaybackOptions, setShowPlaybackOptions] = useState(false);
  const [selectedPlaybackSourceId, setSelectedPlaybackSourceId] = useState('original');
  const [syncRole, setSyncRole] = useState(globalSyncMode ? 'musico' : 'local');
  const [remotePayload, setRemotePayload] = useState(null);
  const [panValue, setPanValue] = useState(0);
  const syncChannelRef = useRef(null);
  const audioRef = useRef(null);
  const headerRef = useRef(null);
  const scrollRef = useRef(null);
  const lastScrollTop = useRef(0);
  const sectionRefs = useRef([]);
  const optionsMenuRef = useRef(null);
  const playbackOptionsRef = useRef(null);
  const metronomeIntervalRef = useRef(null);
  const metronomeAudioCtxRef = useRef(null);
  const pendingPlaybackResumeRef = useRef(false);
  const audioCtxRef = useRef(null);
  const trackSourceRef = useRef(null);
  const trackGainRef = useRef(null);
  const trackPanRef = useRef(null);
  const padAudioRef = useRef(null);
  const [padVolume, setPadVolume] = useState(0.5);
  const [isPadActive, setIsPadActive] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(148);
  // ── Herencia de sincronización global desde EnsayoHub ──
  useEffect(() => {
    if (globalSyncMode) {
      setSyncRole('musico');
    } else if (syncRole === 'musico') {
      setSyncRole('local');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalSyncMode]);

  const currentSong = song;
  const activeSongIndex = 0;
  const currentSongBpm = Number.isFinite(Number(currentSong?.bpm)) ? Math.max(0, Math.round(Number(currentSong.bpm))) : 0;
  const originalSongKey = normalizeKeyToAmerican(currentSong?.originalKey || currentSong?.key || '-');
  const currentSongDisplayKey = useMemo(() => transposeChordToken(originalSongKey, transposeSteps), [originalSongKey, transposeSteps]);
  const transposeKeyOptions = useMemo(() => (
    TRANSPOSE_OPTIONS.map((steps) => ({
      steps,
      label: transposeChordToken(originalSongKey, steps),
    }))
  ), [originalSongKey]);
  const activePadUrl = useMemo(() => {
    if (!currentSongDisplayKey || currentSongDisplayKey === '-') return null;
    const safeKey = currentSongDisplayKey.replace('#', 'Sharp').replace('b', 'Flat');
    return `https://pub-4faa87e319a345c38e4f3be570797088.r2.dev/pads/Pad_${safeKey}.mp3`;
  }, [currentSongDisplayKey]);
  const currentSections = useMemo(() => (
    (currentSong?.sections || []).map((section) => ({
      ...section,
      lines: Array.isArray(section?.lines)
        ? section.lines.map((line) => transposeChordProLine(line, transposeSteps))
        : [],
    }))
  ), [currentSong?.sections, transposeSteps]);
  const sectionMapItems = useMemo(() => {
    const kindOccurrences = new Map();
    return currentSections.map((section, index) => {
      const kind = getSectionKind(section?.name || '');
      const nextOccurrence = (kindOccurrences.get(kind) || 0) + 1;
      kindOccurrences.set(kind, nextOccurrence);
      const visual = SECTION_VISUALS[kind] || SECTION_VISUALS.default;
      return {
        index,
        kind,
        occurrence: nextOccurrence,
        shortLabel: buildSectionShortLabel(section?.name || '', kind, nextOccurrence),
        rgb: visual.rgb,
      };
    });
  }, [currentSections]);
  const fontPreset = FONT_PRESETS[fontScale] || FONT_PRESETS.grande;
  const currentSongKey = String(currentSong?.id || 'demo');
  const titleLine = currentSong.title || 'Titulo de Cancion';
  const artistLine = currentSong.artist || 'Artista';
  const shouldRotateHeaderMeta = Boolean(artistLine) && titleLine.trim() !== artistLine.trim();
  const playbackSources = useMemo(() => buildPlaybackSources(currentSong), [currentSong]);
  const hasSequenceSources = useMemo(() => (
    playbackSources.some((source) => source.kind === 'sequence')
  ), [playbackSources]);
  const activePlaybackSource = useMemo(() => (
    playbackSources.find((source) => source.id === selectedPlaybackSourceId) || playbackSources[0] || null
  ), [playbackSources, selectedPlaybackSourceId]);
  const activePlaybackUrl = activePlaybackSource?.url || '';
  const currentSongMarkers = useMemo(() => (
    Array.isArray(currentSong?.sectionMarkers)
      ? (() => {
          let nextSectionSearchIndex = 0;
          const mappedMarkers = currentSong.sectionMarkers
          .filter((marker) => Number.isFinite(Number(marker?.startSec)))
          .map((marker, index) => ({
            id: marker?.id || `${currentSongKey}-marker-${index}`,
            sectionName: String(marker?.sectionName || '').trim(),
            startSec: Math.max(0, Number(marker?.startSec) || 0),
            endSec: Number.isFinite(Number(marker?.endSec)) ? Math.max(0, Number(marker.endSec)) : null,
            originalOrder: index,
            rawSectionIndex: Number.isInteger(Number(marker?.sectionIndex)) ? Number(marker.sectionIndex) : null,
            rawSectionOccurrence: Number.isInteger(Number(marker?.sectionOccurrence)) ? Number(marker.sectionOccurrence) : null,
          }))
          .map((marker, index) => {
            const normalizedMarkerName = normalizeSectionLabel(marker.sectionName);
            let sectionIndex = Number.isInteger(marker.rawSectionIndex) &&
              marker.rawSectionIndex >= 0 &&
              marker.rawSectionIndex < currentSections.length
              ? marker.rawSectionIndex
              : -1;
            if (sectionIndex === -1 && Number.isInteger(marker.rawSectionOccurrence)) {
              let occurrenceCount = 0;
              sectionIndex = currentSections.findIndex((section) => {
                if (normalizeSectionLabel(section?.name) !== normalizedMarkerName) return false;
                occurrenceCount += 1;
                return occurrenceCount === marker.rawSectionOccurrence;
              });
            }
            if (sectionIndex === -1) {
              sectionIndex = currentSections.findIndex((section, candidateIndex) => (
                candidateIndex >= nextSectionSearchIndex &&
                normalizeSectionLabel(section?.name) === normalizedMarkerName
              ));
            }
            if (sectionIndex === -1) {
              sectionIndex = currentSections.findIndex((section) => (
                normalizeSectionLabel(section?.name) === normalizedMarkerName
              ));
            }
            if (sectionIndex === -1) {
              sectionIndex = Math.min(index, Math.max(currentSections.length - 1, 0));
            }
            nextSectionSearchIndex = Math.max(nextSectionSearchIndex, sectionIndex + 1);
            return {
              ...marker,
              sectionIndex,
            };
          });
          return repairMarkerTimeline(mappedMarkers, Math.max(0, currentSong?.duration || 0));
        })()
      : []
  ), [currentSections, currentSong?.duration, currentSong?.sectionMarkers, currentSongKey]);
  const hasAudio = typeof activePlaybackUrl === 'string' && activePlaybackUrl.trim() !== '';
  const markerBySectionIndex = useMemo(() => {
    const map = new Map();
    currentSongMarkers.forEach((marker) => {
      if (Number.isInteger(marker.sectionIndex) && !map.has(marker.sectionIndex)) {
        map.set(marker.sectionIndex, marker);
      }
    });
    return map;
  }, [currentSongMarkers]);
  const fallbackTrackDuration = useMemo(() => {
    const highestMarkerPoint = currentSongMarkers.reduce((maxValue, marker) => {
      const markerEdge = Number.isFinite(marker?.endSec) ? marker.endSec : marker?.startSec;
      return Math.max(maxValue, markerEdge || 0);
    }, 0);
    return Math.max(0, currentSong?.duration || 0, highestMarkerPoint);
  }, [currentSong?.duration, currentSongMarkers]);
  const timelineDuration = Math.max(1, audioDuration > 0 ? audioDuration : fallbackTrackDuration || 1);
  const durationLabel = audioDuration > 0
    ? formatSeconds(audioDuration)
    : hasAudio
      ? '--:--'
      : formatSeconds(fallbackTrackDuration);
  const activeMarkerIndex = useMemo(() => {
    if (!hasAudio || currentSongMarkers.length === 0 || timelineDuration <= 0) return -1;
    let activeIndex = -1;
    currentSongMarkers.forEach((marker, markerIndex) => {
      const nextMarker = currentSongMarkers[markerIndex + 1];
      const markerEnd = marker.endSec ?? nextMarker?.startSec ?? timelineDuration + 0.001;
      if (audioCurrentTime >= marker.startSec && audioCurrentTime < markerEnd) {
        activeIndex = markerIndex;
      }
    });
    return activeIndex;
  }, [audioCurrentTime, currentSongMarkers, hasAudio, timelineDuration]);
  const activeSectionByAudioIndex = activeMarkerIndex >= 0
    ? (
        Number.isInteger(currentSongMarkers[activeMarkerIndex]?.sectionIndex)
          ? currentSongMarkers[activeMarkerIndex].sectionIndex
          : Math.min(activeMarkerIndex, currentSections.length - 1)
      )
    : -1;
  const playbackMarkers = useMemo(() => (
    currentSongMarkers.map((marker, markerIndex) => ({
      ...marker,
      markerIndex,
      percent: Math.min(99.5, Math.max(0.5, (marker.startSec / timelineDuration) * 100)),
      isActive: markerIndex === activeMarkerIndex,
    }))
  ), [activeMarkerIndex, currentSongMarkers, timelineDuration]);
  const activeSectionIndex = activeSectionByAudioIndex >= 0 ? activeSectionByAudioIndex : activeSectionManualIndex;
  const playbackSectionStrip = useMemo(() => (
    currentSections.map((section, index) => {
      const marker = markerBySectionIndex.get(index) || null;
      const visual = sectionMapItems[index] || {
        shortLabel: section?.name || `${index + 1}`,
        rgb: SECTION_VISUALS.default.rgb,
      };
      const nextMarker = (() => {
        for (let candidate = index + 1; candidate < currentSections.length; candidate += 1) {
          const found = markerBySectionIndex.get(candidate);
          if (found) return found;
        }
        return null;
      })();
      const previousMarker = (() => {
        for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
          const found = markerBySectionIndex.get(candidate);
          if (found) return found;
        }
        return null;
      })();
      let startSec = marker?.startSec;
      let endSec = nextMarker?.startSec;
      if (!Number.isFinite(startSec)) {
        if (Number.isFinite(previousMarker?.startSec) && Number.isFinite(nextMarker?.startSec)) {
          startSec = previousMarker.startSec + ((nextMarker.startSec - previousMarker.startSec) / 2);
        } else if (Number.isFinite(previousMarker?.startSec)) {
          startSec = previousMarker.startSec;
        } else {
          startSec = 0;
        }
      }
      if (!Number.isFinite(endSec)) {
        endSec = timelineDuration;
      }
      const safeStart = Math.max(0, Math.min(startSec, timelineDuration));
      const safeEnd = Math.max(safeStart, Math.min(endSec, timelineDuration));
      return {
        section,
        index,
        marker,
        isActive: index === activeSectionIndex,
        visual,
        startSec: safeStart,
        endSec: safeEnd,
        startPercent: (safeStart / timelineDuration) * 100,
        widthPercent: Math.max(2.8, ((safeEnd - safeStart) / timelineDuration) * 100),
      };
    })
  ), [activeSectionIndex, currentSections, markerBySectionIndex, sectionMapItems, timelineDuration]);
  const activeLoopSection = playbackSectionStrip[activeSectionIndex] || null;
  const currentHeaderOffset = headerHidden
    ? (isLandscapeCompact ? 8 : 18)
    : headerHeight + (isLandscapeCompact ? 8 : 18);
  const stopMetronome = React.useCallback(() => {
    if (metronomeIntervalRef.current) {
      window.clearInterval(metronomeIntervalRef.current);
      metronomeIntervalRef.current = null;
    }
    setIsMetronomeOn(false);
  }, []);
  const playMetronomeClick = React.useCallback(() => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!metronomeAudioCtxRef.current || metronomeAudioCtxRef.current.state === 'closed') {
      metronomeAudioCtxRef.current = new AudioContextClass();
    }
    const audioCtx = metronomeAudioCtxRef.current;
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.1);
  }, []);
  const handleToggleMetronome = React.useCallback(() => {
    if (!currentSongBpm) return;
    if (isMetronomeOn) {
      stopMetronome();
      return;
    }
    stopMetronome();
    const beatDurationMs = (60 / currentSongBpm) * 1000;
    setIsMetronomeOn(true);
    playMetronomeClick();
    metronomeIntervalRef.current = window.setInterval(playMetronomeClick, beatDurationMs);
  }, [currentSongBpm, isMetronomeOn, playMetronomeClick, stopMetronome]);
  const ensureWebAudioConnected = async () => {
    const audioElement = audioRef.current;
    if (!audioElement || typeof window === 'undefined') return;
    if (audioElement.dataset.webaudioConnected === 'true') return;

    // Limpiar contexto anterior si existe
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      try { audioCtxRef.current.close(); } catch {}
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    audioCtxRef.current = ctx;

    const source = ctx.createMediaElementSource(audioElement);
    const gainNode = ctx.createGain();
    const panNode = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createPanner();

    // Cadena: Source -> Panner -> Gain -> Salida
    source.connect(panNode);
    panNode.connect(gainNode);
    gainNode.connect(ctx.destination);

    trackSourceRef.current = source;
    trackGainRef.current = gainNode;
    trackPanRef.current = panNode;

    audioElement.dataset.webaudioConnected = 'true';

    // Aplicar paneo actual
    if (panNode.pan) {
      panNode.pan.setTargetAtTime(panValue, ctx.currentTime, 0.05);
    }
  };
  useEffect(() => {
    // Solo actualiza el panner si Web Audio ya está conectado (requiere CORS en R2)
    const panner = trackPanRef.current;
    if (!panner) return;
    if (panner.pan) {
      panner.pan.setTargetAtTime(panValue, audioCtxRef.current?.currentTime || 0, 0.05);
    } else if (panner.setPosition) {
      panner.setPosition(panValue, 0, 1 - Math.abs(panValue));
    }
  }, [panValue]);
  // Efecto Maestro de Fades (Encendido/Apagado) — 5 segundos suave
  useEffect(() => {
    const padEl = padAudioRef.current;
    if (!padEl) return;
    if (padEl._fadeInterval) clearInterval(padEl._fadeInterval);
    if (isPadActive && activePadUrl) {
      if (padEl.paused) {
        padEl.volume = 0;
        padEl.play().then(() => {
          const step = padVolume / 100;
          padEl._fadeInterval = setInterval(() => {
            if (padEl.volume + step < padVolume) {
              padEl.volume += step;
            } else {
              padEl.volume = padVolume;
              clearInterval(padEl._fadeInterval);
            }
          }, 50); // 100 pasos × 50ms = 5 segundos de Fade-In
        }).catch(err => {
          console.warn('[Pads] Autoplay bloqueado', err);
          setIsPadActive(false);
        });
      }
    } else {
      const startVol = padEl.volume;
      const step = startVol / 100;
      padEl._fadeInterval = setInterval(() => {
        if (padEl.volume - step > 0) {
          padEl.volume -= step;
        } else {
          padEl.volume = 0;
          padEl.pause();
          clearInterval(padEl._fadeInterval);
        }
      }, 50); // 100 pasos × 50ms = 5 segundos de Fade-Out
    }
  }, [isPadActive, activePadUrl]); // Sin padVolume para no interrumpir el fade
  // Efecto secundario: slider de volumen (solo si no hay fade activo)
  useEffect(() => {
    const padEl = padAudioRef.current;
    if (!padEl || !isPadActive || padEl._fadeInterval) return;
    padEl.volume = padVolume;
  }, [padVolume, isPadActive]);
  useEffect(() => {
    setIsPlaying(false);
    setActiveSectionManualIndex(0);
    setAudioCurrentTime(0);
    setAudioDuration(0);
    setAudioReady(false);
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: 'auto' });
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setTransposeSteps(0);
    setLoopState(0);
    setShowOptionsMenu(false);
    setShowPlaybackOptions(false);
    setSelectedPlaybackSourceId('original');
    setHeaderHidden(isLandscapeCompact);
    stopMetronome();
  }, [currentSongKey, currentSong?.mp3, isLandscapeCompact, stopMetronome]);
  useEffect(() => {
    if (playbackSources.length === 0) return;
    const hasSelectedSource = playbackSources.some((source) => source.id === selectedPlaybackSourceId);
    if (!hasSelectedSource) {
      setSelectedPlaybackSourceId(playbackSources[0].id);
    }
  }, [playbackSources, selectedPlaybackSourceId]);
  useEffect(() => {
    if (!showOptionsMenu || typeof window === 'undefined') return undefined;
    const handlePointerDown = (event) => {
      if (!optionsMenuRef.current?.contains(event.target)) {
        setShowOptionsMenu(false);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('touchstart', handlePointerDown, { passive: true });
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('touchstart', handlePointerDown);
    };
  }, [showOptionsMenu]);
  useEffect(() => {
    if (!showPlaybackOptions || typeof window === 'undefined') return undefined;
    const handlePointerDown = (event) => {
      if (!playbackOptionsRef.current?.contains(event.target)) {
        setShowPlaybackOptions(false);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('touchstart', handlePointerDown, { passive: true });
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('touchstart', handlePointerDown);
    };
  }, [showPlaybackOptions]);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mediaQuery = window.matchMedia('(orientation: landscape) and (max-height: 540px)');
    const syncLandscapeCompact = (event) => {
      const matches = typeof event?.matches === 'boolean' ? event.matches : mediaQuery.matches;
      setIsLandscapeCompact((prev) => (prev === matches ? prev : matches));
      setHeaderHidden((prev) => {
        if (matches) return true;
        return prev ? false : prev;
      });
    };
    syncLandscapeCompact();
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncLandscapeCompact);
      return () => mediaQuery.removeEventListener('change', syncLandscapeCompact);
    }
    mediaQuery.addListener(syncLandscapeCompact);
    return () => mediaQuery.removeListener(syncLandscapeCompact);
  }, []);
  useEffect(() => {
    const headerNode = headerRef.current;
    if (!headerNode || typeof ResizeObserver === 'undefined') return undefined;
    const syncHeaderHeight = () => {
      const nextHeight = headerNode.getBoundingClientRect().height || 0;
      setHeaderHeight((prev) => (Math.abs(prev - nextHeight) < 1 ? prev : nextHeight));
    };
    syncHeaderHeight();
    const observer = new ResizeObserver(syncHeaderHeight);
    observer.observe(headerNode);
    return () => observer.disconnect();
  }, [currentSections.length, currentSongKey]);
  useEffect(() => {
    setCollapsedSections((prev) => {
      if (prev[currentSongKey]) return prev;
      const defaults = currentSections.reduce((acc, _section, index) => {
        acc[index] = false;
        return acc;
      }, {});
      return {
        ...prev,
        [currentSongKey]: defaults,
      };
    });
  }, [currentSections, currentSongKey]);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return undefined;
      const handleScroll = () => {
        const currentTop = scroller.scrollTop;
        if (isLandscapeCompact) {
          if (currentTop < lastScrollTop.current - 8) {
            setHeaderHidden(false);
          } else if (currentTop > lastScrollTop.current + 8) {
            setHeaderHidden(true);
          }
        } else {
          // Portrait: header always visible — safe zone for notch / dynamic island
          setHeaderHidden(false);
        }
        lastScrollTop.current = currentTop;
      let nextSectionIndex = 0;
      sectionRefs.current.forEach((node, index) => {
        if (!node) return;
        if (node.offsetTop - currentHeaderOffset <= currentTop) {
          nextSectionIndex = index;
        }
      });
      setActiveSectionManualIndex((prev) => (prev === nextSectionIndex ? prev : nextSectionIndex));
    };
    scroller.addEventListener('scroll', handleScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', handleScroll);
  }, [currentHeaderOffset, currentSections.length, isLandscapeCompact]);
  useEffect(() => {
    if (activeSectionByAudioIndex < 0 || !scrollRef.current) return;
    setCollapsedSections((prev) => {
      const songState = prev[currentSongKey] || {};
      if (songState[activeSectionByAudioIndex] === false) return prev;
      return {
        ...prev,
        [currentSongKey]: {
          ...songState,
          [activeSectionByAudioIndex]: false,
        },
      };
    });
  }, [activeSectionByAudioIndex, currentSongKey]);
  const getSectionScrollTop = (index) => {
    const scroller = scrollRef.current;
    const node = sectionRefs.current[index];
    if (!scroller || !node) return null;
    const scrollerRect = scroller.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    // Extra 14px breathing room so the section label doesn't sit flush against the header
    const SECTION_TOP_PAD = 14;
    const targetTop = scroller.scrollTop + (nodeRect.top - scrollerRect.top) - currentHeaderOffset - SECTION_TOP_PAD;
    return Math.max(0, targetTop);
  };
  const scrollToSectionIndex = (index, behavior = 'smooth') => {
    const scroller = scrollRef.current;
    const targetTop = getSectionScrollTop(index);
    if (!scroller || targetTop === null) return;
    const distance = Math.abs(scroller.scrollTop - targetTop);
    if (distance < 40) return;
    scroller.scrollTo({
      top: targetTop,
      behavior,
    });
  };
  useEffect(() => {
    if (activeSectionByAudioIndex < 0) return;
    window.requestAnimationFrame(() => {
      scrollToSectionIndex(activeSectionByAudioIndex, 'smooth');
    });
  }, [activeSectionByAudioIndex]);
  useEffect(() => {
    if (loopState !== 2 || !isPlaying || !audioRef.current || !activeLoopSection) return undefined;
    const audioElement = audioRef.current;
    const handleSectionLoop = () => {
      if (!Number.isFinite(activeLoopSection.endSec) || !Number.isFinite(activeLoopSection.startSec)) return;
      if (audioElement.currentTime >= Math.max(activeLoopSection.endSec - 0.08, activeLoopSection.startSec)) {
        audioElement.currentTime = activeLoopSection.startSec;
        setAudioCurrentTime(activeLoopSection.startSec);
      }
    };
    audioElement.addEventListener('timeupdate', handleSectionLoop);
    return () => audioElement.removeEventListener('timeupdate', handleSectionLoop);
  }, [activeLoopSection, isPlaying, loopState]);
  useEffect(() => {
    if (currentSongBpm > 0) return;
    stopMetronome();
  }, [currentSongBpm, stopMetronome]);
  useEffect(() => () => {
    stopMetronome();
    const audioCtx = metronomeAudioCtxRef.current;
    if (audioCtx && audioCtx.state !== 'closed') {
      audioCtx.close().catch(() => {});
    }
    metronomeAudioCtxRef.current = null;
  }, [stopMetronome]);
  const progressPercent = useMemo(() => {
    if (!timelineDuration) return 0;
    return Math.min(100, Math.max(0, (audioCurrentTime / timelineDuration) * 100));
  }, [audioCurrentTime, timelineDuration]);
  const handleGoBack = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setAudioCurrentTime(0);
    stopMetronome();
    if (typeof window !== 'undefined') {
      window.__REDIL_PRO_PLAYER__?.close?.();
    }
    if (typeof onGoBack === 'function') {
      onGoBack();
      return;
    }
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = '/repertorio';
  };
  const syncAudioMetrics = (audioElement) => {
    if (!audioElement) return;
    const nextDuration =
      Number.isFinite(audioElement.duration) && audioElement.duration > 0
        ? audioElement.duration
        : 0;
    const nextTime =
      Number.isFinite(audioElement.currentTime) && audioElement.currentTime >= 0
        ? audioElement.currentTime
        : 0;
    setAudioDuration((prev) => (Math.abs(prev - nextDuration) < 0.05 ? prev : nextDuration));
    setAudioReady(nextDuration > 0);
    setAudioCurrentTime((prev) => (Math.abs(prev - nextTime) < 0.05 ? prev : nextTime));
  };
  useEffect(() => {
    if (!hasAudio || !audioRef.current) return;
    const audioElement = audioRef.current;
    window.requestAnimationFrame(() => {
      syncAudioMetrics(audioElement);
    });
  }, [activePlaybackUrl, hasAudio]);
  useEffect(() => {
    if (!pendingPlaybackResumeRef.current || !audioReady || !audioRef.current) return;
    pendingPlaybackResumeRef.current = false;
    audioRef.current.play().catch(() => {
      setIsPlaying(false);
    });
  }, [audioReady]);
  useEffect(() => {
    if (syncRole === 'local' || typeof window === 'undefined') {
      if (syncChannelRef.current) {
        supabase.removeChannel(syncChannelRef.current);
        syncChannelRef.current = null;
      }
      return;
    }
    const channel = supabase.channel('ensayo-live-sync', {
      config: { broadcast: { self: false } },
    });
    channel.on('broadcast', { event: 'SECTION_CHANGE' }, (payload) => {
      if (payload.payload) {
        setRemotePayload(payload.payload);
      }
    }).subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log(`[LiveSync] Conectado como ${syncRole}`);
      }
    });
    syncChannelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
    };
  }, [syncRole]);
  useEffect(() => {
    if (syncRole !== 'director' || !syncChannelRef.current) return;
    console.log('[LiveSync] Emitiendo cambio de sección:', activeSectionIndex);
    syncChannelRef.current.send({
      type: 'broadcast',
      event: 'SECTION_CHANGE',
      payload: {
        songId: currentSongKey,
        sectionIndex: activeSectionIndex,
      },
    }).catch(err => console.warn('[LiveSync] Error enviando señal:', err));
  }, [activeSectionIndex, syncRole, currentSongKey]);

  // ── Receptor: procesa el payload remoto en un ciclo seguro de React ──
  useEffect(() => {
    if (!remotePayload || syncRole !== 'musico') return;

    const { songId, sectionIndex, currentTime: directorTime } = remotePayload;

    if (String(songId) === String(currentSongKey)) {
      // Mover la barra de progreso al tiempo del Director
      if (typeof directorTime === 'number') {
        setAudioCurrentTime(directorTime);
      }
      // Scroll a la sección solo si cambió
      if (activeSectionManualIndex !== sectionIndex) {
        setActiveSectionManualIndex(sectionIndex);
        setTimeout(() => {
          scrollToSectionIndex(sectionIndex, 'smooth');
        }, 150);
      }
    }
  }, [remotePayload, currentSongKey, syncRole]);

  const selectSection = (index, { seekAudio = true, scrollBehavior = 'smooth' } = {}) => {
    setActiveSectionManualIndex(index);
    setCollapsedSections((prev) => ({
      ...prev,
      [currentSongKey]: {
        ...(prev[currentSongKey] || {}),
        [index]: false,
      },
    }));
    const marker = markerBySectionIndex.get(index);
    if (marker && audioRef.current) {
      if (seekAudio) {
        const gainNode = trackGainRef?.current;
        const ctx = audioCtxRef?.current;
        if (gainNode && ctx && ctx.state === 'running') {
          // Micro Fade-out de 150ms (Anti-pop)
          gainNode.gain.cancelScheduledValues(ctx.currentTime);
          gainNode.gain.setValueAtTime(gainNode.gain.value, ctx.currentTime);
          gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
          setTimeout(() => {
            if (audioRef.current) {
              audioRef.current.currentTime = marker.startSec;
              setAudioCurrentTime(marker.startSec);
            }
            // Micro Fade-in de 150ms tras el salto
            gainNode.gain.cancelScheduledValues(ctx.currentTime);
            gainNode.gain.setValueAtTime(0, ctx.currentTime);
            gainNode.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.15);
          }, 150);
        } else {
          // Fallback si Web Audio no está inicializado
          audioRef.current.currentTime = marker.startSec;
          setAudioCurrentTime(marker.startSec);
        }
      }
    }
    window.requestAnimationFrame(() => {
      scrollToSectionIndex(index, scrollBehavior);
    });
  };
  const handleTogglePlayback = async () => {
    if (!audioRef.current || !hasAudio) return;
    try {
      if (audioRef.current.paused) {
        await ensureWebAudioConnected();
        if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
          await audioCtxRef.current.resume();
        }
        await audioRef.current.play();
      } else {
        audioRef.current.pause();
      }
    } catch (_error) {
      setIsPlaying(false);
    }
  };
  const handleSeekChange = (event) => {
    const nextTime = Number(event.target.value || 0);
    setAudioCurrentTime(nextTime);
    if (audioRef.current) {
      audioRef.current.currentTime = nextTime;
    }
  };
  const cycleFontScale = () => {
    setFontScale((current) => {
      const currentIndex = FONT_SCALE_SEQUENCE.indexOf(current);
      const nextIndex = currentIndex === -1 ? 1 : (currentIndex + 1) % FONT_SCALE_SEQUENCE.length;
      return FONT_SCALE_SEQUENCE[nextIndex];
    });
  };
  const handleSelectPlaybackSource = (sourceId) => {
    if (sourceId === selectedPlaybackSourceId) {
      setShowPlaybackOptions(false);
      return;
    }
    const wasPlaying = Boolean(audioRef.current && !audioRef.current.paused);
    pendingPlaybackResumeRef.current = wasPlaying;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setAudioCurrentTime(0);
    setAudioDuration(0);
    setAudioReady(false);
    setSelectedPlaybackSourceId(sourceId);
    setShowPlaybackOptions(false);
  };
  return (
    <div className="ensayo-mobile-shell relative flex h-screen w-full flex-col overflow-hidden bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <audio
        key={`${currentSongKey}-${selectedPlaybackSourceId}-${activePlaybackUrl || 'no-audio'}`}
        ref={audioRef}
        src={hasAudio ? activePlaybackUrl : undefined}
        crossOrigin="anonymous"
        preload="metadata"
        onLoadedMetadata={(event) => syncAudioMetrics(event.currentTarget)}
        onLoadedData={(event) => syncAudioMetrics(event.currentTarget)}
        onDurationChange={(event) => syncAudioMetrics(event.currentTarget)}
        onCanPlay={(event) => syncAudioMetrics(event.currentTarget)}
        onTimeUpdate={(event) => {
          const nextTime = Number.isFinite(event.currentTarget.currentTime) ? event.currentTarget.currentTime : 0;
          setAudioCurrentTime(nextTime);
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={async () => {
          if (loopState === 1 && audioRef.current) {
            audioRef.current.currentTime = 0;
            setAudioCurrentTime(0);
            try {
              await audioRef.current.play();
              return;
            } catch (_error) {
              // keep regular ended fallback
            }
          }
          setIsPlaying(false);
          const finalTime = Number.isFinite(audioRef.current?.duration) ? audioRef.current.duration : 0;
          setAudioCurrentTime(finalTime || 0);
        }}
        onError={() => {
          setAudioReady(false);
          setAudioDuration(0);
        }}
      />
      <audio
        key={`pad-${activePadUrl}`}
        ref={padAudioRef}
        src={activePadUrl || undefined}
        loop
        preload="auto"
      />
      <header
        ref={headerRef}
        className={`absolute inset-x-0 top-0 z-30 border-b border-zinc-200/70 bg-white/92 backdrop-blur-xl dark:border-white/8 dark:bg-zinc-950/96 transition-transform duration-300 ${
          headerHidden ? '-translate-y-full' : 'translate-y-0'
        }`}
      >
        <div
          className="ensayo-header-top flex items-center justify-between gap-3 pb-1 pt-[calc(env(safe-area-inset-top)+0.45rem)]"
          style={{
            paddingLeft: 'calc(env(safe-area-inset-left) + 0.75rem)',
            paddingRight: 'calc(env(safe-area-inset-right) + 0.75rem)',
          }}
        >
          <button
            type="button"
            onClick={handleGoBack}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-900 shadow-sm transition-colors hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
            aria-label="Volver"
          >
            <ArrowLeft className="h-4.5 w-4.5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="ensayo-header-slot overflow-hidden">
              {shouldRotateHeaderMeta ? (
                <div className="ensayo-header-mask flex flex-col">
                  <div className="ensayo-header-line flex items-center">
                    <p className="ensayo-header-title truncate font-black tracking-tight text-zinc-950 dark:text-zinc-50">
                      {titleLine}
                    </p>
                  </div>
                  <div className="ensayo-header-line flex items-center">
                    <p className="ensayo-header-artist truncate font-semibold tracking-tight text-zinc-500 dark:text-zinc-400">
                      {artistLine}
                    </p>
                  </div>
                  <div className="ensayo-header-line flex items-center" aria-hidden="true">
                    <p className="ensayo-header-title truncate font-black tracking-tight text-zinc-950 dark:text-zinc-50">
                      {titleLine}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="ensayo-header-line flex items-center">
                  <p className="ensayo-header-title truncate font-black tracking-tight text-zinc-950 dark:text-zinc-50">
                    {titleLine}
                  </p>
                </div>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setSyncRole(prev => prev === 'local' ? 'director' : prev === 'director' ? 'musico' : 'local')}
              className={`ensayo-control-chip flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border transition-all ${
                syncRole === 'director'
                  ? 'border-brand bg-brand text-white shadow-[0_8px_18px_rgba(59,130,246,0.3)]'
                  : syncRole === 'musico'
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'border-zinc-200 bg-white text-zinc-400 hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-900 dark:hover:bg-zinc-800'
              }`}
              aria-label="Modo de Sincronización"
              title={syncRole === 'local' ? 'Desconectado' : syncRole === 'director' ? 'Modo Director (Enviando)' : 'Modo Músico (Recibiendo)'}
            >
              {syncRole === 'director' ? <Radio className="h-4.5 w-4.5 animate-pulse" /> : <RadioReceiver className="h-4.5 w-4.5" />}
            </button>
            <button
              type="button"
              onClick={handleToggleMetronome}
              disabled={!currentSongBpm}
              className={`ensayo-control-chip ensayo-bpm-chip relative inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl border bg-white text-zinc-900 shadow-sm transition-colors dark:bg-zinc-900 dark:text-zinc-50 ${
                currentSongBpm
                  ? 'border-zinc-200 hover:bg-zinc-100 dark:border-white/10 dark:hover:bg-zinc-800'
                  : 'cursor-not-allowed border-zinc-200/70 text-zinc-400 dark:border-white/10 dark:text-zinc-500'
              } ${isMetronomeOn ? 'beat-active' : ''}`}
              style={isMetronomeOn && currentSongBpm ? { '--bpm-duration': `${60 / currentSongBpm}s` } : undefined}
              aria-label={isMetronomeOn ? `Detener metr\u00F3nomo ${currentSongBpm} BPM` : `Activar metr\u00F3nomo ${currentSongBpm || 0} BPM`}
              title={currentSongBpm ? `${currentSongBpm} BPM` : 'Sin BPM'}
              >
                <span className={`relative z-[1] font-black leading-none ${String(currentSongBpm || '--').length > 2 ? 'text-[11px]' : 'text-sm'}`}>
                  {currentSongBpm || '--'}
                </span>
            </button>
            <div ref={optionsMenuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setShowOptionsMenu((prev) => !prev)}
                className={`ensayo-control-chip flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-900 shadow-sm transition-colors hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800 ${
                  showOptionsMenu ? 'ring-2 ring-brand/20 border-brand/30' : ''
                }`}
                aria-label="Opciones de ensayo"
                aria-expanded={showOptionsMenu}
                title="Opciones"
              >
                <SlidersHorizontal className="h-4.5 w-4.5" />
              </button>
              {showOptionsMenu && (
                <div className="absolute right-0 top-[calc(100%+0.55rem)] z-50 w-[15rem] rounded-[1.35rem] border border-zinc-200/85 bg-white/96 p-3.5 shadow-[0_18px_50px_rgba(15,23,42,0.22)] backdrop-blur-xl dark:border-white/10 dark:bg-zinc-950/96 flex flex-col gap-4">
                  {/* Tono */}
                  {originalSongKey !== '-' && (
                    <div>
                      <p className="mb-2 px-1 text-[0.72rem] font-black uppercase tracking-[0.28em] text-zinc-500 dark:text-zinc-400">
                        Tonalidad
                      </p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {transposeKeyOptions.map((option, optionIndex) => {
                          const active = option.steps === transposeSteps;
                          return (
                            <button
                              key={`transpose-option-${option.steps}-${optionIndex}`}
                              type="button"
                              onClick={() => setTransposeSteps(option.steps)}
                              className={`rounded-[0.9rem] border px-2 py-3.5 text-center text-base font-black leading-none transition-all ${
                                active
                                  ? 'border-brand bg-brand text-white shadow-[0_8px_20px_rgba(59,130,246,0.32)]'
                                  : 'border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300 hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800'
                              }`}
                              aria-pressed={active}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {/* Tamaño */}
                  <div>
                    <p className="mb-2 px-1 text-[0.72rem] font-black uppercase tracking-[0.28em] text-zinc-500 dark:text-zinc-400">
                      Tamaño de texto
                    </p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {FONT_SCALE_SEQUENCE.map((size) => {
                        const active = fontScale === size;
                        return (
                          <button
                            key={size}
                            type="button"
                            onClick={() => setFontScale(size)}
                            className={`rounded-[0.9rem] border px-3 py-2.5 text-center font-black leading-none transition-all ${
                              size === 'grande' ? 'text-sm' : 'text-base'
                            } ${
                              active
                                ? 'border-brand bg-brand text-white shadow-[0_8px_20px_rgba(59,130,246,0.32)]'
                                : 'border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800'
                            }`}
                            aria-pressed={active}
                          >
                            {size === 'grande' ? 'Grande' : 'Enorme'}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div
          className="ensayo-section-map px-3 pb-2"
          style={{
            paddingLeft: 'calc(env(safe-area-inset-left) + 0.75rem)',
            paddingRight: 'calc(env(safe-area-inset-right) + 0.75rem)',
          }}
        >
          <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {currentSections.map((section, index) => {
              const active = index === activeSectionIndex;
              const visual = sectionMapItems[index] || SECTION_VISUALS.default;
              return (
                <button
                  key={`${currentSong.id || 'song'}-${section.name}-${index}`}
                  type="button"
                  onClick={() => selectSection(index, { seekAudio: true, scrollBehavior: 'smooth' })}
                    className="ensayo-section-chip shrink-0 rounded-full border bg-white text-[11px] font-black uppercase tracking-[0.02em] transition-all dark:bg-zinc-950"
                  style={{
                    minWidth: '2.45rem',
                    height: '2.45rem',
                    borderColor: toRgba(visual.rgb, active ? 0.92 : 0.5),
                    color: toRgba(visual.rgb, active ? 1 : 0.94),
                    boxShadow: active ? `0 0 0 4px ${toRgba(visual.rgb, 0.16)}` : 'none',
                  }}
                  title={section.name}
                  aria-label={`Ir a ${section.name}`}
                >
                  {visual.shortLabel}
                </button>
              );
            })}
          </div>
        </div>
      </header>
      <main
        ref={scrollRef}
        className="ensayo-main-scroll min-h-0 flex-1 overflow-y-auto pb-24 transition-[padding-top] duration-300"
        style={{
          paddingTop: `${currentHeaderOffset + (isLandscapeCompact ? 4 : 8)}px`,
          paddingLeft: 'calc(env(safe-area-inset-left) + 0.75rem)',
          paddingRight: 'calc(env(safe-area-inset-right) + 0.75rem)',
        }}
      >
        <div className="ensayo-sections-layout mx-auto max-w-6xl columns-1 gap-4 xl:columns-2 xl:gap-5">
          {currentSections.map((section, sectionIndex) => {
            const isCollapsed = false;
            const isActiveSection = sectionIndex === activeSectionIndex;
            const visual = sectionMapItems[sectionIndex] || SECTION_VISUALS.default;
            const headerBgStyle = isActiveSection
              ? { backgroundColor: toRgba(visual.rgb, 0.045) }
              : undefined;
            return (
              <details
                key={`${currentSongKey}-${section.name}-${sectionIndex}`}
                ref={(node) => {
                  sectionRefs.current[sectionIndex] = node;
                }}
                open={!isCollapsed}
                className={`relative inline-block w-full break-inside-avoid-column self-start overflow-visible rounded-[1.02rem] border border-zinc-200/90 px-3.5 pb-3.5 pt-4 shadow-sm transition-all ${
                  sectionIndex === 0 ? 'mt-2 mb-5 xl:mt-3 xl:mb-6' : 'mb-5 xl:mb-6'
                } dark:border-white/10 ${
                  isActiveSection
                    ? 'bg-white/96 dark:bg-zinc-900'
                    : 'border-zinc-200 bg-white/92 dark:border-white/10 dark:bg-zinc-900/88'
                }`}
                style={isActiveSection ? {
                  borderColor: toRgba(visual.rgb, 0.58),
                  backgroundColor: toRgba(visual.rgb, 0.035),
                  boxShadow: `0 0 0 1.5px ${toRgba(visual.rgb, 0.18)}, 0 18px 34px rgba(24,24,27,0.12)`,
                } : undefined}
                onClick={(event) => {
                  if (event.target.closest('summary')) return;
                  selectSection(sectionIndex, { seekAudio: true, scrollBehavior: 'smooth' });
                }}
              >
                <summary
                  className="absolute inset-x-3 -top-[0.78rem] z-10 flex cursor-pointer list-none items-center justify-between gap-2 text-left marker:hidden [&::-webkit-details-marker]:hidden"
                  aria-expanded={!isCollapsed}
                  onClick={(event) => {
                    event.preventDefault();
                    selectSection(sectionIndex, { seekAudio: true, scrollBehavior: 'smooth' });
                  }}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full pr-3" style={headerBgStyle}>
                    <span
                      className="flex h-6 min-w-6 items-center justify-center rounded-full border bg-white px-1.5 text-[10px] font-black uppercase shadow-sm dark:bg-zinc-950"
                      style={{
                        borderColor: toRgba(visual.rgb, isActiveSection ? 0.62 : 0.42),
                        color: toRgba(visual.rgb, 1),
                      }}
                    >
                      {visual.shortLabel}
                    </span>
                    <div className="flex min-w-0 flex-1 items-center">
                      <h2
                        className={`shrink-0 px-1.5 font-black uppercase bg-white dark:bg-zinc-950 ${fontPreset.section}`}
                        style={{
                          color: toRgba(visual.rgb, 1),
                        }}
                      >
                        {section.name}
                      </h2>
                    </div>
                  </div>
                  <div className="flex min-w-0 items-center gap-2 rounded-full pl-2" style={headerBgStyle}>
                    {section.note && (
                      <span
                        className={`max-w-[10rem] truncate rounded-full bg-white px-2 py-[0.18rem] text-[13px] font-medium tracking-[0.08em] dark:bg-zinc-950 ${
                          isActiveSection ? '' : 'text-zinc-400 dark:text-zinc-500'
                        }`}
                        style={isActiveSection ? { color: toRgba(visual.rgb, 0.92) } : undefined}
                      >
                        {section.note}
                      </span>
                    )}
                  </div>
                </summary>
                {!isCollapsed && (
                  <div
                    className="space-y-1.5 pt-2"
                    onClick={() => selectSection(sectionIndex, { seekAudio: true, scrollBehavior: 'smooth' })}
                  >
                    {section.lines.map((line, lineIndex) => {
                      const renderedLine = buildChordOverlayLine(line);
                      return (
                        <div key={`${section.name}-${lineIndex}`} className={`grid ${fontPreset.lineGap}`}>
                          {renderedLine.mode === 'plain' && (
                            <p className={`leading-[1.3] text-zinc-900 dark:text-zinc-50 ${fontPreset.lyric}`}>
                              {renderedLine.text}
                            </p>
                          )}
                          {renderedLine.mode === 'instrumental' && (
                            <div className="flex flex-row flex-wrap gap-2">
                              {renderedLine.chords.map((chord, chordIndex) => (
                                <ChordDisplay
                                  key={`${section.name}-${lineIndex}-chord-${chordIndex}`}
                                  chord={chord}
                                  sizeClass={`font-mono ${fontPreset.chord}`}
                                />
                              ))}
                            </div>
                          )}
                          {renderedLine.mode === 'segments' && (
                            <p
                              className={`relative mt-[1.8em] whitespace-pre-wrap break-words text-zinc-900 dark:text-zinc-50 ${fontPreset.lyric}`}
                              style={{
                                lineHeight: '1.4',
                              }}
                            >
                              {renderedLine.segments.map((segment, segmentIndex) => (
                                <React.Fragment key={`${section.name}-${lineIndex}-segment-${segmentIndex}`}>
                                  {segment.chord && (
                                    <span className="relative">
                                      <span className="pointer-events-none absolute bottom-full left-0 whitespace-nowrap pb-[0.15em]">
                                        <ChordDisplay
                                          chord={segment.chord}
                                          sizeClass={`font-mono ${fontPreset.chord}`}
                                        />
                                      </span>
                                    </span>
                                  )}
                                  {segment.lyric}
                                </React.Fragment>
                              ))}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </details>
            );
          })}
        </div>
      </main>
      <div
        className="ensayo-footer-shell fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/96 pb-[calc(env(safe-area-inset-bottom)+0.7rem)] pt-2.5 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-950/96"
        style={{
          paddingLeft: 'calc(env(safe-area-inset-left) + 0.3rem)',
          paddingRight: 'calc(env(safe-area-inset-right) + 0.3rem)',
        }}
      >
        {showPlaybackOptions && (
          <div ref={playbackOptionsRef} className="mx-auto mb-2 max-w-5xl px-4">
            <div className="rounded-[1.1rem] border border-zinc-200/85 bg-white/96 px-3 py-3 shadow-[0_14px_34px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/96">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[0.66rem] font-black uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">
                  Fuentes de reproduccion
                </p>
                <span className="truncate text-[0.72rem] font-semibold text-zinc-500 dark:text-zinc-400">
                  {activePlaybackSource?.label || 'Sin audio'}
                </span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {playbackSources.map((source) => {
                  const active = source.id === selectedPlaybackSourceId;
                  return (
                    <button
                      key={`playback-source-${source.id}`}
                      type="button"
                      onClick={() => handleSelectPlaybackSource(source.id)}
                      className={`shrink-0 rounded-full border px-3.5 py-2 text-sm font-bold transition-colors ${
                        active
                          ? 'border-brand bg-brand text-white shadow-[0_8px_18px_rgba(59,130,246,0.24)]'
                          : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800'
                      }`}
                      aria-pressed={active}
                    >
                      {source.label}
                    </button>
                  );
                })}
                {!hasSequenceSources && (
                  <div className="shrink-0 rounded-full border border-dashed border-zinc-300 bg-zinc-50 px-3.5 py-2 text-sm font-semibold text-zinc-500 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-400">
                    Secuencia no disponible
                  </div>
                )}
              </div>
              {hasAudio && (
                <div className="mt-4 border-t border-zinc-200/60 pt-3 dark:border-white/10">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-[0.66rem] font-black uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">
                      Ruteo de Salida (Split Track)
                    </p>
                  </div>
                  <div className="flex gap-2 rounded-xl bg-zinc-50 p-1 dark:bg-zinc-950/50">
                    <button
                      type="button"
                      onClick={() => setPanValue(-1)}
                      className={`flex-1 rounded-lg py-2 text-xs font-bold transition-all ${panValue === -1 ? 'bg-white text-brand shadow-sm dark:bg-zinc-800 dark:text-brand' : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'}`}
                    >
                      Izquierda (Click)
                    </button>
                    <button
                      type="button"
                      onClick={() => setPanValue(0)}
                      className={`flex-1 rounded-lg py-2 text-xs font-bold transition-all ${panValue === 0 ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'}`}
                    >
                      Estéreo
                    </button>
                    <button
                      type="button"
                      onClick={() => setPanValue(1)}
                      className={`flex-1 rounded-lg py-2 text-xs font-bold transition-all ${panValue === 1 ? 'bg-white text-brand shadow-sm dark:bg-zinc-800 dark:text-brand' : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'}`}
                    >
                      Derecha (Pistas)
                    </button>
                  </div>
                </div>
              )}
              {activePadUrl && (
                <div className="mt-4 border-t border-zinc-200/60 pt-3 dark:border-white/10">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-[0.66rem] font-black uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">
                      Pad Ambiental ({currentSongDisplayKey})
                    </p>
                    <button
                      type="button"
                      onClick={() => setIsPadActive(!isPadActive)}
                      className={`rounded-full px-3 py-1 text-xs font-bold transition-all ${
                        isPadActive
                          ? 'bg-brand text-white shadow-sm'
                          : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
                      }`}
                    >
                      {isPadActive ? 'Pad ON' : 'Pad OFF'}
                    </button>
                  </div>
                  {isPadActive && (
                    <div className="flex items-center gap-3 rounded-xl bg-zinc-50 px-3 py-2 dark:bg-zinc-950/50">
                      <span className="text-xs font-bold text-zinc-400">Vol</span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={padVolume}
                        onChange={(e) => setPadVolume(parseFloat(e.target.value))}
                        className="ensayo-seek h-4 flex-1 cursor-pointer appearance-none bg-transparent"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        <div className="ensayo-footer-row mx-auto flex max-w-5xl items-center gap-3 px-4">
          <button
            type="button"
            onClick={handleTogglePlayback}
            disabled={!hasAudio}
            className={`ensayo-footer-play flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg transition-transform active:scale-95 ${hasAudio ? 'bg-action' : 'bg-zinc-500/50 cursor-not-allowed shadow-none'}`}
            aria-label={isPlaying ? 'Pausar ensayo' : 'Reproducir ensayo'}
          >
            {isPlaying ? <Pause className="h-4.5 w-4.5" /> : <Play className="ml-0.5 h-4.5 w-4.5" />}
          </button>
          <div className="ensayo-footer-timeline min-w-0 flex-1">
            <div className="ensayo-footer-meta mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
              <span>{formatSeconds(audioCurrentTime)}</span>
              <span>{currentSections[activeSectionIndex]?.name || 'Secci\u00F3n'}</span>
              <span>{durationLabel}</span>
            </div>
            <div className="relative pt-1">
              <div className="pointer-events-none absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-zinc-300/75 dark:bg-white/10" />
              <div className="pointer-events-none absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-action" style={{ width: `${progressPercent}%` }} />
              <input
                type="range"
                min="0"
                max={timelineDuration}
                step="0.1"
                value={Math.min(audioCurrentTime, timelineDuration)}
                onChange={handleSeekChange}
                disabled={!hasAudio || !audioReady}
                className="ensayo-seek relative z-10 h-5 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed"
                aria-label="Posici\u00F3n de reproducci\u00F3n"
              />
            </div>
            {playbackSectionStrip.length > 0 && (
              <div className="ensayo-playback-strip relative mt-2 h-3">
                {playbackSectionStrip.map((item) => (
                  <button
                    key={`footer-section-${item.index}`}
                    type="button"
                    onClick={() => selectSection(item.index, { seekAudio: true, scrollBehavior: 'smooth' })}
                    className="absolute top-0 h-2 rounded-full border transition-all"
                    style={{
                      left: `${item.startPercent}%`,
                      width: `${item.widthPercent}%`,
                      borderColor: item.isActive ? toRgba(item.visual.rgb, 0.9) : toRgba(item.visual.rgb, 0.26),
                      backgroundColor: item.isActive ? toRgba(item.visual.rgb, 0.96) : 'rgba(228,228,231,0.95)',
                      boxShadow: item.isActive ? `0 0 0 1px ${toRgba(item.visual.rgb, 0.2)}` : 'none',
                    }}
                    title={`${item.section.name}${item.marker ? ` \u00B7 ${formatSeconds(item.marker.startSec)}` : ''}`}
                    aria-label={`Ir a ${item.section.name}`}
                  />
                ))}
              </div>
            )}
            {!hasAudio && (
              <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                Esta canci\u00F3n todav\u00EDa no tiene MP3 cargado.
              </p>
            )}
          </div>
          <div className="ensayo-footer-actions flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setLoopState((prev) => ((prev + 1) % 3))}
              className={`ensayo-footer-icon relative flex h-10 w-10 items-center justify-center rounded-2xl border transition-colors ${
                loopState
                  ? 'border-brand/35 bg-brand/10 text-brand'
                  : 'border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'
              }`}
              aria-label={loopState === 0 ? 'Loop apagado' : loopState === 1 ? 'Repetir todo' : 'Repetir seccion'}
              title={loopState === 0 ? 'Loop apagado' : loopState === 1 ? 'Repetir todo' : 'Repetir seccion'}
            >
              {loopState === 1 ? <Repeat1 className="h-4.5 w-4.5" /> : <Repeat className="h-4.5 w-4.5" />}
              {loopState === 2 && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand text-[9px] font-black text-white">
                  S
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setShowPlaybackOptions((prev) => !prev)}
              className={`ensayo-footer-icon flex h-10 w-10 items-center justify-center rounded-2xl border transition-colors ${
                showPlaybackOptions
                  ? 'border-brand/35 bg-brand/10 text-brand'
                  : 'border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'
              }`}
              aria-label="Abrir fuentes de reproduccion"
              title="Fuentes de reproduccion"
              aria-expanded={showPlaybackOptions}
            >
              <SlidersHorizontal className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>
      </div>
      <style>{`
        .ensayo-seek::-webkit-slider-runnable-track {
          height: 3px;
          background: transparent;
        }
        .ensayo-seek::-moz-range-track {
          height: 3px;
          background: transparent;
        }
        .ensayo-seek::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 3px;
          height: 18px;
          border-radius: 999px;
          background: rgb(var(--color-action));
          border: 0;
          margin-top: -7px;
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
        }
        .ensayo-seek::-moz-range-thumb {
          width: 3px;
          height: 18px;
          border-radius: 999px;
          background: rgb(var(--color-action));
          border: 0;
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
        }
        .ensayo-chord-token {
          color: rgb(var(--color-brand));
          text-rendering: geometricPrecision;
        }
        .ensayo-chord-root {
          display: inline-block;
        }
        .ensayo-chord-suffix {
          position: relative;
          top: -0.34em;
          margin-left: 0.02em;
          font-size: 0.72em;
          font-weight: 900;
          letter-spacing: -0.03em;
          vertical-align: baseline;
        }
        .ensayo-chord-bass {
          margin-left: 0.05em;
          white-space: nowrap;
        }
        .ensayo-chord-bass-divider {
          margin-right: 0.02em;
        }
        .dark .ensayo-chord-token {
          color: rgb(var(--color-brand));
          text-shadow: 0 0 12px rgba(var(--color-brand), 0.15);
        }
        .ensayo-header-slot {
          --header-mask-step: 2.25rem;
          height: var(--header-mask-step);
        }
        .ensayo-header-line {
          height: var(--header-mask-step);
        }
        .ensayo-header-title {
          font-size: 1.55rem;
          line-height: 1;
        }
        .ensayo-header-artist {
          font-size: 1.1rem;
          line-height: 1;
        }
        @keyframes ensayo-bpm-pulse {
          0% {
            transform: scale(1);
            background-color: rgba(255, 255, 255, 0.98);
            box-shadow: 0 1px 2px rgba(24, 24, 27, 0.08);
          }
          45% {
            transform: scale(1.04);
            background-color: rgba(16, 185, 129, 0.16);
            border-color: rgba(16, 185, 129, 0.55);
            box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.12), 0 0 14px rgba(16, 185, 129, 0.14);
          }
          100% {
            transform: scale(1);
            background-color: rgba(255, 255, 255, 0.98);
            box-shadow: 0 1px 2px rgba(24, 24, 27, 0.08);
          }
        }
        .ensayo-bpm-chip.beat-active {
          animation: ensayo-bpm-pulse var(--bpm-duration, 1s) infinite;
        }
        .dark .ensayo-bpm-chip.beat-active {
          background-color: rgba(24, 24, 27, 0.98);
        }
        .ensayo-header-mask {
          animation: ensayo-header-rotate 8.4s infinite ease-in-out;
          will-change: transform;
        }
        @keyframes ensayo-header-rotate {
          0%,
          34% {
            transform: translateY(0);
          }
          40%,
          72% {
            transform: translateY(calc(var(--header-mask-step, 2.25rem) * -1));
          }
          78%,
          100% {
            transform: translateY(calc(var(--header-mask-step, 2.25rem) * -2));
          }
        }
        @media (orientation: landscape) and (max-height: 540px) {
          .ensayo-header-top {
            gap: 0.55rem;
            padding-top: calc(env(safe-area-inset-top) + 0.3rem);
            padding-bottom: 0.1rem;
          }
          .ensayo-header-slot {
            --header-mask-step: 1.75rem;
          }
          .ensayo-header-title {
            font-size: 1.05rem;
          }
          .ensayo-header-artist {
            font-size: 0.82rem;
          }
          .ensayo-control-chip,
          .ensayo-header-top > button {
            width: 2.35rem;
            height: 2.35rem;
            border-radius: 0.95rem;
          }
          .ensayo-control-chip {
            font-size: 0.88rem;
          }
          .ensayo-section-map {
            padding-bottom: 0.2rem;
          }
          .ensayo-section-chip {
            min-width: 2rem !important;
            height: 2rem !important;
            font-size: 0.64rem !important;
          }
          .ensayo-sections-layout {
            columns: 2;
            column-gap: 0.85rem;
          }
          .ensayo-main-scroll {
            padding-bottom: 5.15rem !important;
          }
          .ensayo-footer-shell {
            padding-top: 0.35rem;
            padding-bottom: calc(env(safe-area-inset-bottom) + 0.35rem);
          }
          .ensayo-footer-row {
            gap: 0.55rem;
            align-items: flex-end;
          }
          .ensayo-footer-play,
          .ensayo-footer-icon {
            width: 2.7rem;
            height: 2.7rem;
            border-radius: 1rem;
          }
          .ensayo-footer-meta {
            margin-bottom: 0.35rem;
            font-size: 0.52rem;
            letter-spacing: 0.16em;
          }
          .ensayo-footer-timeline .ensayo-seek {
            height: 0.95rem;
          }
          .ensayo-playback-strip {
            margin-top: 0.35rem;
            height: 0.5rem;
          }
          .ensayo-playback-strip button {
            height: 0.45rem;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .ensayo-header-mask,
          .ensayo-bpm-chip.beat-active {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
