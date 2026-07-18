import type { APIRoute } from 'astro';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  ApiSecurityError,
  assertRequestBodySize,
  requireAuthenticatedUser,
  securityErrorResponse,
  serviceRoleClient,
} from '../../lib/server/api-security.js';
import { getServerAuthTokens } from '../../lib/server/auth-cookies.js';
import { createSupabaseUserClient } from '../../lib/server/supabase-user-client.js';
import { readEnv } from '../../lib/server/supabase-env.js';

export const prerender = false;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_EVENT_MIX_TRACKS = 64;
const MAX_TRACK_ID_LENGTH = 160;
const EVENT_MIX_OBJECT_PREFIX = 'live-director/event-mixes';

let cachedR2Context: { bucket: string; client: S3Client } | null = null;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

const isUuid = (value: unknown) => UUID_PATTERN.test(String(value || '').trim());

const getR2Context = () => {
  if (cachedR2Context) return cachedR2Context;

  const endpoint = readEnv('R2_ENDPOINT');
  const accessKeyId = readEnv('R2_ACCESS_KEY_ID');
  const secretAccessKey = readEnv('R2_SECRET_ACCESS_KEY');
  const bucket = readEnv('R2_BUCKET_NAME');

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new ApiSecurityError('Almacenamiento de mezclas no configurado.', 503);
  }

  cachedR2Context = {
    bucket,
    client: new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
  return cachedR2Context;
};

const buildMixObjectKey = (eventId: string, songId: string) => (
  `${EVENT_MIX_OBJECT_PREFIX}/${eventId}/${songId}.json`
);

const sanitizeMix = (value: unknown) => {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const sourceTracks = Array.isArray(source?.tracks) ? source.tracks : [];

  if (sourceTracks.length === 0 || sourceTracks.length > MAX_EVENT_MIX_TRACKS) {
    throw new ApiSecurityError('La mezcla debe contener entre 1 y 64 stems.', 400);
  }

  const seenTrackIds = new Set<string>();
  const tracks = sourceTracks.map((rawTrack) => {
    const track = rawTrack && typeof rawTrack === 'object' && !Array.isArray(rawTrack)
      ? rawTrack as Record<string, unknown>
      : {};
    const id = String(track.id || '').trim();
    const numericVolume = Number(track.volume);

    if (!id || id.length > MAX_TRACK_ID_LENGTH || seenTrackIds.has(id)) {
      throw new ApiSecurityError('La mezcla contiene identificadores de stems invalidos.', 400);
    }
    if (!Number.isFinite(numericVolume)) {
      throw new ApiSecurityError('La mezcla contiene un volumen invalido.', 400);
    }

    seenTrackIds.add(id);
    return {
      id,
      enabled: track.enabled !== false,
      volume: Math.round(Math.max(0, Math.min(1, numericVolume)) * 10000) / 10000,
    };
  });

  if (!tracks.some((track) => track.enabled)) {
    throw new ApiSecurityError('La mezcla debe mantener al menos un stem activo.', 400);
  }

  return { version: 1, tracks };
};

const getAuthenticatedDatabase = async (cookies: Parameters<typeof requireAuthenticatedUser>[0]) => {
  const user = await requireAuthenticatedUser(cookies);
  const { accessToken } = getServerAuthTokens(cookies);
  return { user, database: createSupabaseUserClient(accessToken) };
};

const requireEventAccess = async (userId: string, eventId: string) => {
  if (!serviceRoleClient) {
    throw new ApiSecurityError('Servicio de autorizacion no configurado.', 503);
  }

  const [profileResult, assignmentResult] = await Promise.all([
    serviceRoleClient
      .from('perfiles')
      .select('is_admin')
      .eq('id', userId)
      .maybeSingle(),
    serviceRoleClient
      .from('asignaciones')
      .select('id')
      .eq('evento_id', eventId)
      .eq('perfil_id', userId)
      .limit(1)
      .maybeSingle(),
  ]);

  if (profileResult.error || assignmentResult.error) {
    throw new ApiSecurityError('No se pudo validar el acceso al evento.', 503);
  }
  if (!profileResult.data?.is_admin && !assignmentResult.data) {
    throw new ApiSecurityError('Debes estar asignado a este evento para guardar su mezcla.', 403);
  }
};

const requireEventPlaylistSong = async (
  database: ReturnType<typeof createSupabaseUserClient>,
  eventId: string,
  songId: string,
) => {
  const { data: playlist, error: playlistError } = await database
    .from('playlists')
    .select('id')
    .eq('evento_id', eventId)
    .maybeSingle();

  if (playlistError) throw playlistError;
  if (!playlist) throw new ApiSecurityError('El evento no tiene un repertorio disponible.', 404);

  const { data: playlistSong, error: playlistSongError } = await database
    .from('playlist_canciones')
    .select('id')
    .eq('playlist_id', playlist.id)
    .eq('cancion_id', songId)
    .limit(1)
    .maybeSingle();

  if (playlistSongError) throw playlistSongError;
  if (!playlistSong) {
    throw new ApiSecurityError('La cancion no pertenece al repertorio de este evento.', 404);
  }
};

const readMix = async (eventId: string, songId: string) => {
  const { bucket, client } = getR2Context();

  try {
    const response = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: buildMixObjectKey(eventId, songId),
    }));
    const rawBody = await response.Body?.transformToString();
    if (!rawBody) return null;
    const storedValue = JSON.parse(rawBody) as Record<string, unknown>;
    return {
      ...sanitizeMix(storedValue),
      updatedAt: String(storedValue.updatedAt || '').trim(),
      updatedBy: String(storedValue.updatedBy || '').trim(),
    };
  } catch (error) {
    const code = String((error as { name?: string; Code?: string })?.name || (error as { Code?: string })?.Code || '');
    const status = Number((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode || 0);
    if (code === 'NoSuchKey' || code === 'NotFound' || status === 404) return null;
    throw error;
  }
};

const writeMix = async (eventId: string, songId: string, mix: Record<string, unknown>) => {
  const { bucket, client } = getR2Context();
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: buildMixObjectKey(eventId, songId),
    Body: JSON.stringify(mix),
    ContentType: 'application/json; charset=utf-8',
    CacheControl: 'no-store',
  }));
};

const readContext = (value: Record<string, unknown> | URLSearchParams) => {
  const eventId = String(
    value instanceof URLSearchParams ? value.get('evento_id') : value.evento_id || '',
  ).trim();
  const songId = String(
    value instanceof URLSearchParams ? value.get('cancion_id') : value.cancion_id || '',
  ).trim();

  if (!isUuid(eventId) || !isUuid(songId)) {
    throw new ApiSecurityError('evento_id y cancion_id deben ser UUID validos.', 400);
  }

  return { eventId, songId };
};

export const GET: APIRoute = async ({ cookies, url }) => {
  try {
    const { eventId, songId } = readContext(url.searchParams);
    const { user, database } = await getAuthenticatedDatabase(cookies);
    await Promise.all([
      requireEventAccess(user.id, eventId),
      requireEventPlaylistSong(database, eventId, songId),
    ]);
    return json({ mix: await readMix(eventId, songId) });
  } catch (error) {
    console.error('[live-director-event-mix] GET failed:', error);
    return securityErrorResponse(error);
  }
};

export const PUT: APIRoute = async ({ request, cookies, url }) => {
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) {
      throw new ApiSecurityError('Origen no permitido.', 403);
    }

    assertRequestBodySize(request, 32 * 1024);
    const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!payload) throw new ApiSecurityError('Solicitud invalida.', 400);

    const { eventId, songId } = readContext(payload);
    const mix = sanitizeMix(payload.mix);
    const { user, database } = await getAuthenticatedDatabase(cookies);
    await Promise.all([
      requireEventAccess(user.id, eventId),
      requireEventPlaylistSong(database, eventId, songId),
    ]);

    const storedMix = {
      ...mix,
      updatedAt: new Date().toISOString(),
      updatedBy: user.id,
    };
    await writeMix(eventId, songId, storedMix);
    return json({ mix: storedMix });
  } catch (error) {
    console.error('[live-director-event-mix] PUT failed:', error);
    return securityErrorResponse(error);
  }
};
