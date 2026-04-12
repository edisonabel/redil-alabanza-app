import { buildSectionShortLabel, getSectionKind, SECTION_VISUALS, toRgba } from './sectionVisuals';
import type { TrackOutputRoute } from './liveDirectorTrackRouting';
import { resolveTrackOutputRoute } from './liveDirectorTrackRouting';

export type LiveDirectorPersistedTrack = {
  id: string;
  name: string;
  url: string;
  volume: number;
  isMuted: boolean;
  enabled?: boolean;
  sourceFileName?: string;
  outputRoute?: TrackOutputRoute;
};

export type LiveDirectorPersistedSession = {
  version: 1;
  songId: string;
  songTitle: string;
  mode: 'sequence' | 'folder';
  sectionOffsetSeconds?: number;
  folder: string;
  manifestUrl: string;
  updatedAt: string;
  tracks: LiveDirectorPersistedTrack[];
  unmatchedFiles: string[];
};

export type LiveDirectorSectionVisual = {
  id: string;
  name: string;
  startTime: number;
  endTime: number;
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

          if (!id || !name || !url) {
            return null;
          }

          return {
            id,
            name,
            url,
            volume: Number.isFinite(Number(candidate.volume)) ? Number(candidate.volume) : 1,
            isMuted: Boolean(candidate.isMuted),
            enabled: candidate.enabled !== false,
            sourceFileName: String(candidate.sourceFileName || '').trim() || undefined,
            outputRoute: resolveTrackOutputRoute({
              id,
              name,
              outputRoute: candidate.outputRoute,
            }),
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

  return {
    version: 1,
    songId,
    songTitle,
    mode: sessionRecord.mode === 'folder' ? 'folder' : 'sequence',
    sectionOffsetSeconds: Number.isFinite(Number(sessionRecord.sectionOffsetSeconds))
      ? Number(sessionRecord.sectionOffsetSeconds)
      : 0,
    folder:
      String(sessionRecord.folder || '').trim() || buildLiveDirectorSongFolder(songId, songTitle),
    manifestUrl: String(sessionRecord.manifestUrl || '').trim(),
    updatedAt: String(sessionRecord.updatedAt || '').trim(),
    tracks,
    unmatchedFiles: Array.isArray(sessionRecord.unmatchedFiles)
      ? sessionRecord.unmatchedFiles.map((value) => String(value || '').trim()).filter(Boolean)
      : [],
  };
};

export const buildLiveDirectorSectionsFromMarkers = (
  rawMarkers: unknown,
): LiveDirectorSectionVisual[] | null => {
  const markers = (Array.isArray(rawMarkers) ? rawMarkers : [])
    .map((marker, index) => {
      const candidate = (marker || {}) as RawSongMarker;
      const name = String(candidate.sectionName || candidate.name || `Section ${index + 1}`).trim();
      const startTime = clampTime(candidate.startSec);
      const endTime = clampTime(candidate.endSec);

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
