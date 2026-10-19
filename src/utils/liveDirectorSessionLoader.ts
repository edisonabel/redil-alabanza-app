import { STEM_CATEGORIES, STEM_CATEGORY_ORDER, categorizeStemName } from './stemCategories.ts';
import type { TrackData } from '../services/MultitrackEngine';
import { isLiveDirectorM4aFile } from './liveDirectorStemFormat.ts';

export type LiveDirectorResolvedSession = {
  mode: 'sequence' | 'folder';
  sessionLabel: string;
  tracks: TrackData[];
  objectUrls: string[];
  unmatchedFiles: string[];
  sectionOffsetSeconds?: number;
};

export type LiveDirectorMatchedStemFile = {
  file: File;
  trackId: string;
  trackName: string;
  defaultVolume: number;
};

export type LiveDirectorStemInference = {
  sessionLabel: string;
  matchedFiles: LiveDirectorMatchedStemFile[];
  unmatchedFiles: string[];
};

type StemAliasGroup = {
  id: string;
  label: string;
  defaultVolume: number;
  aliases: string[];
};

const STEM_ALIAS_GROUPS: StemAliasGroup[] = STEM_CATEGORY_ORDER.filter((key) => key !== 'unknown').map((key) => {
  const category = STEM_CATEGORIES[key];
  return { id: category.trackId, label: category.trackName, defaultVolume: category.volume, aliases: category.aliases };
});

const normalizeName = (value: string) =>
  String(value || '')
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const isAudioFile = (file: File) => {
  return isLiveDirectorM4aFile(file);
};

const inferTrackGroup = (filename: string): StemAliasGroup | null => {
  const category = categorizeStemName(filename);
  return category === 'unknown' ? null : STEM_ALIAS_GROUPS.find((group) => group.id === STEM_CATEGORIES[category].trackId) ?? null;
};

const buildTrack = (
  id: string,
  name: string,
  url: string,
  volume: number,
  sourceFileName?: string,
): TrackData => ({
  id,
  name,
  url,
  volume,
  isMuted: false,
  enabled: true,
  sourceFileName,
});

export function inferStemTracksFromFiles(
  filesInput: FileList | File[],
): LiveDirectorStemInference {
  const files = Array.from(filesInput).filter(isAudioFile);

  if (files.length === 0) {
    throw new Error('No se encontraron stems M4A/AAC-LC válidos dentro de la carpeta.');
  }

  if (files.length !== Array.from(filesInput).length) {
    throw new Error(
      'Live Director solo admite stems M4A/AAC-LC con Fast Start. Convierte la carpeta completa antes de cargarla.',
    );
  }

  const duplicates = new Map<string, number>();
  const unmatchedFiles: string[] = [];
  const matchedFiles: Array<LiveDirectorMatchedStemFile & { sortOrder: number }> = [];
  const sessionLabel =
    files[0]?.webkitRelativePath?.split('/').filter(Boolean)[0] ||
    files[0]?.name.replace(/\.[^.]+$/, '') ||
    'Stem Folder';

  files.forEach((file) => {
    let group = inferTrackGroup(file.name);

    if (!group) {
      const cleanName = normalizeName(file.name) || file.name.replace(/\.[^.]+$/, '');
      const defaultId = cleanName.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'track';
      const label = cleanName
        .split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ') || 'Track';

      group = {
        id: `custom-${defaultId}`.substring(0, 32),
        label: label.substring(0, 32),
        defaultVolume: 0.72,
        aliases: [],
      };
    }

    const duplicateCount = (duplicates.get(group.id) || 0) + 1;
    duplicates.set(group.id, duplicateCount);

    const trackId = duplicateCount === 1 ? group.id : `${group.id}-${duplicateCount}`;
    const trackName = duplicateCount === 1 ? group.label : `${group.label} ${duplicateCount}`;
    const sortOrder = STEM_ALIAS_GROUPS.findIndex((candidate) => candidate.id === group.id);

    matchedFiles.push({
      file,
      trackId,
      trackName,
      defaultVolume: group.defaultVolume,
      sortOrder: sortOrder === -1 ? 999 : sortOrder + duplicateCount / 100,
    });
  });

  if (matchedFiles.length === 0) {
    throw new Error(
      'No pude asociar ningun archivo con nombres de stems conocidos. Usa nombres como Click, Guide, Drums, Bass o Keys.',
    );
  }

  matchedFiles.sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }

    return left.trackName.localeCompare(right.trackName);
  });

  return {
    sessionLabel,
    matchedFiles: matchedFiles.map(({ sortOrder, ...matchedFile }) => matchedFile),
    unmatchedFiles,
  };
}

export function createSequenceSessionFromUrl(
  url: string,
  sessionLabel = 'Sequence Playback',
): LiveDirectorResolvedSession {
  const safeUrl = String(url || '').trim();

  if (!safeUrl) {
    throw new Error('Ingresa una URL de audio para cargar la secuencia.');
  }

  return {
    mode: 'sequence',
    sessionLabel,
    tracks: [buildTrack('sequence', 'Sequence', safeUrl, 0.84, safeUrl.split(/[/?#]/).filter(Boolean).pop())],
    objectUrls: [],
    unmatchedFiles: [],
  };
}

export function createSequenceSessionFromFile(
  file: File,
  sessionLabel?: string,
): LiveDirectorResolvedSession {
  if (!file || !isAudioFile(file)) {
    throw new Error('Selecciona una secuencia M4A/AAC-LC con Fast Start.');
  }

  const objectUrl = URL.createObjectURL(file);

  return {
    mode: 'sequence',
    sessionLabel: sessionLabel || file.name.replace(/\.[^.]+$/, ''),
    tracks: [buildTrack('sequence', 'Sequence', objectUrl, 0.84, file.name)],
    objectUrls: [objectUrl],
    unmatchedFiles: [],
  };
}

export function createStemSessionFromFolder(
  filesInput: FileList | File[],
): LiveDirectorResolvedSession {
  const inference = inferStemTracksFromFiles(filesInput);
  const objectUrls: string[] = [];
  const resolvedTracks = inference.matchedFiles.map((matchedFile) => {
    const objectUrl = URL.createObjectURL(matchedFile.file);
    objectUrls.push(objectUrl);

    return buildTrack(
      matchedFile.trackId,
      matchedFile.trackName,
      objectUrl,
      matchedFile.defaultVolume,
      matchedFile.file.name,
    );
  });

  return {
    mode: 'folder',
    sessionLabel: inference.sessionLabel,
    tracks: resolvedTracks,
    objectUrls,
    unmatchedFiles: inference.unmatchedFiles,
  };
}
