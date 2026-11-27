import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Disc3,
  Headphones,
  MoreHorizontal,
  LoaderCircle,
  Pause,
  Play,
  Mic2,
  Repeat,
  Repeat1,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  TrendingUp,
  User,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { screenWakeLockService } from '../../services/ScreenWakeLockService';
import { canUseAdvancedStreamingEngine, useMultitrackEngine } from '../../hooks/useMultitrackEngine';
import { useLiveDirectorSectionJump } from '../../hooks/useLiveDirectorSectionJump';
import { supportsPreparedSectionJump } from '../../utils/liveDirectorEnginePolicy';
import { readLiveBrowserCapabilities } from '../../utils/liveDiagnostics';
import { detectSequenceOffsetInBrowser } from '../../utils/sequenceOffsetDetection.js';
import { VirtualClickPlayer } from '../../services/VirtualClickPlayer';
import { useLiveDirectorDynamicGuide } from '../../hooks/useLiveDirectorDynamicGuide';
import { resolveFetchableAudioUrl, resolvePreferredAudioUrl } from '../../lib/audio-playback.js';
import { parseChordProLine } from '../../utils/chordProLineUtils';
import {
  applyLiveDirectorSectionOffset,
  buildLiveDirectorSectionsFromMarkers,
  normalizePersistedLiveDirectorSession,
  resolveLiveDirectorSessionSections,
} from '../../utils/liveDirectorSongSession';
import {
  loadRehearsalSongSettings,
  sanitizeRehearsalSongSettings,
  saveRehearsalSongSettings,
} from '../../utils/rehearsalUserSongSettings';
import {
  buildCombinedWaveform,
  buildRehearsalMixPrefsKey,
  classifyRehearsalTracks,
  computeRehearsalTrackGains,
  estimateEnvelopeDuration,
  findTimelineIndexAt,
  hasFullRehearsalSequence,
  listPartCandidates,
  listPresentGroups,
  mapTimelineToSheetSections,
  MAX_GROUP_LEVEL,
  REHEARSAL_PART_MODE_HINTS,
  sanitizeRehearsalMixPrefs,
  suggestPartTrackIds,
} from '../../utils/rehearsalSequenceMix.js';
import { STEM_CATEGORIES } from '../../utils/stemCategories';
import {
  ChordDisplay,
  ChordLibraryModal,
  ChordPreviewPopover,
  buildChordLibrary,
  extractChordTokensFromSections,
  normalizeChordSymbol,
  parseChordSymbol,
} from './ModoEnsayoCompacto.jsx';
import {
  formatChordAccidentals,
  suggestCapoForKey,
  transposeChordProLine,
  transposeChordToken,
  transposeKeyLabel,
} from '../../utils/chordTranspose.js';
import { CHORD_SPELLINGS, spellChord, spellChordProLine } from '../../utils/chordSpelling';
import { useChordSpelling } from '../../hooks/useChordSpelling';
import { applyEventKey, isEventKeyFresh, readEventKey } from '../../utils/liveDirectorEventKey';

const TRANSPOSE_STEPS = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6];
const CAPO_FRETS = [0, 1, 2, 3, 4, 5, 6, 7];

const WAVEFORM_BARS = 120;
// Same section-jump fades as LiveDirectorView: hide the seek, never pause.
const SEEK_FADE_OUT_MS = 170;
const SEEK_FADE_IN_MS = 180;
const LOAD_TIMEOUT_MS = 45000;
const MP3_OFFSET_TIMEOUT_MS = 15000;

/** True when the song has a real backing sequence (see hasFullRehearsalSequence); otherwise the normal rehearsal opens. */
export const songHasRehearsalSequence = (song) => {
  const session = normalizePersistedLiveDirectorSession(
    song?.multitrackSession || song?.multitrack_session || null,
    { songId: song?.id, songTitle: song?.title },
  );
  return hasFullRehearsalSequence(classifyRehearsalTracks(session?.tracks || []));
};


const formatTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

// Measured mp3 ↔ sequence shift, kept on this device only.
const MP3_OFFSET_PREFIX = 'alabanza:rehearsal-mp3-offset:';
const readCachedMp3Offset = (key) => {
  try {
    const value = window.localStorage.getItem(MP3_OFFSET_PREFIX + key);
    return value === null ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
  } catch { return null; }
};
const writeCachedMp3Offset = (key, value) => {
  try { window.localStorage.setItem(MP3_OFFSET_PREFIX + key, String(value)); } catch { /* this session only */ }
};

const readPrefs = (key, validTrackIds) => {
  try {
    const raw = window.localStorage.getItem(key);
    return sanitizeRehearsalMixPrefs(raw ? JSON.parse(raw) : {}, validTrackIds);
  } catch {
    return sanitizeRehearsalMixPrefs({}, validTrackIds);
  }
};

const writePrefs = (key, prefs) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    // Private mode or blocked storage: preferences just don't persist.
  }
};

const trackLabel = (track) => {
  const category = STEM_CATEGORIES[track.category];
  const generic = category && category.trackName === track.name;
  return generic ? category.label.split(' / ')[0] : track.name;
};

const VIEW_PREFS_KEY = 'redil:ensayo-secuencia:view:v1';
const FONT_SIZES = {
  grande: { lyric: 'text-[17px]', chord: 'text-[15px]' },
  enorme: { lyric: 'text-[21px]', chord: 'text-[18px]' },
};
const readViewPrefs = () => {
  try {
    const value = JSON.parse(window.localStorage.getItem(VIEW_PREFS_KEY) || '{}');
    return {
      fontScale: value.fontScale === 'enorme' ? 'enorme' : 'grande',
      tapChordPreview: value.tapChordPreview !== false,
      chordInstrument: value.chordInstrument === 'piano' ? 'piano' : 'guitar',
    };
  } catch {
    return { fontScale: 'grande', tapChordPreview: true, chordInstrument: 'guitar' };
  }
};

// Same chord rendering as ModoEnsayoCompacto (superscript sharps/flats) and,
// when enabled, tap to see the guitar/piano diagram.
function ChordToken({ chord, sizeClass, onPreview }) {
  if (!onPreview) return <ChordDisplay chord={chord} sizeClass={sizeClass} />;
  return (
    <button
      type="button"
      data-chord-preview-trigger="true"
      onClick={(event) => { event.stopPropagation(); onPreview(chord, event.currentTarget); }}
      className="inline-flex rounded-md px-0.5 leading-none hover:bg-brand/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/35"
      aria-label={`Ver acorde ${formatChordAccidentals(chord)}`}
    >
      <ChordDisplay chord={chord} sizeClass={sizeClass} />
    </button>
  );
}

/** One ChordPro line (already transposed): chords above their syllables. */
function SheetLine({ line, fontScale = 'grande', onChordPreview }) {
  const size = FONT_SIZES[fontScale] || FONT_SIZES.grande;
  const chordClass = `font-mono font-bold ${size.chord} text-brand dark:text-brand-light`;
  const segments = parseChordProLine(String(line || '').replace(/\{[^}]+\}/g, ''));
  const hasChord = segments.some((segment) => segment.chord);
  const lyric = segments.map((segment) => segment.lyric || '').join('');

  if (!hasChord) {
    return lyric.trim()
      ? <p className={`whitespace-pre-wrap ${size.lyric} leading-snug text-zinc-800 dark:text-zinc-100`}>{lyric}</p>
      : <div className="h-2" />;
  }
  if (!lyric.trim()) {
    return (
      <p className="flex flex-wrap gap-x-4">
        {segments.filter((segment) => segment.chord).map((segment, index) => (
          <ChordToken key={index} chord={segment.chord} sizeClass={chordClass} onPreview={onChordPreview} />
        ))}
      </p>
    );
  }
  return (
    <p className={`flex flex-wrap items-end ${size.lyric} leading-snug text-zinc-800 dark:text-zinc-100`}>
      {segments.map((segment, index) => (
        <span key={index} className="inline-flex flex-col">
          <span className="min-h-[1.3em] pr-1.5 leading-tight">
            {segment.chord
              ? <ChordToken chord={segment.chord} sizeClass={chordClass} onPreview={onChordPreview} />
              : '\u00a0'}
          </span>
          <span className="whitespace-pre">{segment.lyric || (segment.chord ? ' ' : '')}</span>
        </span>
      ))}
    </p>
  );
}

export default function ModoEnsayoSecuencia({
  song,
  contextTitle = '',
  onGoBack,
  onOpenClassic,
  eventId = '',
  playlistId = '',
  userId = '',
  userRoleCodes = [],
  eventKeySemitones = 0,
  setlistPosition = null,
  onPrevSong = null,
  onNextSong = null,
}) {
  const songId = String(song?.id || '');
  const baseSession = useMemo(() => normalizePersistedLiveDirectorSession(
    song?.multitrackSession || song?.multitrack_session || null,
    { songId: song?.id, songTitle: song?.title },
  ), [song]);

  // Key of this song for this event: transposed copies of the stems, the
  // same ones the Live Director plays. Until they are read the engine waits,
  // so the sequence never starts in the original key and then jumps.
  const [eventKey, setEventKey] = useState(null);
  const [eventKeyReady, setEventKeyReady] = useState(!eventId);
  useEffect(() => {
    if (!eventId || !songId) { setEventKey(null); setEventKeyReady(true); return undefined; }
    let cancelled = false;
    setEventKeyReady(false);
    readEventKey(eventId, songId)
      .then(({ key }) => { if (!cancelled) setEventKey(key || null); })
      .catch(() => { if (!cancelled) setEventKey(null); })
      .finally(() => { if (!cancelled) setEventKeyReady(true); });
    return () => { cancelled = true; };
  }, [eventId, songId]);
  const sequenceInEventKey = isEventKeyFresh(baseSession, eventKey);
  const session = useMemo(() => (
    sequenceInEventKey ? applyEventKey(baseSession, eventKey) : baseSession
  ), [baseSession, eventKey, sequenceInEventKey]);
  const tracks = useMemo(() => classifyRehearsalTracks(session?.tracks || []), [session]);
  const partCandidates = useMemo(() => listPartCandidates(tracks), [tracks]);
  const stemGroups = useMemo(() => listPresentGroups(tracks), [tracks]);
  const storedSectionOffset = Number.isFinite(Number(session?.sectionOffsetSeconds)) ? Number(session.sectionOffsetSeconds) : 0;
  const sectionOffset = storedSectionOffset;
  const sheetSections = Array.isArray(song?.sections) ? song.sections : [];
  const originalUrl = useMemo(() => (
    song?.mp3 ? resolvePreferredAudioUrl(song.mp3, { origin: typeof window !== 'undefined' ? window.location.origin : '' }) : ''
  ), [song?.mp3]);

  // ---- Original mp3 ↔ sequence ----
  // Without REAPER markers the session offset is exactly the mp3 → sequence
  // shift. With REAPER markers that offset belongs to those markers, so the
  // shift to the mp3 (REAPER's count-in) is measured from the audio the first
  // time you open Original: only on this device, never saved to the session.
  const sequenceHasOwnMarkers = Array.isArray(session?.sectionMarkers) && session.sectionMarkers.length > 0;
  const mp3OffsetKey = `${songId}:${session?.updatedAt || ''}:${song?.mp3 || ''}`;
  const [measuredMp3Offset, setMeasuredMp3Offset] = useState(() => (
    typeof window === 'undefined' ? null : readCachedMp3Offset(mp3OffsetKey)
  ));
  useEffect(() => { setMeasuredMp3Offset(readCachedMp3Offset(mp3OffsetKey)); }, [mp3OffsetKey]);
  // Rough value from matching sections of both marker sets, until measured.
  const estimatedMp3Offset = useMemo(() => {
    if (!sequenceHasOwnMarkers) return sectionOffset;
    const songMapped = mapTimelineToSheetSections(buildLiveDirectorSectionsFromMarkers(song?.sectionMarkers) || [], sheetSections, song?.sectionMarkers);
    const sequenceMapped = mapTimelineToSheetSections(buildLiveDirectorSectionsFromMarkers(session.sectionMarkers) || [], sheetSections, session.sectionMarkers);
    const songStartBySheet = new Map();
    songMapped.forEach((entry) => { if (!songStartBySheet.has(entry.sheetIndex)) songStartBySheet.set(entry.sheetIndex, entry.startTime); });
    const seen = new Set();
    const diffs = [];
    sequenceMapped.forEach((entry) => {
      if (seen.has(entry.sheetIndex) || !songStartBySheet.has(entry.sheetIndex)) return;
      seen.add(entry.sheetIndex);
      diffs.push(entry.startTime - songStartBySheet.get(entry.sheetIndex));
    });
    if (diffs.length === 0) return sectionOffset;
    diffs.sort((a, b) => a - b);
    return diffs[Math.floor(diffs.length / 2)];
  }, [sectionOffset, sequenceHasOwnMarkers, session, sheetSections, song?.sectionMarkers]);
  const knownMp3Offset = !sequenceHasOwnMarkers ? sectionOffset : measuredMp3Offset;
  const mp3Offset = Number.isFinite(knownMp3Offset) ? knownMp3Offset : estimatedMp3Offset;
  const mp3MeasureRef = useRef(null);
  const measureMp3Offset = useCallback(async () => {
    if (Number.isFinite(knownMp3Offset)) return knownMp3Offset;
    const origin = window.location.origin;
    const bandUrls = tracks.filter((track) => !track.isControl).slice(0, 3)
      .map((track) => resolveFetchableAudioUrl(track.url, { origin }) || track.url);
    const referenceUrl = resolveFetchableAudioUrl(song?.mp3, { origin }) || originalUrl;
    if (!mp3MeasureRef.current) {
      mp3MeasureRef.current = Promise.race([
        detectSequenceOffsetInBrowser({ referenceUrl, stemUrls: bandUrls }).catch(() => null),
        new Promise((resolve) => { window.setTimeout(() => resolve(null), MP3_OFFSET_TIMEOUT_MS); }),
      ]).finally(() => { mp3MeasureRef.current = null; });
    }
    const detected = await mp3MeasureRef.current;
    if (detected?.confident && Number.isFinite(detected.offsetSeconds)) {
      writeCachedMp3Offset(mp3OffsetKey, detected.offsetSeconds);
      setMeasuredMp3Offset(detected.offsetSeconds);
      return detected.offsetSeconds;
    }
    return estimatedMp3Offset;
  }, [estimatedMp3Offset, knownMp3Offset, mp3OffsetKey, originalUrl, song?.mp3, tracks]);
  const [aligningOriginal, setAligningOriginal] = useState(false);

  // ---- Preferences ----
  const prefsKey = buildRehearsalMixPrefsKey({ userId, songId });
  const [prefs, setPrefs] = useState(() => (
    typeof window === 'undefined'
      ? sanitizeRehearsalMixPrefs({})
      : readPrefs(prefsKey, tracks.map((track) => track.id))
  ));
  useEffect(() => { writePrefs(prefsKey, prefs); }, [prefs, prefsKey]);
  const updatePrefs = useCallback((patch) => setPrefs((current) => ({ ...current, ...patch })), []);
  const isOriginal = prefs.source === 'original' && Boolean(originalUrl);
  const suggestedPartIds = useMemo(() => suggestPartTrackIds(tracks, userRoleCodes), [tracks, userRoleCodes]);
  const partTrackIds = prefs.hasChosenPart ? prefs.partTrackIds : suggestedPartIds;
  const partMode = partTrackIds.length > 0 ? prefs.partMode : 'normal';

  const [settings, setSettings] = useState({ transposeSteps: 0, capoFret: 0 });
  const settingsContext = useMemo(() => ({ userId, eventId, playlistId, songId }), [eventId, playlistId, songId, userId]);
  useEffect(() => {
    let cancelled = false;
    loadRehearsalSongSettings(supabase, settingsContext).then((loaded) => {
      if (!cancelled) setSettings(sanitizeRehearsalSongSettings(loaded));
    });
    return () => { cancelled = true; };
  }, [settingsContext]);
  const changeSettings = useCallback((patch) => {
    setSettings((current) => {
      const next = sanitizeRehearsalSongSettings({ ...current, ...patch });
      void saveRehearsalSongSettings(supabase, settingsContext, next);
      return next;
    });
  }, [settingsContext]);
  // Chords follow what you hear: the event key when the audio playing is the
  // transposed copy (sequence or rehearsal mp3), the original key otherwise.
  const eventSemitones = Number(eventKey?.semitones ?? eventKeySemitones) || 0;
  const audioSemitones = isOriginal
    ? (song?.eventMp3Key ? eventSemitones : 0)
    : (sequenceInEventKey ? Number(eventKey.semitones) || 0 : 0);
  const eventKeyNotApplied = eventSemitones !== 0 && audioSemitones !== eventSemitones;
  const [chordSpelling, setChordSpelling] = useChordSpelling();
  const chordSteps = audioSemitones + settings.transposeSteps - settings.capoFret;
  const displaySections = useMemo(() => sheetSections.map((section) => ({
    ...section,
    lines: (section?.lines || []).map((line) => spellChordProLine(transposeChordProLine(line, chordSteps), chordSpelling)),
  })), [chordSpelling, chordSteps, sheetSections]);

  // ---- View options carried over from the classic rehearsal view ----
  const [viewPrefs, setViewPrefs] = useState(() => (
    typeof window === 'undefined' ? { fontScale: 'grande', tapChordPreview: true, chordInstrument: 'guitar' } : readViewPrefs()
  ));
  useEffect(() => {
    try { window.localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify(viewPrefs)); } catch { /* ignore */ }
  }, [viewPrefs]);
  const updateViewPrefs = useCallback((patch) => setViewPrefs((current) => ({ ...current, ...patch })), []);
  const [showChordLibrary, setShowChordLibrary] = useState(false);
  const [chordPreview, setChordPreview] = useState(null);
  const [chordVariationByKey, setChordVariationByKey] = useState({});
  const chordPreviewRef = useRef(null);
  const chordLibrary = useMemo(() => buildChordLibrary(extractChordTokensFromSections(displaySections)), [displaySections]);
  const openChordPreview = useCallback((chord, triggerNode) => {
    const normalized = normalizeChordSymbol(chord);
    if (!normalized || !parseChordSymbol(normalized)) return;
    const rect = triggerNode?.getBoundingClientRect?.();
    const width = Math.min(272, Math.max(220, window.innerWidth - 20));
    const height = viewPrefs.chordInstrument === 'piano' ? 240 : 286;
    let left = 12;
    let top = 88;
    if (rect) {
      left = Math.min(Math.max(10, rect.left + rect.width / 2 - width / 2), Math.max(10, window.innerWidth - width - 10));
      top = rect.bottom + 8;
      if (top + height > window.innerHeight - 10) top = rect.top - height - 8;
    }
    setChordPreview({ chord: normalized, left, top: Math.max(10, top) });
  }, [viewPrefs.chordInstrument]);
  useEffect(() => {
    if (!chordPreview) return undefined;
    const close = (event) => {
      if (chordPreviewRef.current?.contains(event.target)) return;
      if (event.target?.closest?.('[data-chord-preview-trigger="true"]')) return;
      setChordPreview(null);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [chordPreview]);
  const onChordPreview = viewPrefs.tapChordPreview ? openChordPreview : undefined;

  // The mp3 ↔ sequence offset is the one stored in the session (the same value
  // the Live Director uses and edits in its DESFASE panel). Rehearsal never
  // measures or writes it on its own: that value is shared with the live service.

  // ---- Sequence engine ----
  // Same engine and policy as the Live Director (LiveDirectorView). A jump never
  // resumes until every stem is ready at the target, so they always play
  // together. On desktop a section jump is prepared (precarga) while the
  // current section keeps sounding and every stem switches at its end.
  const useStreaming = useMemo(() => canUseAdvancedStreamingEngine(), []);
  const engine = useMultitrackEngine({ useStreamingEngine: useStreaming });
  const {
    initialize, unlockAudioForUserGesture, play: enginePlay, pause: enginePause, stop: engineStop,
    seekTo: engineSeek, setVolume, setMasterVolume, getCurrentTimeSnapshot,
    isPlaying: engineIsPlaying, isReady: engineReady, currentTime: engineTime,
    duration: engineDuration, loadProgress, diagnostics: engineDiagnostics,
    prepareSectionJump, cancelSectionJump, prefetchSectionStarts, getVirtualGuideAudioGraph,
  } = engine;
  const canPrepareJumps = engineDiagnostics?.engineRoute === 'streaming-worker'
    && supportsPreparedSectionJump(readLiveBrowserCapabilities());
  const [engineError, setEngineError] = useState('');
  const gains = useMemo(() => computeRehearsalTrackGains({
    tracks,
    source: isOriginal ? 'original' : 'secuencia',
    partMode,
    partTrackIds,
    groupLevels: prefs.groupLevels,
    mutedGroups: prefs.mutedGroups,
  }), [isOriginal, partMode, partTrackIds, prefs.groupLevels, prefs.mutedGroups, tracks]);
  const gainsRef = useRef(gains);
  gainsRef.current = gains;

  useEffect(() => {
    if (tracks.length === 0 || !eventKeyReady) return undefined;
    let cancelled = false;
    setEngineError('');
    const timeoutId = window.setTimeout(() => {
      if (!cancelled) setEngineError('La secuencia está tardando en cargar. Revisa tu conexión.');
    }, LOAD_TIMEOUT_MS);
    initialize(tracks.map((track) => ({
      id: track.id,
      name: track.name,
      // Same URL policy as LiveDirectorView: same-origin proxy where R2 CORS
      // is not guaranteed (localhost, previews), direct R2 in production.
      url: resolveFetchableAudioUrl(track.url, { origin: window.location.origin }) || track.url,
      volume: gainsRef.current[track.id] ?? track.baseVolume,
      isMuted: false,
      sourceFileName: track.sourceFileName,
      outputRoute: 'stereo',
    })))
      .then(() => { if (!cancelled) setEngineError(''); })
      .catch((error) => {
        console.warn('[ModoEnsayoSecuencia] No se pudo cargar la secuencia.', error);
        if (!cancelled) setEngineError('No se pudo cargar la secuencia en este dispositivo.');
      })
      .finally(() => window.clearTimeout(timeoutId));
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      engineStop();
    };
  }, [engineStop, eventKeyReady, initialize, tracks]);

  useEffect(() => {
    if (!engineReady) return;
    Object.entries(gains).forEach(([trackId, gain]) => setVolume(trackId, gain));
  }, [engineReady, gains, setVolume]);

  const masterRef = useRef(prefs.master);
  masterRef.current = prefs.master;
  const seekFadeActiveRef = useRef(false);
  useEffect(() => {
    if (engineReady && !seekFadeActiveRef.current) setMasterVolume(prefs.master);
  }, [engineReady, prefs.master, setMasterVolume]);

  const fadeMasterRef = useRef({ frame: 0, value: 1 });
  const fadeMaster = useCallback((target, durationMs) => new Promise((resolve) => {
    const state = fadeMasterRef.current;
    window.cancelAnimationFrame(state.frame);
    const from = state.value;
    const started = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - started) / durationMs);
      const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - ((-2 * progress + 2) ** 3) / 2;
      state.value = from + (target - from) * eased;
      setMasterVolume(state.value);
      if (progress < 1) state.frame = window.requestAnimationFrame(step);
      else resolve();
    };
    state.frame = window.requestAnimationFrame(step);
  }), [setMasterVolume]);

  // ---- Original recording ----
  const audioRef = useRef(null);
  const [audioTime, setAudioTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioPlaying, setAudioPlaying] = useState(false);
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = prefs.master;
  }, [prefs.master]);

  // ---- Unified transport ----
  // Own clock from the engine snapshot (shared telemetry), like
  // LiveDirectorLoopLabView. The hook's React clock stops when the engine
  // pauses for an instant (e.g. while pinning a loop) and doesn't restart.
  const [sequenceClock, setSequenceClock] = useState(0);
  useEffect(() => {
    if (isOriginal || !engineReady) return undefined;
    let frame = 0;
    let last = 0;
    const tick = (now) => {
      if (now - last >= 66) {
        last = now;
        const value = Number(getCurrentTimeSnapshot()) || 0;
        setSequenceClock((previous) => (Math.abs(previous - value) >= 0.02 ? value : previous));
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [engineReady, getCurrentTimeSnapshot, isOriginal]);
  const currentTime = isOriginal ? audioTime : (engineReady ? sequenceClock : engineTime);
  const envelopeDuration = useMemo(() => estimateEnvelopeDuration(tracks), [tracks]);
  const sequenceDuration = Math.max(
    engineDuration || 0,
    envelopeDuration,
    audioDuration > 0 ? audioDuration + mp3Offset : 0,
  );
  const duration = isOriginal ? audioDuration : sequenceDuration;
  const isPlaying = isOriginal ? audioPlaying : engineIsPlaying;
  const transportReady = isOriginal ? Boolean(originalUrl) : engineReady;

  const readTime = useCallback(() => (
    isOriginal ? (audioRef.current?.currentTime || 0) : Number(getCurrentTimeSnapshot()) || 0
  ), [getCurrentTimeSnapshot, isOriginal]);

  const play = useCallback(async () => {
    if (isOriginal) {
      try { await audioRef.current?.play(); } catch (error) { console.warn('[ModoEnsayoSecuencia] audio original', error); }
      return;
    }
    await unlockAudioForUserGesture();
    await enginePlay();
  }, [enginePlay, isOriginal, unlockAudioForUserGesture]);

  const pause = useCallback(() => {
    if (isOriginal) audioRef.current?.pause();
    else enginePause();
  }, [enginePause, isOriginal]);

  const seekInFlightRef = useRef(false);
  const pendingSeekRef = useRef(null);
  const [isSeeking, setIsSeeking] = useState(false);
  // Live Director technique: never pause. Fade the master out, seek
  // while playing (the engine waits until every stem is ready at the target, so
  // they restart together), fade back in. Taps during a seek replace the target.
  const seek = useCallback(async (time) => {
    const safe = Math.max(0, Number(time) || 0);
    if (isOriginal) {
      if (audioRef.current) audioRef.current.currentTime = safe;
      setAudioTime(safe);
      return;
    }
    if (seekInFlightRef.current) {
      pendingSeekRef.current = safe;
      return;
    }
    const wasPlaying = engineIsPlaying;
    seekInFlightRef.current = true;
    setIsSeeking(true);
    try {
      if (wasPlaying) {
        seekFadeActiveRef.current = true;
        fadeMasterRef.current.value = masterRef.current;
        await fadeMaster(0, SEEK_FADE_OUT_MS);
      }
      let target = safe;
      while (target !== null) {
        pendingSeekRef.current = null;
        try {
          await engineSeek(target, { wasPlayingBeforeUiSeek: wasPlaying });
        } catch (error) {
          console.warn('[ModoEnsayoSecuencia] Salto lento o incompleto.', error);
        }
        target = pendingSeekRef.current;
      }
    } finally {
      if (wasPlaying) await fadeMaster(masterRef.current, SEEK_FADE_IN_MS);
      seekFadeActiveRef.current = false;
      seekInFlightRef.current = false;
      setIsSeeking(false);
    }
  }, [engineIsPlaying, engineSeek, fadeMaster, isOriginal]);

  const isPlayingRef = useRef(false);
  isPlayingRef.current = isPlaying;
  // Switching between the sequence and the original keeps the song position.
  const changeSource = useCallback(async (nextSource) => {
    if ((nextSource === 'original') === isOriginal) return;
    // Moving to the other audio drops an armed jump or a repeat.
    const navigation = sectionJumpRef.current;
    if (navigation?.armed || navigation?.repeat) navigation.cancel();
    // First time to the Original: measure the shift while the sequence keeps playing.
    let offset = mp3Offset;
    if (nextSource === 'original' && !Number.isFinite(knownMp3Offset)) {
      setAligningOriginal(true);
      try { offset = await measureMp3Offset(); } finally { setAligningOriginal(false); }
    }
    const wasPlaying = isPlayingRef.current;
    const time = readTime();
    pause();
    updatePrefs({ source: nextSource });
    if (nextSource === 'original') {
      const target = Math.max(0, time - offset);
      if (audioRef.current) {
        audioRef.current.currentTime = target;
        setAudioTime(target);
        if (wasPlaying) audioRef.current.play().catch(() => {});
      }
    } else {
      await engineSeek(Math.max(0, time + offset));
      if (wasPlaying) {
        await unlockAudioForUserGesture();
        await enginePlay();
      }
    }
  }, [engineSeek, enginePlay, isOriginal, knownMp3Offset, measureMp3Offset, mp3Offset, pause, readTime, unlockAudioForUserGesture, updatePrefs]);

  // ---- Sections timeline ----
  const timeline = useMemo(() => {
    // Same rule as the Live Director: markers calibrated in REAPER belong to
    // the multitrack session (sequence time) and win over the song's markers,
    // which were placed on the original mp3. The Original mp3 keeps the song's.
    const songBase = buildLiveDirectorSectionsFromMarkers(song?.sectionMarkers);
    const useSessionMarkers = !isOriginal && Array.isArray(session?.sectionMarkers) && session.sectionMarkers.length > 0;
    const base = isOriginal ? songBase : resolveLiveDirectorSessionSections(session, songBase);
    if (!base) return [];
    const shifted = isOriginal ? base : (applyLiveDirectorSectionOffset(base, sectionOffset) || base);
    const mapped = mapTimelineToSheetSections(shifted, sheetSections, useSessionMarkers ? session.sectionMarkers : song?.sectionMarkers);
    // REAPER marks the second pass of a section as "Repetir", "Repetir 2"…:
    // show it as that section again and keep its chord card highlighted.
    for (let index = 1; index < mapped.length; index += 1) {
      if (!/^repetir(\s+\d+)?$/i.test(String(mapped[index].name || '').trim())) continue;
      const previous = mapped[index - 1];
      const baseName = previous.baseName || previous.name;
      mapped[index] = {
        ...mapped[index],
        cueName: mapped[index].name,
        baseName,
        name: `${baseName} · otra vez`,
        shortLabel: previous.shortLabel,
        sheetIndex: previous.sheetIndex,
      };
    }
    if (duration > 0 && mapped.length > 0) {
      const last = mapped[mapped.length - 1];
      mapped[mapped.length - 1] = { ...last, endTime: Math.max(last.startTime + 0.25, duration) };
    }
    return mapped;
  }, [duration, isOriginal, sectionOffset, session, sheetSections, song?.sectionMarkers]);
  const activeIndex = findTimelineIndexAt(timeline, currentTime);
  const activeEntry = activeIndex >= 0 ? timeline[activeIndex] : null;
  const activeSheetIndex = activeEntry ? activeEntry.sheetIndex : -1;

  // ---- Section jumps and repeat ----
  // Precarga, as in the Live Director: the start of every section is cached in
  // the background, so a jump decodes local audio and every stem is ready at
  // once (the engine never resumes until all of them are).
  const sectionStartsKey = timeline.map((entry) => entry.startTime.toFixed(3)).join(',');
  useEffect(() => {
    if (isOriginal || !engineReady || !sectionStartsKey || engineDiagnostics?.engineRoute !== 'streaming-worker') return;
    prefetchSectionStarts?.(sectionStartsKey.split(',').map(Number));
  }, [engineDiagnostics?.engineRoute, engineReady, isOriginal, prefetchSectionStarts, sectionStartsKey]);

  // "Repetir sección" uses the Live Director's controller: the start of the
  // section is prepared while it plays and every stem goes back together when
  // it ends, without a gap.
  const sectionJump = useLiveDirectorSectionJump({
    enabled: !isOriginal && timeline.length > 0,
    resetKey: `${songId}:${sectionOffset}:${isOriginal ? 'original' : 'secuencia'}`,
    sections: timeline,
    isReady: engineReady,
    isPlaying: engineIsPlaying,
    busy: isSeeking,
    getTime: getCurrentTimeSnapshot,
    onJump: (time) => seek(time).then(() => true),
    prepareJump: canPrepareJumps ? prepareSectionJump : undefined,
    cancelPreparedJump: cancelSectionJump,
  });
  const sectionJumpRef = useRef(sectionJump);
  sectionJumpRef.current = sectionJump;
  const navigationActive = Boolean(sectionJump.armed || sectionJump.repeat);

  // Original recording: a plain loop that seeks back at the end of the section.
  const [loopRegion, setLoopRegion] = useState(null);
  useEffect(() => { setLoopRegion(null); }, [isOriginal, songId]);
  useEffect(() => {
    if (!loopRegion || !isPlaying || !isOriginal) return undefined;
    let frame = 0;
    let seeking = false;
    const tick = () => {
      const time = readTime();
      if (!seeking && time >= loopRegion.end - 0.04) {
        seeking = true;
        Promise.resolve(seek(loopRegion.start)).finally(() => { seeking = false; });
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [isOriginal, isPlaying, loopRegion, readTime, seek]);

  // Any manual move (waveform, section card, source switch) drops an armed
  // jump or a repeat first, like the Live Director.
  const seekOutsideLoop = useCallback(async (time) => {
    const navigation = sectionJumpRef.current;
    if (navigation.armed || navigation.repeat) navigation.cancel();
    if (loopRegion && (time < loopRegion.start - 0.05 || time >= loopRegion.end)) setLoopRegion(null);
    await seek(time);
  }, [loopRegion, seek]);

  const jumpToSection = useCallback((entry) => {
    if (entry) void seekOutsideLoop(entry.startTime);
  }, [seekOutsideLoop]);

  const goToSection = useCallback((direction) => {
    if (timeline.length === 0) {
      void seekOutsideLoop(direction < 0 ? 0 : Math.min(duration, currentTime + 10));
      return;
    }
    const time = readTime();
    const index = findTimelineIndexAt(timeline, time);
    if (direction < 0) {
      // More than 2 s into a section: back to its start first.
      const current = timeline[index];
      const target = current && time - current.startTime > 2 ? current : timeline[Math.max(0, index - 1)];
      if (target) jumpToSection(target); else void seekOutsideLoop(0);
    } else {
      const target = timeline[Math.min(timeline.length - 1, index + 1)];
      if (target && target !== timeline[index]) jumpToSection(target);
    }
  }, [currentTime, duration, jumpToSection, readTime, seekOutsideLoop, timeline]);

  const [pendingRepeat, setPendingRepeat] = useState(null); // null | 'once' | 'hold'
  const toggleLoop = useCallback(async () => {
    if (!isOriginal) {
      // One icon, like a music player: once → until you stop it → off.
      const navigation = sectionJumpRef.current;
      if (pendingRepeat) { setPendingRepeat(pendingRepeat === 'once' ? 'hold' : null); return; }
      if (navigation.repeat) {
        const wasOnce = navigation.repeat.mode === 'once';
        navigation.cancel();
        if (wasOnce) navigation.startRepeat('hold');
        return;
      }
      if (!navigation.startRepeat('once')) {
        // Paused: start playing and repeat once the sequence is running.
        if (!engineIsPlaying && engineReady) setPendingRepeat('once');
      }
      return;
    }
    if (loopRegion) { setLoopRegion(null); return; }
    const region = activeEntry
      ? { start: activeEntry.startTime, end: activeEntry.endTime, label: activeEntry.shortLabel }
      : duration > 0 ? { start: 0, end: duration, label: 'Toda' } : null;
    if (region) setLoopRegion(region);
  }, [activeEntry, duration, engineIsPlaying, engineReady, isOriginal, loopRegion, pendingRepeat]);
  useEffect(() => {
    if (!pendingRepeat) return;
    if (!engineIsPlaying) { void play(); return; }
    setPendingRepeat(null);
    sectionJumpRef.current.startRepeat(pendingRepeat);
  }, [engineIsPlaying, pendingRepeat, play]);

  const repeatMode = isOriginal
    ? (loopRegion ? 'hold' : null)
    : (sectionJump.repeat?.mode || pendingRepeat || null);
  const loopActive = Boolean(repeatMode);
  const navigationLabel = (() => {
    if (isOriginal) return loopRegion ? `Repitiendo ${activeEntry?.name || loopRegion.label}` : '';
    const { armed, repeat, preparation } = sectionJump;
    if (armed) return preparation === 'preparing' ? `Preparando ${armed.section.name}…` : `→ ${armed.section.name} al terminar la sección`;
    if (repeat) return repeat.mode === 'once' ? `${repeat.section.name}: una vez más` : `Repitiendo ${repeat.section.name} · ∞`;
    return pendingRepeat ? 'Preparando repetición…' : '';
  })();


  // ---- Digital click and guide ----
  // Only when the song has no Click or Guide stem (as in the Live Director):
  // the digital metronome on the song's grid and the voice that announces each
  // section with its count. They follow the Click / Guía faders of the mixer.
  // The streaming engine reports its route only once it plays; its virtual
  // audio graph exists from load, so the channels show up right away.
  const streamingRoute = useStreaming && (!engineDiagnostics || engineDiagnostics.engineMode === 'streaming');
  const reaperTiming = session?.reaperTiming || null;
  const clickBpm = Number(reaperTiming?.tempo) || Number(song?.bpm) || 0;
  const meterMatch = /^(\d{1,2})\/(\d{1,2})$/.exec(String(reaperTiming?.meter || song?.meter || song?.compas || '').trim());
  const meterNumerator = meterMatch ? Number(meterMatch[1]) : 4;
  const meterDenominator = meterMatch ? Number(meterMatch[2]) : 4;
  const songMeter = useMemo(() => ({ numerator: meterNumerator, denominator: meterDenominator }), [meterDenominator, meterNumerator]);
  const digitalClickWanted = !isOriginal && streamingRoute && clickBpm > 0
    && !tracks.some((track) => track.category === 'click' || track.category === 'cues');
  const digitalGuideWanted = !isOriginal && streamingRoute && timeline.length > 0
    && !tracks.some((track) => track.category === 'guide' || track.category === 'cues');
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const digitalLevel = useCallback((groupId, base) => {
    const current = prefsRef.current;
    if (current.mutedGroups?.[groupId]) return 0;
    const level = Number(current.groupLevels?.[groupId] ?? 1);
    // The engine's master gain already applies the Master fader.
    return Math.max(0, Math.min(2, base * (Number.isFinite(level) ? level : 1)));
  }, []);
  const clickOriginSeconds = Number.isFinite(Number(reaperTiming?.unoSeconds))
    ? Number(reaperTiming.unoSeconds)
    : (timeline[0]?.startTime ?? 0);
  const clickPlayingRef = useRef(false);
  clickPlayingRef.current = engineIsPlaying && !isSeeking;
  useEffect(() => {
    if (!digitalClickWanted || !engineReady) return undefined;
    const graph = getVirtualGuideAudioGraph?.(() => ({ gain: digitalLevel('click', 0.5), route: 'stereo' }));
    if (!graph) return undefined;
    const player = new VirtualClickPlayer(graph);
    let timer = 0;
    let disposed = false;
    void player.load().then(() => {
      if (disposed) return;
      player.configure({
        bpm: clickBpm,
        originSeconds: Math.max(0, clickOriginSeconds),
        numerator: meterNumerator,
        denominator: meterDenominator,
        accentConfirmed: Boolean(reaperTiming),
        levels: [0.65, 0, 0.7, 0.35, 0],
      });
      timer = window.setInterval(() => player.update(getCurrentTimeSnapshot(), clickPlayingRef.current), 25);
    }).catch((error) => console.warn('[ModoEnsayoSecuencia] Click digital no disponible.', error));
    return () => { disposed = true; window.clearInterval(timer); player.dispose(); };
  }, [clickBpm, clickOriginSeconds, digitalClickWanted, digitalLevel, engineReady, getCurrentTimeSnapshot, getVirtualGuideAudioGraph, meterDenominator, meterNumerator, reaperTiming]);

  const guideCuePlan = useCallback((time) => {
    const plan = sectionJumpRef.current?.getCuePlan?.(time);
    if (plan && /^(jump|repeat):/.test(plan.id)) return plan;
    const cue = (entry) => entry.cueName || entry.name;
    const first = timeline[0];
    if (first && time < first.startTime) return { id: `entry:${first.id}`, boundary: first.startTime, name: cue(first), countIn: true };
    const next = timeline[findTimelineIndexAt(timeline, time) + 1];
    return next && next.startTime > time ? { id: `next:${next.id}`, boundary: next.startTime, name: cue(next), countIn: true } : null;
  }, [timeline]);
  useLiveDirectorDynamicGuide({
    wanted: digitalGuideWanted,
    ready: engineReady,
    playing: engineIsPlaying,
    busy: isSeeking,
    resetKey: `${songId}:${mp3OffsetKey}`,
    bpm: clickBpm || 120,
    meter: songMeter,
    getGraph: () => getVirtualGuideAudioGraph?.(() => ({ gain: digitalLevel('guia', 0.85), route: 'stereo' })) ?? null,
    getTime: getCurrentTimeSnapshot,
    getPlan: guideCuePlan,
  });

  const mixerGroups = useMemo(() => {
    const extra = [];
    if (digitalClickWanted && !stemGroups.some((group) => group.id === 'click')) extra.push({ id: 'click', label: 'Click (digital)' });
    if (digitalGuideWanted && !stemGroups.some((group) => group.id === 'guia')) extra.push({ id: 'guia', label: 'Guía (digital)' });
    return [...extra, ...stemGroups];
  }, [digitalClickWanted, digitalGuideWanted, stemGroups]);

  // ---- Screen + auto-follow ----
  useEffect(() => {
    screenWakeLockService.setRequested('modo-ensayo-secuencia', true);
    return () => screenWakeLockService.setRequested('modo-ensayo-secuencia', false);
  }, []);
  const sheetRef = useRef(null);
  const sectionRefs = useRef([]);
  useEffect(() => {
    if (!isPlaying || activeSheetIndex < 0) return;
    const container = sheetRef.current;
    const node = sectionRefs.current[activeSheetIndex];
    if (!container || !node) return;
    container.scrollTo({ top: Math.max(0, node.offsetTop - 12), behavior: 'smooth' });
  }, [activeSheetIndex, isPlaying]);

  const waveform = useMemo(() => (
    isOriginal ? [] : buildCombinedWaveform(tracks, sequenceDuration, WAVEFORM_BARS)
  ), [isOriginal, sequenceDuration, tracks]);

  // ---- Panels ----
  const [panel, setPanel] = useState(null); // 'mix' | 'part' | 'tone' | null
  const togglePanel = (name) => setPanel((current) => (current === name ? null : name));
  // Subir / Aislar / Mutear: pressing the active one goes back to the full mix.
  const handlePartMode = (nextPartMode) => {
    if (partTrackIds.length === 0) {
      updatePrefs({ partMode: nextPartMode });
      setPanel('part');
      return;
    }
    if (isOriginal) void changeSource('secuencia');
    updatePrefs({ partMode: partMode === nextPartMode ? 'normal' : nextPartMode });
  };
  const togglePart = (trackId) => {
    const current = new Set(partTrackIds);
    if (current.has(trackId)) current.delete(trackId);
    else current.add(trackId);
    updatePrefs({ partTrackIds: Array.from(current), hasChosenPart: true, singer: false });
  };
  // Singers: "Voz" is always offered. With vocal stems it is those stems (raise,
  // isolate, mute them); without them the sequence already plays without a
  // voice to sing over, and the melody is in the Original recording.
  const vocalTracks = partCandidates.filter((track) => track.groupId === 'voces');
  const instrumentCandidates = partCandidates.filter((track) => track.groupId !== 'voces');
  const singsByRole = (Array.isArray(userRoleCodes) ? userRoleCodes : [])
    .some((code) => /^(voz|coro|cantante|vocal)/i.test(String(code || '')));
  const singerWithoutStems = vocalTracks.length === 0 && (prefs.hasChosenPart
    ? Boolean(prefs.singer)
    : singsByRole && suggestedPartIds.length === 0);
  const voiceSelected = vocalTracks.length > 0
    ? vocalTracks.every((track) => partTrackIds.includes(track.id))
    : singerWithoutStems;
  const toggleVoice = () => {
    if (vocalTracks.length > 0) {
      const current = new Set(partTrackIds);
      vocalTracks.forEach((track) => (voiceSelected ? current.delete(track.id) : current.add(track.id)));
      updatePrefs({ partTrackIds: Array.from(current), hasChosenPart: true, singer: false });
      return;
    }
    updatePrefs({ singer: !singerWithoutStems, partTrackIds: [], partMode: 'normal', hasChosenPart: true });
  };
  const partLabel = singerWithoutStems
    ? 'Voz'
    : partTrackIds.length
      ? [
        ...(voiceSelected ? ['Voz'] : []),
        ...partCandidates.filter((track) => partTrackIds.includes(track.id) && !(voiceSelected && track.groupId === 'voces')).map(trackLabel),
      ].join(', ')
      : 'Elige tu parte';
  const hint = isOriginal ? 'La grabación original de la canción.' : REHEARSAL_PART_MODE_HINTS[partMode];

  const handleTogglePlay = () => {
    if (isPlaying) pause();
    else void play();
  };
  const handleScrub = (event) => {
    if (!(duration > 0)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    void seekOutsideLoop(ratio * duration);
  };
  const handleGoBack = () => {
    pause();
    onGoBack?.();
  };

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const soundingKey = transposeKeyLabel(song?.key, audioSemitones + settings.transposeSteps);
  const showKey = (key) => formatChordAccidentals(spellChord(key, chordSpelling));
  const keyLabel = showKey(soundingKey);
  const shapeKeyLabel = showKey(transposeChordToken(soundingKey, -settings.capoFret) || soundingKey);
  const suggestedCapo = suggestCapoForKey(soundingKey);
  const suggestedShapeLabel = showKey(transposeChordToken(soundingKey, -suggestedCapo) || soundingKey);
  const loadingLabel = !isOriginal && !engineReady
    ? (loadProgress && loadProgress.total > 0
      ? `Cargando secuencia ${loadProgress.loaded}/${loadProgress.total}`
      : 'Cargando secuencia…')
    : '';

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      {originalUrl && (
        <audio
          ref={audioRef}
          src={originalUrl}
          preload="metadata"
          onTimeUpdate={(event) => setAudioTime(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => setAudioDuration(event.currentTarget.duration || 0)}
          onPlay={() => setAudioPlaying(true)}
          onPause={() => setAudioPlaying(false)}
          onEnded={() => setAudioPlaying(false)}
        />
      )}

      <header
        className="flex items-center gap-1.5 border-b border-zinc-200/70 pb-2 dark:border-white/8"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)',
          paddingLeft: 'calc(env(safe-area-inset-left) + 0.75rem)',
          paddingRight: 'calc(env(safe-area-inset-right) + 0.75rem)',
        }}
      >
        <button type="button" onClick={handleGoBack} aria-label="Volver" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-zinc-700 dark:text-zinc-200">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold leading-tight">{song?.title}</p>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {[setlistPosition ? `${setlistPosition.index + 1} de ${setlistPosition.total}` : '', song?.bpm ? `${song.bpm} BPM` : '', contextTitle]
              .filter(Boolean).join(' · ')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => togglePanel('tone')}
          aria-expanded={panel === 'tone'}
          aria-label="Tono y capo"
          className={`shrink-0 rounded-xl border px-2 py-1 text-center leading-tight ${panel === 'tone' ? 'border-brand bg-brand/10' : 'border-zinc-200 dark:border-white/10'}`}
        >
          <span className="block text-sm font-bold">{keyLabel}</span>
          <span className="block text-[9px] uppercase tracking-wide text-zinc-500">{settings.capoFret ? `Capo ${settings.capoFret}` : 'Tono'}</span>
        </button>
        <button
          type="button"
          onClick={() => togglePanel('options')}
          aria-label="Opciones"
          aria-expanded={panel === 'options'}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${panel === 'options' ? 'bg-brand/10 text-brand' : 'text-zinc-500'}`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
        {(onPrevSong || onNextSong) && (
          <div className="flex shrink-0">
            <button type="button" onClick={() => { pause(); onPrevSong?.(); }} disabled={!onPrevSong} aria-label="Canción anterior" className="flex h-8 w-7 items-center justify-center rounded-lg text-zinc-600 disabled:opacity-25 dark:text-zinc-300">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => { pause(); onNextSong?.(); }} disabled={!onNextSong} aria-label="Canción siguiente" className="flex h-8 w-7 items-center justify-center rounded-lg text-zinc-600 disabled:opacity-25 dark:text-zinc-300">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </header>

      <main ref={sheetRef} className="relative flex-1 overflow-y-auto px-4 pb-6 pt-3">
        {displaySections.length === 0 && (
          <p className="mt-10 text-center text-sm text-zinc-500">Esta canción todavía no tiene acordes cargados.</p>
        )}
        {displaySections.map((section, sectionIndex) => {
          const active = sectionIndex === activeSheetIndex;
          const jumpTarget = timeline.find((entry) => entry.sheetIndex === sectionIndex);
          return (
            <section
              key={`${sectionIndex}-${section?.name}`}
              ref={(node) => { sectionRefs.current[sectionIndex] = node; }}
              className={`mb-3 rounded-2xl border px-4 py-3 transition-colors ${active
                ? 'border-brand bg-brand/5 dark:bg-brand/10'
                : 'border-zinc-200/80 dark:border-white/8'}`}
            >
              <button
                type="button"
                disabled={!jumpTarget}
                onClick={() => jumpToSection(jumpTarget)}
                className="mb-1.5 flex w-full items-center gap-2 text-left"
              >
                <span className={`text-xs font-bold uppercase tracking-widest ${active ? 'text-brand dark:text-brand-light' : 'text-zinc-500 dark:text-zinc-400'}`}>
                  {section?.name || `Sección ${sectionIndex + 1}`}
                </span>
                {section?.note && String(section.note).trim().toLowerCase() !== String(section?.name || '').trim().toLowerCase() && (
                  <span className="truncate text-xs text-zinc-400">{section.note}</span>
                )}
              </button>
              <div className="space-y-1.5">
                {(section?.lines || []).map((line, lineIndex) => (
                  <SheetLine key={lineIndex} line={line} fontScale={viewPrefs.fontScale} onChordPreview={onChordPreview} />
                ))}
              </div>
            </section>
          );
        })}
      </main>

      <footer
        className="border-t border-zinc-200/70 bg-white dark:border-white/8 dark:bg-zinc-950"
        style={{
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)',
          paddingLeft: 'calc(env(safe-area-inset-left) + 0.75rem)',
          paddingRight: 'calc(env(safe-area-inset-right) + 0.75rem)',
        }}
      >
        {panel === 'mix' && (
          <div className="mt-3 space-y-2.5 rounded-2xl border border-zinc-200 p-3 dark:border-white/10">
            {mixerGroups.map((group) => {
              const muted = Boolean(prefs.mutedGroups[group.id]);
              const level = prefs.groupLevels[group.id] ?? 1;
              return (
                <div key={group.id} className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => updatePrefs({ mutedGroups: { ...prefs.mutedGroups, [group.id]: !muted } })}
                    aria-label={muted ? `Activar ${group.label}` : `Silenciar ${group.label}`}
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${muted ? 'border-red-300 bg-red-50 text-red-600 dark:border-red-500/40 dark:bg-red-500/10' : 'border-zinc-200 dark:border-white/10'}`}
                  >
                    {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  </button>
                  <span className="w-20 shrink-0 text-sm">{group.label}</span>
                  <input
                    type="range"
                    min="0"
                    max={MAX_GROUP_LEVEL}
                    step="0.05"
                    value={level}
                    onChange={(event) => updatePrefs({ groupLevels: { ...prefs.groupLevels, [group.id]: Number(event.target.value) } })}
                    className="flex-1 accent-brand"
                    aria-label={`Volumen ${group.label}`}
                  />
                  <span className="w-10 text-right text-xs tabular-nums text-zinc-500">{Math.round(level * 100)}%</span>
                </div>
              );
            })}
            <div className="flex items-center gap-3 border-t border-zinc-200 pt-2.5 dark:border-white/10">
              <span className="w-[7.75rem] shrink-0 text-sm font-semibold">Master</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={prefs.master}
                onChange={(event) => updatePrefs({ master: Number(event.target.value) })}
                className="flex-1 accent-brand"
                aria-label="Volumen master"
              />
              <span className="w-10 text-right text-xs tabular-nums text-zinc-500">{Math.round(prefs.master * 100)}%</span>
            </div>
            <button type="button" onClick={() => updatePrefs({ groupLevels: {}, mutedGroups: {}, master: 1 })} className="text-xs text-zinc-500 underline">
              Restablecer mezcla
            </button>
          </div>
        )}

        {panel === 'part' && (
          <div className="mt-3 rounded-2xl border border-zinc-200 p-3 dark:border-white/10">
            <p className="mb-2 text-sm font-semibold">¿Qué tocas o cantas?</p>
            {!prefs.hasChosenPart && (suggestedPartIds.length > 0 || singerWithoutStems) && (
              <p className="mb-2 text-xs text-zinc-500">Tomado de tu asignación en este evento. Puedes cambiarlo.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={toggleVoice}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm ${voiceSelected ? 'border-brand bg-brand text-white' : 'border-zinc-200 dark:border-white/10'}`}
              >
                <Mic2 className="h-3.5 w-3.5" /> Voz
              </button>
              {instrumentCandidates.map((track) => {
                const selected = partTrackIds.includes(track.id);
                return (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => togglePart(track.id)}
                    className={`rounded-full border px-3 py-1.5 text-sm ${selected ? 'border-brand bg-brand text-white' : 'border-zinc-200 dark:border-white/10'}`}
                  >
                    {trackLabel(track)}
                  </button>
                );
              })}
            </div>
            {singerWithoutStems && (
              <p className="mt-2 text-xs text-zinc-500">
                Esta secuencia no trae pistas de voz: ya suena sin voz para que cantes encima. Para escuchar la melodía, toca <b>Original</b>.
              </p>
            )}
          </div>
        )}

        {panel === 'tone' && (
          <div className="mt-3 space-y-3 rounded-2xl border border-zinc-200 p-3 dark:border-white/10">
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-500">Tonalidad</p>
              <div className="grid grid-cols-7 gap-1">
                {TRANSPOSE_STEPS.map((steps) => {
                  const selected = settings.transposeSteps === steps;
                  return (
                    <button
                      key={steps}
                      type="button"
                      onClick={() => changeSettings({ transposeSteps: steps })}
                      aria-pressed={selected}
                      className={`rounded-lg px-1 py-1.5 text-xs font-semibold ${selected
                        ? 'bg-brand text-white'
                        : steps === 0 ? 'border border-brand/40 text-brand dark:text-brand-light' : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200'}`}
                    >
                      {showKey(transposeKeyLabel(song?.key, audioSemitones + steps))}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-500">Capo</p>
              <div className="grid grid-cols-8 gap-1">
                {CAPO_FRETS.map((fret) => {
                  const selected = settings.capoFret === fret;
                  const suggested = fret === suggestedCapo && fret !== settings.capoFret;
                  return (
                    <button
                      key={fret}
                      type="button"
                      onClick={() => changeSettings({ capoFret: fret })}
                      aria-pressed={selected}
                      className={`relative rounded-lg py-1.5 text-xs font-semibold ${selected ? 'bg-brand text-white' : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200'}`}
                    >
                      {fret === 0 ? 'No' : fret}
                      {suggested && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-500" aria-label="Sugerido" />}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-zinc-500">
                {settings.capoFret > 0
                  ? `Tocas con formas de ${shapeKeyLabel} · suena en ${keyLabel}.`
                  : suggestedCapo > 0
                    ? `Sugerido: capo ${suggestedCapo} (formas de ${suggestedShapeLabel}).`
                    : 'Sin capo.'}
              </p>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-500">Ver acordes en</p>
              <div role="radiogroup" aria-label="Ver acordes en" className="grid grid-cols-3 gap-1">
                {CHORD_SPELLINGS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={chordSpelling === option.id}
                    aria-label={option.id === 'sharp' ? 'Sostenidos' : option.id === 'flat' ? 'Bemoles' : 'Como está escrito'}
                    onClick={() => setChordSpelling(option.id)}
                    className={`rounded-lg py-1.5 text-xs font-semibold ${chordSpelling === option.id ? 'bg-brand text-white' : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            {eventKeyNotApplied && (
              <p className="text-xs text-amber-600 dark:text-amber-300">
                El evento está en {showKey(transposeKeyLabel(song?.key, eventSemitones))}, pero {isOriginal ? 'este mp3' : 'esta secuencia'} todavía suena en el tono original: los acordes siguen lo que escuchas.
              </p>
            )}
            <p className="text-xs text-zinc-500">Cambia los acordes que ves; el audio no cambia. Se guarda para ti en este evento.</p>
          </div>
        )}

        {panel === 'options' && (
          <div className="mt-3 space-y-3 rounded-2xl border border-zinc-200 p-3 dark:border-white/10">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">Tamaño de letra</span>
              <div className="flex rounded-xl bg-zinc-100 p-0.5 text-xs font-semibold dark:bg-zinc-900">
                {[['grande', 'Grande'], ['enorme', 'Enorme']].map(([value, label]) => (
                  <button key={value} type="button" onClick={() => updateViewPrefs({ fontScale: value })} aria-pressed={viewPrefs.fontScale === value}
                    className={`rounded-lg px-3 py-1 ${viewPrefs.fontScale === value ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">Ver acorde al tocarlo</span>
              <div className="flex items-center gap-2">
                <div className="flex rounded-xl bg-zinc-100 p-0.5 text-xs font-semibold dark:bg-zinc-900">
                  {[['guitar', 'Guitarra'], ['piano', 'Piano']].map(([value, label]) => (
                    <button key={value} type="button" onClick={() => updateViewPrefs({ chordInstrument: value })} aria-pressed={viewPrefs.chordInstrument === value}
                      className={`rounded-lg px-2.5 py-1 ${viewPrefs.chordInstrument === value ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <button type="button" role="switch" aria-checked={viewPrefs.tapChordPreview} aria-label="Ver acorde al tocarlo"
                  onClick={() => updateViewPrefs({ tapChordPreview: !viewPrefs.tapChordPreview })}
                  className={`relative h-6 w-11 rounded-full transition-colors ${viewPrefs.tapChordPreview ? 'bg-brand' : 'bg-zinc-300 dark:bg-zinc-700'}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${viewPrefs.tapChordPreview ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => { setPanel(null); setShowChordLibrary(true); }} className="rounded-xl border border-zinc-200 px-3 py-1.5 text-xs font-semibold dark:border-white/10">
                Ver todos los acordes
              </button>
              {onOpenClassic && (
                <button type="button" onClick={() => { pause(); onOpenClassic(); }} className="rounded-xl border border-zinc-200 px-3 py-1.5 text-xs font-semibold dark:border-white/10">
                  Abrir vista clásica
                </button>
              )}
            </div>
          </div>
        )}

        {/* Time · current section · remaining, over a bar made of the sections. */}
        <div className="mt-2 flex items-baseline justify-between gap-2 text-[11px] tabular-nums text-zinc-500">
          <span className="w-10">{formatTime(currentTime)}</span>
          <span className={`min-w-0 truncate text-center font-semibold ${navigationLabel ? 'text-brand dark:text-brand-light' : 'text-zinc-700 dark:text-zinc-200'}`}>
            {aligningOriginal
              ? 'Ajustando el Original a la secuencia…'
              : isSeeking
              ? 'Preparando pistas…'
              : navigationLabel
                ? (navigationActive
                  ? <button type="button" onClick={() => sectionJump.cancel()} className="truncate" title="Toca para cancelar">{navigationLabel} · ✕</button>
                  : navigationLabel)
                : activeEntry
                  ? activeEntry.name
                  : (loadingLabel || (timeline.length > 0 && currentTime < timeline[0].startTime ? 'Entrada' : isOriginal ? 'Canción original' : ' '))}
          </span>
          <span className="w-10 text-right">-{formatTime(Math.max(0, duration - currentTime))}</span>
        </div>
        <div
          className="relative mt-1.5 cursor-pointer py-1.5"
          onClick={handleScrub}
          role="slider"
          aria-label="Posición de la canción"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(currentTime)}
          tabIndex={0}
        >
          {waveform.length > 0 && (
            <div className="mb-1 flex h-6 items-end gap-px">
              {waveform.map((value, index) => (
                <span key={index} className={`flex-1 rounded-sm ${index / waveform.length <= progress ? 'bg-zinc-800 dark:bg-zinc-200' : 'bg-zinc-200 dark:bg-zinc-800'}`}
                  style={{ height: `${Math.max(10, value * 100)}%` }} />
              ))}
            </div>
          )}
          <div className="relative h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            {duration > 0 && timeline.map((entry, index) => (
              <span
                key={entry.id}
                className="absolute top-0 h-full"
                title={entry.name}
                style={{
                  left: `${(entry.startTime / duration) * 100}%`,
                  width: `calc(${(Math.max(0, entry.endTime - entry.startTime) / duration) * 100}% - 2px)`,
                  background: index === activeIndex ? entry.accent : entry.border,
                }}
              />
            ))}
            <span className="absolute inset-y-0 left-0 bg-zinc-950/35 dark:bg-white/35" style={{ width: `${progress * 100}%` }} />
          </div>
          <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-950 shadow dark:bg-white" style={{ left: `${progress * 100}%`, marginTop: waveform.length > 0 ? '14px' : 0 }} />
        </div>

        <div className="mt-1 flex items-center justify-between px-1">
          <button type="button" onClick={() => void toggleLoop()} aria-busy={sectionJump.preparation === 'preparing' || Boolean(pendingRepeat) || undefined}
            aria-label={repeatMode === 'once' ? 'Repetir sección: una vez (toca para repetir siempre)' : repeatMode === 'hold' ? 'Repetir sección: siempre (toca para apagar)' : 'Repetir sección'}
            title={repeatMode === 'once' ? 'Una vez · toca para repetir siempre' : repeatMode === 'hold' ? 'Siempre · toca para apagar' : 'Repetir esta sección'}
            aria-pressed={loopActive}
            className={`relative flex h-10 w-10 items-center justify-center rounded-full ${loopActive ? 'bg-brand/10 text-brand dark:text-brand-light' : 'text-zinc-500'}`}>
            {repeatMode === 'once' ? <Repeat1 className="h-5 w-5" /> : <Repeat className="h-5 w-5" />}
            {repeatMode === 'hold' && <span className="absolute -right-0.5 top-0.5 text-[11px] font-black leading-none">∞</span>}
          </button>
          <button type="button" onClick={() => goToSection(-1)} aria-label="Sección anterior" className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-800 dark:text-zinc-100">
            <SkipBack className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={handleTogglePlay}
            aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-950 text-white dark:bg-white dark:text-zinc-950"
          >
            {(!transportReady && !engineError) || isSeeking
              ? <LoaderCircle className="h-6 w-6 animate-spin" />
              : isPlaying ? <Pause className="h-6 w-6" /> : <Play className="ml-0.5 h-6 w-6" />}
          </button>
          <button type="button" onClick={() => goToSection(1)} aria-label="Sección siguiente" className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-800 dark:text-zinc-100">
            <SkipForward className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => togglePanel('mix')} aria-label="Mezcla" aria-pressed={panel === 'mix'}
            className={`flex h-10 w-10 items-center justify-center rounded-full ${panel === 'mix' ? 'bg-brand/10 text-brand dark:text-brand-light' : 'text-zinc-500'}`}>
            <SlidersHorizontal className="h-5 w-5" />
          </button>
        </div>

        {engineError && !isOriginal && (
          <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
            {engineError}{originalUrl ? ' Puedes ensayar con la canción original.' : ''}
          </p>
        )}

        {/* One practice strip: my instrument + what to do with it, or the original recording. */}
        <div className="mt-1.5 flex items-center gap-1 rounded-2xl bg-zinc-100 p-1 dark:bg-zinc-900" title={hint}>
          <button
            type="button"
            onClick={() => togglePanel('part')}
            aria-expanded={panel === 'part'}
            className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-left text-xs font-semibold ${partTrackIds.length === 0 && !singerWithoutStems ? 'text-brand dark:text-brand-light' : 'text-zinc-700 dark:text-zinc-200'}`}
          >
            {singerWithoutStems ? <Mic2 className="h-3.5 w-3.5 shrink-0" /> : <User className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">{partLabel}</span>
            {singerWithoutStems && <span className="hidden truncate font-normal text-zinc-500 min-[420px]:inline">· canta encima</span>}
            {panel === 'part' ? <ChevronDown className="h-3 w-3 shrink-0 opacity-60" /> : <ChevronUp className="h-3 w-3 shrink-0 opacity-60" />}
          </button>
          {!singerWithoutStems && [
            { id: 'aumentada', label: 'Subir', Icon: TrendingUp },
            { id: 'aislada', label: 'Aislar', Icon: Headphones },
            { id: 'muteada', label: 'Mutear', Icon: VolumeX },
          ].map(({ id, label, Icon }) => {
            const active = !isOriginal && partMode === id;
            return (
              <button key={id} type="button" onClick={() => handlePartMode(id)} aria-pressed={active} aria-label={label}
                className={`flex shrink-0 items-center gap-1 rounded-xl px-2 py-1.5 text-[11px] font-semibold ${active ? 'bg-brand text-white shadow-sm' : 'text-zinc-500 dark:text-zinc-400'}`}>
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden min-[380px]:inline">{label}</span>
              </button>
            );
          })}
          {originalUrl && (
            <button type="button" onClick={() => void changeSource(isOriginal ? 'secuencia' : 'original')} disabled={aligningOriginal} aria-busy={aligningOriginal || undefined} aria-pressed={isOriginal} aria-label="Original"
              className={`flex shrink-0 items-center gap-1 rounded-xl px-2 py-1.5 text-[11px] font-semibold ${isOriginal ? 'bg-brand text-white shadow-sm' : 'text-zinc-500 dark:text-zinc-400'}`}>
              <Disc3 className="h-3.5 w-3.5" />
              <span className="hidden min-[380px]:inline">Original</span>
            </button>
          )}
        </div>
      </footer>

      {showChordLibrary && (
        <ChordLibraryModal
          chords={chordLibrary}
          instrument={viewPrefs.chordInstrument}
          onInstrumentChange={(value) => updateViewPrefs({ chordInstrument: value })}
          variationByChord={chordVariationByKey}
          onVariationChange={(key, index) => setChordVariationByKey((current) => ({ ...current, [key]: index }))}
          onClose={() => setShowChordLibrary(false)}
        />
      )}
      {chordPreview && (
        <ChordPreviewPopover
          preview={chordPreview}
          instrument={viewPrefs.chordInstrument}
          variationByChord={chordVariationByKey}
          onVariationChange={(key, index) => setChordVariationByKey((current) => ({ ...current, [key]: index }))}
          previewRef={chordPreviewRef}
        />
      )}
    </div>
  );
}
