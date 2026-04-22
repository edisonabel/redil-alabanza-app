import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { screenWakeLockService } from '../../services/ScreenWakeLockService';
import { LiveDirectorView } from './LiveDirectorView';
import {
  buildLiveDirectorSectionsFromMarkers,
  normalizePersistedLiveDirectorSession,
} from '../../utils/liveDirectorSongSession';
import { fetchLiveDirectorSongSession } from '../../utils/liveDirectorUploadClient';
import { getPadUrlForSongKey } from '../../utils/padAudio';
import {
  isNativeLiveDirectorEngineAvailable,
  NativeLiveDirectorEngine,
} from '../../services/NativeLiveDirectorEnginePlugin';

const CACHE_NAME = 'repertorio-offline-cache-v1';
const NEXT_SONG_WEB_PRELOAD_TRACK_LIMIT = 11;
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

export default function ModoEnsayoDirector({ playlist = [], contextTitle = 'Modo Ensayo', onExit }) {
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
  const [syncConnected, setSyncConnected] = useState(false);
  const [sessionOverrides, setSessionOverrides] = useState({});
  const playbackSnapshotRef = useRef({
    songId: '',
    sectionIndex: 0,
    currentTime: 0,
    currentTimeRaw: 0,
    sectionOffsetSeconds: 0,
    isPlaying: false,
  });
  const syncChannelRef = useRef(null);
  const autoCacheStartedRef = useRef(false);
  const prewarmedSongIdsRef = useRef(new Set());
  const prewarmInFlightUrlsRef = useRef(new Set());

  const safeActiveSongIndex = Math.max(0, Math.min(activeSongIndex, Math.max(ensayoSongs.length - 1, 0)));
  const activeSong = ensayoSongs[safeActiveSongIndex] || null;
  const activeSongId = resolveSongId(activeSong);
  const activeSongSessionSource = activeSongId
    ? sessionOverrides[activeSongId] || activeSong?.multitrackSession || null
    : null;
  const activeSongSession = useMemo(
    () => resolveSongSession(activeSong, activeSongSessionSource),
    [activeSong, activeSongId, activeSongSessionSource],
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
    const chips = [
      {
        id: 'sync',
        label: 'Sync',
        value: syncConnected ? 'Activa' : 'Espera',
        tone: 'info',
        active: syncConnected,
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
  }, [downloadStatus.active, downloadStatus.done, downloadStatus.progress, downloadStatus.total, syncConnected]);

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

    const nextSong = ensayoSongs[safeActiveSongIndex + 1];
    const nextSongId = resolveSongId(nextSong);

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
      isNativeLiveDirectorEngineAvailable()
    ) {
      return;
    }

    const nextSong = ensayoSongs[safeActiveSongIndex + 1];
    const nextSongId = resolveSongId(nextSong);

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
    const channel = supabase.channel('ensayo-live-sync', {
      config: { broadcast: { self: false } },
    });

    channel.on('broadcast', { event: 'DIRECTOR_CLAIMED' }, () => {
      alert('Otro dispositivo ha tomado el control remoto del Modo Director. Has sido desconectado para evitar conflictos.');
      if (typeof onExit === 'function') {
        onExit();
      }
    });

    channel.subscribe((status) => {
      setSyncConnected(status === 'SUBSCRIBED');
      if (status === 'SUBSCRIBED') {
        channel.send({
          type: 'broadcast',
          event: 'DIRECTOR_CLAIMED',
          payload: { timestamp: Date.now() },
        }).catch((error) => console.warn('[ModoEnsayoDirector] Failed to claim director lock.', error));
      }
    });

    syncChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      syncChannelRef.current = null;
      setSyncConnected(false);
    };
  }, []);

  useEffect(() => {
    if (!syncConnected || !syncChannelRef.current || !activeSongId) {
      return;
    }

    const pushSnapshot = () => {
      const snapshot = playbackSnapshotRef.current;
      if (!snapshot.songId) {
        return;
      }

      syncChannelRef.current.send({
        type: 'broadcast',
        event: 'SECTION_CHANGE',
        payload: {
          songId: snapshot.songId,
          sectionIndex: snapshot.sectionIndex,
          currentTime: snapshot.currentTime,
          currentTimeRaw: snapshot.currentTimeRaw,
          sectionOffsetSeconds: snapshot.sectionOffsetSeconds || 0,
          isPlaying: snapshot.isPlaying,
        },
      }).catch((error) => {
        console.warn('[ModoEnsayoDirector] Sync broadcast failed.', error);
      });
    };

    pushSnapshot();
    const heartbeat = window.setInterval(pushSnapshot, 1500);
    return () => window.clearInterval(heartbeat);
  }, [activeSongId, syncConnected]);

  const handlePlaybackSnapshot = useCallback((snapshot) => {
    playbackSnapshotRef.current = snapshot;
  }, []);

  const handleQueueSongSelect = useCallback((songId) => {
    const nextIndex = ensayoSongs.findIndex((song) => resolveSongId(song) === String(songId || '').trim());
    if (nextIndex !== -1) {
      setActiveSongIndex(nextIndex);
    }
  }, [ensayoSongs]);

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

  if (!activeSong) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-[#202223] text-white">
        <p className="text-sm text-white/60">No hay canciones listas para Modo Ensayo Director.</p>
      </div>
    );
  }

  return (
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
      internalPadVolume={padVolume}
      onInternalPadVolumeChange={setPadVolume}
      onPlaybackSnapshot={handlePlaybackSnapshot}
      onSessionPersisted={handleSessionPersisted}
      title={`Modo Ensayo - ${contextTitle}`}
      bpm={Number(activeSong?.bpm || 0)}
    />
  );
}
