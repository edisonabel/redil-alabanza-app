import type { TrackData } from '../services/MultitrackEngine';

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

const AUDIO_FILE_PATTERN = /\.(mp3|wav|m4a|aac|ogg|flac|aif|aiff|caf)$/i;

const STEM_ALIAS_GROUPS: StemAliasGroup[] = [
  { id: 'click', label: 'Click', defaultVolume: 0.34, aliases: ['click', 'clic', 'metro', 'metronome', 'cue click'] },
  { id: 'guide', label: 'Guide', defaultVolume: 0.72, aliases: ['guide', 'guia', 'guia vocal', 'vocal guide', 'vox guide'] },
  { id: 'cues', label: 'Cues', defaultVolume: 0.62, aliases: ['cues', 'cue', 'count in', 'countin'] },
  { id: 'drums', label: 'Drums', defaultVolume: 0.83, aliases: ['drums', 'drum', 'bateria', 'kit'] },
  { id: 'percussion', label: 'Percussion', defaultVolume: 0.72, aliases: ['percussion', 'perc', 'shaker', 'loop perc'] },
  { id: 'bass', label: 'Bass', defaultVolume: 0.76, aliases: ['bass', 'bajo'] },
  { id: 'synth-bass', label: 'Synth Bass', defaultVolume: 0.7, aliases: ['synth bass', 'sub bass', '808 bass'] },
  {
    id: 'acoustic-gtr',
    label: 'Acoustic Gtr',
    defaultVolume: 0.69,
    aliases: ['acoustic', 'acoustic 1', 'acoustic 2', 'acoustic gtr', 'acoustic guitar', 'guitarra acustica', 'guitarra acustica 1', 'guitarra acustica 2', 'ag'],
  },
  {
    id: 'electric-gtr',
    label: 'Electric Gtr',
    defaultVolume: 0.63,
    aliases: [
      'electric',
      'electric 1',
      'electric 2',
      'electric 3',
      'electric 4',
      'electric 5',
      'electric gtr',
      'electric guitar',
      'guitarra electrica',
      'lead gtr',
      'rhythm gtr',
      'eg',
      'gtr',
    ],
  },
  { id: 'keys', label: 'Keys', defaultVolume: 0.74, aliases: ['keys', 'key', 'teclas', 'teclado'] },
  { id: 'piano', label: 'Piano', defaultVolume: 0.72, aliases: ['piano'] },
  { id: 'organ', label: 'Organ', defaultVolume: 0.68, aliases: ['organ', 'hammond'] },
  { id: 'pad', label: 'Pad', defaultVolume: 0.66, aliases: ['pad', 'pads'] },
  { id: 'strings', label: 'Strings', defaultVolume: 0.66, aliases: ['strings', 'string'] },
  { id: 'synth', label: 'Synth', defaultVolume: 0.68, aliases: ['synth', 'synthesizer', 'lead synth'] },
  { id: 'background-vocals', label: 'Background Vocals', defaultVolume: 0.78, aliases: ['background vocals', 'background vocal', 'bgv', 'backing vocals', 'vocals bg'] },
  { id: 'choir', label: 'Choir', defaultVolume: 0.76, aliases: ['choir', 'coro', 'coros'] },
  { id: 'sequence', label: 'Sequence', defaultVolume: 0.84, aliases: ['sequence', 'secuencia', 'playback', 'stereo', 'mix', 'full mix', 'main mix', 'lr'] },
];

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
  return file.type.startsWith('audio/') || AUDIO_FILE_PATTERN.test(file.name);
};

const inferTrackGroup = (filename: string): StemAliasGroup | null => {
  const normalizedName = normalizeName(filename);

  if (!normalizedName) {
    return null;
  }

  let bestMatch: { group: StemAliasGroup; score: number } | null = null;

  for (const group of STEM_ALIAS_GROUPS) {
    for (const alias of group.aliases) {
      const normalizedAlias = normalizeName(alias);

      if (!normalizedAlias || !normalizedName.includes(normalizedAlias)) {
        continue;
      }

      const exactScore = normalizedName === normalizedAlias ? 1000 : 0;
      const boundaryScore =
        normalizedName.startsWith(normalizedAlias) || normalizedName.endsWith(normalizedAlias)
          ? 120
          : 0;
      const score = exactScore + boundaryScore + normalizedAlias.length * 10;

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { group, score };
      }
    }
  }

  if (bestMatch) {
    return bestMatch.group;
  }

  if (
    normalizedName.includes('electric') ||
    normalizedName.includes('gtr') ||
    normalizedName.includes('guitar')
  ) {
    return STEM_ALIAS_GROUPS.find((group) => group.id === 'electric-gtr') ?? null;
  }

  return null;
};

const buildTrack = (id: string, name: string, url: string, volume: number): TrackData => ({
  id,
  name,
  url,
  volume,
  isMuted: false,
});

export function inferStemTracksFromFiles(
  filesInput: FileList | File[],
): LiveDirectorStemInference {
  const files = Array.from(filesInput).filter(isAudioFile);

  if (files.length === 0) {
    throw new Error('No se encontraron archivos de audio validos dentro de la carpeta.');
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
    tracks: [buildTrack('sequence', 'Sequence', safeUrl, 0.84)],
    objectUrls: [],
    unmatchedFiles: [],
  };
}

export function createSequenceSessionFromFile(
  file: File,
  sessionLabel?: string,
): LiveDirectorResolvedSession {
  if (!file || !isAudioFile(file)) {
    throw new Error('Selecciona un archivo de audio valido para la secuencia.');
  }

  const objectUrl = URL.createObjectURL(file);

  return {
    mode: 'sequence',
    sessionLabel: sessionLabel || file.name.replace(/\.[^.]+$/, ''),
    tracks: [buildTrack('sequence', 'Sequence', objectUrl, 0.84)],
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
