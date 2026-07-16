import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createSongArtworkWebp } from '../src/lib/server/song-artwork-storage.js';
import {
  buildStoredSongArtworkUrl,
  getSongArtworkCandidates,
  getSongArtworkObjectKey,
} from '../src/utils/songArtwork.js';

const song = {
  id: 'f2ce26b1-eac1-4937-b9e8-aa9f9d8338c9',
  mp3: 'https://stems.alabanzaredilestadio.com/songs/providencia.mp3',
};

assert.equal(
  getSongArtworkObjectKey(song.id),
  `songs/${song.id}/artwork/cover-500.webp`,
);
assert.match(
  buildStoredSongArtworkUrl(song),
  new RegExp(`^https://stems\\.alabanzaredilestadio\\.com/songs/${song.id}/artwork/cover-500\\.webp\\?v=`),
);
assert.equal(getSongArtworkCandidates({ ...song, portada: 'https://example.com/cover.webp' })[0], 'https://example.com/cover.webp');
assert.equal(getSongArtworkObjectKey('../invalid'), '');

const placeholder = await createSongArtworkWebp(null);
const metadata = await sharp(placeholder).metadata();
assert.equal(metadata.format, 'webp');
assert.equal(metadata.width, 500);
assert.equal(metadata.height, 500);
assert.ok(placeholder.byteLength < 30 * 1024, 'El placeholder debe ser liviano.');

console.log('song artwork tests passed');
