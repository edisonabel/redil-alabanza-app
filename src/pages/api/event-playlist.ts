import type { APIRoute } from 'astro';
import {
  ApiSecurityError,
  assertRequestBodySize,
  requireAuthenticatedUser,
  securityErrorResponse,
} from '../../lib/server/api-security.js';
import { getServerAuthTokens } from '../../lib/server/auth-cookies.js';
import { createSupabaseUserClient } from '../../lib/server/supabase-user-client.js';

export const prerender = false;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PLAYLIST_SONGS = 250;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

const isUuid = (value: unknown) => UUID_PATTERN.test(String(value || '').trim());

const getAuthenticatedDatabase = async (cookies: Parameters<typeof requireAuthenticatedUser>[0]) => {
  await requireAuthenticatedUser(cookies);
  const { accessToken } = getServerAuthTokens(cookies);
  return createSupabaseUserClient(accessToken);
};

const loadEventPlaylist = async (database: ReturnType<typeof createSupabaseUserClient>, eventoId: string) => {
  const { data: playlist, error: playlistError } = await database
    .from('playlists')
    .select('id, created_at, updated_at')
    .eq('evento_id', eventoId)
    .maybeSingle();

  if (playlistError) throw playlistError;
  if (!playlist) return { playlist: null, items: [] };

  const { data: items, error: itemsError } = await database
    .from('playlist_canciones')
    .select('orden, cancion_id, canciones(id, titulo, cantante, tonalidad, bpm, mp3, link_youtube, link_acordes, link_letras, link_voces, link_secuencias)')
    .eq('playlist_id', playlist.id)
    .order('orden');

  if (itemsError) throw itemsError;
  return { playlist, items: items || [] };
};

export const GET: APIRoute = async ({ cookies, url }) => {
  try {
    const eventoId = String(url.searchParams.get('evento_id') || '').trim();
    if (!isUuid(eventoId)) {
      throw new ApiSecurityError('evento_id debe ser un UUID valido.', 400);
    }

    const database = await getAuthenticatedDatabase(cookies);
    return json(await loadEventPlaylist(database, eventoId));
  } catch (error) {
    console.error('[event-playlist] GET failed:', error);
    return securityErrorResponse(error);
  }
};

export const PUT: APIRoute = async ({ request, cookies, url }) => {
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) {
      throw new ApiSecurityError('Origen no permitido.', 403);
    }

    assertRequestBodySize(request, 64 * 1024);
    const payload = await request.json().catch(() => null);
    const eventoId = String(payload?.evento_id || '').trim();
    const requestedSongIds: unknown[] = Array.isArray(payload?.cancion_ids) ? payload.cancion_ids : [];
    const songIds = [...new Set<string>(
      requestedSongIds.map((value) => String(value || '').trim()).filter(Boolean),
    )];

    if (!isUuid(eventoId)) {
      throw new ApiSecurityError('evento_id debe ser un UUID valido.', 400);
    }
    if (songIds.length > MAX_PLAYLIST_SONGS) {
      throw new ApiSecurityError(`El repertorio no puede exceder ${MAX_PLAYLIST_SONGS} canciones.`, 400);
    }
    if (songIds.some((songId) => !isUuid(songId))) {
      throw new ApiSecurityError('El repertorio contiene identificadores de canciones invalidos.', 400);
    }

    const database = await getAuthenticatedDatabase(cookies);

    const { data: event, error: eventError } = await database
      .from('eventos')
      .select('id')
      .eq('id', eventoId)
      .maybeSingle();
    if (eventError) throw eventError;
    if (!event) throw new ApiSecurityError('El evento no existe o no esta disponible.', 404);

    if (songIds.length > 0) {
      const { data: songs, error: songsError } = await database
        .from('canciones')
        .select('id')
        .in('id', songIds);
      if (songsError) throw songsError;

      const validSongIds = new Set((songs || []).map((song) => String(song.id)));
      if (songIds.some((songId) => !validSongIds.has(songId))) {
        throw new ApiSecurityError('Una o mas canciones ya no estan disponibles.', 400);
      }
    }

    const { data: playlist, error: playlistError } = await database
      .from('playlists')
      .upsert({ evento_id: eventoId }, { onConflict: 'evento_id' })
      .select('id, created_at, updated_at')
      .single();
    if (playlistError || !playlist) throw playlistError || new Error('No se pudo crear el repertorio.');

    const { data: previousItems, error: previousItemsError } = await database
      .from('playlist_canciones')
      .select('id')
      .eq('playlist_id', playlist.id);
    if (previousItemsError) throw previousItemsError;

    const previousItemIds = (previousItems || []).map((item) => item.id).filter(Boolean);
    let insertedItemIds: string[] = [];

    if (songIds.length > 0) {
      const insertPayload = songIds.map((cancionId, orden) => ({
        playlist_id: playlist.id,
        cancion_id: cancionId,
        orden,
      }));
      const { data: insertedItems, error: insertError } = await database
        .from('playlist_canciones')
        .insert(insertPayload)
        .select('id');
      if (insertError) throw insertError;
      insertedItemIds = (insertedItems || []).map((item) => item.id).filter(Boolean);
    }

    if (previousItemIds.length > 0) {
      const { error: deleteError } = await database
        .from('playlist_canciones')
        .delete()
        .in('id', previousItemIds);

      if (deleteError) {
        if (insertedItemIds.length > 0) {
          await database.from('playlist_canciones').delete().in('id', insertedItemIds);
        }
        throw deleteError;
      }
    }

    return json(await loadEventPlaylist(database, eventoId));
  } catch (error) {
    console.error('[event-playlist] PUT failed:', error);
    return securityErrorResponse(error);
  }
};
