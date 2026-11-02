import type { APIRoute } from 'astro';
import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getLiveDirectorEventAccess } from '../../lib/server/live-director-event-permissions.js';
import { ApiSecurityError, assertRequestBodySize, requireAuthenticatedUser, securityErrorResponse, serviceRoleClient } from '../../lib/server/api-security.js';
import { getServerAuthTokens } from '../../lib/server/auth-cookies.js';
import { createSupabaseUserClient } from '../../lib/server/supabase-user-client.js';
import { readEnv } from '../../lib/server/supabase-env.js';

export const prerender = false;

// Copias transportadas de un evento. netlify/functions/cleanup-event-keys.mjs las borra cuando el evento pasó.
const PREFIX = 'live-director/event-keys';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRACK_ID = /^[\w.-]{1,160}$/;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const r2 = () => {
  const endpoint = readEnv('R2_ENDPOINT'), accessKeyId = readEnv('R2_ACCESS_KEY_ID'), secretAccessKey = readEnv('R2_SECRET_ACCESS_KEY'), bucket = readEnv('R2_BUCKET_NAME');
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) throw new ApiSecurityError('Almacenamiento no configurado.', 503);
  return { bucket, client: new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey } }) };
};
const publicBase = () => String(readEnv('R2_URL') || 'https://stems.alabanzaredilestadio.com').replace(/\/+$/, '');
const context = (source: { get?: (k: string) => string | null } | Record<string, unknown>) => {
  const read = (key: string) => String(typeof (source as any).get === 'function' ? (source as any).get(key) || '' : (source as any)[key] || '').trim();
  const eventId = read('evento_id'), songId = read('cancion_id');
  if (!UUID.test(eventId) || !UUID.test(songId)) throw new ApiSecurityError('evento_id y cancion_id deben ser UUID validos.', 400);
  return { eventId, songId, folder: `${PREFIX}/${eventId}/${songId}` };
};
const access = async (cookies: Parameters<typeof requireAuthenticatedUser>[0], eventId: string, songId: string, write = false) => {
  const user = await requireAuthenticatedUser(cookies);
  if (!serviceRoleClient) throw new ApiSecurityError('Servicio de autorizacion no configurado.', 503);
  const result = await getLiveDirectorEventAccess(serviceRoleClient, user.id, eventId).catch(() => { throw new ApiSecurityError('No se pudo validar el acceso al evento.', 503); });
  if (!result.canRead || (write && !result.canWriteMix)) throw new ApiSecurityError(write ? 'Solo el líder de alabanza y el director musical de este evento, o un administrador, pueden cambiar el tono.' : 'Debes estar asignado a este evento.', 403);
  const database = createSupabaseUserClient(getServerAuthTokens(cookies).accessToken);
  const { data: playlist } = await database.from('playlists').select('id').eq('evento_id', eventId).maybeSingle();
  const { data: song } = playlist ? await database.from('playlist_canciones').select('id').eq('playlist_id', playlist.id).eq('cancion_id', songId).limit(1).maybeSingle() : { data: null };
  if (!song) throw new ApiSecurityError('La cancion no pertenece al repertorio de este evento.', 404);
  return result;
};
const validSemitones = (value: unknown) => Number.isInteger(value) && Math.abs(value as number) <= 6 && value !== 0;
// `keep`: lo que debe quedar. Nada más de esta canción en este evento sobrevive: un solo juego de archivos.
const removeCopies = async (folder: string, keep: (key: string) => boolean = () => false) => {
  const { bucket, client } = r2();
  let token: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${folder}/`, ContinuationToken: token }));
    const keys = (page.Contents || []).map(item => item.Key!).filter(key => !keep(key));
    if (keys.length) await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map(Key => ({ Key })) } }));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
};

export const GET: APIRoute = async ({ cookies, url }) => {
  try {
    const { eventId, songId, folder } = context(url.searchParams);
    const result = await access(cookies, eventId, songId);
    const { bucket, client } = r2();
    const stored = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `${folder}/key.json` })).catch(error => { if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NoSuchKey') return null; throw error; });
    return json({ key: stored ? JSON.parse(await stored.Body!.transformToString()) : null, canEdit: result.canWriteMix });
  } catch (error) { console.error('[live-director-event-key] GET failed:', error); return securityErrorResponse(error); }
};

// Una URL firmada por pista: el audio sube directo a R2 desde el navegador que lo procesó.
export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    assertRequestBodySize(request, 4 * 1024);
    const payload = await request.json().catch(() => null);
    if (!payload) throw new ApiSecurityError('Solicitud invalida.', 400);
    const { eventId, songId, folder } = context(payload);
    if (!validSemitones(payload.semitones) || !TRACK_ID.test(String(payload.track_id))) throw new ApiSecurityError('Tono o pista inválidos.', 400);
    await access(cookies, eventId, songId, true);
    const { bucket, client } = r2();
    const key = `${folder}/${payload.semitones}/${payload.track_id}.m4a`;
    const uploadUrl = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: 'audio/mp4' }), { expiresIn: 3600 });
    return json({ uploadUrl, key });
  } catch (error) { console.error('[live-director-event-key] POST failed:', error); return securityErrorResponse(error); }
};

// Solo cuando todas las pistas ya subieron: una copia a medias nunca llega a sonar.
export const PUT: APIRoute = async ({ cookies, request }) => {
  try {
    assertRequestBodySize(request, 64 * 1024);
    const payload = await request.json().catch(() => null);
    if (!payload) throw new ApiSecurityError('Solicitud invalida.', 400);
    const { eventId, songId, folder } = context(payload);
    const tracks = Array.isArray(payload.tracks) ? payload.tracks : [];
    if (!validSemitones(payload.semitones) || !tracks.length || tracks.length > 64) throw new ApiSecurityError('Tono o pistas inválidos.', 400);
    await access(cookies, eventId, songId, true);
    const { bucket, client } = r2();
    const base = `${folder}/${payload.semitones}/`, stored: Record<string, { url: string; sourceUrl: string }> = {};
    for (const track of tracks) {
      if (!TRACK_ID.test(String(track?.id)) || track.key !== `${base}${track.id}.m4a` || typeof track.sourceUrl !== 'string') throw new ApiSecurityError('Pista inválida.', 400);
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: track.key })).catch(() => { throw new ApiSecurityError(`Falta subir la pista ${track.id}.`, 409); });
      stored[track.id] = { url: `${publicBase()}/${track.key}`, sourceUrl: track.sourceUrl };
    }
    const key = { semitones: payload.semitones, targetKey: String(payload.targetKey || '').slice(0, 8), originalKey: String(payload.originalKey || '').slice(0, 8), tracks: stored, updatedAt: new Date().toISOString() };
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: `${folder}/key.json`, ContentType: 'application/json', CacheControl: 'no-store', Body: JSON.stringify(key) }));
    // El tono anterior se reemplaza: sus archivos se borran, también pistas que ya no estén en este.
    const current = new Set([`${folder}/key.json`, ...tracks.map((track: { key: string }) => track.key)]);
    await removeCopies(folder, item => current.has(item));
    return json({ key });
  } catch (error) { console.error('[live-director-event-key] PUT failed:', error); return securityErrorResponse(error); }
};

// Volver al tono original borra la copia de este evento. Con `only_unfinished` (se canceló o falló un
// cambio) borra solo lo que no pertenece al tono vigente, que sigue sonando.
export const DELETE: APIRoute = async ({ cookies, request }) => {
  try {
    const payload = await request.json().catch(() => null);
    if (!payload) throw new ApiSecurityError('Solicitud invalida.', 400);
    const { eventId, songId, folder } = context(payload);
    await access(cookies, eventId, songId, true);
    if (payload.only_unfinished === true) {
      const { bucket, client } = r2();
      const stored = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `${folder}/key.json` })).catch(() => null);
      const current = stored ? JSON.parse(await stored.Body!.transformToString()) : null;
      const base = `${publicBase()}/`;
      const kept = new Set<string>(current ? [`${folder}/key.json`, ...Object.values(current.tracks as Record<string, { url: string }>).map(track => track.url.slice(base.length))] : []);
      await removeCopies(folder, item => kept.has(item));
      return json({ key: current });
    }
    await removeCopies(folder);
    return json({ key: null });
  } catch (error) { console.error('[live-director-event-key] DELETE failed:', error); return securityErrorResponse(error); }
};
