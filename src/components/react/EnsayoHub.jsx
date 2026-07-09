import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, ChevronDown, ChevronRight, ChevronUp, Clock3, ExternalLink, GripVertical, ListMusic, Loader2, Mic2, Play, Plus, Printer, RadioReceiver, X, Zap } from 'lucide-react';
import ModoEnsayoCompacto from './ModoEnsayoCompacto.jsx';
import EnsayoPersonalView from './EnsayoPersonalView.jsx';
import { supabase } from '../../lib/supabase';
import { metronomeService } from '../../services/MetronomeEngine';
import {
  loadRehearsalSongSettingsMap,
  sanitizeRehearsalSongSettings,
} from '../../utils/rehearsalUserSongSettings';
import { createChordProSetlistPdfBrowserToken } from '../../lib/chordproSetlistPdfBrowserStore';

const ModoEnsayoDirector = React.lazy(() => import('./ModoEnsayoDirector.jsx'));

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

const FLAT_TO_SHARP = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
const CHROMATIC_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SETLIST_CAPO_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7];
const SETLIST_TONE_OPTIONS = CHROMATIC_NOTES;
const VOICE_TRACK_ANCHORS_KEY = '__trackAnchors';
const CHORD_ROOT_PATTERN = /^([A-G][#b]?)(.*)$/;
const BASS_NOTE_PATTERN = /\/([A-G][#b]?)/g;

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

  return FLAT_TO_SHARP[rootMatch[1]] || rootMatch[1];
};

const shiftNote = (rawNote = '', semitones = 0) => {
  const normalized = FLAT_TO_SHARP[String(rawNote || '').trim()] || String(rawNote || '').trim();
  const currentIndex = CHROMATIC_NOTES.indexOf(normalized);
  if (currentIndex < 0) return rawNote;
  return CHROMATIC_NOTES[(currentIndex + semitones + 1200) % 12];
};

const transposeChordSymbol = (rawChord = '', semitones = 0) => {
  const source = String(rawChord || '');
  if (!source || semitones === 0) return source;

  const match = source.match(CHORD_ROOT_PATTERN);
  if (!match) return source;

  const nextRoot = shiftNote(match[1], semitones);
  const suffix = String(match[2] || '').replace(BASS_NOTE_PATTERN, (_, bassNote) => `/${shiftNote(bassNote, semitones)}`);
  return `${nextRoot}${suffix}`;
};

const transposeChordProText = (chordProText = '', semitones = 0) => {
  const source = String(chordProText || '');
  if (!source || semitones === 0) return source;

  return source.replace(/\[([^\]]+)\]/g, (fullMatch, chordGroup) => {
    const parts = String(chordGroup || '').split(/(\s+)/);
    const transposed = parts.map((part) => (
      /\s+/.test(part) ? part : transposeChordSymbol(part, semitones)
    )).join('');
    return `[${transposed}]`;
  });
};

const getToneDelta = (fromTone = '', toTone = '') => {
  const fromIndex = CHROMATIC_NOTES.indexOf(normalizeKeyToAmerican(fromTone));
  const toIndex = CHROMATIC_NOTES.indexOf(normalizeKeyToAmerican(toTone));
  if (fromIndex < 0 || toIndex < 0) return 0;
  return (toIndex - fromIndex + 12) % 12;
};

const buildSafePdfFileName = (value = 'setlist') => (
  String(value || 'setlist')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s.-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'setlist'
);

const isMobilePrintDevice = () => {
  if (typeof window === 'undefined') return false;
  const navigatorWithUserAgentData = window.navigator;

  return (
    Boolean(navigatorWithUserAgentData.userAgentData?.mobile) ||
    /Android|iPad|iPhone|iPod/i.test(window.navigator.userAgent) ||
    (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1)
  );
};

const buildSetlistBrowserPrintUrl = (payload, { autoPrint = true } = {}) => {
  const clientToken = createChordProSetlistPdfBrowserToken(payload);
  const renderUrl = new URL('/render/chordpro-print-setlist-pdf-v2', window.location.origin);
  renderUrl.searchParams.set('clientToken', clientToken);
  renderUrl.searchParams.set('fallback', '1');
  if (autoPrint) renderUrl.searchParams.set('autoprint', '1');
  return renderUrl.toString();
};

const formatDateLabel = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-CO', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};

const formatHourLabel = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatServiceDuration = (startValue, endValue) => {
  if (!startValue || !endValue) return '';
  const start = new Date(startValue);
  if (Number.isNaN(start.getTime())) return '';

  const [endHour, endMinute] = String(endValue).split(':').map((part) => Number(part || 0));
  if (!Number.isFinite(endHour) || !Number.isFinite(endMinute)) return '';

  const end = new Date(start);
  end.setHours(endHour, endMinute, 0, 0);

  if (end <= start) return '';

  const diffMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;

  if (hours <= 0) return `${minutes} min`;
  if (!minutes) return `${hours} h`;
  return `${hours} h ${String(minutes).padStart(2, '0')} min`;
};

const getSectionMarkerStartSec = (marker = {}) => {
  const value = Number(marker?.startSec ?? marker?.start_sec ?? marker?.time ?? marker?.seconds);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

const getSectionMarkerEndSec = (marker = {}) => {
  const value = Number(marker?.endSec ?? marker?.end_sec);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

const shiftSectionMarkersForVoiceTrack = (sectionMarkers = [], anchorStartSec = null) => {
  const safeMarkers = Array.isArray(sectionMarkers) ? sectionMarkers : [];
  const offset = Number(anchorStartSec);

  if (!Number.isFinite(offset) || offset <= 0) return safeMarkers;

  return safeMarkers
    .map((marker, index) => {
      const startSec = getSectionMarkerStartSec(marker);
      if (startSec == null || startSec < offset - 0.35) return null;

      const endSec = getSectionMarkerEndSec(marker);
      const shiftedStartSec = Math.max(0, startSec - offset);
      const shiftedEndSec = endSec != null && endSec > offset
        ? Math.max(shiftedStartSec, endSec - offset)
        : null;

      return {
        ...marker,
        id: marker?.id || `voice-section-${index}`,
        startSec: shiftedStartSec,
        time: shiftedStartSec,
        seconds: shiftedStartSec,
        endSec: shiftedEndSec,
      };
    })
    .filter(Boolean);
};

const dispatchProPlayerEvent = ({
  url,
  title,
  artist,
  subtitle = '',
  mediaKind = '',
  voiceName = '',
  voiceColor = '',
  autoPlay = true,
  chordpro = '',
  sectionMarkers = [],
  expand = false,
  startAtSec = null,
}) => {
  const cleanUrl = String(url || '').trim();
  if (!cleanUrl || typeof window === 'undefined') return;
  const safeSectionMarkers = Array.isArray(sectionMarkers) ? sectionMarkers : [];

  if (window.__REDIL_PRO_PLAYER__?.open) {
    window.__REDIL_PRO_PLAYER__.open({
      url: cleanUrl,
      title,
      artist,
      subtitle,
      mediaKind,
      voiceName,
      voiceColor,
      autoPlay,
      chordpro,
      sectionMarkers: safeSectionMarkers,
      expand,
      startAtSec,
    });
    return;
  }

  window.dispatchEvent(new CustomEvent('play-pro-audio', {
    detail: {
      url: cleanUrl,
      title,
      artist,
      subtitle,
      mediaKind,
      voiceName,
      voiceColor,
      autoPlay,
      chordpro,
      sectionMarkers: safeSectionMarkers,
      expand,
      startAtSec,
    },
  }));
};

const serializeVoicePayload = (value) => {
  if (typeof value === 'string') return value.trim();
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
};

const normalizeVoiceExternalUrl = (rawUrl = '') => {
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

      let fileId = '';
      for (const pattern of driveIdPatterns) {
        const match = fullUrl.match(pattern);
        if (match?.[1]) {
          fileId = match[1];
          break;
        }
      }

      if (fileId) {
        return `https://drive.google.com/uc?export=download&id=${fileId}`;
      }
    }

    return url.toString();
  } catch {
    return normalized;
  }
};

const VOICE_LABEL_ORDER = ['Voz guía', 'Tercera voz', 'Quinta voz', 'Todas las voces', 'Pista'];

const normalizeVoiceText = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

const normalizeVoiceTrackLabel = (value = '') => {
  const normalized = normalizeVoiceText(value);
  if (normalized.includes('guia') || normalized.includes('principal') || normalized.includes('lead')) return 'Voz guía';
  if (normalized.includes('tercera') || /\b3(?:ra|ro)?\b/.test(normalized)) return 'Tercera voz';
  if (normalized.includes('quinta') || /\b5(?:ta|to)?\b/.test(normalized)) return 'Quinta voz';
  if (normalized.includes('todas') || normalized.includes('tres voces') || normalized.includes('full')) return 'Todas las voces';
  if (normalized.includes('pista') || normalized.includes('instrumental') || normalized.includes('track')) return 'Pista';
  return 'Pista';
};

const sortVoiceEntries = (entries = []) => (
  (Array.isArray(entries) ? entries : [])
    .map((entry, index) => ({ entry: { ...entry, label: normalizeVoiceTrackLabel(entry?.label || entry?.name || '') }, index }))
    .sort((left, right) => {
      const leftOrder = VOICE_LABEL_ORDER.indexOf(left.entry.label);
      const rightOrder = VOICE_LABEL_ORDER.indexOf(right.entry.label);
      return (leftOrder === -1 ? 99 : leftOrder) - (rightOrder === -1 ? 99 : rightOrder) || left.index - right.index;
    })
    .map(({ entry }) => entry)
);

const mergeVoiceEntriesByUrl = (...entryGroups) => {
  const seenUrls = new Set();
  const mergedEntries = [];

  entryGroups.flat().forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const url = normalizeVoiceExternalUrl(entry.url || '');
    if (!url || seenUrls.has(url)) return;
    seenUrls.add(url);
    mergedEntries.push({ ...entry, url });
  });

  return sortVoiceEntries(mergedEntries);
};

const parseVoiceResources = (value) => {
  const raw = serializeVoicePayload(value);
  const rawNormalized = raw
    ? raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    : '';
  const audioFilePattern = /\.(mp3|wav|m4a|aac|ogg)(\?.*)?$/i;
  const toVoiceEntry = (candidate, index = 0, forcedLabel = '') => {
    if (typeof candidate === 'string') {
      const url = normalizeVoiceExternalUrl(candidate);
      if (!url) return null;
      return {
        label: normalizeVoiceTrackLabel(forcedLabel || `Voz ${index + 1}`),
        url,
      };
    }

    if (!candidate || typeof candidate !== 'object') return null;

    const url = normalizeVoiceExternalUrl(
      candidate.url ||
      candidate.link ||
      candidate.href ||
      candidate.src ||
      candidate.audio ||
      '',
    );

    if (!url) return null;

    const labelRaw =
      forcedLabel ||
      candidate.label ||
      candidate.nombre ||
      candidate.name ||
      candidate.title ||
      candidate.voice ||
      '';

    return {
      label: normalizeVoiceTrackLabel(String(labelRaw || `Voz ${index + 1}`).trim() || `Voz ${index + 1}`),
      url,
    };
  };

  if (!raw || raw === '-' || rawNormalized === 'no esta') {
    return { hasResources: false, entries: [], legacyUrl: '' };
  }

  const normalizedDirectUrl = normalizeVoiceExternalUrl(raw);
  if (normalizedDirectUrl && !raw.trim().startsWith('[') && !raw.trim().startsWith('{')) {
    if (audioFilePattern.test(normalizedDirectUrl)) {
      return {
        hasResources: true,
        entries: [{ label: 'Voz guía', url: normalizedDirectUrl }],
        legacyUrl: '',
      };
    }
    return { hasResources: true, entries: [], legacyUrl: normalizedDirectUrl };
  }

  if (raw.includes('\n')) {
    const entries = raw
      .split('\n')
      .map((line, index) => {
        const trimmed = String(line || '').trim();
        if (!trimmed) return null;
        const [labelPart, urlPart] = trimmed.includes('|') ? trimmed.split('|') : [`Voz ${index + 1}`, trimmed];
        return toVoiceEntry(
          String(urlPart || '').trim(),
          index,
          String(labelPart || `Voz ${index + 1}`).trim() || `Voz ${index + 1}`,
        );
      })
      .filter(Boolean);

    if (entries.length > 0) {
      return { hasResources: true, entries: sortVoiceEntries(entries), legacyUrl: '' };
    }
  }

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') {
      return parseVoiceResources(parsed);
    }
    if (Array.isArray(parsed)) {
      const entries = parsed
        .map((entry, index) => toVoiceEntry(entry, index, index === 0 ? 'Voz guía' : ''))
        .filter(Boolean);
      return { hasResources: entries.length > 0, entries: sortVoiceEntries(entries), legacyUrl: '' };
    }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.entries)) {
      const entries = parsed.entries
        .map((entry, index) => toVoiceEntry(entry, index, index === 0 ? 'Voz guía' : ''))
        .filter(Boolean);
      const nestedLegacy = parseVoiceResources(parsed.legacyUrl || parsed.folder || parsed.drive || '');
      const legacyUrl =
        nestedLegacy.legacyUrl ||
        normalizeVoiceExternalUrl(String(parsed.legacyUrl || parsed.folder || parsed.drive || '').trim());
      const mergedEntries = mergeVoiceEntriesByUrl(entries, nestedLegacy.entries || []);
      return { hasResources: mergedEntries.length > 0 || Boolean(legacyUrl), entries: mergedEntries, legacyUrl };
    }
    if (parsed && typeof parsed === 'object') {
      const nestedLegacy = parseVoiceResources(parsed.legacyUrl || parsed.folder || parsed.drive || '');
      const directEntry = toVoiceEntry(
        parsed,
        0,
        parsed.label || parsed.nombre || parsed.name || parsed.title || 'Voz guía',
      );
      if (directEntry) {
        const entries = mergeVoiceEntriesByUrl([directEntry], nestedLegacy.entries || []);
        return {
          hasResources: entries.length > 0 || Boolean(nestedLegacy.legacyUrl),
          entries,
          legacyUrl: nestedLegacy.legacyUrl || '',
        };
      }

      const entries = Object.entries(parsed)
        .map(([key, candidate], index) => (
          ['legacyUrl', 'folder', 'drive'].includes(key)
            ? null
            : toVoiceEntry(candidate, index, String(key || `Voz ${index + 1}`))
        ))
        .filter(Boolean);
      const mergedEntries = mergeVoiceEntriesByUrl(entries, nestedLegacy.entries || []);
      if (mergedEntries.length > 0 || nestedLegacy.legacyUrl) {
        return { hasResources: true, entries: mergedEntries, legacyUrl: nestedLegacy.legacyUrl || '' };
      }
    }
  } catch {
    const fallbackLegacyUrl = normalizeVoiceExternalUrl(raw);
    return {
      hasResources: Boolean(fallbackLegacyUrl),
      entries: [],
      legacyUrl: fallbackLegacyUrl,
    };
  }

  return { hasResources: false, entries: [], legacyUrl: '' };
};

const normalizeVoiceLabel = (rawVoice = '') => {
  const source = String(rawVoice || '').trim();
  if (!source) return '';

  const normalized = source
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const hasHombre = normalized.includes('hombre');
  const hasMujer = normalized.includes('mujer');

  if (hasHombre && hasMujer) return 'Hombre y Mujer';
  if (hasMujer) return 'Mujer';
  if (hasHombre) return 'Hombre';

  return source;
};

const formatCompactMetaLabel = (value = '') => {
  const source = String(value || '').trim();
  if (!source) return '';
  const lower = source.toLocaleLowerCase('es-CO');
  return lower.charAt(0).toLocaleUpperCase('es-CO') + lower.slice(1);
};

const hasValidVoicePayload = (value) => {
  const raw = serializeVoicePayload(value);
  const normalized = raw
    ? raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    : '';

  return Boolean(raw && raw !== '-' && normalized !== 'no esta');
};

const openVoicesModal = ({ title, artist, entries = [], legacyUrl = '' }) => {
  if (typeof window === 'undefined') return;

  if (window.__REDIL_VOCES_MODAL__?.open) {
    window.__REDIL_VOCES_MODAL__.open(title || 'Recursos de voz', artist || '', entries, legacyUrl || '');
    return;
  }

  window.dispatchEvent(new CustomEvent('open-voces-modal', {
    detail: {
      title,
      artist,
      entries,
      legacyUrl,
    },
  }));
};

const sanitizeSongVoiceAssignments = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);

const sanitizeVoiceTrackAnchors = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);

const mergeRepertoireVoiceTrackAnchors = (assignments, songs = []) => {
  const nextAssignments = { ...sanitizeSongVoiceAssignments(assignments) };

  (Array.isArray(songs) ? songs : []).forEach((song) => {
    const safeSongId = String(song?.id || '').trim();
    if (!safeSongId) return;

    const repertoireAnchors = sanitizeVoiceTrackAnchors(song?.voiceTrackAnchors);
    if (Object.keys(repertoireAnchors).length === 0) return;

    const songAssignments = sanitizeSongVoiceAssignments(nextAssignments[safeSongId]);
    const playlistAnchors = sanitizeVoiceTrackAnchors(songAssignments[VOICE_TRACK_ANCHORS_KEY]);

    nextAssignments[safeSongId] = {
      ...songAssignments,
      [VOICE_TRACK_ANCHORS_KEY]: {
        ...playlistAnchors,
        ...repertoireAnchors,
      },
    };
  });

  return nextAssignments;
};

const getVoiceAssignmentErrorMessage = (error, fallbackMessage) => {
  if (error?.code === 'PGRST205' || error?.code === 'PGRST204' || error?.code === '42703') {
    return 'Falta aplicar la migracion de asignaciones vocales en Supabase.';
  }

  return fallbackMessage;
};

const getSongArtworkUrl = (song = {}) => {
  const directArtwork =
    song.artworkUrl ||
    song.portada ||
    song.imagen ||
    song.image ||
    song.cover ||
    song.thumbnail ||
    song.artwork ||
    song.album_art ||
    song.albumArt ||
    song.caratula ||
    song.foto ||
    '';

  if (directArtwork) return directArtwork;
  if (!song.mp3) return '';

  return `/api/mp3-cover-art?v=2&src=${encodeURIComponent(song.mp3)}`;
};

function SongArtworkThumb({ song, index }) {
  const [failed, setFailed] = useState(false);
  const artworkUrl = getSongArtworkUrl(song);

  return (
    <div className="relative h-[clamp(84px,23vw,99px)] w-[clamp(84px,23vw,99px)] shrink-0 overflow-hidden rounded-[18px] border border-zinc-200 bg-zinc-100 shadow-sm dark:border-white/10 dark:bg-zinc-900 sm:h-[107px] sm:w-[107px] md:h-[131px] md:w-[131px] lg:h-[147px] lg:w-[147px]">
      {artworkUrl && !failed ? (
        <img
          src={artworkUrl}
          alt=""
          crossOrigin="anonymous"
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.20),transparent_38%),linear-gradient(135deg,rgba(248,250,252,0.96),rgba(226,232,240,0.74))] text-zinc-400 dark:bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.30),transparent_38%),linear-gradient(135deg,rgba(255,255,255,0.10),rgba(255,255,255,0.02))] dark:text-white/52">
          <ListMusic className="h-5 w-5" aria-hidden="true" />
        </div>
      )}
      <span className="absolute bottom-1 left-1 inline-flex h-5 min-w-5 items-center justify-center rounded-[7px] border border-white/40 bg-zinc-950/72 px-1 text-[10px] font-black leading-none text-white shadow-lg backdrop-blur dark:border-white/12">
        {index + 1}
      </span>
    </div>
  );
}

export default function EnsayoHub({
  playlist = [],
  contextTitle = 'Modo Ensayo',
  eventMeta = null,
  initialSongId = null,
  monitorUrl = '',
  playlistId = null,
  canEdit = false,
  canAssignVoices = false,
  userId = '',
  rosterMembers = [],
  initialSongVoiceAssignments = {},
}) {
  const [localPlaylist, setLocalPlaylist] = useState(() =>
    Array.isArray(playlist) ? playlist.filter(Boolean) : []
  );
  const [isEditMode, setIsEditMode] = useState(false);
  const [showPrayerModal, setShowPrayerModal] = useState(false);
  const [prayerText, setPrayerText] = useState('');
  const [prayerTitle, setPrayerTitle] = useState('Oración de Confesión');

  const songs = localPlaylist;

  const initialSong = useMemo(() => (
    initialSongId
      ? songs.find((song) => String(song?.id || '') === String(initialSongId)) || null
      : null
  ), [initialSongId, songs]);

  const [cancionActiva, setCancionActiva] = useState(initialSong);
  const [cancionPersonalActiva, setCancionPersonalActiva] = useState(null);
  const [lastViewedSongId, setLastViewedSongId] = useState(initialSong ? String(initialSong.id || '') : null);
  const [activeMetronomeSongId, setActiveMetronomeSongId] = useState(null);
  const [queueState, setQueueState] = useState({ active: false, index: -1 });
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [isSyncReceiver, setIsSyncReceiver] = useState(false);
  const [syncCountdown, setSyncCountdown] = useState(null); // null | 3 | 2 | 1 | 0
  const [songVoiceAssignments, setSongVoiceAssignments] = useState(() => (
    mergeRepertoireVoiceTrackAnchors(initialSongVoiceAssignments, playlist)
  ));
  const [isSavingVoiceAssignments, setIsSavingVoiceAssignments] = useState(false);
  const [voiceAssignmentFeedback, setVoiceAssignmentFeedback] = useState(null);
  const [showSetlistPrintModal, setShowSetlistPrintModal] = useState(false);
  const [setlistCapos, setSetlistCapos] = useState({});
  const [setlistTones, setSetlistTones] = useState({});
  const [setlistPicker, setSetlistPicker] = useState(null);
  const [setlistRenderMode, setSetlistRenderMode] = useState('chords-lyrics');
  const [personalSongSettings, setPersonalSongSettings] = useState({});
  const [isGeneratingSetlistPdf, setIsGeneratingSetlistPdf] = useState(false);
  const [setlistPrintError, setSetlistPrintError] = useState('');

  const queueSongsRef = useRef([]);
  const queueIndexRef = useRef(-1);
  const queueActiveRef = useRef(false);
  const voiceAssignmentFeedbackTimeoutRef = useRef(null);
  const setlistPdfObjectUrlsRef = useRef([]);
  const songActionScrollerRefs = useRef(new Map());
  const [overflowingSongActionIds, setOverflowingSongActionIds] = useState(() => new Set());
  const [insertAfterIndex, setInsertAfterIndex] = useState(-1);

  const playableSongs = useMemo(() => (
    songs.filter((song) => typeof song?.mp3 === 'string' && song.mp3.trim() !== '')
  ), [songs]);
  const printableSongs = useMemo(() => (
    songs.filter((song) => !song?.isPrayer && typeof song?.chordpro === 'string' && song.chordpro.trim() !== '')
  ), [songs]);
  const voiceMemberOptions = useMemo(() => (
    (Array.isArray(rosterMembers) ? rosterMembers : [])
      .filter((member) => member?.id)
      .map((member) => ({
        id: String(member.id),
        name: String(member.name || member.nombre || member.email || 'Integrante').trim() || 'Integrante',
        roleLabel: String(member.roleLabel || '').trim(),
        roleCodes: Array.isArray(member.roleCodes)
          ? member.roleCodes.map((code) => String(code || '').trim()).filter(Boolean)
          : [],
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
  ), [rosterMembers]);
  const viewerVoiceMemberId = useMemo(() => {
    const safeUserId = String(userId || '').trim();
    return voiceMemberOptions.some((member) => String(member?.id || '') === safeUserId) ? safeUserId : '';
  }, [userId, voiceMemberOptions]);

  useEffect(() => {
    setSongVoiceAssignments(mergeRepertoireVoiceTrackAnchors(initialSongVoiceAssignments, playlist));
  }, [initialSongVoiceAssignments, playlist]);

  useEffect(() => {
    return () => {
      if (voiceAssignmentFeedbackTimeoutRef.current) {
        window.clearTimeout(voiceAssignmentFeedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => () => {
    setlistPdfObjectUrlsRef.current.forEach((url) => {
      try {
        window.URL.revokeObjectURL(url);
      } catch {
        // Ignore stale browser object URLs.
      }
    });
    setlistPdfObjectUrlsRef.current = [];
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    let frame = 0;
    const updateOverflowState = () => {
      frame = 0;
      const nextOverflowingIds = new Set();

      songActionScrollerRefs.current.forEach((scroller, key) => {
        if (scroller && scroller.scrollWidth - scroller.clientWidth > 8) {
          nextOverflowingIds.add(key);
        }
      });

      setOverflowingSongActionIds((current) => {
        if (
          current.size === nextOverflowingIds.size &&
          [...current].every((key) => nextOverflowingIds.has(key))
        ) {
          return current;
        }

        return nextOverflowingIds;
      });
    };

    const scheduleOverflowUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateOverflowState);
    };

    scheduleOverflowUpdate();
    window.addEventListener('resize', scheduleOverflowUpdate, { passive: true });

    let resizeObserver = null;
    if (typeof window.ResizeObserver === 'function') {
      resizeObserver = new window.ResizeObserver(scheduleOverflowUpdate);
      songActionScrollerRefs.current.forEach((scroller) => {
        if (scroller) resizeObserver.observe(scroller);
      });
    }

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleOverflowUpdate);
      resizeObserver?.disconnect();
    };
  }, [songs, isEditMode, songVoiceAssignments, viewerVoiceMemberId]);

  const showVoiceAssignmentFeedback = useCallback((type, message) => {
    if (!message || typeof window === 'undefined') {
      setVoiceAssignmentFeedback(message ? { type, message } : null);
      return;
    }

    if (voiceAssignmentFeedbackTimeoutRef.current) {
      window.clearTimeout(voiceAssignmentFeedbackTimeoutRef.current);
    }

    setVoiceAssignmentFeedback({ type, message });
    voiceAssignmentFeedbackTimeoutRef.current = window.setTimeout(() => {
      setVoiceAssignmentFeedback(null);
      voiceAssignmentFeedbackTimeoutRef.current = null;
    }, 2400);
  }, []);

  // ── Reordenamiento de canciones ──
  const moveSong = useCallback(async (fromIndex, direction) => {
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= localPlaylist.length) return;
    const newList = [...localPlaylist];
    const [moved] = newList.splice(fromIndex, 1);
    newList.splice(toIndex, 0, moved);
    setLocalPlaylist(newList);
    if (playlistId) {
      for (let i = 0; i < newList.length; i++) {
        const s = newList[i];
        if (s?.isPrayer) continue; // no persistir oraciones (son locales)
        await supabase
          .from('playlist_canciones')
          .update({ orden: i })
          .eq('playlist_id', playlistId)
          .eq('cancion_id', s.id);
      }
    }
  }, [localPlaylist, playlistId]);

  // ── Insertar sección de oración ──
  const insertPrayerSection = useCallback((afterIndex) => {
    const prayerSong = {
      id: `prayer-${Date.now()}`,
      title: prayerTitle || 'Oración de Confesión',
      artist: '',
      key: '-',
      originalKey: '-',
      bpm: 0,
      category: 'Oración',
      mp3: '',
      linkVoces: '',
      linkSecuencias: '',
      sectionMarkers: [],
      duration: 0,
      sections: [],
      isPrayer: true,
      prayerText: prayerText || '',
    };
    const newList = [...localPlaylist];
    newList.splice(afterIndex + 1, 0, prayerSong);
    setLocalPlaylist(newList);
    setShowPrayerModal(false);
    setPrayerText('');
    setPrayerTitle('Oración de Confesión');
  }, [localPlaylist, prayerText, prayerTitle]);

  const removePrayerSection = useCallback((index) => {
    const newList = [...localPlaylist];
    if (newList[index]?.isPrayer) {
      newList.splice(index, 1);
      setLocalPlaylist(newList);
    }
  }, [localPlaylist]);

  // ── Receptor Global: Escucha al Director y navega automáticamente ──
  useEffect(() => {
    if (!isSyncReceiver || playableSongs.length === 0) return;

    const channel = supabase.channel('ensayo-live-sync', {
      config: { broadcast: { self: false } },
    });

    channel.on('broadcast', { event: 'SECTION_CHANGE' }, (payload) => {
      if (!payload.payload?.songId) return;
      const incomingSongId = String(payload.payload.songId);

      setCancionActiva(current => {
        if (current && String(current.id) === incomingSongId) return current;
        const nextSong = playableSongs.find(s => String(s.id) === incomingSongId);
        if (nextSong) {
          console.log('📡 [Global Sync] Cambiando a:', nextSong.title);
          return nextSong;
        }
        return current;
      });
    }).subscribe();

    return () => { channel.unsubscribe(); supabase.removeChannel(channel); };
  }, [isSyncReceiver, playableSongs]);

  // ── Cuenta regresiva de conexión ──
  useEffect(() => {
    if (syncCountdown === null) return;

    if (syncCountdown > 0) {
      const timer = setTimeout(() => setSyncCountdown(syncCountdown - 1), 1000);
      return () => clearTimeout(timer);
    } else if (syncCountdown === 0) {
      setIsSyncReceiver(true);
      const timer = setTimeout(() => setSyncCountdown(null), 800);
      return () => clearTimeout(timer);
    }
  }, [syncCountdown]);

  const stopMetronome = useCallback(() => {
    metronomeService.stop();
    setActiveMetronomeSongId(null);
  }, []);

  const toggleSongMetronome = useCallback(async (songId, bpm) => {
    const safeBpm = Number.isFinite(Number(bpm)) ? Math.max(0, Math.round(Number(bpm))) : 0;
    if (!safeBpm) return;

    if (activeMetronomeSongId === songId) {
      stopMetronome();
      return;
    }

    stopMetronome();
    await metronomeService.start({
      tempo: safeBpm,
      beatsPerMeasure: 1,
      subdivision: 1,
      accentFirstBeat: false,
      resetCycle: true,
    });
    setActiveMetronomeSongId(songId);
  }, [activeMetronomeSongId, stopMetronome]);

  const stopQueue = useCallback(() => {
    queueSongsRef.current = [];
    queueIndexRef.current = -1;
    queueActiveRef.current = false;
    setQueueState({ active: false, index: -1 });
  }, []);

  const openSongInPlayer = useCallback((song, autoPlay = true) => {
    if (!song?.mp3) return;
    const safeUrl = song.mp3.replace(/ /g, '%20');
    dispatchProPlayerEvent({
      url: safeUrl,
      title: song.title,
      artist: song.artist,
      autoPlay,
      chordpro: song.chordpro || '',
      sectionMarkers: song.sectionMarkers || [],
    });
  }, []);

  const openSongVoices = useCallback((song) => {
    if (typeof window === 'undefined') return;
    console.log('[EnsayoHub] 🎤 Iniciando openSongVoices para:', song?.title);

    const rawVoicePayload = serializeVoicePayload(song?.linkVoces);
    const parsed = parseVoiceResources(rawVoicePayload);
    console.log('[EnsayoHub] ⚙️ Payload procesado:', parsed);

    const fallbackLegacyUrl =
      parsed.legacyUrl ||
      normalizeVoiceExternalUrl(rawVoicePayload) ||
      normalizeVoiceExternalUrl(song?.linkVoces?.legacyUrl || song?.linkVoces?.folder || song?.linkVoces?.drive || '');

    if (!parsed.hasResources && !fallbackLegacyUrl) {
      console.warn('[EnsayoHub] ⚠️ No se encontraron recursos de voz válidos.');
      return;
    }

    stopMetronome();
    stopQueue();
    window.__REDIL_PRO_PLAYER__?.close?.();

    console.log('[EnsayoHub] 🚀 Disparando evento/modal de voces...');
    openVoicesModal({
      title: song?.title || 'Recursos de voz',
      artist: song?.artist || '',
      entries: parsed.entries || [],
      legacyUrl: fallbackLegacyUrl || '',
    });
  }, [stopMetronome, stopQueue]);

  const openPersonalVoiceView = useCallback((song) => {
    if (!song) return;

    stopMetronome();
    stopQueue();
    window.__REDIL_PRO_PLAYER__?.close?.();
    setCancionActiva(null);
    setCancionPersonalActiva(song);
    setLastViewedSongId(String(song?.id || ''));
  }, [stopMetronome, stopQueue]);

  const handlePersonalVoiceTrackPlay = useCallback((song, track) => {
    const safeUrl = normalizeVoiceExternalUrl(track?.url || track?.href || '');
    if (!safeUrl) return;

    const safeSongId = String(song?.id || '').trim();
    const safeTrackName = normalizeVoiceTrackLabel(track?.label || track?.name || track?.track_name || track?.title || '');
    const songTitle = String(song?.title || 'Recursos de voz').trim() || 'Recursos de voz';
    const displayVoiceName = String(track?.__displayTitle || safeTrackName || 'Voz seleccionada').trim();
    const trackAnchors = songVoiceAssignments?.[safeSongId]?.[VOICE_TRACK_ANCHORS_KEY] || {};
    const trackAnchor = trackAnchors?.[safeTrackName] || null;
    const anchorStartSec = Number(trackAnchor?.startSec);
    const sectionMarkers = shiftSectionMarkersForVoiceTrack(
      song?.sectionMarkers || [],
      Number.isFinite(anchorStartSec) ? anchorStartSec : null
    );

    dispatchProPlayerEvent({
      url: safeUrl,
      title: `${songTitle} - ${displayVoiceName}`,
      artist: song?.artist || '',
      subtitle: trackAnchor?.sectionLabel ? `Desde ${trackAnchor.sectionLabel}` : 'Practica vocal',
      mediaKind: 'voice',
      voiceName: displayVoiceName,
      voiceColor: track?.__voiceColor || '',
      autoPlay: true,
      chordpro: song?.chordpro || '',
      sectionMarkers,
      expand: true,
      startAtSec: 0,
    });
  }, [songVoiceAssignments]);

  const handleSaveVoiceAssignment = useCallback(async ({ songId, targetUserId, trackName }) => {
    const safeSongId = String(songId || '').trim();
    const safeTargetUserId = String(targetUserId || '').trim();
    const safeTrackName = normalizeVoiceTrackLabel(trackName || '');

    if (!safeSongId || !safeTargetUserId || !safeTrackName) return;
    if (!playlistId || !eventMeta?.id || !userId) {
      showVoiceAssignmentFeedback('error', 'No pudimos identificar este setlist para guardar.');
      return;
    }

    const nextAssignments = {
      ...sanitizeSongVoiceAssignments(songVoiceAssignments),
      [safeSongId]: {
        ...(songVoiceAssignments?.[safeSongId] || {}),
        [safeTargetUserId]: {
          trackName: safeTrackName,
        },
      },
    };

    setIsSavingVoiceAssignments(true);

    try {
      const { error } = await supabase
        .from('playlist_voice_assignments')
        .upsert({
          playlist_id: playlistId,
          evento_id: eventMeta.id,
          assignments: nextAssignments,
          updated_by: userId,
        }, {
          onConflict: 'playlist_id',
        });

      if (error) {
        console.error('EnsayoHub voice assignment save error:', error);
        showVoiceAssignmentFeedback('error', getVoiceAssignmentErrorMessage(error, 'No se pudo guardar la asignacion.'));
        return;
      }

      setSongVoiceAssignments(nextAssignments);
      showVoiceAssignmentFeedback('success', 'Asignacion guardada.');
    } catch (error) {
      console.error('EnsayoHub unexpected voice assignment save error:', error);
      showVoiceAssignmentFeedback('error', 'Ocurrio un problema guardando la asignacion.');
    } finally {
      setIsSavingVoiceAssignments(false);
    }
  }, [playlistId, eventMeta?.id, userId, songVoiceAssignments, showVoiceAssignmentFeedback]);

  const handleClearVoiceAssignment = useCallback(async ({ songId, targetUserId }) => {
    const safeSongId = String(songId || '').trim();
    const safeTargetUserId = String(targetUserId || '').trim();

    if (!safeSongId || !safeTargetUserId) return;
    if (!playlistId || !eventMeta?.id || !userId) {
      showVoiceAssignmentFeedback('error', 'No pudimos identificar este setlist para guardar.');
      return;
    }

    const nextAssignments = { ...sanitizeSongVoiceAssignments(songVoiceAssignments) };
    const songAssignments = { ...(nextAssignments?.[safeSongId] || {}) };
    delete songAssignments[safeTargetUserId];

    if (Object.keys(songAssignments).length === 0) {
      delete nextAssignments[safeSongId];
    } else {
      nextAssignments[safeSongId] = songAssignments;
    }

    setIsSavingVoiceAssignments(true);

    try {
      const { error } = await supabase
        .from('playlist_voice_assignments')
        .upsert({
          playlist_id: playlistId,
          evento_id: eventMeta.id,
          assignments: nextAssignments,
          updated_by: userId,
        }, {
          onConflict: 'playlist_id',
        });

      if (error) {
        console.error('EnsayoHub voice assignment clear error:', error);
        showVoiceAssignmentFeedback('error', getVoiceAssignmentErrorMessage(error, 'No se pudo limpiar la asignacion.'));
        return;
      }

      setSongVoiceAssignments(nextAssignments);
      showVoiceAssignmentFeedback('success', 'Asignacion actualizada.');
    } catch (error) {
      console.error('EnsayoHub unexpected voice assignment clear error:', error);
      showVoiceAssignmentFeedback('error', 'Ocurrio un problema limpiando la asignacion.');
    } finally {
      setIsSavingVoiceAssignments(false);
    }
  }, [playlistId, eventMeta?.id, userId, songVoiceAssignments, showVoiceAssignmentFeedback]);

  const handleSaveVoiceTrackAnchor = useCallback(async ({ songId, trackName, anchor }) => {
    const safeSongId = String(songId || '').trim();
    const safeTrackName = normalizeVoiceTrackLabel(trackName || '');
    const safeStartSec = Number(anchor?.startSec);
    const safeSectionStartSec = Number(anchor?.sectionStartSec);
    const safePreRollSec = Number(anchor?.preRollSec);

    if (!safeSongId || !safeTrackName || !Number.isFinite(safeStartSec)) return;
    if (!userId) {
      showVoiceAssignmentFeedback('error', 'Inicia sesion para guardar el comienzo de la pista.');
      return;
    }

    const currentSongAssignments = {
      ...(songVoiceAssignments?.[safeSongId] || {}),
    };
    const currentAnchors = {
      ...(currentSongAssignments?.[VOICE_TRACK_ANCHORS_KEY] || {}),
    };

    const nextTrackAnchors = {
      ...currentAnchors,
      [safeTrackName]: {
        sectionId: String(anchor?.sectionId || ''),
        sectionLabel: String(anchor?.sectionLabel || 'Seccion').trim() || 'Seccion',
        sectionStartSec: Number.isFinite(safeSectionStartSec) ? safeSectionStartSec : safeStartSec,
        preRollSec: Number.isFinite(safePreRollSec) ? Math.max(0, safePreRollSec) : 0,
        startSec: safeStartSec,
      },
    };

    const nextAssignments = {
      ...sanitizeSongVoiceAssignments(songVoiceAssignments),
      [safeSongId]: {
        ...currentSongAssignments,
        [VOICE_TRACK_ANCHORS_KEY]: nextTrackAnchors,
      },
    };

    setIsSavingVoiceAssignments(true);

    try {
      const { error } = await supabase
        .from('canciones')
        .update({ voice_track_anchors: nextTrackAnchors })
        .eq('id', safeSongId);

      if (error) {
        console.error('EnsayoHub voice track anchor save error:', error);
        showVoiceAssignmentFeedback('error', getVoiceAssignmentErrorMessage(error, 'No se pudo guardar el inicio de la pista en el repertorio.'));
        return;
      }

      setLocalPlaylist((currentPlaylist) => (
        (Array.isArray(currentPlaylist) ? currentPlaylist : []).map((song) => (
          String(song?.id || '') === safeSongId
            ? { ...song, voiceTrackAnchors: nextTrackAnchors }
            : song
        ))
      ));
      setSongVoiceAssignments(nextAssignments);
      showVoiceAssignmentFeedback('success', 'Inicio de pista guardado.');
    } catch (error) {
      console.error('EnsayoHub unexpected voice track anchor save error:', error);
      showVoiceAssignmentFeedback('error', 'Ocurrio un problema guardando el inicio de la pista.');
    } finally {
      setIsSavingVoiceAssignments(false);
    }
  }, [userId, songVoiceAssignments, showVoiceAssignmentFeedback]);

  const playQueueItem = useCallback((index) => {
    const queueSongs = queueSongsRef.current;
    const nextSong = queueSongs[index];

    if (!nextSong) {
      stopQueue();
      return;
    }

    queueIndexRef.current = index;
    queueActiveRef.current = true;
    setQueueState({ active: true, index });
    openSongInPlayer(nextSong, true);
  }, [openSongInPlayer, stopQueue]);

  const startQueue = useCallback((startIndex = 0) => {
    if (playableSongs.length === 0) return;
    stopMetronome();
    queueSongsRef.current = playableSongs;
    playQueueItem(Math.max(0, Math.min(startIndex, playableSongs.length - 1)));
  }, [playQueueItem, playableSongs, stopMetronome]);

  const serviceDate = formatDateLabel(eventMeta?.fecha_hora);
  const serviceHour = formatHourLabel(eventMeta?.fecha_hora);
  const serviceDuration = formatServiceDuration(eventMeta?.fecha_hora, eventMeta?.hora_fin);
  const displayContextTitle = String(eventMeta?.display_theme || contextTitle || '').trim() || 'Modo Ensayo';
  const displayContextPreacher = String(eventMeta?.display_preacher || eventMeta?.predicador || '').trim();
  const rehearsalEventId = String(eventMeta?.id || '').trim();

  const loadPersonalSongSettingsForSongs = useCallback(async (targetSongs = printableSongs) => {
    const songIds = (Array.isArray(targetSongs) ? targetSongs : [])
      .map((song) => String(song?.id || '').trim())
      .filter(Boolean);

    if (songIds.length === 0) return {};

    const settingsMap = await loadRehearsalSongSettingsMap(
      supabase,
      {
        userId: String(userId || ''),
        eventId: rehearsalEventId,
        playlistId: String(playlistId || ''),
      },
      songIds,
    );

    setPersonalSongSettings((current) => ({
      ...current,
      ...settingsMap,
    }));

    return settingsMap;
  }, [playlistId, printableSongs, rehearsalEventId, userId]);

  const handlePersonalSettingsChange = useCallback((songId, settings) => {
    const safeSongId = String(songId || '').trim();
    if (!safeSongId) return;

    const safeSettings = sanitizeRehearsalSongSettings(settings);
    setPersonalSongSettings((current) => ({
      ...current,
      [safeSongId]: safeSettings,
    }));
  }, []);

  useEffect(() => {
    if (printableSongs.length === 0) return;
    void loadPersonalSongSettingsForSongs(printableSongs);
  }, [loadPersonalSongSettingsForSongs, printableSongs]);

  const openSetlistPrintModal = useCallback(async () => {
    const loadedSettings = await loadPersonalSongSettingsForSongs(printableSongs);
    const mergedPersonalSettings = {
      ...personalSongSettings,
      ...loadedSettings,
    };
    const nextCapos = {};
    const nextTones = {};
    printableSongs.forEach((song) => {
      const songId = String(song?.id || '');
      const baseTone = normalizeKeyToAmerican(song?.originalKey || song?.key || '');
      const savedSettings = sanitizeRehearsalSongSettings(mergedPersonalSettings[songId]);
      const savedTone = transposeChordSymbol(baseTone, savedSettings.transposeSteps);
      nextCapos[songId] = savedSettings.capoFret;
      nextTones[songId] = CHROMATIC_NOTES.includes(savedTone) ? savedTone : baseTone;
    });
    setSetlistCapos(nextCapos);
    setSetlistTones(nextTones);
    setSetlistPicker(null);
    setSetlistPrintError('');
    setShowSetlistPrintModal(true);
  }, [loadPersonalSongSettingsForSongs, personalSongSettings, printableSongs]);

  const updateSetlistCapo = useCallback((songId, capo) => {
    setSetlistCapos((current) => ({
      ...current,
      [String(songId || '')]: capo,
    }));
    setSetlistPicker(null);
  }, []);

  const updateSetlistTone = useCallback((songId, tone) => {
    const safeTone = normalizeKeyToAmerican(tone);
    if (!CHROMATIC_NOTES.includes(safeTone)) return;
    setSetlistTones((current) => ({
      ...current,
      [String(songId || '')]: safeTone,
    }));
    setSetlistPicker(null);
  }, []);

  const generateSetlistPdf = useCallback(async () => {
    if (isGeneratingSetlistPdf || printableSongs.length === 0) return;

    setIsGeneratingSetlistPdf(true);
    setSetlistPrintError('');

    let previewWindow = null;
    if (typeof window !== 'undefined') {
      previewWindow = window.open('', 'redil-setlist-pdf-v2');
      previewWindow?.document?.write?.('<!doctype html><title>Generando PDF</title><body style="font-family:system-ui;margin:32px;color:#18181b">Generando PDF del setlist...</body>');
    }

    let payload = null;
    const openBrowserPrintFallback = (fallbackPayload) => {
      const renderUrl = buildSetlistBrowserPrintUrl(fallbackPayload, {
        autoPrint: !isMobilePrintDevice(),
      });

      if (previewWindow && !previewWindow.closed) {
        previewWindow.location.href = renderUrl;
        return;
      }

      if (isMobilePrintDevice()) {
        window.location.href = renderUrl;
        return;
      }

      const openedWindow = window.open(renderUrl, 'redil-setlist-pdf-v2');
      if (!openedWindow) window.location.href = renderUrl;
    };

    try {
      const subtitle = [serviceDate, serviceHour].filter(Boolean).join(' · ');
      const fileName = `${buildSafePdfFileName(displayContextTitle)} - setlist V2.pdf`;
      payload = {
        title: displayContextTitle || 'Setlist de ensayo',
        subtitle,
        fileName,
        songs: printableSongs.map((song, index) => {
          const songId = String(song?.id || `${index}`);
          const capo = setlistRenderMode === 'chords-lyrics'
            ? Math.max(0, Math.min(7, Number(setlistCapos[songId] || 0)))
            : 0;
          const baseTone = normalizeKeyToAmerican(song?.originalKey || song?.key || '');
          const selectedTone = CHROMATIC_NOTES.includes(setlistTones[songId])
            ? setlistTones[songId]
            : baseTone;
          const metadataTone = setlistRenderMode === 'chords-lyrics' ? selectedTone : baseTone;
          const toneDelta = getToneDelta(baseTone, selectedTone);
          const transpositionSteps = setlistRenderMode === 'chords-lyrics' ? toneDelta - capo : 0;
          const shapeTone = capo > 0 && selectedTone !== '-'
            ? transposeChordSymbol(selectedTone, -capo)
            : '';
          const bpmValue = Number.isFinite(Number(song?.bpm)) && Number(song.bpm) > 0
            ? String(Math.round(Number(song.bpm)))
            : '';

          return {
            id: songId,
            order: index + 1,
            title: song?.title || `Cancion ${index + 1}`,
            artist: song?.artist || '',
            chordProText: transposeChordProText(song?.chordpro || '', transpositionSteps),
            metadata: {
              tone: metadataTone === '-' ? '' : metadataTone,
              capo: capo > 0 ? `${capo}${shapeTone ? ` (${shapeTone})` : ''}` : '0',
              tempo: bpmValue,
              time: '',
            },
            sheetOptions: {
              renderMode: setlistRenderMode,
              columnCount: 2,
              density: 'condensed',
              styleMode: 'condensado',
              showSongMap: true,
              showSectionDividers: true,
            },
            fileName: `${buildSafePdfFileName(song?.title || `cancion-${index + 1}`)}.pdf`,
          };
        }),
      };

      if (isMobilePrintDevice()) {
        openBrowserPrintFallback(payload);
        return;
      }

      const response = await fetch('/api/chordpro-print-setlist-pdf-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload }),
      });

      if (!response.ok) {
        throw new Error(`La ruta PDF respondio ${response.status}.`);
      }

      const pdfBlob = await response.blob();
      const pdfUrl = window.URL.createObjectURL(pdfBlob);
      setlistPdfObjectUrlsRef.current.push(pdfUrl);

      if (previewWindow && !previewWindow.closed) {
        previewWindow.location.href = pdfUrl;
      } else {
        const openedWindow = window.open(pdfUrl, 'redil-setlist-pdf-v2');
        if (!openedWindow) window.location.href = pdfUrl;
      }
    } catch (error) {
      console.error('EnsayoHub setlist PDF route failed; opening browser fallback:', error);

      try {
        if (!payload) throw error;
        openBrowserPrintFallback(payload);
      } catch (fallbackError) {
        console.error('EnsayoHub setlist browser fallback failed:', fallbackError);
        setSetlistPrintError(fallbackError?.message || 'No se pudo generar el PDF del setlist.');
        if (previewWindow && !previewWindow.closed) {
          previewWindow.close();
        }
      }
    } finally {
      setIsGeneratingSetlistPdf(false);
    }
  }, [displayContextTitle, isGeneratingSetlistPdf, printableSongs, serviceDate, serviceHour, setlistCapos, setlistRenderMode, setlistTones]);

  const openCompactSong = useCallback((song) => {
    if (!song) return;
    stopMetronome();
    stopQueue();
    setCancionPersonalActiva(null);
    setCancionActiva(song);
    setLastViewedSongId(String(song?.id || ''));
  }, [stopMetronome, stopQueue]);

  const handleCompactBack = useCallback(() => {
    stopMetronome();
    stopQueue();
    if (typeof window !== 'undefined') {
      window.__REDIL_PRO_PLAYER__?.close?.();
    }
    setCancionActiva(null);
  }, [stopMetronome, stopQueue]);

  const resolveLiveReturnSong = useCallback(() => {
    const lastViewedId = String(lastViewedSongId || '').trim();
    const queuedSong = queueState.index >= 0 ? playableSongs[queueState.index] : null;
    return (
      (lastViewedId
        ? songs.find((song) => String(song?.id || '') === lastViewedId)
        : null) ||
      queuedSong ||
      playableSongs[0] ||
      songs[0] ||
      null
    );
  }, [lastViewedSongId, playableSongs, queueState.index, songs]);

  const handleLiveModeExit = useCallback(() => {
    const returnSong = resolveLiveReturnSong();
    stopMetronome();
    stopQueue();
    setIsLiveMode(false);

    if (returnSong) {
      setCancionPersonalActiva(null);
      setCancionActiva(returnSong);
      setLastViewedSongId(String(returnSong?.id || ''));
    }
  }, [resolveLiveReturnSong, stopMetronome, stopQueue]);

  const handlePersonalViewBack = useCallback(() => {
    setCancionPersonalActiva(null);
  }, []);

  const handleListBack = useCallback(() => {
    window.location.href = '/';
  }, []);

  useEffect(() => () => {
    stopMetronome();
    stopQueue();
  }, [stopMetronome, stopQueue]);

  useEffect(() => {
    const audio = document.getElementById('mp3Audio');
    const closeButton = document.getElementById('btnMp3Close');
    const backdrop = document.getElementById('mp3PlayerBackdrop');

    if (!audio) return undefined;

    const handleEnded = () => {
      if (!queueActiveRef.current) return;
      playQueueItem(queueIndexRef.current + 1);
    };

    const handleQueueStop = () => {
      if (!queueActiveRef.current) return;
      stopQueue();
    };

    audio.addEventListener('ended', handleEnded);
    closeButton?.addEventListener('click', handleQueueStop);
    backdrop?.addEventListener('click', handleQueueStop);

    return () => {
      audio.removeEventListener('ended', handleEnded);
      closeButton?.removeEventListener('click', handleQueueStop);
      backdrop?.removeEventListener('click', handleQueueStop);
    };
  }, [playQueueItem, stopQueue]);

  if (cancionPersonalActiva) {
    const parsedVoices = parseVoiceResources(cancionPersonalActiva?.linkVoces);

    return (
      <EnsayoPersonalView
        song={cancionPersonalActiva}
        contextTitle={`${contextTitle} · Vista vocal`}
        userId={String(userId || '')}
        tracksOriginales={parsedVoices.entries || []}
        songVoiceAssignments={songVoiceAssignments}
        memberOptions={voiceMemberOptions}
        canEdit={canEdit || canAssignVoices}
        isSavingAssignments={isSavingVoiceAssignments}
        saveFeedback={voiceAssignmentFeedback}
        onBack={handlePersonalViewBack}
        onTrackPlay={(track) => handlePersonalVoiceTrackPlay(cancionPersonalActiva, track)}
        onSaveAssignment={handleSaveVoiceAssignment}
        onClearAssignment={handleClearVoiceAssignment}
        onSaveTrackAnchor={handleSaveVoiceTrackAnchor}
      />
    );
  }

  if (cancionActiva) {
    return (
      <ModoEnsayoCompacto
        song={cancionActiva}
        contextTitle={contextTitle}
        onGoBack={handleCompactBack}
        globalSyncMode={isSyncReceiver}
        eventId={rehearsalEventId}
        playlistId={String(playlistId || '')}
        userId={String(userId || '')}
        onPersonalSettingsChange={handlePersonalSettingsChange}
      />
    );
  }

  if (isLiveMode) {
    return (
      <React.Suspense
        fallback={
          <div className="flex h-[100dvh] items-center justify-center bg-[#0b0d12] px-6 text-center text-white">
            <div>
              <p className="text-[0.72rem] font-black uppercase tracking-[0.24em] text-cyan-300/80">
                Modo Live
              </p>
              <p className="mt-3 text-sm font-semibold text-white/70">Preparando director...</p>
            </div>
          </div>
        }
      >
        <ModoEnsayoDirector
          playlist={songs}
          contextTitle={contextTitle}
          onExit={handleLiveModeExit}
        />
      </React.Suspense>
    );
  }

  const hasMonitorUrl = typeof monitorUrl === 'string' && monitorUrl.trim() !== '';
  const setlistPickerSong = setlistPicker
    ? printableSongs.find((song) => String(song?.id || '') === String(setlistPicker.songId || '')) || null
    : null;
  const setlistPickerSongId = String(setlistPickerSong?.id || '');
  const setlistPickerBaseTone = normalizeKeyToAmerican(
    setlistPickerSong?.originalKey || setlistPickerSong?.key || ''
  );
  const setlistPickerSelectedTone = CHROMATIC_NOTES.includes(setlistTones[setlistPickerSongId])
    ? setlistTones[setlistPickerSongId]
    : setlistPickerBaseTone;
  const setlistPickerSelectedCapo = Math.max(
    0,
    Math.min(7, Number(setlistCapos[setlistPickerSongId] || 0))
  );

  return (
    <div className="flex h-screen w-full flex-col bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <main className="min-h-0 flex-1 overflow-y-auto px-0 pb-28 pt-0">
        <header className="ensayo-hub-header border-b border-zinc-200/80 bg-white/95 dark:border-white/10 dark:bg-zinc-950/96">
        <div className="mx-auto max-w-5xl px-4 pb-4 pt-[calc(env(safe-area-inset-top)+0.8rem)]">
          <div className="rounded-[2rem] border border-zinc-200/80 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_38%),linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(244,244,245,0.96))] px-5 py-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.22),_transparent_34%),linear-gradient(180deg,_rgba(9,9,11,0.98),_rgba(15,23,42,0.94))] dark:shadow-[0_28px_80px_rgba(2,6,23,0.5)]">
            <div className="grid grid-cols-[auto_1fr] items-start gap-4 md:grid-cols-[auto_1fr_auto] md:gap-5">
            <button
              type="button"
              onClick={handleListBack}
              className="ui-pressable-soft flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-900 shadow-sm transition-colors hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
              aria-label="Volver al inicio"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

              <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.28em] text-zinc-500 dark:text-zinc-400">
                    Setlist de Ensayo
                  </p>
                  <h1 className="mt-2 text-2xl font-black tracking-tight text-zinc-950 dark:text-zinc-50 md:text-4xl">
                    {displayContextTitle}
                  </h1>
                  {displayContextPreacher && (
                    <p className="mt-1.5 text-sm font-light text-zinc-600 dark:text-zinc-300 md:text-base">
                      {displayContextPreacher}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-sm font-medium text-zinc-600 dark:text-zinc-300">
                    {serviceDate && (
                      <span className="inline-flex items-center gap-2">
                        <CalendarDays className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
                        {serviceDate}{serviceHour ? ` · ${serviceHour}` : ''}
                      </span>
                    )}
                    {serviceDuration && (
                      <span className="inline-flex items-center gap-2">
                        <Clock3 className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
                        {serviceDuration}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-2">
                      <ListMusic className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
                      {songs.length} canciones
                    </span>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setIsEditMode(!isEditMode)}
                        className={`ui-pressable-soft inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] transition-all ${
                          isEditMode
                            ? 'bg-brand text-white'
                            : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
                        }`}
                      >
                        <GripVertical className="h-3 w-3" />
                        {isEditMode ? 'Listo' : 'Ordenar setlist'}
                      </button>
                    )}
                  </div>
                </div>

              </div>
            </div>
        </div>
        </header>

        <div className="mx-auto w-full max-w-5xl pt-4">
          <div className="overflow-hidden">
            {(playableSongs.length > 0 || printableSongs.length > 0) && (
              <section className="border-y border-zinc-200/90 px-4 py-3.5 dark:border-white/10 sm:px-5">
                <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 sm:justify-end">
                    {queueState.active && (
                      <button
                        type="button"
                        onClick={stopQueue}
                        className="inline-flex h-11 items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-black text-zinc-700 shadow-sm transition-colors hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                      >
                        Detener reproduccion
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={openSetlistPrintModal}
                      disabled={printableSongs.length === 0 || isGeneratingSetlistPdf}
                      className="inline-flex h-11 min-w-[7.25rem] flex-1 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-black text-zinc-800 shadow-sm transition-all hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 sm:flex-none"
                      aria-label="Imprimir setlist PDF V2"
                    >
                      <Printer className="h-4 w-4" />
                      Imprimir todo
                    </button>
                    <button
                      type="button"
                      onClick={() => startQueue(queueState.active ? queueState.index : 0)}
                      disabled={playableSongs.length === 0}
                      className="inline-flex h-11 min-w-[9.25rem] flex-1 items-center justify-center gap-2 rounded-2xl bg-brand px-4 text-sm font-black text-white shadow-lg shadow-brand/20 transition-all hover:bg-brand/90 hover:shadow-brand/35 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
                    >
                      <Play className="ml-0.5 h-4 w-4" />
                      {queueState.active ? 'Reiniciar lista' : 'Reproducir todo'}
                    </button>
                </div>
              </section>
            )}

            {songs.map((song, index) => {
              // ── Card de Oración ──
              if (song?.isPrayer) {
                return (
                  <article
                    key={song.id}
                    className="group flex w-full items-center gap-3 border-b border-zinc-200/90 bg-amber-50/50 px-4 py-4 dark:border-white/10 dark:bg-amber-500/5"
                  >
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-amber-300/50 bg-amber-100 text-lg dark:border-amber-500/20 dark:bg-amber-500/10">
                      🙏
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-black tracking-tight text-amber-800 dark:text-amber-300">
                        {song.title}
                      </p>
                      {song.prayerText && (
                        <p className="mt-0.5 line-clamp-2 text-sm text-amber-600/80 dark:text-amber-400/60">
                          {song.prayerText}
                        </p>
                      )}
                      <span className="mt-1 inline-flex items-center rounded-full bg-amber-200/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                        Sección de Oración
                      </span>
                    </div>
                    {isEditMode && (
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => moveSong(index, -1)} disabled={index === 0}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:border-white/10 dark:bg-zinc-800 dark:hover:bg-zinc-700">
                          <ChevronUp className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => moveSong(index, 1)} disabled={index === songs.length - 1}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:border-white/10 dark:bg-zinc-800 dark:hover:bg-zinc-700">
                          <ChevronDown className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => removePrayerSection(index)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-500 hover:bg-red-100 dark:border-red-500/20 dark:bg-red-500/10 dark:hover:bg-red-500/20">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </article>
                );
              }

              // ── Card de Canción normal ──
              const keyLabel = normalizeKeyToAmerican(song?.originalKey || song?.key || '-');
              const bpmValue = Number.isFinite(Number(song?.bpm)) ? Math.max(0, Math.round(Number(song.bpm))) : 0;
              const isMetronomeActive = activeMetronomeSongId === song?.id;
              const hasSongAudio = typeof song?.mp3 === 'string' && song.mp3.trim() !== '';
              const parsedVoices = parseVoiceResources(song?.linkVoces);
              const hasVoiceResources = parsedVoices.hasResources || Boolean(parsedVoices.legacyUrl);
              const hasStructuredVoiceEntries = parsedVoices.entries.length > 0;
              const voiceLabel = normalizeVoiceLabel(song?.voz);
              const isLastViewed = String(song?.id || index) === String(lastViewedSongId || '');
              const currentUserAssignedTrackName = String(
                viewerVoiceMemberId
                  ? songVoiceAssignments?.[String(song?.id || '')]?.[viewerVoiceMemberId]?.trackName || ''
                  : ''
              ).trim();
              const hasPersonalVoiceAssignment = Boolean(
                currentUserAssignedTrackName &&
                parsedVoices.entries.some((entry) => String(entry?.label || '').trim() === currentUserAssignedTrackName)
              );
              const songActionKey = String(song?.id || `${song?.title || 'song'}-${index}`);
              const hasActionOverflow = overflowingSongActionIds.has(songActionKey);
              const metadataItems = [
                keyLabel && keyLabel !== '-' ? keyLabel : '',
                song?.category ? formatCompactMetaLabel(song.category) : '',
                voiceLabel,
              ].filter(Boolean);
              const singlePrintParams = new URLSearchParams({
                song: String(song?.id || ''),
              });
              if (rehearsalEventId) singlePrintParams.set('event', rehearsalEventId);
              if (playlistId) singlePrintParams.set('playlist', String(playlistId));
              const singlePrintHref = `/herramientas/chordpro-print?${singlePrintParams.toString()}`;

              return (
                <React.Fragment key={song?.id || `${song?.title || 'song'}-${index}`}>
                <article
                  onClick={(event) => {
                    if (isEditMode || event.target.closest('button, a')) return;
                    openCompactSong(song);
                  }}
                  onKeyDown={(event) => {
                    if (isEditMode) return;
                    if (event.target.closest('button, a')) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openCompactSong(song);
                    }
                  }}
                  role="button"
                  tabIndex={isEditMode ? -1 : 0}
                  className={`ui-pressable-row group grid w-full items-start gap-x-3.5 gap-y-2 border-b border-zinc-200/90 px-4 py-3.5 text-left transition-colors dark:border-white/10 last:border-b-0 sm:gap-x-4 sm:px-5 ${
                    isEditMode
                      ? 'grid-cols-[auto_auto_minmax(0,1fr)]'
                      : 'grid-cols-[auto_minmax(0,1fr)]'
                  } ${
                    isLastViewed
                      ? 'bg-brand/6 hover:bg-brand/10 dark:bg-brand/10 dark:hover:bg-brand/12'
                      : isEditMode ? '' : 'hover:bg-zinc-50 dark:hover:bg-white/[0.03]'
                  }`}
                >
                  {/* Flechas de reorden (solo en modo edición) */}
                  {isEditMode && (
                    <div className="flex flex-col items-center gap-0.5 self-center">
                      <button type="button" onClick={(e) => { e.stopPropagation(); moveSong(index, -1); }} disabled={index === 0}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-20 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <GripVertical className="h-3.5 w-3.5 text-zinc-300 dark:text-zinc-600" />
                      <button type="button" onClick={(e) => { e.stopPropagation(); moveSong(index, 1); }} disabled={index === songs.length - 1}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-20 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  <SongArtworkThumb song={song} index={index} />

                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-start gap-3.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-base font-black leading-tight tracking-tight text-zinc-950 dark:text-zinc-50 md:text-lg">
                          {song?.title || `Canción ${index + 1}`}
                        </p>
                        <p className="mt-0.5 truncate text-sm leading-tight text-zinc-500 dark:text-zinc-400">
                          {song?.artist || 'Redil Worship'}
                        </p>
                        {metadataItems.length > 0 && (
                          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold leading-none text-zinc-500 dark:text-zinc-400">
                            {metadataItems.map((item, metaIndex) => (
                              <React.Fragment key={`${songActionKey}-meta-${item}-${metaIndex}`}>
                                {metaIndex > 0 && (
                                  <span className="h-1 w-1 rounded-full bg-zinc-300 dark:bg-zinc-700" aria-hidden="true" />
                                )}
                                <span className="min-w-0 max-w-full truncate">
                                  {item}
                                </span>
                              </React.Fragment>
                            ))}
                          </div>
                        )}
                      </div>

                      {!isEditMode && (
                        <div className="ensayo-hub-row-actions flex shrink-0 items-start gap-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              toggleSongMetronome(song?.id || index, bpmValue);
                            }}
                            disabled={!bpmValue}
                            className={`ensayo-hub-bpm relative inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border bg-white text-zinc-900 shadow-sm transition-colors dark:bg-zinc-900 dark:text-zinc-50 ${
                              bpmValue
                                ? 'border-zinc-200 hover:bg-zinc-100 dark:border-white/10 dark:hover:bg-zinc-800'
                                : 'cursor-not-allowed border-zinc-200/70 text-zinc-400 dark:border-white/10 dark:text-zinc-500'
                            } ${isMetronomeActive ? 'beat-active' : ''}`}
                            style={isMetronomeActive && bpmValue ? { '--bpm-duration': `${60 / bpmValue}s` } : undefined}
                            aria-label={isMetronomeActive ? `Detener metrónomo ${bpmValue} BPM` : `Activar metrónomo ${bpmValue || 0} BPM`}
                            title={bpmValue ? `${bpmValue} BPM` : 'Sin BPM'}
                          >
                            <span className={`relative z-[1] font-black leading-none ${String(bpmValue || '--').length > 2 ? 'text-[11px]' : 'text-sm'}`}>
                              {bpmValue || '--'}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              stopQueue();
                              openSongInPlayer(song, true);
                            }}
                            disabled={!hasSongAudio}
                            className={`inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
                              hasSongAudio
                                ? 'border-zinc-200 bg-white text-zinc-900 shadow-sm hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800'
                                : 'cursor-not-allowed border-zinc-200/70 bg-zinc-100 text-zinc-400 shadow-none dark:border-white/10 dark:bg-zinc-900/60 dark:text-zinc-600'
                            }`}
                            aria-label={hasSongAudio ? `Reproducir ${song?.title || 'canción'}` : 'Sin MP3'}
                            title={hasSongAudio ? 'Escuchar canción' : 'Esta canción no tiene MP3'}
                          >
                            <Play className="ml-0.5 h-4.5 w-4.5" />
                          </button>

                          <div className="ensayo-hub-row-chevron hidden h-10 w-10 items-center justify-center rounded-full text-zinc-300 transition-colors group-hover:text-zinc-500 dark:text-zinc-700 dark:group-hover:text-zinc-400 md:flex">
                            <ChevronRight className="h-5 w-5" />
                          </div>
                        </div>
                      )}
                    </div>

                    <div className={`ensayo-song-actions-wrap mt-3 ${hasActionOverflow ? 'has-overflow' : ''}`}>
                      <div
                        ref={(node) => {
                          if (node) {
                            songActionScrollerRefs.current.set(songActionKey, node);
                          } else {
                            songActionScrollerRefs.current.delete(songActionKey);
                          }
                        }}
                        className="ensayo-song-actions flex min-w-0 items-center gap-2.5 overflow-x-auto px-0.5 py-1 pr-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                      >
                      {hasVoiceResources && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            openPersonalVoiceView(song);
                          }}
                          className={`ui-pressable-soft inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border px-3 text-[12px] font-bold transition-all ${
                            hasPersonalVoiceAssignment
                              ? 'border-violet-300/55 bg-violet-500/14 text-violet-800 shadow-sm hover:bg-violet-500/18 dark:border-violet-300/25 dark:bg-violet-400/14 dark:text-violet-100 dark:hover:bg-violet-400/18'
                              : 'border-violet-300/40 bg-violet-500/10 text-violet-700 shadow-sm hover:bg-violet-500/15 hover:text-violet-800 dark:border-violet-300/20 dark:bg-violet-400/10 dark:text-violet-200 dark:hover:bg-violet-400/16 dark:hover:text-violet-100'
                          }`}
                          aria-label={`Abrir vista vocal de ${song?.title || 'cancion'}`}
                          title="Abrir voces"
                        >
                          <Mic2 className="h-3.5 w-3.5" />
                          Voces
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          openCompactSong(song);
                        }}
                        className="ui-pressable-soft inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-brand/30 bg-brand/10 px-3 text-[12px] font-bold text-brand shadow-sm transition-all hover:bg-brand/15 active:scale-95 dark:border-brand/25 dark:bg-brand/10 dark:text-brand dark:hover:bg-brand/16"
                        aria-label={`Abrir modo ensayo de ${song?.title || 'canción'}`}
                        title="Abrir modo ensayo"
                      >
                        <ListMusic className="h-3.5 w-3.5" />
                        Ensayar
                      </button>

                      {song?.id && (
                        <a
                          href={singlePrintHref}
                          onClick={(event) => event.stopPropagation()}
                          className="ui-pressable-soft inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-amber-300/45 bg-amber-500/10 px-3 text-[12px] font-bold text-amber-800 shadow-sm transition-all hover:bg-amber-500/15 hover:text-amber-900 active:scale-95 dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-200 dark:hover:bg-amber-300/16 dark:hover:text-amber-100"
                          title="Imprimir hoja de la canción"
                          aria-label={`Imprimir ${song?.title || 'canción'}`}
                        >
                          <Printer className="h-3.5 w-3.5" />
                          Imprimir
                        </a>
                      )}
                      </div>
                      <span className="ensayo-song-actions-hint" aria-hidden="true">
                        <ChevronRight className="h-4.5 w-4.5" />
                      </span>
                    </div>
                  </div>
                </article>

                {/* Botón para insertar oración entre canciones (solo en modo edición) */}
                {isEditMode && (
                  <div className="flex items-center justify-center border-b border-zinc-200/90 py-1 dark:border-white/10">
                    <button
                      type="button"
                      onClick={() => { setInsertAfterIndex(index); setShowPrayerModal(true); }}
                      className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400 transition-colors hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-500/10 dark:hover:text-amber-400"
                    >
                      <Plus className="h-3 w-3" />
                      Insertar oración
                    </button>
                  </div>
                )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </main>

      {showSetlistPrintModal && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-zinc-950/55 px-0 pt-10 backdrop-blur-sm sm:items-center sm:px-4">
          <div className="flex max-h-[min(88dvh,760px)] w-full max-w-2xl flex-col overflow-hidden rounded-t-[2rem] border border-zinc-200 bg-white shadow-[0_32px_100px_rgba(15,23,42,0.28)] dark:border-white/10 dark:bg-zinc-950 sm:rounded-[2rem]">
            <div className="flex items-start justify-between gap-3 border-b border-zinc-200/90 px-4 py-4 dark:border-white/10 sm:px-5">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
                  PDF setlist V2
                </p>
                <h2 className="mt-1 truncate text-xl font-black tracking-tight text-zinc-950 dark:text-zinc-50">
                  Imprimir ensayo
                </h2>
                <p className="mt-1 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                  {printableSongs.length} canciones
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isGeneratingSetlistPdf) {
                    setSetlistPicker(null);
                    setShowSetlistPrintModal(false);
                  }
                }}
                disabled={isGeneratingSetlistPdf}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-600 shadow-sm transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                aria-label="Cerrar impresión de setlist"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
              <div className="mb-3 rounded-2xl border border-zinc-200 bg-white p-2 shadow-sm dark:border-white/10 dark:bg-zinc-900">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSetlistPicker(null);
                      setSetlistRenderMode('chords-lyrics');
                    }}
                    className={`inline-flex h-11 items-center justify-center rounded-xl px-3 text-sm font-black transition-all ${
                      setlistRenderMode === 'chords-lyrics'
                        ? 'bg-brand text-white shadow-lg shadow-brand/20'
                        : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10'
                    }`}
                    aria-pressed={setlistRenderMode === 'chords-lyrics'}
                  >
                    Letras y acordes
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSetlistPicker(null);
                      setSetlistRenderMode('lyrics-only');
                    }}
                    className={`inline-flex h-11 items-center justify-center rounded-xl px-3 text-sm font-black transition-all ${
                      setlistRenderMode === 'lyrics-only'
                        ? 'bg-brand text-white shadow-lg shadow-brand/20'
                        : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10'
                    }`}
                    aria-pressed={setlistRenderMode === 'lyrics-only'}
                  >
                    Solo letras
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {printableSongs.map((song, index) => {
                  const songId = String(song?.id || `${index}`);
                  const currentCapo = Math.max(0, Math.min(7, Number(setlistCapos[songId] || 0)));
                  const baseTone = normalizeKeyToAmerican(song?.originalKey || song?.key || '');
                  const selectedTone = CHROMATIC_NOTES.includes(setlistTones[songId]) ? setlistTones[songId] : baseTone;
                  const shapeTone = currentCapo > 0 && selectedTone !== '-' ? transposeChordSymbol(selectedTone, -currentCapo) : '';
                  const showToneControls = setlistRenderMode === 'chords-lyrics';

                  return (
                    <section
                      key={songId}
                      className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-3 dark:border-white/10 dark:bg-white/[0.03]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500">
                            {String(index + 1).padStart(2, '0')}
                          </p>
                          <h3 className="mt-1 truncate text-base font-black text-zinc-950 dark:text-zinc-50">
                            {song?.title || `Cancion ${index + 1}`}
                          </h3>
                          {showToneControls && (
                            <p className="mt-0.5 truncate text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                              {selectedTone !== '-' ? `Tono ${selectedTone}` : 'Sin tono'}
                              {shapeTone ? ` · Figura ${shapeTone}` : ''}
                            </p>
                          )}
                        </div>
                      </div>

                      {showToneControls && (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setSetlistPicker({ type: 'tone', songId })}
                            className="inline-flex h-11 min-w-0 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-sm font-black text-zinc-700 shadow-sm transition-colors hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                          >
                            Tono {selectedTone !== '-' ? selectedTone : '--'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setSetlistPicker({ type: 'capo', songId })}
                            className="inline-flex h-11 min-w-0 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-sm font-black text-zinc-700 shadow-sm transition-colors hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                          >
                            Capo {currentCapo}
                          </button>
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-zinc-200/90 bg-white px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 dark:border-white/10 dark:bg-zinc-950 sm:px-5">
              {setlistPrintError && (
                <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                  {setlistPrintError}
                </p>
              )}
              <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-2 sm:flex sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setSetlistPicker(null);
                    setShowSetlistPrintModal(false);
                  }}
                  disabled={isGeneratingSetlistPdf}
                  className="inline-flex h-11 items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-black text-zinc-700 shadow-sm transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={generateSetlistPdf}
                  disabled={isGeneratingSetlistPdf || printableSongs.length === 0}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-brand px-4 text-sm font-black text-white shadow-lg shadow-brand/25 transition-all hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isGeneratingSetlistPdf ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Printer className="h-4 w-4" />
                  )}
                  {isGeneratingSetlistPdf ? 'Generando' : 'Generar PDF'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSetlistPrintModal && setlistPicker && setlistPickerSong && (
        <div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-zinc-950/45 px-0 pt-10 backdrop-blur-sm sm:items-center sm:px-4"
          onClick={() => setSetlistPicker(null)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-t-[2rem] border border-zinc-200 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.3)] dark:border-white/10 dark:bg-zinc-950 sm:rounded-[2rem]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-zinc-200/90 px-4 py-4 dark:border-white/10">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
                  {setlistPicker.type === 'tone' ? 'Tono' : 'Capo'}
                </p>
                <h3 className="mt-1 truncate text-lg font-black tracking-tight text-zinc-950 dark:text-zinc-50">
                  {setlistPickerSong?.title || 'Cancion'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSetlistPicker(null)}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-600 shadow-sm transition-colors hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                aria-label="Cerrar selector"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[min(60dvh,440px)] overflow-y-auto px-4 py-4">
              {setlistPicker.type === 'tone' ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {SETLIST_TONE_OPTIONS.map((tone) => {
                    const isSelected = setlistPickerSelectedTone === tone;
                    return (
                      <button
                        key={tone}
                        type="button"
                        onClick={() => updateSetlistTone(setlistPickerSongId, tone)}
                        className={`h-12 rounded-xl text-base font-black transition-all ${
                          isSelected
                            ? 'bg-brand text-white shadow-lg shadow-brand/20'
                            : 'border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800'
                        }`}
                        aria-pressed={isSelected}
                      >
                        {tone}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {SETLIST_CAPO_OPTIONS.map((capo) => {
                    const isSelected = setlistPickerSelectedCapo === capo;
                    const shapeTone = capo > 0 && setlistPickerSelectedTone !== '-'
                      ? transposeChordSymbol(setlistPickerSelectedTone, -capo)
                      : '';
                    return (
                      <button
                        key={`setlist-picker-capo-${capo}`}
                        type="button"
                        onClick={() => updateSetlistCapo(setlistPickerSongId, capo)}
                        className={`flex h-14 flex-col items-center justify-center rounded-xl text-sm font-black transition-all ${
                          isSelected
                            ? 'bg-brand text-white shadow-lg shadow-brand/20'
                            : 'border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800'
                        }`}
                        aria-pressed={isSelected}
                      >
                        <span>Capo {capo}</span>
                        {shapeTone && (
                          <span className={`mt-0.5 text-[11px] font-black ${isSelected ? 'text-white/80' : 'text-zinc-400 dark:text-zinc-500'}`}>
                            Figura {shapeTone}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="ensayo-hub-queuebar fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/96 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-950/96">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
              Herramientas de ensayo
            </p>
            <p className="truncate text-sm font-medium text-zinc-600 dark:text-zinc-300">
              Live y sincronizacion del director.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (isSyncReceiver) {
                  setIsSyncReceiver(false);
                  setSyncCountdown(null);
                } else {
                  setSyncCountdown(3);
                }
              }}
              className={`inline-flex h-11 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-black transition-all ${
                isSyncReceiver || syncCountdown !== null
                  ? 'bg-emerald-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.3)]'
                  : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
              }`}
              title={isSyncReceiver ? 'Sincronización Activa (Escuchando al Director)' : 'Conectar al Director'}
            >
              <RadioReceiver className={`h-4 w-4 ${isSyncReceiver ? 'animate-pulse' : ''}`} />
              <span className="hidden sm:inline">RECIBIR LIVE</span>
            </button>
            {hasMonitorUrl && (
              <button
                type="button"
                onClick={() => {
                  window.open(monitorUrl, '_blank', 'noopener,noreferrer');
                }}
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-500 shadow-sm transition-all hover:bg-zinc-100 hover:text-zinc-900 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                title="Abrir confidence monitor en otra pantalla"
                aria-label="Abrir confidence monitor en otra pantalla"
              >
                <ExternalLink className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => { stopMetronome(); stopQueue(); setIsLiveMode(true); }}
              disabled={playableSongs.length === 0}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-brand px-5 text-sm font-black text-white shadow-lg shadow-brand/25 transition-all hover:bg-brand/90 hover:shadow-brand/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Zap className="h-4 w-4" />
              MODO LIVE
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes ensayo-hub-bpm-pulse {
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

        .ensayo-hub-bpm.beat-active {
          animation: ensayo-hub-bpm-pulse var(--bpm-duration, 1s) infinite;
        }

        .dark .ensayo-hub-bpm.beat-active {
          background-color: rgba(24, 24, 27, 0.98);
        }

        .ensayo-song-actions-wrap {
          position: relative;
          min-width: 0;
          transition: padding-right 180ms ease;
        }

        .ensayo-song-actions-wrap.has-overflow {
          padding-right: 1.35rem;
        }

        .ensayo-song-actions > * {
          flex: 0 0 auto;
        }

        .ensayo-song-actions-hint {
          position: absolute;
          right: 0;
          top: 50%;
          display: inline-flex;
          width: 1.2rem;
          height: 1.75rem;
          align-items: center;
          justify-content: center;
          color: rgb(var(--color-brand));
          opacity: 0;
          pointer-events: none;
          transform: translate3d(-0.25rem, -50%, 0);
          transition:
            opacity 180ms ease,
            transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
        }

        .ensayo-song-actions-wrap.has-overflow .ensayo-song-actions-hint {
          opacity: 1;
          animation: ensayo-song-actions-nudge 1.35s ease-in-out infinite;
        }

        .dark .ensayo-song-actions-hint {
          color: rgba(244, 244, 245, 0.92);
          filter: drop-shadow(0 1px 3px rgba(0,0,0,0.55));
        }

        @keyframes ensayo-song-actions-nudge {
          0%, 100% {
            transform: translate3d(-0.25rem, -50%, 0);
          }
          50% {
            transform: translate3d(0.05rem, -50%, 0);
          }
        }

        body[data-pro-player-modal-open='true'] .ensayo-hub-row-actions,
        body[data-pro-player-modal-open='true'] .ensayo-hub-row-chevron,
        body[data-voces-modal-open='true'] .ensayo-hub-row-actions,
        body[data-voces-modal-open='true'] .ensayo-hub-row-chevron,
        body[data-pro-player-modal-open='true'] .ensayo-hub-queuebar,
        body[data-voces-modal-open='true'] .ensayo-hub-queuebar {
          opacity: 0;
          pointer-events: none;
        }

        body[data-pro-player-modal-open='true'] .ensayo-hub-queuebar,
        body[data-voces-modal-open='true'] .ensayo-hub-queuebar {
          transform: translateY(calc(100% + env(safe-area-inset-bottom) + 1rem));
        }
      `}</style>

      {/* MODAL: Insertar sección de oración */}
      {showPrayerModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl dark:border-white/10 dark:bg-zinc-900">
            <div className="border-b border-zinc-200/80 bg-amber-50 px-5 py-4 dark:border-white/10 dark:bg-amber-500/10">
              <h3 className="text-lg font-black text-amber-800 dark:text-amber-300">🙏 Sección de Oración</h3>
              <p className="mt-0.5 text-sm text-amber-600/70 dark:text-amber-400/60">Se insertará después de la canción {insertAfterIndex + 1}</p>
            </div>
            <div className="flex flex-col gap-4 p-5">
              <div>
                <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Título</label>
                <input
                  type="text"
                  value={prayerTitle}
                  onChange={(e) => setPrayerTitle(e.target.value)}
                  placeholder="Oración de Confesión"
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm font-bold text-zinc-900 placeholder-zinc-400 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-white/10 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Texto de la oración (opcional)</label>
                <textarea
                  value={prayerText}
                  onChange={(e) => setPrayerText(e.target.value)}
                  placeholder="Padre celestial, venimos ante tu presencia..."
                  rows={4}
                  className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-700 placeholder-zinc-400 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-300 dark:placeholder-zinc-500"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-zinc-200/80 px-5 py-3 dark:border-white/10">
              <button
                type="button"
                onClick={() => { setShowPrayerModal(false); setPrayerText(''); setPrayerTitle('Oración de Confesión'); }}
                className="rounded-xl px-4 py-2 text-sm font-bold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => insertPrayerSection(insertAfterIndex)}
                className="rounded-xl bg-amber-500 px-5 py-2 text-sm font-black text-white shadow-lg shadow-amber-500/25 hover:bg-amber-600"
              >
                Insertar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OVERLAY DE CONEXIÓN LIVE — Cuenta regresiva */}
      {syncCountdown !== null && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-zinc-950/95 backdrop-blur-md transition-all duration-300">
          <div className="flex flex-col items-center gap-6 text-center">
            <RadioReceiver className={`h-16 w-16 text-emerald-500 ${syncCountdown > 0 ? 'animate-pulse' : 'animate-bounce'}`} />
            <h2 className="text-xl font-black uppercase tracking-[0.2em] text-white opacity-80">
              {syncCountdown > 0 ? 'Sincronizando con Director' : '¡Conexión Establecida!'}
            </h2>
            <div className="relative flex h-40 w-40 items-center justify-center rounded-full border-4 border-emerald-500/20 bg-emerald-500/10 shadow-[0_0_50px_rgba(16,185,129,0.2)]">
              <p className="absolute text-[6rem] font-black leading-none text-emerald-400">
                {syncCountdown > 0 ? syncCountdown : 'ON'}
              </p>
              {syncCountdown > 0 && (
                <svg className="absolute inset-0 h-full w-full animate-spin text-emerald-500" style={{ animationDuration: '1.5s' }} viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray="150" strokeLinecap="round" />
                </svg>
              )}
            </div>
            <p className="mt-4 text-xs font-bold uppercase tracking-widest text-zinc-500">
              Por favor, no toque la pantalla
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
