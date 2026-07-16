import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  buildLiveDirectorSongFolder,
  sanitizeLiveDirectorFileName,
} from '../../utils/liveDirectorSongSession.ts';
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

const normalizePublicR2BaseUrl = (value = '') => {
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

const createR2Client = () => {
  const endpoint = readEnv('R2_ENDPOINT');
  const accessKeyId = readEnv('R2_ACCESS_KEY_ID');
  const secretAccessKey = readEnv('R2_SECRET_ACCESS_KEY');
  const bucket = readEnv('R2_BUCKET_NAME');
  const publicBaseUrl = normalizePublicR2BaseUrl(readEnv('PUBLIC_R2_URL', 'R2_PUBLIC_URL'));

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
    const fileName = String(body?.fileName || '').trim();
    const fileType = String(body?.fileType || '').trim() || 'application/octet-stream';
    const kind = body?.kind === 'playback' ? 'playback' : 'stems';

    if (!songId) {
      return jsonResponse({ error: 'Se requiere songId.' }, 400);
    }

    if (!fileName) {
      return jsonResponse({ error: 'Se requiere fileName.' }, 400);
    }

    if (!/\.m4a$/i.test(fileName)) {
      return jsonResponse({
        error: 'Live Director solo admite archivos M4A/AAC-LC con Fast Start.',
      }, 415);
    }

    const { data: songRow, error: songError } = await serviceRoleClient
      .from('canciones')
      .select('id, titulo')
      .eq('id', songId)
      .maybeSingle();

    if (songError) {
      return jsonResponse({ error: songError.message }, 500);
    }

    if (!songRow) {
      return jsonResponse({ error: 'La cancion solicitada no existe.' }, 404);
    }

    const { client, bucket, publicBaseUrl } = createR2Client();
    const folder = buildLiveDirectorSongFolder(songId, String(songRow.titulo || ''));
    const objectKey = `${folder}/${kind}/${sanitizeLiveDirectorFileName(fileName)}`;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: fileType,
    });

    const presignedUrl = await getSignedUrl(client, command, { expiresIn: 3600 });
    const publicUrl = `${publicBaseUrl}/${objectKey}`;

    return jsonResponse({
      presignedUrl,
      publicUrl,
      objectKey,
      folder,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno del servidor.';
    const status = Number.isInteger(error?.status)
      ? error.status
      : message.startsWith('No autorizado')
        ? 401
        : 500;
    console.error('Live Director upload-url error:', error);
    return jsonResponse({ error: message }, status);
  }
};
