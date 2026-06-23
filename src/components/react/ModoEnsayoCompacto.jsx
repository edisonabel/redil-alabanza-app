import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Pause, Play, Radio, RadioReceiver, Repeat, Repeat1, SlidersHorizontal, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { audioSessionService } from '../../services/AudioSessionService';
import { metronomeService } from '../../services/MetronomeEngine';
import { screenWakeLockService } from '../../services/ScreenWakeLockService';
import { useMultitrackEngine } from '../../hooks/useMultitrackEngine';
import { isLikelyAudioSourceUrl, resolveFetchableAudioUrl, resolvePreferredAudioUrl } from '../../lib/audio-playback.js';
import { buildWordGroups, parseChordProLine } from '../../utils/chordProLineUtils';
import { normalizePersistedLiveDirectorSession } from '../../utils/liveDirectorSongSession';
import {
  REHEARSAL_PERSONAL_SETTINGS_TOAST_MS,
  formatRehearsalSongSettingsSummary,
  hasPersonalRehearsalSongSettings,
  loadRehearsalSongSettings,
  sanitizeRehearsalSongSettings,
  saveRehearsalSongSettings,
} from '../../utils/rehearsalUserSongSettings';
import {
  buildSectionShortLabel,
  getSectionKind,
  normalizeSectionLabel,
  SECTION_VISUALS,
  toRgba,
} from '../../utils/sectionVisuals';
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
const CAPO_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7];
const OPEN_SHAPE_ROOTS = new Set(['C', 'D', 'E', 'G', 'A']);
const OPEN_MINOR_ROOTS = new Set(['A', 'D', 'E']);
const GUITAR_TUNING = ['E', 'A', 'D', 'G', 'B', 'E'];
const PIANO_WHITE_NOTES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NOTE_INDEX = SHARP_NOTES.reduce((acc, note, index) => {
  acc[note] = index;
  return acc;
}, {});
const CHORD_QUALITY_INTERVALS = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  dom7: [0, 4, 7, 10],
  dom9: [0, 4, 7, 10, 14],
  maj7: [0, 4, 7, 11],
  maj9: [0, 4, 7, 11, 14],
  min7: [0, 3, 7, 10],
  min9: [0, 3, 7, 10, 14],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  add9: [0, 4, 7, 14],
  power: [0, 7],
};
const OPEN_GUITAR_SHAPES = {
  A: { label: 'Abierto', frets: ['x', 0, 2, 2, 2, 0], fingers: ['', '', '1', '2', '3', ''] },
  Am: { label: 'Abierto', frets: ['x', 0, 2, 2, 1, 0], fingers: ['', '', '2', '3', '1', ''] },
  A7: { label: 'Abierto', frets: ['x', 0, 2, 0, 2, 0], fingers: ['', '', '2', '', '3', ''] },
  Am7: { label: 'Abierto', frets: ['x', 0, 2, 0, 1, 0], fingers: ['', '', '2', '', '1', ''] },
  Asus2: { label: 'Abierto', frets: ['x', 0, 2, 2, 0, 0], fingers: ['', '', '1', '2', '', ''] },
  Asus4: { label: 'Abierto', frets: ['x', 0, 2, 2, 3, 0], fingers: ['', '', '1', '2', '3', ''] },
  B: { label: 'Cejilla A', frets: ['x', 2, 4, 4, 4, 2], fingers: ['', '1', '3', '3', '3', '1'] },
  Bm: { label: 'Cejilla A', frets: ['x', 2, 4, 4, 3, 2], fingers: ['', '1', '3', '4', '2', '1'] },
  B7: { label: 'Abierto', frets: ['x', 2, 1, 2, 0, 2], fingers: ['', '2', '1', '3', '', '4'] },
  C: { label: 'Abierto', frets: ['x', 3, 2, 0, 1, 0], fingers: ['', '3', '2', '', '1', ''] },
  Cmaj7: { label: 'Abierto', frets: ['x', 3, 2, 0, 0, 0], fingers: ['', '3', '2', '', '', ''] },
  C7: { label: 'Abierto', frets: ['x', 3, 2, 3, 1, 0], fingers: ['', '3', '2', '4', '1', ''] },
  D: { label: 'Abierto', frets: ['x', 'x', 0, 2, 3, 2], fingers: ['', '', '', '1', '3', '2'] },
  Dm: { label: 'Abierto', frets: ['x', 'x', 0, 2, 3, 1], fingers: ['', '', '', '2', '3', '1'] },
  D7: { label: 'Abierto', frets: ['x', 'x', 0, 2, 1, 2], fingers: ['', '', '', '2', '1', '3'] },
  Dm7: { label: 'Abierto', frets: ['x', 'x', 0, 2, 1, 1], fingers: ['', '', '', '2', '1', '1'] },
  Dsus2: { label: 'Abierto', frets: ['x', 'x', 0, 2, 3, 0], fingers: ['', '', '', '1', '3', ''] },
  Dsus4: { label: 'Abierto', frets: ['x', 'x', 0, 2, 3, 3], fingers: ['', '', '', '1', '2', '3'] },
  E: { label: 'Abierto', frets: [0, 2, 2, 1, 0, 0], fingers: ['', '2', '3', '1', '', ''] },
  Em: { label: 'Abierto', frets: [0, 2, 2, 0, 0, 0], fingers: ['', '2', '3', '', '', ''] },
  E7: { label: 'Abierto', frets: [0, 2, 0, 1, 0, 0], fingers: ['', '2', '', '1', '', ''] },
  Em7: { label: 'Abierto', frets: [0, 2, 0, 0, 0, 0], fingers: ['', '2', '', '', '', ''] },
  Esus4: { label: 'Abierto', frets: [0, 2, 2, 2, 0, 0], fingers: ['', '1', '2', '3', '', ''] },
  F: { label: 'Cejilla E', frets: [1, 3, 3, 2, 1, 1], fingers: ['1', '3', '4', '2', '1', '1'] },
  Fm: { label: 'Cejilla E', frets: [1, 3, 3, 1, 1, 1], fingers: ['1', '3', '4', '1', '1', '1'] },
  G: { label: 'Abierto', frets: [3, 2, 0, 0, 0, 3], fingers: ['3', '2', '', '', '', '4'] },
  G7: { label: 'Abierto', frets: [3, 2, 0, 0, 0, 1], fingers: ['3', '2', '', '', '', '1'] },
};
const TRACK_DEFAULT_GAIN = 1;
const TRACK_DUCKED_GAIN = 0.38;
const TRACK_DUCK_IN_DURATION_MS = 3200;
const TRACK_DUCK_OUT_DURATION_MS = 4200;
const GUIDE_CUE_SYNC_TOLERANCE_SECONDS = 0.035;
const REHEARSAL_MIX_MAIN_TRACK_ID = 'rehearsal-main';
const REHEARSAL_MIX_GUIDE_TRACK_PREFIX = 'rehearsal-guide';
const REHEARSAL_MIX_STEM_BOOST_DB = 2;
const REHEARSAL_MIX_STEM_GAIN = 10 ** (REHEARSAL_MIX_STEM_BOOST_DB / 20);
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
const isAudioSourceUrl = (value = '') => {
  const source = String(value || '').trim();
  if (!source) return false;
  return isLikelyAudioSourceUrl(source);
};
const normalizeTrackSearchText = (value = '') => (
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
);
const isGuideCueTrack = (track = {}) => {
  const text = normalizeTrackSearchText([
    track.id,
    track.name,
    track.sourceFileName,
  ].filter(Boolean).join(' '));
  return /\b(click|clic|cue|cues|guide|guia|metro|metronomo|metronome|count|countin|count-in)\b/.test(text);
};
const getTrackAudioUrl = (track = {}) => (
  track.optimizedUrl || track.url || track.iosUrl || track.nativeUrl || ''
);
const getRehearsalMixMainOutputRoute = (panValue = 0) => {
  if (panValue === -1) return 'left';
  if (panValue === 1) return 'right';
  return 'stereo';
};
const getReadableTrackLabel = (trackName = '', index = 0) => {
  const rawName = String(trackName || '').trim();
  const text = normalizeTrackSearchText(rawName);
  const numbered = (base) => {
    const suffix = rawName.match(/\b(\d+)\b/)?.[1] || '';
    return suffix && !base.includes(suffix) ? `${base} ${suffix}` : base;
  };

  if (/\b(bass|bajo)\b/.test(text)) return 'Bajo';
  if (/\b(drums?|bateria|percusion|percu|kick|snare|toms?)\b/.test(text)) return 'Bateria';
  if (/\b(acoustic|acustica)\b/.test(text) && /\b(gtr|guitar|guitarra)\b/.test(text)) return 'Guitarra acustica';
  if (/\b(electric|electrica)\b/.test(text) && /\b(gtr|guitar|guitarra)\b/.test(text)) return numbered('Guitarra electrica');
  if (/\b(gtr|guitar|guitarra)\b/.test(text)) return numbered('Guitarra');
  if (/\b(piano|keys?|teclas|keyboard|synth|organ)\b/.test(text)) return 'Piano';
  if (/\b(strings?|cuerdas?|str)\b/.test(text)) return 'Cuerdas';
  if (/\b(brass|vientos?|horns?)\b/.test(text)) return 'Vientos';
  if (/\b(pad)\b/.test(text)) return 'Pad';
  if (/\b(sequence|secuencia|playback|tracks?|pistas?|mix|lr)\b/.test(text)) return 'Pista';

  return rawName || `Pista ${index + 1}`;
};
const getGuideCueLabel = (sources = []) => {
  const names = sources.map((source) => normalizeTrackSearchText(source.label)).join(' ');
  const hasGuide = /\b(guide|guia)\b/.test(names);
  const hasCues = /\b(cue|cues|click|clic|metro|metronomo|metronome|count)\b/.test(names);
  if (hasGuide && hasCues) return 'Guia / Cues';
  if (hasGuide) return 'Guia';
  if (hasCues) return 'Cues / Metro';
  return 'Guia';
};
const normalizePlaybackSourceEntry = (entry, index, fallbackKind = 'sequence') => {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const trimmedEntry = entry.trim();
    if (!isAudioSourceUrl(trimmedEntry)) return null;
    return {
      id: `${fallbackKind}-${index}-${trimmedEntry}`,
      label: fallbackKind === 'original' ? 'Musica original' : fallbackKind === 'stem' ? `Pista ${index + 1}` : `Secuencia ${index + 1}`,
      url: trimmedEntry,
      kind: fallbackKind,
    };
  }
  if (typeof entry === 'object') {
    const rawUrl = String(entry.url || entry.src || entry.href || entry.link || '').trim();
    if (!isAudioSourceUrl(rawUrl)) return null;
    const rawKind = String(entry.kind || entry.type || fallbackKind || 'sequence').trim().toLowerCase();
    const kind = rawKind === 'original' ? 'original' : rawKind === 'stem' ? 'stem' : 'sequence';
    const label = String(
      entry.label ||
      entry.name ||
      entry.title ||
      (kind === 'original' ? 'Musica original' : kind === 'stem' ? `Pista ${index + 1}` : `Secuencia ${index + 1}`)
    ).trim();
    return {
      id: String(entry.id || `${kind}-${index}-${rawUrl}`),
      label: label || (kind === 'original' ? 'Musica original' : kind === 'stem' ? `Pista ${index + 1}` : `Secuencia ${index + 1}`),
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
const getPersistedLiveDirectorSession = (song) => (
  normalizePersistedLiveDirectorSession(song?.multitrackSession || song?.multitrack_session || null, {
    songId: song?.id,
    songTitle: song?.title,
  })
);
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
  const liveDirectorSession = getPersistedLiveDirectorSession(song);
  if (Array.isArray(liveDirectorSession?.tracks)) {
    liveDirectorSession.tracks.forEach((track, index) => {
      if (isGuideCueTrack(track)) return;
      collectionCandidates.push({
        id: `stem-${track.id || index}`,
        label: getReadableTrackLabel(track.name, index),
        url: getTrackAudioUrl(track),
        kind: 'stem',
      });
    });
  }
  collectionCandidates.forEach((entry, index) => {
    pushSource(entry, index, 'sequence');
  });
  return sources;
};
const buildGuideCueSources = (song) => {
  const liveDirectorSession = getPersistedLiveDirectorSession(song);
  if (!Array.isArray(liveDirectorSession?.tracks)) return [];

  const seenUrls = new Set();
  return liveDirectorSession.tracks
    .filter((track) => isGuideCueTrack(track))
    .map((track, index) => {
      const url = getTrackAudioUrl(track);
      if (!isAudioSourceUrl(url) || seenUrls.has(url)) return null;
      seenUrls.add(url);
      return {
        id: `guide-${track.id || index}`,
        label: String(track.name || `Guia ${index + 1}`).trim(),
        url,
      };
    })
    .filter(Boolean);
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
function ClickableChordToken({
  chord,
  sizeClass = '',
  onChordPreview,
  className = '',
}) {
  const openPreview = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onChordPreview?.(chord, event.currentTarget);
  };

  return (
    <button
      type="button"
      data-chord-preview-trigger="true"
      onClick={openPreview}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'touch') {
          openPreview(event);
        }
      }}
      onMouseEnter={openPreview}
      onFocus={openPreview}
      className={`inline-flex rounded-md px-0.5 py-0.5 text-left leading-none transition-colors hover:bg-brand/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 ${className}`.trim()}
      aria-label={`Ver acorde ${formatChordAccidentals(chord)}`}
    >
      <ChordDisplay chord={chord} sizeClass={sizeClass} />
    </button>
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
const extractChordTokensFromSections = (sections = []) => {
  if (!Array.isArray(sections)) return [];
  return sections.flatMap((section) => (
    Array.isArray(section?.lines)
      ? section.lines.flatMap((line) => (
        parseChordProLine(line)
          .map((segment) => segment?.chord)
          .filter(Boolean)
      ))
      : []
  ));
};
const normalizeChordSymbol = (value = '') => (
  String(value || '')
    .trim()
    .replace(/\u266F/g, '#')
    .replace(/\u266D/g, 'b')
    .replace(/\s+/g, '')
);
const parseChordSymbol = (value = '') => {
  const source = normalizeChordSymbol(value);
  const match = source.match(/^([A-G])([#b]?)([^/]*?)(?:\/([A-G])([#b]?))?$/);
  if (!match) return null;
  const [, root, accidental = '', suffix = '', bassRoot = '', bassAccidental = ''] = match;
  const normalizedSuffix = String(suffix || '').toLowerCase();
  const hasValidSuffix = !normalizedSuffix || /^(m|min|maj|ma|sus|dim|aug|add|no|[-+\u00B0\u00F8]|\d|[#b(])/.test(normalizedSuffix);
  if (!hasValidSuffix) return null;
  return {
    source,
    root: normalizeChordRoot(root, accidental),
    suffix,
    bass: bassRoot ? normalizeChordRoot(bassRoot, bassAccidental) : '',
  };
};
const getChordQuality = (suffix = '') => {
  const normalized = String(suffix || '').toLowerCase();
  if (normalized.includes('sus4') || normalized === 'sus') return 'sus4';
  if (normalized.includes('sus2')) return 'sus2';
  if (normalized.includes('dim') || normalized.includes('\u00B0')) return 'dim';
  if (normalized.includes('aug') || normalized.includes('+')) return 'aug';
  if (normalized.includes('maj9') || normalized.includes('ma9') || normalized.includes('\u03949')) return 'maj9';
  if (normalized.includes('maj7') || normalized.includes('ma7') || normalized.includes('\u03947')) return 'maj7';
  if (normalized.includes('m9') || normalized.includes('min9') || normalized.includes('-9')) return 'min9';
  if (normalized.includes('m7') || normalized.includes('min7') || normalized.includes('-7')) return 'min7';
  if (normalized.includes('add9')) return 'add9';
  if (normalized.includes('9')) return 'dom9';
  if (normalized.includes('7')) return 'dom7';
  if (normalized === '5') return 'power';
  if (normalized.startsWith('m') || normalized.startsWith('min') || normalized.startsWith('-')) return 'minor';
  return 'major';
};
const getChordOpenShapeKey = (parsedChord) => {
  if (!parsedChord) return '';
  const quality = getChordQuality(parsedChord.suffix);
  if (quality === 'major') return parsedChord.root;
  if (quality === 'minor') return `${parsedChord.root}m`;
  if (quality === 'dom7') return `${parsedChord.root}7`;
  if (quality === 'maj7') return `${parsedChord.root}maj7`;
  if (quality === 'min7') return `${parsedChord.root}m7`;
  if (quality === 'sus2') return `${parsedChord.root}sus2`;
  if (quality === 'sus4') return `${parsedChord.root}sus4`;
  return `${parsedChord.root}${parsedChord.suffix}`;
};
const normalizeFrets = (frets = []) => {
  const numericFrets = frets.filter((fret) => Number.isFinite(Number(fret))).map(Number);
  const fretted = numericFrets.filter((fret) => fret > 0);
  if (fretted.length === 0) {
    return {
      baseFret: 0,
      maxVisibleFret: 4,
      relativeFrets: frets,
    };
  }
  const minFret = Math.min(...fretted);
  const maxFret = Math.max(...fretted);
  const baseFret = maxFret <= 4 ? 0 : minFret;
  return {
    baseFret,
    maxVisibleFret: Math.max(4, maxFret - baseFret + 1),
    relativeFrets: frets.map((fret) => (
      Number.isFinite(Number(fret)) && Number(fret) > 0 && baseFret > 0
        ? Number(fret) - baseFret + 1
        : fret
    )),
  };
};
const getBarreFretFromRoot = (root = '', stringRoot = 'E') => {
  const rootIndex = SHARP_NOTES.indexOf(root);
  const stringIndex = SHARP_NOTES.indexOf(stringRoot);
  if (rootIndex < 0 || stringIndex < 0) return 1;
  const fret = (rootIndex - stringIndex + 12) % 12;
  return fret === 0 ? 12 : fret;
};
const buildEBarreShape = (parsedChord) => {
  const quality = getChordQuality(parsedChord?.suffix);
  const fret = getBarreFretFromRoot(parsedChord?.root, 'E');
  const shapeMap = {
    major: [fret, fret + 2, fret + 2, fret + 1, fret, fret],
    minor: [fret, fret + 2, fret + 2, fret, fret, fret],
    dom7: [fret, fret + 2, fret, fret + 1, fret, fret],
    maj7: [fret, fret + 2, fret + 1, fret + 1, fret, fret],
    min7: [fret, fret + 2, fret, fret, fret, fret],
    sus4: [fret, fret + 2, fret + 2, fret + 2, fret, fret],
    sus2: [fret, fret + 2, fret + 2, fret, fret, fret],
    power: [fret, fret + 2, fret + 2, 'x', 'x', 'x'],
  };
  return {
    label: quality === 'power' ? 'Power' : 'Cejilla E',
    frets: shapeMap[quality] || shapeMap.major,
    fingers: ['1', '3', '4', '2', '1', '1'],
  };
};
const buildABarreShape = (parsedChord) => {
  const quality = getChordQuality(parsedChord?.suffix);
  const fret = getBarreFretFromRoot(parsedChord?.root, 'A');
  const shapeMap = {
    major: ['x', fret, fret + 2, fret + 2, fret + 2, fret],
    minor: ['x', fret, fret + 2, fret + 2, fret + 1, fret],
    dom7: ['x', fret, fret + 2, fret, fret + 2, fret],
    maj7: ['x', fret, fret + 2, fret + 1, fret + 2, fret],
    min7: ['x', fret, fret + 2, fret, fret + 1, fret],
    sus4: ['x', fret, fret + 2, fret + 2, fret + 3, fret],
    sus2: ['x', fret, fret + 2, fret + 2, fret, fret],
    power: ['x', fret, fret + 2, fret + 2, 'x', 'x'],
  };
  return {
    label: quality === 'power' ? 'Power A' : 'Cejilla A',
    frets: shapeMap[quality] || shapeMap.major,
    fingers: ['', '1', '3', '4', '4', '1'],
  };
};
const shapeSignature = (shape) => JSON.stringify(shape?.frets || []);
const buildGuitarVariations = (chord = '') => {
  const parsed = parseChordSymbol(chord);
  if (!parsed) return [];
  const candidates = [];
  const openShape = OPEN_GUITAR_SHAPES[getChordOpenShapeKey(parsed)];
  if (openShape) candidates.push(openShape);
  candidates.push(buildEBarreShape(parsed), buildABarreShape(parsed));
  const seen = new Set();
  return candidates
    .filter(Boolean)
    .filter((shape) => {
      const signature = shapeSignature(shape);
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    })
    .slice(0, 4);
};
const getChordNoteNames = (chord = '') => {
  const parsed = parseChordSymbol(chord);
  if (!parsed) return [];
  const rootIndex = NOTE_INDEX[parsed.root];
  if (rootIndex < 0) return [];
  const intervals = CHORD_QUALITY_INTERVALS[getChordQuality(parsed.suffix)] || CHORD_QUALITY_INTERVALS.major;
  return intervals.map((interval) => SHARP_NOTES[(rootIndex + interval) % 12]);
};
const midiToNoteName = (midi = 60) => (
  SHARP_NOTES[((Number(midi) % 12) + 12) % 12]
);
const noteToMidi = (note = 'C', octave = 4) => {
  const noteIndex = NOTE_INDEX[note];
  if (!Number.isFinite(noteIndex)) return 60;
  return (Number(octave) + 1) * 12 + noteIndex;
};
const getRootMidi = (root = 'C') => {
  const noteIndex = NOTE_INDEX[root];
  if (!Number.isFinite(noteIndex)) return 60;
  return noteToMidi(root, noteIndex >= NOTE_INDEX.A ? 3 : 4);
};
const buildPianoVoicing = (chord = '', rotation = 0) => {
  const parsed = parseChordSymbol(chord);
  if (!parsed) return { midiNotes: [], noteNames: [] };
  const rootMidi = getRootMidi(parsed.root);
  const intervals = CHORD_QUALITY_INTERVALS[getChordQuality(parsed.suffix)] || CHORD_QUALITY_INTERVALS.major;
  const chordTones = intervals.map((interval) => rootMidi + interval);
  const safeRotation = Math.max(0, Math.min(Number(rotation) || 0, Math.max(chordTones.length - 1, 0)));
  const rotatedTones = [
    ...chordTones.slice(safeRotation),
    ...chordTones.slice(0, safeRotation).map((midi) => midi + 12),
  ];
  const upperTones = parsed.bass
    ? rotatedTones.filter((midi) => midiToNoteName(midi) !== parsed.bass)
    : rotatedTones;
  const midiNotes = [...upperTones];

  if (parsed.bass) {
    let bassMidi = getRootMidi(parsed.bass);
    const firstUpperTone = upperTones[0] || rotatedTones[0] || rootMidi;
    while (bassMidi >= firstUpperTone) {
      bassMidi -= 12;
    }
    while (firstUpperTone - bassMidi > 12) {
      bassMidi += 12;
    }
    midiNotes.unshift(bassMidi);
  }

  const dedupedMidiNotes = midiNotes.filter((midi, index, source) => (
    source.findIndex((candidate) => candidate === midi) === index
  ));

  return {
    midiNotes: dedupedMidiNotes,
    noteNames: dedupedMidiNotes.map(midiToNoteName),
  };
};
const buildPianoVariations = (chord = '') => {
  const notes = getChordNoteNames(chord);
  if (notes.length === 0) return [];
  const rotations = [0, 1, 2].filter((rotation) => rotation < notes.length);
  return rotations.map((rotation) => ({
    label: rotation === 0 ? 'Triada' : `Inversión ${rotation}`,
    ...buildPianoVoicing(chord, rotation),
  }));
};
const buildChordLibrary = (chords = []) => {
  const seen = new Set();
  return chords
    .map(normalizeChordSymbol)
    .filter(Boolean)
    .filter((chord) => {
      const parsed = parseChordSymbol(chord);
      if (!parsed) return false;
      const key = `${parsed.root}${parsed.suffix}${parsed.bass ? `/${parsed.bass}` : ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const parsedA = parseChordSymbol(a);
      const parsedB = parseChordSymbol(b);
      const rootDelta = SHARP_NOTES.indexOf(parsedA?.root) - SHARP_NOTES.indexOf(parsedB?.root);
      if (rootDelta !== 0) return rootDelta;
      return a.localeCompare(b);
    });
};
const normalizeChordRoot = (root = '', accidental = '') => (
  FLAT_TO_SHARP[`${root}${accidental}`] || `${root}${accidental}`
);
const scoreCapoShapeChord = (chord = '') => {
  const parts = splitChordDisplayParts(chord);
  if (!parts) return 0;

  const root = normalizeChordRoot(parts.root, parts.accidental);
  const suffix = String(parts.suffix || '').toLowerCase();
  let score = 0;

  if (OPEN_SHAPE_ROOTS.has(root)) {
    score += 3.2;
  } else if (root === 'F' || root === 'B') {
    score -= 2.2;
  } else {
    score -= 0.8;
  }

  if (root.includes('#')) {
    score -= 3.4;
  }

  if ((suffix === 'm' || suffix.startsWith('m')) && OPEN_MINOR_ROOTS.has(root)) {
    score += 0.9;
  }

  if (parts.bass) {
    const bassRoot = normalizeChordRoot(parts.bass.root, parts.bass.accidental);
    if (OPEN_SHAPE_ROOTS.has(bassRoot)) {
      score += 0.8;
    } else {
      score -= 0.4;
    }
    if (bassRoot.includes('#')) {
      score -= 1.4;
    }
  }

  return score;
};
const scoreCapoPlayableKey = (key = '') => {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey || normalizedKey === '-') return 0;
  if (OPEN_SHAPE_ROOTS.has(normalizedKey)) return 4.5;
  if (normalizedKey === 'F' || normalizedKey === 'B') return -2.2;
  if (normalizedKey.includes('#')) return -4.2;
  return -0.6;
};
/* ── Word-group builder: splits segments into per-word tokens ── */
const buildWordGroupsLegacy = (segments) => {
  // Step 1: classify each segment.
  // Whitespace-only (or empty) lyric → standalone chord-only token, not added to text.
  // Lyric with real text → chord-lyric item (chord marks position 0 of this lyric chunk).
  const classified = [];
  segments.forEach((seg) => {
    const lyric = seg.lyric || '';
    const chord = seg.chord || '';
    if (!lyric.trim()) {
      if (chord) classified.push({ type: 'chord-only', name: chord });
    } else {
      classified.push({ type: 'chord-lyric', chord: chord || null, lyric });
    }
  });

  // Step 2: process in order. Consecutive chord-lyric items are merged into one
  // text group so mid-word chord splits (e.g. "ado[F#m7]remos") are kept intact.
  const result = [];
  let i = 0;
  while (i < classified.length) {
    if (classified[i].type === 'chord-only') {
      result.push({ type: 'chord-only', name: classified[i].name });
      i++;
      continue;
    }
    // Collect consecutive chord-lyric items
    let groupText = '';
    const groupChords = [];
    while (i < classified.length && classified[i].type === 'chord-lyric') {
      if (classified[i].chord) groupChords.push({ name: classified[i].chord, pos: groupText.length });
      groupText += classified[i].lyric;
      i++;
    }
    // Build word list from the merged text
    const words = [];
    const wordRegex = /\S+/g;
    let m;
    while ((m = wordRegex.exec(groupText)) !== null) {
      words.push({ type: 'word', word: m[0], start: m.index, end: m.index + m[0].length, chords: [] });
    }
    // Assign each chord to the word that contains its position.
    // Chords that fall in whitespace become chord-only tokens inserted before the next word.
    const insertBefore = new Map(); // wordIndex → [chord names]
    groupChords.forEach((c) => {
      const inIdx = words.findIndex((w) => c.pos >= w.start && c.pos < w.end);
      if (inIdx >= 0) {
        words[inIdx].chords.push({ name: c.name, charOffset: c.pos - words[inIdx].start });
        return;
      }
      const nextIdx = words.findIndex((w) => w.start > c.pos);
      const key = nextIdx >= 0 ? nextIdx : words.length;
      if (!insertBefore.has(key)) insertBefore.set(key, []);
      insertBefore.get(key).push(c.name);
    });
    // Emit words with inline chord-only tokens at the right positions
    words.forEach((w, idx) => {
      (insertBefore.get(idx) || []).forEach((name) => result.push({ type: 'chord-only', name }));
      result.push(w);
    });
    (insertBefore.get(words.length) || []).forEach((name) => result.push({ type: 'chord-only', name }));
  }
  return result;
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
  const wordGroups = buildWordGroups(segments);
  return { mode: 'overlay', wordGroups };
};

function ChordOverlayLine({
  renderedLine,
  fontPreset,
  lineKey,
  interactiveChords = false,
  onChordPreview,
}) {
  const renderChord = (chord, key) => (
    interactiveChords ? (
      <ClickableChordToken
        key={key}
        chord={chord}
        sizeClass={`font-mono ${fontPreset.chord}`}
        onChordPreview={onChordPreview}
      />
    ) : (
      <ChordDisplay
        key={key}
        chord={chord}
        sizeClass={`font-mono ${fontPreset.chord}`}
      />
    )
  );

  return (
    <div className="overflow-visible">
      <div
        className={`block w-full text-zinc-900 dark:text-zinc-50 ${fontPreset.lyric}`}
        style={{ lineHeight: '1.3' }}
      >
        {renderedLine.wordGroups.map((token, i) => {
          if (token.type === 'chord-only') {
            return (
              <React.Fragment key={`${lineKey}-co-${i}`}>
                {i > 0 && ' '}
                <span
                  className="inline-block relative align-top"
                  style={{ paddingTop: '1.3em', lineHeight: '1.3', minWidth: `${token.name.length + 0.5}ch` }}
                >
                  <span className={`${interactiveChords ? 'pointer-events-auto' : 'pointer-events-none'} absolute top-0 left-0 h-0 overflow-visible whitespace-nowrap`}>
                    {renderChord(token.name, `${lineKey}-co-token-${i}`)}
                  </span>
                  {'\u00A0'}
                </span>
              </React.Fragment>
            );
          }

          // type === 'word'
          return (
            <React.Fragment key={`${lineKey}-wg-${i}`}>
              {i > 0 && ' '}
              <span
                className="inline-block relative align-top"
                style={{ paddingTop: '1.3em', lineHeight: '1.3' }}
              >
                {token.chords.length > 0 && (
                  <span className={`${interactiveChords ? 'pointer-events-auto' : 'pointer-events-none'} absolute top-0 flex w-max h-0 overflow-visible`} style={{ left: '50%', transform: 'translateX(-50%)', gap: '0.4em' }}>
                    {token.chords.map((c, j) => (
                      <span
                        key={`${lineKey}-chord-${i}-${j}`}
                        className="whitespace-nowrap"
                      >
                        {renderChord(c.name, `${lineKey}-chord-token-${i}-${j}`)}
                      </span>
                    ))}
                  </span>
                )}
                {token.word}
              </span>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
function GuitarChordDiagram({ chord, variation }) {
  const shape = variation || buildGuitarVariations(chord)[0];
  if (!shape) return null;
  const { baseFret, maxVisibleFret, relativeFrets } = normalizeFrets(shape.frets);
  const width = 164;
  const height = 150;
  const left = 24;
  const right = 140;
  const top = 30;
  const fretGap = 20;
  const stringGap = (right - left) / 5;
  const fretCount = Math.min(5, Math.max(4, maxVisibleFret));
  const bottom = top + (fretGap * fretCount);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={`Diagrama de guitarra ${chord}`}>
      {baseFret > 0 && (
        <text x="8" y={top + 14} className="fill-zinc-500 text-[10px] font-black dark:fill-zinc-400">
          {baseFret}
        </text>
      )}
      {Array.from({ length: 6 }).map((_, stringIndex) => {
        const x = left + (stringGap * stringIndex);
        return (
          <line
            key={`string-${stringIndex}`}
            x1={x}
            y1={top}
            x2={x}
            y2={bottom}
            stroke="currentColor"
            strokeWidth={stringIndex === 0 || stringIndex === 5 ? 1.35 : 1}
            className="text-zinc-400 dark:text-zinc-500"
          />
        );
      })}
      {Array.from({ length: fretCount + 1 }).map((_, fretIndex) => {
        const y = top + (fretGap * fretIndex);
        return (
          <line
            key={`fret-${fretIndex}`}
            x1={left}
            y1={y}
            x2={right}
            y2={y}
            stroke="currentColor"
            strokeWidth={fretIndex === 0 && baseFret === 0 ? 4 : 1}
            className="text-zinc-500 dark:text-zinc-400"
          />
        );
      })}
      {relativeFrets.map((fret, stringIndex) => {
        const x = left + (stringGap * stringIndex);
        if (String(fret).toLowerCase() === 'x') {
          return (
            <text key={`muted-${stringIndex}`} x={x} y={18} textAnchor="middle" className="fill-zinc-400 text-[13px] font-black dark:fill-zinc-500">
              x
            </text>
          );
        }
        if (Number(fret) === 0) {
          return (
            <circle
              key={`open-${stringIndex}`}
              cx={x}
              cy={14}
              r="4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-zinc-500 dark:text-zinc-400"
            />
          );
        }
        const fretNumber = Number(fret);
        if (!Number.isFinite(fretNumber)) return null;
        const y = top + ((fretNumber - 0.5) * fretGap);
        return (
          <g key={`dot-${stringIndex}-${fretNumber}`}>
            <circle cx={x} cy={y} r="8.5" className="fill-brand" />
            {shape.fingers?.[stringIndex] && (
              <text x={x} y={y + 3.5} textAnchor="middle" className="fill-white text-[9px] font-black">
                {shape.fingers[stringIndex]}
              </text>
            )}
          </g>
        );
      })}
      {GUITAR_TUNING.map((label, stringIndex) => (
        <text
          key={`tuning-${stringIndex}`}
          x={left + (stringGap * stringIndex)}
          y={bottom + 18}
          textAnchor="middle"
          className="fill-zinc-400 text-[9px] font-bold dark:fill-zinc-500"
        >
          {label}
        </text>
      ))}
    </svg>
  );
}

function PianoChordDiagram({ chord, variation }) {
  const voicing = variation?.midiNotes?.length ? variation : buildPianoVoicing(chord, 0);
  const activeMidiNotes = Array.isArray(voicing?.midiNotes) ? voicing.midiNotes : [];
  const activeMidiSet = new Set(activeMidiNotes);
  const whiteKeyWidth = 22;
  const whiteKeyHeight = 86;
  const minMidi = activeMidiNotes.length ? Math.min(...activeMidiNotes) : 60;
  const maxMidi = activeMidiNotes.length ? Math.max(...activeMidiNotes) : 72;
  let startMidi = Math.floor((minMidi - 2) / 12) * 12;
  while (maxMidi > startMidi + 24) {
    startMidi += 12;
  }
  const endMidi = startMidi + 24;
  const whiteKeys = [];
  const blackKeys = [];

  for (let midi = startMidi; midi <= endMidi; midi += 1) {
    const note = midiToNoteName(midi);
    if (PIANO_WHITE_NOTES.includes(note)) {
      whiteKeys.push({
        midi,
        note,
        x: whiteKeys.length * whiteKeyWidth,
      });
    } else {
      blackKeys.push({
        midi,
        note,
        x: (Math.max(whiteKeys.length, 1) * whiteKeyWidth) - 7,
      });
    }
  }

  const width = whiteKeys.length * whiteKeyWidth;

  return (
    <svg viewBox={`0 0 ${width} 112`} className="h-auto w-full" role="img" aria-label={`Teclado de piano ${chord}`}>
      <rect x="0" y="0" width={width} height={whiteKeyHeight} rx="9" className="fill-zinc-100 dark:fill-zinc-800" />
      {whiteKeys.map((key) => {
        const active = activeMidiSet.has(key.midi);
        return (
          <g key={`white-${key.midi}`}>
            <rect
              x={key.x + 1}
              y="1"
              width={whiteKeyWidth - 2}
              height={whiteKeyHeight}
              rx="7"
              className={active ? 'fill-brand' : 'fill-white dark:fill-zinc-900'}
              stroke="currentColor"
              strokeWidth="1"
            />
            {active && (
              <text x={key.x + (whiteKeyWidth / 2)} y="74" textAnchor="middle" className="fill-white text-[9px] font-black">
                {formatChordAccidentals(key.note)}
              </text>
            )}
          </g>
        );
      })}
      {blackKeys.map((key) => {
        const active = activeMidiSet.has(key.midi);
        return (
          <g key={`black-${key.midi}`}>
            <rect
              x={key.x}
              y="0"
              width="14"
              height="54"
              rx="5"
              className={active ? 'fill-brand' : 'fill-zinc-950 dark:fill-zinc-200'}
            />
            {active && (
              <text x={key.x + 7} y="44" textAnchor="middle" className="fill-white text-[7px] font-black">
                {formatChordAccidentals(key.note)}
              </text>
            )}
          </g>
        );
      })}
      <text x={width / 2} y="105" textAnchor="middle" className="fill-zinc-500 text-[10px] font-black dark:fill-zinc-400">
        {activeMidiNotes.map((midi) => formatChordAccidentals(midiToNoteName(midi))).join(' · ')}
      </text>
    </svg>
  );
}

function ChordVariationStepper({ chord, instrument, variations, activeIndex, onChange }) {
  if (!Array.isArray(variations) || variations.length === 0) return null;
  const activeVariation = variations[activeIndex] || variations[0];
  const moveVariation = (direction) => {
    if (variations.length <= 1) return;
    const nextIndex = (activeIndex + direction + variations.length) % variations.length;
    onChange(`${instrument}:${chord}`, nextIndex);
  };

  return (
    <div className="mt-2 grid grid-cols-[1.45rem_minmax(0,1fr)_1.45rem] items-center gap-1">
      <button
        type="button"
        onClick={() => moveVariation(-1)}
        disabled={variations.length <= 1}
        className="flex h-7 w-5 items-center justify-center text-zinc-500 transition-colors hover:text-brand disabled:cursor-not-allowed disabled:opacity-35 dark:text-zinc-400 dark:hover:text-brand"
        aria-label={`Variación anterior de ${chord}`}
      >
        <ChevronLeft className="h-4.5 w-4.5" />
      </button>
      <p className="truncate text-center text-sm font-black text-zinc-700 dark:text-zinc-200">
        {activeVariation?.label || 'Variación'}
      </p>
      <button
        type="button"
        onClick={() => moveVariation(1)}
        disabled={variations.length <= 1}
        className="flex h-7 w-5 items-center justify-center text-zinc-500 transition-colors hover:text-brand disabled:cursor-not-allowed disabled:opacity-35 dark:text-zinc-400 dark:hover:text-brand"
        aria-label={`Siguiente variación de ${chord}`}
      >
        <ChevronRight className="h-4.5 w-4.5" />
      </button>
    </div>
  );
}

function ChordLibraryModal({
  chords,
  instrument,
  onInstrumentChange,
  variationByChord,
  onVariationChange,
  onClose,
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-zinc-950/48 px-2 pt-10 backdrop-blur-sm sm:items-center sm:px-4" role="dialog" aria-modal="true" aria-label="Acordes de la cancion">
      <div className="flex max-h-[min(92vh,48rem)] w-full max-w-5xl flex-col overflow-hidden rounded-t-[1.65rem] border border-zinc-200/90 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.26)] dark:border-white/10 dark:bg-zinc-950 sm:rounded-[1.65rem]">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200/80 px-4 py-4 dark:border-white/10 sm:px-5">
          <div className="min-w-0">
            <p className="text-[0.68rem] font-black uppercase tracking-[0.28em] text-zinc-500 dark:text-zinc-400">
              Ver acordes
            </p>
            <h3 className="mt-1 truncate text-xl font-black tracking-tight text-zinc-950 dark:text-zinc-50">
              Acordes de la canción
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            aria-label="Cerrar acordes"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>
        <div className="shrink-0 border-b border-zinc-200/80 px-4 py-3 dark:border-white/10 sm:px-5">
          <div className="grid grid-cols-2 gap-1 rounded-2xl bg-zinc-100 p-1 dark:bg-zinc-900">
            {[
              ['guitar', 'Guitarra'],
              ['piano', 'Piano'],
            ].map(([key, label]) => {
              const active = instrument === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onInstrumentChange(key)}
                  className={`rounded-xl px-3 py-2.5 text-sm font-black transition-all ${active
                    ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50'
                    : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                    }`}
                  aria-pressed={active}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 [scrollbar-width:none] dark:bg-zinc-950 sm:px-5 sm:py-5 [&::-webkit-scrollbar]:hidden">
          {chords.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {chords.map((chord) => {
                const variations = instrument === 'guitar' ? buildGuitarVariations(chord) : buildPianoVariations(chord);
                const activeIndex = Math.min(
                  Math.max(0, variationByChord[`${instrument}:${chord}`] || 0),
                  Math.max(variations.length - 1, 0),
                );
                const activeVariation = variations[activeIndex] || variations[0] || null;
                return (
                  <article
                    key={`${instrument}-${chord}`}
                    className="flex min-h-[14.4rem] flex-col rounded-[1.15rem] border border-zinc-200 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-zinc-900/90"
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h4 className="text-2xl font-black leading-none tracking-tight text-zinc-950 dark:text-zinc-50">
                          <ChordDisplay chord={chord} />
                        </h4>
                      </div>
                    </div>
                    <div className="flex min-h-[7.4rem] flex-1 items-center justify-center rounded-[0.9rem] bg-zinc-50 px-2 py-2 text-zinc-800 dark:bg-zinc-950/70 dark:text-zinc-200">
                      {instrument === 'guitar' ? (
                        <GuitarChordDiagram chord={chord} variation={activeVariation} />
                      ) : (
                        <PianoChordDiagram chord={chord} variation={activeVariation} />
                      )}
                    </div>
                    <ChordVariationStepper
                      chord={chord}
                      instrument={instrument}
                      variations={variations}
                      activeIndex={activeIndex}
                      onChange={onVariationChange}
                    />
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[1.2rem] border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-center dark:border-white/10 dark:bg-zinc-900">
              <p className="font-bold text-zinc-600 dark:text-zinc-300">
                Esta canción no tiene acordes detectables.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ChordPreviewPopover({
  preview,
  instrument,
  variationByChord,
  onVariationChange,
  previewRef,
}) {
  if (!preview?.chord) return null;
  const chord = preview.chord;
  const variations = instrument === 'guitar' ? buildGuitarVariations(chord) : buildPianoVariations(chord);
  const activeIndex = Math.min(
    Math.max(0, variationByChord[`${instrument}:${chord}`] || 0),
    Math.max(variations.length - 1, 0),
  );
  const activeVariation = variations[activeIndex] || variations[0] || null;

  return (
    <div
      ref={previewRef}
      className="fixed z-[88] w-[min(17rem,calc(100vw-1.25rem))] overflow-hidden rounded-[1.05rem] border border-zinc-200/90 bg-white/98 p-3 text-zinc-900 shadow-[0_18px_46px_rgba(15,23,42,0.22)] dark:border-white/10 dark:bg-zinc-950/98 dark:text-zinc-50"
      style={{
        left: `${preview.left}px`,
        top: `${preview.top}px`,
      }}
      role="dialog"
      aria-label={`Acorde ${formatChordAccidentals(chord)}`}
    >
      <h4 className="text-2xl font-black leading-none tracking-tight text-zinc-950 dark:text-zinc-50">
        <ChordDisplay chord={chord} />
      </h4>
      <div className="mt-2 flex min-h-[8.5rem] items-center justify-center rounded-[0.9rem] bg-zinc-50 px-2 py-2 text-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-200">
        {instrument === 'guitar' ? (
          <GuitarChordDiagram chord={chord} variation={activeVariation} />
        ) : (
          <PianoChordDiagram chord={chord} variation={activeVariation} />
        )}
      </div>
      <ChordVariationStepper
        chord={chord}
        instrument={instrument}
        variations={variations}
        activeIndex={activeIndex}
        onChange={onVariationChange}
      />
    </div>
  );
}
export default function ModoEnsayoCompacto({
  song,
  contextTitle = '',
  onGoBack,
  globalSyncMode = false,
  eventId = '',
  playlistId = '',
  userId = '',
  onPersonalSettingsChange,
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
  const [capoFret, setCapoFret] = useState(0);
  const [isMetronomeOn, setIsMetronomeOn] = useState(false);
  const [loopState, setLoopState] = useState(0);
  const [isLandscapeCompact, setIsLandscapeCompact] = useState(false);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [showPlaybackOptions, setShowPlaybackOptions] = useState(false);
  const [showChordLibrary, setShowChordLibrary] = useState(false);
  const [personalSettingsToast, setPersonalSettingsToast] = useState(null);
  const [tapChordPreviewEnabled, setTapChordPreviewEnabled] = useState(false);
  const [tapChordPreviewInstrument, setTapChordPreviewInstrument] = useState('guitar');
  const [activeChordPreview, setActiveChordPreview] = useState(null);
  const [chordLibraryInstrument, setChordLibraryInstrument] = useState('guitar');
  const [chordVariationByKey, setChordVariationByKey] = useState({});
  const [selectedPlaybackSourceId, setSelectedPlaybackSourceId] = useState('original');
  const [syncRole, setSyncRole] = useState(globalSyncMode ? 'musico' : 'local');
  const [remotePayload, setRemotePayload] = useState(null);
  const [panValue, setPanValue] = useState(0);
  const [guideCueEnabled, setGuideCueEnabled] = useState(true);
  const [guideCueVolume, setGuideCueVolume] = useState(0.72);
  const syncChannelRef = useRef(null);
  const syncSnapshotRef = useRef({
    songId: '',
    sectionIndex: 0,
    currentTime: 0,
    isPlaying: false,
  });
  const audioRef = useRef(null);
  const guideCueAudioRefs = useRef([]);
  const headerRef = useRef(null);
  const scrollRef = useRef(null);
  const lastScrollTop = useRef(0);
  const sectionRefs = useRef([]);
  const optionsMenuRef = useRef(null);
  const playbackOptionsRef = useRef(null);
  const chordPreviewRef = useRef(null);
  const personalSettingsLoadedRef = useRef(false);
  const lastPersistedPersonalSettingsRef = useRef('');
  const personalSettingsToastTimeoutRef = useRef(null);
  const pendingPlaybackResumeRef = useRef(false);
  const lastRehearsalMixSourceRef = useRef('');
  const audioCtxRef = useRef(null);
  const trackSourceRef = useRef(null);
  const trackGainRef = useRef(null);
  const trackPanRef = useRef(null);
  const trackGainFadeFrameRef = useRef(null);
  const trackTargetGainRef = useRef(TRACK_DEFAULT_GAIN);
  const padAudioRef = useRef(null);
  const [padVolume, setPadVolume] = useState(0.5);
  const [isPadActive, setIsPadActive] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(148);
  const rehearsalMixEngine = useMultitrackEngine({ useStreamingEngine: true });
  const {
    currentTime: rehearsalMixCurrentTime,
    duration: rehearsalMixDuration,
    initialize: initializeRehearsalMix,
    isPlaying: rehearsalMixIsPlaying,
    isReady: rehearsalMixIsReady,
    loadProgress: rehearsalMixLoadProgress,
    pause: pauseRehearsalMix,
    play: playRehearsalMix,
    seekTo: seekRehearsalMixTo,
    setTrackOutputRoute: setRehearsalMixTrackOutputRoute,
    setVolume: setRehearsalMixVolume,
    stop: stopRehearsalMix,
  } = rehearsalMixEngine;
  useEffect(() => {
    screenWakeLockService.setRequested('modo-ensayo-compacto', true);
    return () => {
      screenWakeLockService.setRequested('modo-ensayo-compacto', false);
    };
  }, []);
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
  const songChordTokens = useMemo(() => extractChordTokensFromSections(currentSong?.sections || []), [currentSong?.sections]);
  const explicitSongKey = normalizeKeyToAmerican(currentSong?.originalKey || currentSong?.key || '-');
  const originalSongKey = useMemo(() => {
    if (explicitSongKey !== '-') return explicitSongKey;
    const firstParsedChord = songChordTokens
      .map((token) => parseChordSymbol(token))
      .find(Boolean);
    return firstParsedChord?.root || '-';
  }, [explicitSongKey, songChordTokens]);
  const currentSongDisplayKey = useMemo(() => transposeChordToken(originalSongKey, transposeSteps), [originalSongKey, transposeSteps]);
  const capoShapeKey = useMemo(() => (
    capoFret > 0 ? transposeChordToken(currentSongDisplayKey, -capoFret) : currentSongDisplayKey
  ), [capoFret, currentSongDisplayKey]);
  const displayTransposeSteps = transposeSteps - capoFret;
  const transposeKeyOptions = useMemo(() => (
    TRANSPOSE_OPTIONS.map((steps) => ({
      steps,
      label: transposeChordToken(originalSongKey, steps),
    }))
  ), [originalSongKey]);
  const capoOptions = useMemo(() => (
    CAPO_OPTIONS.map((fret) => {
      const shapeKey = fret > 0 ? transposeChordToken(currentSongDisplayKey, -fret) : currentSongDisplayKey;
      const score = songChordTokens.reduce((total, token) => (
        total + scoreCapoShapeChord(transposeChordToken(token, transposeSteps - fret))
      ), 0) + scoreCapoPlayableKey(shapeKey);
      return {
        fret,
        shapeKey,
        score,
      };
    })
  ), [currentSongDisplayKey, songChordTokens, transposeSteps]);
  const recommendedCapoOption = useMemo(() => {
    const candidates = capoOptions.filter((option) => option.fret > 0 && option.shapeKey !== '-' && songChordTokens.length > 0);
    if (candidates.length === 0) return null;
    return candidates.reduce((bestOption, option) => {
      if (!bestOption) return option;
      if (option.score > bestOption.score + 0.01) return option;
      if (Math.abs(option.score - bestOption.score) <= 0.01 && option.fret < bestOption.fret) return option;
      return bestOption;
    }, null);
  }, [capoOptions, songChordTokens]);
  const activePadUrl = useMemo(() => {
    if (!currentSongDisplayKey || currentSongDisplayKey === '-') return null;
    const safeKey = currentSongDisplayKey.replace('#', 'Sharp').replace('b', 'Flat');
    return `https://pub-4faa87e319a345c38e4f3be570797088.r2.dev/pads/Pad_${safeKey}.mp3`;
  }, [currentSongDisplayKey]);
  const currentSections = useMemo(() => (
    (currentSong?.sections || []).map((section) => ({
      ...section,
      lines: Array.isArray(section?.lines)
        ? section.lines.map((line) => transposeChordProLine(line, displayTransposeSteps))
        : [],
    }))
  ), [currentSong?.sections, displayTransposeSteps]);
  const currentChordLibrary = useMemo(() => (
    buildChordLibrary(extractChordTokensFromSections(currentSections))
  ), [currentSections]);
  const toggleTapChordPreview = useCallback(() => {
    setTapChordPreviewEnabled((enabled) => {
      const nextEnabled = !enabled;
      if (!nextEnabled) {
        setActiveChordPreview(null);
      }
      return nextEnabled;
    });
  }, []);
  const selectTapChordPreviewInstrument = useCallback((instrument) => {
    setTapChordPreviewInstrument(instrument);
    setTapChordPreviewEnabled(true);
    setActiveChordPreview(null);
  }, []);
  const getChordPreviewPlacement = useCallback((triggerNode) => {
    if (typeof window === 'undefined' || !triggerNode?.getBoundingClientRect) {
      return { left: 12, top: 88 };
    }
    const rect = triggerNode.getBoundingClientRect();
    const viewportWidth = window.innerWidth || 360;
    const viewportHeight = window.innerHeight || 640;
    const margin = 10;
    const popoverWidth = Math.min(272, Math.max(220, viewportWidth - (margin * 2)));
    const estimatedHeight = tapChordPreviewInstrument === 'piano' ? 240 : 286;
    const left = Math.min(
      Math.max(margin, rect.left + (rect.width / 2) - (popoverWidth / 2)),
      Math.max(margin, viewportWidth - popoverWidth - margin),
    );
    let top = rect.bottom + 8;
    if (top + estimatedHeight > viewportHeight - margin) {
      top = rect.top - estimatedHeight - 8;
    }
    return {
      left,
      top: Math.max(margin, top),
    };
  }, [tapChordPreviewInstrument]);
  const handleChordPreviewOpen = useCallback((chord, triggerNode) => {
    if (!tapChordPreviewEnabled) return;
    const normalizedChord = normalizeChordSymbol(chord);
    if (!normalizedChord || !parseChordSymbol(normalizedChord)) return;
    setShowChordLibrary(false);
    setActiveChordPreview({
      chord: normalizedChord,
      ...getChordPreviewPlacement(triggerNode),
    });
  }, [getChordPreviewPlacement, tapChordPreviewEnabled]);
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
  const personalSettingsContext = useMemo(() => ({
    userId,
    eventId,
    playlistId,
    songId: currentSongKey,
  }), [currentSongKey, eventId, playlistId, userId]);
  const buildPersonalSettingsToastDetail = useCallback((settings, options = {}) => (
    formatRehearsalSongSettingsSummary(settings, {
      includeNeutral: Boolean(options.includeNeutral),
      targetTone: transposeChordToken(originalSongKey, sanitizeRehearsalSongSettings(settings).transposeSteps),
    })
  ), [originalSongKey]);
  const showPersonalSettingsToast = useCallback((title, detail = '') => {
    if (!title) return;
    if (personalSettingsToastTimeoutRef.current) {
      window.clearTimeout(personalSettingsToastTimeoutRef.current);
    }
    setPersonalSettingsToast({ title, detail });
    personalSettingsToastTimeoutRef.current = window.setTimeout(() => {
      setPersonalSettingsToast(null);
      personalSettingsToastTimeoutRef.current = null;
    }, REHEARSAL_PERSONAL_SETTINGS_TOAST_MS);
  }, []);
  const titleLine = currentSong.title || 'Titulo de Cancion';
  const artistLine = currentSong.artist || 'Artista';
  const shouldRotateHeaderMeta = Boolean(artistLine) && titleLine.trim() !== artistLine.trim();
  const playbackSources = useMemo(() => buildPlaybackSources(currentSong), [currentSong]);
  const guideCueSources = useMemo(() => buildGuideCueSources(currentSong), [currentSong]);
  const processedGuideCueSources = useMemo(() => (
    guideCueSources.map((source) => ({
      ...source,
      playbackUrl: resolvePreferredAudioUrl(source.url, {
        origin: typeof window !== 'undefined' ? window.location.origin : '',
      }) || source.url,
      rehearsalMixUrl: resolveFetchableAudioUrl(source.url, {
        origin: typeof window !== 'undefined' ? window.location.origin : '',
      }) || source.url,
    }))
  ), [guideCueSources]);
  const hasGuideCueSources = processedGuideCueSources.length > 0;
  const guideCueDisplayLabel = useMemo(() => getGuideCueLabel(guideCueSources), [guideCueSources]);
  const activePlaybackSource = useMemo(() => (
    playbackSources.find((source) => source.id === selectedPlaybackSourceId) || playbackSources[0] || null
  ), [playbackSources, selectedPlaybackSourceId]);
  const activePlaybackUrl = activePlaybackSource?.url || '';
  const processedActivePlaybackUrl = useMemo(() => (
    resolvePreferredAudioUrl(activePlaybackUrl, {
      origin: typeof window !== 'undefined' ? window.location.origin : '',
    })
  ), [activePlaybackUrl]);
  const rehearsalMixActivePlaybackUrl = useMemo(() => (
    resolveFetchableAudioUrl(activePlaybackUrl, {
      origin: typeof window !== 'undefined' ? window.location.origin : '',
    }) || processedActivePlaybackUrl
  ), [activePlaybackUrl, processedActivePlaybackUrl]);
  const hasSupplementalPlaybackSources = useMemo(() => (
    playbackSources.some((source) => source.kind === 'sequence' || source.kind === 'stem') || hasGuideCueSources
  ), [hasGuideCueSources, playbackSources]);
  const shouldUseTrackWebAudio = panValue !== 0;
  const liveDirectorSectionOffsetSeconds = useMemo(() => {
    const session = getPersistedLiveDirectorSession(currentSong);
    return Number.isFinite(Number(session?.sectionOffsetSeconds))
      ? Number(session.sectionOffsetSeconds)
      : 0;
  }, [currentSong]);
  const currentSongMarkers = useMemo(() => (
    Array.isArray(currentSong?.sectionMarkers)
      ? (() => {
        let nextSectionSearchIndex = 0;
        const mappedMarkers = currentSong.sectionMarkers
          .filter((marker) => Number.isFinite(Number(marker?.startSec)))
          .map((marker, index) => ({
            id: marker?.id || `${currentSongKey}-marker-${index}`,
            sectionName: String(marker?.sectionName || '').trim(),
            startSec: Math.max(0, (Number(marker?.startSec) || 0) + liveDirectorSectionOffsetSeconds),
            endSec: Number.isFinite(Number(marker?.endSec)) ? Math.max(0, Number(marker.endSec) + liveDirectorSectionOffsetSeconds) : null,
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
  ), [currentSections, currentSong?.duration, currentSong?.sectionMarkers, currentSongKey, liveDirectorSectionOffsetSeconds]);
  const hasAudio = typeof processedActivePlaybackUrl === 'string' && processedActivePlaybackUrl.trim() !== '';
  const shouldUseRehearsalMix = Boolean(
    hasAudio &&
    hasGuideCueSources &&
    activePlaybackSource?.kind !== 'original'
  );
  const rehearsalMixMainOutputRoute = useMemo(() => (
    getRehearsalMixMainOutputRoute(panValue)
  ), [panValue]);
  const rehearsalMixGuideTrackIds = useMemo(() => (
    processedGuideCueSources.map((source, index) => `${REHEARSAL_MIX_GUIDE_TRACK_PREFIX}-${source.id || index}`)
  ), [processedGuideCueSources]);
  const rehearsalMixTracks = useMemo(() => {
    const mainUrl = String(rehearsalMixActivePlaybackUrl || processedActivePlaybackUrl || activePlaybackUrl || '').trim();
    if (!shouldUseRehearsalMix || !mainUrl || processedGuideCueSources.length === 0) {
      return [];
    }

    const guideTracks = processedGuideCueSources
      .map((source, index) => {
        const url = String(source.rehearsalMixUrl || source.playbackUrl || source.url || '').trim();
        if (!url) return null;
        return {
          id: `${REHEARSAL_MIX_GUIDE_TRACK_PREFIX}-${source.id || index}`,
          name: source.label || `Guia ${index + 1}`,
          url,
          volume: 0.72,
          isMuted: false,
          outputRoute: 'left',
          sourceFileName: source.url || source.label || '',
        };
      })
      .filter(Boolean);

    if (guideTracks.length === 0) {
      return [];
    }

    return [
      ...guideTracks,
      {
        id: REHEARSAL_MIX_MAIN_TRACK_ID,
        name: activePlaybackSource?.label || 'Pista de ensayo',
        url: mainUrl,
        volume: REHEARSAL_MIX_STEM_GAIN,
        isMuted: false,
        outputRoute: 'right',
        sourceFileName: activePlaybackUrl || activePlaybackSource?.label || '',
      },
    ];
  }, [
    activePlaybackSource?.label,
    activePlaybackUrl,
    processedActivePlaybackUrl,
    processedGuideCueSources,
    rehearsalMixActivePlaybackUrl,
    shouldUseRehearsalMix,
  ]);
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
  useEffect(() => {
    syncSnapshotRef.current = {
      songId: String(currentSongKey || ''),
      sectionIndex: activeSectionIndex,
      currentTime: Math.max(0, audioCurrentTime),
      isPlaying,
    };
  }, [activeSectionIndex, audioCurrentTime, currentSongKey, isPlaying]);

  const pushSyncSnapshot = useCallback((snapshotOverride = null) => {
    if (syncRole !== 'director' || !syncChannelRef.current) return;

    const snapshot = snapshotOverride || syncSnapshotRef.current;
    if (!snapshot?.songId) return;

    syncChannelRef.current.send({
      type: 'broadcast',
      event: 'SECTION_CHANGE',
      payload: {
        songId: String(snapshot.songId),
        sectionIndex: Number.isFinite(Number(snapshot.sectionIndex)) ? Number(snapshot.sectionIndex) : 0,
        currentTime: Math.max(0, (Number(snapshot.currentTime) || 0) - liveDirectorSectionOffsetSeconds),
        currentTimeRaw: Math.max(0, Number(snapshot.currentTime) || 0),
        sectionOffsetSeconds: liveDirectorSectionOffsetSeconds,
        isPlaying: Boolean(snapshot.isPlaying),
      },
    }).catch((error) => console.warn('[LiveSync] Error enviando snapshot:', error));
  }, [liveDirectorSectionOffsetSeconds, syncRole]);
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
  const cancelTrackGainFade = React.useCallback(() => {
    if (typeof window !== 'undefined' && trackGainFadeFrameRef.current) {
      window.cancelAnimationFrame(trackGainFadeFrameRef.current);
      trackGainFadeFrameRef.current = null;
    }
    const ctx = audioCtxRef.current;
    const gainNode = trackGainRef.current;
    if (ctx && gainNode && ctx.state !== 'closed') {
      try {
        gainNode.gain.cancelScheduledValues(ctx.currentTime);
      } catch {
        // ignore gain automation cleanup errors
      }
    }
  }, []);
  const setTrackGainImmediate = React.useCallback((nextGain) => {
    const safeGain = Math.min(TRACK_DEFAULT_GAIN, Math.max(0, Number(nextGain) || 0));
    trackTargetGainRef.current = safeGain;
    cancelTrackGainFade();

    const ctx = audioCtxRef.current;
    const gainNode = trackGainRef.current;
    if (ctx && gainNode && ctx.state !== 'closed') {
      gainNode.gain.setValueAtTime(safeGain, ctx.currentTime);
      if (audioRef.current) {
        audioRef.current.volume = TRACK_DEFAULT_GAIN;
      }
      return;
    }

    if (audioRef.current) {
      audioRef.current.volume = safeGain;
    }
  }, [cancelTrackGainFade]);
  const fadeTrackGainTo = React.useCallback((targetGain, durationMs) => {
    const safeTarget = Math.min(TRACK_DEFAULT_GAIN, Math.max(0, Number(targetGain) || 0));
    const safeDuration = Math.max(0, Number(durationMs) || 0);
    trackTargetGainRef.current = safeTarget;
    cancelTrackGainFade();

    const ctx = audioCtxRef.current;
    const gainNode = trackGainRef.current;
    if (ctx && gainNode && ctx.state !== 'closed') {
      const now = ctx.currentTime;
      const currentValue = Number.isFinite(gainNode.gain.value) ? gainNode.gain.value : TRACK_DEFAULT_GAIN;
      gainNode.gain.setValueAtTime(currentValue, now);
      gainNode.gain.linearRampToValueAtTime(safeTarget, now + (safeDuration / 1000));
      if (audioRef.current) {
        audioRef.current.volume = TRACK_DEFAULT_GAIN;
      }
      return;
    }

    if (!audioRef.current || typeof window === 'undefined') return;

    const startVolume = Number.isFinite(audioRef.current.volume) ? audioRef.current.volume : TRACK_DEFAULT_GAIN;
    if (safeDuration === 0) {
      audioRef.current.volume = safeTarget;
      return;
    }

    const startedAt = window.performance.now();
    const animateVolume = (now) => {
      const progress = Math.min(1, (now - startedAt) / safeDuration);
      const eased = 1 - ((1 - progress) * (1 - progress) * (1 - progress));
      if (audioRef.current) {
        audioRef.current.volume = startVolume + ((safeTarget - startVolume) * eased);
      }
      if (progress < 1) {
        trackGainFadeFrameRef.current = window.requestAnimationFrame(animateVolume);
      } else {
        trackGainFadeFrameRef.current = null;
      }
    };

    trackGainFadeFrameRef.current = window.requestAnimationFrame(animateVolume);
  }, [cancelTrackGainFade]);
  const disconnectTrackWebAudio = React.useCallback(() => {
    const audioElement = audioRef.current;
    if (audioElement) {
      delete audioElement.dataset.webaudioConnected;
    }

    trackSourceRef.current = null;
    trackGainRef.current = null;
    trackPanRef.current = null;

    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (ctx && ctx.state !== 'closed') {
      try { ctx.close(); } catch { }
    }
  }, []);
  const ensureWebAudioConnected = React.useCallback(async () => {
    const audioElement = audioRef.current;
    if (!audioElement || typeof window === 'undefined') return;
    if (!shouldUseTrackWebAudio) return;
    if (audioElement.dataset.webaudioConnected === 'true') return;

    disconnectTrackWebAudio();

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

    gainNode.gain.setValueAtTime(trackTargetGainRef.current, ctx.currentTime);
    audioElement.volume = TRACK_DEFAULT_GAIN;
    audioElement.dataset.webaudioConnected = 'true';

    // Aplicar paneo actual
    if (panNode.pan) {
      panNode.pan.setTargetAtTime(panValue, ctx.currentTime, 0.05);
    }
  }, [disconnectTrackWebAudio, panValue, shouldUseTrackWebAudio]);
  const getGuideCueAudioElements = React.useCallback(() => (
    guideCueAudioRefs.current.filter(Boolean)
  ), []);
  const syncGuideCueTracks = React.useCallback((nextTime = 0, { force = false } = {}) => {
    const safeTime = Math.max(0, Number(nextTime) || 0);
    getGuideCueAudioElements().forEach((element) => {
      if (!element) return;
      const currentTime = Number.isFinite(element.currentTime) ? element.currentTime : 0;
      if (force || Math.abs(currentTime - safeTime) > GUIDE_CUE_SYNC_TOLERANCE_SECONDS) {
        try {
          element.currentTime = safeTime;
        } catch {
          // Some browsers reject seeks before metadata is ready.
        }
      }
    });
  }, [getGuideCueAudioElements]);
  const scheduleGuideCueResync = React.useCallback(() => {
    if (typeof window === 'undefined' || !audioRef.current) return;
    [80, 220, 520].forEach((delayMs) => {
      window.setTimeout(() => {
        if (!audioRef.current || audioRef.current.paused) return;
        syncGuideCueTracks(audioRef.current.currentTime, { force: true });
      }, delayMs);
    });
  }, [syncGuideCueTracks]);
  const pauseGuideCueTracks = React.useCallback(() => {
    getGuideCueAudioElements().forEach((element) => {
      try { element.pause(); } catch { }
    });
  }, [getGuideCueAudioElements]);
  const playGuideCueTracks = React.useCallback(async (nextTime = 0) => {
    if (!hasGuideCueSources || !guideCueEnabled) return;
    const elements = getGuideCueAudioElements();
    if (elements.length === 0) return;

    syncGuideCueTracks(nextTime, { force: true });
    await Promise.all(elements.map(async (element) => {
      element.volume = Math.max(0, Math.min(1, guideCueVolume));
      try {
        await element.play();
      } catch {
        // Browser autoplay rules can block the auxiliary layer; the main track keeps working.
      }
    }));
  }, [getGuideCueAudioElements, guideCueEnabled, guideCueVolume, hasGuideCueSources, syncGuideCueTracks]);
  useEffect(() => {
    if (!shouldUseRehearsalMix) {
      lastRehearsalMixSourceRef.current = '';
      return;
    }

    const mixSourceKey = `${currentSongKey}:${selectedPlaybackSourceId}`;
    if (lastRehearsalMixSourceRef.current === mixSourceKey) return;

    lastRehearsalMixSourceRef.current = mixSourceKey;
    setPanValue(1);
  }, [currentSongKey, selectedPlaybackSourceId, shouldUseRehearsalMix]);
  useEffect(() => {
    let cancelled = false;

    if (!shouldUseRehearsalMix || rehearsalMixTracks.length === 0) {
      stopRehearsalMix();
      return undefined;
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
    }
    pauseGuideCueTracks();
    setIsPlaying(false);
    setAudioCurrentTime(0);
    setAudioDuration(0);
    setAudioReady(false);

    initializeRehearsalMix(rehearsalMixTracks).catch((error) => {
      if (cancelled) return;
      console.warn('[ModoEnsayoCompacto] No se pudo preparar la mezcla de ensayo.', error);
      setAudioReady(false);
      setIsPlaying(false);
    });

    return () => {
      cancelled = true;
      stopRehearsalMix();
    };
  }, [
    initializeRehearsalMix,
    pauseGuideCueTracks,
    rehearsalMixTracks,
    shouldUseRehearsalMix,
    stopRehearsalMix,
  ]);
  useEffect(() => {
    if (!shouldUseRehearsalMix || !rehearsalMixIsReady) return;

    const guideVolume = guideCueEnabled ? Math.max(0, Math.min(1, guideCueVolume)) : 0;
    rehearsalMixGuideTrackIds.forEach((trackId) => {
      setRehearsalMixVolume(trackId, guideVolume);
      setRehearsalMixTrackOutputRoute(trackId, 'left');
    });
  }, [
    guideCueEnabled,
    guideCueVolume,
    rehearsalMixGuideTrackIds,
    rehearsalMixIsReady,
    setRehearsalMixTrackOutputRoute,
    setRehearsalMixVolume,
    shouldUseRehearsalMix,
  ]);
  useEffect(() => {
    if (!shouldUseRehearsalMix || !rehearsalMixIsReady) return;

    setRehearsalMixVolume(
      REHEARSAL_MIX_MAIN_TRACK_ID,
      (isMetronomeOn ? TRACK_DUCKED_GAIN : TRACK_DEFAULT_GAIN) * REHEARSAL_MIX_STEM_GAIN,
    );
    setRehearsalMixTrackOutputRoute(REHEARSAL_MIX_MAIN_TRACK_ID, rehearsalMixMainOutputRoute);
  }, [
    isMetronomeOn,
    rehearsalMixIsReady,
    rehearsalMixMainOutputRoute,
    setRehearsalMixTrackOutputRoute,
    setRehearsalMixVolume,
    shouldUseRehearsalMix,
  ]);
  useEffect(() => {
    if (!shouldUseRehearsalMix) return;

    const resolvedMixDuration = Math.max(
      Number.isFinite(Number(rehearsalMixDuration)) ? Number(rehearsalMixDuration) : 0,
      fallbackTrackDuration || 0,
    );
    const resolvedMixTime = resolvedMixDuration > 0
      ? Math.min(rehearsalMixCurrentTime, resolvedMixDuration)
      : rehearsalMixCurrentTime;

    setIsPlaying(rehearsalMixIsPlaying);
    setAudioReady(rehearsalMixIsReady);
    setAudioCurrentTime((previousTime) => (
      Math.abs(previousTime - resolvedMixTime) < 0.05 ? previousTime : resolvedMixTime
    ));
    setAudioDuration((previousDuration) => (
      Math.abs(previousDuration - resolvedMixDuration) < 0.05 ? previousDuration : resolvedMixDuration
    ));
  }, [
    fallbackTrackDuration,
    rehearsalMixCurrentTime,
    rehearsalMixDuration,
    rehearsalMixIsPlaying,
    rehearsalMixIsReady,
    shouldUseRehearsalMix,
  ]);
  useEffect(() => {
    if (!shouldUseRehearsalMix || !rehearsalMixIsReady || !rehearsalMixIsPlaying) {
      return;
    }

    const resolvedMixDuration = Math.max(
      Number.isFinite(Number(rehearsalMixDuration)) ? Number(rehearsalMixDuration) : 0,
      fallbackTrackDuration || 0,
    );

    if (loopState === 2 && activeLoopSection) {
      const loopEnd = Number.isFinite(activeLoopSection.endSec)
        ? activeLoopSection.endSec
        : resolvedMixDuration;
      if (
        Number.isFinite(loopEnd) &&
        Number.isFinite(activeLoopSection.startSec) &&
        rehearsalMixCurrentTime >= Math.max(loopEnd - 0.08, activeLoopSection.startSec)
      ) {
        void seekRehearsalMixTo(activeLoopSection.startSec);
        setAudioCurrentTime(activeLoopSection.startSec);
      }
    } else if (resolvedMixDuration > 0 && rehearsalMixCurrentTime >= resolvedMixDuration - 0.05) {
      if (loopState === 1) {
        void seekRehearsalMixTo(0).then(() => playRehearsalMix());
        setAudioCurrentTime(0);
      } else {
        pauseRehearsalMix();
        setIsPlaying(false);
        setAudioCurrentTime(resolvedMixDuration);
      }
    }
  }, [
    activeLoopSection,
    fallbackTrackDuration,
    loopState,
    pauseRehearsalMix,
    playRehearsalMix,
    rehearsalMixCurrentTime,
    rehearsalMixDuration,
    rehearsalMixIsPlaying,
    rehearsalMixIsReady,
    seekRehearsalMixTo,
    shouldUseRehearsalMix,
  ]);
  const stopMetronome = React.useCallback(() => {
    metronomeService.stop();
    setIsMetronomeOn(false);
  }, []);
  const handleToggleMetronome = React.useCallback(async () => {
    if (!currentSongBpm) return;
    if (isMetronomeOn) {
      stopMetronome();
      return;
    }
    await metronomeService.start({
      tempo: currentSongBpm,
      beatsPerMeasure: 1,
      subdivision: 1,
      accentFirstBeat: false,
      resetCycle: true,
    });
    setIsMetronomeOn(true);
  }, [currentSongBpm, isMetronomeOn, stopMetronome]);
  useEffect(() => {
    if (shouldUseRehearsalMix) return undefined;

    const audioElement = audioRef.current;
    if (!audioElement) return undefined;

    return audioSessionService.registerPrimaryAudio(
      'modo-ensayo-compacto',
      {
        audioElement,
        onPlay: async () => {
          if (shouldUseTrackWebAudio) {
            await ensureWebAudioConnected();
            if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
              await audioCtxRef.current.resume();
            }
          }
          await audioElement.play();
        },
        onPause: () => {
          audioElement.pause();
        },
      },
      30
    );
  }, [ensureWebAudioConnected, processedActivePlaybackUrl, shouldUseRehearsalMix, shouldUseTrackWebAudio]);
  useEffect(() => {
    if (shouldUseTrackWebAudio) return;
    disconnectTrackWebAudio();
    setTrackGainImmediate(isMetronomeOn ? TRACK_DUCKED_GAIN : TRACK_DEFAULT_GAIN);
  }, [disconnectTrackWebAudio, isMetronomeOn, setTrackGainImmediate, shouldUseTrackWebAudio]);
  useEffect(() => {
    audioSessionService.setMetadata({
      title: currentSong?.title || 'Ensayo',
      artist: currentSong?.artist || contextTitle || 'ALABANZA App',
    });
    return () => {
      audioSessionService.resetMetadata();
    };
  }, [contextTitle, currentSong?.artist, currentSong?.id, currentSong?.title]);
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
    guideCueAudioRefs.current = guideCueAudioRefs.current.slice(0, processedGuideCueSources.length);
  }, [processedGuideCueSources.length]);
  useEffect(() => {
    getGuideCueAudioElements().forEach((element) => {
      element.volume = guideCueEnabled ? Math.max(0, Math.min(1, guideCueVolume)) : 0;
      if (!guideCueEnabled) {
        try { element.pause(); } catch { }
      }
    });
  }, [getGuideCueAudioElements, guideCueEnabled, guideCueVolume, processedGuideCueSources]);
  useEffect(() => {
    if (shouldUseRehearsalMix) return;

    if (!isPlaying) {
      pauseGuideCueTracks();
      return;
    }
    void playGuideCueTracks(audioRef.current?.currentTime || audioCurrentTime);
  }, [audioCurrentTime, guideCueEnabled, isPlaying, pauseGuideCueTracks, playGuideCueTracks, processedGuideCueSources, shouldUseRehearsalMix]);
  useEffect(() => {
    fadeTrackGainTo(
      isMetronomeOn ? TRACK_DUCKED_GAIN : TRACK_DEFAULT_GAIN,
      isMetronomeOn ? TRACK_DUCK_IN_DURATION_MS : TRACK_DUCK_OUT_DURATION_MS,
    );
  }, [fadeTrackGainTo, isMetronomeOn]);
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
    setCapoFret(0);
    setLoopState(0);
    setShowOptionsMenu(false);
    setShowPlaybackOptions(false);
    setShowChordLibrary(false);
    setTapChordPreviewEnabled(false);
    setActiveChordPreview(null);
    setChordVariationByKey({});
    setSelectedPlaybackSourceId('original');
    setGuideCueEnabled(true);
    setHeaderHidden(isLandscapeCompact);
    pauseGuideCueTracks();
    stopRehearsalMix();
    stopMetronome();
    setTrackGainImmediate(TRACK_DEFAULT_GAIN);
  }, [currentSongKey, currentSong?.mp3, isLandscapeCompact, pauseGuideCueTracks, setTrackGainImmediate, stopMetronome, stopRehearsalMix]);
  useEffect(() => () => {
    if (personalSettingsToastTimeoutRef.current) {
      window.clearTimeout(personalSettingsToastTimeoutRef.current);
      personalSettingsToastTimeoutRef.current = null;
    }
  }, []);
  useEffect(() => {
    let cancelled = false;

    personalSettingsLoadedRef.current = false;
    lastPersistedPersonalSettingsRef.current = '';
    setTransposeSteps(0);
    setCapoFret(0);

    const loadPersonalSettings = async () => {
      const loadedSettings = sanitizeRehearsalSongSettings(
        await loadRehearsalSongSettings(supabase, personalSettingsContext),
      );
      if (cancelled) return;

      setTransposeSteps(loadedSettings.transposeSteps);
      setCapoFret(loadedSettings.capoFret);
      lastPersistedPersonalSettingsRef.current = JSON.stringify(loadedSettings);
      personalSettingsLoadedRef.current = true;
      onPersonalSettingsChange?.(currentSongKey, loadedSettings);

      if (hasPersonalRehearsalSongSettings(loadedSettings)) {
        showPersonalSettingsToast(
          'Tus acordes guardados se cargaron para este domingo.',
          buildPersonalSettingsToastDetail(loadedSettings),
        );
      }
    };

    void loadPersonalSettings();

    return () => {
      cancelled = true;
    };
  }, [
    buildPersonalSettingsToastDetail,
    currentSongKey,
    onPersonalSettingsChange,
    personalSettingsContext,
    showPersonalSettingsToast,
  ]);
  useEffect(() => {
    if (!personalSettingsLoadedRef.current) return undefined;

    const nextSettings = sanitizeRehearsalSongSettings({ transposeSteps, capoFret });
    const nextSignature = JSON.stringify(nextSettings);
    if (lastPersistedPersonalSettingsRef.current === nextSignature) return undefined;

    const saveTimeout = window.setTimeout(() => {
      void saveRehearsalSongSettings(supabase, personalSettingsContext, nextSettings).then((savedSettings) => {
        const safeSettings = sanitizeRehearsalSongSettings(savedSettings);
        lastPersistedPersonalSettingsRef.current = JSON.stringify(safeSettings);
        onPersonalSettingsChange?.(currentSongKey, safeSettings);
        showPersonalSettingsToast(
          'Ajuste guardado para este domingo.',
          buildPersonalSettingsToastDetail(safeSettings, { includeNeutral: true }),
        );
      });
    }, 450);

    return () => window.clearTimeout(saveTimeout);
  }, [
    capoFret,
    buildPersonalSettingsToastDetail,
    currentSongKey,
    onPersonalSettingsChange,
    personalSettingsContext,
    showPersonalSettingsToast,
    transposeSteps,
  ]);
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
    if (!activeChordPreview || typeof window === 'undefined') return undefined;
    const handlePointerDown = (event) => {
      if (chordPreviewRef.current?.contains(event.target)) return;
      if (event.target?.closest?.('[data-chord-preview-trigger="true"]')) return;
      setActiveChordPreview(null);
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('touchstart', handlePointerDown, { passive: true });
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('touchstart', handlePointerDown);
    };
  }, [activeChordPreview]);
  useEffect(() => {
    if (!activeChordPreview || typeof window === 'undefined') return undefined;
    const closePreview = () => setActiveChordPreview(null);
    window.addEventListener('resize', closePreview);
    window.addEventListener('scroll', closePreview, true);
    return () => {
      window.removeEventListener('resize', closePreview);
      window.removeEventListener('scroll', closePreview, true);
    };
  }, [activeChordPreview]);
  useEffect(() => {
    if ((!showChordLibrary && !activeChordPreview) || typeof window === 'undefined') return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setShowChordLibrary(false);
        setActiveChordPreview(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeChordPreview, showChordLibrary]);
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
    if (shouldUseRehearsalMix) return undefined;
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
  }, [activeLoopSection, isPlaying, loopState, shouldUseRehearsalMix]);
  useEffect(() => {
    if (currentSongBpm > 0) return;
    stopMetronome();
  }, [currentSongBpm, stopMetronome]);
  useEffect(() => () => {
    cancelTrackGainFade();
    setTrackGainImmediate(TRACK_DEFAULT_GAIN);
    stopMetronome();
  }, [cancelTrackGainFade, setTrackGainImmediate, stopMetronome]);
  const progressPercent = useMemo(() => {
    if (!timelineDuration) return 0;
    return Math.min(100, Math.max(0, (audioCurrentTime / timelineDuration) * 100));
  }, [audioCurrentTime, timelineDuration]);
  const handleGoBack = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    stopRehearsalMix();
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
    if (shouldUseRehearsalMix) return;
    if (!hasAudio || !audioRef.current) return;
    const audioElement = audioRef.current;
    window.requestAnimationFrame(() => {
      syncAudioMetrics(audioElement);
    });
  }, [hasAudio, processedActivePlaybackUrl, shouldUseRehearsalMix]);
  useEffect(() => {
    if (shouldUseRehearsalMix) {
      if (!pendingPlaybackResumeRef.current || !rehearsalMixIsReady) return;
      pendingPlaybackResumeRef.current = false;
      playRehearsalMix().catch(() => {
        setIsPlaying(false);
      });
      return;
    }

    if (!pendingPlaybackResumeRef.current || !audioReady || !audioRef.current) return;
    pendingPlaybackResumeRef.current = false;
    audioRef.current.play().then(() => {
      void playGuideCueTracks(audioRef.current?.currentTime || audioCurrentTime);
      scheduleGuideCueResync();
    }).catch(() => {
      setIsPlaying(false);
    });
  }, [
    audioCurrentTime,
    audioReady,
    playGuideCueTracks,
    playRehearsalMix,
    rehearsalMixIsReady,
    scheduleGuideCueResync,
    shouldUseRehearsalMix,
  ]);
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
        if (syncRole === 'director') {
          pushSyncSnapshot();
        }
      }
    });
    syncChannelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
    };
  }, [pushSyncSnapshot, syncRole]);
  useEffect(() => {
    if (syncRole !== 'director' || !syncChannelRef.current) return undefined;

    pushSyncSnapshot({
      songId: currentSongKey,
      sectionIndex: activeSectionIndex,
      currentTime: syncSnapshotRef.current.currentTime,
      isPlaying,
    });

    const heartbeat = window.setInterval(() => {
      pushSyncSnapshot();
    }, 700);

    return () => {
      window.clearInterval(heartbeat);
    };
  }, [activeSectionIndex, currentSongKey, isPlaying, pushSyncSnapshot, syncRole]);
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

    const {
      songId,
      sectionIndex,
      currentTime,
      currentTimeRaw,
      sectionOffsetSeconds,
    } = remotePayload;
    const offsetSeconds = Number.isFinite(Number(sectionOffsetSeconds)) ? Number(sectionOffsetSeconds) : 0;
    const directorTime =
      typeof currentTimeRaw === 'number'
        ? Math.max(0, currentTimeRaw)
        : typeof currentTime === 'number'
          ? Math.max(0, currentTime + offsetSeconds)
          : null;

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
    if (marker && seekAudio) {
      if (shouldUseRehearsalMix) {
        void seekRehearsalMixTo(marker.startSec);
        setAudioCurrentTime(marker.startSec);
      } else if (audioRef.current) {
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
              syncGuideCueTracks(marker.startSec, { force: true });
            }
            // Micro Fade-in de 150ms tras el salto
            gainNode.gain.cancelScheduledValues(ctx.currentTime);
            gainNode.gain.setValueAtTime(0, ctx.currentTime);
            gainNode.gain.linearRampToValueAtTime(trackTargetGainRef.current, ctx.currentTime + 0.15);
          }, 150);
        } else {
          // Fallback si Web Audio no está inicializado
          audioRef.current.currentTime = marker.startSec;
          setAudioCurrentTime(marker.startSec);
          syncGuideCueTracks(marker.startSec, { force: true });
        }
      }
    }
    window.requestAnimationFrame(() => {
      scrollToSectionIndex(index, scrollBehavior);
    });
  };
  const handleTogglePlayback = async () => {
    if (!hasAudio) return;
    if (shouldUseRehearsalMix) {
      if (!rehearsalMixIsReady) return;
      try {
        if (rehearsalMixIsPlaying) {
          pauseRehearsalMix();
        } else {
          if (audioDuration > 0 && audioCurrentTime >= audioDuration - 0.05) {
            await seekRehearsalMixTo(0);
            setAudioCurrentTime(0);
          }
          await playRehearsalMix();
        }
      } catch (_error) {
        setIsPlaying(false);
      }
      return;
    }
    if (!audioRef.current) return;

    try {
      if (audioRef.current.paused) {
        await ensureWebAudioConnected();
        if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
          await audioCtxRef.current.resume();
        }
        const startTime = audioRef.current.currentTime || audioCurrentTime;
        syncGuideCueTracks(startTime, { force: true });
        const results = await Promise.allSettled([
          audioRef.current.play(),
          playGuideCueTracks(startTime),
        ]);
        const mainPlayback = results[0];
        if (mainPlayback.status === 'rejected') {
          throw mainPlayback.reason;
        }
        scheduleGuideCueResync();
      } else {
        audioRef.current.pause();
        pauseGuideCueTracks();
      }
    } catch (_error) {
      setIsPlaying(false);
    }
  };
  const handleSeekChange = (event) => {
    const nextTime = Number(event.target.value || 0);
    setAudioCurrentTime(nextTime);
    if (shouldUseRehearsalMix) {
      void seekRehearsalMixTo(nextTime);
      return;
    }
    if (audioRef.current) {
      audioRef.current.currentTime = nextTime;
    }
    syncGuideCueTracks(nextTime, { force: true });
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
    stopRehearsalMix();
    pauseGuideCueTracks();
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
        key={`${currentSongKey}-${selectedPlaybackSourceId}-${processedActivePlaybackUrl || activePlaybackUrl || 'no-audio'}`}
        ref={audioRef}
        src={!shouldUseRehearsalMix && hasAudio ? (processedActivePlaybackUrl || activePlaybackUrl) : undefined}
        crossOrigin="anonymous"
        preload="metadata"
        playsInline
        onLoadedMetadata={(event) => syncAudioMetrics(event.currentTarget)}
        onLoadedData={(event) => syncAudioMetrics(event.currentTarget)}
        onDurationChange={(event) => syncAudioMetrics(event.currentTarget)}
        onCanPlay={(event) => syncAudioMetrics(event.currentTarget)}
        onTimeUpdate={(event) => {
          const nextTime = Number.isFinite(event.currentTarget.currentTime) ? event.currentTarget.currentTime : 0;
          setAudioCurrentTime(nextTime);
          syncGuideCueTracks(nextTime);
        }}
        onPlay={(event) => {
          setIsPlaying(true);
          void playGuideCueTracks(event.currentTarget.currentTime || audioCurrentTime);
          scheduleGuideCueResync();
        }}
        onPause={() => {
          setIsPlaying(false);
          pauseGuideCueTracks();
        }}
        onEnded={async () => {
          if (loopState === 1 && audioRef.current) {
            audioRef.current.currentTime = 0;
            setAudioCurrentTime(0);
            syncGuideCueTracks(0, { force: true });
            try {
              await audioRef.current.play();
              await playGuideCueTracks(0);
              return;
            } catch (_error) {
              // keep regular ended fallback
            }
          }
          setIsPlaying(false);
          pauseGuideCueTracks();
          const finalTime = Number.isFinite(audioRef.current?.duration) ? audioRef.current.duration : 0;
          setAudioCurrentTime(finalTime || 0);
        }}
        onError={() => {
          setAudioReady(false);
          setAudioDuration(0);
        }}
      />
      {!shouldUseRehearsalMix && processedGuideCueSources.map((source, index) => (
        <audio
          key={`${currentSongKey}-${source.id}-${source.playbackUrl || source.url}`}
          ref={(element) => {
            guideCueAudioRefs.current[index] = element;
          }}
          src={source.playbackUrl || source.url}
          crossOrigin="anonymous"
          preload="metadata"
          playsInline
        />
      ))}
      <audio
        key={`pad-${activePadUrl}`}
        ref={padAudioRef}
        src={activePadUrl || undefined}
        loop
        preload="auto"
      />
      {personalSettingsToast && (
        <div
          className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[80] flex justify-center px-4"
          aria-live="polite"
        >
          <div className="max-w-[min(92vw,28rem)] rounded-2xl border border-zinc-200/85 bg-white/96 px-5 py-3.5 text-center text-base font-black leading-snug text-zinc-800 shadow-[0_18px_60px_rgba(15,23,42,0.18)] backdrop-blur-xl sm:text-[17px] dark:border-white/10 dark:bg-zinc-950/96 dark:text-zinc-100">
            <div>{personalSettingsToast.title}</div>
            {personalSettingsToast.detail && (
              <div className="mt-1.5 text-sm font-extrabold leading-tight text-brand sm:text-[15px] dark:text-brand-light">
                {personalSettingsToast.detail}
              </div>
            )}
          </div>
        </div>
      )}
      <header
        ref={headerRef}
        className={`absolute inset-x-0 top-0 z-30 border-b border-zinc-200/70 bg-white/92 backdrop-blur-xl dark:border-white/8 dark:bg-zinc-950/96 transition-transform duration-300 ${headerHidden ? '-translate-y-full' : 'translate-y-0'
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
              className={`ensayo-control-chip flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border transition-all ${syncRole === 'director'
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
              className={`ensayo-control-chip ensayo-bpm-chip relative inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl border bg-white text-zinc-900 shadow-sm transition-colors dark:bg-zinc-900 dark:text-zinc-50 ${currentSongBpm
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
                className={`ensayo-control-chip flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-900 shadow-sm transition-colors hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800 ${showOptionsMenu ? 'ring-2 ring-brand/20 border-brand/30' : ''
                  }`}
                aria-label="Opciones de ensayo"
                aria-expanded={showOptionsMenu}
                title="Opciones"
              >
                <SlidersHorizontal className="h-4.5 w-4.5" />
              </button>
              {showOptionsMenu && (
                <div className="absolute right-0 top-[calc(100%+0.55rem)] z-50 flex max-h-[min(30rem,calc(100vh-6rem))] w-[16.25rem] flex-col gap-3 overflow-y-auto rounded-[1.35rem] border border-zinc-200/85 bg-white/96 p-3 shadow-[0_18px_50px_rgba(15,23,42,0.22)] backdrop-blur-xl [scrollbar-width:none] dark:border-white/10 dark:bg-zinc-950/96 [&::-webkit-scrollbar]:hidden">
                  {/* Tono */}
                  {originalSongKey !== '-' && (
                    <div>
                      <div className="mb-2 flex items-center justify-between gap-2 px-1">
                        <p className="text-[0.72rem] font-black uppercase tracking-[0.28em] text-zinc-500 dark:text-zinc-400">
                          Tonalidad
                        </p>
                        <span className="rounded-full border border-zinc-200/80 bg-zinc-100/80 px-2 py-1 text-[0.72rem] font-black leading-none text-zinc-700 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200">
                          {formatChordAccidentals(currentSongDisplayKey)}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {transposeKeyOptions.map((option, optionIndex) => {
                          const active = option.steps === transposeSteps;
                          return (
                            <button
                              key={`transpose-option-${option.steps}-${optionIndex}`}
                              type="button"
                              onClick={() => setTransposeSteps(option.steps)}
                              className={`rounded-[0.85rem] border px-2 py-2.5 text-center text-sm font-black leading-none transition-all ${active
                                ? 'border-brand bg-brand text-white shadow-[0_8px_20px_rgba(59,130,246,0.32)]'
                                : 'border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300 hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800'
                                }`}
                              aria-pressed={active}
                            >
                              {formatChordAccidentals(option.label)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {/* Tamaño */}
                  {originalSongKey !== '-' && songChordTokens.length > 0 && (
                    <div>
                      <div className="mb-2 flex items-start justify-between gap-2 px-1">
                        <div className="min-w-0">
                          <p className="text-[0.72rem] font-black uppercase tracking-[0.28em] text-zinc-500 dark:text-zinc-400">
                            Capo
                          </p>
                          <p className="mt-1 text-[0.68rem] font-semibold leading-tight text-zinc-500 dark:text-zinc-400">
                            {capoFret > 0
                              ? `Suena ${formatChordAccidentals(currentSongDisplayKey)} · Tocas ${formatChordAccidentals(capoShapeKey)}`
                              : `Sin capo · Tocas ${formatChordAccidentals(currentSongDisplayKey)}`}
                          </p>
                        </div>
                        {recommendedCapoOption && (
                          <span className="shrink-0 rounded-full border border-amber-300/70 bg-amber-400/12 px-2 py-1 text-[0.62rem] font-black uppercase tracking-[0.12em] text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/12 dark:text-amber-200">
                            Sug {recommendedCapoOption.fret}
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {capoOptions.map((option) => {
                          const active = option.fret === capoFret;
                          const suggested = option.fret > 0 && option.fret === recommendedCapoOption?.fret;
                          return (
                            <button
                              key={`capo-option-${option.fret}`}
                              type="button"
                              onClick={() => setCapoFret(option.fret)}
                              className={`relative flex min-h-[3.7rem] flex-col items-start justify-between rounded-[0.95rem] border px-2.5 py-2 text-left transition-all ${active
                                ? 'border-brand bg-brand text-white shadow-[0_8px_20px_rgba(59,130,246,0.32)]'
                                : suggested
                                  ? 'border-amber-300/70 bg-amber-400/10 text-zinc-900 shadow-[0_8px_18px_rgba(245,158,11,0.16)] dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-zinc-50'
                                  : 'border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300 hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800'
                                }`}
                              aria-pressed={active}
                              title={option.fret === 0 ? 'Sin capo' : `Capo ${option.fret}`}
                            >
                              <div className="flex w-full items-center justify-between gap-2">
                                <span className={`text-[0.62rem] font-black uppercase tracking-[0.18em] ${active ? 'text-white/80' : 'text-zinc-500 dark:text-zinc-400'}`}>
                                  {option.fret === 0 ? 'Off' : `C${option.fret}`}
                                </span>
                                {suggested && !active && (
                                  <span className="rounded-full bg-amber-500/14 px-1.5 py-0.5 text-[0.5rem] font-black uppercase tracking-[0.08em] text-amber-700 dark:text-amber-200">
                                    Sug
                                  </span>
                                )}
                              </div>
                              <span className={`text-lg font-black leading-none ${active ? 'text-white' : ''}`}>
                                {formatChordAccidentals(option.shapeKey)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowOptionsMenu(false);
                        setChordLibraryInstrument('guitar');
                        setShowChordLibrary(true);
                      }}
                      disabled={currentChordLibrary.length === 0}
                      className={`flex w-full items-center justify-between gap-3 rounded-[1rem] border px-4 py-4.5 text-left transition-all ${currentChordLibrary.length > 0
                        ? 'border-zinc-200 bg-white text-zinc-900 hover:border-brand/35 hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800'
                        : 'cursor-not-allowed border-zinc-200/70 bg-zinc-50 text-zinc-400 dark:border-white/10 dark:bg-zinc-900/60 dark:text-zinc-500'
                        }`}
                    >
                      <span className="min-w-0">
                        <span className="block text-base font-black leading-tight">
                          Ver acordes
                        </span>
                      </span>
                      <ChevronRight className="h-5 w-5 shrink-0 text-zinc-400 dark:text-zinc-500" />
                    </button>
                    <button
                      type="button"
                      onClick={toggleTapChordPreview}
                      disabled={currentChordLibrary.length === 0}
                      className={`flex w-full items-center justify-between gap-3 rounded-[1rem] border px-4 py-3.5 text-left transition-all ${currentChordLibrary.length === 0
                        ? 'cursor-not-allowed border-zinc-200/70 bg-zinc-50 text-zinc-400 dark:border-white/10 dark:bg-zinc-900/60 dark:text-zinc-500'
                        : tapChordPreviewEnabled
                          ? 'border-brand/35 bg-brand/10 text-brand dark:border-brand/45 dark:bg-brand/15'
                          : 'border-zinc-200 bg-white text-zinc-900 hover:border-brand/35 hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800'
                        }`}
                      aria-pressed={tapChordPreviewEnabled}
                    >
                      <span className="min-w-0">
                        <span className="block text-base font-black leading-tight">
                          Mostrar al tocar
                        </span>
                      </span>
                      <span className={`shrink-0 text-[0.62rem] font-black uppercase tracking-[0.16em] ${tapChordPreviewEnabled ? 'text-brand' : 'text-zinc-400 dark:text-zinc-500'}`}>
                        {tapChordPreviewEnabled ? 'Activo' : 'Off'}
                      </span>
                    </button>
                    <div className={`grid grid-cols-2 gap-1 rounded-[0.85rem] bg-zinc-100 p-1 dark:bg-zinc-900 ${currentChordLibrary.length === 0 ? 'opacity-50' : ''}`}>
                      {[
                        ['guitar', 'Guitarra'],
                        ['piano', 'Piano'],
                      ].map(([instrument, label]) => {
                        const active = tapChordPreviewEnabled && tapChordPreviewInstrument === instrument;
                        return (
                          <button
                            key={`tap-preview-${instrument}`}
                            type="button"
                            onClick={() => selectTapChordPreviewInstrument(instrument)}
                            disabled={currentChordLibrary.length === 0}
                            className={`rounded-[0.68rem] px-2 py-2 text-sm font-black transition-all ${active
                              ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50'
                              : 'text-zinc-500 hover:text-zinc-800 disabled:cursor-not-allowed dark:text-zinc-400 dark:hover:text-zinc-200'
                              }`}
                            aria-pressed={active}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
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
                            className={`rounded-[0.9rem] border px-3 py-2.5 text-center font-black leading-none transition-all ${size === 'grande' ? 'text-sm' : 'text-base'
                              } ${active
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
                className={`relative inline-block w-full break-inside-avoid-column self-start overflow-visible rounded-[1.02rem] border border-zinc-200/90 px-3.5 pb-3.5 pt-4 shadow-sm transition-all ${sectionIndex === 0 ? 'mt-2 mb-5 xl:mt-3 xl:mb-6' : 'mb-5 xl:mb-6'
                  } dark:border-white/10 ${isActiveSection
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
                        className={`max-w-[10rem] truncate rounded-full bg-white px-2 py-[0.18rem] text-[13px] font-medium tracking-[0.08em] dark:bg-zinc-950 ${isActiveSection ? '' : 'text-zinc-400 dark:text-zinc-500'
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
                                tapChordPreviewEnabled ? (
                                  <ClickableChordToken
                                    key={`${section.name}-${lineIndex}-chord-${chordIndex}`}
                                    chord={chord}
                                    sizeClass={`font-mono ${fontPreset.chord}`}
                                    onChordPreview={handleChordPreviewOpen}
                                  />
                                ) : (
                                  <ChordDisplay
                                    key={`${section.name}-${lineIndex}-chord-${chordIndex}`}
                                    chord={chord}
                                    sizeClass={`font-mono ${fontPreset.chord}`}
                                  />
                                )
                              ))}
                            </div>
                          )}
                          {renderedLine.mode === 'overlay' && (
                            <ChordOverlayLine
                              renderedLine={renderedLine}
                              fontPreset={fontPreset}
                              lineKey={`${section.name}-${lineIndex}`}
                              interactiveChords={tapChordPreviewEnabled}
                              onChordPreview={handleChordPreviewOpen}
                            />
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
                      className={`shrink-0 rounded-full border px-3.5 py-2 text-sm font-bold transition-colors ${active
                        ? 'border-brand bg-brand text-white shadow-[0_8px_18px_rgba(59,130,246,0.24)]'
                        : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800'
                        }`}
                      aria-pressed={active}
                    >
                      {source.label}
                    </button>
                  );
                })}
                {!hasSupplementalPlaybackSources && (
                  <div className="shrink-0 rounded-full border border-dashed border-zinc-300 bg-zinc-50 px-3.5 py-2 text-sm font-semibold text-zinc-500 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-400">
                    Secuencia no disponible
                  </div>
                )}
              </div>
              {hasGuideCueSources && (
                <div className="mt-4 border-t border-zinc-200/60 pt-3 dark:border-white/10">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[0.66rem] font-black uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">
                        Apoyo de ensayo
                      </p>
                      <p className="truncate text-sm font-bold text-zinc-800 dark:text-zinc-100">
                        {guideCueDisplayLabel}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setGuideCueEnabled((current) => !current)}
                      className={`rounded-full px-3 py-1 text-xs font-bold transition-all ${guideCueEnabled
                        ? 'bg-brand text-white shadow-sm'
                        : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
                        }`}
                      aria-pressed={guideCueEnabled}
                    >
                      {guideCueEnabled ? 'ON' : 'OFF'}
                    </button>
                  </div>
                  <div className="flex items-center gap-3 rounded-xl bg-zinc-50 px-3 py-2 dark:bg-zinc-950/50">
                    <span className="w-10 text-xs font-bold text-zinc-400">Vol</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={guideCueVolume}
                      onChange={(event) => setGuideCueVolume(parseFloat(event.target.value))}
                      className="ensayo-seek h-4 flex-1 cursor-pointer appearance-none bg-transparent"
                      aria-label={`Volumen ${guideCueDisplayLabel}`}
                    />
                    <span className="w-9 text-right text-xs font-black text-zinc-500 dark:text-zinc-400">
                      {Math.round(guideCueVolume * 100)}
                    </span>
                  </div>
                </div>
              )}
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
                      className={`rounded-full px-3 py-1 text-xs font-bold transition-all ${isPadActive
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
            disabled={!hasAudio || (shouldUseRehearsalMix && !audioReady)}
            className={`ensayo-footer-play flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg transition-transform active:scale-95 ${hasAudio && (!shouldUseRehearsalMix || audioReady) ? 'bg-action' : 'bg-zinc-500/50 cursor-not-allowed shadow-none'}`}
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
            {shouldUseRehearsalMix && rehearsalMixLoadProgress && (
              <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400" aria-live="polite">
                Preparando mezcla {rehearsalMixLoadProgress.loaded}/{rehearsalMixLoadProgress.total}
              </p>
            )}
          </div>
          <div className="ensayo-footer-actions flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setLoopState((prev) => ((prev + 1) % 3))}
              className={`ensayo-footer-icon relative flex h-10 w-10 items-center justify-center rounded-2xl border transition-colors ${loopState
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
              className={`ensayo-footer-icon flex h-10 w-10 items-center justify-center rounded-2xl border transition-colors ${showPlaybackOptions
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
      {showChordLibrary && (
        <ChordLibraryModal
          chords={currentChordLibrary}
          instrument={chordLibraryInstrument}
          onInstrumentChange={setChordLibraryInstrument}
          variationByChord={chordVariationByKey}
          onVariationChange={(key, index) => setChordVariationByKey((current) => ({
            ...current,
            [key]: index,
          }))}
          onClose={() => setShowChordLibrary(false)}
        />
      )}
      {activeChordPreview && (
        <ChordPreviewPopover
          preview={activeChordPreview}
          instrument={tapChordPreviewInstrument}
          variationByChord={chordVariationByKey}
          onVariationChange={(key, index) => setChordVariationByKey((current) => ({
            ...current,
            [key]: index,
          }))}
          previewRef={chordPreviewRef}
        />
      )}
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
