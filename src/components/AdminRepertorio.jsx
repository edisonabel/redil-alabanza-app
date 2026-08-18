import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import AdminVocalWarmups from './AdminVocalWarmups';
import { audioSessionService } from '../services/AudioSessionService';
import {
  Check,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileAudio,
  FileText,
  FolderOpen,
  ListPlus,
  Loader2,
  MessageSquarePlus,
  Mic2,
  Music2,
  Pause,
  PencilLine,
  Play,
  Plus,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react';
import { splitSectionIntoCues } from '../utils/splitSectionIntoCues';
import {
  buildChordProSectionBlock,
  buildNextChordProCueCapture,
  buildSuggestedSectionLabel,
  CHORDPRO_GUIDE_PRESETS,
  CHORDPRO_SECTION_PRESETS,
  getChordProSectionVisual,
  insertChordProSectionAfterIndex,
  isLegacyZeroFilledChordProMarkerSet,
  mergeChordProGuideNote,
  normalizeOptionalChordProMarkerTime,
  parseChordProMetadata,
  removeChordProGuideNote,
  splitChordProGuideNote,
  updateChordProSectionNoteAtIndex,
} from '../utils/chordProAuthoring';

const { useRef } = React;

const SECTION_LABEL_RE = /^\s*\[([^\]]+)\]\s*(.*)$/;
const PURE_SECTION_HEADER_RE = /^\[([^\[\]]+)\]$/;
const CHORD_BODY_PATTERN = '[A-G](?:#|b)?(?:[a-z0-9+#°ø()\\-]*)?(?:\\/[A-G](?:#|b)?(?:[a-z0-9+#°ø()\\-]*)?)?';
const CHORD_TOKEN_RE = new RegExp(`^\\(?\\s*(\\[${CHORD_BODY_PATTERN}\\]\\s*)+\\)?\\s*$`, 'i');
const CHORD_SYMBOL_RE = new RegExp(`^${CHORD_BODY_PATTERN}$`, 'i');
const LEADING_CHORD_SECTION_RE = new RegExp(`^\\[(${CHORD_BODY_PATTERN})\\|`, 'i');
const BROKEN_INLINE_CHORD_RE = new RegExp(`\\[(${CHORD_BODY_PATTERN})\\s*\\|\\s*`, 'gi');
const EDITOR_MODAL_MAX_HEIGHT = 'min(94vh, calc(100dvh - 4.75rem - env(safe-area-inset-bottom)))';
const ARCHIVO_ELIMINABLE_FIELDS = new Set(['mp3', 'link_acordes']);
const CANCIONES_SELECT_BASE = 'id, titulo, cantante, tonalidad, bpm, categoria, voz, tema, estado, link_youtube, mp3, link_acordes, link_letras, voces, link_voces, link_secuencias, chordpro, multitrack_session';
const SONG_WIZARD_STEPS = [
  { label: 'Canción', shortLabel: 'Canción' },
  { label: 'Música', shortLabel: 'Música' },
  { label: 'Organización', shortLabel: 'Orden' },
  { label: 'Adicionales', shortLabel: 'Extras' },
];
const INITIAL_SONG_WIZARD_DRAFT = {
  titulo: '',
  cantante: '',
  tonalidad: '',
  bpm: '',
  metrica: '',
  categoria: '',
  voz: '',
  tema: '',
  estado: 'Activa',
  link_youtube: '',
};

const songToWizardDraft = (song = {}) => ({
  titulo: String(song?.titulo || ''),
  cantante: String(song?.cantante || ''),
  tonalidad: String(song?.tonalidad || ''),
  bpm: String(song?.bpm || ''),
  metrica: String(song?.metrica || getSongMeter(song) || ''),
  categoria: String(song?.categoria || ''),
  voz: String(song?.voz || song?.voz_principal || ''),
  tema: String(song?.tema || ''),
  estado: String(song?.estado || 'Activa'),
  link_youtube: String(song?.link_youtube || ''),
});

const buildSongWizardPayload = (draft = {}, includeMeter = true) => {
  const fields = [
    'titulo',
    'cantante',
    'tonalidad',
    'bpm',
    'categoria',
    'voz',
    'tema',
    'estado',
    'link_youtube',
  ];
  const payload = fields.reduce((result, field) => ({
    ...result,
    [field]: String(draft?.[field] || '').trim() || null,
  }), {});

  if (includeMeter) {
    payload.metrica = String(draft?.metrica || '').trim() || null;
  }

  return payload;
};

const normalizeSearchText = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const sortSongsByTitle = (songs = []) => [...songs].sort((left, right) => (
  String(left?.titulo || '').localeCompare(String(right?.titulo || ''), 'es', { sensitivity: 'base' })
));

const getSongResourceCount = (song = {}) => [
  song?.mp3,
  song?.link_acordes,
  song?.link_letras,
  song?.link_voces || song?.voces,
  song?.link_secuencias,
  hasMeaningfulChordProContent(song?.chordpro) ? song?.chordpro : '',
].filter((value) => String(value || '').trim()).length;

const getSectionColorStyle = (sectionName = '', active = false) => {
  const visual = getChordProSectionVisual(sectionName);
  const rgbValues = visual.rgb;
  const rgb = rgbValues.join(', ');
  const colorWeight = active ? 0.34 : 0.24;
  const pastel = rgbValues.map((channel) => (
    Math.round((channel * colorWeight) + (255 * (1 - colorWeight)))
  ));

  return {
    color: '#0f172a',
    backgroundColor: `rgb(${pastel.join(', ')})`,
    borderColor: 'transparent',
    boxShadow: active ? `0 0 0 2px rgba(${rgb}, 0.24)` : 'none',
  };
};

const getSectionDotStyle = (sectionName = '') => {
  const rgb = getChordProSectionVisual(sectionName).rgb.join(', ');
  return {
    backgroundColor: `rgb(${rgb})`,
    boxShadow: `0 0 0 3px rgba(${rgb}, 0.14)`,
  };
};

const getSectionCardStyle = (sectionName = '') => {
  const rgb = getChordProSectionVisual(sectionName).rgb.join(', ');
  return {
    borderLeftColor: `rgb(${rgb})`,
    backgroundImage: `linear-gradient(90deg, rgba(${rgb}, 0.07), transparent 34%)`,
  };
};

const normalizeSectionName = (rawValue = '') => {
  const cleaned = String(rawValue).trim();
  if (!cleaned) return 'Seccion';

  const normalized = cleaned.toLowerCase();
  if (normalized === 'soc' || normalized === 'start_of_chorus') return 'Coro';
  if (normalized === 'sov' || normalized === 'start_of_verse') return 'Verso';
  if (normalized === 'sob' || normalized === 'start_of_bridge') return 'Puente';
  if (normalized === 'soi' || normalized === 'start_of_intro') return 'Intro';
  if (normalized === 'interlude' || normalized === 'interludio' || normalized === 'start_of_interlude') return 'Interludio';
  if (normalized === 'instrumental' || /^instrumental\s+\d+$/.test(normalized)) return cleaned;
  if (normalized === 'solo instrumental' || normalized === 'solo') return 'Solo';
  if (normalized === 'sot' || normalized === 'start_of_tag') return 'Tag';
  if (normalized === 'eoc' || normalized === 'end_of_chorus') return '';
  if (normalized === 'eov' || normalized === 'end_of_verse') return '';
  if (normalized === 'eob' || normalized === 'end_of_bridge') return '';
  if (normalized === 'eoi' || normalized === 'end_of_intro') return '';
  if (normalized === 'eot' || normalized === 'end_of_tag') return '';

  return cleaned;
};

const isLikelySectionHeader = (rawHeader = '') => {
  const cleaned = String(rawHeader || '').trim();
  if (!cleaned) return false;

  const normalized = cleaned.toLowerCase();
  if ([
    'intro',
    'interlude',
    'interludio',
    'instrumental',
    'solo',
    'solo instrumental',
    'coro',
    'chorus',
    'pre coro',
    'pre-coro',
    'verse',
    'verso',
    'puente',
    'bridge',
    'tag',
    'outro',
    'final',
  ].some((label) => normalized.startsWith(label))) {
    return true;
  }

  if (CHORD_SYMBOL_RE.test(cleaned)) return false;
  return /\d/.test(cleaned);
};

const isRemoteChordProTextUrl = (value = '') => (
  /^https?:\/\//i.test(String(value || '').trim()) &&
  /\.(txt|pro|cho|chordpro)(\?.*)?$/i.test(String(value || '').trim())
);

const parseSectionHeader = (rawHeader = '') => {
  const cleaned = String(rawHeader || '').trim();
  if (!cleaned) {
    return { name: 'Seccion', note: '' };
  }

  const [rawName, ...rawNoteParts] = cleaned.split('|');
  return {
    name: normalizeSectionName(rawName.trim()) || 'Seccion',
    note: rawNoteParts.join('|').trim(),
  };
};

const repararChordProCorrupto = (rawValue = '') => {
  if (!rawValue || typeof rawValue !== 'string') return '';

  return String(rawValue)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => {
      let fixedLine = line;

      if (LEADING_CHORD_SECTION_RE.test(fixedLine) || BROKEN_INLINE_CHORD_RE.test(fixedLine)) {
        fixedLine = fixedLine.replace(LEADING_CHORD_SECTION_RE, '[$1]');
        fixedLine = fixedLine.replace(BROKEN_INLINE_CHORD_RE, '[$1]');
        fixedLine = fixedLine.replace(/(?:\s*\|\s*)+\]+\s*$/, '');
      }

      BROKEN_INLINE_CHORD_RE.lastIndex = 0;
      return fixedLine;
    })
    .join('\n');
};

const normalizarChordPro = (rawValue) => {
  if (!rawValue || typeof rawValue !== 'string') return '';

  return repararChordProCorrupto(rawValue)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .flatMap((line) => {
      const trimmedLine = line.trimEnd();
      const sectionMatch = trimmedLine.match(SECTION_LABEL_RE);

      if (!sectionMatch) return [trimmedLine];

      const [, sectionName = '', rest = ''] = sectionMatch;
      if (!isLikelySectionHeader(sectionName)) {
        return [trimmedLine];
      }

      const parsedSection = parseSectionHeader(sectionName);
      const normalizedSection = parsedSection.note
        ? `[${parsedSection.name}|${parsedSection.note}]`
        : `[${parsedSection.name}]`;
      const normalizedRest = rest.trim();

      if (!normalizedRest) return [normalizedSection];

      if (CHORD_TOKEN_RE.test(normalizedRest)) {
        return [normalizedSection, normalizedRest.replace(/\s{2,}/g, ' ').trim()];
      }

      return [`[${parsedSection.name}|${parsedSection.note ? `${parsedSection.note} | ${normalizedRest}` : normalizedRest}]`];
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const parseChordProSections = (rawChordpro = '') => {
  const content = String(rawChordpro || '').replace(/\r\n/g, '\n').trim();
  if (!content) return [];

  const sections = [];
  let currentSection = { name: 'Letra', note: '', lines: [] };

  const pushCurrentSection = () => {
    const sectionName = String(currentSection.name || '').trim();
    const shouldKeepEmptyNamedSection = sectionName && sectionName.toLowerCase() !== 'letra';
    if (currentSection.lines.length === 0 && !currentSection.note && !shouldKeepEmptyNamedSection) return;
    sections.push({
      name: sectionName || 'Letra',
      note: currentSection.note || '',
      lines: [...currentSection.lines],
    });
  };

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) continue;

    const inlineSectionMatch = trimmed.match(SECTION_LABEL_RE);
    if (inlineSectionMatch && isLikelySectionHeader(inlineSectionMatch[1])) {
      pushCurrentSection();
      const nextSection = parseSectionHeader(inlineSectionMatch[1]);
      const inlineRest = String(inlineSectionMatch[2] || '').trim();

      currentSection = {
        name: nextSection.name,
        note: nextSection.note,
        lines: [],
      };

      if (inlineRest) {
        if (CHORD_TOKEN_RE.test(inlineRest)) {
          currentSection.lines.push(inlineRest.replace(/\s{2,}/g, ' ').trim());
        } else {
          currentSection.note = currentSection.note
            ? `${currentSection.note} | ${inlineRest}`
            : inlineRest;
        }
      }
      continue;
    }

    const sectionLineMatch = trimmed.match(PURE_SECTION_HEADER_RE);
    if (sectionLineMatch && isLikelySectionHeader(sectionLineMatch[1])) {
      pushCurrentSection();
      const nextSection = parseSectionHeader(sectionLineMatch[1]);
      currentSection = {
        name: nextSection.name,
        note: nextSection.note,
        lines: [],
      };
      continue;
    }

    const directiveMatch = trimmed.match(/^\{([^}:]+)(?::\s*(.+))?\}$/);
    if (directiveMatch) {
      const rawDirectiveName = String(directiveMatch[1] || '').trim();
      const directiveKey = rawDirectiveName.toLowerCase();
      const directiveName = normalizeSectionName(rawDirectiveName);
      const directiveValue = directiveMatch[2]?.trim() || '';

      if ([
        'title',
        'artist',
        'subtitle',
        'key',
        'tono',
        'tonalidad',
        'tempo',
        'bpm',
        'time',
        'meter',
        'metrica',
        'métrica',
        'compas',
        'compás',
        'meta',
        'capo',
      ].includes(directiveKey)) {
        continue;
      }

      if (directiveKey === 'comment' || directiveKey === 'c') {
        if (!currentSection.note && directiveValue) {
          currentSection.note = directiveValue;
        } else if (directiveValue) {
          currentSection.lines.push(directiveValue);
        }
        continue;
      }

      if (directiveName) {
        pushCurrentSection();
        const nextSection = parseSectionHeader(directiveValue || directiveName);
        currentSection = {
          name: nextSection.name,
          note: nextSection.note,
          lines: [],
        };
      }
      continue;
    }

    currentSection.lines.push(line);
  }

  pushCurrentSection();
  return sections;
};

const ChordProEditorHighlight = React.forwardRef(function ChordProEditorHighlight(
  { value },
  highlightRef,
) {
  const lines = String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  return (
    <pre
      ref={highlightRef}
      aria-hidden="true"
      className="editor-column-scroll editor-chordpro-surface editor-chordpro-highlight pointer-events-none absolute inset-0 m-0 overflow-y-scroll border-0 bg-transparent px-3 py-3 text-content font-mono"
    >
      {lines.map((line, lineIndex) => {
        const sectionMatch = line.trim().match(SECTION_LABEL_RE);
        const isSection = sectionMatch && isLikelySectionHeader(sectionMatch[1]);
        const lineBreak = lineIndex < lines.length - 1 ? '\n' : '';

        if (!isSection) {
          return (
            <React.Fragment key={`chordpro-line-${lineIndex}`}>
              {line || ' '}
              {lineBreak}
            </React.Fragment>
          );
        }

        const section = parseSectionHeader(sectionMatch[1]);
        const inlineRest = String(sectionMatch[2] || '').trim();
        const supportingText = [section.note, inlineRest].filter(Boolean).join(' · ');

        return (
          <React.Fragment key={`chordpro-section-${lineIndex}`}>
            <span
              className="editor-chordpro-section-pill inline-flex items-center gap-1.5 rounded-full px-2 font-sans text-[11px] font-normal"
              style={getSectionColorStyle(section.name)}
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={getSectionDotStyle(section.name)}
              />
              {section.name}
            </span>
            {supportingText && (
              <span className="editor-chordpro-section-support font-sans text-[11px] italic text-content-muted">
                {`  ${supportingText}`}
              </span>
            )}
            {lineBreak}
          </React.Fragment>
        );
      })}
    </pre>
  );
});

const toPreciseSeconds = (value) => Math.round(Math.max(0, Number(value) || 0) * 1000) / 1000;

const formatMarkerTime = (value) => {
  const preciseSeconds = toPreciseSeconds(value);
  const totalWholeSeconds = Math.floor(preciseSeconds);
  const minutes = Math.floor(totalWholeSeconds / 60);
  const seconds = totalWholeSeconds % 60;
  const milliseconds = Math.round((preciseSeconds - totalWholeSeconds) * 1000);
  const baseTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${baseTime}.${String(milliseconds).padStart(3, '0')}`;
};

const parseMarkerTime = (rawValue) => {
  const value = String(rawValue || '').trim();
  if (!value) return null;

  if (/^\d+(\.\d+)?$/.test(value)) {
    return toPreciseSeconds(Number(value));
  }

  const parts = value.split(':').map((part) => part.trim());
  if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+(\.\d+)?$/.test(parts[1])) {
    return toPreciseSeconds(Number(parts[0]) * 60 + Number(parts[1]));
  }

  if (
    parts.length === 3 &&
    /^\d+$/.test(parts[0]) &&
    /^\d+$/.test(parts[1]) &&
    /^\d+(\.\d+)?$/.test(parts[2])
  ) {
    return toPreciseSeconds(Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]));
  }

  return null;
};

const normalizeCueMarkerTimes = (rawCueMarkers = [], sectionStartSec = null) => {
  const sectionFloor = normalizeOptionalChordProMarkerTime(sectionStartSec);
  const normalizedTimes = (Array.isArray(rawCueMarkers) ? rawCueMarkers : [])
    .map((marker) => {
      if (marker == null) return null;
      if (typeof marker?.startSec === 'number') return normalizeOptionalChordProMarkerTime(marker.startSec);
      if (typeof marker?.time === 'number') return normalizeOptionalChordProMarkerTime(marker.time);
      return normalizeOptionalChordProMarkerTime(marker);
    })
    .filter((value) => value != null)
    .filter((value) => (sectionFloor == null ? true : value > sectionFloor))
    .sort((left, right) => left - right);

  return [...new Set(normalizedTimes)];
};

const normalizeSectionMarkers = (sections = [], rawMarkers = []) => {
  const shouldClearLegacyZeroMarkers = isLegacyZeroFilledChordProMarkerSet(rawMarkers);
  const markerGroups = (Array.isArray(rawMarkers) ? rawMarkers : [])
    .filter(Boolean)
    .reduce((acc, marker, index) => {
      const key = String(marker?.sectionName || marker?.name || '').trim().toLowerCase() || `marker-${index}`;
      if (!acc.has(key)) acc.set(key, []);
      acc.get(key).push(marker);
      return acc;
    }, new Map());

  const markerOccurrences = new Map();

  return sections.map((section, index) => {
    const sectionName = String(section?.name || `Seccion ${index + 1}`).trim();
    const normalizedSectionName = sectionName.toLowerCase();
    const nextOccurrence = markerOccurrences.get(normalizedSectionName) || 0;
    const groupedMarkers = markerGroups.get(normalizedSectionName) || [];
    const existingMarker = groupedMarkers[nextOccurrence] || (Array.isArray(rawMarkers) ? rawMarkers[index] : {}) || {};
    markerOccurrences.set(normalizedSectionName, nextOccurrence + 1);
    const startSec = shouldClearLegacyZeroMarkers
      ? null
      : normalizeOptionalChordProMarkerTime(existingMarker?.startSec);
    const sectionOccurrence = nextOccurrence + 1;
    const slugBase = normalizedSectionName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `seccion-${index + 1}`;

    return {
      id: `${slugBase}-${sectionOccurrence}`,
      sectionName,
      sectionIndex: index,
      sectionOccurrence,
      sectionKey: `${slugBase}__${sectionOccurrence}`,
      startSec,
      note: String(existingMarker?.note || section?.note || '').trim(),
      cueMarkers: normalizeCueMarkerTimes(existingMarker?.cueMarkers, startSec),
      _autoDetected: Boolean(existingMarker?._autoDetected),
      _confidence: Number.isFinite(Number(existingMarker?._confidence)) ? Number(existingMarker._confidence) : 0,
      _method: String(existingMarker?._method || '').trim(),
    };
  });
};

const stripChordsFromLine = (line = '') => (
  String(line || '')
    .replace(/\[([^\]]+)\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
);

const compactCuePreview = (rawLines = [], maxWords = 6) => {
  const sourceLines = Array.isArray(rawLines) ? rawLines : [];
  const lyricPhrase = sourceLines
    .map(stripChordsFromLine)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const phrase = lyricPhrase || sourceLines
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!phrase) return '';

  const words = phrase.split(' ');
  return words.length > maxWords
    ? `${words.slice(0, maxWords).join(' ')}…`
    : phrase;
};

const formatMetadataMeter = (metadata = {}) => {
  const sequence = (Array.isArray(metadata?.meterChanges) ? metadata.meterChanges : [])
    .map((change) => String(change?.value || '').trim())
    .filter(Boolean)
    .filter((value, index, values) => index === 0 || value !== values[index - 1]);
  return sequence.join(' → ') || String(metadata?.meter || '').trim();
};

const extractManualMeterValues = (rawValue = '') => (
  [...String(rawValue || '').matchAll(/\b(\d{1,2}\s*\/\s*\d{1,2})\b/g)]
    .map((match) => match[1].replace(/\s+/g, ''))
    .filter((value, index, values) => values.indexOf(value) === index)
);

const replaceChordProMeterMetadata = (rawChordpro = '', rawMeter = '') => {
  const meterValues = extractManualMeterValues(rawMeter);
  const contentWithoutMeter = String(rawChordpro || '')
    .replace(/\{(?:time|meter|metrica|métrica|compas|compás)\s*:\s*[^{}]*\}/gi, '')
    .replace(/\{meta\s*:\s*(?:time|meter|metrica|métrica|compas|compás)\s*:?[\s\S]*?\}/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const meterDirectives = meterValues.map((value) => `{time: ${value}}`).join('\n');

  return [meterDirectives, contentWithoutMeter].filter(Boolean).join('\n\n');
};

const hasMeaningfulChordProContent = (rawChordpro = '') => (
  parseChordProSections(rawChordpro).length > 0
);

const getSongMeter = (song = {}) => (
  String(song?.metrica || '').trim() ||
  formatMetadataMeter(parseChordProMetadata(song?.chordpro || '')) ||
  ''
);

const getFirstMeaningfulSectionLine = (section) => {
  const lines = Array.isArray(section?.lines) ? section.lines : [];
  const firstLyricLine = lines.find((line) => stripChordsFromLine(line).length > 0);
  if (firstLyricLine) return firstLyricLine;

  return lines.find((line) => String(line || '').trim()) || '';
};

const areTimesClose = (left, right, precision = 0.25) => (
  Math.abs((Number(left) || 0) - (Number(right) || 0)) < precision
);

const toManualMarkerPatch = (patch = {}) => ({
  ...patch,
  _autoDetected: false,
  _confidence: 0,
  _method: 'manual',
});

const buildRepeatSectionBlock = (suggestion = {}) => {
  const sectionName = String(suggestion?.suggestedName || 'Repeticion').trim();
  const lines = Array.isArray(suggestion?.lines) ? suggestion.lines : [];
  return [
    `[${sectionName}]`,
    ...lines.map((line) => String(line || '').trimEnd()),
  ].join('\n').trim();
};

const normalizeExternalVoiceUrl = (rawUrl = '') => {
  let normalized = String(rawUrl || '').trim();
  if (!normalized) return '';

  if (normalized.startsWith('www.')) {
    normalized = `https://${normalized}`;
  } else if (normalized.startsWith('//')) {
    normalized = `https:${normalized}`;
  } else if (/^\/(uc|open|file)\b/i.test(normalized)) {
    normalized = `https://drive.google.com${normalized}`;
  }

  if (!/^https?:\/\//i.test(normalized)) return '';

  try {
    const url = new URL(normalized);
    const hostname = url.hostname.replace(/^www\./i, '').toLowerCase();

    if (hostname === 'drive.google.com') {
      const fullUrl = `${url.origin}${url.pathname}${url.search}`;
      const driveIdPatterns = [
        /\/file\/d\/([a-zA-Z0-9_-]+)/i,
        /[?&]id=([a-zA-Z0-9_-]+)/i,
        /\/uc\b.*[?&]id=([a-zA-Z0-9_-]+)/i,
      ];

      const fileId = driveIdPatterns.reduce((foundId, pattern) => {
        if (foundId) return foundId;
        const match = fullUrl.match(pattern);
        return match?.[1] || '';
      }, '');

      if (fileId) {
        return `https://drive.google.com/uc?export=download&id=${fileId}`;
      }
    }

    return url.toString();
  } catch {
    return normalized;
  }
};

const isDirectVoiceAudioUrl = (url = '') => /\.(mp3|wav|m4a|aac|ogg|flac|mp4|mpeg|mpga|webm)(\?.*)?$/i.test(String(url || ''));

const VOICE_LABEL_OPTIONS = [
  'Voz guía',
  'Tercera voz',
  'Quinta voz',
  'Todas las voces',
  'Pista',
];

const VOICE_LABEL_ORDER = new Map(VOICE_LABEL_OPTIONS.map((label, index) => [label, index]));

const normalizeVoiceLabelText = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

const inferVoiceLabelFromText = (value = '', fallback = 'Pista') => {
  const normalized = normalizeVoiceLabelText(value);

  if (/\b(guia|principal|lead)\b/.test(normalized)) return 'Voz guía';
  if (/\b(tercera|tercero|3ra|3ro|3)\b/.test(normalized)) return 'Tercera voz';
  if (/\b(quinta|quinto|5ta|5to|5)\b/.test(normalized)) return 'Quinta voz';
  if (/\b(todas|tres voces|full|voces)\b/.test(normalized)) return 'Todas las voces';
  if (/\b(pista|instrumental|track)\b/.test(normalized)) return 'Pista';

  return fallback;
};

const normalizeVoiceLabelOption = (value = '', fallback = 'Pista') => {
  const label = String(value || '').trim();
  if (!label) return fallback;

  const normalizedLabel = normalizeVoiceLabelText(label);
  const exactOption = VOICE_LABEL_OPTIONS.find((option) => normalizeVoiceLabelText(option) === normalizedLabel);
  if (exactOption) return exactOption;

  return inferVoiceLabelFromText(label, fallback);
};

const createVoiceEntryId = (prefix = 'voice') => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getVoiceLabelOrder = (value = '') => {
  const normalized = normalizeVoiceLabelOption(value);
  return VOICE_LABEL_ORDER.has(normalized) ? VOICE_LABEL_ORDER.get(normalized) : VOICE_LABEL_OPTIONS.length;
};

const sortVoiceEntries = (entries = []) => (
  (Array.isArray(entries) ? entries : [])
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const orderDelta = getVoiceLabelOrder(left.entry?.label) - getVoiceLabelOrder(right.entry?.label);
      return orderDelta || left.index - right.index;
    })
    .map(({ entry }) => ({
      ...entry,
      label: normalizeVoiceLabelOption(entry?.label),
    }))
);

const mergeVoiceEntriesByUrl = (...entryGroups) => {
  const seenUrls = new Set();
  const mergedEntries = [];

  entryGroups.flat().forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;

    const normalizedUrl = normalizeExternalVoiceUrl(entry.url || '');
    if (normalizedUrl) {
      if (seenUrls.has(normalizedUrl)) return;
      seenUrls.add(normalizedUrl);
    }

    mergedEntries.push({
      ...entry,
      label: normalizeVoiceLabelOption(entry.label || `Voz ${index + 1}`),
      url: normalizedUrl || entry.url || '',
    });
  });

  return sortVoiceEntries(mergedEntries);
};

const crearEntradaVoz = (candidate, index = 0, forcedLabel = '') => {
  if (typeof candidate === 'string') {
    const url = normalizeExternalVoiceUrl(candidate);
    if (!url) return null;
    return {
      id: createVoiceEntryId(`voice-${index}`),
      label: normalizeVoiceLabelOption(forcedLabel || `Voz ${index + 1}`, index === 0 ? 'Voz guía' : 'Pista'),
      url,
      source: 'remote',
    };
  }

  if (!candidate || typeof candidate !== 'object') return null;

  const url = normalizeExternalVoiceUrl(
    candidate.url ||
    candidate.link ||
    candidate.href ||
    candidate.src ||
    candidate.audio ||
    '',
  );
  if (!url) return null;

  const label = String(
    forcedLabel ||
    candidate.label ||
    candidate.nombre ||
    candidate.name ||
    candidate.title ||
    candidate.voice ||
    `Voz ${index + 1}`,
  ).trim() || `Voz ${index + 1}`;

  return {
    id: createVoiceEntryId(`voice-${index}`),
    label: normalizeVoiceLabelOption(label, index === 0 ? 'Voz guía' : 'Pista'),
    url,
    source: 'remote',
  };
};

const parseVoiceAdminPayload = (value) => {
  const raw = String(value || '').trim();
  if (!raw || raw === '-') return { entries: [], legacyUrl: '' };

  const normalizedDirectUrl = normalizeExternalVoiceUrl(raw);
  if (normalizedDirectUrl && !raw.startsWith('[') && !raw.startsWith('{') && !raw.includes('\n')) {
    if (isDirectVoiceAudioUrl(normalizedDirectUrl)) {
      return { entries: [crearEntradaVoz(normalizedDirectUrl, 0, 'Voz guía')].filter(Boolean), legacyUrl: '' };
    }
    return { entries: [], legacyUrl: normalizedDirectUrl };
  }

  if (raw.includes('\n')) {
    const entries = raw
      .split('\n')
      .map((line, index) => {
        const trimmed = String(line || '').trim();
        if (!trimmed) return null;
        const [labelPart, ...urlParts] = trimmed.includes('|') ? trimmed.split('|') : [`Voz ${index + 1}`, trimmed];
        return crearEntradaVoz(urlParts.join('|').trim(), index, String(labelPart || '').trim());
      })
      .filter(Boolean);

    if (entries.length) return { entries: sortVoiceEntries(entries), legacyUrl: '' };
  }

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') return parseVoiceAdminPayload(parsed);

    if (Array.isArray(parsed)) {
      return {
        entries: sortVoiceEntries(parsed.map((entry, index) => crearEntradaVoz(entry, index, index === 0 ? 'Voz guía' : '')).filter(Boolean)),
        legacyUrl: '',
      };
    }

    if (parsed && typeof parsed === 'object') {
      const legacyCandidate = parsed.legacyUrl || parsed.folder || parsed.drive || '';
      const parsedLegacy = legacyCandidate ? parseVoiceAdminPayload(legacyCandidate) : { entries: [], legacyUrl: '' };
      const legacyUrl = parsedLegacy.legacyUrl || normalizeExternalVoiceUrl(legacyCandidate);
      const sourceEntries = Array.isArray(parsed.entries)
        ? parsed.entries
        : Object.entries(parsed).map(([key, candidate]) => (
          ['legacyUrl', 'folder', 'drive'].includes(key) ? null : { label: key, url: candidate }
        )).filter(Boolean);

      const directEntry = Array.isArray(parsed.entries) ? null : crearEntradaVoz(parsed, 0, parsed.label || parsed.nombre || parsed.name || parsed.title || '');
      const entriesFromObject = directEntry
        ? [directEntry]
        : sourceEntries.map((entry, index) => crearEntradaVoz(entry, index, index === 0 ? 'Voz guía' : '')).filter(Boolean);
      const entries = mergeVoiceEntriesByUrl(parsedLegacy.entries, entriesFromObject);

      return { entries, legacyUrl };
    }
  } catch {
    return { entries: [], legacyUrl: normalizedDirectUrl || '' };
  }

  return { entries: [], legacyUrl: '' };
};

const serializeVoiceAdminPayload = (entries = [], legacyUrl = '') => {
  const normalizedEntries = sortVoiceEntries(entries)
    .map((entry, index) => {
      const label = normalizeVoiceLabelOption(entry?.label || `Voz ${index + 1}`);
      const url = normalizeExternalVoiceUrl(entry?.url || '');
      return url ? { label, url } : null;
    })
    .filter(Boolean);

  if (normalizedEntries.length > 0) {
    const normalizedLegacyUrl = normalizeExternalVoiceUrl(legacyUrl);
    if (normalizedLegacyUrl) {
      return JSON.stringify({
        entries: normalizedEntries,
        legacyUrl: normalizedLegacyUrl,
      });
    }

    return normalizedEntries.map((entry) => `${entry.label} | ${entry.url}`).join('\n');
  }

  return normalizeExternalVoiceUrl(legacyUrl);
};

const getVoiceFileLabel = (fileName = '', index = 0) => {
  const baseName = String(fileName || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return inferVoiceLabelFromText(baseName, VOICE_LABEL_OPTIONS[Math.min(index, VOICE_LABEL_OPTIONS.length - 1)] || 'Pista');
};

const getVoiceDisplayNameFromUrl = (value = '') => {
  const rawValue = String(value || '').trim();
  if (!rawValue) return '';

  try {
    const parsed = new URL(rawValue);
    const lastPath = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    return lastPath || parsed.hostname;
  } catch {
    return rawValue.replace(/^https?:\/\//i, '').slice(0, 64);
  }
};

const createLocalVoiceEntry = (file, index = 0) => ({
  id: createVoiceEntryId('voice-local'),
  label: getVoiceFileLabel(file?.name, index),
  url: '',
  source: 'local',
  file,
  fileName: file?.name || `Audio ${index + 1}`,
  previewUrl: URL.createObjectURL(file),
});

const EditableCell = ({ cancionId, campoBd, valorInicial, onSave, isSaving, anchoClases = "min-w-[8rem]", customInputClasses = "" }) => {
  const [valor, setValor] = useState(valorInicial || '');

  const defaultInputClasses = "w-full min-h-[38px] px-2.5 py-1.5 bg-transparent border border-transparent focus:border-brand focus:ring-1 focus:ring-brand hover:border-border transition-colors outline-none text-[13px] text-content truncate";
  const inputClasses = customInputClasses || defaultInputClasses;

  useEffect(() => {
    setValor(valorInicial || '');
  }, [valorInicial]);

  const handleBlur = () => {
    if (valor !== (valorInicial || '')) {
      onSave(cancionId, campoBd, valor);
    }
  };

  return (
    <div className={`relative flex items-center w-full ${anchoClases}`}>
      <input
        type="text"
        className={inputClasses}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onBlur={handleBlur}
        title={valor}
      />
      {isSaving && (
        <div className="absolute right-2 text-brand bg-surface rounded-full p-0.5 z-10">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      )}
    </div>
  );
};

const MarkerTimeInput = ({
  value = null,
  onCommit,
  placeholder = '',
  disabled = false,
  ariaLabel = 'Tiempo del marker en minutos, segundos y milisegundos',
}) => {
  const formattedValue = value == null ? '' : formatMarkerTime(value);
  const [draft, setDraft] = useState(formattedValue);
  const [isFocused, setIsFocused] = useState(false);
  const skipCommitOnBlurRef = useRef(false);

  useEffect(() => {
    if (!isFocused) {
      setDraft(formattedValue);
    }
  }, [formattedValue, isFocused]);

  const commit = () => {
    const parsedValue = parseMarkerTime(draft);
    onCommit(parsedValue);
    setDraft(parsedValue == null ? '' : formatMarkerTime(parsedValue));
  };

  const resetDraft = () => {
    setDraft(formattedValue);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      onFocus={() => setIsFocused(true)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        setIsFocused(false);
        if (skipCommitOnBlurRef.current) {
          skipCommitOnBlurRef.current = false;
          setDraft(formattedValue);
          return;
        }
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        }
        if (event.key === 'Escape') {
          skipCommitOnBlurRef.current = true;
          resetDraft();
          event.currentTarget.blur();
        }
      }}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      className="h-9 w-[6.3rem] rounded-lg border border-border bg-background px-2.5 text-sm tabular-nums text-content outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:bg-surface disabled:text-content-muted"
    />
  );
};

export default function AdminRepertorio() {
  const [canciones, setCanciones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorTexto, setErrorTexto] = useState(null);

  // Estados
  const [uploading, setUploading] = useState({});
  const [savingCell, setSavingCell] = useState({});
  const [editorChordproAbierto, setEditorChordproAbierto] = useState(false);
  const [editorChordproCancion, setEditorChordproCancion] = useState(null);
  const [editorChordproValor, setEditorChordproValor] = useState('');
  const [editorSectionMarkers, setEditorSectionMarkers] = useState([]);
  const [editorChordproCargando, setEditorChordproCargando] = useState(false);
  const [editorChordproAviso, setEditorChordproAviso] = useState('');
  const [editorAuthoringPanel, setEditorAuthoringPanel] = useState(null);
  const [editorAuthoringSectionIndex, setEditorAuthoringSectionIndex] = useState(-1);
  const [editorCustomGuide, setEditorCustomGuide] = useState('');
  const [editorAuthoringFeedback, setEditorAuthoringFeedback] = useState('');
  const [guardandoChordpro, setGuardandoChordpro] = useState(false);
  const [sectionMarkersDisponibles, setSectionMarkersDisponibles] = useState(true);
  const [metricaDisponible, setMetricaDisponible] = useState(true);
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  const [autoDetectError, setAutoDetectError] = useState(null);
  const [autoDetectResult, setAutoDetectResult] = useState(null);
  const [editorAudioCurrentTime, setEditorAudioCurrentTime] = useState(0);
  const [editorAudioDuration, setEditorAudioDuration] = useState(0);
  const [editorAudioPlaying, setEditorAudioPlaying] = useState(false);
  const [vocesModalCancion, setVocesModalCancion] = useState(null);
  const [vocesDraftEntries, setVocesDraftEntries] = useState([]);
  const [vocesDraftLegacyUrl, setVocesDraftLegacyUrl] = useState('');
  const [mostrarLinkViejoVoces, setMostrarLinkViejoVoces] = useState(false);
  const [vocesFeedback, setVocesFeedback] = useState('');
  const [guardandoVoces, setGuardandoVoces] = useState(false);
  const [voicePreview, setVoicePreview] = useState({ id: '', url: '' });
  const editorAudioCurrentTimeRef = useRef(0);
  const editorAudioFrameRef = useRef(null);
  const voicePreviewAudioRef = useRef(null);
  const editorChordproTextareaRef = useRef(null);
  const editorChordproHighlightRef = useRef(null);
  const tableScrollRef = useRef(null);
  const horizontalTrackRef = useRef(null);
  const horizontalDragStateRef = useRef({ startX: 0, startScrollLeft: 0 });
  const [horizontalScrollUi, setHorizontalScrollUi] = useState({
    hasOverflow: false,
    scrollLeft: 0,
    scrollWidth: 0,
    clientWidth: 0,
    thumbWidth: 0,
    thumbOffset: 0,
  });
  const [draggingHorizontalThumb, setDraggingHorizontalThumb] = useState(false);
  const [headerActionsHost, setHeaderActionsHost] = useState(null);
  const [headerActionsReady, setHeaderActionsReady] = useState(false);
  const [isCompactAdmin, setIsCompactAdmin] = useState(false);
  const [mobileSearch, setMobileSearch] = useState('');
  const [mobileFilter, setMobileFilter] = useState('todas');
  const [songWizardOpen, setSongWizardOpen] = useState(false);
  const [songWizardMode, setSongWizardMode] = useState('create');
  const [songWizardStep, setSongWizardStep] = useState(0);
  const [songWizardSongId, setSongWizardSongId] = useState('');
  const [songWizardDraft, setSongWizardDraft] = useState(INITIAL_SONG_WIZARD_DRAFT);
  const [songWizardSaving, setSongWizardSaving] = useState(false);
  const [songWizardFeedback, setSongWizardFeedback] = useState('');
  const [songWizardDirty, setSongWizardDirty] = useState(false);
  const [songWizardMp3File, setSongWizardMp3File] = useState(null);
  const [activeAdminArea, setActiveAdminArea] = useState('songs');
  const [warmupCreateSignal, setWarmupCreateSignal] = useState(0);
  const [warmupCount, setWarmupCount] = useState(0);
  const songWizardHeadingRef = useRef(null);
  const songWizardDialogRef = useRef(null);

  const [sessionUser, setSessionUser] = useState(null);

  const resumenEditorChordpro = useMemo(() => {
    const lineas = editorChordproValor
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .filter((line) => line.trim() !== '');
    const seccionesParseadas = parseChordProSections(editorChordproValor);
    const secciones = seccionesParseadas.length;
    const seccionesConNota = seccionesParseadas.filter((section) => section.note).length;
    const ejemploMetadata = seccionesParseadas
      .filter((section) => section.note)
      .slice(0, 3)
      .map((section) => `${section.name}: ${section.note}`);

    return {
      lineas: lineas.length,
      secciones,
      seccionesConNota,
      ejemploMetadata,
    };
  }, [editorChordproValor]);

  const seccionesEditorChordpro = useMemo(() => parseChordProSections(editorChordproValor), [editorChordproValor]);
  const editorAuthoringSection = editorAuthoringSectionIndex >= 0
    ? seccionesEditorChordpro[editorAuthoringSectionIndex] || null
    : null;
  const editorAuthoringMarker = editorAuthoringSectionIndex >= 0
    ? editorSectionMarkers[editorAuthoringSectionIndex] || null
    : null;
  const editorCanAnnotateSection = Boolean(
    editorAuthoringSection &&
    String(editorAuthoringSection.name || '').trim().toLowerCase() !== 'letra',
  );
  const editorAuthoringGuides = useMemo(() => (
    splitChordProGuideNote(editorAuthoringSection?.note || editorAuthoringMarker?.note || '')
  ), [editorAuthoringMarker?.note, editorAuthoringSection?.note]);
  const cueDraftsEditor = useMemo(() => (
    seccionesEditorChordpro.map((section, index) => {
      const cues = splitSectionIntoCues('editor-draft', index, section, null, 1);
      return {
        cueCount: cues.length,
        sectionStartPreview: compactCuePreview(cues[0]?.rawLines),
        cueMarkerPreview: cues
          .slice(1)
          .map((cue, cueIndex) => ({
            label: `Cue ${cueIndex + 2}`,
            text: compactCuePreview(cue.rawLines),
          }))
          .filter((cue) => cue.text),
      };
    })
  ), [seccionesEditorChordpro]);

  const cancionesPendientesChordpro = useMemo(() => (
    canciones.filter((cancion) => {
      const estado = String(cancion?.estado || '').trim().toLowerCase();
      return estado !== 'archivada' && !hasMeaningfulChordProContent(cancion?.chordpro);
    })
  ), [canciones]);

  const vocesDraftEntriesOrdenadas = useMemo(() => sortVoiceEntries(vocesDraftEntries), [vocesDraftEntries]);

  const songWizardSong = useMemo(() => (
    canciones.find((song) => String(song?.id) === String(songWizardSongId)) || null
  ), [canciones, songWizardSongId]);

  const mobileSongs = useMemo(() => {
    const query = normalizeSearchText(mobileSearch);
    return canciones.filter((song) => {
      const estado = normalizeSearchText(song?.estado);
      const matchesFilter = mobileFilter === 'activas'
        ? estado !== 'archivada'
        : mobileFilter === 'sin_chordpro'
          ? !hasMeaningfulChordProContent(song?.chordpro) && estado !== 'archivada'
          : true;
      if (!matchesFilter || !query) return matchesFilter;

      const searchable = normalizeSearchText([
        song?.titulo,
        song?.cantante,
        song?.tonalidad,
        song?.categoria,
        song?.voz,
        song?.tema,
        song?.estado,
      ].filter(Boolean).join(' '));
      return searchable.includes(query);
    });
  }, [canciones, mobileFilter, mobileSearch]);

  const songWizardTitleReady = Boolean(String(songWizardDraft.titulo || '').trim());
  const songWizardSingerReady = Boolean(String(songWizardDraft.cantante || '').trim());
  const songWizardHasMp3 = Boolean(songWizardMp3File || String(songWizardSong?.mp3 || '').trim());
  const songWizardBasicsReady = songWizardTitleReady && songWizardSingerReady && songWizardHasMp3;
  const songWizardFirstStepReady = songWizardMode === 'create'
    ? songWizardBasicsReady
    : songWizardTitleReady;

  const canScrollHorizontalLeft = horizontalScrollUi.scrollLeft > 2;
  const canScrollHorizontalRight =
    horizontalScrollUi.scrollLeft < (horizontalScrollUi.scrollWidth - horizontalScrollUi.clientWidth - 2);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    setHeaderActionsHost(document.getElementById('admin-header-actions'));
    setHeaderActionsReady(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    const updateCompactMode = () => setIsCompactAdmin(mediaQuery.matches);
    updateCompactMode();
    mediaQuery.addEventListener?.('change', updateCompactMode);
    return () => mediaQuery.removeEventListener?.('change', updateCompactMode);
  }, []);

  useEffect(() => {
    if (!songWizardOpen || typeof document === 'undefined') return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.dataset.mobileModalOpen = 'true';

    const handleEscape = (event) => {
      if (event.key === 'Tab' && !vocesModalCancion && !editorChordproAbierto) {
        const focusable = Array.from(songWizardDialogRef.current?.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]'
        ) || []);
        if (focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }

      if (
        event.key === 'Escape' &&
        !songWizardSaving &&
        !vocesModalCancion &&
        !editorChordproAbierto
      ) {
        setSongWizardOpen(false);
      }
    };
    window.addEventListener('keydown', handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      delete document.documentElement.dataset.mobileModalOpen;
      window.removeEventListener('keydown', handleEscape);
    };
  }, [editorChordproAbierto, songWizardOpen, songWizardSaving, vocesModalCancion]);

  useEffect(() => {
    if (!songWizardOpen) return;
    const frame = window.requestAnimationFrame(() => songWizardHeadingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [songWizardOpen, songWizardStep]);

  useEffect(() => {
    if (!editorChordproAbierto) return;
    setEditorSectionMarkers((prev) => normalizeSectionMarkers(seccionesEditorChordpro, prev));
  }, [editorChordproAbierto, seccionesEditorChordpro]);

  useEffect(() => {
    if (!editorChordproAbierto) return;
    if (seccionesEditorChordpro.length === 0) {
      setEditorAuthoringSectionIndex(-1);
      return;
    }
    setEditorAuthoringSectionIndex((previous) => (
      previous >= 0 && previous < seccionesEditorChordpro.length
        ? previous
        : seccionesEditorChordpro.length - 1
    ));
  }, [editorChordproAbierto, seccionesEditorChordpro.length]);

  useEffect(() => {
    if (!editorChordproAbierto) {
      setIsAutoDetecting(false);
      setAutoDetectError(null);
      setAutoDetectResult(null);
      return;
    }

    setAutoDetectError(null);
    setAutoDetectResult(null);
  }, [editorChordproAbierto, editorChordproCancion?.id]);

  useEffect(() => {
    const scrollEl = tableScrollRef.current;
    if (!scrollEl) return undefined;

    const updateHorizontalScrollUi = () => {
      const nextScrollWidth = scrollEl.scrollWidth;
      const nextClientWidth = scrollEl.clientWidth;
      const nextScrollLeft = scrollEl.scrollLeft;
      const trackWidth = horizontalTrackRef.current?.clientWidth || 0;
      const hasOverflow = nextScrollWidth - nextClientWidth > 1;
      const thumbWidth = hasOverflow && trackWidth > 0
        ? Math.max(72, (nextClientWidth / nextScrollWidth) * trackWidth)
        : 0;
      const maxScrollLeft = Math.max(0, nextScrollWidth - nextClientWidth);
      const maxThumbOffset = Math.max(0, trackWidth - thumbWidth);
      const thumbOffset = maxScrollLeft > 0 && maxThumbOffset > 0
        ? (nextScrollLeft / maxScrollLeft) * maxThumbOffset
        : 0;

      setHorizontalScrollUi((prev) => {
        const nextState = {
          hasOverflow,
          scrollLeft: nextScrollLeft,
          scrollWidth: nextScrollWidth,
          clientWidth: nextClientWidth,
          thumbWidth,
          thumbOffset,
        };

        const sameState = Object.keys(nextState).every((key) => (
          Math.abs((prev[key] || 0) - (nextState[key] || 0)) < 0.5
        ));

        return sameState ? prev : nextState;
      });
    };

    const scheduleUpdate = () => {
      window.requestAnimationFrame(updateHorizontalScrollUi);
    };

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(scheduleUpdate)
      : null;

    resizeObserver?.observe(scrollEl);
    if (horizontalTrackRef.current) {
      resizeObserver?.observe(horizontalTrackRef.current);
    }

    const tableEl = scrollEl.querySelector('table');
    if (tableEl) {
      resizeObserver?.observe(tableEl);
    }

    scrollEl.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    scheduleUpdate();

    return () => {
      resizeObserver?.disconnect();
      scrollEl.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, [canciones.length, isCompactAdmin, loading]);

  useEffect(() => {
    if (!draggingHorizontalThumb) return undefined;

    const handlePointerMove = (event) => {
      const scrollEl = tableScrollRef.current;
      const trackEl = horizontalTrackRef.current;
      if (!scrollEl || !trackEl) return;

      const trackWidth = trackEl.clientWidth;
      const maxThumbOffset = Math.max(1, trackWidth - horizontalScrollUi.thumbWidth);
      const maxScrollLeft = Math.max(0, scrollEl.scrollWidth - scrollEl.clientWidth);
      const deltaX = event.clientX - horizontalDragStateRef.current.startX;
      const nextScrollLeft = horizontalDragStateRef.current.startScrollLeft + ((deltaX / maxThumbOffset) * maxScrollLeft);

      scrollEl.scrollLeft = Math.max(0, Math.min(nextScrollLeft, maxScrollLeft));
    };

    const stopDragging = () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      setDraggingHorizontalThumb(false);
    };

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('pointercancel', stopDragging);

    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopDragging);
      window.removeEventListener('pointercancel', stopDragging);
    };
  }, [draggingHorizontalThumb, horizontalScrollUi.thumbWidth]);

  useEffect(() => {
    if (!editorChordproAbierto) return undefined;
    const audio = document.getElementById('admin-chordpro-audio');
    if (!audio) return undefined;

    const handleLoadedMetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      setEditorAudioDuration((prev) => (areTimesClose(prev, duration, 0.1) ? prev : duration));
    };

    const syncCurrentTime = () => {
      editorAudioFrameRef.current = null;
      const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      editorAudioCurrentTimeRef.current = currentTime;
      setEditorAudioCurrentTime((prev) => (
        areTimesClose(prev, currentTime, 0.18) && Math.floor(prev) === Math.floor(currentTime)
          ? prev
          : currentTime
      ));
    };

    const handleTimeUpdate = () => {
      if (editorAudioFrameRef.current != null) return;
      editorAudioFrameRef.current = window.requestAnimationFrame(syncCurrentTime);
    };

    const handlePlay = () => setEditorAudioPlaying(true);
    const handlePause = () => setEditorAudioPlaying(false);
    const handleEnded = () => {
      setEditorAudioPlaying(false);
      setEditorAudioCurrentTime(0);
      editorAudioCurrentTimeRef.current = 0;
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('durationchange', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);

    return () => {
      if (editorAudioFrameRef.current != null) {
        window.cancelAnimationFrame(editorAudioFrameRef.current);
        editorAudioFrameRef.current = null;
      }
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('durationchange', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [editorChordproAbierto, editorChordproCancion?.mp3]);
  useEffect(() => {
    if (!editorChordproAbierto) return undefined;
    const audio = document.getElementById('admin-chordpro-audio');
    if (!(audio instanceof HTMLAudioElement)) return undefined;

    return audioSessionService.registerPrimaryAudio(
      'admin-chordpro-preview',
      {
        audioElement: audio,
      },
      15
    );
  }, [editorChordproAbierto, editorChordproCancion?.mp3]);

  useEffect(() => {
    const audio = voicePreviewAudioRef.current;
    if (!audio || !voicePreview.url) return undefined;

    let cancelled = false;
    audio.src = voicePreview.url;
    audio.currentTime = 0;
    audio.play().catch(() => {
      if (!cancelled) setVoicePreview({ id: '', url: '' });
    });

    const handleEnded = () => setVoicePreview({ id: '', url: '' });
    audio.addEventListener('ended', handleEnded);

    return () => {
      cancelled = true;
      audio.pause();
      audio.removeEventListener('ended', handleEnded);
    };
  }, [voicePreview.url]);

  useEffect(() => {
    verificarSesion();
  }, []);

  const verificarSesion = async () => {
    try {
      setLoading(true);
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error || !session) {
        setSessionUser(null);
        setLoading(false);
        return;
      }

      setSessionUser(session.user);
      await cargarCanciones();
    } catch (err) {
      console.error('Error al verificar sesion:', err);
      setSessionUser(null);
      setLoading(false);
    }
  };

  const cargarCanciones = async () => {
    try {
      const selectVariants = [
        { fields: `${CANCIONES_SELECT_BASE}, section_markers, metrica`, markers: true, metrica: true },
        { fields: `${CANCIONES_SELECT_BASE}, section_markers`, markers: true, metrica: false },
        { fields: `${CANCIONES_SELECT_BASE}, metrica`, markers: false, metrica: true },
        { fields: CANCIONES_SELECT_BASE, markers: false, metrica: false },
      ];
      let data = null;
      let error = null;

      for (const variant of selectVariants) {
        const query = await supabase
          .from('canciones')
          .select(variant.fields)
          .order('titulo', { ascending: true });

        data = query.data;
        error = query.error;
        if (!error) {
          setSectionMarkersDisponibles(variant.markers);
          setMetricaDisponible(variant.metrica);
          break;
        }
      }

      if (error) throw error;
      setCanciones(data || []);
    } catch (error) {
      console.error('Error al cargar:', error);
      setErrorTexto('Ocurrio un error al cargar el repertorio. Verifique sus permisos (RLS).');
    } finally {
      setLoading(false);
    }
  };

  const abrirWizardNuevaCancion = () => {
    setSongWizardMode('create');
    setSongWizardStep(0);
    setSongWizardSongId('');
    setSongWizardDraft({ ...INITIAL_SONG_WIZARD_DRAFT });
    setSongWizardFeedback('');
    setSongWizardDirty(false);
    setSongWizardMp3File(null);
    setSongWizardOpen(true);
  };

  const abrirWizardEditarCancion = (song) => {
    if (!song?.id) return;
    setSongWizardMode('edit');
    setSongWizardStep(0);
    setSongWizardSongId(song.id);
    setSongWizardDraft(songToWizardDraft(song));
    setSongWizardFeedback('');
    setSongWizardDirty(false);
    setSongWizardMp3File(null);
    setSongWizardOpen(true);
  };

  const cerrarSongWizard = () => {
    if (songWizardSaving) return;
    setSongWizardOpen(false);
    setSongWizardFeedback('');
    setSongWizardMp3File(null);
  };

  const actualizarSongWizardDraft = (field, value) => {
    setSongWizardDraft((previous) => ({ ...previous, [field]: value }));
    setSongWizardDirty(true);
    setSongWizardFeedback('');
  };

  const guardarPasoInicialSongWizard = async () => {
    if (!songWizardTitleReady) {
      setSongWizardFeedback('Escribe el nombre de la canción para continuar.');
      return false;
    }
    if (songWizardMode === 'create' && !songWizardSingerReady) {
      setSongWizardFeedback('Escribe el cantante o banda para continuar.');
      return false;
    }
    if (songWizardMode === 'create' && !songWizardHasMp3) {
      setSongWizardFeedback('Selecciona el MP3 principal para continuar.');
      return false;
    }

    setSongWizardSaving(true);
    setSongWizardFeedback('');

    try {
      const basicPayload = {
        titulo: String(songWizardDraft.titulo || '').trim(),
        cantante: String(songWizardDraft.cantante || '').trim() || null,
      };
      let persistedSong = songWizardSong;

      if (songWizardMode === 'create') {
        const selectFields = [
          CANCIONES_SELECT_BASE,
          sectionMarkersDisponibles ? 'section_markers' : '',
          metricaDisponible ? 'metrica' : '',
        ].filter(Boolean).join(', ');
        const { data, error } = await supabase
          .from('canciones')
          .insert([{ ...basicPayload, estado: 'Activa' }])
          .select(selectFields)
          .single();

        if (error) throw error;
        if (!data) throw new Error('La canción no pudo crearse.');
        persistedSong = data;
        setCanciones((previous) => sortSongsByTitle([...previous, data]));
        setSongWizardSongId(data.id);
        setSongWizardMode('edit');
      } else {
        if (!songWizardSongId || !persistedSong) {
          throw new Error('No se encontró la canción que estás editando.');
        }
        const { error } = await supabase
          .from('canciones')
          .update(basicPayload)
          .eq('id', songWizardSongId);

        if (error) throw error;
        persistedSong = { ...persistedSong, ...basicPayload };
        setCanciones((previous) => sortSongsByTitle(previous.map((song) => (
          String(song.id) === String(songWizardSongId) ? persistedSong : song
        ))));
      }

      if (songWizardMp3File) {
        const publicUrl = await subirArchivoR2(songWizardMp3File, persistedSong.id, 'mp3');
        const { error: mp3Error } = await supabase
          .from('canciones')
          .update({ mp3: publicUrl })
          .eq('id', persistedSong.id);

        if (mp3Error) throw mp3Error;
        persistedSong = { ...persistedSong, mp3: publicUrl };
        setCanciones((previous) => sortSongsByTitle(previous.map((song) => (
          String(song.id) === String(persistedSong.id) ? persistedSong : song
        ))));
        setSongWizardMp3File(null);

        try {
          await generarMiniaturaCancion(persistedSong.id);
        } catch (artworkError) {
          console.warn('El MP3 se guardó, pero su miniatura no pudo generarse:', artworkError);
        }
      }

      setSongWizardDirty(false);
      setSongWizardFeedback(songWizardMode === 'create'
        ? 'Canción creada. Continúa con los datos musicales.'
        : 'Datos principales guardados.');
      return true;
    } catch (error) {
      console.error('Error guardando datos principales:', error);
      const detail = String(error?.message || error?.details || 'No se pudieron guardar los datos principales.');
      setSongWizardFeedback(/duplicate|unique/i.test(detail)
        ? 'Ya existe una canción con ese nombre.'
        : detail);
      return false;
    } finally {
      setSongWizardSaving(false);
    }
  };

  const guardarSongWizardMetadata = async ({
    progressFeedback = '',
    successFeedback = 'Datos guardados. Completa los adicionales que necesites.',
  } = {}) => {
    if (!songWizardSongId || !songWizardSong) {
      setSongWizardFeedback('Primero completa los datos principales de la canción.');
      setSongWizardStep(0);
      return false;
    }

    const rawMeter = String(songWizardDraft.metrica || '').trim();
    const meterValues = extractManualMeterValues(rawMeter);
    if (rawMeter && meterValues.length === 0) {
      setSongWizardFeedback('Usa una métrica como 4/4, 3/4 o 6/8.');
      setSongWizardStep(1);
      return false;
    }

    setSongWizardSaving(true);
    setSongWizardFeedback(progressFeedback);

    try {
      const payload = buildSongWizardPayload(songWizardDraft, metricaDisponible);
      if (metricaDisponible) {
        payload.metrica = meterValues.join(' → ') || null;
      } else {
        const currentChordpro = songWizardMode === 'edit' ? songWizardSong?.chordpro : '';
        payload.chordpro = replaceChordProMeterMetadata(currentChordpro, meterValues.join(' → ')) || null;
      }
      const { error } = await supabase
        .from('canciones')
        .update(payload)
        .eq('id', songWizardSongId);

      if (error) throw error;
      const persistedSong = { ...songWizardSong, ...payload };
      setCanciones((previous) => sortSongsByTitle(previous.map((song) => (
        String(song.id) === String(songWizardSongId)
          ? { ...song, ...payload }
          : song
      ))));
      setSongWizardFeedback(successFeedback);

      setSongWizardDirty(false);
      return persistedSong;
    } catch (error) {
      console.error('Error guardando canción desde el wizard:', error);
      const detail = String(error?.message || error?.details || 'No se pudieron guardar los cambios.');
      const isDuplicate = /duplicate|unique/i.test(detail);
      setSongWizardFeedback(isDuplicate
        ? 'Ya existe una canción con ese nombre. Usa un título diferente.'
        : detail);
      return false;
    } finally {
      setSongWizardSaving(false);
    }
  };

  const avanzarSongWizard = async () => {
    if (songWizardStep === 0) {
      const saved = await guardarPasoInicialSongWizard();
      if (saved) setSongWizardStep(1);
      return;
    }

    if (songWizardStep === 1) {
      setSongWizardFeedback('');
      setSongWizardStep(2);
      return;
    }

    if (songWizardStep === 2) {
      const saved = await guardarSongWizardMetadata();
      if (saved) setSongWizardStep(3);
      return;
    }

    cerrarSongWizard();
  };

  const generarMiniaturaCancion = async (songId) => {
    const response = await fetch('/api/song-artwork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songId }),
    });

    if (response.ok || response.status === 422) return;
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || 'No se pudo generar la miniatura.');
  };

  const guardarMetadata = async (cancionId, campoBd, nuevoValor) => {
    const keyContext = `${cancionId}_${campoBd}`;
    setSavingCell(prev => ({ ...prev, [keyContext]: true }));

    try {
      const updateData = { [campoBd]: nuevoValor === '' ? null : nuevoValor };
      const { error } = await supabase
        .from('canciones')
        .update(updateData)
        .eq('id', cancionId);

      if (error) throw error;

      setCanciones(prev => prev.map(c => {
        if (c.id === cancionId) {
          return { ...c, [campoBd]: nuevoValor };
        }
        return c;
      }));

      if (campoBd === 'mp3' && String(nuevoValor || '').trim()) {
        try {
          await generarMiniaturaCancion(cancionId);
        } catch (artworkError) {
          console.warn('El audio se guardo, pero su miniatura no pudo generarse:', artworkError);
        }
      }
    } catch (err) {
      console.error('Error al guardar:', err);
      alert(`Error al guardar ${campoBd}`);
      // Revertir a DB value (reload) - opcional
    } finally {
      setSavingCell(prev => ({ ...prev, [keyContext]: false }));
    }
  };

  const guardarMetricaManual = async (cancionId, nuevoValor) => {
    const rawValue = String(nuevoValor || '').trim();
    const meterValues = extractManualMeterValues(rawValue);
    if (rawValue && meterValues.length === 0) {
      alert('Usa una métrica como 4/4, 3/4 o 6/8.');
      return;
    }

    const normalizedValue = meterValues.join(' → ');
    if (metricaDisponible) {
      await guardarMetadata(cancionId, 'metrica', normalizedValue);
      return;
    }

    const currentSong = canciones.find((song) => String(song?.id) === String(cancionId));
    if (!currentSong) return;

    const keyContext = `${cancionId}_metrica`;
    setSavingCell((previous) => ({ ...previous, [keyContext]: true }));

    try {
      const nextChordpro = replaceChordProMeterMetadata(currentSong.chordpro, normalizedValue);
      const { error } = await supabase
        .from('canciones')
        .update({ chordpro: nextChordpro || null })
        .eq('id', cancionId);

      if (error) throw error;
      setCanciones((previous) => previous.map((song) => (
        String(song?.id) === String(cancionId)
          ? { ...song, chordpro: nextChordpro || null }
          : song
      )));
    } catch (error) {
      console.error('Error guardando métrica manual:', error);
      alert('No se pudo guardar la métrica.');
    } finally {
      setSavingCell((previous) => ({ ...previous, [keyContext]: false }));
    }
  };

  const subirArchivoR2 = async (file, songId, purpose = 'otro') => {
    const response = await fetch('/api/get-upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        songId,
        purpose,
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
      }),
    });

    if (!response.ok) throw new Error('No estas autorizado o hubo un error en el servidor.');

    const { presignedUrl, publicUrl } = await response.json();

    const uploadResponse = await fetch(presignedUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
    });

    if (!uploadResponse.ok) throw new Error('Fallo al subir el archivo a R2.');

    return publicUrl;
  };

  const manejarSubida = async (event, cancionId, campoBd) => {
    const file = event.target.files[0];
    if (!file) return;

    const keyContext = `${cancionId}_${campoBd}`;
    setUploading(prev => ({ ...prev, [keyContext]: true }));

    try {
      const purpose = campoBd === 'mp3' ? 'mp3' : campoBd === 'link_acordes' ? 'acordes' : 'otro';
      const publicUrl = await subirArchivoR2(file, cancionId, purpose);

      const updateData = { [campoBd]: publicUrl };
      const { error: updateError } = await supabase
        .from('canciones')
        .update(updateData)
        .eq('id', cancionId);

      if (updateError) throw updateError;

      setCanciones(prev => prev.map(c => {
        if (c.id === cancionId) {
          return { ...c, [campoBd]: publicUrl };
        }
        return c;
      }));

      if (campoBd === 'mp3') {
        try {
          await generarMiniaturaCancion(cancionId);
        } catch (artworkError) {
          console.warn('El audio se subio, pero su miniatura no pudo generarse:', artworkError);
        }
      }
    } catch (err) {
      console.error('Error subida:', err);
      alert(`Error multimedia: ${err.message}`);
    } finally {
      event.target.value = '';
      setUploading(prev => ({ ...prev, [keyContext]: false }));
    }
  };

  const manejarSubidaChordpro = async (event, cancionId) => {
    const file = event.target.files[0];
    if (!file) return;

    const keyContext = `${cancionId}_chordpro`;
    setUploading(prev => ({ ...prev, [keyContext]: true }));

    try {
      const contenidoRaw = await file.text();
      const contenidoNormalizado = normalizarChordPro(contenidoRaw);

      if (!contenidoNormalizado) {
        throw new Error('El archivo est\u00e1 vac\u00edo o no contiene texto v\u00e1lido.');
      }

      const { error: updateError } = await supabase
        .from('canciones')
        .update({ chordpro: contenidoNormalizado })
        .eq('id', cancionId);

      if (updateError) throw updateError;

      setCanciones(prev => prev.map(c => {
        if (c.id === cancionId) {
          return { ...c, chordpro: contenidoNormalizado };
        }
        return c;
      }));
    } catch (err) {
      console.error('Error subiendo ChordPro:', err);
      alert(`Error ChordPro: ${err.message}`);
    } finally {
      event.target.value = '';
      setUploading(prev => ({ ...prev, [keyContext]: false }));
    }
  };

  const abrirModalVoces = (cancion) => {
    const parsedManaged = parseVoiceAdminPayload(cancion?.link_voces || '');
    const parsedLegacy = parseVoiceAdminPayload(cancion?.voces || '');
    const entries = mergeVoiceEntriesByUrl(parsedManaged.entries, parsedLegacy.entries);
    const legacyUrl = parsedManaged.legacyUrl || parsedLegacy.legacyUrl || '';

    setVocesModalCancion(cancion);
    setVocesDraftEntries(entries.map((entry) => ({
      ...entry,
      source: 'remote',
      fileName: entry.fileName || getVoiceDisplayNameFromUrl(entry.url),
    })));
    setVocesDraftLegacyUrl(legacyUrl);
    setMostrarLinkViejoVoces(Boolean(legacyUrl));
    setVocesFeedback('');
    setVoicePreview({ id: '', url: '' });
  };

  const limpiarEntradasLocalesVoces = (entries = []) => {
    entries.forEach((entry) => {
      if (entry?.source === 'local' && entry?.previewUrl) {
        URL.revokeObjectURL(entry.previewUrl);
      }
    });
  };

  const detenerPreviewVoz = () => {
    const audio = voicePreviewAudioRef.current;
    if (audio) audio.pause();
    setVoicePreview({ id: '', url: '' });
  };

  const cerrarModalVoces = () => {
    if (guardandoVoces) return;
    detenerPreviewVoz();
    limpiarEntradasLocalesVoces(vocesDraftEntries);
    setVocesModalCancion(null);
    setVocesDraftEntries([]);
    setVocesDraftLegacyUrl('');
    setMostrarLinkViejoVoces(false);
    setVocesFeedback('');
  };

  const actualizarDraftVoz = (entryId, patch) => {
    setVocesDraftEntries((prev) => prev.map((entry) => (
      entry.id === entryId ? { ...entry, ...patch } : entry
    )));
  };

  const agregarDraftVozVacia = () => {
    setVocesDraftEntries((prev) => ([
      ...prev,
      {
        id: createVoiceEntryId('voice-manual'),
        label: VOICE_LABEL_OPTIONS[Math.min(prev.length, VOICE_LABEL_OPTIONS.length - 1)] || 'Pista',
        url: '',
        source: 'manual',
        fileName: '',
      },
    ]));
    setVocesFeedback('');
  };

  const quitarDraftVoz = (entryId) => {
    const target = vocesDraftEntries.find((entry) => entry.id === entryId);
    if (target?.source === 'local' && target?.previewUrl) {
      URL.revokeObjectURL(target.previewUrl);
    }
    if (voicePreview.id === entryId) detenerPreviewVoz();
    setVocesDraftEntries((prev) => prev.filter((entry) => entry.id !== entryId));
    setVocesFeedback('');
  };

  const mostrarEditorLinkViejo = () => {
    setMostrarLinkViejoVoces(true);
    setVocesFeedback('');
  };

  const quitarLinkViejoVoces = () => {
    setVocesDraftLegacyUrl('');
    setMostrarLinkViejoVoces(false);
    setVocesFeedback('Link viejo quitado. Guarda para aplicar.');
  };

  const actualizarLinkViejoVoces = (value) => {
    const rawValue = String(value || '');
    const parsed = parseVoiceAdminPayload(rawValue);

    if (parsed.entries.length > 0) {
      setVocesDraftEntries((prev) => mergeVoiceEntriesByUrl(prev, parsed.entries).map((entry) => ({
        ...entry,
        source: entry.source || 'remote',
        fileName: entry.fileName || getVoiceDisplayNameFromUrl(entry.url),
      })));
      setVocesDraftLegacyUrl(parsed.legacyUrl || '');
      setMostrarLinkViejoVoces(Boolean(parsed.legacyUrl));
      setVocesFeedback(`${parsed.entries.length} pista${parsed.entries.length === 1 ? '' : 's'} cargada${parsed.entries.length === 1 ? '' : 's'} desde link viejo.`);
      return;
    }

    setVocesDraftLegacyUrl(rawValue);
    setVocesFeedback('');
  };

  const reemplazarDraftVoz = (event, entryId) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setVocesDraftEntries((prev) => prev.map((entry, index) => {
      if (entry.id !== entryId) return entry;
      if (entry.source === 'local' && entry.previewUrl) {
        URL.revokeObjectURL(entry.previewUrl);
      }

      const shouldKeepLabel = entry.label && entry.label !== 'Pista';
      return {
        ...entry,
        label: shouldKeepLabel ? entry.label : getVoiceFileLabel(file.name, index),
        url: '',
        source: 'local',
        file,
        fileName: file.name,
        previewUrl: URL.createObjectURL(file),
      };
    }));

    if (voicePreview.id === entryId) detenerPreviewVoz();
    event.target.value = '';
    setVocesFeedback('Reemplazo listo para guardar.');
  };

  const getVoiceEntryPreviewUrl = (entry) => entry?.previewUrl || normalizeExternalVoiceUrl(entry?.url || '');

  const alternarPreviewVoz = (entry) => {
    const previewUrl = getVoiceEntryPreviewUrl(entry);
    if (!previewUrl) return;

    if (voicePreview.id === entry.id) {
      detenerPreviewVoz();
      return;
    }

    setVoicePreview({ id: entry.id, url: previewUrl });
  };

  const obtenerUrlsVoces = (entries = [], legacyUrl = '') => {
    const urls = (Array.isArray(entries) ? entries : [])
      .map((entry) => normalizeExternalVoiceUrl(entry?.url || ''))
      .filter(Boolean);
    const normalizedLegacyUrl = normalizeExternalVoiceUrl(legacyUrl);
    if (normalizedLegacyUrl) urls.push(normalizedLegacyUrl);
    return [...new Set(urls)];
  };

  const limpiarVocesRemovidas = async (songId, previousPayload = '', nextPayload = '') => {
    const previous = parseVoiceAdminPayload(previousPayload);
    const next = parseVoiceAdminPayload(nextPayload);
    const previousUrls = obtenerUrlsVoces(previous.entries, previous.legacyUrl);
    const nextUrls = new Set(obtenerUrlsVoces(next.entries, next.legacyUrl));
    const removedUrls = previousUrls.filter((url) => !nextUrls.has(url));

    for (const fileUrl of removedUrls) {
      const cleanupResponse = await fetch('/api/delete-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId, fileUrl }),
      });

      if (!cleanupResponse.ok) {
        const cleanupBody = await cleanupResponse.json().catch(() => null);
        throw new Error(cleanupBody?.error || 'No se pudo limpiar una voz removida.');
      }
    }
  };

  const manejarSubidaVoces = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length || !vocesModalCancion?.id) return;

    setVocesDraftEntries((prev) => [
      ...prev,
      ...files.map((file, fileIndex) => createLocalVoiceEntry(file, prev.length + fileIndex)),
    ]);
    setVocesFeedback(`${files.length} audio${files.length === 1 ? '' : 's'} listo${files.length === 1 ? '' : 's'} para guardar.`);
    event.target.value = '';
  };

  const guardarVocesDesdeModal = async () => {
    if (!vocesModalCancion?.id) return;

    const keyContext = `${vocesModalCancion.id}_link_voces`;
    const localCount = vocesDraftEntries.filter((entry) => entry.source === 'local' && entry.file).length;

    setGuardandoVoces(true);
    setUploading((prev) => ({ ...prev, [keyContext]: true }));
    setVocesFeedback(localCount > 0 ? `Subiendo ${localCount} audio${localCount === 1 ? '' : 's'}...` : 'Guardando voces...');

    try {
      const preparedEntries = [];

      for (const entry of sortVoiceEntries(vocesDraftEntries)) {
        if (entry.source === 'local' && entry.file) {
          const publicUrl = await subirArchivoR2(entry.file, vocesModalCancion.id, 'voces');
          preparedEntries.push({
            ...entry,
            source: 'remote',
            url: publicUrl,
            previewUrl: '',
            file: null,
            fileName: entry.fileName || entry.file.name,
          });
          continue;
        }

        preparedEntries.push(entry);
      }

      const parsedLegacyDraft = parseVoiceAdminPayload(vocesDraftLegacyUrl);
      const payloadEntries = mergeVoiceEntriesByUrl(preparedEntries, parsedLegacyDraft.entries);
      const payloadLegacyUrl = parsedLegacyDraft.legacyUrl || '';
      const payload = serializeVoiceAdminPayload(payloadEntries, payloadLegacyUrl);
      setVocesFeedback('Guardando voces...');
      await limpiarVocesRemovidas(
        vocesModalCancion.id,
        vocesModalCancion.link_voces || vocesModalCancion.voces || '',
        payload,
      );

      const { error: updateError } = await supabase
        .from('canciones')
        .update({ link_voces: payload || null, voces: payload || null })
        .eq('id', vocesModalCancion.id);

      if (updateError) throw updateError;

      setCanciones((prev) => prev.map((item) => (
        item.id === vocesModalCancion.id
          ? { ...item, link_voces: payload || null, voces: payload || null }
          : item
      )));

      setVocesModalCancion((prev) => (prev ? { ...prev, link_voces: payload || null, voces: payload || null } : prev));
      setVocesFeedback('Voces guardadas.');
      cerrarModalVoces();
    } catch (err) {
      console.error('Error guardando voces:', err);
      setVocesFeedback(`Error al guardar voces: ${err.message}`);
    } finally {
      setGuardandoVoces(false);
      setUploading((prev) => ({ ...prev, [keyContext]: false }));
    }
  };

  const quitarTodasLasVoces = () => {
    detenerPreviewVoz();
    limpiarEntradasLocalesVoces(vocesDraftEntries);
    setVocesDraftEntries([]);
    setVocesDraftLegacyUrl('');
    setMostrarLinkViejoVoces(false);
    setVocesFeedback('Se quitaran al guardar.');
  };

  const eliminarArchivoActual = async (cancion, campoBd) => {
    const valorActual = String(cancion?.[campoBd] || '').trim();
    if (!cancion?.id || !valorActual) return;

    const etiquetaCampo = campoBd === 'mp3' ? 'el MP3' : 'los acordes';
    const tituloCancion = String(cancion?.titulo || 'esta cancion').trim() || 'esta cancion';
    const confirmar = window.confirm(
      `Se quitara ${etiquetaCampo} de "${tituloCancion}".\n\nSi pertenece al almacenamiento de la app, tambien se intentara borrar del bucket.\n\nDeseas continuar?`
    );

    if (!confirmar) return;

    const keyContext = `${cancion.id}_${campoBd}`;
    setUploading((prev) => ({ ...prev, [keyContext]: true }));

    try {
      const cleanupResponse = await fetch('/api/delete-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId: cancion.id, fileUrl: valorActual }),
      });

      if (!cleanupResponse.ok) {
        const cleanupBody = await cleanupResponse.json().catch(() => null);
        throw new Error(cleanupBody?.error || 'No se pudo limpiar el archivo actual.');
      }

      const { error: updateError } = await supabase
        .from('canciones')
        .update({ [campoBd]: null })
        .eq('id', cancion.id);

      if (updateError) throw updateError;

      setCanciones((prev) => prev.map((item) => (
        item.id === cancion.id
          ? { ...item, [campoBd]: null }
          : item
      )));

      if (campoBd === 'mp3' && editorChordproCancion?.id === cancion.id) {
        setEditorChordproCancion((prev) => (prev ? { ...prev, mp3: null } : prev));
        setEditorAudioCurrentTime(0);
        setEditorAudioDuration(0);
        setEditorAudioPlaying(false);
        editorAudioCurrentTimeRef.current = 0;
      }
    } catch (err) {
      console.error('Error eliminando archivo:', err);
      alert(`Error al quitar ${etiquetaCampo}: ${err.message}`);
    } finally {
      setUploading((prev) => ({ ...prev, [keyContext]: false }));
    }
  };

  const abrirEditorChordpro = async (cancion) => {
    const rawChordpro = String(cancion?.chordpro || '').trim();
    let chordproParaEditor = rawChordpro;
    let aviso = '';

    setEditorChordproCancion(cancion);
    setEditorChordproValor('');
    setEditorSectionMarkers([]);
    setEditorChordproAbierto(true);
    setEditorChordproCargando(true);
    setEditorChordproAviso('');
    setEditorAuthoringPanel(null);
    setEditorAuthoringSectionIndex(-1);
    setEditorCustomGuide('');
    setEditorAuthoringFeedback('');
    setIsAutoDetecting(false);
    setAutoDetectError(null);
    setAutoDetectResult(null);

    if (isRemoteChordProTextUrl(rawChordpro)) {
      try {
        const response = await fetch(rawChordpro);
        if (response.ok) {
          const remoteText = (await response.text()).trim();
          if (remoteText) {
            chordproParaEditor = remoteText;
            aviso = 'Se cargo el contenido del TXT remoto para editarlo aqui.';
          } else {
            aviso = 'El TXT remoto esta vacio. Se mostro la URL original como respaldo.';
          }
        } else {
          aviso = 'No se pudo leer el TXT remoto. Se mostro la URL original como respaldo.';
        }
      } catch (_error) {
        aviso = 'Fallo la lectura del TXT remoto. Se mostro la URL original como respaldo.';
      }
    }

    const chordproReparado = repararChordProCorrupto(chordproParaEditor);
    if (chordproReparado && chordproReparado !== chordproParaEditor) {
      chordproParaEditor = chordproReparado;
      aviso = aviso
        ? `${aviso} Se corrigieron patrones ChordPro dañados para que puedas editar sin basura visual.`
        : 'Se corrigieron patrones ChordPro dañados para que puedas editar sin basura visual.';
    }

    const secciones = parseChordProSections(chordproParaEditor);
    setEditorChordproValor(chordproParaEditor);
    setEditorSectionMarkers(normalizeSectionMarkers(secciones, cancion?.section_markers || []));
    setEditorAuthoringSectionIndex(secciones.length > 0 ? secciones.length - 1 : -1);
    setEditorAudioCurrentTime(0);
    setEditorAudioDuration(0);
    setEditorAudioPlaying(false);
    editorAudioCurrentTimeRef.current = 0;
    setEditorChordproAviso(aviso);
    setEditorChordproCargando(false);
  };

  const abrirEditorChordproDesdeWizard = async (cancion) => {
    if (songWizardSaving || !cancion?.id) return;

    const persistedSong = await guardarSongWizardMetadata({
      progressFeedback: 'Guardando la canción antes de abrir ChordPro…',
      successFeedback: 'Cambios guardados antes de abrir ChordPro.',
    });
    if (!persistedSong) return;

    await abrirEditorChordpro(persistedSong);
  };

  const cerrarEditorChordpro = () => {
    if (guardandoChordpro) return;
    setEditorChordproAbierto(false);
    setEditorChordproCancion(null);
    setEditorChordproValor('');
    setEditorSectionMarkers([]);
    setEditorChordproCargando(false);
    setEditorChordproAviso('');
    setEditorAuthoringPanel(null);
    setEditorAuthoringSectionIndex(-1);
    setEditorCustomGuide('');
    setEditorAuthoringFeedback('');
    setIsAutoDetecting(false);
    setAutoDetectError(null);
    setAutoDetectResult(null);
    setEditorAudioCurrentTime(0);
    setEditorAudioDuration(0);
    setEditorAudioPlaying(false);
    editorAudioCurrentTimeRef.current = 0;
  };

  const guardarChordproDesdeEditor = async () => {
    if (!editorChordproCancion?.id) return;

    setGuardandoChordpro(true);

    try {
      const contenidoNormalizado = normalizarChordPro(editorChordproValor);
      const metadataChordpro = parseChordProMetadata(contenidoNormalizado);
      const metricaChordpro = formatMetadataMeter(metadataChordpro);
      const markersNormalizados = normalizeSectionMarkers(parseChordProSections(contenidoNormalizado), editorSectionMarkers);
      const updatePayload = { chordpro: contenidoNormalizado || null };

      if (sectionMarkersDisponibles) {
        updatePayload.section_markers = markersNormalizados;
      }
      if (metadataChordpro.key) {
        updatePayload.tonalidad = metadataChordpro.key;
      }
      if (metadataChordpro.bpm != null) {
        updatePayload.bpm = metadataChordpro.bpm;
      }
      if (metricaChordpro && metricaDisponible) {
        updatePayload.metrica = metricaChordpro;
      }

      const { error: updateError } = await supabase
        .from('canciones')
        .update(updatePayload)
        .eq('id', editorChordproCancion.id);

      if (updateError) throw updateError;

      setCanciones(prev => prev.map((c) => {
        if (c.id === editorChordproCancion.id) {
          return {
            ...c,
            chordpro: contenidoNormalizado,
            section_markers: sectionMarkersDisponibles ? markersNormalizados : c.section_markers,
            tonalidad: metadataChordpro.key || c.tonalidad,
            bpm: metadataChordpro.bpm ?? c.bpm,
            metrica: metricaChordpro && metricaDisponible ? metricaChordpro : c.metrica,
          };
        }
        return c;
      }));

      cerrarEditorChordpro();
    } catch (err) {
      console.error('Error guardando ChordPro:', err);
      alert(`Error ChordPro: ${err.message}`);
    } finally {
      setGuardandoChordpro(false);
    }
  };

  const renderizarCeldaArchivo = (cancion, campoBd) => {
    const valor = campoBd === 'link_voces' ? (cancion.link_voces || cancion.voces) : cancion[campoBd];
    const keyContext = `${cancion.id}_${campoBd}`;
    const estaCargando = uploading[keyContext];
    const esChordPro = campoBd === 'chordpro';
    const valorTexto = String(valor || '').trim();
    const hasChordProContent = esChordPro && hasMeaningfulChordProContent(valorTexto);
    const puedeEliminar = ARCHIVO_ELIMINABLE_FIELDS.has(campoBd);
    const etiquetaArchivo = campoBd === 'mp3' ? 'MP3 actual' : 'Acordes actuales';
    const esVoces = campoBd === 'link_voces';

    if (estaCargando) {
      return (
        <div className="flex justify-center items-center h-full text-brand min-w-[8rem]">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      );
    }

    if (esVoces) {
      const parsedVoices = parseVoiceAdminPayload(valorTexto);
      const voiceCount = parsedVoices.entries.length;
      const hasVoiceResource = voiceCount > 0 || Boolean(parsedVoices.legacyUrl);
      const statusLabel = voiceCount > 0
        ? `${voiceCount} ${voiceCount === 1 ? 'voz' : 'voces'}`
        : parsedVoices.legacyUrl
          ? 'Link'
          : 'Sin voces';

      return (
        <div className="flex h-full min-w-[8rem] items-center justify-center px-1.5 py-1">
          <button
            type="button"
            onClick={() => abrirModalVoces(cancion)}
            className={`group inline-flex min-h-[34px] w-full items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-all shadow-sm ${hasVoiceResource ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/15' : 'border-border bg-surface text-action hover:bg-background'}`}
            title={hasVoiceResource ? `Gestionar voces: ${statusLabel}` : 'Subir o anexar voces'}
            aria-label={`${hasVoiceResource ? 'Gestionar' : 'Subir'} voces de ${cancion?.titulo || 'cancion'}`}
          >
            {hasVoiceResource ? <CheckCircle className="h-4 w-4" /> : <UploadCloud className="h-4 w-4" />}
            <span className="truncate">{hasVoiceResource ? statusLabel : 'Subir'}</span>
          </button>
        </div>
      );
    }

    if (valorTexto && !esChordPro) {
      return (
        <div className="group relative flex min-h-[44px] min-w-[8rem] items-center justify-center px-2 py-1.5" title={valorTexto}>
          <CheckCircle className="h-5 w-5 text-emerald-500" />
          {puedeEliminar && (
            <button
              type="button"
              onClick={() => eliminarArchivoActual(cancion, campoBd)}
              className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full border border-transparent bg-surface/90 text-content-muted opacity-100 transition-all hover:border-danger/20 hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
              aria-label={`Eliminar ${etiquetaArchivo}`}
              title={`Quitar ${etiquetaArchivo}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      );
    }

    if (esChordPro) {
      return (
        <div className="inline-flex w-full min-w-[17rem] flex-nowrap items-center justify-center gap-2 py-0.5 px-1.5">
          <label
            className={`cursor-pointer group inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-action transition-all shadow-sm whitespace-nowrap hover:bg-surface ${hasChordProContent ? 'border-brand/30 bg-brand/10 text-brand' : ''}`}
            title={hasChordProContent ? 'ChordPro cargado. Puedes reemplazarlo.' : undefined}
          >
            <UploadCloud className="w-4 h-4" />
            <span className="text-xs font-semibold text-content group-hover:text-action transition-colors">
              {hasChordProContent ? 'Reemplazar TXT' : 'Subir TXT'}
            </span>
            <input
              type="file"
              hidden
              accept=".txt,.pro,.cho,.chordpro,text/plain"
              onChange={(e) => manejarSubidaChordpro(e, cancion.id)}
            />
          </label>

          <button
            type="button"
            onClick={() => abrirEditorChordpro(cancion)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-all shadow-sm ${hasChordProContent ? 'border-brand/30 bg-brand/10 text-brand hover:bg-brand/15' : 'border-border bg-surface text-content hover:bg-background'}`}
          >
            <PencilLine className="w-3.5 h-3.5" />
            {hasChordProContent ? 'Editar' : 'Pegar'}
          </button>
        </div>
      );
    }

    return (
      <div className="flex justify-center items-center h-full min-w-[8rem]">
        <label
          className="cursor-pointer group flex items-center justify-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-action transition-all shadow-sm hover:bg-surface"
        >
          <UploadCloud className="w-4 h-4" />
          <span className="text-xs font-semibold text-content group-hover:text-action transition-colors">
            Subir
          </span>
          <input
            type="file"
            hidden
            onChange={(e) => manejarSubida(e, cancion.id, campoBd)}
          />
        </label>
      </div>
    );
  };

  const construirLiveDirectorUrl = (cancionId) => (
    `/herramientas/live-director-preview?song=${encodeURIComponent(String(cancionId || ''))}`
  );

  const renderWizardResourceCard = (song, resource) => {
    const Icon = resource.icon;
    const field = resource.field;
    const rawValue = field === 'link_voces'
      ? (song?.link_voces || song?.voces)
      : field
        ? song?.[field]
        : '';
    const hasResource = resource.type === 'chordpro'
      ? hasMeaningfulChordProContent(rawValue)
      : Boolean(String(rawValue || '').trim());
    const uploadKey = field ? `${song?.id}_${field}` : '';
    const isUploading = Boolean(uploadKey && uploading[uploadKey]);

    if (resource.type === 'live') {
      return (
        <article className="flex min-h-[7.25rem] flex-col justify-between rounded-2xl border border-border bg-background/75 p-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h4 className="font-bold text-content">{resource.label}</h4>
              <p className="mt-0.5 text-xs leading-5 text-content-muted">{resource.description}</p>
            </div>
          </div>
          <a
            href={construirLiveDirectorUrl(song.id)}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl border border-brand/25 bg-brand/10 px-3 text-sm font-semibold text-brand transition-colors hover:bg-brand/15"
          >
            <ExternalLink className="h-4 w-4" />
            Abrir
          </a>
        </article>
      );
    }

    if (resource.type === 'voices') {
      const parsedVoices = parseVoiceAdminPayload(String(rawValue || '').trim());
      const voiceCount = parsedVoices.entries.length;
      const status = voiceCount > 0
        ? `${voiceCount} ${voiceCount === 1 ? 'voz' : 'voces'}`
        : parsedVoices.legacyUrl
          ? 'Link conectado'
          : 'Pendiente';
      return (
        <article className="flex min-h-[7.25rem] flex-col justify-between rounded-2xl border border-border bg-background/75 p-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-500">
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h4 className="font-bold text-content">{resource.label}</h4>
              <p className={`mt-0.5 text-xs font-semibold ${hasResource ? 'text-emerald-500' : 'text-content-muted'}`}>{status}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => abrirModalVoces(song)}
            className="mt-3 inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-content transition-colors hover:border-violet-500/30 hover:text-violet-500"
          >
            <PencilLine className="h-4 w-4" />
            {hasResource ? 'Gestionar' : 'Añadir'}
          </button>
        </article>
      );
    }

    if (resource.type === 'chordpro') {
      return (
        <article className="flex min-h-[7.25rem] flex-col justify-between rounded-2xl border border-border bg-background/75 p-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h4 className="font-bold text-content">{resource.label}</h4>
              {resource.description && (
                <p className="mt-0.5 text-xs leading-4 text-content-muted">{resource.description}</p>
              )}
              <p className={`mt-0.5 text-xs font-semibold ${hasResource ? 'text-emerald-500' : 'text-content-muted'}`}>
                {hasResource ? 'Listo' : 'Pendiente'}
              </p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className={`inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl border border-border bg-surface px-2 text-xs font-semibold text-content transition-colors ${songWizardSaving
              ? 'pointer-events-none cursor-not-allowed opacity-50'
              : 'cursor-pointer hover:border-amber-500/30 hover:text-amber-500'
            }`}>
              {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              Importar
              <input
                type="file"
                hidden
                accept=".txt,.pro,.cho,.chordpro,text/plain"
                disabled={isUploading || songWizardSaving}
                onChange={(event) => manejarSubidaChordpro(event, song.id)}
              />
            </label>
            <button
              type="button"
              onClick={() => abrirEditorChordproDesdeWizard(song)}
              disabled={songWizardSaving || isUploading}
              className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl border border-border bg-surface px-2 text-xs font-semibold text-content transition-colors hover:border-amber-500/30 hover:text-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {songWizardSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PencilLine className="h-4 w-4" />}
              {songWizardSaving ? 'Guardando…' : (hasResource ? 'Editar' : 'Crear')}
            </button>
          </div>
        </article>
      );
    }

    return (
      <article className="flex min-h-[7.25rem] flex-col justify-between rounded-2xl border border-border bg-background/75 p-4">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h4 className="font-bold text-content">{resource.label}</h4>
            <p className={`mt-0.5 text-xs font-semibold ${hasResource ? 'text-emerald-500' : 'text-content-muted'}`}>
              {hasResource ? 'Archivo listo' : 'Pendiente'}
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <label className="inline-flex min-h-[40px] flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-content transition-colors hover:border-brand/30 hover:text-brand">
            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            {hasResource ? 'Reemplazar' : 'Subir'}
            <input
              type="file"
              hidden
              accept={resource.accept}
              disabled={isUploading}
              onChange={(event) => manejarSubida(event, song.id, field)}
            />
          </label>
          {hasResource && ARCHIVO_ELIMINABLE_FIELDS.has(field) && (
            <button
              type="button"
              onClick={() => eliminarArchivoActual(song, field)}
              disabled={isUploading}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-danger/20 bg-danger/10 text-danger transition-colors hover:bg-danger/15 disabled:opacity-50"
              aria-label={`Quitar ${resource.label}`}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </article>
    );
  };

  const desplazarTablaHorizontalmente = (delta) => {
    const scrollEl = tableScrollRef.current;
    if (!scrollEl) return;

    scrollEl.scrollBy({
      left: delta,
      behavior: 'smooth',
    });
  };

  const manejarClickEnTrackHorizontal = (event) => {
    if (event.target instanceof HTMLElement && event.target.dataset.adminScrollThumb === 'true') {
      return;
    }

    const scrollEl = tableScrollRef.current;
    const trackEl = horizontalTrackRef.current;
    if (!scrollEl || !trackEl || !horizontalScrollUi.hasOverflow) return;

    const rect = trackEl.getBoundingClientRect();
    const clickOffset = event.clientX - rect.left - (horizontalScrollUi.thumbWidth / 2);
    const maxThumbOffset = Math.max(0, rect.width - horizontalScrollUi.thumbWidth);
    const clampedOffset = Math.max(0, Math.min(clickOffset, maxThumbOffset));
    const maxScrollLeft = Math.max(0, scrollEl.scrollWidth - scrollEl.clientWidth);
    const nextScrollLeft = maxThumbOffset > 0
      ? (clampedOffset / maxThumbOffset) * maxScrollLeft
      : 0;

    scrollEl.scrollTo({
      left: nextScrollLeft,
      behavior: 'smooth',
    });
  };

  const iniciarDragHorizontalThumb = (event) => {
    if (!horizontalScrollUi.hasOverflow) return;

    event.preventDefault();
    horizontalDragStateRef.current = {
      startX: event.clientX,
      startScrollLeft: tableScrollRef.current?.scrollLeft || 0,
    };
    setDraggingHorizontalThumb(true);
  };

  const toggleEditorAudioPlayback = async () => {
    const audio = document.getElementById('admin-chordpro-audio');
    if (!audio || !editorChordproCancion?.mp3) return;

    try {
      if (audio.paused) {
        await audio.play();
      } else {
        audio.pause();
      }
    } catch (_error) {
      setEditorAudioPlaying(false);
    }
  };

  const handleEditorAudioSeek = (nextValue) => {
    const audio = document.getElementById('admin-chordpro-audio');
    const nextTime = Math.max(0, Number(nextValue) || 0);
    setEditorAudioCurrentTime(nextTime);
    editorAudioCurrentTimeRef.current = nextTime;
    if (audio) {
      audio.currentTime = nextTime;
    }
  };

  const actualizarEditorSectionMarker = (markerIndex, patch) => {
    setEditorSectionMarkers((prev) => prev.map((item, itemIndex) => (
      itemIndex === markerIndex ? { ...item, ...patch } : item
    )));
  };

  const actualizarEditorSectionNote = (markerIndex, note) => {
    actualizarEditorSectionMarker(markerIndex, { note });
    setEditorChordproValor((previous) => (
      updateChordProSectionNoteAtIndex(previous, markerIndex, note)
    ));
  };

  const capturarSiguienteCueActual = (markerIndex, totalCues = 1) => {
    setEditorSectionMarkers((prev) => prev.map((item, itemIndex) => {
      if (itemIndex !== markerIndex) return item;
      const capturePatch = buildNextChordProCueCapture(
        item,
        totalCues,
        editorAudioCurrentTimeRef.current,
      );
      return capturePatch
        ? { ...item, ...toManualMarkerPatch(capturePatch) }
        : item;
    }));
  };

  const actualizarCueMarkerIndividual = (markerIndex, cueMarkerIndex, nextValue) => {
    setEditorSectionMarkers((prev) => prev.map((item, itemIndex) => {
      if (itemIndex !== markerIndex) return item;

      const sectionStartSec = item?.startSec == null ? null : Number(item.startSec);
      const currentCueMarkers = normalizeCueMarkerTimes(item?.cueMarkers, sectionStartSec);
      if (nextValue == null) {
        return {
          ...item,
          ...toManualMarkerPatch({ cueMarkers: currentCueMarkers.slice(0, cueMarkerIndex) }),
        };
      }

      const floor = cueMarkerIndex === 0
        ? sectionStartSec
        : currentCueMarkers[cueMarkerIndex - 1];
      if (!Number.isFinite(floor) || Number(nextValue) <= floor) return item;

      const nextCueMarkers = [
        ...currentCueMarkers.slice(0, cueMarkerIndex),
        toPreciseSeconds(nextValue),
        ...currentCueMarkers.slice(cueMarkerIndex + 1).filter((value) => value > Number(nextValue)),
      ];

      return {
        ...item,
        ...toManualMarkerPatch({
          cueMarkers: normalizeCueMarkerTimes(nextCueMarkers, sectionStartSec),
        }),
      };
    }));
  };

  const autoDetectMarkers = async ({ deepAnalysis = false } = {}) => {
    if (!editorChordproCancion?.mp3) {
      setAutoDetectError('Esta cancion no tiene MP3 cargado.');
      return;
    }

    const currentSections = parseChordProSections(editorChordproValor);
    if (currentSections.length === 0) {
      setAutoDetectError('Agrega encabezados como [Verso 1] o [Coro] antes de auto-detectar.');
      return;
    }

    setIsAutoDetecting(true);
    setAutoDetectError(null);
    setAutoDetectResult(null);

    try {
      const sectionsPayload = currentSections.map((section) => ({
        name: section.name,
        firstLine: getFirstMeaningfulSectionLine(section),
        lines: Array.isArray(section?.lines) ? section.lines : [],
      }));

      const response = await fetch('/api/auto-markers', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mp3Url: editorChordproCancion.mp3,
          deepAnalysis,
          songContext: {
            songId: editorChordproCancion?.id || '',
            title: editorChordproCancion?.titulo || '',
            artist: editorChordproCancion?.cantante || '',
            key: editorChordproCancion?.tonalidad || '',
            bpm: editorChordproCancion?.bpm || '',
          },
          sections: sectionsPayload,
        }),
      });

      const rawResponse = await response.text();
      let result = {};
      try {
        result = rawResponse ? JSON.parse(rawResponse) : {};
      } catch (_error) {
        result = {};
      }

      if (!response.ok || result?.error) {
        const statusLabel = response.status ? `HTTP ${response.status}` : 'sin respuesta';
        const fallbackMessage = response.status === 401
          ? 'Tu sesion expiro. Recarga la pagina e intenta de nuevo.'
          : response.status === 502 || response.status === 504
            ? 'El servidor no completo el analisis de audio. Intenta de nuevo en unos segundos.'
            : `No se pudieron detectar markers automaticamente (${statusLabel}).`;
        setAutoDetectError(response.status === 401 ? fallbackMessage : result?.error || fallbackMessage);
        return;
      }

      if (result?.fallback === 'no-lyrics') {
        setAutoDetectError('No se reconocio suficiente letra en el audio. No se modificaron los markers.');
        return;
      }

      if (Array.isArray(result?.markers)) {
        setEditorSectionMarkers((prev) => {
          const updated = normalizeSectionMarkers(currentSections, prev);
          result.markers.forEach((suggested, index) => {
            if (index >= updated.length || suggested?.startSec == null) return;

            updated[index] = {
              ...updated[index],
              startSec: suggested.startSec,
              cueMarkers: normalizeCueMarkerTimes(suggested?.cueMarkers, suggested.startSec),
              _autoDetected: true,
              _confidence: Number(suggested?.confidence) || 0,
              _method: String(suggested?.method || 'whisper-match'),
            };
          });
          return updated;
        });

        setAutoDetectResult({
          total: result.markers.length,
          matched: result.markers.filter((marker) => marker?.method === 'whisper-match').length,
          guideMatched: result.markers.filter((marker) => marker?.method === 'guide-cue').length,
          deepMatched: result.markers.filter((marker) => marker?.method === 'deep-text-structure').length,
          interpolated: result.markers.filter((marker) => marker?.method === 'interpolated').length,
          hybrid: result.markers.filter((marker) => marker?.method === 'hybrid-structure').length,
          failed: result.markers.filter((marker) => marker?.method === 'no-match' || marker?.method === 'no-lyrics').length,
          cueMarkersDetected: result.markers.reduce(
            (sum, marker) => sum + (Array.isArray(marker?.cueMarkers) ? marker.cueMarkers.length : 0),
            0,
          ),
          repeatSuggestions: Array.isArray(result?.repeatSuggestions) ? result.repeatSuggestions : [],
          quality: result?.quality || null,
          audioSource: result?.audioSource || null,
          deepAnalysis: Boolean(result?.deepAnalysis),
          language: String(result?.language || 'es').toUpperCase(),
          fallback: null,
        });
        return;
      }

      setAutoDetectError('La IA no devolvio markers utilizables.');
    } catch (error) {
      setAutoDetectError(`Error de red: ${error?.message || 'desconocido'}`);
    } finally {
      setIsAutoDetecting(false);
    }
  };

  const aplicarRepeatSuggestion = (suggestion, suggestionIndex) => {
    const sectionBlock = buildRepeatSectionBlock(suggestion);
    if (!sectionBlock) return;

    const suggestedStartSec = Number(suggestion?.startSec);
    const timeBasedInsertionIndex = Number.isFinite(suggestedStartSec)
      ? editorSectionMarkers.reduce((lastIndex, marker, markerIndex) => (
        marker?.startSec != null && Number(marker.startSec) < suggestedStartSec ? markerIndex : lastIndex
      ), -1)
      : -1;
    const fallbackInsertionIndex = Number.isFinite(Number(suggestion?.insertAfterIndex))
      ? Number(suggestion.insertAfterIndex)
      : -1;
    const insertionIndex = Math.max(timeBasedInsertionIndex, fallbackInsertionIndex);
    const nextChordpro = insertChordProSectionAfterIndex(editorChordproValor, insertionIndex, sectionBlock);
    const nextRawMarkers = [...editorSectionMarkers];
    const markerInsertionIndex = Math.min(nextRawMarkers.length, Math.max(0, insertionIndex + 1));

    nextRawMarkers.splice(markerInsertionIndex, 0, {
      sectionName: String(suggestion?.suggestedName || 'Repeticion'),
      startSec: Number.isFinite(suggestedStartSec) ? toPreciseSeconds(suggestedStartSec) : null,
      cueMarkers: [],
      note: '',
      _autoDetected: true,
      _confidence: Number(suggestion?.confidence) || 0.62,
      _method: 'repeat-detected',
    });

    setEditorChordproValor(nextChordpro);
    setEditorSectionMarkers(normalizeSectionMarkers(parseChordProSections(nextChordpro), nextRawMarkers));
    setAutoDetectResult((prev) => {
      if (!prev) return prev;
      const repeatSuggestions = Array.isArray(prev.repeatSuggestions)
        ? prev.repeatSuggestions.filter((_, index) => index !== suggestionIndex)
        : [];
      return {
        ...prev,
        repeatSuggestions,
        appliedRepeats: (Number(prev.appliedRepeats) || 0) + 1,
      };
    });
    setEditorChordproAviso(`Se agrego ${suggestion?.suggestedName || 'la repeticion'} como seccion editable. Revisa el marker antes de guardar.`);
  };

  const toggleEditorAuthoringPanel = (panelName) => {
    setEditorAuthoringFeedback('');
    setEditorAuthoringPanel((previous) => (previous === panelName ? null : panelName));
  };

  const seleccionarEditorAuthoringSection = (sectionIndex) => {
    setEditorAuthoringSectionIndex(sectionIndex);
    setEditorAuthoringFeedback('');
  };

  const sincronizarEditorChordproScroll = (event) => {
    const highlight = editorChordproHighlightRef.current;
    if (!highlight) return;
    highlight.scrollTop = event.currentTarget.scrollTop;
    highlight.scrollLeft = event.currentTarget.scrollLeft;
  };

  const agregarEditorChordproSection = (preset) => {
    const sectionLabel = buildSuggestedSectionLabel(
      preset?.label,
      seccionesEditorChordpro.map((section) => section.name),
    );
    const sectionBlock = buildChordProSectionBlock(sectionLabel);
    if (!sectionBlock) return;

    const insertionIndex = seccionesEditorChordpro.length > 0
      ? Math.min(
        seccionesEditorChordpro.length - 1,
        Math.max(0, editorAuthoringSectionIndex),
      )
      : -1;
    const nextChordpro = insertChordProSectionAfterIndex(
      editorChordproValor,
      insertionIndex,
      sectionBlock,
    );
    const markerInsertionIndex = Math.min(
      editorSectionMarkers.length,
      Math.max(0, insertionIndex + 1),
    );
    const nextRawMarkers = [...editorSectionMarkers];
    nextRawMarkers.splice(markerInsertionIndex, 0, {
      sectionName: sectionLabel,
      startSec: null,
      cueMarkers: [],
      note: '',
      _autoDetected: false,
      _confidence: 0,
      _method: 'manual',
    });

    setEditorChordproValor(nextChordpro);
    setEditorSectionMarkers(normalizeSectionMarkers(
      parseChordProSections(nextChordpro),
      nextRawMarkers,
    ));
    setEditorAuthoringSectionIndex(markerInsertionIndex);
    setEditorAuthoringFeedback(`${sectionLabel} añadida`);
  };

  const aplicarEditorChordproGuide = (rawGuide, shouldRemove = false) => {
    if (!editorCanAnnotateSection || editorAuthoringSectionIndex < 0) return;

    const currentNote = editorAuthoringSection.note || editorAuthoringMarker?.note || '';
    const nextNote = shouldRemove
      ? removeChordProGuideNote(currentNote, rawGuide)
      : mergeChordProGuideNote(currentNote, rawGuide);
    const nextChordpro = updateChordProSectionNoteAtIndex(
      editorChordproValor,
      editorAuthoringSectionIndex,
      nextNote,
    );

    setEditorChordproValor(nextChordpro);
    setEditorSectionMarkers((previous) => previous.map((marker, markerIndex) => (
      markerIndex === editorAuthoringSectionIndex
        ? { ...marker, note: nextNote }
        : marker
    )));
    setEditorAuthoringFeedback(shouldRemove ? 'Guía eliminada' : 'Guía añadida');
  };

  const agregarEditorCustomGuide = () => {
    const customGuide = String(editorCustomGuide || '').trim();
    if (!customGuide) return;
    aplicarEditorChordproGuide(customGuide);
    setEditorCustomGuide('');
  };

  const editorAudioProgress = editorAudioDuration > 0
    ? Math.min(100, Math.max(0, (editorAudioCurrentTime / editorAudioDuration) * 100))
    : 0;
  const tituloEditorChordpro = editorChordproCancion?.titulo || 'Sin titulo';
  const totalMarkersEditor = editorSectionMarkers.length || resumenEditorChordpro.secciones;

  const headerActions = (
    <>
      <button
        onClick={() => {
          if (activeAdminArea === 'warmups') {
            setWarmupCreateSignal((previous) => previous + 1);
          } else {
            abrirWizardNuevaCancion();
          }
        }}
        disabled={activeAdminArea === 'songs' && (loading || songWizardSaving)}
        className="inline-flex min-h-[34px] items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand/90 disabled:opacity-50"
      >
        {activeAdminArea === 'songs' && loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        {activeAdminArea === 'warmups' ? 'Nuevo ejercicio' : 'Nueva'}
      </button>

      <span
        title={activeAdminArea === 'warmups' ? 'Calentamientos cargados' : 'Canciones sin ChordPro'}
        className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold md:text-xs ${activeAdminArea === 'warmups'
          ? 'border-brand/25 bg-brand/10 text-brand'
          : cancionesPendientesChordpro.length > 0
            ? 'border-amber-500/25 bg-amber-500/10 text-amber-600'
            : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600'
        }`}
      >
        <span className="inline-flex min-w-[1.65rem] items-center justify-center rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-black">
          {activeAdminArea === 'warmups' ? warmupCount : cancionesPendientesChordpro.length}
        </span>
        <span className="hidden sm:inline">{activeAdminArea === 'warmups' ? 'Ejercicios' : 'Sin ChordPro'}</span>
      </span>

      {activeAdminArea === 'songs' && !sectionMarkersDisponibles && (
        <span className="inline-flex min-h-[34px] items-center rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-600 md:text-xs">
          <span className="hidden sm:inline">Falta migracion de</span>
          <code className="mx-1 text-[11px] font-semibold">section_markers</code>
        </span>
      )}
    </>
  );

  if (!loading && !sessionUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-6 text-red-500">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
        </div>
        <h2 className="text-2xl font-bold text-content mb-3">Acceso Restringido</h2>
        <p className="text-content-muted max-w-md mb-8">
          Debe iniciar sesion para gestionar el repertorio. Las politicas de seguridad (RLS) bloquean el acceso anonimo a esta seccion.
        </p>
        <a
          href="/login"
          className="inline-flex items-center justify-center px-6 py-3 bg-action hover:bg-action/90 text-white font-semibold rounded-xl shadow-sm transition-all"
        >
          Ir a Iniciar Sesion
        </a>
      </div>
    );
  }

  return (
    <div className="antialiased flex h-full min-h-0 flex-1 flex-col overflow-hidden pb-[calc(env(safe-area-inset-bottom)+0.2rem)]">
      {headerActionsReady && (headerActionsHost
        ? createPortal(headerActions, headerActionsHost)
        : (
          <div className="mb-1.5 shrink-0 flex flex-wrap items-center gap-1.5 px-2 md:px-3 xl:px-4">
            {headerActions}
          </div>
        ))}

      <nav className="mx-3 mb-2 grid shrink-0 grid-cols-2 gap-1 rounded-xl border border-border bg-surface/90 p-1 md:mx-4 md:max-w-md" aria-label="Áreas de administración">
        <button
          type="button"
          onClick={() => {
            setActiveAdminArea('songs');
            setSongWizardOpen(false);
          }}
          aria-current={activeAdminArea === 'songs' ? 'page' : undefined}
          className={`inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg px-3 text-sm font-bold transition-colors ${activeAdminArea === 'songs' ? 'bg-brand text-white shadow-sm' : 'text-content-muted hover:bg-background hover:text-content'}`}
        >
          <Music2 className="h-4 w-4" />
          Canciones
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveAdminArea('warmups');
            setSongWizardOpen(false);
          }}
          aria-current={activeAdminArea === 'warmups' ? 'page' : undefined}
          className={`inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg px-3 text-sm font-bold transition-colors ${activeAdminArea === 'warmups' ? 'bg-brand text-white shadow-sm' : 'text-content-muted hover:bg-background hover:text-content'}`}
        >
          <Mic2 className="h-4 w-4" />
          Calentamientos
        </button>
      </nav>

      <div className="hidden mb-6 flex-col sm:flex-row sm:items-center justify-between gap-4 px-4 max-w-7xl mx-auto w-full">
        <div>
          <p className="text-content-muted leading-relaxed max-w-2xl text-sm">
            Gestor tipo Excel. Edita los metadatos directamente en las celdas y sube los archivos de forma instantanea.
          </p>
        </div>
        <button
          onClick={abrirWizardNuevaCancion}
          disabled={loading || songWizardSaving}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-brand text-white rounded-xl font-bold hover:bg-brand/90 transition-colors shadow disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
          Anadir Cancion
        </button>
      </div>

      <div className="hidden mb-6 grid gap-4 px-4 max-w-7xl mx-auto w-full lg:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.95fr)]">
        <section className="rounded-3xl border border-border bg-surface px-5 py-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-content-muted">Metadata por seccion</p>
              <h2 className="mt-1 text-lg font-bold text-content">Formato listo para modo ensayo</h2>
            </div>
            <span className="inline-flex items-center rounded-full border border-brand/25 bg-brand/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-brand">
              Parser compartido
            </span>
          </div>
          <div className="mt-4 grid gap-3 text-sm text-content-muted md:grid-cols-3">
            <div className="rounded-2xl border border-border bg-background/70 p-3">
              <p className="font-semibold text-content">Seccion con nota</p>
              <code className="mt-2 block whitespace-pre-wrap text-[12px] text-brand">[Intro|Pad y Piano]</code>
            </div>
            <div className="rounded-2xl border border-border bg-background/70 p-3">
              <p className="font-semibold text-content">Atajo desde texto</p>
              <code className="mt-2 block whitespace-pre-wrap text-[12px] text-brand">[Intro] Pad y Piano</code>
            </div>
            <div className="rounded-2xl border border-border bg-background/70 p-3">
              <p className="font-semibold text-content">Comentario de seccion</p>
              <code className="mt-2 block whitespace-pre-wrap text-[12px] text-brand">{`{comment: Bombo + Pad}`}</code>
            </div>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-content-muted">
            Al guardar, el admin normaliza encabezados inline para que ensayo lea la nota de cada seccion sin romper el flujo actual.
          </p>
        </section>

        <section className="rounded-3xl border border-border bg-surface px-5 py-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-content-muted">Detector</p>
              <h2 className="mt-1 text-lg font-bold text-content">Canciones activas sin ChordPro</h2>
            </div>
            <span className={`inline-flex min-w-[2.5rem] items-center justify-center rounded-full px-3 py-1 text-sm font-black ${cancionesPendientesChordpro.length > 0 ? 'bg-amber-500/15 text-amber-500' : 'bg-emerald-500/15 text-emerald-500'}`}>
              {cancionesPendientesChordpro.length}
            </span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-content-muted">
            Esto te muestra que canciones siguen activas en repertorio pero todavia no tienen guia para el modo ensayo.
          </p>
          <div className="mt-4 max-h-56 space-y-2 overflow-auto pr-1">
            {cancionesPendientesChordpro.length > 0 ? cancionesPendientesChordpro.map((cancion) => (
              <div key={`faltante-${cancion.id}`} className="rounded-2xl border border-border bg-background/70 px-3 py-2.5">
                <p className="truncate text-sm font-semibold text-content">{cancion.titulo || 'Sin titulo'}</p>
                <p className="truncate text-xs text-content-muted">
                  {cancion.cantante || 'Sin cantante'} · {cancion.tonalidad || '-'} · {cancion.bpm || '-'} BPM
                </p>
              </div>
            )) : (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-3 text-sm font-medium text-emerald-500">
                No hay activas pendientes: todas las canciones activas ya tienen ChordPro cargado.
              </div>
            )}
          </div>
        </section>
      </div>

      {errorTexto && (
        <div className="mx-2 mb-3 shrink-0 rounded-xl border border-red-500/20 bg-red-50/10 p-4 font-medium text-red-500 md:mx-4 xl:mx-5">
          {errorTexto}
        </div>
      )}

      {activeAdminArea === 'warmups' ? (
        <AdminVocalWarmups
          createSignal={warmupCreateSignal}
          onCountChange={setWarmupCount}
        />
      ) : loading && canciones.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 py-16">
          <Loader2 className="w-10 h-10 text-brand animate-spin" />
          <span className="text-content-muted font-medium tracking-wide">Cargando base de datos...</span>
        </div>
      ) : isCompactAdmin ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.25rem] border border-border bg-surface/95 shadow-[0_18px_38px_-24px_rgba(15,23,42,0.32)]">
            <div className="shrink-0 border-b border-border bg-surface/95 p-3 backdrop-blur-xl">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted" aria-hidden="true" />
                <input
                  type="search"
                  value={mobileSearch}
                  onChange={(event) => setMobileSearch(event.target.value)}
                  placeholder="Buscar canción o cantante"
                  aria-label="Buscar canción o cantante"
                  className="h-12 w-full rounded-xl border border-border bg-background pl-10 pr-4 text-base text-content outline-none transition-colors placeholder:text-content-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
              </div>

              <div className="mt-2.5 flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted" aria-hidden="true" />
                  <select
                    value={mobileFilter}
                    onChange={(event) => setMobileFilter(event.target.value)}
                    aria-label="Filtrar repertorio"
                    className="h-10 w-full appearance-none rounded-xl border border-border bg-background pl-9 pr-8 text-sm font-semibold text-content outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  >
                    <option value="todas">Todas las canciones</option>
                    <option value="activas">Solo activas</option>
                    <option value="sin_chordpro">Sin ChordPro</option>
                  </select>
                  <ChevronRight className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 text-content-muted" aria-hidden="true" />
                </div>
                <span className="inline-flex h-10 shrink-0 items-center rounded-xl border border-border bg-background px-3 text-xs font-bold tabular-nums text-content-muted">
                  {mobileSongs.length} de {canciones.length}
                </span>
              </div>
            </div>

            <div className="admin-mobile-song-list min-h-0 flex-1 space-y-2.5 overflow-y-auto bg-background/70 p-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
              {mobileSongs.map((song) => {
                const estado = String(song?.estado || 'Sin estado').trim() || 'Sin estado';
                const isArchived = normalizeSearchText(estado) === 'archivada';
                const resourceCount = getSongResourceCount(song);
                const metadataItems = [
                  song?.tonalidad ? `Tono ${song.tonalidad}` : '',
                  song?.bpm ? `${song.bpm} BPM` : '',
                  song?.categoria || '',
                ].filter(Boolean);

                return (
                  <article key={song.id} className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
                    <div className="flex items-start gap-3">
                      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                        <Music2 className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h2 className="truncate text-base font-bold text-content">{song?.titulo || 'Sin título'}</h2>
                            <p className="mt-0.5 truncate text-sm text-content-muted">{song?.cantante || 'Sin cantante'}</p>
                          </div>
                          <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${isArchived ? 'bg-content-muted/10 text-content-muted' : 'bg-emerald-500/10 text-emerald-500'}`}>
                            {estado}
                          </span>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {metadataItems.length > 0 ? metadataItems.map((item) => (
                            <span key={`${song.id}-${item}`} className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-semibold text-content-muted">
                              {item}
                            </span>
                          )) : (
                            <span className="text-xs text-content-muted">Sin datos musicales</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-content">{resourceCount}/6 recursos</p>
                        <p className={`mt-0.5 text-[11px] ${hasMeaningfulChordProContent(song?.chordpro) ? 'text-emerald-500' : 'text-amber-500'}`}>
                          {hasMeaningfulChordProContent(song?.chordpro) ? 'ChordPro listo' : 'Falta ChordPro'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => abrirWizardEditarCancion(song)}
                        className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white shadow-sm transition-colors hover:bg-brand/90"
                        aria-label={`Editar ${song?.titulo || 'canción'}`}
                      >
                        <PencilLine className="h-4 w-4" />
                        Editar
                      </button>
                    </div>
                  </article>
                );
              })}

              {mobileSongs.length === 0 && (
                <div className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface px-6 text-center">
                  <Music2 className="h-8 w-8 text-content-muted" />
                  <p className="mt-3 font-bold text-content">No encontramos canciones</p>
                  <p className="mt-1 text-sm text-content-muted">Cambia el filtro o crea una nueva.</p>
                  <button
                    type="button"
                    onClick={abrirWizardNuevaCancion}
                    className="mt-4 inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white"
                  >
                    <Plus className="h-4 w-4" />
                    Nueva canción
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 md:px-3 xl:px-4">
          <section className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-[1.05rem] border border-border/90 bg-surface/95 shadow-[0_18px_38px_-24px_rgba(15,23,42,0.28)]">
            <div ref={tableScrollRef} className="admin-table-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-background/90 pb-[calc(env(safe-area-inset-bottom)+2.45rem)]">
              <table className="relative w-max min-w-full border-separate border-spacing-0 bg-surface text-left">
                <thead className="admin-table-head">
                  <tr className="admin-table-head-row text-xs uppercase tracking-wider text-content-muted font-bold divide-x divide-border">
                    {/* Fijas */}
                    <th className="admin-head-cell admin-head-cell-primary overflow-hidden border-r border-border px-0 py-0 text-center min-w-[14rem] max-w-[14rem]">
                      <div className="h-full w-full truncate px-4 py-3 text-left">Titulo / Cantante</div>
                    </th>
                    {/* Metadata */}
                    <th className="admin-head-cell px-4 py-3 min-w-[6rem]">Tonalidad</th>
                    <th className="admin-head-cell px-4 py-3 min-w-[5rem]">BPM</th>
                    <th className="admin-head-cell px-4 py-3 min-w-[5.5rem]">Métrica</th>
                    <th className="admin-head-cell px-4 py-3 min-w-[8rem]">Categoria</th>
                    <th className="admin-head-cell px-4 py-3 min-w-[8rem]">Voz</th>
                    <th className="admin-head-cell px-4 py-3 min-w-[8rem]">Tema</th>
                    <th className="admin-head-cell px-4 py-3 min-w-[6rem]">Estado</th>
                    <th className="admin-head-cell px-4 py-3 min-w-[10rem]">Youtube (URL)</th>
                    {/* Archivos R2 */}
                    <th className="admin-head-cell px-4 py-3 text-center min-w-[8rem]">MP3</th>
                    <th className="admin-head-cell px-4 py-3 text-center min-w-[8rem]">Acordes</th>
                    <th className="admin-head-cell px-4 py-3 text-center min-w-[8rem]">Letras</th>
                    <th className="admin-head-cell px-4 py-3 text-center min-w-[8rem]">Voces</th>
                    <th className="admin-head-cell px-4 py-3 text-center min-w-[8rem]">Secuencias</th>
                    <th className="admin-head-cell px-4 py-3 text-center min-w-[9rem]">Live Director</th>
                    <th className="admin-head-cell px-4 py-3 text-center min-w-[17rem]">ChordPro</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {canciones.map((cancion) => (
                    <tr key={cancion.id} className="group divide-x divide-border border-b border-border/80 hover:bg-background/40 transition-colors">
                      {/* Fijas */}
                      <td className="admin-row-primary align-top min-w-[14rem] max-w-[14rem] border-r border-border">
                        <div className="flex flex-col justify-center gap-0.5 px-3 py-1">
                          <EditableCell
                            cancionId={cancion.id}
                            campoBd="titulo"
                            valorInicial={cancion.titulo}
                            onSave={guardarMetadata}
                            isSaving={savingCell[`${cancion.id}_titulo`]}
                            anchoClases="w-full"
                            customInputClasses="text-[13px] font-semibold text-gray-900 dark:text-gray-100 bg-transparent border-none p-0 m-0 leading-none focus:ring-0 w-full h-auto shadow-none truncate"
                          />
                          <div className="w-full">
                            <EditableCell
                              cancionId={cancion.id}
                              campoBd="cantante"
                              valorInicial={cancion.cantante}
                              onSave={guardarMetadata}
                              isSaving={savingCell[`${cancion.id}_cantante`]}
                              anchoClases="w-full"
                              customInputClasses="text-[11px] text-gray-500 dark:text-gray-400 bg-transparent border-none p-0 m-0 leading-none focus:ring-0 w-full h-auto shadow-none truncate"
                            />
                          </div>
                        </div>
                      </td>

                      {/* Metadata */}
                      <td className="p-0 align-top">
                        <EditableCell cancionId={cancion.id} campoBd="tonalidad" valorInicial={cancion.tonalidad} onSave={guardarMetadata} isSaving={savingCell[`${cancion.id}_tonalidad`]} anchoClases="min-w-[6rem] max-w-[6rem]" />
                      </td>
                      <td className="p-0 align-top">
                        <EditableCell cancionId={cancion.id} campoBd="bpm" valorInicial={cancion.bpm} onSave={guardarMetadata} isSaving={savingCell[`${cancion.id}_bpm`]} anchoClases="min-w-[5rem] max-w-[5rem]" />
                      </td>
                      <td className="p-0 align-top">
                        <EditableCell cancionId={cancion.id} campoBd="metrica" valorInicial={getSongMeter(cancion)} onSave={guardarMetricaManual} isSaving={savingCell[`${cancion.id}_metrica`]} anchoClases="min-w-[5.5rem] max-w-[5.5rem]" />
                      </td>
                      <td className="p-0 align-top">
                        <EditableCell cancionId={cancion.id} campoBd="categoria" valorInicial={cancion.categoria} onSave={guardarMetadata} isSaving={savingCell[`${cancion.id}_categoria`]} anchoClases="min-w-[8rem] max-w-[8rem]" />
                      </td>
                      <td className="p-0 align-top">
                        <EditableCell cancionId={cancion.id} campoBd="voz" valorInicial={cancion.voz || cancion.voz_principal} onSave={guardarMetadata} isSaving={savingCell[`${cancion.id}_voz`]} anchoClases="min-w-[8rem] max-w-[8rem]" />
                      </td>
                      <td className="p-0 align-top">
                        <EditableCell cancionId={cancion.id} campoBd="tema" valorInicial={cancion.tema} onSave={guardarMetadata} isSaving={savingCell[`${cancion.id}_tema`]} anchoClases="min-w-[8rem] max-w-[8rem]" />
                      </td>
                      <td className="p-0 align-top">
                        <EditableCell cancionId={cancion.id} campoBd="estado" valorInicial={cancion.estado} onSave={guardarMetadata} isSaving={savingCell[`${cancion.id}_estado`]} anchoClases="min-w-[8rem] max-w-[8rem]" />
                      </td>
                      <td className="p-0 align-top">
                        <EditableCell cancionId={cancion.id} campoBd="link_youtube" valorInicial={cancion.link_youtube} onSave={guardarMetadata} isSaving={savingCell[`${cancion.id}_link_youtube`]} anchoClases="min-w-[10rem] max-w-[10rem]" />
                      </td>

                      {/* Archivos R2 */}
                      <td className="p-0.5 align-middle">{renderizarCeldaArchivo(cancion, 'mp3')}</td>
                      <td className="p-0.5 align-middle">{renderizarCeldaArchivo(cancion, 'link_acordes')}</td>
                      <td className="p-0.5 align-middle">{renderizarCeldaArchivo(cancion, 'link_letras')}</td>
                      <td className="p-0.5 align-middle">{renderizarCeldaArchivo(cancion, 'link_voces')}</td>
                      <td className="p-0.5 align-middle">{renderizarCeldaArchivo(cancion, 'link_secuencias')}</td>
                      <td className="p-0.5 align-middle">
                        <div className="flex h-full min-w-[9rem] items-center justify-center px-2 py-1.5">
                          <a
                            href={construirLiveDirectorUrl(cancion.id)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex min-h-[34px] items-center justify-center rounded-lg border border-brand/20 bg-brand/10 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-brand transition-colors hover:bg-brand/15"
                          >
                            Live Director
                          </a>
                        </div>
                      </td>
                      <td className="p-0.5 align-middle">{renderizarCeldaArchivo(cancion, 'chordpro')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {horizontalScrollUi.hasOverflow && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40">
                <div className="admin-horizontal-rail-shell pointer-events-auto flex items-center gap-1.5 border-t border-border/70 bg-background/92 px-2 py-1.5 pb-[calc(env(safe-area-inset-bottom)+0.35rem)]">
                  <button
                    type="button"
                    onClick={() => desplazarTablaHorizontalmente(-260)}
                    disabled={!canScrollHorizontalLeft}
                    className="admin-horizontal-rail-button"
                    aria-label="Mover tabla a la izquierda"
                    title="Ver columnas anteriores"
                  >
                    <ChevronLeft className="h-[0.95rem] w-[0.95rem]" strokeWidth={2.8} />
                  </button>

                  <div className="min-w-0 flex-1">
                    <div
                      ref={horizontalTrackRef}
                      role="presentation"
                      className="admin-horizontal-track"
                      onPointerDown={manejarClickEnTrackHorizontal}
                    >
                      <button
                        type="button"
                        data-admin-scroll-thumb="true"
                        onPointerDown={iniciarDragHorizontalThumb}
                        className={`admin-horizontal-thumb ${draggingHorizontalThumb ? 'is-dragging' : ''}`}
                        style={{
                          width: `${horizontalScrollUi.thumbWidth}px`,
                          transform: `translateX(${horizontalScrollUi.thumbOffset}px)`,
                        }}
                        aria-label="Barra de desplazamiento horizontal"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => desplazarTablaHorizontalmente(260)}
                    disabled={!canScrollHorizontalRight}
                    className="admin-horizontal-rail-button"
                    aria-label="Mover tabla a la derecha"
                    title="Ver columnas siguientes"
                  >
                    <ChevronRight className="h-[0.95rem] w-[0.95rem]" strokeWidth={2.8} />
                  </button>
                </div>
              </div>
            )}
            {canciones.length === 0 && !loading && (
              <div className="flex shrink-0 items-center justify-center px-6 py-10 text-center font-medium text-content-muted bg-surface">
                Aún no hay canciones creadas. Usa “Nueva” para comenzar.
              </div>
            )}
          </section>
        </div>
      )}

      {songWizardOpen && (
        <div
          className="fixed inset-x-0 z-[90] flex items-end justify-center bg-slate-950/72 backdrop-blur-md sm:items-center sm:p-4"
          style={{
            top: 'var(--app-modal-viewport-offset-top, 0px)',
            bottom: 'auto',
            height: 'var(--app-modal-viewport-height, 100dvh)',
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) cerrarSongWizard();
          }}
        >
          <div
            ref={songWizardDialogRef}
            className="flex w-full flex-col overflow-hidden rounded-t-[1.65rem] border border-border bg-surface shadow-2xl sm:max-w-3xl sm:rounded-[1.65rem]"
            style={{ maxHeight: 'min(52rem, calc(var(--app-modal-viewport-height, 100dvh) - 0.75rem))' }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-song-wizard-title"
          >
            <div className="shrink-0 border-b border-border bg-surface/95 px-4 pb-3 pt-4 backdrop-blur-xl sm:px-6 sm:pt-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-brand">
                    {songWizardMode === 'create' ? 'Nueva canción' : 'Editar canción'}
                  </p>
                  <h2
                    id="admin-song-wizard-title"
                    ref={songWizardHeadingRef}
                    tabIndex="-1"
                    className="mt-1 truncate text-xl font-black text-content outline-none sm:text-2xl"
                  >
                    {songWizardMode === 'create'
                      ? 'Añadir al repertorio'
                      : (songWizardDraft.titulo || 'Editar canción')}
                  </h2>
                  <p className="mt-1 text-sm text-content-muted">
                    Paso {songWizardStep + 1} de {SONG_WIZARD_STEPS.length} · {SONG_WIZARD_STEPS[songWizardStep].label}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={cerrarSongWizard}
                  disabled={songWizardSaving}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-content-muted transition-colors hover:bg-surface hover:text-content disabled:opacity-50"
                  aria-label="Cerrar asistente de canción"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <ol className="mt-4 grid grid-cols-4 gap-1.5" aria-label="Progreso de la canción">
                {SONG_WIZARD_STEPS.map((step, index) => {
                  const canOpenStep = songWizardMode === 'edit'
                    ? !(songWizardDirty && index === 3)
                    : index <= songWizardStep;
                  const isActive = index === songWizardStep;
                  const isComplete = index < songWizardStep || (songWizardMode === 'edit' && index < 3 && !songWizardDirty);
                  return (
                    <li key={step.label}>
                      <button
                        type="button"
                        onClick={() => {
                          if (!canOpenStep) return;
                          setSongWizardFeedback('');
                          setSongWizardStep(index);
                        }}
                        disabled={!canOpenStep || songWizardSaving}
                        aria-current={isActive ? 'step' : undefined}
                        className={`flex min-h-[3.35rem] w-full flex-col items-center justify-center rounded-xl border px-1.5 transition-colors ${isActive
                          ? 'border-brand bg-brand text-white shadow-sm'
                          : isComplete
                            ? 'border-brand/25 bg-brand/10 text-brand'
                            : 'border-border bg-background text-content-muted'} disabled:cursor-not-allowed disabled:opacity-55`}
                      >
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-current/10 text-[10px] font-black">
                          {isComplete && !isActive ? <Check className="h-3 w-3" /> : index + 1}
                        </span>
                        <span className="mt-0.5 text-[10px] font-bold sm:text-xs">{step.shortLabel}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="admin-song-wizard-body min-h-0 flex-1 overflow-y-auto bg-background/70 px-4 py-5 sm:px-6 sm:py-6">
              {songWizardStep === 0 && (
                <section aria-labelledby="wizard-step-song-title">
                  <div className="mb-5 flex items-start gap-3">
                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                      <FileAudio className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 id="wizard-step-song-title" className="text-lg font-black text-content">Identifica la canción</h3>
                      <p className="mt-0.5 text-sm text-content-muted">Nombre, cantante y audio principal.</p>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block sm:col-span-2">
                      <span className="text-xs font-black uppercase tracking-[0.14em] text-content-muted">Título *</span>
                      <input
                        type="text"
                        value={songWizardDraft.titulo}
                        onChange={(event) => actualizarSongWizardDraft('titulo', event.target.value)}
                        placeholder="Ej. Eres fiel"
                        required
                        autoFocus
                        className="mt-2 h-12 w-full rounded-xl border border-border bg-surface px-4 text-base font-semibold text-content outline-none placeholder:font-normal placeholder:text-content-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="text-xs font-black uppercase tracking-[0.14em] text-content-muted">
                        Cantante o banda {songWizardMode === 'create' ? '*' : ''}
                      </span>
                      <input
                        type="text"
                        value={songWizardDraft.cantante}
                        onChange={(event) => actualizarSongWizardDraft('cantante', event.target.value)}
                        placeholder="Ej. Miel San Marcos"
                        required={songWizardMode === 'create'}
                        className="mt-2 h-12 w-full rounded-xl border border-border bg-surface px-4 text-base text-content outline-none placeholder:text-content-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
                      />
                    </label>
                    <div className="sm:col-span-2">
                      <span className="text-xs font-black uppercase tracking-[0.14em] text-content-muted">
                        MP3 principal {songWizardMode === 'create' ? '*' : ''}
                      </span>
                      <div className={`mt-2 flex min-h-[4.5rem] items-center gap-3 rounded-xl border p-3 transition-colors ${songWizardHasMp3
                        ? 'border-emerald-500/25 bg-emerald-500/10'
                        : 'border-border bg-surface'}`}
                      >
                        <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${songWizardHasMp3
                          ? 'bg-emerald-500/15 text-emerald-500'
                          : 'bg-brand/10 text-brand'}`}
                        >
                          {songWizardHasMp3 ? <CheckCircle className="h-5 w-5" /> : <FileAudio className="h-5 w-5" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-content">
                            {songWizardMp3File?.name || (songWizardSong?.mp3 ? 'MP3 actual listo' : 'Selecciona el MP3')}
                          </p>
                          <p className="mt-0.5 text-xs text-content-muted">
                            {songWizardMp3File ? 'Se subirá al continuar.' : 'Audio principal de la canción.'}
                          </p>
                        </div>
                        <label className="inline-flex min-h-[42px] shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 text-sm font-bold text-content transition-colors hover:border-brand/30 hover:text-brand">
                          <UploadCloud className="h-4 w-4" />
                          <span className="hidden sm:inline">{songWizardHasMp3 ? 'Cambiar' : 'Elegir'}</span>
                          <input
                            type="file"
                            hidden
                            accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
                            onChange={(event) => {
                              const file = event.target.files?.[0] || null;
                              setSongWizardMp3File(file);
                              if (file) setSongWizardDirty(true);
                              setSongWizardFeedback('');
                              event.target.value = '';
                            }}
                          />
                        </label>
                        {songWizardMp3File && (
                          <button
                            type="button"
                            onClick={() => setSongWizardMp3File(null)}
                            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-content-muted transition-colors hover:text-danger"
                            aria-label="Quitar MP3 seleccionado"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {songWizardStep === 1 && (
                <section aria-labelledby="wizard-step-music-title">
                  <div className="mb-5 flex items-start gap-3">
                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-500">
                      <Mic2 className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 id="wizard-step-music-title" className="text-lg font-black text-content">Datos musicales</h3>
                      <p className="mt-0.5 text-sm text-content-muted">Lo necesario para preparar al equipo.</p>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-black uppercase tracking-[0.14em] text-content-muted">Tonalidad</span>
                      <input
                        type="text"
                        value={songWizardDraft.tonalidad}
                        onChange={(event) => actualizarSongWizardDraft('tonalidad', event.target.value)}
                        placeholder="Ej. G"
                        className="mt-2 h-12 w-full rounded-xl border border-border bg-surface px-4 text-base text-content outline-none placeholder:text-content-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-black uppercase tracking-[0.14em] text-content-muted">BPM</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="1"
                        max="300"
                        value={songWizardDraft.bpm}
                        onChange={(event) => actualizarSongWizardDraft('bpm', event.target.value)}
                        placeholder="Ej. 72"
                        className="mt-2 h-12 w-full rounded-xl border border-border bg-surface px-4 text-base text-content outline-none placeholder:text-content-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-black uppercase tracking-[0.14em] text-content-muted">Métrica</span>
                      <input
                        type="text"
                        value={songWizardDraft.metrica}
                        onChange={(event) => actualizarSongWizardDraft('metrica', event.target.value)}
                        placeholder="Ej. 4/4"
                        className="mt-2 h-12 w-full rounded-xl border border-border bg-surface px-4 text-base text-content outline-none placeholder:text-content-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-black uppercase tracking-[0.14em] text-content-muted">Voz</span>
                      <input
                        type="text"
                        list="admin-song-voice-options"
                        value={songWizardDraft.voz}
                        onChange={(event) => actualizarSongWizardDraft('voz', event.target.value)}
                        placeholder="Ej. Hombre"
                        className="mt-2 h-12 w-full rounded-xl border border-border bg-surface px-4 text-base text-content outline-none placeholder:text-content-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
                      />
                      <datalist id="admin-song-voice-options">
                        <option value="Hombre" />
                        <option value="Mujer" />
                        <option value="Mixta" />
                      </datalist>
                    </label>
                  </div>
                </section>
              )}

              {songWizardStep === 2 && (
                <section aria-labelledby="wizard-step-order-title">
                  <div className="mb-5 flex items-start gap-3">
                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-500">
                      <FolderOpen className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 id="wizard-step-order-title" className="text-lg font-black text-content">Organización</h3>
                      <p className="mt-0.5 text-sm text-content-muted">Clasifica y deja el enlace principal.</p>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-black uppercase tracking-[0.14em] text-content-muted">Categoría</span>
                      <input
                        type="text"
                        list="admin-song-category-options"
                        value={songWizardDraft.categoria}
                        onChange={(event) => actualizarSongWizardDraft('categoria', event.target.value)}
                        placeholder="Ej. Rápida"
                        className="mt-2 h-12 w-full rounded-xl border border-border bg-surface px-4 text-base text-content outline-none placeholder:text-content-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
                      />
                      <datalist id="admin-song-category-options">
                        <option value="Lenta" />
                        <option value="Rápida" />
                        <option value="Transición" />
                      </datalist>
                    </label>
                    <label className="block">
                      <span className="text-xs font-black uppercase tracking-[0.14em] text-content-muted">Tema</span>
                      <input
                        type="text"
                        value={songWizardDraft.tema}
                        onChange={(event) => actualizarSongWizardDraft('tema', event.target.value)}
                        placeholder="Ej. Gratitud"
                        className="mt-2 h-12 w-full rounded-xl border border-border bg-surface px-4 text-base text-content outline-none placeholder:text-content-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-black uppercase tracking-[0.14em] text-content-muted">Estado</span>
                      <select
                        value={songWizardDraft.estado}
                        onChange={(event) => actualizarSongWizardDraft('estado', event.target.value)}
                        className="mt-2 h-12 w-full rounded-xl border border-border bg-surface px-4 text-base text-content outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                      >
                        <option value="Activa">Activa</option>
                        <option value="Nueva">Nueva</option>
                        <option value="Archivada">Archivada</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-xs font-black uppercase tracking-[0.14em] text-content-muted">YouTube</span>
                      <input
                        type="text"
                        value={songWizardDraft.link_youtube}
                        onChange={(event) => actualizarSongWizardDraft('link_youtube', event.target.value)}
                        placeholder="Enlace o referencia"
                        className="mt-2 h-12 w-full rounded-xl border border-border bg-surface px-4 text-base text-content outline-none placeholder:text-content-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
                      />
                    </label>
                  </div>
                </section>
              )}

              {songWizardStep === 3 && (
                <section aria-labelledby="wizard-step-resources-title">
                  <div className="mb-5 flex items-start gap-3">
                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
                      <Sparkles className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 id="wizard-step-resources-title" className="text-lg font-black text-content">Adicionales</h3>
                      <p className="mt-0.5 text-sm text-content-muted">Completa solo lo que necesites.</p>
                    </div>
                  </div>

                  {songWizardSong ? (
                    <div className="space-y-6">
                      <div>
                        <p className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-content-muted">Material adicional</p>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {[
                            { field: 'link_acordes', label: 'Acordes', icon: FileText, accept: '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*' },
                            { field: 'link_letras', label: 'Letras', icon: FileText, accept: '.pdf,.doc,.docx,.txt,text/plain,application/pdf' },
                            { field: 'link_voces', label: 'Voces', icon: Mic2, type: 'voices' },
                            { field: 'link_secuencias', label: 'Secuencias', icon: FolderOpen, accept: '.zip,.wav,.mp3,.m4a,.aac,.ogg,.flac,audio/*,application/zip' },
                          ].map((resource) => (
                            <React.Fragment key={resource.field}>
                              {renderWizardResourceCard(songWizardSong, resource)}
                            </React.Fragment>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-content-muted">Guía y prueba</p>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {[
                            { field: 'chordpro', label: 'Guía musical', icon: Music2, type: 'chordpro', description: 'ChordPro · letra, acordes y secciones.' },
                            { label: 'Live Director', icon: ExternalLink, type: 'live', description: 'Prueba la canción en modo dirección.' },
                          ].map((resource) => (
                            <React.Fragment key={resource.field || resource.type}>
                              {renderWizardResourceCard(songWizardSong, resource)}
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex min-h-44 items-center justify-center rounded-2xl border border-dashed border-border bg-surface text-sm font-semibold text-content-muted">
                      Preparando la canción…
                    </div>
                  )}
                </section>
              )}

              {songWizardFeedback && (
                <p
                  className={`mt-5 rounded-xl border px-4 py-3 text-sm font-semibold ${/error|existe|encontró|escribe|selecciona|usa una métrica/i.test(songWizardFeedback)
                    ? 'border-danger/20 bg-danger/10 text-danger'
                    : 'border-brand/20 bg-brand/10 text-brand'}`}
                  role="status"
                  aria-live="polite"
                >
                  {songWizardFeedback}
                </p>
              )}
            </div>

            <div className="shrink-0 border-t border-border bg-surface/95 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur-xl sm:px-6 sm:pb-4">
              <div className="flex items-center gap-2 sm:justify-end">
                {songWizardStep > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSongWizardFeedback('');
                      setSongWizardStep((previous) => Math.max(0, previous - 1));
                    }}
                    disabled={songWizardSaving}
                    className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-bold text-content transition-colors hover:bg-surface disabled:opacity-50"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Atrás
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={cerrarSongWizard}
                    disabled={songWizardSaving}
                    className="inline-flex min-h-[46px] items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-bold text-content transition-colors hover:bg-surface disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                )}

                <button
                  type="button"
                  onClick={avanzarSongWizard}
                  disabled={songWizardSaving || (songWizardStep === 0 && !songWizardFirstStepReady)}
                  className="inline-flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-black text-white shadow-sm transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none sm:min-w-[11rem]"
                >
                  {songWizardSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : songWizardStep === 3 ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  {songWizardSaving
                    ? 'Guardando…'
                    : songWizardStep === 3
                      ? 'Finalizar'
                      : songWizardStep === 0
                        ? (songWizardMode === 'create' ? 'Crear y continuar' : 'Guardar y continuar')
                      : songWizardStep === 2
                        ? 'Guardar y continuar'
                        : 'Continuar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {vocesModalCancion && (
        <div
          className="fixed inset-0 z-[56] flex items-center justify-center overflow-y-auto bg-slate-950/65 p-3 backdrop-blur-sm md:p-5"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) cerrarModalVoces();
          }}
        >
          <div
            className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-voces-modal-title"
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-4 md:px-5">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-content-muted">Voces</p>
                <h2 id="admin-voces-modal-title" className="mt-1 truncate text-lg font-bold text-content">
                  {vocesModalCancion.titulo || 'Sin titulo'}
                </h2>
                <p className="truncate text-sm text-content-muted">
                  {vocesModalCancion.cantante || 'Gestionar recursos vocales'}
                </p>
              </div>
              <button
                type="button"
                onClick={cerrarModalVoces}
                disabled={guardandoVoces}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-content-muted transition-colors hover:bg-surface hover:text-content disabled:opacity-60"
                aria-label="Cerrar gestor de voces"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[min(72vh,42rem)] overflow-y-auto px-4 py-4 md:px-5">
              <audio ref={voicePreviewAudioRef} className="hidden" preload="none" />

              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex min-h-[38px] cursor-pointer items-center justify-center gap-2 rounded-lg border border-brand/25 bg-brand/10 px-3 py-2 text-sm font-semibold text-brand transition-colors hover:bg-brand/15">
                  <UploadCloud className="h-4 w-4" />
                  Añadir audios
                  <input
                    type="file"
                    hidden
                    multiple
                    accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.mp4,.mpeg,.mpga,.webm"
                    onChange={manejarSubidaVoces}
                  />
                </label>

                <button
                  type="button"
                  onClick={agregarDraftVozVacia}
                  className="inline-flex min-h-[38px] items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold text-content transition-colors hover:bg-surface"
                >
                  <Plus className="h-4 w-4" />
                  URL manual
                </button>

                {mostrarLinkViejoVoces ? (
                  <button
                    type="button"
                    onClick={quitarLinkViejoVoces}
                    className="inline-flex min-h-[38px] items-center justify-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-600 transition-colors hover:bg-amber-500/15"
                  >
                    <X className="h-4 w-4" />
                    Quitar link viejo
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={mostrarEditorLinkViejo}
                    className="inline-flex min-h-[38px] items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold text-content-muted transition-colors hover:bg-surface hover:text-content"
                  >
                    <Plus className="h-4 w-4" />
                    Link viejo
                  </button>
                )}

                {(vocesDraftEntries.length > 0 || vocesDraftLegacyUrl) && (
                  <button
                    type="button"
                    onClick={quitarTodasLasVoces}
                    className="inline-flex min-h-[38px] items-center justify-center gap-2 rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-sm font-semibold text-danger transition-colors hover:bg-danger/15"
                  >
                    <X className="h-4 w-4" />
                    Vaciar
                  </button>
                )}
              </div>

              {mostrarLinkViejoVoces && (
                <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-600">Link viejo</span>
                    {vocesDraftLegacyUrl ? (
                      <button
                        type="button"
                        onClick={() => alternarPreviewVoz({ id: 'legacy-voice-url', url: vocesDraftLegacyUrl })}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-amber-500/20 bg-surface text-amber-600 transition-colors hover:bg-background"
                        aria-label="Probar link viejo"
                        title="Probar link viejo"
                      >
                        {voicePreview.id === 'legacy-voice-url' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      </button>
                    ) : null}
                  </div>
                  <input
                    type="text"
                    value={vocesDraftLegacyUrl}
                    onChange={(event) => actualizarLinkViejoVoces(event.target.value)}
                    placeholder="https://drive.google.com/... o JSON de voces"
                    className="mt-2 h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-content outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  />
                </div>
              )}

              {vocesFeedback && (
                <p className="mt-3 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-content-muted" role="status" aria-live="polite">
                  {vocesFeedback}
                </p>
              )}

              <div className="mt-4 space-y-2">
                {vocesDraftEntriesOrdenadas.length > 0 ? vocesDraftEntriesOrdenadas.map((entry, index) => {
                  const displayName = entry.fileName || getVoiceDisplayNameFromUrl(entry.url) || (entry.source === 'manual' ? 'Pega una URL' : `Pista ${index + 1}`);
                  const isManual = entry.source === 'manual';
                  const previewUrl = getVoiceEntryPreviewUrl(entry);
                  const isPlayingPreview = voicePreview.id === entry.id;

                  return (
                    <div key={entry.id} className="grid gap-2 rounded-xl border border-border bg-background p-3 md:grid-cols-[minmax(9rem,0.45fr)_minmax(0,1fr)_auto] md:items-center">
                      <select
                        value={entry.label}
                        onChange={(event) => actualizarDraftVoz(entry.id, { label: event.target.value })}
                        className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-content outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                        aria-label={`Tipo de voz ${index + 1}`}
                      >
                        {VOICE_LABEL_OPTIONS.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>

                      <div className="min-w-0">
                        {isManual ? (
                          <input
                            type="url"
                            value={entry.url}
                            onChange={(event) => actualizarDraftVoz(entry.id, { url: event.target.value })}
                            placeholder="https://..."
                            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-content outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                          />
                        ) : (
                          <div className="flex h-10 min-w-0 items-center rounded-lg border border-border bg-surface px-3">
                            <span className="truncate text-sm font-medium text-content">{displayName}</span>
                            {entry.source === 'local' && (
                              <span className="ml-2 shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-brand">
                                Nuevo
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => alternarPreviewVoz(entry)}
                          disabled={!previewUrl}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface text-content-muted transition-colors hover:bg-background hover:text-content disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`${isPlayingPreview ? 'Pausar' : 'Probar'} ${entry.label}`}
                          title={isPlayingPreview ? 'Pausar' : 'Probar'}
                        >
                          {isPlayingPreview ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                        </button>

                        <label
                          className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-border bg-surface text-content-muted transition-colors hover:bg-background hover:text-content"
                          aria-label={`Reemplazar ${entry.label}`}
                          title="Reemplazar"
                        >
                          <UploadCloud className="h-4 w-4" />
                          <input
                            type="file"
                            hidden
                            accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.mp4,.mpeg,.mpga,.webm"
                            onChange={(event) => reemplazarDraftVoz(event, entry.id)}
                          />
                        </label>

                        <button
                          type="button"
                          onClick={() => quitarDraftVoz(entry.id)}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-danger/20 bg-danger/10 text-danger transition-colors hover:bg-danger/15"
                          aria-label={`Quitar ${entry.label}`}
                          title="Quitar"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                }) : (
                  <div className="rounded-xl border border-dashed border-border bg-background/70 px-4 py-5 text-center">
                    <p className="text-sm font-semibold text-content">Sin pistas nuevas.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-border bg-background/80 px-4 py-3 md:flex-row md:items-center md:justify-end md:px-5">
              <button
                type="button"
                onClick={cerrarModalVoces}
                disabled={guardandoVoces}
                className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-border bg-surface px-4 text-sm font-semibold text-content transition-colors hover:bg-background disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={guardarVocesDesdeModal}
                disabled={guardandoVoces || uploading[`${vocesModalCancion.id}_link_voces`]}
                className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand/90 disabled:opacity-60"
              >
                {guardandoVoces || uploading[`${vocesModalCancion.id}_link_voces`] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Guardar voces
              </button>
            </div>
          </div>
        </div>
      )}

      {editorChordproAbierto && (
        <div
          className="fixed inset-0 z-[60] flex items-start justify-center overflow-hidden bg-slate-950/70 p-2 pb-[calc(3.5rem+env(safe-area-inset-bottom))] backdrop-blur-sm md:p-3 md:pb-[calc(3.5rem+env(safe-area-inset-bottom))]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-chordpro-editor-title"
        >
          <div
            className="my-1 flex h-full w-full max-w-[min(94vw,96rem)] flex-col overflow-hidden rounded-[1.6rem] border border-border bg-surface shadow-2xl md:my-2"
            style={{ maxHeight: EDITOR_MODAL_MAX_HEIGHT }}
          >
            <div className="shrink-0 flex items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-5">
              <div className="min-w-0 flex flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
                <h2 id="admin-chordpro-editor-title" className="truncate text-lg font-bold text-content">
                  Editar ChordPro
                </h2>
                <p className="min-w-0 truncate text-sm font-medium text-content-muted">
                  {tituloEditorChordpro}
                </p>
                <button
                  type="button"
                  onClick={() => document.getElementById('admin-markers-panel')?.scrollTo({ top: 0, behavior: 'smooth' })}
                  className="inline-flex min-h-[28px] items-center rounded-full border border-brand/20 bg-brand/10 px-2.5 py-1 text-[10px] font-normal uppercase tracking-[0.12em] text-brand transition-colors hover:bg-brand/15"
                >
                  Markers · {totalMarkersEditor}
                </button>
                <span className="hidden min-h-[28px] items-center rounded-full border border-border bg-background px-2.5 py-1 text-[10px] font-normal uppercase tracking-[0.12em] text-content-muted xl:inline-flex">
                  Lineas · {resumenEditorChordpro.lineas}
                </span>
              </div>

              <button
                type="button"
                onClick={cerrarEditorChordpro}
                disabled={guardandoChordpro}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background text-content-muted transition-colors hover:bg-surface hover:text-content disabled:opacity-60"
                aria-label="Cerrar editor de ChordPro"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {(editorChordproAviso || !sectionMarkersDisponibles) && (
              <div className="shrink-0 space-y-2 border-b border-border bg-surface px-4 py-2.5 md:px-5">
                {editorChordproAviso && (
                  <p className="rounded-xl border border-info/20 bg-info/10 px-3 py-2 text-[11px] font-medium text-info dark:text-info">
                    {editorChordproAviso}
                  </p>
                )}
                {!sectionMarkersDisponibles && (
                  <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] font-medium text-amber-500">
                    La base actual todavia no expone <code>section_markers</code>. Puedes preparar los tiempos aqui, pero debes aplicar la migracion nueva para que se guarden en Supabase.
                  </p>
                )}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-hidden p-3 md:p-4">
              <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(16rem,1fr)_minmax(16rem,1fr)] gap-3 md:gap-4 lg:grid-cols-[minmax(0,1.24fr)_minmax(24rem,1.1fr)] xl:grid-cols-[minmax(0,1.18fr)_minmax(26rem,1.16fr)] lg:grid-rows-1">
                {editorChordproCargando ? (
                  <div className="flex min-h-0 h-full overflow-hidden rounded-xl border border-border bg-background">
                    <div className="flex h-full w-full items-center justify-center px-4">
                      <div className="flex items-center gap-3 text-sm font-medium text-content-muted">
                        <Loader2 className="h-5 w-5 animate-spin text-brand" />
                        Cargando contenido ChordPro...
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="relative flex min-h-0 h-full flex-col overflow-hidden rounded-xl border border-border bg-background">
                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-surface/80 px-2.5 py-2">
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-content-muted">
                          Letra y estructura
                        </p>
                        <p className="mt-0.5 flex min-w-0 items-center gap-2 truncate text-xs font-medium text-content">
                          {editorAuthoringSection?.name && (
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={getSectionDotStyle(editorAuthoringSection.name)}
                              aria-hidden="true"
                            />
                          )}
                          {editorAuthoringSection?.name
                            ? `Trabajando en ${editorAuthoringSection.name}`
                            : 'Añade la primera sección'}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleEditorAuthoringPanel('sections')}
                          aria-expanded={editorAuthoringPanel === 'sections'}
                          aria-controls="admin-chordpro-authoring-panel"
                          className={`inline-flex min-h-[34px] items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
                            editorAuthoringPanel === 'sections'
                              ? 'border-brand/40 bg-brand text-white'
                              : 'border-border bg-background text-content hover:border-brand/30 hover:text-brand'
                          }`}
                        >
                          <ListPlus className="h-4 w-4" />
                          Sección
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleEditorAuthoringPanel('guides')}
                          aria-expanded={editorAuthoringPanel === 'guides'}
                          aria-controls="admin-chordpro-authoring-panel"
                          className={`inline-flex min-h-[34px] items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
                            editorAuthoringPanel === 'guides'
                              ? 'border-brand/40 bg-brand text-white'
                              : 'border-border bg-background text-content hover:border-brand/30 hover:text-brand'
                          }`}
                        >
                          <MessageSquarePlus className="h-4 w-4" />
                          Guía
                        </button>
                      </div>
                    </div>

                    {seccionesEditorChordpro.length > 0 && (
                      <div className="admin-chip-scroll flex shrink-0 gap-1.5 overflow-x-auto border-b border-border bg-background/70 px-2.5 py-2">
                        {seccionesEditorChordpro.map((section, sectionIndex) => {
                          const isActive = editorAuthoringSectionIndex === sectionIndex;
                          return (
                            <button
                              key={`structure-map-${section.name}-${sectionIndex}`}
                              type="button"
                              onClick={() => seleccionarEditorAuthoringSection(sectionIndex)}
                              aria-pressed={isActive}
                              className="inline-flex min-h-[32px] shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-normal transition-transform hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                              style={getSectionColorStyle(section.name, isActive)}
                            >
                              <span
                                className="h-1.5 w-1.5 rounded-full"
                                style={getSectionDotStyle(section.name)}
                                aria-hidden="true"
                              />
                              {section.name}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {editorAuthoringPanel && (
                      <div
                        id="admin-chordpro-authoring-panel"
                        className="absolute inset-x-2 top-[3.85rem] z-20 max-h-[calc(100%-4.35rem)] overflow-y-auto rounded-2xl bg-surface p-3 shadow-2xl ring-1 ring-black/5 dark:ring-white/10"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-bold text-content">
                              {editorAuthoringPanel === 'sections' ? 'Añadir sección' : 'Añadir guía musical'}
                            </p>
                            <p className="mt-0.5 text-[11px] leading-4 text-content-muted">
                              {editorAuthoringPanel === 'sections'
                                ? 'Se insertará después de la sección seleccionada.'
                                : 'La guía quedará visible dentro de la sección en modo ensayo.'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setEditorAuthoringPanel(null)}
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-content-muted transition-colors hover:text-content"
                            aria-label="Cerrar asistente de estructura"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>

                        {seccionesEditorChordpro.length > 0 && (
                          <div className="mt-3">
                            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-content-muted">
                              {editorAuthoringPanel === 'sections' ? 'Insertar después de' : 'Aplicar en'}
                            </p>
                            <div className="admin-chip-scroll flex gap-1.5 overflow-x-auto pb-1">
                              {seccionesEditorChordpro.map((section, sectionIndex) => {
                                const isActive = editorAuthoringSectionIndex === sectionIndex;
                                return (
                                  <button
                                    key={`authoring-section-${section.name}-${sectionIndex}`}
                                    type="button"
                                    onClick={() => seleccionarEditorAuthoringSection(sectionIndex)}
                                    aria-pressed={isActive}
                                    className="inline-flex min-h-[32px] shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-normal transition-transform hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                                    style={getSectionColorStyle(section.name, isActive)}
                                  >
                                    <span
                                      className="h-1.5 w-1.5 rounded-full"
                                      style={getSectionDotStyle(section.name)}
                                      aria-hidden="true"
                                    />
                                    {section.name}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {editorAuthoringPanel === 'sections' ? (
                          <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                            {CHORDPRO_SECTION_PRESETS.map((preset) => (
                              <button
                                key={preset.id}
                                type="button"
                                onClick={() => agregarEditorChordproSection(preset)}
                                className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl px-2.5 py-2 text-xs font-normal transition-transform hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                                style={getSectionColorStyle(preset.label)}
                              >
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={getSectionDotStyle(preset.label)}
                                  aria-hidden="true"
                                />
                                {preset.label}
                              </button>
                            ))}
                          </div>
                        ) : editorCanAnnotateSection ? (
                          <>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {CHORDPRO_GUIDE_PRESETS.map((guide) => {
                                const isActive = editorAuthoringGuides.some((item) => (
                                  item.localeCompare(guide, 'es', { sensitivity: 'base' }) === 0
                                ));
                                return (
                                  <button
                                    key={guide}
                                    type="button"
                                    onClick={() => aplicarEditorChordproGuide(guide, isActive)}
                                    aria-pressed={isActive}
                                    className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-normal transition-colors ${
                                      isActive
                                        ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-400'
                                        : 'border-border bg-background text-content hover:border-brand/30 hover:text-brand'
                                    }`}
                                  >
                                    {isActive && <Check className="h-3.5 w-3.5" />}
                                    {guide}
                                  </button>
                                );
                              })}
                            </div>

                            <div className="mt-3 flex gap-1.5">
                              <input
                                type="text"
                                value={editorCustomGuide}
                                onChange={(event) => setEditorCustomGuide(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    agregarEditorCustomGuide();
                                  }
                                }}
                                placeholder="Otra indicación..."
                                className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-xs text-content outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                                aria-label="Guía musical personalizada"
                              />
                              <button
                                type="button"
                                onClick={agregarEditorCustomGuide}
                                disabled={!editorCustomGuide.trim()}
                                className="inline-flex h-9 items-center justify-center rounded-lg bg-action px-3 text-xs font-bold text-white transition-colors hover:bg-action/90 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Añadir
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="mt-3 rounded-xl border border-dashed border-border bg-background px-3 py-4 text-center text-xs text-content-muted">
                            Añade o selecciona una sección antes de colocar una guía.
                          </div>
                        )}

                        {editorAuthoringFeedback && (
                          <p role="status" className="mt-2 text-[11px] font-semibold text-emerald-400">
                            {editorAuthoringFeedback}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="relative min-h-0 flex-1 overflow-hidden">
                      <ChordProEditorHighlight
                        ref={editorChordproHighlightRef}
                        value={editorChordproValor}
                      />
                      <textarea
                        ref={editorChordproTextareaRef}
                        value={editorChordproValor}
                        onChange={(e) => setEditorChordproValor(e.target.value)}
                        onScroll={sincronizarEditorChordproScroll}
                        placeholder="[Verso 1]\n[C]Texto con acordes..."
                        spellCheck={false}
                        aria-label="Contenido ChordPro de la canción"
                        className="editor-column-scroll editor-chordpro-surface absolute inset-0 z-10 h-full min-h-0 w-full resize-none overflow-y-scroll border-0 bg-transparent px-3 py-3 text-transparent font-mono outline-none selection:bg-brand/25 focus:border-transparent focus:ring-0"
                        style={{ caretColor: '#3b82f6' }}
                      />
                    </div>
                  </div>
                )}
                <section id="admin-markers-panel" className="flex min-h-0 h-full flex-col overflow-hidden rounded-xl border border-border bg-background/70 p-3">
                  <audio
                    id="admin-chordpro-audio"
                    src={editorChordproCancion?.mp3 || ''}
                    preload="metadata"
                    className="hidden"
                  />
                  <div className="sticky top-0 z-10 -mx-3 border-b border-border bg-background/95 px-3 pb-3 pt-0 backdrop-blur">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                      <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-content">Markers de ensayo</h3>
                      <span className="inline-flex min-h-[24px] items-center rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-normal uppercase tracking-[0.12em] text-content-muted">
                        {totalMarkersEditor} items
                      </span>
                    </div>

                    {editorSectionMarkers.length > 0 && (
                      <div className="admin-chip-scroll mt-2 flex gap-1.5 overflow-x-auto pb-1">
                        {editorSectionMarkers.map((marker, index) => (
                          <button
                            key={`jump-${marker.id || `${marker.sectionName}-${index}`}`}
                            type="button"
                            onClick={() => {
                              const element = document.getElementById(`marker-card-${index}`);
                              if (element) element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                            }}
                            className="inline-flex min-h-[30px] shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-normal transition-transform hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                            style={getSectionColorStyle(marker.sectionName)}
                          >
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={getSectionDotStyle(marker.sectionName)}
                              aria-hidden="true"
                            />
                            {marker.sectionName}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="mt-2 border-b border-border/50 px-2.5 pb-3 pt-1">
                      {editorChordproCancion?.mp3 ? (
                        <>
                          <div className="flex items-center gap-2.5">
                            <button
                              type="button"
                              onClick={toggleEditorAudioPlayback}
                              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-action text-white transition-colors hover:bg-action/90"
                              aria-label={editorAudioPlaying ? 'Pausar audio' : 'Reproducir audio'}
                            >
                              {editorAudioPlaying ? <Pause className="w-4 h-4" /> : <Play className="ml-0.5 w-4 h-4" />}
                            </button>

                            <div className="min-w-0 flex-1">
                              <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.12em] text-content-muted">
                                <span>{formatMarkerTime(editorAudioCurrentTime)}</span>
                                <span>{formatMarkerTime(editorAudioDuration)}</span>
                              </div>
                              <input
                                type="range"
                                min="0"
                                max={Math.max(editorAudioDuration, 1)}
                                step="0.01"
                                value={Math.min(editorAudioCurrentTime, Math.max(editorAudioDuration, 1))}
                                onChange={(e) => handleEditorAudioSeek(e.target.value)}
                                className="admin-marker-range w-full"
                                style={{ '--range-progress': `${editorAudioProgress}%` }}
                                aria-label="Posicion del audio de ensayo"
                              />
                            </div>
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-content-muted">
                          Esta cancion aun no tiene MP3 cargado. Puedes dejar los tiempos manualmente en formato <code>mm:ss</code>.
                        </p>
                      )}
                    </div>

                    {editorChordproCancion?.mp3 && editorSectionMarkers.length > 0 && (
                      <div className="mt-2 border-b border-border/50 px-2.5 pb-3 pt-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => autoDetectMarkers()}
                            disabled={isAutoDetecting}
                            className="inline-flex min-h-[34px] items-center justify-center gap-2 rounded-lg bg-action px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-white transition-colors hover:bg-action/90 disabled:cursor-wait disabled:bg-zinc-700 disabled:text-zinc-300"
                          >
                            {isAutoDetecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                            {isAutoDetecting ? 'Analizando audio...' : 'Auto-detectar tiempos'}
                          </button>
                          <button
                            type="button"
                            onClick={() => autoDetectMarkers({ deepAnalysis: true })}
                            disabled={isAutoDetecting}
                            className="inline-flex min-h-[34px] items-center justify-center gap-2 rounded-lg border border-brand/25 bg-brand/10 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-brand transition-colors hover:bg-brand/15 disabled:cursor-wait disabled:border-border disabled:bg-background disabled:text-content-muted"
                          >
                            <Sparkles className="h-4 w-4" />
                            Profundo
                          </button>

                          {autoDetectError ? (
                            <span role="alert" className="text-xs font-medium text-red-400">{autoDetectError}</span>
                          ) : autoDetectResult ? (
                            <div role="status" className="flex flex-wrap items-center gap-1.5">
                              <span className={`rounded-full px-2 py-1 text-[10px] font-normal uppercase tracking-[0.12em] ${
                                autoDetectResult.quality?.level === 'high'
                                  ? 'bg-emerald-500/15 text-emerald-300'
                                  : autoDetectResult.quality?.level === 'medium'
                                    ? 'bg-yellow-500/15 text-yellow-300'
                                    : 'bg-red-500/15 text-red-300'
                              }`}>
                                {autoDetectResult.quality?.label || 'Confianza media'}
                              </span>
                              <span className="text-xs font-medium text-emerald-400">
                                {autoDetectResult.fallback === 'uniform'
                                  ? `Distribucion uniforme aplicada (${autoDetectResult.language})`
                                  : `${autoDetectResult.guideMatched > 0 ? `${autoDetectResult.guideMatched} por guia` : `${autoDetectResult.matched} detectados`}${autoDetectResult.deepMatched > 0 ? `, ${autoDetectResult.deepMatched} profundos` : ''}${autoDetectResult.hybrid > 0 ? `, ${autoDetectResult.hybrid} hibridos` : ''}${autoDetectResult.interpolated > 0 ? `, ${autoDetectResult.interpolated} interpolados` : ''}${autoDetectResult.failed > 0 ? `, ${autoDetectResult.failed} sin match` : ''}${autoDetectResult.cueMarkersDetected > 0 ? `, ${autoDetectResult.cueMarkersDetected} cues` : ''}${Array.isArray(autoDetectResult.repeatSuggestions) && autoDetectResult.repeatSuggestions.length > 0 ? `, ${autoDetectResult.repeatSuggestions.length} repeticiones sugeridas` : ''}${autoDetectResult.deepAnalysis ? ', profundo' : ''}${autoDetectResult.audioSource?.label ? ` · ${autoDetectResult.audioSource.label}` : ''} (${autoDetectResult.language})`}
                              </span>
                            </div>
                          ) : null}
                        </div>
                        {Array.isArray(autoDetectResult?.repeatSuggestions) && autoDetectResult.repeatSuggestions.length > 0 && (
                          <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-2">
                            <p className="text-[11px] font-semibold text-amber-300">
                              Posibles repeticiones faltantes. Agregalas solo si coinciden con la estructura real.
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {autoDetectResult.repeatSuggestions.map((suggestion, suggestionIndex) => (
                                <button
                                  key={`${suggestion.suggestedName}-${suggestion.startSec}-${suggestionIndex}`}
                                  type="button"
                                  onClick={() => aplicarRepeatSuggestion(suggestion, suggestionIndex)}
                                  className="inline-flex min-h-[30px] items-center rounded-lg border border-amber-400/30 bg-background px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-amber-300 transition-colors hover:bg-amber-500/15"
                                >
                                  Agregar {suggestion.suggestedName} · {formatMarkerTime(suggestion.startSec)}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="editor-column-scroll mt-3 min-h-0 flex-1 space-y-2.5 overflow-y-scroll pr-1">
                    {editorSectionMarkers.length > 0 ? editorSectionMarkers.map((marker, index) => {
                      const cueDraft = cueDraftsEditor[index] || { cueCount: 1, sectionStartPreview: '', cueMarkerPreview: [] };
                      const cueTransitionCount = Math.max(0, cueDraft.cueCount - 1);
                      const capturedCueMarkers = normalizeCueMarkerTimes(marker?.cueMarkers, marker?.startSec)
                        .slice(0, cueTransitionCount);
                      const hasSectionStart = marker?.startSec != null && Number.isFinite(Number(marker.startSec));
                      const capturedCueCount = hasSectionStart ? 1 + capturedCueMarkers.length : 0;
                      const nextCueNumber = Math.min(cueDraft.cueCount, capturedCueCount + 1);
                      const allCuesCaptured = cueDraft.cueCount > 1 && capturedCueCount >= cueDraft.cueCount;
                      const hasMultipleCues = cueDraft.cueCount > 1;
                      const groupedCuePreviews = hasMultipleCues
                        ? [
                            {
                              label: 'Cue 1',
                              text: cueDraft.sectionStartPreview,
                              cueMarkerIndex: null,
                            },
                            ...cueDraft.cueMarkerPreview.map((preview, previewIndex) => ({
                              ...preview,
                              cueMarkerIndex: previewIndex,
                            })),
                          ]
                        : [];

                      return (
                        <div
                          id={`marker-card-${index}`}
                          key={marker.id || `${marker.sectionName}-${index}`}
                          className="border-b border-l-2 border-border/50 bg-surface/35 px-2.5 py-2.5 scroll-mt-36"
                          style={getSectionCardStyle(marker.sectionName)}
                        >
                          <div className={`grid grid-cols-2 items-center gap-1.5 ${
                            hasMultipleCues
                              ? 'sm:grid-cols-[minmax(6.75rem,0.9fr)_minmax(0,1fr)_auto_auto]'
                              : 'sm:grid-cols-[minmax(6.75rem,0.9fr)_6.3rem_minmax(0,1fr)_auto_auto]'
                          }`}>
                            <div className="min-w-0">
                              <p className="flex min-w-0 items-center gap-2 truncate text-sm font-medium text-content">
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full"
                                  style={getSectionDotStyle(marker.sectionName)}
                                  aria-hidden="true"
                                />
                                <span className="truncate">{marker.sectionName}</span>
                              </p>
                              {!hasMultipleCues && cueDraft.sectionStartPreview && (
                                <p className="mt-0.5 truncate pl-4 text-[10px] text-content-muted">
                                  {cueDraft.sectionStartPreview}
                                </p>
                              )}
                              {marker._autoDetected && (
                                <span className={`mt-1 inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-normal ${marker._method === 'guide-cue'
                                  ? 'bg-emerald-950/70 text-emerald-400'
                                  : marker._method === 'whisper-match' && marker._confidence > 0.7
                                    ? 'bg-emerald-950/70 text-emerald-400'
                                  : marker._method === 'whisper-match' && marker._confidence > 0.4
                                    ? 'bg-yellow-950/70 text-yellow-400'
                                    : marker._method === 'deep-text-structure'
                                      ? 'bg-violet-950/70 text-violet-300'
                                    : marker._method === 'hybrid-structure'
                                      ? 'bg-sky-950/70 text-sky-300'
                                      : marker._method === 'repeat-detected'
                                        ? 'bg-amber-950/70 text-amber-300'
                                      : marker._method === 'interpolated' || marker._method === 'uniform'
                                        ? 'bg-yellow-950/70 text-yellow-400'
                                        : 'bg-red-950/70 text-red-400'
                                  }`}>
                                  {marker._method === 'guide-cue'
                                    ? `Guia ${Math.round((marker._confidence || 0) * 100)}%`
                                    : marker._method === 'whisper-match'
                                      ? `IA ${Math.round((marker._confidence || 0) * 100)}%`
                                    : marker._method === 'deep-text-structure'
                                      ? 'Profundo'
                                    : marker._method === 'hybrid-structure'
                                      ? 'Hibrido'
                                      : marker._method === 'repeat-detected'
                                        ? 'Repeticion'
                                      : marker._method === 'interpolated'
                                        ? 'Interpolado'
                                        : marker._method === 'uniform'
                                          ? 'Uniforme'
                                          : 'Sin match'}
                                </span>
                              )}
                            </div>
                            {!hasMultipleCues && (
                              <MarkerTimeInput
                                value={marker.startSec}
                                onCommit={(nextValue) => {
                                  actualizarEditorSectionMarker(index, toManualMarkerPatch({
                                    startSec: nextValue,
                                    cueMarkers: normalizeCueMarkerTimes(marker?.cueMarkers, nextValue),
                                  }));
                                }}
                                placeholder=""
                              />
                            )}
                            <input
                              type="text"
                              value={marker.note || ''}
                              onChange={(e) => {
                                actualizarEditorSectionNote(index, e.target.value);
                              }}
                              placeholder="Nota de seccion"
                              className="col-span-2 h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-content outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 sm:col-span-1"
                            />
                            <button
                              type="button"
                              onClick={() => capturarSiguienteCueActual(index, cueDraft.cueCount)}
                              disabled={!editorChordproCancion?.mp3 || allCuesCaptured}
                              className="inline-flex h-9 w-full items-center justify-center rounded-lg border border-brand/25 bg-brand/10 px-2.5 text-[11px] font-medium text-brand transition-colors hover:bg-brand/15 disabled:cursor-not-allowed disabled:border-border disabled:bg-background disabled:text-content-muted sm:w-auto"
                            >
                              {allCuesCaptured
                                ? 'Cues listos'
                                : cueDraft.cueCount > 1
                                  ? `Marcar cue ${nextCueNumber}`
                                  : 'Marcar ahora'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                actualizarEditorSectionMarker(index, toManualMarkerPatch({ startSec: null, cueMarkers: [] }));
                              }}
                              className="inline-flex h-9 w-full items-center justify-center rounded-lg px-2.5 text-[11px] font-medium text-content-muted transition-colors hover:bg-surface hover:text-content sm:w-auto"
                            >
                              Limpiar
                            </button>
                          </div>

                          {hasMultipleCues && (
                            <div className="mt-2 border-t border-border/50 px-1 pt-2.5">
                              <div className="grid gap-1.5">
                                {groupedCuePreviews.map((preview) => {
                                  const isSectionStartCue = preview.cueMarkerIndex == null;
                                  const cueMarkerIndex = preview.cueMarkerIndex;

                                  return (
                                    <div
                                      key={`${marker.sectionKey || marker.id}-${preview.label}`}
                                      className="grid grid-cols-[minmax(0,1fr)_6.3rem] items-center gap-2"
                                    >
                                      <p className="min-w-0 truncate text-[13px] text-content-muted">
                                        <span className="font-medium text-content">{preview.label}</span>
                                        {preview.text ? ` · ${preview.text}` : ''}
                                      </p>
                                      <MarkerTimeInput
                                        value={isSectionStartCue
                                          ? marker.startSec
                                          : capturedCueMarkers[cueMarkerIndex] ?? null}
                                        onCommit={(nextValue) => {
                                          if (isSectionStartCue) {
                                            actualizarEditorSectionMarker(index, toManualMarkerPatch({
                                              startSec: nextValue,
                                              cueMarkers: normalizeCueMarkerTimes(marker?.cueMarkers, nextValue),
                                            }));
                                            return;
                                          }
                                          actualizarCueMarkerIndividual(index, cueMarkerIndex, nextValue);
                                        }}
                                        disabled={!isSectionStartCue && (
                                          !hasSectionStart || cueMarkerIndex > capturedCueMarkers.length
                                        )}
                                        ariaLabel={`Tiempo de ${preview.label} en ${marker.sectionName}`}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    }) : (
                      <div className="rounded-xl border border-dashed border-border bg-surface px-4 py-4 text-sm text-content-muted">
                        Aun no hay secciones parseadas. Agrega encabezados como <code>[Verso 1]</code> o <code>[Coro]</code> para preparar markers.
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </div>

            <div className="shrink-0 flex flex-col-reverse items-stretch justify-between gap-2 border-t border-border bg-background/70 px-4 py-3 sm:flex-row sm:items-center md:px-5">
              <button
                type="button"
                onClick={cerrarEditorChordpro}
                disabled={guardandoChordpro}
                className="inline-flex items-center justify-center rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-content transition-colors hover:bg-background disabled:opacity-60"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={guardarChordproDesdeEditor}
                disabled={guardandoChordpro}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-action px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-action/90 disabled:opacity-60"
              >
                {guardandoChordpro ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Guardar ChordPro
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .admin-mobile-song-list,
        .admin-song-wizard-body {
          overscroll-behavior: contain;
          scrollbar-gutter: stable;
          scrollbar-width: thin;
          scrollbar-color: rgba(13, 148, 136, 0.78) rgba(148, 163, 184, 0.12);
        }

        .admin-mobile-song-list::-webkit-scrollbar,
        .admin-song-wizard-body::-webkit-scrollbar {
          width: 8px;
        }

        .admin-mobile-song-list::-webkit-scrollbar-track,
        .admin-song-wizard-body::-webkit-scrollbar-track {
          background: rgba(148, 163, 184, 0.12);
        }

        .admin-mobile-song-list::-webkit-scrollbar-thumb,
        .admin-song-wizard-body::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: rgba(13, 148, 136, 0.78);
        }

        .admin-table-head {
          position: sticky;
          top: 0;
          z-index: 44;
        }

        .admin-table-head-row {
          position: sticky;
          top: 0;
          z-index: 44;
        }

        .admin-head-cell {
          position: sticky;
          top: 0;
          z-index: 45;
          background: color-mix(in srgb, rgb(var(--bg-background)) 94%, white 6%);
          background-clip: padding-box;
          box-shadow:
            inset 0 -1px 0 rgba(226, 232, 240, 0.92),
            0 10px 24px -20px rgba(15, 23, 42, 0.55);
          backdrop-filter: blur(14px);
        }

        .admin-head-cell-primary {
          position: sticky;
          top: 0;
          left: 0;
          z-index: 60;
          isolation: isolate;
          background: color-mix(in srgb, rgb(var(--bg-background)) 96%, white 4%);
          background-clip: padding-box;
          box-shadow:
            inset 0 -1px 0 rgba(226, 232, 240, 0.92),
            1px 0 0 rgba(226, 232, 240, 0.92),
            12px 0 24px -22px rgba(15, 23, 42, 0.5);
        }

        .admin-row-primary {
          position: sticky;
          left: 0;
          z-index: 35;
          isolation: isolate;
          background: color-mix(in srgb, rgb(var(--bg-surface)) 96%, white 4%);
          background-clip: padding-box;
          box-shadow:
            1px 0 0 rgba(226, 232, 240, 0.88),
            12px 0 24px -24px rgba(15, 23, 42, 0.34);
        }

        .group:hover .admin-row-primary {
          background: color-mix(in srgb, rgb(var(--bg-background)) 90%, white 10%);
        }

        html.dark .admin-head-cell {
          background: color-mix(in srgb, rgb(var(--bg-surface)) 94%, black 6%);
          box-shadow:
            inset 0 -1px 0 rgba(63, 63, 70, 0.95),
            0 10px 24px -20px rgba(0, 0, 0, 0.72);
        }

        html.dark .admin-head-cell-primary {
          background: color-mix(in srgb, rgb(var(--bg-surface)) 96%, black 4%);
          box-shadow:
            inset 0 -1px 0 rgba(63, 63, 70, 0.95),
            1px 0 0 rgba(63, 63, 70, 0.92),
            12px 0 24px -22px rgba(0, 0, 0, 0.55);
        }

        html.dark .admin-row-primary {
          background: color-mix(in srgb, rgb(var(--bg-surface)) 95%, black 5%);
          box-shadow:
            1px 0 0 rgba(63, 63, 70, 0.9),
            12px 0 24px -24px rgba(0, 0, 0, 0.42);
        }

        html.dark .group:hover .admin-row-primary {
          background: color-mix(in srgb, rgb(var(--bg-background)) 88%, black 12%);
        }

        .admin-table-scroll {
          position: relative;
          height: 100%;
          max-height: 100%;
          overscroll-behavior: contain;
          scrollbar-gutter: stable;
          scrollbar-width: auto;
          scrollbar-color: rgba(13, 148, 136, 0.96) rgba(148, 163, 184, 0.16);
        }

        .admin-table-scroll::-webkit-scrollbar {
          height: 0;
          width: 16px;
        }

        .admin-table-scroll::-webkit-scrollbar:horizontal {
          display: none !important;
          height: 0 !important;
          background: transparent;
        }

        .admin-table-scroll::-webkit-scrollbar-track {
          background: linear-gradient(180deg, rgba(148, 163, 184, 0.16) 0%, rgba(148, 163, 184, 0.09) 100%);
          border-radius: 999px;
        }

        .admin-table-scroll::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, rgba(13, 148, 136, 0.96) 0%, rgba(45, 212, 191, 0.98) 100%);
          border-radius: 999px;
          border: 2px solid rgba(255, 255, 255, 0.72);
          min-width: 52px;
          min-height: 56px;
        }

        .admin-table-scroll::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(180deg, rgba(15, 118, 110, 0.98) 0%, rgba(20, 184, 166, 1) 100%);
        }

        .admin-horizontal-rail-shell {
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.72),
            0 -6px 16px -18px rgba(15, 23, 42, 0.2);
        }

        .admin-horizontal-rail-button {
          display: inline-flex;
          height: 1.8rem;
          width: 1.8rem;
          flex-shrink: 0;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          border: 1px solid rgba(18, 184, 166, 0.18);
          background: linear-gradient(180deg, rgba(240, 253, 250, 0.86) 0%, rgba(204, 251, 241, 0.8) 100%);
          color: rgb(var(--color-action));
          box-shadow: 0 8px 16px -18px rgba(15, 23, 42, 0.34);
          transition: background-color 180ms ease, border-color 180ms ease, color 180ms ease, opacity 180ms ease;
        }

        .admin-horizontal-rail-button:hover:not(:disabled) {
          border-color: rgba(18, 184, 166, 0.45);
          background: linear-gradient(180deg, rgba(236, 254, 255, 1) 0%, rgba(153, 246, 228, 0.96) 100%);
          color: rgb(var(--color-action));
        }

        .admin-horizontal-rail-button:disabled {
          opacity: 0.42;
          cursor: not-allowed;
        }

        .admin-horizontal-track {
          position: relative;
          height: 12px;
          width: 100%;
          overflow: hidden;
          border-radius: 999px;
          background:
            linear-gradient(90deg, rgba(18, 184, 166, 0.18) 0%, rgba(18, 184, 166, 0.04) 12%, rgba(148, 163, 184, 0.22) 50%, rgba(18, 184, 166, 0.04) 88%, rgba(18, 184, 166, 0.18) 100%);
          box-shadow:
            inset 0 0 0 1px rgba(148, 163, 184, 0.24),
            inset 0 1px 3px rgba(15, 23, 42, 0.08);
          cursor: pointer;
        }

        .admin-horizontal-thumb {
          position: absolute;
          left: 0;
          top: 1px;
          height: 10px;
          min-width: 72px;
          border: 0;
          border-radius: 999px;
          background: linear-gradient(90deg, rgba(13, 148, 136, 1) 0%, rgba(45, 212, 191, 1) 100%);
          box-shadow:
            0 10px 18px -14px rgba(15, 23, 42, 0.64),
            0 0 0 1px rgba(255, 255, 255, 0.42);
          cursor: grab;
          transition: filter 140ms ease, box-shadow 140ms ease;
        }

        .admin-horizontal-thumb:hover {
          filter: brightness(1.04);
        }

        .admin-horizontal-thumb.is-dragging {
          cursor: grabbing;
          box-shadow:
            0 12px 22px -12px rgba(15, 23, 42, 0.7),
            0 0 0 1px rgba(255, 255, 255, 0.52);
        }

        html.dark .admin-horizontal-rail-shell {
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
        }

        html.dark .admin-horizontal-rail-button {
          border-color: rgba(63, 63, 70, 0.92);
          background: linear-gradient(180deg, rgba(24, 24, 27, 0.96) 0%, rgba(39, 39, 42, 0.98) 100%);
          color: rgba(94, 234, 212, 0.98);
        }

        html.dark .admin-horizontal-track {
          background:
            linear-gradient(90deg, rgba(20, 184, 166, 0.18) 0%, rgba(20, 184, 166, 0.06) 12%, rgba(63, 63, 70, 0.74) 48%, rgba(20, 184, 166, 0.06) 88%, rgba(20, 184, 166, 0.18) 100%);
          box-shadow:
            inset 0 0 0 1px rgba(63, 63, 70, 0.85),
            inset 0 1px 4px rgba(0, 0, 0, 0.35);
        }

        .editor-column-scroll {
          overscroll-behavior: contain;
          scrollbar-gutter: stable both-edges;
          scrollbar-width: auto;
          scrollbar-color: rgba(15, 23, 42, 0.68) rgba(15, 23, 42, 0.10);
        }

        .editor-column-scroll::-webkit-scrollbar {
          width: 16px;
        }

        .editor-column-scroll::-webkit-scrollbar-track {
          background: rgba(148, 163, 184, 0.18);
          border-radius: 999px;
        }

        .editor-column-scroll::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, rgba(31, 41, 55, 0.92) 0%, rgba(71, 85, 105, 0.92) 100%);
          border-radius: 999px;
          border: 2px solid rgba(255, 255, 255, 0.18);
          min-height: 48px;
        }

        .editor-column-scroll::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(180deg, rgba(15, 23, 42, 0.96) 0%, rgba(51, 65, 85, 0.96) 100%);
        }

        .editor-chordpro-highlight {
          scrollbar-color: transparent transparent;
        }

        .editor-chordpro-surface {
          --editor-chordpro-line-height: 24px;
          font-size: 13px;
          line-height: var(--editor-chordpro-line-height);
          letter-spacing: 0;
          white-space: pre-wrap;
          overflow-wrap: break-word;
          word-break: normal;
          tab-size: 4;
        }

        .editor-chordpro-section-pill {
          box-sizing: border-box;
          height: var(--editor-chordpro-line-height);
          min-height: var(--editor-chordpro-line-height);
          max-height: var(--editor-chordpro-line-height);
          line-height: 1;
          vertical-align: top;
        }

        .editor-chordpro-section-support {
          line-height: var(--editor-chordpro-line-height);
          vertical-align: top;
        }

        .editor-chordpro-highlight::-webkit-scrollbar-track,
        .editor-chordpro-highlight::-webkit-scrollbar-thumb {
          visibility: hidden;
        }

        .admin-marker-range {
          --range-progress: 0%;
          appearance: none;
          -webkit-appearance: none;
          height: 22px;
          cursor: pointer;
          background: transparent;
        }

        .admin-marker-range:focus {
          outline: none;
        }

        .admin-marker-range::-webkit-slider-runnable-track {
          height: 5px;
          border-radius: 999px;
          background: linear-gradient(
            90deg,
            rgba(24, 191, 175, 1) 0%,
            rgba(24, 191, 175, 1) var(--range-progress),
            rgba(148, 163, 184, 0.26) var(--range-progress),
            rgba(148, 163, 184, 0.26) 100%
          );
        }

        .admin-marker-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 4px;
          height: 22px;
          margin-top: -8.5px;
          border: none;
          border-radius: 999px;
          background: rgba(45, 212, 191, 1);
          box-shadow:
            0 0 0 2px rgba(9, 9, 11, 0.96),
            0 0 0 5px rgba(45, 212, 191, 0.16);
        }

        .admin-marker-range::-moz-range-track {
          height: 5px;
          border: none;
          border-radius: 999px;
          background: rgba(148, 163, 184, 0.26);
        }

        .admin-marker-range::-moz-range-progress {
          height: 5px;
          border-radius: 999px;
          background: rgba(24, 191, 175, 1);
        }

        .admin-marker-range::-moz-range-thumb {
          width: 4px;
          height: 22px;
          border: none;
          border-radius: 999px;
          background: rgba(45, 212, 191, 1);
          box-shadow:
            0 0 0 2px rgba(9, 9, 11, 0.96),
            0 0 0 5px rgba(45, 212, 191, 0.16);
        }
      `}</style>
    </div>
  );
}
