import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { screenWakeLockService } from '../../services/ScreenWakeLockService';
import { LiveDirectorView } from './LiveDirectorView';
import { useLiveDirectorSyncTransmitter } from '../../hooks/useLiveDirectorSyncTransmitter';
import {
  buildLiveDirectorSectionsFromMarkers,
  normalizePersistedLiveDirectorSession,
} from '../../utils/liveDirectorSongSession';
import { fetchLiveDirectorSongSession } from '../../utils/liveDirectorUploadClient';
import {
  applyLiveDirectorEventMix,
  fetchLiveDirectorEventMix,
  liveDirectorEventMixSignature,
  normalizeLiveDirectorEventMix,
  saveLiveDirectorEventMix,
} from '../../utils/liveDirectorEventMix';
import { getPadUrlForSongKey } from '../../utils/padAudio';
import {
  isNativeLiveDirectorEngineAvailable,
  NativeLiveDirectorEngine,
} from '../../services/NativeLiveDirectorEnginePlugin';

const CACHE_NAME = 'repertorio-offline-cache-v1';
const NEXT_SONG_WEB_PRELOAD_TRACK_LIMIT = 9;
const NEXT_SONG_IOS_PRELOAD_TRACK_LIMIT = 13;
const NEXT_SONG_WEB_PRELOAD_START_DELAY_MS = 2500;
const NEXT_SONG_WEB_PRELOAD_GAP_MS = 900;
const NEXT_SONG_IOS_PRELOAD_START_DELAY_MS = 3500;
const NEXT_SONG_IOS_PRELOAD_GAP_SECONDS = 2;
const ENABLE_AUTO_OFFLINE_CACHE = false;
const AUDIO_SOURCE_URL_RE = /^(https?:\/\/|\/).+\.(mp3|wav|m4a|aac|ogg|flac)(\?.*)?$/i;
const PRELOAD_PAD_TRACK_ID = '__preload-pad__';
const PRELOAD_STEM_PRIORITY_RULES = [
  { rank: 0, pattern: /\b(click|metronom[oe]?)\b/i },
  { rank: 1, pattern: /\b(gu[ií]a|guide|cue|count[- ]?in|count)\b/i },
  { rank: 2, pattern: /\b(bater[ií]a|drum|kick|snare|toms?|overhead|cymbal|hi-?hat|hat|percu)/i },
  { rank: 3, pattern: /\b(bajo|bass)\b/i },
  { rank: 4, pattern: /\b(voz|lead|vocal|voice|singer)\b/i },
  { rank: 5, pattern: /\b(coros?|backing|bv|harmon[ií]a|harmony)\b/i },
  { rank: 6, pattern: /\b(piano|keys?|rhodes|organ[oa]?|synth|wurl)\b/i },
  { rank: 7, pattern: /\b(guit(arra)?|gtr|ac[uú]stica|el[eé]ctrica)\b/i },
  { rank: 8, pattern: /\b(pad|strings?|cuerda|orchestr|viol)/i },
  { rank: 9, pattern: /\b(fx|sfx|efecto|effect)/i },
];

const resolveSongId = (song) => String(song?.id || '').trim();
const isAudioSourceUrl = (value = '') => AUDIO_SOURCE_URL_RE.test(String(value || '').trim());
const isSafariWebBrowser = () => {
  if (typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent || '';
  return /Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS|Edg/i.test(userAgent);
};
const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(new DOMException('Preload cancelled', 'AbortError'));
    return;
  }

  const timeoutId = window.setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => {
    window.clearTimeout(timeoutId);
    reject(new DOMException('Preload cancelled', 'AbortError'));
  }, { once: true });
});

const preloadStemPriorityRank = (track) => {
  const haystack = `${track?.name || ''} ${track?.id || ''}`.toLowerCase();
  for (const rule of PRELOAD_STEM_PRIORITY_RULES) {
    if (rule.pattern.test(haystack)) return rule.rank;
  }
  return 10;
};

const selectPreloadTracks = (tracks, limit) => {
  const safeLimit = Math.max(1, Math.floor(Number(limit) || tracks.length || 1));
  if (!Array.isArray(tracks) || tracks.length <= safeLimit) {
    return tracks || [];
  }

  const ranked = tracks
    .map((track, index) => ({ track, index, rank: preloadStemPriorityRank(track) }))
    .sort((a, b) => (a.rank - b.rank) || (a.index - b.index));
  const kept = ranked.slice(0, safeLimit);
  kept.sort((a, b) => a.index - b.index);
  return kept.map((entry) => entry.track);
};

const normalizePreloadTrack = (track, index) => {
  const url = String(track?.url || '').trim();
  if (!url) return null;

  return {
    id: String(track?.id || `preload-${index}-${url}`).trim(),
    name: String(track?.name || track?.sourceFileName || `Stem ${index + 1}`).trim(),
    url,
    iosUrl: String(track?.iosUrl || '').trim() || undefined,
    nativeUrl: String(track?.nativeUrl || '').trim() || undefined,
    optimizedUrl: String(track?.optimizedUrl || '').trim() || undefined,
    cafUrl: String(track?.cafUrl || '').trim() || undefined,
    pcmUrl: String(track?.pcmUrl || '').trim() || undefined,
    volume: Number.isFinite(Number(track?.volume)) ? Number(track.volume) : 1,
    isMuted: Boolean(track?.isMuted),
    enabled: track?.enabled !== false,
    sourceFileName: String(track?.sourceFileName || '').trim() || undefined,
    outputRoute: String(track?.outputRoute || '').trim() || undefined,
  };
};

const normalizePlaybackSourceEntry = (entry, index, fallbackKind = 'sequence') => {
  if (!entry) return null;

  if (typeof entry === 'string') {
    const trimmedValue = entry.trim();
    if (!isAudioSourceUrl(trimmedValue)) return null;

    return {
      id: `${fallbackKind}-${index}-${trimmedValue}`,
      label: fallbackKind === 'original' ? 'Musica original' : `Secuencia ${index + 1}`,
      url: trimmedValue,
      kind: fallbackKind,
    };
  }

  if (typeof entry === 'object') {
    const rawUrl = String(entry.url || entry.src || entry.href || entry.link || '').trim();
    if (!isAudioSourceUrl(rawUrl)) return null;

    const kind = String(entry.kind || entry.type || fallbackKind || 'sequence').trim().toLowerCase() === 'original'
      ? 'original'
      : 'sequence';
    const label = String(
      entry.label || entry.name || entry.title || (kind === 'original' ? 'Musica original' : `Secuencia ${index + 1}`),
    ).trim();

    return {
      id: String(entry.id || `${kind}-${index}-${rawUrl}`),
      label,
      url: rawUrl,
      kind,
    };
  }

  return null;
};

const parseSequenceSourceEntries = (rawValue = '') => {
  const source = String(rawValue || '').trim();
  if (!source) return [];

  if (source.startsWith('[') || source.startsWith('{')) {
    try {
      const parsedValue = JSON.parse(source);
      return Array.isArray(parsedValue) ? parsedValue : parsedValue && typeof parsedValue === 'object' ? [parsedValue] : [];
    } catch {
      return [];
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
      return rest.length === 0 ? line : { label: maybeLabel.trim(), url: rest.join('|').trim() };
    });
};

const buildLegacySequenceSession = (song) => {
  const rawSequenceSources = song?.linkSecuencias || song?.link_secuencias || '';
  const normalizedEntries = parseSequenceSourceEntries(rawSequenceSources)
    .map((entry, index) => normalizePlaybackSourceEntry(entry, index, 'sequence'))
    .filter(Boolean);

  const firstSequence = normalizedEntries[0];
  if (!firstSequence) {
    return null;
  }

  return {
    version: 1,
    songId: resolveSongId(song),
    songTitle: String(song?.title || song?.titulo || '').trim(),
    mode: 'sequence',
    sectionOffsetSeconds: 0,
    folder: '',
    manifestUrl: '',
    updatedAt: '',
    tracks: [
      {
        id: 'sequence-main',
        name: firstSequence.label || 'Secuencia',
        url: firstSequence.url,
        volume: 1,
        isMuted: false,
      },
    ],
    unmatchedFiles: [],
  };
};

const resolveSongSession = (song, sessionOverride = null) => {
  const songId = resolveSongId(song);
  const songTitle = String(song?.title || song?.titulo || '').trim();

  return normalizePersistedLiveDirectorSession(sessionOverride || song?.multitrackSession || null, {
    songId,
    songTitle,
  }) || buildLegacySequenceSession(song);
};

const buildSongCacheUrls = (song, sessionOverride = null) => {
  if (!song) return [];

  const audioUrl = typeof song?.mp3 === 'string' ? song.mp3.trim() : '';
  const padUrl = getPadUrlForSongKey(song?.originalKey || song?.key);
  const session = resolveSongSession(song, sessionOverride);
  const sessionUrls = Array.isArray(session?.tracks)
    ? session.tracks.map((track) => String(track?.url || '').trim()).filter(Boolean)
    : [];

  return Array.from(new Set([audioUrl, padUrl, ...sessionUrls].filter(Boolean)));
};

const buildSongPreloadTracks = (song, sessionOverride = null, { limit = 11, includePad = true } = {}) => {
  if (!song) return [];

  const session = resolveSongSession(song, sessionOverride);
  const sessionTracks = Array.isArray(session?.tracks)
    ? session.tracks
      .filter((track) => track?.enabled !== false)
      .map(normalizePreloadTrack)
      .filter(Boolean)
    : [];
  const fallbackAudioUrl = typeof song?.mp3 === 'string' ? song.mp3.trim() : '';
  const sourceTracks = sessionTracks.length > 0 || !fallbackAudioUrl
    ? sessionTracks
    : [{
      id: 'preload-main-audio',
      name: 'Audio principal',
      url: fallbackAudioUrl,
      nativeUrl: fallbackAudioUrl,
      volume: 1,
      isMuted: false,
      enabled: true,
    }];
  const selectedTracks = selectPreloadTracks(sourceTracks, limit);
  const padUrl = includePad ? getPadUrlForSongKey(song?.originalKey || song?.key) : '';

  if (!padUrl) {
    return selectedTracks;
  }

  return [
    ...selectedTracks,
    {
      id: PRELOAD_PAD_TRACK_ID,
      name: 'Pad siguiente',
      url: padUrl,
      nativeUrl: padUrl,
      volume: 0,
      isMuted: false,
      enabled: true,
    },
  ];
};

const hasPreloadableMultitrackSession = (song, sessionOverride = null) => {
  const session = resolveSongSession(song, sessionOverride);
  return Array.isArray(session?.tracks) && session.tracks.some((track) => (
    track?.enabled !== false && String(track?.url || '').trim()
  ));
};

const findNextPreloadableSong = (songs, startIndex, sessionOverrides) => {
  for (let index = startIndex + 1; index < songs.length; index += 1) {
    const song = songs[index];
    const songId = resolveSongId(song);
    if (!song || !songId) continue;
    if (hasPreloadableMultitrackSession(song, sessionOverrides[songId])) {
      return { song, songId };
    }
  }

  return { song: null, songId: '' };
};

const buildSessionTrackSignature = (session) => (
  Array.isArray(session?.tracks)
    ? session.tracks
      .map((track) => [
        String(track?.id || '').trim(),
        String(track?.url || '').trim(),
        track?.enabled !== false ? '1' : '0',
        Number.isFinite(Number(track?.volume)) ? Number(track.volume).toFixed(4) : '1',
        track?.isMuted ? '1' : '0',
        String(track?.outputRoute || '').trim(),
      ].join(':'))
      .join('|')
    : ''
);

const shouldUseFetchedSession = (currentSession, fetchedSession) => {
  if (!fetchedSession?.tracks?.length) {
    return false;
  }

  if (!currentSession?.tracks?.length) {
    return true;
  }

  const currentUpdatedAt = String(currentSession?.updatedAt || '').trim();
  const fetchedUpdatedAt = String(fetchedSession?.updatedAt || '').trim();

  if (currentUpdatedAt && fetchedUpdatedAt && currentUpdatedAt === fetchedUpdatedAt) {
    return false;
  }

  return buildSessionTrackSignature(currentSession) !== buildSessionTrackSignature(fetchedSession);
};

const cacheUrlIfNeeded = async (cache, url, signal) => {
  const cached = await cache.match(url);
  if (cached) {
    return 'hit';
  }

  const response = await fetch(url, { cache: 'force-cache', signal });
  if (response.ok || response.type === 'opaque') {
    await cache.put(url, response.clone());
    return 'stored';
  }

  return 'skipped';
};

const buildQueueSongs = (songs) =>
  songs
    .map((song) => ({
      id: resolveSongId(song),
      title: String(song?.title || song?.titulo || 'Cancion').trim() || 'Cancion',
      subtitle: [String(song?.artist || '').trim(), String(song?.originalKey || song?.key || '').trim()].filter(Boolean).join(' · '),
      mp3: String(song?.mp3 || '').trim(),
    }));

export default function ModoEnsayoDirector({
  playlist = [],
  contextTitle = 'Modo Ensayo',
  eventId = '',
  playlistId = '',
  onExit,
}) {
  const ensayoSongs = useMemo(
    () =>
      (Array.isArray(playlist) ? playlist : []).filter((song) => {
        const hasMp3 = typeof song?.mp3 === 'string' && song.mp3.trim() !== '';
        const hasSession = Boolean(song?.multitrackSession?.tracks?.length);
        const hasLegacySequence = Boolean(buildLegacySequenceSession(song)?.tracks?.length);
        return hasMp3 || hasSession || hasLegacySequence;
      }),
    [playlist],
  );
  const [activeSongIndex, setActiveSongIndex] = useState(0);
  const [downloadStatus, setDownloadStatus] = useState({ active: false, progress: 0, total: 0, done: false });
  const [padVolume, setPadVolume] = useState(0.42);
  const [sessionOverrides, setSessionOverrides] = useState({});
  const [eventMixOverrides, setEventMixOverrides] = useState({});
  const [eventMixLoadedSongIds, setEventMixLoadedSongIds] = useState(() => new Set());
  const [eventMixSaveStates, setEventMixSaveStates] = useState({});
  const playbackSnapshotRef = useRef({
    songId: '',
    sectionIndex: 0,
    currentTime: 0,
    currentTimeRaw: 0,
    sectionOffsetSeconds: 0,
    isPlaying: false,
  });
  const autoCacheStartedRef = useRef(false);
  const prewarmedSongIdsRef = useRef(new Set());
  const prewarmInFlightUrlsRef = useRef(new Set());
  const eventMixSaveQueueRef = useRef(Promise.resolve());
  const eventMixSaveVersionsRef = useRef({});
  const eventMixStatusTimersRef = useRef(new Map());
  const queueSelectionTokenRef = useRef(0);
  const takeoverCancelButtonRef = useRef(null);
  const {
    broadcastState,
    cancelTakeover,
    confirmTakeover,
    isBroadcasting,
    sendSectionChange,
    statusNotice: syncStatusNotice,
    takeoverPromptOpen,
    toggleBroadcasting,
  } = useLiveDirectorSyncTransmitter({ eventId, playlistId });

  const safeActiveSongIndex = Math.max(0, Math.min(activeSongIndex, Math.max(ensayoSongs.length - 1, 0)));
  const activeSong = ensayoSongs[safeActiveSongIndex] || null;
  const activeSongId = resolveSongId(activeSong);
  const activeSongSessionSource = activeSongId
    ? sessionOverrides[activeSongId] || activeSong?.multitrackSession || null
    : null;
  const activeEventMix = activeSongId
    ? eventMixOverrides[activeSongId] || null
    : null;
  const activeSongSession = useMemo(
    () => applyLiveDirectorEventMix(
      resolveSongSession(activeSong, activeSongSessionSource),
      activeEventMix,
    ),
    [activeEventMix, activeSong, activeSongId, activeSongSessionSource],
  );
  const activeSongSections = useMemo(
    () => buildLiveDirectorSectionsFromMarkers(activeSong?.sectionMarkers || []) || undefined,
    [activeSong?.sectionMarkers],
  );
  const queueSongs = useMemo(
    () => buildQueueSongs(ensayoSongs),
    [ensayoSongs],
  );
  const operationalChips = useMemo(() => {
    const liveStatus = broadcastState === 'active'
      ? { value: 'Enviando', tone: 'success', active: true }
      : broadcastState === 'occupied'
        ? { value: 'Ocupado', tone: 'info', active: false }
        : broadcastState === 'checking'
          ? { value: 'Espera', tone: 'info', active: false }
          : broadcastState === 'unavailable'
            ? { value: 'Sin red', tone: 'neutral', active: false }
            : { value: 'Local', tone: 'neutral', active: false };
    const chips = [
      {
        id: 'sync',
        label: 'LIVE',
        ...liveStatus,
      },
    ];

    if (ENABLE_AUTO_OFFLINE_CACHE && downloadStatus.active) {
      chips.unshift({
        id: 'offline',
        label: 'Cache',
        value: `${downloadStatus.progress}/${downloadStatus.total}`,
        tone: 'neutral',
        active: false,
      });
    }

    return chips;
  }, [broadcastState, downloadStatus.active, downloadStatus.done, downloadStatus.progress, downloadStatus.total]);

  const hasEventMixContext = Boolean(String(eventId || '').trim() && String(playlistId || '').trim());
  const activeEventMixSaveStatus = eventMixSaveStates[activeSongId] || 'idle';
  const isActiveEventMixLoading = Boolean(
    hasEventMixContext && activeSongId && !eventMixLoadedSongIds.has(activeSongId),
  );

  useEffect(() => () => {
    eventMixStatusTimersRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    eventMixStatusTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!takeoverPromptOpen) return undefined;
    const focusFrame = window.requestAnimationFrame(() => {
      takeoverCancelButtonRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [takeoverPromptOpen]);

  useEffect(() => {
    if (!activeSongId) {
      return;
    }

    let cancelled = false;

    const refreshPersistedSession = async () => {
      try {
        const fetchedSession = await fetchLiveDirectorSongSession(activeSongId);
        if (cancelled || !fetchedSession?.tracks?.length) {
          return;
        }

        setSessionOverrides((previous) => {
          const currentSession = previous[activeSongId] || activeSong?.multitrackSession || null;
          if (!shouldUseFetchedSession(currentSession, fetchedSession)) {
            return previous;
          }

          return {
            ...previous,
            [activeSongId]: fetchedSession,
          };
        });
      } catch (error) {
        if (!cancelled) {
          console.warn('[ModoEnsayoDirector] No se pudo refrescar la sesion multitrack guardada.', error);
        }
      }
    };

    void refreshPersistedSession();

    return () => {
      cancelled = true;
    };
  }, [activeSong?.multitrackSession, activeSongId]);

  useEffect(() => {
    if (!hasEventMixContext || !activeSongId || eventMixLoadedSongIds.has(activeSongId)) return;

    let cancelled = false;
    void fetchLiveDirectorEventMix({ eventId, songId: activeSongId })
      .then((fetchedMix) => {
        if (cancelled || !fetchedMix) return;
        setEventMixOverrides((previous) => {
          const currentMix = previous[activeSongId] || null;
          if (liveDirectorEventMixSignature(currentMix) === liveDirectorEventMixSignature(fetchedMix)) {
            return previous;
          }
          return { ...previous, [activeSongId]: fetchedMix };
        });
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn('[ModoEnsayoDirector] No se pudo refrescar la mezcla del evento.', error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setEventMixLoadedSongIds((previous) => {
            if (previous.has(activeSongId)) return previous;
            const next = new Set(previous);
            next.add(activeSongId);
            return next;
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeSongId, eventId, eventMixLoadedSongIds, hasEventMixContext]);

  useEffect(() => {
    screenWakeLockService.setRequested('modo-ensayo-director', true);
    return () => {
      screenWakeLockService.setRequested('modo-ensayo-director', false);
    };
  }, []);

  useEffect(() => {
    if (ensayoSongs.length === 0) {
      return;
    }

    setActiveSongIndex((previous) => Math.max(0, Math.min(previous, ensayoSongs.length - 1)));
  }, [ensayoSongs.length]);

  useEffect(() => {
    if (!ENABLE_AUTO_OFFLINE_CACHE) {
      return;
    }

    if (ensayoSongs.length === 0 || autoCacheStartedRef.current || typeof window === 'undefined' || !('caches' in window)) {
      return;
    }

    autoCacheStartedRef.current = true;
    let cancelled = false;

    const cacheSetlist = async () => {
      const audiosToCache = Array.from(
        new Set(
          ensayoSongs.flatMap((song) => buildSongCacheUrls(song)),
        ),
      );

      if (audiosToCache.length === 0) {
        setDownloadStatus({ active: false, progress: 0, total: 0, done: false });
        return;
      }

      setDownloadStatus({ active: true, progress: 0, total: audiosToCache.length, done: false });

      try {
        const cache = await window.caches.open(CACHE_NAME);
        let progress = 0;

        for (const url of audiosToCache) {
          if (cancelled) {
            return;
          }

          try {
            await cacheUrlIfNeeded(cache, url);
          } catch (error) {
            console.warn('[ModoEnsayoDirector] No se pudo cachear recurso.', url, error);
          }

          progress += 1;
          setDownloadStatus((previous) => ({ ...previous, progress }));
        }

        if (!cancelled) {
          setDownloadStatus((previous) => ({ ...previous, active: false, done: true }));
        }
      } catch (error) {
        console.warn('[ModoEnsayoDirector] Fallo el cache offline.', error);
        if (!cancelled) {
          setDownloadStatus({ active: false, progress: 0, total: 0, done: false });
        }
      }
    };

    void cacheSetlist();

    return () => {
      cancelled = true;
    };
  }, [ensayoSongs]);

  useEffect(() => {
    if (
      ensayoSongs.length === 0 ||
      typeof window === 'undefined' ||
      !isNativeLiveDirectorEngineAvailable()
    ) {
      return;
    }

    const { song: nextSong, songId: nextSongId } = findNextPreloadableSong(
      ensayoSongs,
      safeActiveSongIndex,
      sessionOverrides,
    );

    if (!nextSong || !nextSongId || prewarmedSongIdsRef.current.has(nextSongId)) {
      return;
    }

    const abortController = new AbortController();
    let cancelled = false;

    const preloadNextSongNative = async () => {
      try {
        await wait(NEXT_SONG_IOS_PRELOAD_START_DELAY_MS, abortController.signal);

        const preloadTracks = buildSongPreloadTracks(nextSong, sessionOverrides[nextSongId], {
          limit: NEXT_SONG_IOS_PRELOAD_TRACK_LIMIT,
          includePad: true,
        });

        if (preloadTracks.length === 0) {
          prewarmedSongIdsRef.current.add(nextSongId);
          return;
        }

        const result = await NativeLiveDirectorEngine.preloadTracks({
          tracks: preloadTracks,
          gapSeconds: NEXT_SONG_IOS_PRELOAD_GAP_SECONDS,
        });

        if (!cancelled && !result.cancelled) {
          prewarmedSongIdsRef.current.add(nextSongId);
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.warn('[ModoEnsayoDirector] Fallo la precarga nativa de la siguiente cancion.', error);
        }
      }
    };

    void preloadNextSongNative();

    return () => {
      cancelled = true;
      abortController.abort();
      void NativeLiveDirectorEngine.cancelPreload().catch(() => undefined);
    };
  }, [ensayoSongs, safeActiveSongIndex, sessionOverrides]);

  useEffect(() => {
    if (
      ensayoSongs.length === 0 ||
      typeof window === 'undefined' ||
      !('caches' in window) ||
      isNativeLiveDirectorEngineAvailable() ||
      isSafariWebBrowser()
    ) {
      return;
    }

    const { song: nextSong, songId: nextSongId } = findNextPreloadableSong(
      ensayoSongs,
      safeActiveSongIndex,
      sessionOverrides,
    );

    if (!nextSong || !nextSongId || prewarmedSongIdsRef.current.has(nextSongId)) {
      return;
    }

    const abortController = new AbortController();
    let cancelled = false;

    const prewarmNextSong = async () => {
      await wait(NEXT_SONG_WEB_PRELOAD_START_DELAY_MS, abortController.signal);

      const preloadTracks = buildSongPreloadTracks(nextSong, sessionOverrides[nextSongId], {
        limit: NEXT_SONG_WEB_PRELOAD_TRACK_LIMIT,
        includePad: true,
      });
      const urls = Array.from(new Set(preloadTracks.map((track) => track.url).filter(Boolean)));
      if (urls.length === 0) {
        prewarmedSongIdsRef.current.add(nextSongId);
        return;
      }

      try {
        const cache = await window.caches.open(CACHE_NAME);
        const urlsToWarm = urls.filter((url) => !prewarmInFlightUrlsRef.current.has(url));

        if (urlsToWarm.length === 0) {
          return;
        }

        urlsToWarm.forEach((url) => prewarmInFlightUrlsRef.current.add(url));

        for (const url of urlsToWarm) {
          if (cancelled || abortController.signal.aborted) {
            return;
          }

          try {
            await cacheUrlIfNeeded(cache, url, abortController.signal);
          } catch (error) {
            if (!abortController.signal.aborted) {
              console.warn('[ModoEnsayoDirector] No se pudo precalentar la siguiente cancion.', url, error);
            }
          } finally {
            prewarmInFlightUrlsRef.current.delete(url);
          }

          await wait(NEXT_SONG_WEB_PRELOAD_GAP_MS, abortController.signal);
        }

        if (!cancelled) {
          prewarmedSongIdsRef.current.add(nextSongId);
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.warn('[ModoEnsayoDirector] Fallo el prewarm de la siguiente cancion.', error);
        }
      }
    };

    void prewarmNextSong();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [ensayoSongs, safeActiveSongIndex, sessionOverrides]);

  useEffect(() => {
    if (!isBroadcasting || !activeSongId) {
      return;
    }

    const pushSnapshot = () => {
      const snapshot = playbackSnapshotRef.current;
      if (!snapshot.songId) {
        return;
      }

      sendSectionChange({
        songId: snapshot.songId,
        sectionIndex: snapshot.sectionIndex,
        currentTime: snapshot.currentTime,
        currentTimeRaw: snapshot.currentTimeRaw,
        sectionOffsetSeconds: snapshot.sectionOffsetSeconds || 0,
        isPlaying: snapshot.isPlaying,
      }).catch((error) => {
        console.warn('[ModoEnsayoDirector] Sync broadcast failed.', error);
      });
    };

    pushSnapshot();
    const heartbeat = window.setInterval(pushSnapshot, 1500);
    return () => window.clearInterval(heartbeat);
  }, [activeSongId, isBroadcasting, sendSectionChange]);

  const handlePlaybackSnapshot = useCallback((snapshot) => {
    playbackSnapshotRef.current = snapshot;
  }, []);

  const handleQueueSongSelect = useCallback((songId) => {
    const nextSongId = String(songId || '').trim();
    const nextIndex = ensayoSongs.findIndex((song) => resolveSongId(song) === nextSongId);
    if (nextIndex === -1) {
      return;
    }

    const selectionToken = queueSelectionTokenRef.current + 1;
    queueSelectionTokenRef.current = selectionToken;

    if (!hasEventMixContext || eventMixLoadedSongIds.has(nextSongId)) {
      setActiveSongIndex(nextIndex);
      return;
    }

    void (async () => {
      let fetchedMix = null;

      try {
        fetchedMix = await fetchLiveDirectorEventMix({ eventId, songId: nextSongId });
      } catch (error) {
        console.warn('[ModoEnsayoDirector] No se pudo preparar la mezcla de la siguiente cancion.', error);
      }

      if (queueSelectionTokenRef.current !== selectionToken) {
        return;
      }

      if (fetchedMix) {
        setEventMixOverrides((previous) => ({ ...previous, [nextSongId]: fetchedMix }));
      }
      setEventMixLoadedSongIds((previous) => {
        if (previous.has(nextSongId)) return previous;
        const next = new Set(previous);
        next.add(nextSongId);
        return next;
      });
      setActiveSongIndex(nextIndex);
    })();
  }, [ensayoSongs, eventId, eventMixLoadedSongIds, hasEventMixContext]);

  const handleSessionPersisted = useCallback((session) => {
    const songId = String(session?.songId || '').trim();
    if (!songId) {
      return;
    }

    setSessionOverrides((previous) => ({
      ...previous,
      [songId]: session,
    }));
  }, []);

  const handleEventMixChange = useCallback((rawMix) => {
    const songId = activeSongId;
    const mix = normalizeLiveDirectorEventMix(rawMix);
    if (!hasEventMixContext || !songId || !mix) {
      return Promise.resolve();
    }

    setEventMixOverrides((previous) => ({ ...previous, [songId]: mix }));
    setEventMixLoadedSongIds((previous) => {
      if (previous.has(songId)) return previous;
      const next = new Set(previous);
      next.add(songId);
      return next;
    });

    const nextVersion = Number(eventMixSaveVersionsRef.current[songId] || 0) + 1;
    eventMixSaveVersionsRef.current[songId] = nextVersion;
    setEventMixSaveStates((previous) => ({ ...previous, [songId]: 'saving' }));

    const existingTimer = eventMixStatusTimersRef.current.get(songId);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
      eventMixStatusTimersRef.current.delete(songId);
    }

    const saveTask = eventMixSaveQueueRef.current
      .catch(() => undefined)
      .then(() => saveLiveDirectorEventMix({ eventId, songId, mix }));

    eventMixSaveQueueRef.current = saveTask.then(
      () => undefined,
      () => undefined,
    );

    return saveTask
      .then((savedMix) => {
        if (eventMixSaveVersionsRef.current[songId] !== nextVersion) return;

        if (savedMix) {
          setEventMixOverrides((previous) => ({ ...previous, [songId]: savedMix }));
        }
        setEventMixSaveStates((previous) => ({ ...previous, [songId]: 'saved' }));
        const timeoutId = window.setTimeout(() => {
          eventMixStatusTimersRef.current.delete(songId);
          if (eventMixSaveVersionsRef.current[songId] !== nextVersion) return;
          setEventMixSaveStates((previous) => ({ ...previous, [songId]: 'idle' }));
        }, 2400);
        eventMixStatusTimersRef.current.set(songId, timeoutId);
      })
      .catch((error) => {
        if (eventMixSaveVersionsRef.current[songId] === nextVersion) {
          setEventMixSaveStates((previous) => ({ ...previous, [songId]: 'error' }));
        }
        throw error;
      });
  }, [activeSongId, eventId, hasEventMixContext]);

  if (!activeSong || isActiveEventMixLoading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-[#202223] text-white">
        <p className="text-sm text-white/60">
          {activeSong ? 'Cargando stems...' : 'No hay canciones listas para Modo Ensayo Director.'}
        </p>
      </div>
    );
  }

  return (
    <>
      <LiveDirectorView
        mode="ensayo"
        songId={activeSongId}
        songTitle={String(activeSong?.title || '').trim()}
        subtitle={String(activeSong?.artist || activeSong?.cantante || '').trim()}
        songMp3={String(activeSong?.mp3 || '').trim()}
        songKey={String(activeSong?.originalKey || activeSong?.key || '').trim()}
        sections={activeSongSections}
        initialSession={activeSongSession}
        queueSongs={queueSongs}
        activeQueueSongId={activeSongId}
        onSelectQueueSong={handleQueueSongSelect}
        operationalChips={operationalChips}
        liveBroadcastState={broadcastState}
        onToggleLiveBroadcast={toggleBroadcasting}
        internalPadVolume={padVolume}
        onInternalPadVolumeChange={setPadVolume}
        onPlaybackSnapshot={handlePlaybackSnapshot}
        onSessionPersisted={handleSessionPersisted}
        onEventMixChange={hasEventMixContext ? handleEventMixChange : undefined}
        eventMixSaveStatus={activeEventMixSaveStatus}
        onBack={onExit}
        backLabel="Volver al modo ensayo"
        title={`Modo Ensayo - ${contextTitle}`}
        bpm={Number(activeSong?.bpm || 0)}
      />

      {takeoverPromptOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/72 px-5 backdrop-blur-sm" role="presentation">
          <div
            className="w-full max-w-md rounded-[1.8rem] border border-amber-300/24 bg-[linear-gradient(180deg,rgba(31,27,19,0.98),rgba(18,17,15,0.98))] p-6 text-white shadow-[0_28px_80px_rgba(0,0,0,0.48)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="live-takeover-title"
            aria-describedby="live-takeover-description"
            onKeyDown={(event) => {
              if (event.key === 'Escape') cancelTakeover();
            }}
          >
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-amber-300/25 bg-amber-300/10 text-sm font-black tracking-[0.08em] text-amber-100">
                LIVE
              </span>
              <div>
                <p className="text-[0.66rem] font-black uppercase tracking-[0.24em] text-amber-200/62">Control ocupado</p>
                <h2 id="live-takeover-title" className="mt-1 text-xl font-black tracking-tight">Otro dispositivo está enviando</h2>
              </div>
            </div>
            <p id="live-takeover-description" className="mt-4 text-sm leading-relaxed text-white/66">
              Puedes seguir usando Live Director localmente o tomar el control de la señal para este ensayo.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                ref={takeoverCancelButtonRef}
                type="button"
                onClick={cancelTakeover}
                className="ui-pressable-soft h-12 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-black text-white/78 hover:bg-white/9 hover:text-white"
              >
                Seguir local
              </button>
              <button
                type="button"
                onClick={confirmTakeover}
                className="ui-pressable-soft h-12 rounded-2xl border border-rose-300/28 bg-rose-500/16 px-4 text-sm font-black text-rose-50 shadow-[0_0_20px_rgba(244,63,94,0.12)] hover:bg-rose-500/24"
              >
                Tomar LIVE
              </button>
            </div>
          </div>
        </div>
      )}

      {syncStatusNotice && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-[121] flex justify-center px-4" role="status" aria-live="polite">
          <div className="rounded-full border border-white/12 bg-zinc-950/92 px-4 py-2.5 text-xs font-black tracking-[0.04em] text-white shadow-[0_16px_42px_rgba(0,0,0,0.42)] backdrop-blur-xl">
            {syncStatusNotice}
          </div>
        </div>
      )}
    </>
  );
}
