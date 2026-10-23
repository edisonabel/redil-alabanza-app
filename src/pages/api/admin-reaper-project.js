import { randomUUID } from 'node:crypto';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseServerEnv, getSupabaseServiceRoleKey, readEnv } from '../../lib/server/supabase-env.js';
import { parseReaperProject, safeReaperProjectName } from '../../utils/reaperProjectParser.js';

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
    client: new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey } }),
  };
};

const readSong = async (songId) => {
  const { data, error } = await serviceRoleClient.from('canciones')
    .select('id, titulo').eq('id', songId).maybeSingle();
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
    const { bucket, client } = createR2();
    const fileName = safeReaperProjectName(originalName);
    const objectKey = `${PROJECT_PREFIX}${song.id}/${Date.now()}-${randomUUID()}-${encodeURIComponent(fileName)}`;
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: bytes,
      ContentType: 'application/x-reaper-project',
      CacheControl: 'private, no-store',
      Metadata: { 'song-title': String(song.titulo || '').slice(0, 200) },
    }));
    return jsonResponse({
      project: { key: objectKey, fileName, updatedAt: new Date().toISOString(), size: bytes.length },
      analysis: project,
    }, 201);
  } catch (error) {
    const status = Number(error?.status) || 500;
    console.error('Admin REAPER project upload failed:', error);
    return jsonResponse({ error: readableError(error) }, status);
  }
};
