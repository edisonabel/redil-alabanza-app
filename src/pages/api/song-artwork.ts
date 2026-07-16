import type { APIRoute } from 'astro';
import {
  ApiSecurityError,
  assertRequestBodySize,
  consumeRateLimit,
  requireAdminUser,
  securityErrorResponse,
  serviceRoleClient,
} from '../../lib/server/api-security.js';
import { storeSongArtwork } from '../../lib/server/song-artwork-storage.js';
import { loadEmbeddedCoverArt } from './mp3-cover-art';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const jsonResponse = (body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  },
);

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    assertRequestBodySize(request, 8 * 1024);
    const requestOrigin = request.headers.get('origin');
    if (requestOrigin && requestOrigin !== new URL(request.url).origin) {
      return jsonResponse({ error: 'Origen no permitido.' }, 403);
    }

    const user = await requireAdminUser(cookies);
    await consumeRateLimit({
      bucket: 'song-artwork',
      actorId: user.id,
      windowSeconds: 60 * 60,
      maxRequests: 200,
    });

    if (!serviceRoleClient) {
      return jsonResponse({ error: 'Servicio de datos no configurado.' }, 503);
    }

    const body = await request.json().catch(() => ({}));
    const songId = String(body?.songId || '').trim();
    if (!UUID_PATTERN.test(songId)) {
      return jsonResponse({ error: 'Identificador de cancion invalido.' }, 400);
    }

    const { data: song, error: songError } = await serviceRoleClient
      .from('canciones')
      .select('id, mp3')
      .eq('id', songId)
      .maybeSingle();

    if (songError) throw songError;
    if (!song) return jsonResponse({ error: 'La cancion no existe.' }, 404);

    const mp3Url = String(song.mp3 || '').trim();
    if (!mp3Url) {
      return jsonResponse({ error: 'La cancion no tiene audio asociado.' }, 422);
    }

    const { coverArt, status } = await loadEmbeddedCoverArt(mp3Url);
    if (!coverArt && status >= 400) {
      return jsonResponse({
        error: 'No se pudo leer el audio para generar la miniatura.',
      }, 502);
    }

    const stored = await storeSongArtwork({ songId, mp3Url, coverArt });
    return jsonResponse({
      artworkUrl: stored.publicUrl,
      bytes: stored.bytes,
      placeholder: !coverArt,
      size: 500,
    });
  } catch (error) {
    if (error instanceof ApiSecurityError) return securityErrorResponse(error);
    console.error('[song-artwork] generation failed:', error);
    return jsonResponse({ error: 'No se pudo generar la miniatura.' }, 500);
  }
};
