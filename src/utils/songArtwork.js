export const SONG_ARTWORK_SIZE = 500;
export const SONG_ARTWORK_PUBLIC_BASE_URL = 'https://stems.alabanzaredilestadio.com';

const DIRECT_ARTWORK_FIELDS = [
  'artworkUrl',
  'portada',
  'imagen',
  'image',
  'cover',
  'thumbnail',
  'artwork',
  'album_art',
  'albumArt',
  'caratula',
  'foto',
];

const normalizeSongId = (value = '') => {
  const songId = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{1,80}$/.test(songId) ? songId : '';
};

const fingerprint = (value = '') => {
  let hash = 2166136261;
  const input = String(value || '');

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
};

export const getSongArtworkObjectKey = (songId, size = SONG_ARTWORK_SIZE) => {
  const normalizedId = normalizeSongId(songId);
  if (!normalizedId) return '';
  return `songs/${normalizedId}/artwork/cover-${size}.webp`;
};

export const buildStoredSongArtworkUrl = (song = {}, size = SONG_ARTWORK_SIZE) => {
  const objectKey = getSongArtworkObjectKey(song?.id, size);
  const audioUrl = String(song?.mp3 || '').trim();
  if (!objectKey || !audioUrl) return '';

  return `${SONG_ARTWORK_PUBLIC_BASE_URL}/${objectKey}?v=${fingerprint(audioUrl)}`;
};

export const buildLegacySongArtworkUrl = (song = {}) => {
  const audioUrl = String(song?.mp3 || '').trim();
  if (!audioUrl) return '';
  return `/api/mp3-cover-art?v=3&src=${encodeURIComponent(audioUrl)}`;
};

export const getDirectSongArtworkUrl = (song = {}) => {
  for (const field of DIRECT_ARTWORK_FIELDS) {
    const value = String(song?.[field] || '').trim();
    if (value) return value;
  }
  return '';
};

export const getSongArtworkCandidates = (song = {}) => {
  const candidates = [
    getDirectSongArtworkUrl(song),
    buildStoredSongArtworkUrl(song),
    buildLegacySongArtworkUrl(song),
  ].filter(Boolean);

  return [...new Set(candidates)];
};
