import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { buildWordGroups } from '../../utils/chordProLineUtils';
import { buildDisplayTrack } from '../../utils/splitSectionIntoCues';
import { toRgba } from '../../utils/sectionVisuals';

const FONT_SIZES = {
  compact: { lyrics: 36, chords: 28, next: 22, countdown: 48 },
  standard: { lyrics: 48, chords: 36, next: 28, countdown: 60 },
  large: { lyrics: 60, chords: 44, next: 32, countdown: 72 },
};


const DEFAULT_SETTINGS = {
  showChords: true,
  showNextCue: true,
  showCountdown: true,
  showSectionMap: true,
  showSongInfo: true,
  fontSize: 'standard',
};

const SYNC_ANTICIPATION_SEC = 0.5;
const SYNC_DRIFT_SOFT_SEC = 0.18;
const SYNC_DRIFT_HARD_SEC = 0.75;
const SYNC_SECTION_SNAP_DRIFT_SEC = 0.32;
const MAX_SERVER_LOOKAHEAD_SEC = 2.2;
const MAX_FRAME_DELTA_SEC = 0.12;

const stripChordMarkup = (line = '') =>
  String(line || '')
    .replace(/\[([^\]]+)\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const formatBpmLabel = (value) => {
  const bpm = Number(value);
  return Number.isFinite(bpm) && bpm > 0 ? `${Math.round(bpm)} BPM` : null;
};

const resolveTrustedSectionEnd = (section) => {
  const directValue = Number(section?.trustedEndSec);
  if (Number.isFinite(directValue)) return directValue;

  const fallbackValue = Number(section?.endSec);
  return Number.isFinite(fallbackValue) ? fallbackValue : null;
};

const buildCuePreviewLines = (cue, maxLines = 2) => {
  if (!cue) return [];

  if (cue.type === 'lyrics') {
    return (cue.rawLines || [])
      .map(stripChordMarkup)
      .filter(Boolean)
      .slice(0, maxLines);
  }

  if (cue.type === 'instrumental') {
    return (cue.rawLines || [])
      .map((line) => String(line || '').trim())
      .filter(Boolean)
      .slice(0, maxLines);
  }

  if (cue.type === 'empty') {
    return cue.sectionLabel ? [cue.sectionLabel] : [];
  }

  return [];
};

const extractCueChordTokens = (cue, max = 4) => {
  if (!cue || !Array.isArray(cue.rawLines)) return [];

  const seen = new Set();
  const result = [];

  for (const rawLine of cue.rawLines) {
    const matches = String(rawLine || '').matchAll(/\[([^\]]+)\]/g);
    for (const match of matches) {
      const chord = String(match?.[1] || '').trim();
      if (!chord || seen.has(chord)) continue;
      seen.add(chord);
      result.push(chord);
      if (result.length >= max) return result;
    }
  }

  return result;
};

const getLongestCueLineLength = (cue) => {
  if (!cue) return 0;

  const sourceLines =
    cue.type === 'lyrics'
      ? (cue.rawLines || []).map(stripChordMarkup)
      : (cue.rawLines || []).map((line) => String(line || '').trim());

  return sourceLines.reduce((max, line) => Math.max(max, String(line || '').length), 0);
};

const getReadableStageWidthCap = ({
  availableWidth,
  cueLineCount,
  longestLineLength,
  hasSidePreview,
}) => {
  if (!availableWidth) return 0;

  const baseRatio = hasSidePreview ? 0.89 : 0.94;
  const lineBonus = cueLineCount <= 2 ? 0.02 : cueLineCount === 3 ? 0.01 : 0;
  const longLinePenalty = longestLineLength >= 56 ? 0.03 : longestLineLength >= 44 ? 0.015 : 0;
  const safeRatio = Math.max(0.88, Math.min(baseRatio + lineBonus - longLinePenalty, 0.96));

  return availableWidth * safeRatio;
};

const formatChordAccidentals = (value = '') =>
  String(value || '')
    .replace(/#/g, '\u266F')
    .replace(/b/g, '\u266D');

function MonitorChordDisplay({ chord, fontSize, color }) {
  if (!chord) return null;

  return (
    <span
      style={{
        display: 'inline-block',
        fontSize,
        fontWeight: 900,
        lineHeight: 1,
        letterSpacing: 0.4,
        color,
        fontFamily: '"SF Mono","Cascadia Code","Fira Code","Consolas",monospace',
        whiteSpace: 'nowrap',
        backgroundColor: 'rgba(10, 10, 10, 0.7)',
        paddingRight: '0.15em',
        borderRadius: '3px',
      }}
    >
      {formatChordAccidentals(chord)}
    </span>
  );
}

function MonitorChordOverlayLine({
  segments,
  lineKey,
  lyricFontSize,
  chordFontSize,
  chordColor,
  lyricColor,
  lineHeight,
}) {
  const lyricText = segments.map((segment) => segment.lyric || '').join('');
  const hasChord = segments.some((segment) => Boolean(segment.chord));
  const hasVisibleLyric = lyricText.trim().length > 0;

  if (!hasChord) {
    return (
      <div
        style={{
          fontSize: lyricFontSize,
          fontWeight: 700,
          lineHeight,
          color: lyricColor,
          whiteSpace: 'nowrap',
        }}
      >
        {lyricText}
      </div>
    );
  }

  if (!hasVisibleLyric) {
    return (
      <div
        style={{
          display: 'flex',
          gap: Math.max(14, Math.round(chordFontSize * 0.34)),
          alignItems: 'center',
          whiteSpace: 'nowrap',
        }}
      >
        {segments
          .map((segment) => segment.chord)
          .filter(Boolean)
          .map((chord, index) => (
            <MonitorChordDisplay
              key={`${lineKey}-instrumental-${index}`}
              chord={chord}
              fontSize={chordFontSize}
              color={chordColor}
            />
          ))}
      </div>
    );
  }

  const wordGroups = buildWordGroups(segments);
  const chordLaneHeight = Math.max(chordFontSize + 6, Math.round(lyricFontSize * 0.62));

  return (
    <div
      style={{
        display: 'block',
        fontSize: lyricFontSize,
        fontWeight: 700,
        lineHeight,
        color: lyricColor,
        whiteSpace: 'nowrap',
      }}
    >
      {wordGroups.map((token, index) => {
        if (token.type === 'chord-only') {
          return (
            <React.Fragment key={`${lineKey}-co-${index}`}>
              {index > 0 && ' '}
              <span
                style={{
                  display: 'inline-block',
                  position: 'relative',
                  verticalAlign: 'top',
                  paddingTop: chordLaneHeight,
                  minWidth: Math.max(
                    Math.round(formatChordAccidentals(token.name).length * chordFontSize * 0.64),
                    Math.round(chordFontSize * 0.95),
                  ),
                  lineHeight,
                }}
              >
                <span
                  style={{
                    pointerEvents: 'none',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    height: 0,
                    overflow: 'visible',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <MonitorChordDisplay chord={token.name} fontSize={chordFontSize} color={chordColor} />
                </span>
                {'\u00A0'}
              </span>
            </React.Fragment>
          );
        }

        return (
          <React.Fragment key={`${lineKey}-wg-${index}`}>
            {index > 0 && ' '}
            <span
              style={{
                display: 'inline-block',
                position: 'relative',
                verticalAlign: 'top',
                paddingTop: chordLaneHeight,
                lineHeight,
              }}
            >
              {token.chords.length > 0 && (
                <span
                  style={{
                    pointerEvents: 'none',
                    position: 'absolute',
                    top: 0,
                    left: '50%', // Centrar dinámicamente todo el bloque de acordes
                    transform: 'translateX(-50%)',
                    display: 'flex', // Layout flex para evitar solapamiento visual
                    gap: '0.4em',    // Pequeño espacio para que no colapsen
                    width: 'max-content',
                  }}
                >
                  {token.chords.map((descriptor, chordIndex) => (
                    <span
                      key={`${lineKey}-ch-${index}-${chordIndex}`}
                      style={{
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <MonitorChordDisplay
                        chord={descriptor.name}
                        fontSize={chordFontSize}
                        color={chordColor}
                      />
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
  );
}

export default function ConfidenceMonitor({ songs = [], eventId = '', eventTitle = '' }) {
  const [activeTrackIndex, setActiveTrackIndex] = useState(0);
  const [activeSectionIndex, setActiveSectionIndex] = useState(0);
  const [activeCueIndex, setActiveCueIndex] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [sectionTimeRemaining, setSectionTimeRemaining] = useState(null);
  const [runtimeTrackDurations, setRuntimeTrackDurations] = useState({});
  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
  }));
  const [heroScale, setHeroScale] = useState(1);
  const [previewScale, setPreviewScale] = useState(1);

  const timeline = useMemo(() => {
    const tracks = (songs || []).map((song) =>
      buildDisplayTrack({
        ...song,
        actualDurationSec: runtimeTrackDurations[String(song?.id ?? '')] ?? null,
      }),
    );
    return {
      eventId,
      eventTitle,
      tracks,
      totalCues: tracks.reduce((sum, track) => sum + track.cues.length, 0),
    };
  }, [eventId, eventTitle, runtimeTrackDurations, songs]);

  const activeTrackIndexRef = useRef(0);
  const activeSectionIndexRef = useRef(0);
  const activeCueIndexRef = useRef(0);
  const lastServerTimeRef = useRef(0);
  const lastReceiveTimestampRef = useRef(0);
  const lastPayloadSongIdRef = useRef('');
  const remoteIsPlayingRef = useRef(false);
  const lastHeartbeatAtRef = useRef(0);
  const interpolatedTimeRef = useRef(0);
  const smoothedDisplayTimeRef = useRef(0);
  const lastAppliedDisplayTimeRef = useRef(0);
  const lastFrameTimestampRef = useRef(0);
  const rafRef = useRef(null);
  const lastCountdownRef = useRef(null);
  const lastCountdownContextRef = useRef('');
  const mainStageRef = useRef(null);
  const mainContentRef = useRef(null);
  const previewStageRef = useRef(null);
  const previewContentRef = useRef(null);
  const pendingDurationLoadsRef = useRef(new Map());
  const runtimeTrackDurationsRef = useRef({});

  useEffect(() => {
    activeTrackIndexRef.current = activeTrackIndex;
  }, [activeTrackIndex]);

  useEffect(() => {
    activeSectionIndexRef.current = activeSectionIndex;
  }, [activeSectionIndex]);

  useEffect(() => {
    activeCueIndexRef.current = activeCueIndex;
  }, [activeCueIndex]);

  useEffect(() => {
    runtimeTrackDurationsRef.current = runtimeTrackDurations;
  }, [runtimeTrackDurations]);

  useEffect(() => {
    const handleResize = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const loadRuntimeTrackDuration = useCallback((track) => {
    const songId = String(track?.songId || '');
    const audioUrl = String(track?.audioUrl || '').trim();

    if (!songId || !audioUrl) return;
    if (runtimeTrackDurationsRef.current[songId] != null) return;
    if (pendingDurationLoadsRef.current.has(songId)) return;

    const probe = new Audio();
    probe.preload = 'metadata';

    const cleanup = () => {
      probe.removeEventListener('loadedmetadata', onLoadedMetadata);
      probe.removeEventListener('error', onLoadError);
      probe.src = '';
      pendingDurationLoadsRef.current.delete(songId);
    };

    const onLoadedMetadata = () => {
      const resolvedDuration = Number(probe.duration);
      if (Number.isFinite(resolvedDuration) && resolvedDuration > 1) {
        setRuntimeTrackDurations((current) => {
          if (current[songId] != null) return current;
          return {
            ...current,
            [songId]: resolvedDuration,
          };
        });
      }
      cleanup();
    };

    const onLoadError = () => {
      cleanup();
    };

    pendingDurationLoadsRef.current.set(songId, cleanup);
    probe.addEventListener('loadedmetadata', onLoadedMetadata);
    probe.addEventListener('error', onLoadError);
    probe.src = audioUrl;
    probe.load();
  }, []);

  useEffect(() => {
    loadRuntimeTrackDuration(timeline.tracks[activeTrackIndex]);
    loadRuntimeTrackDuration(timeline.tracks[activeTrackIndex + 1]);
  }, [activeTrackIndex, loadRuntimeTrackDuration, timeline.tracks]);

  useEffect(() => () => {
    pendingDurationLoadsRef.current.forEach((cleanup) => cleanup?.());
    pendingDurationLoadsRef.current.clear();
  }, []);

  useEffect(() => {
    if (activeTrackIndex >= timeline.tracks.length && timeline.tracks.length > 0) {
      setActiveTrackIndex(0);
      setActiveCueIndex(0);
      setActiveSectionIndex(0);
    }
  }, [activeTrackIndex, timeline.tracks.length]);

  const activeTrack = timeline.tracks[activeTrackIndex] || null;
  const activeCue = activeTrack?.cues[activeCueIndex] || null;
  const nextCue = activeTrack?.cues[activeCueIndex + 1] || null;
  const nextSectionLabel = useMemo(() => {
    if (!activeTrack || !activeCue) return null;
    const nextSection = activeTrack.sections[activeCue.sectionIndex + 1];
    return activeCue.cueIndex === activeCue.totalCuesInSection - 1 && nextSection
      ? nextSection.label
      : null;
  }, [activeCue, activeTrack]);

  const findCueAtTime = useCallback((time, track) => {
    if (!track || !Array.isArray(track.cues) || track.cues.length === 0) return 0;

    for (let index = track.cues.length - 1; index >= 0; index -= 1) {
      const cue = track.cues[index];

      let anticipation = 0;
      if (index > 0 && cue?.estimatedStartSec != null) {
        const previousCue = track.cues[index - 1];
        // 150ms exactos para compensar latencia de red sin que el salto
        // visual se sienta desfasado cuando se configuran los marcadores con alta precisión.
        const defaultAnticipation = SYNC_ANTICIPATION_SEC;

        // Limitar la anticipación a un 40% de la duración del cue anterior
        // para no solapar los saltos en la pantalla si los cues son rapidísimos
        const maxAnticipation = previousCue?.estimatedStartSec != null
          ? Math.max(0, (cue.estimatedStartSec - previousCue.estimatedStartSec) * 0.45)
          : defaultAnticipation;

        anticipation = Math.min(defaultAnticipation, maxAnticipation);
      }

      const switchAt =
        cue?.estimatedStartSec != null
          ? cue.estimatedStartSec - anticipation
          : null;

      if (switchAt != null && time >= switchAt) {
        return index;
      }
    }

    return 0;
  }, []);

  const syncDisplayState = useCallback((trackIndex, cueIndex, fallbackSectionIndex = 0) => {
    const track = timeline.tracks[trackIndex] || null;
    if (!track) return null;

    const nextCueIndex = Math.max(0, Math.min(cueIndex, Math.max(track.cues.length - 1, 0)));
    const cue = track.cues[nextCueIndex] || null;
    const nextSectionIndex = cue?.sectionIndex ?? fallbackSectionIndex;

    activeTrackIndexRef.current = trackIndex;
    activeCueIndexRef.current = nextCueIndex;
    activeSectionIndexRef.current = nextSectionIndex;

    setActiveTrackIndex((current) => (current === trackIndex ? current : trackIndex));
    setActiveCueIndex((current) => (current === nextCueIndex ? current : nextCueIndex));
    setActiveSectionIndex((current) => (current === nextSectionIndex ? current : nextSectionIndex));

    return cue;
  }, [timeline.tracks]);

  const moveToCue = useCallback((trackIndex, cueIndex) => {
    const track = timeline.tracks[trackIndex] || null;
    if (!track) return;

    const nextCueIndex = Math.max(0, Math.min(cueIndex, Math.max(track.cues.length - 1, 0)));
    syncDisplayState(trackIndex, nextCueIndex, track.cues[nextCueIndex]?.sectionIndex ?? 0);
  }, [syncDisplayState, timeline.tracks]);

  const getAuthoritativeRemoteTime = useCallback((now = performance.now()) => {
    if (lastReceiveTimestampRef.current <= 0) {
      return lastServerTimeRef.current;
    }

    if (!remoteIsPlayingRef.current) {
      return lastServerTimeRef.current;
    }

    const elapsed = Math.max(0, (now - lastReceiveTimestampRef.current) / 1000);
    return lastServerTimeRef.current + Math.min(elapsed, MAX_SERVER_LOOKAHEAD_SEC);
  }, []);

  useEffect(() => {
    const loop = () => {
      const now = performance.now();
      const trackIndex = activeTrackIndexRef.current;
      const track = timeline.tracks[trackIndex] || null;
      const previousFrameTimestamp = lastFrameTimestampRef.current || now;
      const frameDelta = Math.min(
        Math.max(0, (now - previousFrameTimestamp) / 1000),
        MAX_FRAME_DELTA_SEC,
      );
      lastFrameTimestampRef.current = now;

      if (track && lastReceiveTimestampRef.current > 0) {
        const authoritativeTime = getAuthoritativeRemoteTime(now);
        let nextDisplayTime = smoothedDisplayTimeRef.current;

        if (!Number.isFinite(nextDisplayTime) || nextDisplayTime <= 0) {
          nextDisplayTime = authoritativeTime;
        } else if (remoteIsPlayingRef.current) {
          const projectedForward = nextDisplayTime + frameDelta;
          const driftAfterForward = authoritativeTime - projectedForward;

          if (Math.abs(driftAfterForward) >= SYNC_DRIFT_HARD_SEC) {
            nextDisplayTime = authoritativeTime;
          } else if (driftAfterForward > SYNC_DRIFT_SOFT_SEC) {
            nextDisplayTime = projectedForward + Math.min(driftAfterForward * 0.35, 0.08);
          } else if (driftAfterForward < -SYNC_DRIFT_SOFT_SEC) {
            nextDisplayTime = nextDisplayTime;
          } else {
            nextDisplayTime = projectedForward;
          }

          nextDisplayTime = Math.max(nextDisplayTime, lastAppliedDisplayTimeRef.current);
        } else {
          nextDisplayTime = authoritativeTime;
        }

        smoothedDisplayTimeRef.current = nextDisplayTime;
        lastAppliedDisplayTimeRef.current = nextDisplayTime;
        interpolatedTimeRef.current = nextDisplayTime;

        const nextCueIndex = findCueAtTime(nextDisplayTime, track);
        if (nextCueIndex !== activeCueIndexRef.current) {
          syncDisplayState(trackIndex, nextCueIndex, track.cues[nextCueIndex]?.sectionIndex ?? 0);
        }

        const cue = track.cues[nextCueIndex] || null;
        const section = cue ? track.sections[cue.sectionIndex] : null;
        const trustedSectionEnd = resolveTrustedSectionEnd(section);

        if (trustedSectionEnd != null) {
          const countdownContext = `${track.songId}:${cue?.sectionIndex ?? -1}`;
          if (lastCountdownContextRef.current !== countdownContext) {
            lastCountdownContextRef.current = countdownContext;
            lastCountdownRef.current = null;
          }

          const remainingSeconds = Math.max(0, trustedSectionEnd - nextDisplayTime);
          const visibleCountdown = Math.ceil(remainingSeconds);
          const stableCountdown = remoteIsPlayingRef.current && lastCountdownRef.current != null
            ? Math.min(lastCountdownRef.current, visibleCountdown)
            : visibleCountdown;

          if (lastCountdownRef.current !== stableCountdown) {
            lastCountdownRef.current = stableCountdown;
            setSectionTimeRemaining(stableCountdown);
          }
        } else if (lastCountdownRef.current !== null) {
          lastCountdownContextRef.current = '';
          lastCountdownRef.current = null;
          setSectionTimeRemaining(null);
        }
      } else if (lastCountdownRef.current !== null) {
        lastCountdownContextRef.current = '';
        lastCountdownRef.current = null;
        setSectionTimeRemaining(null);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [findCueAtTime, getAuthoritativeRemoteTime, syncDisplayState, timeline.tracks]);

  useEffect(() => {
    const channel = supabase.channel('ensayo-live-sync', {
      config: { broadcast: { self: false } },
    });

    channel
      .on('broadcast', { event: 'SECTION_CHANGE' }, ({ payload }) => {
        if (!payload?.songId) return;

        lastHeartbeatAtRef.current = Date.now();
        setConnectionStatus('connected');

        const nextSongId = String(payload.songId);
        const songChanged = nextSongId !== String(lastPayloadSongIdRef.current);
        const receiveTimestamp = performance.now();
        const incomingIsPlaying =
          typeof payload.isPlaying === 'boolean' ? payload.isPlaying : remoteIsPlayingRef.current;

        if (typeof payload.currentTime === 'number') {
          const currentDisplayTime =
            smoothedDisplayTimeRef.current || interpolatedTimeRef.current || payload.currentTime;
          const drift = payload.currentTime - currentDisplayTime;
          const sectionJump =
            typeof payload.sectionIndex === 'number' &&
            payload.sectionIndex !== activeSectionIndexRef.current;
          const shouldSnapImmediately =
            songChanged ||
            lastReceiveTimestampRef.current <= 0 ||
            !incomingIsPlaying ||
            Math.abs(drift) >= SYNC_DRIFT_HARD_SEC ||
            (sectionJump && Math.abs(drift) >= SYNC_SECTION_SNAP_DRIFT_SEC);

          remoteIsPlayingRef.current = incomingIsPlaying;
          lastPayloadSongIdRef.current = nextSongId;
          lastServerTimeRef.current = payload.currentTime;
          lastReceiveTimestampRef.current = receiveTimestamp;
          if (shouldSnapImmediately) {
            smoothedDisplayTimeRef.current = payload.currentTime;
            lastAppliedDisplayTimeRef.current = payload.currentTime;
            interpolatedTimeRef.current = payload.currentTime;
            lastFrameTimestampRef.current = receiveTimestamp;
          }
        } else {
          remoteIsPlayingRef.current = incomingIsPlaying;
          lastPayloadSongIdRef.current = nextSongId;
        }

        const matchedTrackIndex = timeline.tracks.findIndex(
          (track) => String(track.songId) === nextSongId,
        );

        let resolvedTrackIndex = activeTrackIndexRef.current;
        if (matchedTrackIndex >= 0) {
          resolvedTrackIndex = matchedTrackIndex;
          if (matchedTrackIndex !== activeTrackIndexRef.current) {
            activeTrackIndexRef.current = matchedTrackIndex;
            setActiveTrackIndex(matchedTrackIndex);
          }
        }

        if (typeof payload.sectionIndex === 'number') {
          const track = timeline.tracks[resolvedTrackIndex] || null;
          const section = track?.sections[payload.sectionIndex] || null;
          const hasCueTiming = Boolean(
            track?.cues?.some(
              (cue) => cue?.estimatedStartSec != null && cue?.estimatedEndSec != null,
            ),
          );

          if (track && typeof payload.currentTime === 'number' && hasCueTiming) {
            const cueIndex = findCueAtTime(payload.currentTime, track);
            syncDisplayState(resolvedTrackIndex, cueIndex, payload.sectionIndex);
          } else if (section && (typeof payload.currentTime !== 'number' || !hasCueTiming)) {
            syncDisplayState(resolvedTrackIndex, section.startCueIndex, payload.sectionIndex);
          } else if (typeof payload.currentTime !== 'number') {
            activeSectionIndexRef.current = payload.sectionIndex;
            setActiveSectionIndex((current) => (current === payload.sectionIndex ? current : payload.sectionIndex));
          }
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnectionStatus('connected');
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [findCueAtTime, syncDisplayState, timeline.tracks]);

  useEffect(() => {
    const check = setInterval(() => {
      if (lastHeartbeatAtRef.current === 0) return;
      const sinceHeartbeat = Date.now() - lastHeartbeatAtRef.current;
      if (sinceHeartbeat > 15000) {
        setConnectionStatus('disconnected');
        return;
      }
      if (sinceHeartbeat > 5000) {
        setConnectionStatus('stale');
        return;
      }
      setConnectionStatus('connected');
    }, 2000);

    return () => clearInterval(check);
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (showSettings) {
        if (event.key === 'Escape') setShowSettings(false);
        return;
      }

      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        moveToCue(activeTrackIndexRef.current, activeCueIndexRef.current + 1);
        return;
      }

      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        moveToCue(activeTrackIndexRef.current, activeCueIndexRef.current - 1);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveToCue(Math.min(activeTrackIndexRef.current + 1, Math.max(timeline.tracks.length - 1, 0)), 0);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveToCue(Math.max(activeTrackIndexRef.current - 1, 0), 0);
        return;
      }

      if (event.key === ' ') {
        event.preventDefault();
        document.documentElement.requestFullscreen?.().catch(() => { });
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setShowSettings(true);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [moveToCue, showSettings, timeline.tracks.length]);

  useEffect(() => {
    let wakeLock = null;

    const requestWakeLock = async () => {
      try {
        wakeLock = await navigator.wakeLock?.request('screen');
      } catch {
        wakeLock = null;
      }
    };

    requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      wakeLock?.release?.();
    };
  }, []);

  const fontScale = FONT_SIZES[settings.fontSize] || FONT_SIZES.standard;
  const bpmLabel = formatBpmLabel(activeTrack?.bpm);
  const cueLineCount = activeCue?.lines?.length || activeCue?.rawLines?.length || 0;
  const longestCueLineLength = getLongestCueLineLength(activeCue);
  const cueDensityScale = cueLineCount <= 2 ? 1.24 : cueLineCount === 3 ? 1.12 : 1;
  const displayFontScale = {
    lyrics: Math.min(Math.round(fontScale.lyrics * cueDensityScale), 82),
    chords: Math.min(Math.round(fontScale.chords * Math.min(cueDensityScale * 1.12, 1.3)), 60),
    next: fontScale.next,
    countdown: fontScale.countdown,
  };
  const showBottomPreview = settings.showNextCue && Boolean(nextCue || nextSectionLabel);
  const showLegacyBottomPreview = false;
  const nextCuePreviewLines = buildCuePreviewLines(
    nextCue,
    viewport.width >= 980 ? 2 : 1,
  );
  const nextCueChordTokens = useMemo(() => extractCueChordTokens(nextCue, 4), [nextCue]);
  const nextCuePrimaryChord = nextCueChordTokens[0] || null;
  const nextCueTitle = nextSectionLabel || nextCue?.sectionLabel || 'Sigue';
  const mainTransformOrigin = 'center center';
  const bottomPreviewHeight = showBottomPreview
    ? Math.min(Math.max(Math.round(viewport.height * 0.17), 132), Math.round(viewport.height * 0.24))
    : 0;

  useLayoutEffect(() => {
    const stage = mainStageRef.current;
    const content = mainContentRef.current;
    if (!stage || !content) {
      setHeroScale(1);
      return undefined;
    }

    let frameId = 0;

    const computeScale = () => {
      const availableWidth = stage.clientWidth;
      const availableHeight = stage.clientHeight;
      const naturalWidth = content.scrollWidth;
      const naturalHeight = content.scrollHeight;
      const readableWidth = getReadableStageWidthCap({
        availableWidth,
        cueLineCount,
        longestLineLength: longestCueLineLength,
        hasSidePreview: false,
      });

      if (!availableWidth || !availableHeight || !naturalWidth || !naturalHeight) {
        setHeroScale(1);
        return;
      }

      const widthScale = (readableWidth || availableWidth) / naturalWidth;
      const heightScale = availableHeight / naturalHeight;
      const nextScale = Math.max(0.72, Math.min(widthScale, heightScale, 2.4));

      setHeroScale((current) => (Math.abs(current - nextScale) > 0.02 ? nextScale : current));
    };

    const scheduleMeasure = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(computeScale);
    };

    computeScale();

    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(stage);
    resizeObserver.observe(content);

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, [
    activeCue?.id,
    activeCue?.type,
    activeCue?.lines?.length,
    activeCue?.rawLines?.length,
    cueLineCount,
    longestCueLineLength,
    settings.showChords,
    showBottomPreview,
    displayFontScale.lyrics,
    displayFontScale.chords,
    viewport.width,
    viewport.height,
  ]);

  useLayoutEffect(() => {
    const stage = previewStageRef.current;
    const content = previewContentRef.current;

    if (!showBottomPreview || !stage || !content) {
      setPreviewScale(1);
      return undefined;
    }

    let frameId = 0;

    const computeScale = () => {
      const availableWidth = stage.clientWidth;
      const availableHeight = stage.clientHeight;
      const naturalWidth = content.scrollWidth;
      const naturalHeight = content.scrollHeight;

      if (!availableWidth || !availableHeight || !naturalWidth || !naturalHeight) {
        setPreviewScale(1);
        return;
      }

      const widthScale = (availableWidth * 0.99) / naturalWidth;
      const heightScale = (availableHeight * 0.97) / naturalHeight;
      const nextScale = Math.max(0.92, Math.min(widthScale, heightScale, 1.7));

      setPreviewScale((current) => (Math.abs(current - nextScale) > 0.02 ? nextScale : current));
    };

    const scheduleMeasure = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(computeScale);
    };

    computeScale();

    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(stage);
    resizeObserver.observe(content);

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, [
    nextCue?.id,
    nextCueTitle,
    nextCuePreviewLines,
    showBottomPreview,
    viewport.width,
    viewport.height,
  ]);

  return (
    <div
      style={{
        width: '100vw',
        height: '100dvh',
        background: '#0a0a0a',
        color: '#f0f0f0',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <style>{`
        @keyframes confidence-pulse {
          0% { opacity: 1; }
          50% { opacity: 0.55; }
          100% { opacity: 1; }
        }
      `}</style>

      {settings.showSongInfo && (
        <div
          style={{
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 20px',
            fontSize: 16,
            fontWeight: 600,
            opacity: 0.76,
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            gap: 20,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              minWidth: 0,
            }}
          >
            <span
              style={{
                opacity: 0.45,
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}
            >
              {eventTitle || 'Monitor'}
            </span>
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {activeTrack?.title || 'Esperando sync'}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0 }}>
            {activeTrack?.key && activeTrack.key !== '-' && (
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: 'rgba(255,255,255,0.1)',
                  fontSize: 14,
                }}
              >
                {activeTrack.key}
              </span>
            )}
            {bpmLabel && (
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: 'rgba(255,255,255,0.1)',
                  fontSize: 14,
                }}
              >
                {bpmLabel}
              </span>
            )}
            <span style={{ fontSize: 14, opacity: 0.55 }}>
              {timeline.tracks.length > 0 ? `${activeTrackIndex + 1}/${timeline.tracks.length}` : '0/0'}
            </span>
          </div>
        </div>
      )}

      {activeCue && (
        <div
          style={{
            height: 52,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0 20px',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              padding: '4px 14px',
              borderRadius: 6,
              fontWeight: 900,
              fontSize: 18,
              textTransform: 'uppercase',
              letterSpacing: 1,
              background: toRgba(activeCue.sectionColor, 0.22),
              color: toRgba(activeCue.sectionColor, 1),
            }}
          >
            {activeCue.sectionShortLabel}
          </span>
          <span style={{ fontSize: 15, opacity: 0.55, fontWeight: 600 }}>
            {activeCue.sectionLabel}
          </span>
          {activeCue.totalCuesInSection > 1 && (
            <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
              {Array.from({ length: activeCue.totalCuesInSection }, (_, index) => (
                <span
                  key={`${activeCue.id}-dot-${index}`}
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background:
                      index === activeCue.cueIndex
                        ? toRgba(activeCue.sectionColor, 1)
                        : 'rgba(255,255,255,0.2)',
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: '0 24px 10px',
          transition: 'opacity 300ms ease',
          minHeight: 0,
        }}
      >
        <div
          ref={mainStageRef}
          style={{
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            paddingBottom: showBottomPreview ? 6 : 0,
            overflow: 'hidden',
            flex: 1,
          }}
        >
          {!activeCue && (
            <div style={{ textAlign: 'center', opacity: 0.5 }}>
              <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
                Esperando sincronización
              </div>
              <div style={{ fontSize: 16 }}>
                Abre el modo director en <strong>/ensayo/[id]</strong> para enviar el estado en vivo.
              </div>
            </div>
          )}

          {activeCue && (
            <div
              style={{
                transform: `translateZ(0) scale(${heroScale})`,
                transformOrigin: mainTransformOrigin,
                transition: 'transform 170ms cubic-bezier(0.22, 1, 0.36, 1)',
                willChange: 'transform',
                backfaceVisibility: 'hidden',
                width: 'fit-content',
                maxWidth: '100%',
              }}
            >
              <div
                ref={mainContentRef}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  width: 'fit-content',
                  maxWidth: 'min(1580px, 100%)',
                }}
              >
                {activeCue.type === 'lyrics' &&
                  activeCue.lines.map((segments, lineIndex) => (
                    <div key={`${activeCue.id}-line-${lineIndex}`} style={{ marginBottom: 10 }}>
                      <MonitorChordOverlayLine
                        segments={
                          settings.showChords
                            ? segments
                            : segments.map((segment) => ({ ...segment, chord: '' }))
                        }
                        lineKey={`${activeCue.id}-line-${lineIndex}`}
                        lyricFontSize={displayFontScale.lyrics}
                        chordFontSize={displayFontScale.chords}
                        chordColor={toRgba(activeCue.sectionColor, 0.86)}
                        lyricColor="#f0f0f0"
                        lineHeight={cueLineCount <= 2 ? 1.12 : 1.18}
                      />
                    </div>
                  ))}

                {activeCue.type === 'instrumental' && (
                  <div style={{ textAlign: 'center', opacity: 0.68 }}>
                    <div
                      style={{
                        fontSize: 22,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        marginBottom: 16,
                        letterSpacing: 1,
                      }}
                    >
                      Instrumental
                    </div>
                    <div
                      style={{
                        fontSize: displayFontScale.chords,
                        fontWeight: 900,
                        color: toRgba(activeCue.sectionColor, 0.86),
                        lineHeight: 1.2,
                      }}
                    >
                      {activeCue.rawLines.join('   ')}
                    </div>
                  </div>
                )}

                {activeCue.type === 'empty' && (
                  <div style={{ textAlign: 'center', fontSize: 20, opacity: 0.4 }}>
                    {activeCue.sectionLabel}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {showBottomPreview && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              paddingTop: 4,
              width: '100%',
            }}
          >
            <div
              style={{
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.02))',
                borderRadius: 20,
                padding: viewport.width >= 1180 ? '12px 20px 14px' : '12px 16px 14px',
                boxShadow: '0 18px 44px rgba(0,0,0,0.16)',
                width: '100%',
                minHeight: bottomPreviewHeight,
                maxHeight: Math.max(bottomPreviewHeight, 132),
                display: 'flex',
                flexDirection: viewport.width >= 900 ? 'row' : 'column',
                alignItems: viewport.width >= 900 ? 'stretch' : 'flex-start',
                gap: viewport.width >= 900 ? 22 : 10,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: viewport.width >= 1180 ? 248 : viewport.width >= 900 ? 224 : '100%',
                  flexShrink: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 900,
                    letterSpacing: 1.2,
                    textTransform: 'uppercase',
                    opacity: 0.42,
                    marginBottom: 8,
                  }}
                >
                  Sigue
                </div>

                <div
                  style={{
                    fontSize: viewport.width >= 1400 ? 34 : viewport.width >= 1180 ? 31 : 27,
                    fontWeight: 800,
                    color: nextCue ? toRgba(nextCue.sectionColor, 0.96) : '#f0f0f0',
                    marginBottom: nextCue?.totalCuesInSection > 1 ? 12 : 0,
                    lineHeight: 1.04,
                  }}
                >
                  {nextCueTitle}
                </div>

                {settings.showChords && nextCuePrimaryChord && (
                  <div
                    style={{
                      marginTop: 10,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: viewport.width >= 1180 ? 168 : 148,
                        padding: viewport.width >= 1180 ? '10px 20px' : '9px 18px',
                        borderRadius: 18,
                        background: toRgba(nextCue?.sectionColor || activeCue?.sectionColor || [249, 115, 22], 0.18),
                        border: `1px solid ${toRgba(nextCue?.sectionColor || activeCue?.sectionColor || [249, 115, 22], 0.28)}`,
                        boxShadow: `inset 0 1px 0 ${toRgba(nextCue?.sectionColor || activeCue?.sectionColor || [249, 115, 22], 0.1)}`,
                      }}
                    >
                      <MonitorChordDisplay
                        chord={nextCuePrimaryChord}
                        fontSize={viewport.width >= 1180 ? 44 : 40}
                        color={toRgba(nextCue?.sectionColor || activeCue?.sectionColor || [249, 115, 22], 0.98)}
                      />
                    </span>
                  </div>
                )}

                {nextCue?.totalCuesInSection > 1 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                    {Array.from({ length: nextCue.totalCuesInSection }, (_, index) => (
                      <span
                        key={`${nextCue.id}-preview-dot-${index}`}
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background:
                            index === nextCue.cueIndex
                              ? toRgba(nextCue.sectionColor, 0.92)
                              : 'rgba(255,255,255,0.16)',
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div
                ref={previewStageRef}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  gap: 8,
                  minWidth: 0,
                  flex: 1,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    transform: `translateZ(0) scale(${previewScale})`,
                    transformOrigin: 'left center',
                    transition: 'transform 170ms cubic-bezier(0.22, 1, 0.36, 1)',
                    willChange: 'transform',
                    width: 'fit-content',
                    maxWidth: '100%',
                  }}
                >
                  <div
                    ref={previewContentRef}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      minWidth: 0,
                      width: 'fit-content',
                      maxWidth: '100%',
                    }}
                  >
                    {nextCuePreviewLines.length > 0 ? (
                      nextCuePreviewLines.map((line, index) => (
                        <div
                          key={`${nextCue?.id || nextCueTitle}-preview-line-${index}`}
                          style={{
                            fontSize:
                              index === 0
                                ? (viewport.width >= 1400 ? 34 : viewport.width >= 1180 ? 31 : 28)
                                : (viewport.width >= 1400 ? 24 : viewport.width >= 1180 ? 22 : 19),
                            lineHeight: index === 0 ? 1.05 : 1.1,
                            fontWeight: index === 0 ? 760 : 620,
                            opacity: index === 0 ? 0.98 : 0.76,
                            wordBreak: 'break-word',
                            overflow: 'hidden',
                            display: '-webkit-box',
                            WebkitLineClamp: index === 0 ? 2 : 2,
                            WebkitBoxOrient: 'vertical',
                          }}
                        >
                          {line}
                        </div>
                      ))
                    ) : (
                      <div style={{ fontSize: 24, opacity: 0.58 }}>
                        Esperando el siguiente cue…
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {showLegacyBottomPreview && (
        <div
          style={{
            height: 60,
            display: 'flex',
            alignItems: 'center',
            padding: '0 40px',
            opacity: 0.36,
            fontSize: displayFontScale.next,
            fontWeight: 400,
            borderTop: '1px solid rgba(255,255,255,0.06)',
            gap: 12,
            overflow: 'hidden',
          }}
        >
          {nextSectionLabel && (
            <span
              style={{
                fontWeight: 800,
                fontSize: 14,
                textTransform: 'uppercase',
                opacity: 0.85,
                flexShrink: 0,
              }}
            >
              → {nextSectionLabel}:
            </span>
          )}
          {nextCuePreviewLines[0] && (
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {nextCuePreviewLines[0]}
            </span>
          )}
        </div>
      )}

      <div
        style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          padding: '0 8px',
          gap: 10,
        }}
      >
        {settings.showSectionMap && activeTrack && (
          <div style={{ flex: 1, display: 'flex', height: 42, padding: '0 6px', gap: 4 }}>
            {activeTrack.sections.map((section, index) => (
              <div
                key={`${activeTrack.songId}-section-${section.index}`}
                style={{
                  flex: 1,
                  minWidth: 0,
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  fontWeight: 800,
                  background:
                    index === activeSectionIndex
                      ? toRgba(section.color, 0.4)
                      : 'rgba(255,255,255,0.06)',
                  color:
                    index === activeSectionIndex
                      ? toRgba(section.color, 1)
                      : 'rgba(255,255,255,0.32)',
                  transition: 'background 300ms, color 300ms',
                }}
              >
                {section.shortLabel}
              </div>
            ))}
          </div>
        )}

        {settings.showCountdown && sectionTimeRemaining != null && (
          <div
            style={{
              width: 120,
              textAlign: 'center',
              fontSize: Math.min(fontScale.countdown, 38),
              fontWeight: 900,
              fontVariantNumeric: 'tabular-nums',
              color: sectionTimeRemaining < 5 ? '#ef4444' : '#f0f0f0',
              animation: sectionTimeRemaining < 5 ? 'confidence-pulse 1s infinite' : 'none',
            }}
          >
            {sectionTimeRemaining}s
          </div>
        )}
      </div>

      <div
        aria-label={`Estado de conexión: ${connectionStatus}`}
        title={`Estado de conexión: ${connectionStatus}`}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          width: 10,
          height: 10,
          borderRadius: '50%',
          background:
            connectionStatus === 'connected'
              ? '#22c55e'
              : connectionStatus === 'stale'
                ? '#f59e0b'
                : '#ef4444',
          transition: 'background 300ms',
        }}
      />

      {showSettings && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.9)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            zIndex: 10,
          }}
        >
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Configuración</h2>

          <div style={{ display: 'flex', gap: 8 }}>
            {['compact', 'standard', 'large'].map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => setSettings((current) => ({ ...current, fontSize: size }))}
                style={{
                  padding: '8px 20px',
                  borderRadius: 8,
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: 14,
                  background:
                    settings.fontSize === size ? '#f0f0f0' : 'rgba(255,255,255,0.1)',
                  color: settings.fontSize === size ? '#0a0a0a' : '#f0f0f0',
                }}
              >
                {size === 'compact' ? 'Compacto' : size === 'standard' ? 'Normal' : 'Grande'}
              </button>
            ))}
          </div>

          {[
            ['showChords', 'Acordes'],
            ['showNextCue', 'Preview siguiente'],
            ['showCountdown', 'Countdown'],
            ['showSectionMap', 'Mapa de secciones'],
            ['showSongInfo', 'Info de canción'],
          ].map(([key, label]) => (
            <label
              key={key}
              style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={Boolean(settings[key])}
                onChange={() =>
                  setSettings((current) => ({
                    ...current,
                    [key]: !current[key],
                  }))
                }
              />
              <span>{label}</span>
            </label>
          ))}

          <button
            type="button"
            onClick={() => setShowSettings(false)}
            style={{
              marginTop: 16,
              padding: '10px 32px',
              borderRadius: 8,
              border: 'none',
              background: '#f0f0f0',
              color: '#0a0a0a',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Cerrar (Esc)
          </button>
        </div>
      )}
    </div>
  );
}
