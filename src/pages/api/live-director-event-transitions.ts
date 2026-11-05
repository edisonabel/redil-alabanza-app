import type { APIRoute } from 'astro';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ApiSecurityError, assertRequestBodySize, requireAuthenticatedUser, securityErrorResponse, serviceRoleClient } from '../../lib/server/api-security.js';
import { readEnv } from '../../lib/server/supabase-env.js';
import { getLiveDirectorEventAccess } from '../../lib/server/live-director-event-permissions.js';
import { normalizeSongTransition, normalizeSongTransitions } from '../../utils/liveDirectorSongTransitions';
export const prerender = false;
// Transiciones entre canciones de un evento (Sobreponer, AutoLink…): un archivo por evento. Las leen todos
// los asignados; las guardan el líder de alabanza, el director musical o un administrador. Aparte, un modo
// para todos los eventos (cada paso sin elección propia), que solo cambia un administrador.
const DEFAULT_KEY = 'live-director/event-transitions/_all-events.json';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function storage() {
  const endpoint = readEnv('R2_ENDPOINT'), accessKeyId = readEnv('R2_ACCESS_KEY_ID'), secretAccessKey = readEnv('R2_SECRET_ACCESS_KEY'), bucket = readEnv('R2_BUCKET_NAME');
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) throw new ApiSecurityError('Almacenamiento no configurado.', 503);
  return { bucket, client: new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey } }) };
}
async function context(cookies: Parameters<typeof requireAuthenticatedUser>[0], eventId: string, write: boolean) {
  if (!uuid.test(eventId)) throw new ApiSecurityError('Evento inválido.', 400);
  const user = await requireAuthenticatedUser(cookies);
  if (!serviceRoleClient) throw new ApiSecurityError('Autorización no disponible.', 503);
  const access = await getLiveDirectorEventAccess(serviceRoleClient, user.id, eventId).catch(() => { throw new ApiSecurityError('No se pudo comprobar el permiso.', 503); });
  if (!access.canRead) throw new ApiSecurityError('Debes estar asignado a este evento.', 403);
  if (write && !access.canWriteMix) throw new ApiSecurityError('Solo el líder de alabanza y el director musical de este evento, o un administrador, pueden guardar las transiciones.', 403);
  return { ...access, userId: user.id, key: `live-director/event-transitions/${eventId}.json` };
}
async function readJson(client: S3Client, bucket: string, key: string) {
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return JSON.parse(await result.Body!.transformToString());
  } catch (error) {
    const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}
export const GET: APIRoute = async ({ cookies, url }) => {
  try {
    const access = await context(cookies, url.searchParams.get('evento_id') || '', false);
    const { client, bucket } = storage();
    const [stored, defaults] = await Promise.all([readJson(client, bucket, access.key), readJson(client, bucket, DEFAULT_KEY)]);
    return json({
      transitions: stored ? normalizeSongTransitions(stored.transitions) : null, canEdit: access.canWriteMix,
      defaultTransition: normalizeSongTransition(defaults?.transition), canEditDefault: access.isAdmin === true,
    });
  } catch (error) { return securityErrorResponse(error); }
};
export const PUT: APIRoute = async ({ request, cookies, url }) => {
  try {
    if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) throw new ApiSecurityError('Origen no permitido.', 403);
    assertRequestBodySize(request, 32 * 1024);
    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ApiSecurityError('Solicitud inválida.', 400);
    const eventId = String(payload.evento_id || '');
    if ('defaultTransition' in payload) {
      const access = await context(cookies, eventId, false);
      if (!access.isAdmin) throw new ApiSecurityError('Solo un administrador puede cambiar el modo de todos los eventos.', 403);
      const transition = payload.defaultTransition === null ? null : normalizeSongTransition(payload.defaultTransition);
      if (payload.defaultTransition !== null && !transition) throw new ApiSecurityError('Transición inválida.', 400);
      const { client, bucket } = storage();
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: DEFAULT_KEY, ContentType: 'application/json; charset=utf-8', CacheControl: 'no-store',
        Body: JSON.stringify({ transition, updatedBy: access.userId, updatedAt: new Date().toISOString() }) }));
      return json({ defaultTransition: transition });
    }
    const access = await context(cookies, eventId, true);
    // Solo canciones del repertorio de este evento.
    const playlist = await serviceRoleClient!.from('playlists').select('id').eq('evento_id', eventId).maybeSingle();
    if (playlist.error) throw playlist.error;
    if (!playlist.data) throw new ApiSecurityError('El evento no tiene un repertorio disponible.', 404);
    const items = await serviceRoleClient!.from('playlist_canciones').select('cancion_id').eq('playlist_id', playlist.data.id);
    if (items.error) throw items.error;
    const songIds = new Set((items.data || []).map(item => String(item.cancion_id)));
    const transitions = Object.fromEntries(Object.entries(normalizeSongTransitions(payload.transitions)).filter(([songId]) => songIds.has(songId)));
    const { client, bucket } = storage();
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: access.key, ContentType: 'application/json; charset=utf-8', CacheControl: 'no-store',
      Body: JSON.stringify({ transitions, updatedBy: access.userId, updatedAt: new Date().toISOString() }) }));
    return json({ transitions });
  } catch (error) { return securityErrorResponse(error); }
};
