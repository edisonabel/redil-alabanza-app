import { cleanExportedStemLabels } from './stemCategories';
import { buildSectionShortLabel, getSectionKind, SECTION_VISUALS, toRgba } from './sectionVisuals';
import type { TrackOutputRoute } from './liveDirectorTrackRouting';
import { resolveTrackOutputRoute } from './liveDirectorTrackRouting';
import type { TrackActivityEnvelope } from './audioActivityEnvelope';
import { normalizeTrackActivityEnvelope } from './audioActivityEnvelope';

export type LiveDirectorPersistedTrack = {
  id: string;
  name: string;
  url: string;
  iosUrl?: string;
  nativeUrl?: string;
  optimizedUrl?: string;
  cafUrl?: string;
  pcmUrl?: string;
  volume: number;
  isMuted: boolean;
  enabled?: boolean;
  sourceFileName?: string;
  outputRoute?: TrackOutputRoute;
  activityEnvelope?: TrackActivityEnvelope;
};

export type LiveDirectorPersistedSession = {
  version: 1;
  songId: string;
  songTitle: string;
  mode: 'sequence' | 'folder';
  sectionOffsetSeconds?: number;
  /** REAPER-calibrated markers belong to this multitrack session, not the original song/chart. */
  sectionMarkers?: Array<{ id: string; sectionName: string; startSec: number }>;
  /** Spoken guide instructions (Sube intensidad, Hits…) from the RPP; never sections. */
  instructionMarkers?: LiveDirectorInstructionMarker[];
  reaperTiming?: { source: 'reaper-rpp'; projectName?: string; tempo: number; meter: string; unoSeconds: number | null; finAudioSeconds: number | null; appliedAt: string };
  folder: string;
  manifestUrl: string;
  updatedAt: string;
  tracks: LiveDirectorPersistedTrack[];
  unmatchedFiles: string[];
};

export type LiveDirectorInstructionMarker = { id: string; name: string; startSec: number };

export type LiveDirectorSectionVisual = {
  id: string;
  name: string;
  startTime: number;
  endTime: number;
  endTimeSource?: 'marker' | 'next-marker' | 'fallback' | 'audio';
  shortLabel: string;
  accent: string;
  surface: string;
  border: string;
};

type RawSongMarker = {
  id?: string;
  sectionName?: string;
  name?: string;
  startSec?: number | string | null;
  endSec?: number | string | null;
};

const clampTime = (value: unknown) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return Math.max(0, numericValue);
};

const normalizeOptionalUrl = (value: unknown) => {
  const url = String(value || '').trim();
  return url || undefined;
};

export const slugifyLiveDirectorSegment = (value = '') => {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'song';
};

export const sanitizeLiveDirectorFileName = (value = '') => {
  const rawValue = String(value || '').trim();
  const cleanedValue = rawValue
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

  return cleanedValue || `file-${Date.now()}`;
};

export const buildLiveDirectorSongFolder = (songId = '', songTitle = '') => {
  const safeSongId = String(songId || '').trim();
  if (!safeSongId) {
    throw new Error('A song id is required to build the multitrack folder path.');
  }

  return `secuencias/${safeSongId}-${slugifyLiveDirectorSegment(songTitle)}`;
};

export const normalizePersistedLiveDirectorSession = (
  rawValue: unknown,
  fallback: { songId?: string; songTitle?: string } = {},
): LiveDirectorPersistedSession | null => {
  if (!rawValue) {
    return null;
  }

  let parsedValue = rawValue;

  if (typeof rawValue === 'string') {
    const trimmedValue = rawValue.trim();
    if (!trimmedValue) {
      return null;
    }

    try {
      parsedValue = JSON.parse(trimmedValue);
    } catch {
      return null;
    }
  }

  if (!parsedValue || typeof parsedValue !== 'object') {
    return null;
  }

  const sessionRecord = parsedValue as Partial<LiveDirectorPersistedSession>;
  const tracks = Array.isArray(sessionRecord.tracks)
    ? sessionRecord.tracks
        .map<LiveDirectorPersistedTrack | null>((track) => {
          if (!track || typeof track !== 'object') {
            return null;
          }

          const candidate = track as Partial<LiveDirectorPersistedTrack>;
          const id = String(candidate.id || '').trim();
          const name = String(candidate.name || '').trim();
          const url = String(candidate.url || '').trim();
          const sourceFileName = String(candidate.sourceFileName || '').trim() || undefined;

          if (!id || !name || !url) {
            return null;
          }

          const activityEnvelope = normalizeTrackActivityEnvelope(candidate.activityEnvelope);

          return {
            id,
            name,
            url,
            iosUrl: normalizeOptionalUrl(candidate.iosUrl),
            nativeUrl: normalizeOptionalUrl(candidate.nativeUrl),
            optimizedUrl: normalizeOptionalUrl(candidate.optimizedUrl),
            cafUrl: normalizeOptionalUrl(candidate.cafUrl),
            pcmUrl: normalizeOptionalUrl(candidate.pcmUrl),
            volume: Number.isFinite(Number(candidate.volume)) ? Number(candidate.volume) : 1,
            isMuted: Boolean(candidate.isMuted),
            enabled: candidate.enabled !== false,
            sourceFileName,
            outputRoute: resolveTrackOutputRoute({
              id,
              name,
              sourceFileName,
              outputRoute: candidate.outputRoute,
            }),
            ...(activityEnvelope ? { activityEnvelope } : {}),
          };
        })
        .filter((track): track is LiveDirectorPersistedTrack => track !== null)
    : [];

  if (tracks.length === 0) {
    return null;
  }

  const songId = String(sessionRecord.songId || fallback.songId || '').trim();
  const songTitle = String(sessionRecord.songTitle || fallback.songTitle || '').trim();

  if (!songId) {
    return null;
  }

  const sectionMarkers = Array.isArray(sessionRecord.sectionMarkers)
    ? sessionRecord.sectionMarkers.map((marker, index) => {
        if (!marker || typeof marker !== 'object') return null;
        const candidate = marker as { id?: unknown; sectionName?: unknown; name?: unknown; startSec?: unknown };
        const sectionName = String(candidate.sectionName || candidate.name || '').trim();
        const startSec = clampTime(candidate.startSec);
        if (!sectionName || startSec == null) return null;
        return { id: String(candidate.id || `${slugifyLiveDirectorSegment(sectionName)}-${index + 1}`), sectionName, startSec };
      }).filter((marker): marker is { id: string; sectionName: string; startSec: number } => Boolean(marker))
      .sort((left, right) => left.startSec - right.startSec)
    : [];
  const instructionMarkers = Array.isArray(sessionRecord.instructionMarkers)
    ? sessionRecord.instructionMarkers.map((marker, index) => {
        if (!marker || typeof marker !== 'object') return null;
        const name = String(marker.name || '').trim();
        const startSec = clampTime(marker.startSec);
        if (!name || startSec == null) return null;
        return { id: String(marker.id || `cue-${index + 1}`), name, startSec };
      }).filter((marker): marker is LiveDirectorInstructionMarker => Boolean(marker))
      .sort((left, right) => left.startSec - right.startSec)
    : [];
  const timing = sessionRecord.reaperTiming && typeof sessionRecord.reaperTiming === 'object'
    ? sessionRecord.reaperTiming as LiveDirectorPersistedSession['reaperTiming']
    : undefined;

  return {
    version: 1,
    songId,
    songTitle,
    mode: sessionRecord.mode === 'folder' ? 'folder' : 'sequence',
    sectionOffsetSeconds: Number.isFinite(Number(sessionRecord.sectionOffsetSeconds))
      ? Number(sessionRecord.sectionOffsetSeconds)
      : 0,
    ...(sectionMarkers.length ? { sectionMarkers } : {}),
    ...(instructionMarkers.length ? { instructionMarkers } : {}),
    ...(timing?.source === 'reaper-rpp' && Number.isFinite(Number(timing.tempo)) && typeof timing.meter === 'string'
      ? { reaperTiming: { ...timing, tempo: Number(timing.tempo), appliedAt: String(timing.appliedAt || '') } }
      : {}),
    folder:
      String(sessionRecord.folder || '').trim() || buildLiveDirectorSongFolder(songId, songTitle),
    manifestUrl: String(sessionRecord.manifestUrl || '').trim(),
    updatedAt: String(sessionRecord.updatedAt || '').trim(),
    tracks: cleanExportedStemLabels(tracks),
    unmatchedFiles: Array.isArray(sessionRecord.unmatchedFiles)
      ? sessionRecord.unmatchedFiles.map((value) => String(value || '').trim()).filter(Boolean)
      : [],
  };
};

/** Multitrack timing takes precedence over the independent lyric/chart map. */
export const resolveLiveDirectorSessionSections = (
  session: Pick<LiveDirectorPersistedSession, 'sectionMarkers'> | null | undefined,
  fallbackSections: LiveDirectorSectionVisual[] | null | undefined,
): LiveDirectorSectionVisual[] | null => (
  buildLiveDirectorSectionsFromMarkers(session?.sectionMarkers) || fallbackSections || null
);

/** A timing-only RPP update must refresh even when stems and updatedAt match. */
export const shouldRefreshLiveDirectorSession = (
  current: LiveDirectorPersistedSession | null | undefined,
  fetched: LiveDirectorPersistedSession | null | undefined,
): boolean => {
  if (!fetched?.tracks?.length) return false;
  if (!current?.tracks?.length) return true;
  const signature = (session: LiveDirectorPersistedSession) => JSON.stringify({
    updatedAt: session.updatedAt,
    offset: session.sectionOffsetSeconds ?? 0,
    markers: session.sectionMarkers ?? [],
    instructions: session.instructionMarkers ?? [],
    timing: session.reaperTiming ?? null,
    tracks: session.tracks.map(track => [track.id, track.url, track.optimizedUrl,
      track.enabled !== false, track.volume, track.isMuted, track.outputRoute]),
  });
  return signature(current) !== signature(fetched);
};

export const buildLiveDirectorSectionsFromMarkers = (
  rawMarkers: unknown,
): LiveDirectorSectionVisual[] | null => {
  const markers = (Array.isArray(rawMarkers) ? rawMarkers : [])
    .map((marker, index) => {
      const candidate = (marker || {}) as RawSongMarker;
      const name = String(candidate.sectionName || candidate.name || `Section ${index + 1}`).trim();
      const startTime = clampTime(candidate.startSec);
      const endTime = candidate.endSec == null || candidate.endSec === '' ? null : clampTime(candidate.endSec);

      if (startTime == null) {
        return null;
      }

      return {
        id: String(candidate.id || `${slugifyLiveDirectorSegment(name)}-${index + 1}`),
        name,
        startTime,
        endTime,
      };
    })
    .filter((marker): marker is { id: string; name: string; startTime: number; endTime: number | null } => Boolean(marker))
    .sort((left, right) => left.startTime - right.startTime);

  if (markers.length === 0) {
    return null;
  }

  const kindCounts = new Map<string, number>();

  return markers.map((marker, index) => {
    const nextMarker = markers[index + 1];
    const kind = getSectionKind(marker.name);
    const occurrence = (kindCounts.get(kind) || 0) + 1;
    const visual = SECTION_VISUALS[kind] || SECTION_VISUALS.default;
    const resolvedEndTime =
      marker.endTime != null
        ? Math.max(marker.startTime + 0.25, marker.endTime)
        : nextMarker
          ? nextMarker.startTime
          : marker.startTime + 12;

    kindCounts.set(kind, occurrence);

    return {
      id: marker.id,
      name: marker.name,
      startTime: marker.startTime,
      endTime: resolvedEndTime,
      endTimeSource: marker.endTime != null ? 'marker' : nextMarker ? 'next-marker' : 'fallback',
      shortLabel: buildSectionShortLabel(marker.name, kind, occurrence),
      accent: toRgba(visual.rgb, 0.95),
      surface: toRgba(visual.rgb, 0.14),
      border: toRgba(visual.rgb, 0.3),
    };
  });
};

export const applyLiveDirectorSectionOffset = (
  sections: LiveDirectorSectionVisual[] | null | undefined,
  offsetSeconds = 0,
): LiveDirectorSectionVisual[] | null => {
  if (!Array.isArray(sections) || sections.length === 0) {
    return null;
  }

  const safeOffset = Number.isFinite(Number(offsetSeconds)) ? Number(offsetSeconds) : 0;

  return sections.map((section, index, allSections) => {
    const shiftedStart = Math.max(0, section.startTime + safeOffset);
    const shiftedEnd = Math.max(shiftedStart + 0.25, section.endTime + safeOffset);
    const nextSection = allSections[index + 1];
    const nextStart = nextSection ? Math.max(0, nextSection.startTime + safeOffset) : null;

    return {
      ...section,
      startTime: shiftedStart,
      endTime: nextStart != null ? Math.max(shiftedStart + 0.25, Math.min(shiftedEnd, nextStart)) : shiftedEnd,
    };
  });
};

/** Audio duration is absolute: shifting section markers must not move the file end. */
export const resolveLiveDirectorTerminalSectionEnd = (
  sections: LiveDirectorSectionVisual[],
  audioDurationSeconds: number,
): LiveDirectorSectionVisual[] => {
  const last = sections.at(-1);
  if (!last || !Number.isFinite(audioDurationSeconds) || audioDurationSeconds < last.startTime + 0.25) return sections;
  // Un fin estimado se extiende hasta el final del audio. Un fin marcado se respeta, salvo que un
  // desfase lo deje después del audio: entonces termina con el audio (si no, su cambio nunca llegaría).
  const extend = last.endTimeSource === 'fallback';
  if (!extend && last.endTime <= audioDurationSeconds) return sections;
  return sections.map((section, index) => index === sections.length - 1
    ? { ...section, endTime: audioDurationSeconds, endTimeSource: 'audio' }
    : section);
};

/** Playback metadata follows the same applied RPP as its section map. */
export const resolveLiveDirectorReaperTransportTiming = (
  session: Pick<LiveDirectorPersistedSession, 'reaperTiming'> | null | undefined,
) => {
  const timing = session?.reaperTiming;
  if (timing?.source !== 'reaper-rpp' || !Number.isFinite(timing.tempo) || timing.tempo <= 0) return null;
  const meter = /^(\d+)\/(\d+)$/.exec(timing.meter);
  const numerator = Number(meter?.[1]), denominator = Number(meter?.[2]);
  return {
    bpm: timing.tempo,
    timeSignature: numerator > 0 && [1, 2, 4, 8, 16].includes(denominator) ? { numerator, denominator } : undefined,
    clickGrid: typeof timing.unoSeconds === 'number' && Number.isFinite(timing.unoSeconds) && timing.unoSeconds >= 0
      ? { bpm: timing.tempo, originSeconds: timing.unoSeconds } : undefined,
  };
};
