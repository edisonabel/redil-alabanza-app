import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { screenWakeLockService } from '../../services/ScreenWakeLockService';
import { LiveDirectorView } from './LiveDirectorView';
import {
  buildLiveDirectorSectionsFromMarkers,
  normalizePersistedLiveDirectorSession,
} from '../../utils/liveDirectorSongSession';
import { getPadUrlForSongKey } from '../../utils/padAudio';

const CACHE_NAME = 'repertorio-offline-cache-v1';
const NEXT_SONG_PREWARM_CONCURRENCY = 2;
const ENABLE_AUTO_OFFLINE_CACHE = false;
const AUDIO_SOURCE_URL_RE = /^(https?:\/\/|\/).+\.(mp3|wav|m4a|aac|ogg)(\?.*)?$/i;

const resolveSongId = (song) => String(song?.id || '').trim();
const isAudioSourceUrl = (value = '') => AUDIO_SOURCE_URL_RE.test(String(value || '').trim());

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

const cacheUrlIfNeeded = async (cache, url) => {
  const cached = await cache.match(url);
  if (cached) {
    return;
  }

  const response = await fetch(url);
  if (response.ok) {
    await cache.put(url, response.clone());
  }
};

const warmUrlsWithConcurrency = async (urls, worker, limit = NEXT_SONG_PREWARM_CONCURRENCY) => {
  if (!Array.isArray(urls) || urls.length === 0) {
    return;
  }

  const safeLimit = Math.max(1, Math.min(limit, urls.length));
  let nextIndex = 0;

  const runners = new Array(safeLimit).fill(null).map(async () => {
    while (nextIndex < urls.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(urls[currentIndex], currentIndex);
    }
  });

  await Promise.all(runners);
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
      !('caches' in window)
    ) {
      return;
    }

    const nextSong = ensayoSongs[safeActiveSongIndex + 1];
    const nextSongId = resolveSongId(nextSong);

    if (!nextSong || !nextSongId || prewarmedSongIdsRef.current.has(nextSongId)) {
      return;
    }

    let cancelled = false;

    const prewarmNextSong = async () => {
      const urls = buildSongCacheUrls(nextSong, sessionOverrides[nextSongId]);
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

        await warmUrlsWithConcurrency(
          urlsToWarm,
          async (url) => {
            try {
              await cacheUrlIfNeeded(cache, url);
            } catch (error) {
              console.warn('[ModoEnsayoDirector] No se pudo precalentar la siguiente cancion.', url, error);
            } finally {
              prewarmInFlightUrlsRef.current.delete(url);
            }
          },
          NEXT_SONG_PREWARM_CONCURRENCY,
        );

        if (!cancelled) {
          prewarmedSongIdsRef.current.add(nextSongId);
        }
      } catch (error) {
        console.warn('[ModoEnsayoDirector] Fallo el prewarm de la siguiente cancion.', error);
      }
    };

    void prewarmNextSong();

    return () => {
      cancelled = true;
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
