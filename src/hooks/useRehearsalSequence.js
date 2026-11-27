import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolveFetchableAudioUrl } from '../lib/audio-playback.js';
import {
  buildLiveDirectorSectionsFromMarkers,
  normalizePersistedLiveDirectorSession,
} from '../utils/liveDirectorSongSession';
import {
  buildRehearsalMixPrefsKey,
  classifyRehearsalTracks,
  computeRehearsalTrackGains,
  estimateEnvelopeDuration,
  hasFullRehearsalSequence,
  listPartCandidates,
  listPresentGroups,
  mapTimelineToSheetSections,
  sanitizeRehearsalMixPrefs,
  suggestPartTrackIds,
} from '../utils/rehearsalSequenceMix.js';
import { STEM_CATEGORIES } from '../utils/stemCategories';
import { applyEventKey, isEventKeyFresh, readEventKey } from '../utils/liveDirectorEventKey';
import { detectSequenceOffsetInBrowser } from '../utils/sequenceOffsetDetection.js';
import { supportsPreparedSectionJump } from '../utils/liveDirectorEnginePolicy';
import { readLiveBrowserCapabilities } from '../utils/liveDiagnostics';
import { VirtualClickPlayer } from '../services/VirtualClickPlayer';
import { useLiveDirectorDynamicGuide } from './useLiveDirectorDynamicGuide';
import { useLiveDirectorSectionJump } from './useLiveDirectorSectionJump';

// Full multitrack sequence inside the classic rehearsal view: everything the
// sequence player needs beyond the transport the view already has. The view
// passes its own multitrack engine (the Live Director engine), its section
// timeline in sequence time and its seek; this hook adds the stem mix, your
// part, the event key, the Original ↔ sequence shift, the gapless section
// repeat, section prefetch and the digital click/guide.

const MP3_OFFSET_TIMEOUT_MS = 15000;
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
  try { window.localStorage.setItem(key, JSON.stringify(prefs)); } catch { /* not persisted */ }
};

export const readSongSequenceSession = (song) => normalizePersistedLiveDirectorSession(
  song?.multitrackSession || song?.multitrack_session || null,
  { songId: song?.id, songTitle: song?.title },
);

/** True when the song has a real backing sequence (see hasFullRehearsalSequence). */
export const songHasRehearsalSequence = (song) => (
  hasFullRehearsalSequence(classifyRehearsalTracks(readSongSequenceSession(song)?.tracks || []))
);

/** Last audio this user chose for the song on this device: 'secuencia' (default) or 'original'. */
export const readStoredRehearsalSource = (userId, songId) => {
  try {
    const raw = window.localStorage.getItem(buildRehearsalMixPrefsKey({ userId, songId }));
    return raw && JSON.parse(raw)?.source === 'original' ? 'original' : 'secuencia';
  } catch { return 'secuencia'; }
};

export const FULL_SEQUENCE_SOURCE_ID = 'full-sequence';

export const rehearsalTrackLabel = (track) => {
  const category = STEM_CATEGORIES[track.category];
  const generic = category && category.trackName === track.name;
  return generic ? category.label.split(' / ')[0] : track.name;
};

export function useRehearsalSequence({
  enabled,
  song,
  eventId = '',
  userId = '',
  userRoleCodes = [],
  eventKeySemitones = 0,
  sheetSections = [],
  engine,
  isOriginal = false,
  sections = [],
  bpm = 0,
  isSeeking = false,
  onJump,
}) {
  const songId = String(song?.id || '');
  const baseSession = useMemo(() => (enabled ? readSongSequenceSession(song) : null), [enabled, song]);

  // ---- Event key: transposed copies of the stems, as in the Live Director ----
  const [eventKey, setEventKey] = useState(null);
  const [eventKeyReady, setEventKeyReady] = useState(!eventId);
  useEffect(() => {
    if (!enabled || !eventId || !songId) { setEventKey(null); setEventKeyReady(true); return undefined; }
    let cancelled = false;
    setEventKeyReady(false);
    readEventKey(eventId, songId)
      .then(({ key }) => { if (!cancelled) setEventKey(key || null); })
      .catch(() => { if (!cancelled) setEventKey(null); })
      .finally(() => { if (!cancelled) setEventKeyReady(true); });
    return () => { cancelled = true; };
  }, [enabled, eventId, songId]);
  const sequenceInEventKey = isEventKeyFresh(baseSession, eventKey);
  const session = useMemo(() => (
    sequenceInEventKey ? applyEventKey(baseSession, eventKey) : baseSession
  ), [baseSession, eventKey, sequenceInEventKey]);
  const eventSemitones = Number(eventKey?.semitones ?? eventKeySemitones) || 0;
  /** The sequence plays in the original key although the event changed it. */
  const eventKeyNotApplied = enabled && !isOriginal && eventSemitones !== 0 && !sequenceInEventKey;

  const tracks = useMemo(() => classifyRehearsalTracks(session?.tracks || []), [session]);
  const partCandidates = useMemo(() => listPartCandidates(tracks), [tracks]);
  const stemGroups = useMemo(() => listPresentGroups(tracks), [tracks]);
  const sectionOffset = Number.isFinite(Number(session?.sectionOffsetSeconds)) ? Number(session.sectionOffsetSeconds) : 0;

  // ---- Preferences: mix, your part (per user and song, on this device) ----
  const prefsKey = buildRehearsalMixPrefsKey({ userId, songId });
  const [prefs, setPrefs] = useState(() => (
    typeof window === 'undefined' ? sanitizeRehearsalMixPrefs({}) : readPrefs(prefsKey, tracks.map((track) => track.id))
  ));
  useEffect(() => {
    if (!enabled || tracks.length === 0) return;
    setPrefs(readPrefs(prefsKey, tracks.map((track) => track.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, prefsKey, tracks.length]);
  useEffect(() => { if (enabled && tracks.length) writePrefs(prefsKey, prefs); }, [enabled, prefs, prefsKey, tracks.length]);
  const updatePrefs = useCallback((patch) => setPrefs((current) => ({ ...current, ...patch })), []);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const suggestedPartIds = useMemo(() => suggestPartTrackIds(tracks, userRoleCodes), [tracks, userRoleCodes]);
  const partTrackIds = prefs.hasChosenPart ? prefs.partTrackIds : suggestedPartIds;
  const partMode = partTrackIds.length > 0 ? prefs.partMode : 'normal';
  const gains = useMemo(() => computeRehearsalTrackGains({
    tracks,
    source: isOriginal ? 'original' : 'secuencia',
    partMode,
    partTrackIds,
    groupLevels: prefs.groupLevels,
    mutedGroups: prefs.mutedGroups,
  }), [isOriginal, partMode, partTrackIds, prefs.groupLevels, prefs.mutedGroups, tracks]);

  /** Tracks for the engine (initial gains already applied). */
  const engineTracks = useMemo(() => {
    if (!enabled || !eventKeyReady || typeof window === 'undefined') return [];
    return tracks.map((track) => ({
      id: track.id,
      name: track.name,
      // Same URL policy as the Live Director: same-origin proxy where R2 CORS
      // is not guaranteed (localhost, previews), direct R2 in production.
      url: resolveFetchableAudioUrl(track.url, { origin: window.location.origin }) || track.url,
      volume: gains[track.id] ?? track.baseVolume,
      isMuted: false,
      sourceFileName: track.sourceFileName,
      outputRoute: 'stereo',
    }));
    // Gains are applied live with setVolume; they must not reload the engine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, eventKeyReady, tracks]);

  // ---- Your part: instrument chips + "Voz" ----
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
  const togglePart = useCallback((trackId) => {
    const current = new Set(partTrackIds);
    if (current.has(trackId)) current.delete(trackId); else current.add(trackId);
    updatePrefs({ partTrackIds: Array.from(current), hasChosenPart: true, singer: false });
  }, [partTrackIds, updatePrefs]);
  const toggleVoice = useCallback(() => {
    if (vocalTracks.length > 0) {
      const current = new Set(partTrackIds);
      vocalTracks.forEach((track) => (voiceSelected ? current.delete(track.id) : current.add(track.id)));
      updatePrefs({ partTrackIds: Array.from(current), hasChosenPart: true, singer: false });
      return;
    }
    updatePrefs({ singer: !singerWithoutStems, partTrackIds: [], partMode: 'normal', hasChosenPart: true });
  }, [partTrackIds, singerWithoutStems, updatePrefs, vocalTracks, voiceSelected]);
  /** Subir / Aislar / Mutear: the active one again goes back to the full mix. */
  const setPartMode = useCallback((nextPartMode) => {
    updatePrefs({ partMode: partMode === nextPartMode ? 'normal' : nextPartMode });
  }, [partMode, updatePrefs]);
  // You rehearse an instrument, not a file: the part is chosen by instrument
  // group (all its stems), with the same groups as the mix.
  const partGroups = useMemo(() => stemGroups
    // Voz has its own chip; nobody plays "Otros" (FX, full mixes).
    .filter((group) => group.id !== 'voces' && group.id !== 'otros' && !group.control)
    .map((group) => {
      const trackIds = partCandidates.filter((track) => track.groupId === group.id).map((track) => track.id);
      return { id: group.id, label: group.label, trackIds, selected: trackIds.length > 0 && trackIds.every((id) => partTrackIds.includes(id)) };
    })
    .filter((group) => group.trackIds.length > 0), [partCandidates, partTrackIds, stemGroups]);
  const togglePartGroup = useCallback((groupId) => {
    const group = partGroups.find((item) => item.id === groupId);
    if (!group) return;
    const current = new Set(partTrackIds);
    group.trackIds.forEach((id) => (group.selected ? current.delete(id) : current.add(id)));
    updatePrefs({ partTrackIds: Array.from(current), hasChosenPart: true, singer: false });
  }, [partGroups, partTrackIds, updatePrefs]);
  const partLabel = singerWithoutStems
    ? 'Voz'
    : partTrackIds.length
      ? [
        ...(voiceSelected ? ['Voz'] : []),
        ...partGroups.filter((group) => group.selected).map((group) => group.label),
      ].join(', ') || 'Elige tu parte'
      : 'Elige tu parte';

  // ---- Original mp3 ↔ sequence (REAPER count-in) ----
  // Without REAPER markers the session offset is exactly the mp3 → sequence
  // shift. With REAPER markers it is measured from the audio the first time
  // you open the Original: only on this device, never saved to the session.
  const sequenceHasOwnMarkers = Array.isArray(session?.sectionMarkers) && session.sectionMarkers.length > 0;
  const mp3OffsetKey = `${songId}:${session?.updatedAt || ''}:${song?.mp3 || ''}`;
  const [measuredMp3Offset, setMeasuredMp3Offset] = useState(() => (
    typeof window === 'undefined' ? null : readCachedMp3Offset(mp3OffsetKey)
  ));
  useEffect(() => { setMeasuredMp3Offset(readCachedMp3Offset(mp3OffsetKey)); }, [mp3OffsetKey]);
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
  const [aligningOriginal, setAligningOriginal] = useState(false);
  /** Shift between the mp3 and the sequence (sequence = mp3 + shift); measures it the first time. */
  const resolveMp3Offset = useCallback(async () => {
    if (Number.isFinite(knownMp3Offset)) return knownMp3Offset;
    const origin = window.location.origin;
    const bandUrls = tracks.filter((track) => !track.isControl).slice(0, 3)
      .map((track) => resolveFetchableAudioUrl(track.url, { origin }) || track.url);
    const referenceUrl = resolveFetchableAudioUrl(song?.mp3, { origin }) || song?.mp3;
    if (!referenceUrl || bandUrls.length === 0) return estimatedMp3Offset;
    setAligningOriginal(true);
    try {
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
    } finally {
      setAligningOriginal(false);
    }
  }, [estimatedMp3Offset, knownMp3Offset, mp3OffsetKey, song?.mp3, tracks]);

  // ---- Engine extras: live gains, prefetch, prepared repeat ----
  const engineReady = Boolean(enabled && !isOriginal && engine?.isReady);
  const streamingRoute = engine?.diagnostics?.engineRoute === 'streaming-worker';
  // Only the engine's stable callbacks go into effect deps: the engine object
  // itself changes on every render (setVolume updates its state).
  const setEngineVolume = engine?.setVolume;
  const prefetchSectionStarts = engine?.prefetchSectionStarts;
  useEffect(() => {
    if (!engineReady || !setEngineVolume) return;
    Object.entries(gains).forEach(([trackId, gain]) => setEngineVolume(trackId, gain));
  }, [engineReady, gains, setEngineVolume]);

  const sectionsKey = (Array.isArray(sections) ? sections : []).map((section) => `${section?.id}:${section?.startTime}:${section?.endTime}`).join('|');
  const timeline = useMemo(() => (
    (Array.isArray(sections) ? sections : [])
      .filter((section) => Number.isFinite(section?.startTime))
      .map((section) => ({ ...section, endTime: Number.isFinite(section.endTime) ? section.endTime : section.startTime + 600 }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [sectionsKey]);
  // Precarga, as in the Live Director: section starts cached in the background,
  // so jumps decode local audio and every stem is ready at once.
  const sectionStartsKey = timeline.map((entry) => entry.startTime.toFixed(3)).join(',');
  useEffect(() => {
    if (!engineReady || !sectionStartsKey || !streamingRoute) return;
    prefetchSectionStarts?.(sectionStartsKey.split(',').map(Number));
  }, [engineReady, prefetchSectionStarts, sectionStartsKey, streamingRoute]);

  const canPrepareJumps = streamingRoute && supportsPreparedSectionJump(readLiveBrowserCapabilities());
  const sectionJump = useLiveDirectorSectionJump({
    enabled: engineReady && timeline.length > 0,
    resetKey: `${songId}:${sectionOffset}:${sectionStartsKey}`,
    sections: timeline,
    isReady: engineReady,
    isPlaying: Boolean(engine?.isPlaying),
    busy: isSeeking,
    getTime: () => engine?.getCurrentTimeSnapshot?.() ?? 0,
    onJump: (time) => Promise.resolve(onJump?.(time)).then(() => true),
    prepareJump: canPrepareJumps ? engine.prepareSectionJump : undefined,
    cancelPreparedJump: engine?.cancelSectionJump,
  });
  const sectionJumpRef = useRef(sectionJump);
  sectionJumpRef.current = sectionJump;
  /** Repeat this section: null | 'once' | 'hold'. */
  const repeatMode = sectionJump.repeat?.mode || null;
  const startRepeat = useCallback((mode) => sectionJumpRef.current.startRepeat(mode), []);
  const cancelNavigation = useCallback(() => {
    const navigation = sectionJumpRef.current;
    if (navigation.armed || navigation.repeat) navigation.cancel();
  }, []);

  // ---- Digital click and guide: only when the song has no such stem ----
  const reaperTiming = session?.reaperTiming || null;
  const clickBpm = Number(reaperTiming?.tempo) || Number(bpm) || 0;
  const meterMatch = /^(\d{1,2})\/(\d{1,2})$/.exec(String(reaperTiming?.meter || song?.meter || song?.compas || '').trim());
  const meterNumerator = meterMatch ? Number(meterMatch[1]) : 4;
  const meterDenominator = meterMatch ? Number(meterMatch[2]) : 4;
  const songMeter = useMemo(() => ({ numerator: meterNumerator, denominator: meterDenominator }), [meterDenominator, meterNumerator]);
  const streamingEngine = engine?.diagnostics ? engine.diagnostics.engineMode === 'streaming' : true;
  const hasClickStem = tracks.some((track) => track.category === 'click' || track.category === 'cues');
  const hasGuideStem = tracks.some((track) => track.category === 'guide' || track.category === 'cues');
  const digitalClickWanted = enabled && !isOriginal && streamingEngine && clickBpm > 0 && !hasClickStem;
  const digitalGuideWanted = enabled && !isOriginal && streamingEngine && timeline.length > 0 && !hasGuideStem;
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
  clickPlayingRef.current = Boolean(engine?.isPlaying) && !isSeeking;
  const getVirtualGraph = engine?.getVirtualGuideAudioGraph;
  const getTimeSnapshot = engine?.getCurrentTimeSnapshot;
  useEffect(() => {
    if (!digitalClickWanted || !engineReady || !getVirtualGraph) return undefined;
    const graph = getVirtualGraph(() => ({ gain: digitalLevel('click', 0.5), route: 'stereo' }));
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
      timer = window.setInterval(() => player.update(getTimeSnapshot(), clickPlayingRef.current), 25);
    }).catch((error) => console.warn('[useRehearsalSequence] Click digital no disponible.', error));
    return () => { disposed = true; window.clearInterval(timer); player.dispose(); };
  }, [clickBpm, clickOriginSeconds, digitalClickWanted, digitalLevel, engineReady, getTimeSnapshot, getVirtualGraph, meterDenominator, meterNumerator, reaperTiming]);

  const guideCuePlan = useCallback((time) => {
    const plan = sectionJumpRef.current?.getCuePlan?.(time);
    if (plan && /^(jump|repeat):/.test(plan.id)) return plan;
    const cue = (entry) => entry.cueName || entry.name;
    const first = timeline[0];
    if (first && time < first.startTime) return { id: `entry:${first.id}`, boundary: first.startTime, name: cue(first), countIn: true };
    const index = timeline.reduce((found, entry, i) => (entry.startTime <= time ? i : found), -1);
    const next = timeline[index + 1];
    return next && next.startTime > time ? { id: `next:${next.id}`, boundary: next.startTime, name: cue(next), countIn: true } : null;
  }, [timeline]);
  useLiveDirectorDynamicGuide({
    wanted: digitalGuideWanted,
    ready: engineReady,
    playing: Boolean(engine?.isPlaying),
    busy: isSeeking,
    resetKey: `${songId}:${mp3OffsetKey}`,
    bpm: clickBpm || 120,
    meter: songMeter,
    getGraph: () => getVirtualGraph?.(() => ({ gain: digitalLevel('guia', 0.85), route: 'stereo' })) ?? null,
    getTime: () => getTimeSnapshot?.() ?? 0,
    getPlan: guideCuePlan,
  });

  const mixerGroups = useMemo(() => {
    const extra = [];
    if (digitalClickWanted && !stemGroups.some((group) => group.id === 'click')) extra.push({ id: 'click', label: 'Click (digital)' });
    if (digitalGuideWanted && !stemGroups.some((group) => group.id === 'guia')) extra.push({ id: 'guia', label: 'Guía (digital)' });
    return [...extra, ...stemGroups];
  }, [digitalClickWanted, digitalGuideWanted, stemGroups]);
  /** Click on/off from the BPM chip: the Click group (stem or digital). */
  const clickAvailable = hasClickStem || digitalClickWanted;
  const clickMuted = Boolean(prefs.mutedGroups?.click);
  const toggleClick = useCallback(() => {
    updatePrefs({ mutedGroups: { ...prefsRef.current.mutedGroups, click: !prefsRef.current.mutedGroups?.click } });
  }, [updatePrefs]);

  // Stems often carry no duration in their header: their activity envelope does.
  const envelopeDuration = useMemo(() => estimateEnvelopeDuration(tracks), [tracks]);

  return {
    session,
    tracks,
    envelopeDuration,
    engineTracks,
    eventKeyReady,
    eventKeyNotApplied,
    eventSemitones,
    prefs,
    updatePrefs,
    gains,
    partCandidates,
    instrumentCandidates,
    vocalTracks,
    suggestedPartIds,
    partTrackIds,
    partMode,
    partLabel,
    singerWithoutStems,
    voiceSelected,
    togglePart,
    toggleVoice,
    partGroups,
    togglePartGroup,
    setPartMode,
    mixerGroups,
    mp3Offset,
    knownMp3Offset,
    resolveMp3Offset,
    aligningOriginal,
    sectionJump,
    repeatMode,
    startRepeat,
    cancelNavigation,
    digitalClickWanted,
    digitalGuideWanted,
    clickAvailable,
    clickMuted,
    toggleClick,
  };
}
