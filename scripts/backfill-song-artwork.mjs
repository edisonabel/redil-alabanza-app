import 'dotenv/config';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import { loadEmbeddedCoverArt } from '../src/pages/api/mp3-cover-art.ts';
import { storeSongArtwork } from '../src/lib/server/song-artwork-storage.js';
import { getSongArtworkObjectKey } from '../src/utils/songArtwork.js';

const readArgument = (name, fallback = '') => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || fallback;
};

const force = process.argv.includes('--force');
const dryRun = process.argv.includes('--dry-run');
const requestedLimit = Number(readArgument('limit', '0'));
const concurrency = Math.min(5, Math.max(1, Number(readArgument('concurrency', '3')) || 3));

const supabaseUrl = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const r2Endpoint = process.env.R2_ENDPOINT;
const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID;
const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const r2Bucket = process.env.R2_BUCKET_NAME;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.');
}
if (!r2Endpoint || !r2AccessKeyId || !r2SecretAccessKey || !r2Bucket) {
  throw new Error('Faltan credenciales de Cloudflare R2.');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const r2 = new S3Client({
  region: 'auto',
  endpoint: r2Endpoint,
  credentials: {
    accessKeyId: r2AccessKeyId,
    secretAccessKey: r2SecretAccessKey,
  },
});

const { data, error } = await supabase
  .from('canciones')
  .select('id, titulo, mp3')
  .not('mp3', 'is', null)
  .order('titulo');

if (error) throw error;

const allSongs = (data || []).filter((song) => String(song.mp3 || '').trim());
const songs = requestedLimit > 0 ? allSongs.slice(0, requestedLimit) : allSongs;
const counters = { created: 0, placeholders: 0, existing: 0, failed: 0 };
const failures = [];
let cursor = 0;
let processed = 0;
let totalBytes = 0;

const objectExists = async (objectKey) => {
  if (force) return false;
  try {
    await r2.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: objectKey }));
    return true;
  } catch (headError) {
    const status = headError?.$metadata?.httpStatusCode;
    if (status === 404 || headError?.name === 'NotFound' || headError?.name === 'NoSuchKey') {
      return false;
    }
    throw headError;
  }
};

const processSong = async (song) => {
  const objectKey = getSongArtworkObjectKey(song.id);
  try {
    if (await objectExists(objectKey)) {
      counters.existing += 1;
      return;
    }

    if (dryRun) {
      counters.created += 1;
      return;
    }

    const { coverArt, status } = await loadEmbeddedCoverArt(String(song.mp3));
    if (!coverArt && status >= 400) {
      counters.failed += 1;
      failures.push({ id: song.id, title: song.titulo, reason: `audio no disponible (${status})` });
      return;
    }

    const stored = await storeSongArtwork({
      songId: song.id,
      mp3Url: String(song.mp3),
      coverArt,
    });
    counters.created += 1;
    if (!coverArt) counters.placeholders += 1;
    totalBytes += stored.bytes;
  } catch (songError) {
    counters.failed += 1;
    failures.push({
      id: song.id,
      title: song.titulo,
      reason: songError?.message || String(songError),
    });
  } finally {
    processed += 1;
    if (processed % 10 === 0 || processed === songs.length) {
      console.log(`[artwork] ${processed}/${songs.length}`);
    }
  }
};

const worker = async () => {
  while (cursor < songs.length) {
    const song = songs[cursor];
    cursor += 1;
    await processSong(song);
  }
};

console.log(`[artwork] canciones=${songs.length} concurrencia=${concurrency} force=${force} dryRun=${dryRun}`);
await Promise.all(Array.from({ length: Math.min(concurrency, songs.length) }, () => worker()));

console.log(JSON.stringify({
  ...counters,
  outputMegabytes: Number((totalBytes / 1024 / 1024).toFixed(2)),
  failures,
}, null, 2));

if (counters.failed > 0) process.exitCode = 1;
