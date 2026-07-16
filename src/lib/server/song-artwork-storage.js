import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import {
  SONG_ARTWORK_PUBLIC_BASE_URL,
  SONG_ARTWORK_SIZE,
  buildStoredSongArtworkUrl,
  getSongArtworkObjectKey,
} from '../../utils/songArtwork.js';
import { readEnv } from './supabase-env.js';

const PLACEHOLDER_SVG = `
<svg width="500" height="500" viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="60" y1="35" x2="440" y2="465" gradientUnits="userSpaceOnUse">
      <stop stop-color="#1d4ed8"/>
      <stop offset="0.48" stop-color="#172554"/>
      <stop offset="1" stop-color="#09090b"/>
    </linearGradient>
    <radialGradient id="glow" cx="0" cy="0" r="1" gradientTransform="translate(136 112) rotate(48) scale(330)">
      <stop stop-color="#60a5fa" stop-opacity="0.48"/>
      <stop offset="1" stop-color="#60a5fa" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="500" height="500" rx="76" fill="url(#bg)"/>
  <rect width="500" height="500" rx="76" fill="url(#glow)"/>
  <path d="M214 334V164L352 140V294" fill="none" stroke="#f8fafc" stroke-width="27" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M214 189L352 165" fill="none" stroke="#f8fafc" stroke-width="27" stroke-linecap="round"/>
  <ellipse cx="170" cy="342" rx="58" ry="43" transform="rotate(-14 170 342)" fill="#f8fafc"/>
  <ellipse cx="308" cy="302" rx="58" ry="43" transform="rotate(-14 308 302)" fill="#f8fafc"/>
</svg>`;

let cachedR2Storage = null;

const createR2Client = () => {
  if (cachedR2Storage) return cachedR2Storage;

  const endpoint = readEnv('R2_ENDPOINT');
  const accessKeyId = readEnv('R2_ACCESS_KEY_ID');
  const secretAccessKey = readEnv('R2_SECRET_ACCESS_KEY');
  const bucket = readEnv('R2_BUCKET_NAME');

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error('Faltan variables de Cloudflare R2 para guardar caratulas.');
  }

  cachedR2Storage = {
    bucket,
    client: new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    }),
  };

  return cachedR2Storage;
};

export const createSongArtworkWebp = async (coverArt) => {
  const source = coverArt?.bytes?.length
    ? Buffer.from(coverArt.bytes)
    : Buffer.from(PLACEHOLDER_SVG);

  return sharp(source, { failOn: 'warning' })
    .rotate()
    .resize({
      width: SONG_ARTWORK_SIZE,
      height: SONG_ARTWORK_SIZE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 82, alphaQuality: 90, effort: 4 })
    .toBuffer();
};

export const storeSongArtwork = async ({ songId, mp3Url, coverArt }) => {
  const objectKey = getSongArtworkObjectKey(songId);
  if (!objectKey) throw new Error('Identificador de cancion invalido.');

  const image = await createSongArtworkWebp(coverArt);
  const { bucket, client } = createR2Client();

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    Body: image,
    ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000, immutable',
    Metadata: {
      source: 'embedded-audio-artwork',
      kind: coverArt?.bytes?.length ? 'embedded' : 'placeholder',
      size: String(SONG_ARTWORK_SIZE),
    },
  }));

  return {
    bytes: image.byteLength,
    objectKey,
    publicUrl: buildStoredSongArtworkUrl({ id: songId, mp3: mp3Url })
      || `${SONG_ARTWORK_PUBLIC_BASE_URL}/${objectKey}`,
  };
};
