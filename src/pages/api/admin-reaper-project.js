import { randomUUID } from 'node:crypto';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseServerEnv, getSupabaseServiceRoleKey, readEnv } from '../../lib/server/supabase-env.js';
import { parseReaperProject, reviewReaperProject, safeReaperProjectName } from '../../utils/reaperProjectParser.js';

export const prerender = false;

const { supabaseUrl, supabaseAnonKey } = getSupabaseServerEnv();
const serviceRoleKey = getSupabaseServiceRoleKey();
const authClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const serviceRoleClient = serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
}) : null;
const PROJECT_PREFIX = 'live-director/light2-beta/reaper-projects/';
const MAX_PROJECT_BYTES = 5 * 1024 * 1024;

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
});

const requireAdmin = async (cookies) => {
  if (!serviceRoleClient) throw Object.assign(new Error('Falta SUPABASE_SERVICE_ROLE_KEY.'), { status: 500 });
  const token = cookies.get('sb-access-token')?.value;
  if (!token) throw Object.assign(new Error('No autorizado.'), { status: 401 });
  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user) throw Object.assign(new Error('No autorizado.'), { status: 401 });
  const { data: profile, error } = await serviceRoleClient.from('perfiles')
    .select('id, is_admin').eq('id', user.id).maybeSingle();
  if (error) throw error;
  if (profile?.is_admin !== true) throw Object.assign(new Error('Solo un administrador puede gestionar proyectos REAPER.'), { status: 403 });
  return user;
};

const createR2 = () => {
  const endpoint = readEnv('R2_ENDPOINT');
  const accessKeyId = readEnv('R2_ACCESS_KEY_ID');
  const secretAccessKey = readEnv('R2_SECRET_ACCESS_KEY');
  const bucket = readEnv('R2_BUCKET_NAME');
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw Object.assign(new Error('Faltan las variables de Cloudflare R2.'), { status: 500 });
  }
  return {
    bucket,
    client: new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      // Recent AWS SDK versions add CRC32 headers by default. R2's S3 API
      // does not accept x-amz-sdk-checksum-algorithm, so only calculate a
      // request checksum when the operation explicitly requires one.
      requestChecksumCalculation: 'WHEN_REQUIRED',
    }),
  };
};

const readSong = async (songId) => {
  const { data, error } = await serviceRoleClient.from('canciones')
    .select('id, titulo, section_markers, multitrack_session').eq('id', songId).maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error('No encontré esa canción.'), { status: 404 });
  return data;
};

const readableError = (error) => error instanceof Error ? error.message : 'Error interno del servidor.';

export const GET = async ({ request, cookies }) => {
  try {
    await requireAdmin(cookies);
    const url = new URL(request.url);
    const { bucket, client } = createR2();
    const key = String(url.searchParams.get('key') || '');
    if (key) {
      if (!key.startsWith(PROJECT_PREFIX) || key.includes('..')) return jsonResponse({ error: 'Proyecto REAPER inválido.' }, 400);
      const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const fileName = decodeURIComponent(key.split('/').at(-1) || 'Proyecto.RPP').replace(/^\d+-[0-9a-f-]{36}-/, '');
      const body = object.Body?.transformToWebStream?.();
      if (!body) return jsonResponse({ error: 'No pude abrir el proyecto guardado.' }, 500);
      return new Response(body, {
        headers: {
          'content-type': 'application/x-reaper-project',
          'content-disposition': `attachment; filename="${fileName.replace(/["\\\r\n]/g, '_')}"`,
          'cache-control': 'private, no-store',
          ...(object.ContentLength ? { 'content-length': String(object.ContentLength) } : {}),
        },
      });
    }

    const songId = String(url.searchParams.get('songId') || '').trim();
    if (!songId) return jsonResponse({ error: 'Se requiere songId.' }, 400);
    await readSong(songId);
    const listed = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `${PROJECT_PREFIX}${songId}/`,
      MaxKeys: 30,
    }));
    const projects = (listed.Contents || [])
      .filter((item) => item.Key && /\.rpp$/i.test(item.Key))
      .sort((left, right) => Number(right.LastModified || 0) - Number(left.LastModified || 0))
      .map((item) => ({
        key: item.Key,
        fileName: decodeURIComponent(item.Key.split('/').at(-1) || 'Proyecto.RPP').replace(/^\d+-[0-9a-f-]{36}-/, ''),
        updatedAt: item.LastModified?.toISOString?.() || null,
        size: item.Size || 0,
      }));
    return jsonResponse({ projects });
  } catch (error) {
    const status = Number(error?.status) || 500;
    console.error('Admin REAPER project lookup failed:', error);
    return jsonResponse({ error: readableError(error) }, status);
  }
};

export const POST = async ({ request, cookies }) => {
  try {
    const requestUrl = new URL(request.url);
    const origin = request.headers.get('origin');
    if (origin && origin !== requestUrl.origin) return jsonResponse({ error: 'Origen no permitido.' }, 403);
    await requireAdmin(cookies);
    const songId = String(requestUrl.searchParams.get('songId') || '').trim();
    let originalName = 'Proyecto.RPP';
    try {
      originalName = decodeURIComponent(request.headers.get('x-file-name') || originalName);
    } catch {
      return jsonResponse({ error: 'El nombre del archivo no es válido.' }, 400);
    }
    if (!songId) return jsonResponse({ error: 'Selecciona una canción.' }, 400);
    if (!/\.rpp$/i.test(originalName)) return jsonResponse({ error: 'El archivo debe tener extensión .RPP.' }, 415);
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > MAX_PROJECT_BYTES) return jsonResponse({ error: 'El RPP supera el límite de 5 MB.' }, 413);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length) return jsonResponse({ error: 'El archivo está vacío.' }, 400);
    if (bytes.length > MAX_PROJECT_BYTES) return jsonResponse({ error: 'El RPP supera el límite de 5 MB.' }, 413);

    let project;
    try {
      project = parseReaperProject(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch (error) {
      return jsonResponse({ error: readableError(error) }, 422);
    }
    const song = await readSong(songId);
    if (project.songId && project.songId !== String(song.id)) {
      return jsonResponse({ error: 'Este RPP se preparó para otra canción. Selecciona la canción correcta antes de subirlo.' }, 422);
    }
    const review = reviewReaperProject(project, song);
    const { bucket, client } = createR2();
    const fileName = safeReaperProjectName(originalName);
    // Pass the raw object key to the S3 SDK. It performs the required URI
    // encoding while signing the request; pre-encoding the filename here
    // double-encodes spaces and can make R2 reject the signature on PUT.
    const objectKey = `${PROJECT_PREFIX}${song.id}/${Date.now()}-${randomUUID()}-${fileName}`;
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: bytes,
      ContentType: 'application/x-reaper-project',
      CacheControl: 'private, no-store',
    }));
    return jsonResponse({
      project: { key: objectKey, fileName, updatedAt: new Date().toISOString(), size: bytes.length },
      analysis: { ...project, review },
    }, 201);
  } catch (error) {
    const status = Number(error?.status) || 500;
    console.error('Admin REAPER project upload failed:', error);
    return jsonResponse({ error: readableError(error) }, status);
  }
};

const normalizeProjectSectionName = (value) => String(value || '').replace(/^\[BORRADOR\]\s*/i, '').trim();
const sectionIdentity = (value) => normalizeProjectSectionName(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const APPLY_BLOCKERS = new Set([
  'drafts', 'uno', 'end', 'invalid', 'tempo', 'audio-moved', 'no-media', 'unverified-media',
  'trimmed', 'song', 'unbound', 'duplicate-anchor', 'duplicate-time', 'duplicate-name',
  'duplicate-id', 'outside', 'tail', 'range', 'tempo-map', 'media-count', 'order', 'untimed-source',
]);

export const PUT = async ({ request, cookies }) => {
  try {
    const requestUrl = new URL(request.url);
    const origin = request.headers.get('origin');
    if (origin && origin !== requestUrl.origin) return jsonResponse({ error: 'Origen no permitido.' }, 403);
    await requireAdmin(cookies);
    if (Number(request.headers.get('content-length') || 0) > 32 * 1024) return jsonResponse({ error: 'La solicitud supera el límite permitido.' }, 413);
    const payload = await request.json().catch(() => null);
    const songId = String(payload?.songId || '').trim();
    const key = String(payload?.key || '');
    const markerIds = Array.isArray(payload?.markerIds) ? payload.markerIds.map(Number) : [];
    if (!songId || !key.startsWith(`${PROJECT_PREFIX}${songId}/`) || key.includes('..')) return jsonResponse({ error: 'El proyecto no corresponde a esta canción.' }, 400);
    if (!markerIds.length || markerIds.length > 100 || markerIds.some((id) => !Number.isInteger(id) || id < 0) || new Set(markerIds).size !== markerIds.length) {
      return jsonResponse({ error: 'Selecciona una lista válida de secciones para aplicar.' }, 400);
    }

    const song = await readSong(songId);
    const { bucket, client } = createR2();
    const stored = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = new Uint8Array(await stored.Body.transformToByteArray());
    if (!bytes.length || bytes.length > MAX_PROJECT_BYTES) return jsonResponse({ error: 'El RPP guardado está vacío o supera 5 MB.' }, 413);
    const project = parseReaperProject(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!project.songId || project.songId !== String(song.id)) return jsonResponse({ error: 'El RPP no está vinculado a esta canción.' }, 422);
    const review = reviewReaperProject(project, song);
    const blockers = review.issues.filter((issue) => APPLY_BLOCKERS.has(issue.code));
    if (blockers.length) return jsonResponse({ error: `Corrige primero el RPP: ${blockers.map((issue) => issue.message).join(' ')}`, review }, 409);

    const chosen = project.markers.filter((marker) => !/^(uno|fin audio)$/i.test(normalizeProjectSectionName(marker.name)) && markerIds.includes(marker.id));
    if (chosen.length !== markerIds.length || chosen.some((marker) => marker.draft)) return jsonResponse({ error: 'Todas las secciones elegidas deben existir en el RPP y estar confirmadas.' }, 422);
    const chosenNames = chosen.map((marker) => sectionIdentity(marker.name));
    if (new Set(chosenNames).size !== chosenNames.length) return jsonResponse({ error: 'Hay secciones con el mismo nombre. Numera sus apariciones antes de aplicar.' }, 422);

    // Edison explicitly approved removing the false Outro and keeping Final for this song.
    if (/^digno\s+y\s+santo$/i.test(String(song.titulo || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim())) {
      if (chosenNames.includes('outro')) return jsonResponse({ error: 'Para Digno y Santo, quita Outro de la selección y conserva Final, como indicaste.' }, 422);
      if (!chosenNames.includes('final')) return jsonResponse({ error: 'Para Digno y Santo, incluye la sección Final antes de aplicar.' }, 422);
    }
    const markers = [...chosen].sort((a, b) => a.timeSeconds - b.timeSeconds).map((marker) => ({
      id: `reaper-${marker.id}`,
      sectionName: normalizeProjectSectionName(marker.name),
      startSec: marker.timeSeconds,
    }));
    if (!markers.length || markers.some((marker, index) => index > 0 && marker.startSec <= markers[index - 1].startSec)) {
      return jsonResponse({ error: 'Las entradas de las secciones deben estar en orden y tener tiempos distintos.' }, 422);
    }

    let session = song.multitrack_session;
    if (typeof session === 'string') {
      try { session = JSON.parse(session); } catch { session = null; }
    }
    if (!session || typeof session !== 'object' || !Array.isArray(session.tracks) || !session.tracks.length) {
      return jsonResponse({ error: 'La canción no tiene una sesión multitrack disponible para recibir el mapa.' }, 409);
    }
    const appliedAt = new Date().toISOString();
    const nextSession = {
      ...session,
      updatedAt: appliedAt,
      // RPP markers are absolute positions in the original stems. A prior
      // lyric/MP3 offset must not be added to this newly calibrated map.
      sectionOffsetSeconds: 0,
      sectionMarkers: markers,
      // Spoken instructions inside UNO–FIN AUDIO; they never become sections.
      instructionMarkers: (project.instructions || [])
        .filter((cue) => cue.timeSeconds >= (review.unoSeconds ?? 0) && (review.endSeconds == null || cue.timeSeconds < review.endSeconds))
        .map((cue) => ({ id: `reaper-cue-${cue.id}`, name: cue.name, startSec: cue.timeSeconds })),
      reaperTiming: {
        source: 'reaper-rpp',
        projectName: safeReaperProjectName(key.split('/').at(-1) || 'Proyecto.RPP'),
        tempo: project.tempo,
        meter: project.meter,
        unoSeconds: review.unoSeconds,
        finAudioSeconds: review.endSeconds,
        appliedAt,
      },
    };
    const { error: updateError } = await serviceRoleClient.from('canciones').update({ multitrack_session: nextSession }).eq('id', song.id);
    if (updateError) throw updateError;
    return jsonResponse({ applied: true, songId: song.id, title: song.titulo, sectionMarkers: markers, instructionMarkers: nextSession.instructionMarkers, reaperTiming: nextSession.reaperTiming });
  } catch (error) {
    const status = Number(error?.status) || 500;
    console.error('Admin REAPER map apply failed:', error);
    return jsonResponse({ error: readableError(error) }, status);
  }
};
