import { createClient } from '@supabase/supabase-js';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  buildLiveDirectorSongFolder,
  normalizePersistedLiveDirectorSession,
} from '../../utils/liveDirectorSongSession.ts';
import { resolveTrackOutputRoute } from '../../utils/liveDirectorTrackRouting.ts';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || import.meta.env.SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const normalizePublicBaseUrl = (value = '') => String(value || '').trim().replace(/\/+$/, '');

const getR2ObjectKeyFromUrl = (fileUrl = '', publicBaseUrl = '') => {
  const normalizedFileUrl = String(fileUrl || '').trim();
  const normalizedPublicBaseUrl = normalizePublicBaseUrl(publicBaseUrl);

  if (!normalizedFileUrl || !normalizedPublicBaseUrl) return null;

  const expectedPrefix = `${normalizedPublicBaseUrl}/`;
  if (!normalizedFileUrl.startsWith(expectedPrefix)) return null;

  return decodeURIComponent(normalizedFileUrl.slice(expectedPrefix.length).split('?')[0] || '');
};

const createR2Context = () => {
  const endpoint = String(import.meta.env.R2_ENDPOINT || '').trim();
  const accessKeyId = String(import.meta.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(import.meta.env.R2_SECRET_ACCESS_KEY || '').trim();
  const bucket = String(import.meta.env.R2_BUCKET_NAME || '').trim();
  const publicBaseUrl = normalizePublicBaseUrl(import.meta.env.PUBLIC_R2_URL || '');

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
  } = await supabase.auth.getUser(token);

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

      if (!id || !name || !url) {
        return null;
      }

      return {
        id,
        name,
        url,
        volume: Number.isFinite(Number(track.volume)) ? Number(track.volume) : 1,
        isMuted: Boolean(track.isMuted),
        enabled: track.enabled !== false,
        sourceFileName: String(track.sourceFileName || '').trim() || undefined,
        outputRoute: resolveTrackOutputRoute({ id, name, outputRoute: track.outputRoute }),
      };
    })
    .filter(Boolean);

  if (normalizedTracks.length === 0) {
    throw new Error('La sesion no contiene pistas validas.');
  }

  return normalizedTracks;
};

const deleteSessionFiles = async (sessionRecord, r2Context, { keepUrls = [] } = {}) => {
  const normalizedSession = normalizePersistedLiveDirectorSession(sessionRecord);
  if (!normalizedSession) {
    return;
  }

  const keepSet = new Set((Array.isArray(keepUrls) ? keepUrls : []).map((url) => String(url || '').trim()));
  const candidateUrls = [
    normalizedSession.manifestUrl,
    ...normalizedSession.tracks.map((track) => track.url),
  ];

  const objectKeys = candidateUrls
    .filter((url) => url && !keepSet.has(url))
    .map((url) => getR2ObjectKeyFromUrl(url, r2Context.publicBaseUrl))
    .filter(Boolean);

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

const fetchSongRow = async (songId) => {
  const withSession = await supabase
    .from('canciones')
    .select('id, titulo, multitrack_session')
    .eq('id', songId)
    .maybeSingle();

  if (!withSession.error) {
    return withSession.data;
  }

  const fallback = await supabase
    .from('canciones')
    .select('id, titulo')
    .eq('id', songId)
    .maybeSingle();

  if (fallback.error) {
    throw fallback.error;
  }

  return fallback.data ? { ...fallback.data, multitrack_session: null } : null;
};

export const POST = async ({ request, cookies }) => {
  try {
    await requireAuthenticatedUser(cookies);

    const body = await request.json().catch(() => ({}));
    const songId = String(body?.songId || '').trim();
    const rawSession = body?.session || {};

    if (!songId) {
      return jsonResponse({ error: 'Se requiere songId.' }, 400);
    }

    const songRow = await fetchSongRow(songId);

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
    const unmatchedFiles = Array.isArray(rawSession?.unmatchedFiles)
      ? rawSession.unmatchedFiles.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const manifestUrl = `${r2Context.publicBaseUrl}/${folder}/manifest.json`;

    const persistedSession = {
      version: 1,
      songId,
      songTitle: String(songRow.titulo || ''),
      mode,
      sectionOffsetSeconds,
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

    const { error: updateError } = await supabase
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
      keepUrls: [manifestUrl, ...tracks.map((track) => track.url)],
    });

    return jsonResponse(persistedSession);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno del servidor.';
    const status = message.startsWith('No autorizado') ? 401 : 500;
    console.error('Live Director session save error:', error);
    return jsonResponse({ error: message }, status);
  }
};

export const DELETE = async ({ request, cookies }) => {
  try {
    await requireAuthenticatedUser(cookies);

    const body = await request.json().catch(() => ({}));
    const songId = String(body?.songId || '').trim();

    if (!songId) {
      return jsonResponse({ error: 'Se requiere songId.' }, 400);
    }

    const songRow = await fetchSongRow(songId);

    if (!songRow) {
      return jsonResponse({ error: 'La cancion solicitada no existe.' }, 404);
    }

    const r2Context = createR2Context();
    await deleteSessionFiles(songRow.multitrack_session, r2Context);

    const { error: updateError } = await supabase
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
    const status = message.startsWith('No autorizado') ? 401 : 500;
    console.error('Live Director session delete error:', error);
    return jsonResponse({ error: message }, status);
  }
};
