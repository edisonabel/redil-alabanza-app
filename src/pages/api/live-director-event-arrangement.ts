import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ApiSecurityError, assertRequestBodySize, requireAuthenticatedUser, securityErrorResponse, serviceRoleClient } from '../../lib/server/api-security.js';
import { getServerAuthTokens } from '../../lib/server/auth-cookies.js';
import { createSupabaseUserClient } from '../../lib/server/supabase-user-client.js';
import { readEnv } from '../../lib/server/supabase-env.js';
import { getLiveDirectorEventAccess } from '../../lib/server/live-director-event-permissions.js';
import { buildLiveDirectorSectionsFromMarkers } from '../../utils/liveDirectorSongSession';
import { normalizeEventArrangement } from '../../utils/liveDirectorEventArrangement';
export const prerender = false;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function storage() {
  const endpoint = readEnv('R2_ENDPOINT'), accessKeyId = readEnv('R2_ACCESS_KEY_ID'), secretAccessKey = readEnv('R2_SECRET_ACCESS_KEY'), bucket = readEnv('R2_BUCKET_NAME');
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) throw new ApiSecurityError('Almacenamiento no configurado.', 503);
  return { bucket, client: new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey } }) };
}
async function context(cookies: Parameters<typeof requireAuthenticatedUser>[0], eventId: string, songId: string, write: boolean) {
  if (!uuid.test(eventId) || !uuid.test(songId)) throw new ApiSecurityError('Evento o canción inválidos.', 400);
  const user = await requireAuthenticatedUser(cookies);
  if (!serviceRoleClient) throw new ApiSecurityError('Autorización no disponible.', 503);
  const access = await getLiveDirectorEventAccess(serviceRoleClient, user.id, eventId).catch(() => { throw new ApiSecurityError('No se pudo comprobar el permiso.', 503); });
  if (!access.canRead || (write && !access.canWrite)) throw new ApiSecurityError('Solo el director musical del evento y el administrador pueden guardar arreglos.', 403);
  const database = createSupabaseUserClient(getServerAuthTokens(cookies).accessToken);
  const playlist = await database.from('playlists').select('id').eq('evento_id', eventId).maybeSingle();
  if (playlist.error) throw playlist.error;
  if (!playlist.data) throw new ApiSecurityError('Repertorio no disponible.', 404);
  const item = await database.from('playlist_canciones').select('id').eq('playlist_id', playlist.data.id).eq('cancion_id', songId).limit(1).maybeSingle();
  if (item.error) throw item.error;
  if (!item.data) throw new ApiSecurityError('La canción no pertenece al evento.', 404);
  const song = await database.from('canciones').select('section_markers, multitrack_session').eq('id', songId).maybeSingle();
  if (song.error) throw song.error;
  if (!song.data) throw new ApiSecurityError('Canción no disponible.', 404);
  const markers = Array.isArray(song.data.section_markers) ? song.data.section_markers : [];
  const sectionIds = new Set((buildLiveDirectorSectionsFromMarkers(markers) || []).map(section => section.id));
  if (write && !sectionIds.size) throw new ApiSecurityError('La canción no tiene secciones disponibles.', 409);
  const sourceSignature = createHash('sha256').update(JSON.stringify({ markers, offset: song.data.multitrack_session?.sectionOffsetSeconds ?? 0 })).digest('hex');
  return { ...access, canWrite: access.canWrite && sectionIds.size > 0, userId: user.id, sourceSignature, sectionIds, key: `live-director/event-arrangements/${eventId}/${songId}.json` };
}
async function read(client: S3Client, bucket: string, key: string) {
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = JSON.parse(await result.Body!.transformToString());
    return { arrangement: normalizeEventArrangement(body.arrangement), revision: result.ETag || '' };
  } catch (error) {
    const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return { arrangement: null, revision: '' };
    throw error;
  }
}
export const GET: APIRoute = async ({ cookies, url }) => {
  try {
    const access = await context(cookies, url.searchParams.get('evento_id') || '', url.searchParams.get('cancion_id') || '', false);
    const { client, bucket } = storage();
    return json({ ...await read(client, bucket, access.key), canEdit: access.canWrite, sourceSignature: access.sourceSignature });
  } catch (error) { return securityErrorResponse(error); }
};
export const PUT: APIRoute = async ({ request, cookies, url }) => {
  try {
    if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) throw new ApiSecurityError('Origen no permitido.', 403);
    assertRequestBodySize(request, 32 * 1024);
    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ApiSecurityError('Solicitud inválida.', 400);
    const access = await context(cookies, String(payload.evento_id || ''), String(payload.cancion_id || ''), true);
    let arrangement;
    try { arrangement = normalizeEventArrangement(payload.arrangement); } catch { throw new ApiSecurityError('Arreglo inválido.', 400); }
    if (arrangement.sourceSignature !== access.sourceSignature) throw new ApiSecurityError('Las secciones originales cambiaron. Recarga antes de guardar el arreglo.', 409);
    if (arrangement.entries?.some(entry => !access.sectionIds.has(entry.sectionId))) throw new ApiSecurityError('El arreglo contiene una sección ajena a esta canción.', 400);
    if (typeof payload.revision !== 'string' || payload.revision.length > 200) throw new ApiSecurityError('Revisión inválida.', 400);
    const { client, bucket } = storage();
    let result;
    try {
      result = await client.send(new PutObjectCommand({ Bucket: bucket, Key: access.key, Body: JSON.stringify({ arrangement, updatedBy: access.userId, updatedAt: new Date().toISOString() }), ContentType: 'application/json', CacheControl: 'no-store', ...(payload.revision ? { IfMatch: payload.revision } : { IfNoneMatch: '*' }) }));
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412) throw new ApiSecurityError('Otro director guardó cambios. Recarga antes de sobrescribir.', 409);
      throw error;
    }
    return json({ arrangement, revision: result.ETag || '' });
  } catch (error) { return securityErrorResponse(error); }
};
