import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, Minus, Pause, Play, Plus, Type } from 'lucide-react';

const FONT_PRESETS = {
  compacta: {
    section: 'text-[0.64rem] sm:text-[0.68rem] tracking-[0.26em]',
    chord: 'text-[0.8rem] sm:text-[0.85rem]',
    lyric: 'text-[0.94rem] sm:text-[0.98rem]',
    lineGap: 'gap-y-0.5',
  },
  normal: {
    section: 'text-[0.68rem] sm:text-[0.72rem] tracking-[0.28em]',
    chord: 'text-[0.84rem] sm:text-[0.9rem]',
    lyric: 'text-[0.98rem] sm:text-[1.04rem]',
    lineGap: 'gap-y-1',
  },
  grande: {
    section: 'text-[0.78rem] sm:text-[0.82rem] tracking-[0.3em]',
    chord: 'text-[0.96rem] sm:text-[1rem]',
    lyric: 'text-[1.1rem] sm:text-[1.18rem]',
    lineGap: 'gap-y-1.5',
  },
};

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

const normalizeKeyToAmerican = (rawKey = '') => {
  const source = String(rawKey || '').trim();
  if (!source) return '-';

  const normalizedSource = source
    .replace(/♯/g, '#')
    .replace(/♭/g, 'b')
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
}) {
  if (!song) return null;

  const [headerHidden, setHeaderHidden] = useState(false);
  const [fontScale, setFontScale] = useState('normal');
  const [showViewSettings, setShowViewSettings] = useState(false);
  const [showKeyMenu, setShowKeyMenu] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeSectionManualIndex, setActiveSectionManualIndex] = useState(0);
  const [collapsedSections, setCollapsedSections] = useState({});
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioReady, setAudioReady] = useState(false);
  const [transposeSteps, setTransposeSteps] = useState(0);
  const [isMetronomeOn, setIsMetronomeOn] = useState(false);

  const audioRef = useRef(null);
  const scrollRef = useRef(null);
  const lastScrollTop = useRef(0);
  const sectionRefs = useRef([]);
  const metronomeIntervalRef = useRef(null);
  const metronomeAudioCtxRef = useRef(null);
  const currentSong = song;
  const activeSongIndex = 0;
  const currentSongBpm = Number.isFinite(Number(currentSong?.bpm)) ? Math.max(0, Math.round(Number(currentSong.bpm))) : 0;
  const originalSongKey = normalizeKeyToAmerican(currentSong?.originalKey || currentSong?.key || '-');
  const currentSongDisplayKey = useMemo(() => transposeChordToken(originalSongKey, transposeSteps), [originalSongKey, transposeSteps]);
  const transposeKeyOptions = useMemo(() => (
    TRANSPOSE_OPTIONS.map((value) => ({
      value,
      keyLabel: transposeChordToken(originalSongKey, value),
      isBase: value === 0,
    }))
  ), [originalSongKey]);
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
  const fontPreset = FONT_PRESETS[fontScale] || FONT_PRESETS.normal;
  const currentSongKey = String(currentSong?.id || 'demo');
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
  const hasAudio = typeof currentSong?.mp3 === 'string' && currentSong.mp3.trim() !== '';
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
        startPercent: (safeStart / timelineDuration) * 100,
        widthPercent: Math.max(2.8, ((safeEnd - safeStart) / timelineDuration) * 100),
      };
    })
  ), [activeSectionIndex, currentSections, markerBySectionIndex, sectionMapItems, timelineDuration]);

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
    setShowKeyMenu(false);
    stopMetronome();
  }, [currentSongKey, currentSong?.mp3, stopMetronome]);

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

      if (currentTop > lastScrollTop.current + 8 && currentTop > 24) {
        setHeaderHidden(true);
      } else if (currentTop < lastScrollTop.current - 8 || currentTop < 12) {
        setHeaderHidden(false);
      }
      lastScrollTop.current = currentTop;

      let nextSectionIndex = 0;
      sectionRefs.current.forEach((node, index) => {
        if (!node) return;
        if (node.offsetTop - 110 <= currentTop) {
          nextSectionIndex = index;
        }
      });

      setActiveSectionManualIndex((prev) => (prev === nextSectionIndex ? prev : nextSectionIndex));
    };

    scroller.addEventListener('scroll', handleScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', handleScroll);
  }, [currentSections.length]);

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
    const targetTop = scroller.scrollTop + (nodeRect.top - scrollerRect.top) - 104;
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

  const cycleFontScale = (direction) => {
    const order = ['compacta', 'normal', 'grande'];
    const currentIndex = order.indexOf(fontScale);
    const nextIndex = Math.min(order.length - 1, Math.max(0, currentIndex + direction));
    setFontScale(order[nextIndex]);
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
  }, [currentSong?.mp3, hasAudio]);

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
        audioRef.current.currentTime = marker.startSec;
        setAudioCurrentTime(marker.startSec);
      }
    }

    window.requestAnimationFrame(() => {
      scrollToSectionIndex(index, scrollBehavior);
    });
  };

  const toggleSectionCollapsed = (index) => {
    setCollapsedSections((prev) => {
      const songState = prev[currentSongKey] || {};
      const currentValue = songState[index] ?? false;
      return {
        ...prev,
        [currentSongKey]: {
          ...songState,
          [index]: !currentValue,
        },
      };
    });
  };

  const sectionStateForSong = collapsedSections[currentSongKey] || {};

  const handleTogglePlayback = async () => {
    if (!audioRef.current || !hasAudio) return;

    try {
      if (audioRef.current.paused) {
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

  return (
    <div className="h-screen w-full flex flex-col bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <audio
        key={`${currentSongKey}-${currentSong?.mp3 || 'no-audio'}`}
        ref={audioRef}
        src={hasAudio ? currentSong.mp3 : undefined}
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
        onEnded={() => {
          setIsPlaying(false);
          const finalTime = Number.isFinite(audioRef.current?.duration) ? audioRef.current.duration : 0;
          setAudioCurrentTime(finalTime || 0);
        }}
        onError={() => {
          setAudioReady(false);
          setAudioDuration(0);
        }}
      />
      <header
        className={`sticky top-0 z-30 border-b border-zinc-200/70 bg-white/92 backdrop-blur-xl dark:border-white/8 dark:bg-zinc-950/96 transition-transform duration-300 ${
          headerHidden ? '-translate-y-full' : 'translate-y-0'
        }`}
      >
        <div className="flex items-center justify-between gap-3 px-3 pb-1 pt-[calc(env(safe-area-inset-top)+0.45rem)]">
            <button
              type="button"
              onClick={handleGoBack}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-900 shadow-sm transition-colors hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
              aria-label="Volver"
            >
            <ArrowLeft className="h-4.5 w-4.5" />
          </button>

          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">
              {currentSong.artist}{hasAudio ? ' · MP3' : ''}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleToggleMetronome}
              disabled={!currentSongBpm}
              className={`ensayo-bpm-chip relative inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl border bg-white text-zinc-900 shadow-sm transition-colors dark:bg-zinc-900 dark:text-zinc-50 ${
                currentSongBpm
                  ? 'border-zinc-200 hover:bg-zinc-100 dark:border-white/10 dark:hover:bg-zinc-800'
                  : 'cursor-not-allowed border-zinc-200/70 text-zinc-400 dark:border-white/10 dark:text-zinc-500'
              } ${isMetronomeOn ? 'beat-active' : ''}`}
              style={isMetronomeOn && currentSongBpm ? { '--bpm-duration': `${60 / currentSongBpm}s` } : undefined}
              aria-label={isMetronomeOn ? `Detener metrónomo ${currentSongBpm} BPM` : `Activar metrónomo ${currentSongBpm || 0} BPM`}
              title={currentSongBpm ? `${currentSongBpm} BPM` : 'Sin BPM'}
            >
              <span className={`relative z-[1] font-black leading-none ${String(currentSongBpm || '--').length > 2 ? 'text-[11px]' : 'text-sm'}`}>
                {currentSongBpm || '--'}
              </span>
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowKeyMenu((prev) => !prev)}
                className="inline-flex h-10 min-w-[3.2rem] items-center justify-center gap-1 rounded-2xl border border-zinc-200 bg-white px-2.5 text-sm font-bold text-zinc-900 shadow-sm transition-colors hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
                aria-label="Cambiar tonalidad"
              >
                <span>{currentSongDisplayKey}</span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showKeyMenu ? 'rotate-180' : ''}`} />
              </button>

              {showKeyMenu && (
                <div className="absolute right-0 mt-2 w-[208px] rounded-2xl border border-zinc-200 bg-white/98 p-2 shadow-2xl dark:border-white/10 dark:bg-zinc-950/95">
                  <p className="px-2 pb-2 text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
                    Tonalidad
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {transposeKeyOptions.map((option) => {
                      const active = option.value === transposeSteps;
                      return (
                        <button
                          key={`transpose-${option.value}`}
                          type="button"
                          onClick={() => {
                            setTransposeSteps(option.value);
                            setShowKeyMenu(false);
                          }}
                          className={`flex h-10 items-center justify-center rounded-xl border text-[11px] font-bold uppercase transition-colors ${
                            active
                              ? 'border-brand/35 bg-brand/10 text-brand'
                              : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800'
                          }`}
                          title={option.isBase ? 'Tonalidad base original' : `Mover a ${option.keyLabel}`}
                        >
                          {option.keyLabel}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="relative">
            <button
              type="button"
              onClick={() => setShowViewSettings((prev) => !prev)}
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-900 shadow-sm transition-colors hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
              aria-label="Ajustes de vista"
            >
              <Type className="h-4.5 w-4.5" />
            </button>

            {showViewSettings && (
              <div className="absolute right-0 mt-2 w-[164px] rounded-2xl border border-zinc-200 bg-white/98 p-2 shadow-2xl dark:border-white/10 dark:bg-zinc-950/95">
                <p className="px-2 pb-2 text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
                  Tamaño
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => cycleFontScale(-1)}
                    className="flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50"
                    aria-label="Reducir texto"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <div className="flex h-10 items-center justify-center rounded-xl border border-brand/30 bg-brand/10 text-xs font-bold uppercase text-brand">
                    {fontScale}
                  </div>
                  <button
                    type="button"
                    onClick={() => cycleFontScale(1)}
                    className="flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50"
                    aria-label="Aumentar texto"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
            </div>
          </div>
        </div>

        <div className="px-3 pb-2">
          <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {currentSections.map((section, index) => {
              const active = index === activeSectionIndex;
              const visual = sectionMapItems[index] || SECTION_VISUALS.default;
              return (
                <button
                  key={`${currentSong.id || 'song'}-${section.name}-${index}`}
                  type="button"
                  onClick={() => selectSection(index, { seekAudio: true, scrollBehavior: 'smooth' })}
                  className="shrink-0 rounded-full border text-[11px] font-black uppercase tracking-[0.02em] transition-all"
                  style={{
                    minWidth: '2.45rem',
                    height: '2.45rem',
                    borderColor: toRgba(visual.rgb, active ? 0.92 : 0.5),
                    color: toRgba(visual.rgb, active ? 1 : 0.94),
                    backgroundColor: active ? toRgba(visual.rgb, 0.14) : 'rgba(255,255,255,0.92)',
                    boxShadow: active ? `0 0 0 4px ${toRgba(visual.rgb, 0.15)}` : 'none',
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

      <main ref={scrollRef} className="flex-grow overflow-y-auto px-3 pb-24 pt-2 sm:px-4">
        <div className="mx-auto max-w-6xl columns-1 gap-3 xl:columns-2 xl:gap-4">
          {currentSections.map((section, sectionIndex) => {
            const isCollapsed = sectionStateForSong[sectionIndex] ?? false;
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
                className={`relative mb-3 inline-block w-full break-inside-avoid-column self-start overflow-visible rounded-[1.2rem] border border-zinc-200/90 px-3 pb-2 pt-3.5 shadow-sm transition-all xl:mb-4 dark:border-white/10 ${
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
                  if (event.target.closest('[data-collapse-toggle="true"]')) return;
                  if (event.target.closest('summary')) return;
                  selectSection(sectionIndex, { seekAudio: true, scrollBehavior: 'smooth' });
                }}
              >
                <summary
                  className="absolute inset-x-3 -top-[0.78rem] z-10 flex cursor-pointer list-none items-center justify-between gap-2 text-left marker:hidden [&::-webkit-details-marker]:hidden"
                  aria-expanded={!isCollapsed}
                  onClick={(event) => {
                    if (event.target.closest('[data-collapse-toggle="true"]')) {
                      event.preventDefault();
                      return;
                    }
                    event.preventDefault();
                    selectSection(sectionIndex, { seekAudio: true, scrollBehavior: 'smooth' });
                  }}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full pr-3" style={headerBgStyle}>
                    <span
                      className="flex h-6 min-w-6 items-center justify-center rounded-full border px-1.5 text-[10px] font-black uppercase shadow-sm dark:bg-zinc-950"
                      style={{
                        borderColor: toRgba(visual.rgb, isActiveSection ? 0.62 : 0.42),
                        backgroundColor: isActiveSection ? toRgba(visual.rgb, 0.12) : 'rgba(255,255,255,0.96)',
                        color: toRgba(visual.rgb, 1),
                      }}
                    >
                      {visual.shortLabel}
                    </span>
                    <div className="flex min-w-0 flex-1 items-center">
                      <h2
                        className={`shrink-0 px-1.5 font-black uppercase ${isActiveSection ? '' : 'bg-white dark:bg-zinc-950'} ${fontPreset.section}`}
                        style={{
                          color: toRgba(visual.rgb, 1),
                          backgroundColor: isActiveSection ? toRgba(visual.rgb, 0.1) : undefined,
                        }}
                      >
                        {section.name}
                      </h2>
                    </div>
                  </div>
                  <div className="flex min-w-0 items-center gap-2 rounded-full pl-2" style={headerBgStyle}>
                    {section.note && (
                      <span
                        className={`max-w-[10rem] truncate rounded-full bg-white px-2 py-[0.18rem] text-[10px] font-medium tracking-[0.08em] dark:bg-zinc-950 ${
                          isActiveSection ? '' : 'text-zinc-400 dark:text-zinc-500'
                        }`}
                        style={isActiveSection ? { color: toRgba(visual.rgb, 0.92) } : undefined}
                      >
                        {section.note}
                      </span>
                    )}
                    <button
                      type="button"
                      data-collapse-toggle="true"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        toggleSectionCollapsed(sectionIndex);
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-300"
                      aria-label={isCollapsed ? `Expandir ${section.name}` : `Colapsar ${section.name}`}
                    >
                      {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                    </button>
                  </div>
                </summary>

                {!isCollapsed && (
                  <div
                    className="space-y-0.5 pt-0.5"
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
                                <span
                                  key={`${section.name}-${lineIndex}-chord-${chordIndex}`}
                                  className={`font-mono font-black leading-none text-brand ${fontPreset.chord}`}
                                >
                                  {chord}
                                </span>
                              ))}
                            </div>
                          )}

                          {renderedLine.mode === 'segments' && (
                            <p className={`leading-[1.12] text-zinc-900 dark:text-zinc-50 ${fontPreset.lyric}`}>
                              {renderedLine.segments.map((segment, segmentIndex) => {
                                const lyricValue =
                                  segment.lyric && segment.lyric.length > 0 ? segment.lyric : '\u200A';

                                return (
                                  <span
                                    key={`${section.name}-${lineIndex}-segment-${segmentIndex}`}
                                    className="relative inline-block align-top whitespace-pre pt-[1.05em]"
                                  >
                                    {segment.chord ? (
                                      <span
                                        className={`pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 whitespace-nowrap font-mono font-black leading-none text-brand ${fontPreset.chord}`}
                                      >
                                        {segment.chord}
                                      </span>
                                    ) : null}
                                    <span className="block">{lyricValue}</span>
                                  </span>
                                );
                              })}
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

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/96 pb-[calc(env(safe-area-inset-bottom)+0.7rem)] pt-2.5 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-950/96">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4">
          <button
            type="button"
            onClick={handleTogglePlayback}
            disabled={!hasAudio}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg transition-transform active:scale-95 ${hasAudio ? 'bg-action' : 'bg-zinc-500/50 cursor-not-allowed shadow-none'}`}
            aria-label={isPlaying ? 'Pausar ensayo' : 'Reproducir ensayo'}
          >
            {isPlaying ? <Pause className="h-4.5 w-4.5" /> : <Play className="ml-0.5 h-4.5 w-4.5" />}
          </button>

          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
              <span>{formatSeconds(audioCurrentTime)}</span>
              <span>{currentSections[activeSectionIndex]?.name || 'Sección'}</span>
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
                aria-label="Posición de reproducción"
              />
            </div>
            {playbackSectionStrip.length > 0 && (
              <div className="relative mt-2 h-3">
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
                    title={`${item.section.name}${item.marker ? ` · ${formatSeconds(item.marker.startSec)}` : ''}`}
                    aria-label={`Ir a ${item.section.name}`}
                  />
                ))}
              </div>
            )}
            {!hasAudio && (
              <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                Esta canción todavía no tiene MP3 cargado.
              </p>
            )}
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
      `}</style>
    </div>
  );
}
