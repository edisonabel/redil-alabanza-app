import { assertSongOwnsStemUrls, isSongOwnedStemKey } from '../../utils/liveDirectorSessionSafety.ts';
import { createSupabaseUserClient } from '../../lib/server/supabase-user-client.js';
import { getServerAuthTokens } from '../../lib/server/auth-cookies.js';
import { createClient } from '@supabase/supabase-js';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  buildLiveDirectorSongFolder,
  normalizePersistedLiveDirectorSession,
} from '../../utils/liveDirectorSongSession.ts';
import { resolveTrackOutputRoute } from '../../utils/liveDirectorTrackRouting.ts';
import { assertCanManageLiveDirectorUploads } from '../../lib/server/live-director-permissions.js';
import { getSupabaseServerEnv, getSupabaseServiceRoleKey, readEnv } from '../../lib/server/supabase-env.js';

const { supabaseUrl, supabaseAnonKey } = getSupabaseServerEnv();
const supabaseServiceRoleKey = getSupabaseServiceRoleKey();

const authClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
const serviceRoleClient = supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
  : null;
const PUBLIC_R2_HOST = 'stems.alabanzaredilestadio.com';
const PUBLIC_R2_BASE_URL = `https://${PUBLIC_R2_HOST}`;

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const normalizePublicBaseUrl = (value = '') => {
  const fallback = PUBLIC_R2_BASE_URL;
  const rawValue = String(value || fallback).trim() || fallback;

  try {
    const parsed = new URL(rawValue);
    if (parsed.hostname.toLowerCase().endsWith('.r2.dev')) {
      parsed.protocol = 'https:';
      parsed.hostname = PUBLIC_R2_HOST;
      parsed.port = '';
    }
    return parsed.href.replace(/\/+$/, '');
  } catch {
    return fallback;
  }
};

const getR2ObjectKeyFromUrl = (fileUrl = '', publicBaseUrl = '') => {
  const normalizedFileUrl = String(fileUrl || '').trim();
  const normalizedPublicBaseUrl = normalizePublicBaseUrl(publicBaseUrl);

  if (!normalizedFileUrl || !normalizedPublicBaseUrl) return null;

  try {
    const parsedFileUrl = new URL(normalizedFileUrl);
    const fileHost = parsedFileUrl.hostname.toLowerCase();
    if (fileHost === PUBLIC_R2_HOST || fileHost.endsWith('.r2.dev')) {
      return decodeURIComponent(parsedFileUrl.pathname.replace(/^\/+/, '').split('?')[0] || '');
    }
  } catch {
    // Fall back to exact-prefix parsing below.
  }

  const expectedPrefix = `${normalizedPublicBaseUrl}/`;
  if (!normalizedFileUrl.startsWith(expectedPrefix)) return null;
  return decodeURIComponent(normalizedFileUrl.slice(expectedPrefix.length).split('?')[0] || '');
};

const createR2Context = () => {
  const endpoint = readEnv('R2_ENDPOINT');
  const accessKeyId = readEnv('R2_ACCESS_KEY_ID');
  const secretAccessKey = readEnv('R2_SECRET_ACCESS_KEY');
  const bucket = readEnv('R2_BUCKET_NAME');
  const publicBaseUrl = normalizePublicBaseUrl(readEnv('PUBLIC_R2_URL', 'R2_PUBLIC_URL'));

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    throw new Error('Faltan variables de Cloudflare R2 para Live Director.');
  }

  return {
    bucket,
    publicBaseUrl,
    client: new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    }),
  };
};

const requireAuthenticatedUser = async (cookies) => {
  const token = cookies.get('sb-access-token')?.value;
  if (!token) {
    throw new Error('No autorizado. Falta token de acceso.');
  }

  const {
    data: { user },
    error,
  } = await authClient.auth.getUser(token);

  if (error || !user) {
    throw new Error('No autorizado. Token invalido o expirado.');
  }

  return user;
};

const normalizeIncomingTracks = (rawTracks) => {
  const normalizedTracks = (Array.isArray(rawTracks) ? rawTracks : [])
    .map((track) => {
      if (!track || typeof track !== 'object') return null;

      const id = String(track.id || '').trim();
      const name = String(track.name || '').trim();
      const url = String(track.url || '').trim();
      const sourceFileName = String(track.sourceFileName || '').trim() || undefined;

      if (!id || !name || !url) {
        return null;
      }

      return {
        id,
        name,
        url,
        iosUrl: String(track.iosUrl || '').trim() || undefined,
        nativeUrl: String(track.nativeUrl || '').trim() || undefined,
        optimizedUrl: String(track.optimizedUrl || '').trim() || undefined,
        cafUrl: String(track.cafUrl || '').trim() || undefined,
        pcmUrl: String(track.pcmUrl || '').trim() || undefined,
        volume: Number.isFinite(Number(track.volume)) ? Number(track.volume) : 1,
        isMuted: Boolean(track.isMuted),
        enabled: track.enabled !== false,
        sourceFileName,
        outputRoute: resolveTrackOutputRoute({
          id,
          name,
          sourceFileName,
          outputRoute: track.outputRoute,
        }),
      };
    })
    .filter(Boolean);

  if (normalizedTracks.length === 0) {
    throw new Error('La sesion no contiene pistas validas.');
  }

  return normalizedTracks;
};

const deleteSessionFiles = async (sessionRecord, r2Context, { keepUrls = [], songId } = {}) => {
  const normalizedSession = normalizePersistedLiveDirectorSession(sessionRecord);
  if (!normalizedSession) {
    return;
  }

  const keepSet = new Set((Array.isArray(keepUrls) ? keepUrls : []).map((url) => String(url || '').trim()));
  const candidateUrls = [
    normalizedSession.manifestUrl,
    ...normalizedSession.tracks.flatMap((track) => [
      track.url,
      track.iosUrl,
      track.nativeUrl,
      track.optimizedUrl,
      track.cafUrl,
      track.pcmUrl,
    ]),
  ];

  const objectKeys = candidateUrls
    .filter((url) => url && !keepSet.has(url))
    .map((url) => getR2ObjectKeyFromUrl(url, r2Context.publicBaseUrl))
    .filter((key) => key && songId && isSongOwnedStemKey(key, songId));

  await Promise.all(
    [...new Set(objectKeys)].map((objectKey) =>
      r2Context.client.send(
        new DeleteObjectCommand({
          Bucket: r2Context.bucket,
          Key: objectKey,
        }),
      ).catch((error) => {
        console.warn('Live Director cleanup skipped for object:', objectKey, error);
      }),
    ),
  );
};

const fetchSongRow = async (songId, client) => {
  const withSession = await client
    .from('canciones')
    .select('id, titulo, multitrack_session')
    .eq('id', songId)
    .maybeSingle();

  if (!withSession.error) {
    return withSession.data;
  }

  const fallback = await client
    .from('canciones')
    .select('id, titulo')
    .eq('id', songId)
    .maybeSingle();

  if (fallback.error) {
    throw fallback.error;
  }

  return fallback.data ? { ...fallback.data, multitrack_session: null } : null;
};

export const GET = async ({ request, cookies }) => {
  try {
    await requireAuthenticatedUser(cookies);

    const url = new URL(request.url);
    const songId = String(url.searchParams.get('songId') || '').trim();

    if (!songId) {
      return jsonResponse({ error: 'Se requiere songId.' }, 400);
    }

    const { accessToken } = getServerAuthTokens(cookies);
    const songRow = await fetchSongRow(songId, createSupabaseUserClient(accessToken));

    if (!songRow) {
      return jsonResponse({ error: 'La cancion solicitada no existe.' }, 404);
    }

    const session = normalizePersistedLiveDirectorSession(songRow.multitrack_session, {
      songId,
      songTitle: String(songRow.titulo || ''),
    });

    return jsonResponse({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno del servidor.';
    const status = message.startsWith('No autorizado') ? 401 : 500;
    console.error('Live Director session fetch error:', error);
    return jsonResponse({ error: message }, status);
  }
};

export const POST = async ({ request, cookies }) => {
  try {
    if (!serviceRoleClient) {
      return jsonResponse({ error: 'Falta SUPABASE_SERVICE_ROLE_KEY para validar permisos.' }, 500);
    }

    const user = await requireAuthenticatedUser(cookies);
    await assertCanManageLiveDirectorUploads({
      serviceRoleClient,
      userId: user.id,
    });

    const body = await request.json().catch(() => ({}));
    const songId = String(body?.songId || '').trim();
    const rawSession = body?.session || {};

    if (!songId) {
      return jsonResponse({ error: 'Se requiere songId.' }, 400);
    }

    const songRow = await fetchSongRow(songId, createSupabaseUserClient(getServerAuthTokens(cookies).accessToken));

    if (!songRow) {
      return jsonResponse({ error: 'La cancion solicitada no existe.' }, 404);
    }

    const r2Context = createR2Context();
    const folder = buildLiveDirectorSongFolder(songId, String(songRow.titulo || ''));
    const mode = rawSession?.mode === 'folder' ? 'folder' : 'sequence';
    const sectionOffsetSeconds = Number.isFinite(Number(rawSession?.sectionOffsetSeconds))
      ? Number(rawSession.sectionOffsetSeconds)
      : 0;
    const tracks = normalizeIncomingTracks(rawSession?.tracks);
    assertSongOwnsStemUrls(songId, tracks);
    const unmatchedFiles = Array.isArray(rawSession?.unmatchedFiles)
      ? rawSession.unmatchedFiles.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const manifestUrl = `${r2Context.publicBaseUrl}/${folder}/manifest.json`;
    // Mixer autosaves resend only tracks. The REAPER map (sections, instructions, timing)
    // belongs to these same stems, so keep it unless the audio itself changed.
    const currentSession = normalizePersistedLiveDirectorSession(songRow.multitrack_session, { songId, songTitle: String(songRow.titulo || '') });
    const sameStems = Boolean(currentSession) && tracks.every((track) => currentSession.tracks.some((current) => current.url === track.url));
    const reaperMap = sameStems ? Object.fromEntries(['sectionMarkers', 'instructionMarkers', 'reaperTiming']
      .filter((key) => currentSession[key]).map((key) => [key, currentSession[key]])) : {};
    // El modo de guía es de la canción, no de los archivos: se conserva al guardar la mezcla.
    if (currentSession?.guideMode) reaperMap.guideMode = currentSession.guideMode;
    if (currentSession?.padKitId) reaperMap.padKitId = currentSession.padKitId;

    const persistedSession = {
      version: 1,
      songId,
      songTitle: String(songRow.titulo || ''),
      mode,
      sectionOffsetSeconds,
      ...reaperMap,
      folder,
      manifestUrl,
      updatedAt: new Date().toISOString(),
      tracks,
      unmatchedFiles,
    };

    await r2Context.client.send(
      new PutObjectCommand({
        Bucket: r2Context.bucket,
        Key: `${folder}/manifest.json`,
        ContentType: 'application/json',
        Body: JSON.stringify(persistedSession, null, 2),
      }),
    );

    const { error: updateError } = await serviceRoleClient
      .from('canciones')
      .update({ multitrack_session: persistedSession })
      .eq('id', songId);

    if (updateError) {
      if (String(updateError.message || '').toLowerCase().includes('multitrack_session')) {
        throw new Error(
          'La columna multitrack_session aun no existe. Ejecuta la migracion migrations/024_multitrack_session_canciones.sql.',
        );
      }
      throw updateError;
    }

    await deleteSessionFiles(songRow.multitrack_session, r2Context, {
      songId,
      keepUrls: [
        manifestUrl,
        ...tracks.flatMap((track) => [
          track.url,
          track.iosUrl,
          track.nativeUrl,
          track.optimizedUrl,
          track.cafUrl,
          track.pcmUrl,
        ]),
      ],
    });

    return jsonResponse(persistedSession);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno del servidor.';
    const status = Number.isInteger(error?.status)
      ? error.status
      : message.startsWith('No autorizado')
        ? 401
        : 500;
    console.error('Live Director session save error:', error);
    return jsonResponse({ error: message }, status);
  }
};

export const PATCH = async ({ request, cookies }) => {
  try {
    if (!serviceRoleClient) {
      return jsonResponse({ error: 'Falta SUPABASE_SERVICE_ROLE_KEY para validar permisos.' }, 500);
    }

    const user = await requireAuthenticatedUser(cookies);
    await assertCanManageLiveDirectorUploads({
      serviceRoleClient,
      userId: user.id,
    });

    const body = await request.json().catch(() => ({}));
    const songId = String(body?.songId || '').trim();
    const rawOffset = Number(body?.sectionOffsetSeconds);
    // Cambio parcial: desfase de secciones, modo de guía («recorded» o «dynamic») y/o kit de pads (null = el del equipo).
    const hasOffset = body?.sectionOffsetSeconds !== undefined;
    const hasGuideMode = body?.guideMode !== undefined;
    const hasPadKit = body?.padKitId !== undefined;

    if (!songId) {
      return jsonResponse({ error: 'Se requiere songId.' }, 400);
    }

    if (!hasOffset && !hasGuideMode && !hasPadKit) {
      return jsonResponse({ error: 'No hay cambios para guardar.' }, 400);
    }

    if (hasOffset && !Number.isFinite(rawOffset)) {
      return jsonResponse({ error: 'sectionOffsetSeconds debe ser un numero valido.' }, 400);
    }

    if (hasGuideMode && !['recorded', 'dynamic'].includes(body.guideMode)) {
      return jsonResponse({ error: 'guideMode debe ser recorded o dynamic.' }, 400);
    }

    if (hasPadKit && body.padKitId !== null && !/^[a-z0-9-]{1,40}$/.test(String(body.padKitId))) {
      return jsonResponse({ error: 'padKitId no es válido.' }, 400);
    }

    const songRow = await fetchSongRow(songId, createSupabaseUserClient(getServerAuthTokens(cookies).accessToken));
    if (!songRow) {
      return jsonResponse({ error: 'La cancion solicitada no existe.' }, 404);
    }

    const currentSession = normalizePersistedLiveDirectorSession(songRow.multitrack_session, {
      songId,
      songTitle: String(songRow.titulo || ''),
    });
    if (!currentSession) {
      return jsonResponse({ error: 'La cancion no tiene una sesion multitrack guardada.' }, 404);
    }

    const r2Context = createR2Context();
    const folder = currentSession.folder || buildLiveDirectorSongFolder(songId, String(songRow.titulo || ''));
    const manifestUrl = `${r2Context.publicBaseUrl}/${folder}/manifest.json`;
    const { guideMode: _previousGuideMode, padKitId: _previousPadKit, ...sessionWithoutGuideMode } = currentSession;
    const guideMode = hasGuideMode ? body.guideMode : currentSession.guideMode;
    const padKitId = hasPadKit ? body.padKitId : currentSession.padKitId;
    const persistedSession = {
      ...sessionWithoutGuideMode,
      version: 1,
      songId,
      songTitle: String(songRow.titulo || ''),
      sectionOffsetSeconds: hasOffset ? Math.round(rawOffset * 4) / 4 : currentSession.sectionOffsetSeconds,
      ...(guideMode === 'dynamic' ? { guideMode: 'dynamic' } : {}),
      ...(padKitId ? { padKitId } : {}),
      folder,
      manifestUrl,
      updatedAt: new Date().toISOString(),
    };

    await r2Context.client.send(
      new PutObjectCommand({
        Bucket: r2Context.bucket,
        Key: `${folder}/manifest.json`,
        ContentType: 'application/json',
        Body: JSON.stringify(persistedSession, null, 2),
      }),
    );

    const { error: updateError } = await serviceRoleClient
      .from('canciones')
      .update({ multitrack_session: persistedSession })
      .eq('id', songId);

    if (updateError) {
      if (String(updateError.message || '').toLowerCase().includes('multitrack_session')) {
        throw new Error(
          'La columna multitrack_session aun no existe. Ejecuta la migracion migrations/024_multitrack_session_canciones.sql.',
        );
      }
      throw updateError;
    }

    return jsonResponse(persistedSession);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno del servidor.';
    const status = Number.isInteger(error?.status)
      ? error.status
      : message.startsWith('No autorizado')
        ? 401
        : 500;
    console.error('Live Director section offset save error:', error);
    return jsonResponse({ error: message }, status);
  }
};

export const DELETE = async ({ request, cookies }) => {
  try {
    if (!serviceRoleClient) {
      return jsonResponse({ error: 'Falta SUPABASE_SERVICE_ROLE_KEY para validar permisos.' }, 500);
    }

    const user = await requireAuthenticatedUser(cookies);
    await assertCanManageLiveDirectorUploads({
      serviceRoleClient,
      userId: user.id,
    });

    const body = await request.json().catch(() => ({}));
    const songId = String(body?.songId || '').trim();
    const trackId = String(body?.trackId || '').trim();

    if (!songId) {
      return jsonResponse({ error: 'Se requiere songId.' }, 400);
    }

    const songRow = await fetchSongRow(songId, createSupabaseUserClient(getServerAuthTokens(cookies).accessToken));

    if (!songRow) {
      return jsonResponse({ error: 'La cancion solicitada no existe.' }, 404);
    }

    const r2Context = createR2Context();

    if (trackId) {
      const currentSession = normalizePersistedLiveDirectorSession(songRow.multitrack_session, {
        songId,
        songTitle: String(songRow.titulo || ''),
      });

      if (!currentSession) {
        return jsonResponse({ error: 'La cancion no tiene una sesion multitrack guardada.' }, 404);
      }

      const trackToDelete = currentSession.tracks.find((track) => track.id === trackId);
      if (!trackToDelete) {
        return jsonResponse({ error: 'El stem solicitado no existe en esta sesion.' }, 404);
      }

      const remainingTracks = currentSession.tracks.filter((track) => track.id !== trackId);

      if (remainingTracks.length === 0) {
        const { error: clearError } = await serviceRoleClient
          .from('canciones')
          .update({ multitrack_session: null })
          .eq('id', songId);

        if (clearError) {
          throw clearError;
        }

        await deleteSessionFiles(currentSession, r2Context, { songId });

        return jsonResponse({ success: true, session: null });
      }

      const folder = currentSession.folder || buildLiveDirectorSongFolder(songId, String(songRow.titulo || ''));
      const manifestUrl = `${r2Context.publicBaseUrl}/${folder}/manifest.json`;
      const persistedSession = {
        ...currentSession,
        version: 1,
        songId,
        songTitle: String(songRow.titulo || ''),
        mode: 'folder',
        folder,
        manifestUrl,
        updatedAt: new Date().toISOString(),
        tracks: remainingTracks,
      };

      await r2Context.client.send(
        new PutObjectCommand({
          Bucket: r2Context.bucket,
          Key: `${folder}/manifest.json`,
          ContentType: 'application/json',
          Body: JSON.stringify(persistedSession, null, 2),
        }),
      );

      const { error: updateTrackError } = await serviceRoleClient
        .from('canciones')
        .update({ multitrack_session: persistedSession })
        .eq('id', songId);

      if (updateTrackError) {
        throw updateTrackError;
      }

      await deleteSessionFiles({
        ...currentSession,
        manifestUrl: '',
        tracks: [trackToDelete],
      }, r2Context, {
        songId,
        keepUrls: remainingTracks.flatMap((track) => [
          track.url,
          track.iosUrl,
          track.nativeUrl,
          track.optimizedUrl,
          track.cafUrl,
          track.pcmUrl,
        ]),
      });

      return jsonResponse({ success: true, session: persistedSession });
    }

    await deleteSessionFiles(songRow.multitrack_session, r2Context, { songId });

    const { error: updateError } = await serviceRoleClient
      .from('canciones')
      .update({ multitrack_session: null })
      .eq('id', songId);

    if (updateError) {
      if (String(updateError.message || '').toLowerCase().includes('multitrack_session')) {
        throw new Error(
          'La columna multitrack_session aun no existe. Ejecuta la migracion migrations/024_multitrack_session_canciones.sql.',
        );
      }
      throw updateError;
    }

    return jsonResponse({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno del servidor.';
    const status = Number.isInteger(error?.status)
      ? error.status
      : message.startsWith('No autorizado')
        ? 401
        : 500;
    console.error('Live Director session delete error:', error);
    return jsonResponse({ error: message }, status);
  }
};
