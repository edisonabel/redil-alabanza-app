import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { audioSessionService } from '../services/AudioSessionService';
import { CheckCircle, UploadCloud, Loader2, Plus, PencilLine, X, Save, Pause, Play, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { splitSectionIntoCues } from '../utils/splitSectionIntoCues';

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
const AUTO_MARKER_CORRECTION_STORAGE_KEY = 'redil:auto-marker-corrections:v1';
const AUTO_MARKER_CORRECTION_LIMIT = 120;

const normalizeSectionName = (rawValue = '') => {
  const cleaned = String(rawValue).trim();
  if (!cleaned) return 'Seccion';

  const normalized = cleaned.toLowerCase();
  if (normalized === 'soc' || normalized === 'start_of_chorus') return 'Coro';
  if (normalized === 'sov' || normalized === 'start_of_verse') return 'Verso';
  if (normalized === 'sob' || normalized === 'start_of_bridge') return 'Puente';
  if (normalized === 'soi' || normalized === 'start_of_intro') return 'Intro';
  if (normalized === 'interlude' || normalized === 'interludio' || normalized === 'instrumental' || normalized === 'instrumental 1' || normalized === 'instrumental 2' || normalized === 'solo instrumental' || normalized === 'start_of_interlude') return 'Interludio';
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

  if (CHORD_SYMBOL_RE.test(cleaned)) return false;

  const normalized = cleaned.toLowerCase();
  if ([
    'intro',
    'interlude',
    'interludio',
    'instrumental',
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

      if (['title', 'artist', 'subtitle', 'key', 'tempo', 'bpm', 'capo'].includes(directiveKey)) {
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

const formatMarkerTime = (value) => {
  const totalSeconds = Math.floor(Math.max(0, Number(value) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const parseMarkerTime = (rawValue) => {
  const value = String(rawValue || '').trim();
  if (!value) return null;

  if (/^\d+(\.\d+)?$/.test(value)) {
    return Math.max(0, Math.round(Number(value)));
  }

  const parts = value.split(':').map((part) => part.trim());
  if (parts.length === 2 && parts.every((part) => /^\d+$/.test(part))) {
    return Math.max(0, Number(parts[0]) * 60 + Number(parts[1]));
  }

  if (parts.length === 3 && parts.every((part) => /^\d+$/.test(part))) {
    return Math.max(0, Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]));
  }

  return null;
};

const normalizeCueMarkerTimes = (rawCueMarkers = [], sectionStartSec = null) => {
  const sectionFloor = Number.isFinite(Number(sectionStartSec)) ? Number(sectionStartSec) : null;
  const normalizedTimes = (Array.isArray(rawCueMarkers) ? rawCueMarkers : [])
    .map((marker) => {
      if (typeof marker === 'number') return marker;
      if (typeof marker?.startSec === 'number') return marker.startSec;
      if (typeof marker?.time === 'number') return marker.time;
      return Number(marker);
    })
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.max(0, Math.round(Number(value))))
    .filter((value) => (sectionFloor == null ? true : value > sectionFloor))
    .sort((left, right) => left - right);

  return [...new Set(normalizedTimes)];
};

const formatCueMarkersValue = (cueMarkers = []) =>
  normalizeCueMarkerTimes(cueMarkers).map((value) => formatMarkerTime(value)).join(', ');

const parseCueMarkersText = (rawValue = '', sectionStartSec = null) =>
  normalizeCueMarkerTimes(
    String(rawValue || '')
      .split(/[,;\n]+/)
      .map((item) => parseMarkerTime(item)),
    sectionStartSec,
  );

const normalizeSectionMarkers = (sections = [], rawMarkers = []) => {
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
    const startSec = Number(existingMarker?.startSec);
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
      startSec: Number.isFinite(startSec) ? Math.max(0, Math.round(startSec)) : null,
      note: String(existingMarker?.note || section?.note || '').trim(),
      cueMarkers: normalizeCueMarkerTimes(existingMarker?.cueMarkers, Number.isFinite(startSec) ? startSec : null),
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

const getFirstMeaningfulSectionLine = (section) => {
  const lines = Array.isArray(section?.lines) ? section.lines : [];
  const firstLyricLine = lines.find((line) => stripChordsFromLine(line).length > 0);
  if (firstLyricLine) return firstLyricLine;

  return lines.find((line) => String(line || '').trim()) || '';
};

const buildUniformAutoDetectedMarkers = (markers = [], totalDurationSec = 0) => {
  const markerCount = Array.isArray(markers) ? markers.length : 0;
  const safeDuration = Number(totalDurationSec);
  if (markerCount === 0 || !Number.isFinite(safeDuration) || safeDuration <= 0) {
    return Array.isArray(markers) ? markers : [];
  }

  const divisor = Math.max(markerCount, 1);
  return markers.map((marker, index) => ({
    ...marker,
    startSec: Math.max(0, Math.round((safeDuration * index) / divisor)),
    _autoDetected: true,
    _confidence: 0.25,
    _method: 'uniform',
  }));
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

const insertChordProSectionAfterIndex = (rawValue = '', afterSectionIndex = -1, sectionBlock = '') => {
  const normalizedValue = String(rawValue || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalizedValue.split('\n');
  let sectionIndex = -1;
  let insertAtLine = lines.length;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const sectionLineMatch = lines[lineIndex].trim().match(PURE_SECTION_HEADER_RE);
    if (!sectionLineMatch || !isLikelySectionHeader(sectionLineMatch[1])) continue;

    sectionIndex += 1;
    if (sectionIndex > afterSectionIndex) {
      insertAtLine = lineIndex;
      break;
    }
  }

  const before = lines.slice(0, insertAtLine).join('\n').trimEnd();
  const after = lines.slice(insertAtLine).join('\n').trimStart();

  return [before, sectionBlock.trim(), after]
    .filter(Boolean)
    .join('\n\n');
};

const normalizeAudioCandidateUrl = (value = '') => {
  const url = String(value || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return '';
  if (!/\.(mp3|wav|m4a|aac|ogg|flac|mp4|mpeg|mpga|webm)(\?.*)?$/i.test(url)) return '';
  return url;
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

const parseMultitrackSession = (rawValue) => {
  if (!rawValue) return null;
  if (typeof rawValue === 'object') return rawValue;
  if (typeof rawValue !== 'string') return null;
  try {
    return JSON.parse(rawValue);
  } catch {
    return null;
  }
};

const getAutoMarkerAudioCandidates = (song = {}) => {
  const candidates = [];
  const pushCandidate = ({ label, url, kind, priority }) => {
    const safeUrl = normalizeAudioCandidateUrl(url);
    if (!safeUrl || candidates.some((item) => item.url === safeUrl)) return;
    candidates.push({ label, url: safeUrl, kind, priority });
  };

  pushCandidate({ label: 'Voces', url: song?.link_voces || song?.voces, kind: 'voices', priority: 100 });

  const session = parseMultitrackSession(song?.multitrack_session);
  const tracks = Array.isArray(session?.tracks) ? session.tracks : [];
  tracks.forEach((track) => {
    const name = String(track?.name || track?.sourceFileName || '').toLowerCase();
    const url = track?.url || track?.optimizedUrl || track?.iosUrl || track?.nativeUrl;
    if (/(vocal|vocals|voz|voces|lead|coros|choir)/i.test(name)) {
      pushCandidate({ label: `Stem ${track.name || 'Voces'}`, url, kind: 'stem-voices', priority: 92 });
    } else if (/(guide|guia|guía|cues?)/i.test(name)) {
      pushCandidate({ label: `Stem ${track.name || 'Guia'}`, url, kind: 'stem-guide', priority: 76 });
    }
  });

  pushCandidate({ label: 'MP3 completo', url: song?.mp3, kind: 'mix', priority: 10 });
  return candidates.sort((left, right) => right.priority - left.priority);
};

const loadAutoMarkerCorrections = () => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(AUTO_MARKER_CORRECTION_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveAutoMarkerCorrection = (entry) => {
  if (typeof window === 'undefined') return;
  const corrections = loadAutoMarkerCorrections();
  corrections.unshift(entry);
  window.localStorage.setItem(
    AUTO_MARKER_CORRECTION_STORAGE_KEY,
    JSON.stringify(corrections.slice(0, AUTO_MARKER_CORRECTION_LIMIT)),
  );
};

const getAutoMarkerCorrectionSummary = (songId) => {
  const relevant = loadAutoMarkerCorrections()
    .filter((entry) => String(entry?.songId || '') === String(songId || ''))
    .slice(0, 20);

  if (relevant.length < 2) {
    return { sampleCount: relevant.length, averageDeltaSec: 0 };
  }

  const averageDeltaSec = relevant.reduce((sum, entry) => sum + (Number(entry?.deltaSec) || 0), 0) / relevant.length;
  return {
    sampleCount: relevant.length,
    averageDeltaSec: Math.max(-6, Math.min(6, averageDeltaSec)),
  };
};

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

const CueMarkersInput = ({ value = [], sectionStartSec = null, onCommit, placeholder = '' }) => {
  const [draft, setDraft] = useState(formatCueMarkersValue(value));

  useEffect(() => {
    setDraft(formatCueMarkersValue(value));
  }, [value]);

  const commit = () => {
    onCommit(parseCueMarkersText(draft, sectionStartSec));
  };

  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      placeholder={placeholder}
      className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-content outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
    />
  );
};

const MarkerTimeInput = ({ value = null, onCommit, placeholder = '00:00' }) => {
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
      inputMode="numeric"
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
      className="h-9 w-[4.75rem] rounded-lg border border-border bg-background px-2.5 text-sm text-content outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
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
  const [guardandoChordpro, setGuardandoChordpro] = useState(false);
  const [sectionMarkersDisponibles, setSectionMarkersDisponibles] = useState(true);
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
  const editorAudioDurationRef = useRef(0);
  const editorAudioFrameRef = useRef(null);
  const voicePreviewAudioRef = useRef(null);
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
  const cueDraftsEditor = useMemo(() => (
    seccionesEditorChordpro.map((section, index) => {
      const cues = splitSectionIntoCues('editor-draft', index, section, null, 1);
      return {
        cueCount: cues.length,
        cuePreview: cues
          .map((cue, cueIndex) => ({
            label: cueIndex === 0 ? 'Seccion' : `Cue ${cueIndex + 1}`,
            text: cue.rawLines.map(stripChordsFromLine).filter(Boolean).join(' / '),
          }))
          .filter((cue) => cue.text),
        cueMarkerPreview: cues
          .slice(1)
          .map((cue, cueIndex) => ({
            label: `Cue ${cueIndex + 2}`,
            text: cue.rawLines.map(stripChordsFromLine).filter(Boolean).join(' / '),
          }))
          .filter((cue) => cue.text),
      };
    })
  ), [seccionesEditorChordpro]);

  const cancionesPendientesChordpro = useMemo(() => (
    canciones.filter((cancion) => {
      const estado = String(cancion?.estado || '').trim().toLowerCase();
      const chordpro = String(cancion?.chordpro || '').trim();
      return estado !== 'archivada' && chordpro === '';
    })
  ), [canciones]);

  const vocesDraftEntriesOrdenadas = useMemo(() => sortVoiceEntries(vocesDraftEntries), [vocesDraftEntries]);

  const canScrollHorizontalLeft = horizontalScrollUi.scrollLeft > 2;
  const canScrollHorizontalRight =
    horizontalScrollUi.scrollLeft < (horizontalScrollUi.scrollWidth - horizontalScrollUi.clientWidth - 2);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    setHeaderActionsHost(document.getElementById('admin-header-actions'));
    setHeaderActionsReady(true);
  }, []);

  useEffect(() => {
    if (!editorChordproAbierto) return;
    setEditorSectionMarkers((prev) => normalizeSectionMarkers(seccionesEditorChordpro, prev));
  }, [editorChordproAbierto, seccionesEditorChordpro]);

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
  }, [canciones.length, loading]);

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
      editorAudioDurationRef.current = duration;
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
      const queryWithMarkers = await supabase
        .from('canciones')
        // eslint-disable-next-line max-len
        .select('id, titulo, cantante, tonalidad, bpm, categoria, voz, tema, estado, link_youtube, mp3, link_acordes, link_letras, voces, link_voces, link_secuencias, chordpro, section_markers, multitrack_session')
        .order('titulo', { ascending: true });

      let data = queryWithMarkers.data;
      let error = queryWithMarkers.error;

      if (error) {
        const fallbackQuery = await supabase
          .from('canciones')
          // eslint-disable-next-line max-len
          .select('id, titulo, cantante, tonalidad, bpm, categoria, voz, tema, estado, link_youtube, mp3, link_acordes, link_letras, voces, link_voces, link_secuencias, chordpro, multitrack_session')
          .order('titulo', { ascending: true });

        data = fallbackQuery.data;
        error = fallbackQuery.error;
        setSectionMarkersDisponibles(false);
      } else {
        setSectionMarkersDisponibles(true);
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

  const agregarCancion = async () => {
    try {
      setLoading(true);

      // Generate a unique title to avoid UNIQUE constraint violation
      const titulosExistentes = new Set(canciones.map(c => (c.titulo || '').toLowerCase()));
      let titulo = 'Nueva Cancion';
      let contador = 2;
      while (titulosExistentes.has(titulo.toLowerCase())) {
        titulo = `Nueva Cancion ${contador}`;
        contador++;
      }

      const nuevaCancion = {
        titulo,
        estado: 'Activa',
      };
      const { data, error } = await supabase
        .from('canciones')
        .insert([nuevaCancion])
        .select('id, titulo, cantante, tonalidad, bpm, categoria, voz, tema, estado, link_youtube, mp3, link_acordes, link_letras, voces, link_voces, link_secuencias, chordpro, section_markers, multitrack_session')
        .single();

      if (error) throw error;
      if (data) {
        setCanciones(prev => [data, ...prev]);
      }
    } catch (err) {
      console.error('Error al agregar:', err);
      const detalle = err?.message || err?.details || 'Error desconocido';
      alert(`Error al anadir la cancion:\n${detalle}`);
    } finally {
      setLoading(false);
    }
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
    } catch (err) {
      console.error('Error al guardar:', err);
      alert(`Error al guardar ${campoBd}`);
      // Revertir a DB value (reload) - opcional
    } finally {
      setSavingCell(prev => ({ ...prev, [keyContext]: false }));
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
        editorAudioDurationRef.current = 0;
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
    setEditorAudioCurrentTime(0);
    setEditorAudioDuration(0);
    setEditorAudioPlaying(false);
    editorAudioCurrentTimeRef.current = 0;
    editorAudioDurationRef.current = 0;
    setEditorChordproAviso(aviso);
    setEditorChordproCargando(false);
  };

  const cerrarEditorChordpro = () => {
    if (guardandoChordpro) return;
    setEditorChordproAbierto(false);
    setEditorChordproCancion(null);
    setEditorChordproValor('');
    setEditorSectionMarkers([]);
    setEditorChordproCargando(false);
    setEditorChordproAviso('');
    setIsAutoDetecting(false);
    setAutoDetectError(null);
    setAutoDetectResult(null);
    setEditorAudioCurrentTime(0);
    setEditorAudioDuration(0);
    setEditorAudioPlaying(false);
    editorAudioCurrentTimeRef.current = 0;
    editorAudioDurationRef.current = 0;
  };

  const guardarChordproDesdeEditor = async () => {
    if (!editorChordproCancion?.id) return;

    setGuardandoChordpro(true);

    try {
      const contenidoNormalizado = normalizarChordPro(editorChordproValor);
      const markersNormalizados = normalizeSectionMarkers(parseChordProSections(contenidoNormalizado), editorSectionMarkers);
      const updatePayload = { chordpro: contenidoNormalizado || null };

      if (sectionMarkersDisponibles) {
        updatePayload.section_markers = markersNormalizados;
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
            className={`cursor-pointer group inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-action transition-all shadow-sm whitespace-nowrap hover:bg-surface ${valorTexto ? 'border-brand/30 bg-brand/10 text-brand' : ''}`}
            title={valorTexto ? 'ChordPro cargado. Puedes reemplazarlo.' : undefined}
          >
            <UploadCloud className="w-4 h-4" />
            <span className="text-xs font-semibold text-content group-hover:text-action transition-colors">
              {valorTexto ? 'Reemplazar TXT' : 'Subir TXT'}
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
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-all shadow-sm ${valorTexto ? 'border-brand/30 bg-brand/10 text-brand hover:bg-brand/15' : 'border-border bg-surface text-content hover:bg-background'}`}
          >
            <PencilLine className="w-3.5 h-3.5" />
            {valorTexto ? 'Editar' : 'Pegar'}
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

  const capturarMarkerActual = (markerIndex) => {
    setEditorSectionMarkers((prev) => prev.map((item, itemIndex) => (
      itemIndex === markerIndex
        ? { ...item, ...toManualMarkerPatch({ startSec: Math.round(editorAudioCurrentTimeRef.current) }) }
        : item
    )));
  };

  const registrarCorreccionAutoMarker = (marker, patch) => {
    if (!marker?._autoDetected) return;
    if (!Object.prototype.hasOwnProperty.call(patch || {}, 'startSec')) return;

    const previousStartSec = Number(marker?.startSec);
    const correctedStartSec = Number(patch?.startSec);
    if (!Number.isFinite(previousStartSec) || !Number.isFinite(correctedStartSec)) return;
    if (Math.abs(previousStartSec - correctedStartSec) < 1) return;

    saveAutoMarkerCorrection({
      songId: editorChordproCancion?.id || '',
      songTitle: editorChordproCancion?.titulo || '',
      sectionName: marker?.sectionName || '',
      method: marker?._method || '',
      previousStartSec,
      correctedStartSec,
      deltaSec: correctedStartSec - previousStartSec,
      createdAt: new Date().toISOString(),
    });
  };

  const actualizarEditorSectionMarker = (markerIndex, patch) => {
    setEditorSectionMarkers((prev) => prev.map((item, itemIndex) => (
      itemIndex === markerIndex ? (registrarCorreccionAutoMarker(item, patch), { ...item, ...patch }) : item
    )));
  };

  const capturarCueMarkerActual = (markerIndex) => {
    setEditorSectionMarkers((prev) => prev.map((item, itemIndex) => {
      if (itemIndex !== markerIndex) return item;

      return {
        ...item,
        ...toManualMarkerPatch({
          cueMarkers: normalizeCueMarkerTimes(
            [...(Array.isArray(item?.cueMarkers) ? item.cueMarkers : []), Math.round(editorAudioCurrentTimeRef.current)],
            item?.startSec ?? null,
          ),
        }),
      };
    }));
  };

  const limpiarCueMarkers = (markerIndex) => {
    setEditorSectionMarkers((prev) => prev.map((item, itemIndex) => (
      itemIndex === markerIndex
        ? { ...item, ...toManualMarkerPatch({ cueMarkers: [] }) }
        : item
    )));
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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mp3Url: editorChordproCancion.mp3,
          deepAnalysis,
          audioCandidates: getAutoMarkerAudioCandidates(editorChordproCancion),
          correctionSummary: getAutoMarkerCorrectionSummary(editorChordproCancion?.id),
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

      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.error) {
        setAutoDetectError(result?.error || 'No se pudieron detectar markers automaticamente.');
        return;
      }

      if (result?.fallback === 'uniform') {
        const fallbackDuration = Number(result?.durationSec) > 0
          ? Number(result.durationSec)
          : editorAudioDurationRef.current;

        if (!(fallbackDuration > 0)) {
          setAutoDetectError('La IA no detecto palabras y no se pudo estimar la duracion para repartir secciones.');
          return;
        }

        setEditorSectionMarkers((prev) => buildUniformAutoDetectedMarkers(
          normalizeSectionMarkers(currentSections, prev),
          fallbackDuration,
        ));
        setAutoDetectResult({
          total: currentSections.length,
          matched: 0,
          deepMatched: 0,
          interpolated: currentSections.length,
          failed: 0,
          cueMarkersDetected: 0,
          language: String(result?.language || 'es').toUpperCase(),
          fallback: 'uniform',
          repeatSuggestions: [],
          quality: result?.quality || null,
          audioSource: result?.audioSource || null,
          deepAnalysis: Boolean(result?.deepAnalysis),
        });
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
      startSec: Number.isFinite(suggestedStartSec) ? Math.round(suggestedStartSec) : null,
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

  const editorAudioProgress = editorAudioDuration > 0
    ? Math.min(100, Math.max(0, (editorAudioCurrentTime / editorAudioDuration) * 100))
    : 0;
  const tituloEditorChordpro = editorChordproCancion?.titulo || 'Sin titulo';
  const totalMarkersEditor = editorSectionMarkers.length || resumenEditorChordpro.secciones;

  const headerActions = (
    <>
      <button
        onClick={agregarCancion}
        disabled={loading}
        className="inline-flex min-h-[34px] items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand/90 disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Nueva
      </button>

      <span className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold md:text-xs ${cancionesPendientesChordpro.length > 0
        ? 'border-amber-500/25 bg-amber-500/10 text-amber-600'
        : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600'
        }`}>
        <span className="inline-flex min-w-[1.65rem] items-center justify-center rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-black">
          {cancionesPendientesChordpro.length}
        </span>
        <span>Sin ChordPro</span>
      </span>

      {!sectionMarkersDisponibles && (
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

      <div className="hidden mb-6 flex-col sm:flex-row sm:items-center justify-between gap-4 px-4 max-w-7xl mx-auto w-full">
        <div>
          <p className="text-content-muted leading-relaxed max-w-2xl text-sm">
            Gestor tipo Excel. Edita los metadatos directamente en las celdas y sube los archivos de forma instantanea.
          </p>
        </div>
        <button
          onClick={agregarCancion}
          disabled={loading}
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

      {loading && canciones.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 py-16">
          <Loader2 className="w-10 h-10 text-brand animate-spin" />
          <span className="text-content-muted font-medium tracking-wide">Cargando base de datos...</span>
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
                Aun no hay canciones creadas. Haz clic en "Anadir Cancion" para comenzar.
              </div>
            )}
          </section>
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
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-hidden bg-slate-950/70 p-2 pb-[calc(3.5rem+env(safe-area-inset-bottom))] backdrop-blur-sm md:p-3 md:pb-[calc(3.5rem+env(safe-area-inset-bottom))]">
          <div
            className="my-1 flex h-full w-full max-w-[min(94vw,96rem)] flex-col overflow-hidden rounded-[1.6rem] border border-border bg-surface shadow-2xl md:my-2"
            style={{ maxHeight: EDITOR_MODAL_MAX_HEIGHT }}
          >
            <div className="shrink-0 flex items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-5">
              <div className="min-w-0 flex flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
                <h2 className="truncate text-lg font-bold text-content">
                  Editar ChordPro
                </h2>
                <p className="min-w-0 truncate text-sm font-medium text-content-muted">
                  {tituloEditorChordpro}
                </p>
                <button
                  type="button"
                  onClick={() => document.getElementById('admin-markers-panel')?.scrollTo({ top: 0, behavior: 'smooth' })}
                  className="inline-flex min-h-[28px] items-center rounded-full border border-brand/20 bg-brand/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-brand transition-colors hover:bg-brand/15"
                >
                  Markers · {totalMarkersEditor}
                </button>
                <span className="hidden min-h-[28px] items-center rounded-full border border-border bg-background px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-content-muted xl:inline-flex">
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
                  <div className="flex min-h-0 h-full overflow-hidden rounded-xl border border-border bg-background">
                    <textarea
                      value={editorChordproValor}
                      onChange={(e) => setEditorChordproValor(e.target.value)}
                      placeholder="[Verso 1]\n[C]Texto con acordes..."
                      spellCheck={false}
                      className="editor-column-scroll h-full min-h-0 w-full resize-none overflow-y-auto border-0 bg-transparent px-3 py-3 text-[13px] leading-6 text-content font-mono outline-none focus:border-transparent focus:ring-0"
                    />
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
                      <span className="inline-flex min-h-[24px] items-center rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-content-muted">
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
                            className="inline-flex min-h-[28px] shrink-0 items-center rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] font-semibold text-content-muted transition-colors hover:border-brand/30 hover:text-content"
                          >
                            {marker.sectionName}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="mt-2 rounded-xl border border-border bg-surface px-2.5 py-2">
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
                                step="0.1"
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
                      <div className="mt-2 rounded-xl border border-border bg-surface/80 px-2.5 py-2">
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
                            <span className="text-xs font-medium text-red-400">{autoDetectError}</span>
                          ) : autoDetectResult ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${
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
                                  : `${autoDetectResult.matched} detectados${autoDetectResult.deepMatched > 0 ? `, ${autoDetectResult.deepMatched} profundos` : ''}${autoDetectResult.hybrid > 0 ? `, ${autoDetectResult.hybrid} hibridos` : ''}${autoDetectResult.interpolated > 0 ? `, ${autoDetectResult.interpolated} interpolados` : ''}${autoDetectResult.failed > 0 ? `, ${autoDetectResult.failed} sin match` : ''}${autoDetectResult.cueMarkersDetected > 0 ? `, ${autoDetectResult.cueMarkersDetected} cues` : ''}${Array.isArray(autoDetectResult.repeatSuggestions) && autoDetectResult.repeatSuggestions.length > 0 ? `, ${autoDetectResult.repeatSuggestions.length} repeticiones sugeridas` : ''}${autoDetectResult.deepAnalysis ? ', profundo' : ''}${autoDetectResult.audioSource?.label ? ` · ${autoDetectResult.audioSource.label}` : ''} (${autoDetectResult.language})`}
                              </span>
                            </div>
                          ) : (
                            <span className="text-[11px] text-content-muted">
                              Usa Whisper para sugerir tiempos y revisa los markers amarillos o rojos antes de guardar.
                            </span>
                          )}
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
                      const cueDraft = cueDraftsEditor[index] || { cueCount: 1, cuePreview: [], cueMarkerPreview: [] };
                      const cueTransitionCount = Math.max(0, cueDraft.cueCount - 1);

                      return (
                        <div id={`marker-card-${index}`} key={marker.id || `${marker.sectionName}-${index}`} className="rounded-xl border border-border bg-surface px-2.5 py-2 scroll-mt-36">
                          <div className="grid grid-cols-[minmax(6.75rem,0.9fr)_4.75rem_minmax(0,1fr)_auto_auto] items-center gap-1.5">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-content">{marker.sectionName}</p>
                              {marker._autoDetected && (
                                <span className={`mt-1 inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${marker._method === 'whisper-match' && marker._confidence > 0.7
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
                                  {marker._method === 'whisper-match'
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
                            <MarkerTimeInput
                              value={marker.startSec}
                              onCommit={(nextValue) => {
                                actualizarEditorSectionMarker(index, toManualMarkerPatch({
                                  startSec: nextValue,
                                  cueMarkers: normalizeCueMarkerTimes(marker?.cueMarkers, nextValue),
                                }));
                              }}
                              placeholder="00:00"
                            />
                            <input
                              type="text"
                              value={marker.note || ''}
                              onChange={(e) => {
                                actualizarEditorSectionMarker(index, { note: e.target.value });
                              }}
                              placeholder="Nota de seccion"
                              className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-content outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                actualizarEditorSectionMarker(index, toManualMarkerPatch({ startSec: null, cueMarkers: [] }));
                              }}
                              className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-2.5 text-[11px] font-bold text-content-muted transition-colors hover:bg-background hover:text-content"
                            >
                              Limpiar
                            </button>
                            <button
                              type="button"
                              onClick={() => capturarMarkerActual(index)}
                              disabled={!editorChordproCancion?.mp3}
                              className="inline-flex h-9 items-center justify-center rounded-lg border border-brand/25 bg-brand/10 px-2.5 text-[11px] font-bold text-brand transition-colors hover:bg-brand/15 disabled:cursor-not-allowed disabled:border-border disabled:bg-background disabled:text-content-muted"
                            >
                              <span className="sm:hidden">Marcar</span>
                              <span className="hidden sm:inline">Marcar ahora</span>
                            </button>
                          </div>

                          {cueDraft.cueCount > 1 && (
                            <div className="mt-2 rounded-lg border border-border/80 bg-background/60 p-2.5">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-content-muted">
                                    Cue markers
                                  </p>
                                  <p className="text-[11px] text-content-muted">
                                    Esta seccion se divide en {cueDraft.cueCount} pantallas (cues). La pantalla 1 usa el tiempo de inicio; ingresa {cueTransitionCount === 1 ? 'el tiempo para la pantalla restante' : `los tiempos para las ${cueTransitionCount} pantallas restantes`}.
                                  </p>
                                </div>

                                <div className="flex flex-wrap items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => capturarCueMarkerActual(index)}
                                    disabled={!editorChordproCancion?.mp3 || marker.startSec == null}
                                    className="inline-flex h-8 items-center justify-center rounded-lg border border-brand/20 bg-brand/10 px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-brand transition-colors hover:bg-brand/15 disabled:cursor-not-allowed disabled:border-border disabled:bg-background disabled:text-content-muted"
                                  >
                                    Cue ahora
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => limpiarCueMarkers(index)}
                                    disabled={!Array.isArray(marker?.cueMarkers) || marker.cueMarkers.length === 0}
                                    className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-surface px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-content-muted transition-colors hover:bg-background hover:text-content disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    Limpiar cues
                                  </button>
                                </div>
                              </div>

                              <div className="mt-2 grid gap-2">
                                <CueMarkersInput
                                  value={marker.cueMarkers}
                                  sectionStartSec={marker.startSec}
                                  onCommit={(nextCueMarkers) => actualizarEditorSectionMarker(index, toManualMarkerPatch({ cueMarkers: nextCueMarkers }))}
                                  placeholder={cueTransitionCount > 1 ? 'Ej: 01:12, 01:18' : 'Ej: 01:12'}
                                />

                                {cueDraft.cueMarkerPreview.length > 0 && (
                                  <p className="text-[11px] text-content-muted">
                                    {cueDraft.cueMarkerPreview.map((preview, previewIndex) => (
                                      <span key={`${marker.sectionKey || marker.id}-cue-preview-${previewIndex}`}>
                                        {previewIndex > 0 ? ' | ' : ''}
                                        <span className="font-semibold text-content">{preview.label}</span>
                                        {`: ${preview.text}`}
                                      </span>
                                    ))}
                                  </p>
                                )}
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
