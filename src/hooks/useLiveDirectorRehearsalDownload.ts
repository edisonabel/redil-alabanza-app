import { useCallback, useEffect, useRef, useState } from 'react';
import type { TrackData } from '../services/MultitrackEngine';
import type { DeviceDownloadProgress, DeviceDownloadResult } from '../services/StreamingMultitrackEngine';
import { pruneRehearsalDataExcept } from '../utils/rehearsalDeviceData';

// Must match STEM_BLOCK_CACHE_NAME and stemRehearsalKey() in AudioProducerWorker.js.
const STEM_BLOCK_CACHE_NAME = 'live-director-stem-blocks-v1';
const savedRehearsalKey = () => `${window.location.origin}/__stem-block-cache/rehearsal`;

type SavedRehearsal = { rehearsalId: string | null; songIds: string[]; totalBytes: number; completedAt: number };
export type RehearsalDownloadState =
  | { phase: 'idle' }
  | { phase: 'resolving' }
  | { phase: 'downloading'; progress: number; held: boolean }
  | { phase: 'saved'; totalBytes: number }
  | { phase: 'error'; message: string };

type Options = {
  enabled: boolean;
  /** Descarga sola al abrir el ensayo si aún no está en el equipo (una vez; cancelarla la deja así). */
  autoStart?: boolean;
  rehearsalId: string | null;
  songIds: string[];
  resolveTracks?: (songId: string) => Promise<TrackData[]>;
  download?: (
    tracks: TrackData[],
    options: { rehearsalId: string; songIds: string[]; onProgress?: (progress: DeviceDownloadProgress) => void },
  ) => { completion: Promise<DeviceDownloadResult>; cancel: () => void };
};

const readSavedRehearsal = async (): Promise<SavedRehearsal | null> => {
  if (typeof caches === 'undefined') return null;
  try {
    const response = await (await caches.open(STEM_BLOCK_CACHE_NAME)).match(savedRehearsalKey());
    return response ? await response.json() as SavedRehearsal : null;
  } catch {
    return null;
  }
};

const sameSongs = (left: string[], right: string[]) => (
  left.length === right.length && left.every((songId, index) => songId === right[index])
);

/** Saves the stems of the open rehearsal on this device, and only that rehearsal. */
export function useLiveDirectorRehearsalDownload(options: Options) {
  const latest = useRef(options); latest.current = options;
  const [state, setState] = useState<RehearsalDownloadState>({ phase: 'idle' });
  const job = useRef<{ cancel: () => void } | null>(null);
  const songKey = options.songIds.join('|');
  const autoStarted = useRef('');
  const startRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (!options.enabled || !options.rehearsalId) return;
    let cancelled = false;
    void readSavedRehearsal().then(saved => {
      if (cancelled || job.current) return;
      const current = latest.current;
      const isSaved = Boolean(saved && saved.rehearsalId === current.rehearsalId && sameSongs(saved.songIds, current.songIds));
      setState(isSaved ? { phase: 'saved', totalBytes: saved!.totalBytes } : { phase: 'idle' });
      const key = `${current.rehearsalId}:${songKey}`;
      if (!isSaved && current.autoStart && autoStarted.current !== key) {
        autoStarted.current = key;
        void startRef.current();
      }
    });
    return () => { cancelled = true; };
  }, [options.enabled, options.rehearsalId, songKey, options.autoStart]);

  useEffect(() => () => { job.current?.cancel(); job.current = null; }, []);

  const start = useCallback(async () => {
    const { rehearsalId, songIds, resolveTracks, download } = latest.current;
    if (!rehearsalId || !resolveTracks || !download || job.current || songIds.length === 0) return;
    const marker = { cancel: () => {} };
    job.current = marker;
    setState({ phase: 'resolving' });
    // Ask the browser not to evict what the user chose to keep on this device.
    void navigator.storage?.persist?.().catch(() => false);
    try {
      const trackLists = await Promise.all(songIds.map(songId => resolveTracks(songId)));
      if (job.current !== marker) return;
      const running = download(trackLists.flat(), {
        rehearsalId, songIds,
        onProgress: ({ doneBlocks, totalBlocks, held }) => {
          if (job.current === marker) setState({ phase: 'downloading', progress: totalBlocks > 0 ? doneBlocks / totalBlocks : 0, held });
        },
      });
      marker.cancel = running.cancel;
      setState({ phase: 'downloading', progress: 0, held: false });
      const result = await running.completion;
      // Song data of other rehearsals leaves the device together with their audio.
      if (result.ok) await pruneRehearsalDataExcept(rehearsalId, songIds).catch(() => {});
      if (job.current !== marker) return;
      setState(result.ok
        ? { phase: 'saved', totalBytes: result.totalBytes }
        : result.cancelled ? { phase: 'idle' } : { phase: 'error', message: result.error || 'No se pudo guardar el ensayo.' });
    } catch (error) {
      if (job.current === marker) setState({ phase: 'error', message: error instanceof Error ? error.message : 'No se pudo guardar el ensayo.' });
    } finally {
      if (job.current === marker) job.current = null;
    }
  }, []);

  startRef.current = start;

  const cancel = useCallback(() => {
    const running = job.current;
    job.current = null;
    running?.cancel();
    setState({ phase: 'idle' });
  }, []);

  return { state, start, cancel };
}
