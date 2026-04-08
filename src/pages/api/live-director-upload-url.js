import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  buildLiveDirectorSongFolder,
  sanitizeLiveDirectorFileName,
} from '../../utils/liveDirectorSongSession.ts';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || import.meta.env.SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const createR2Client = () => {
  const endpoint = String(import.meta.env.R2_ENDPOINT || '').trim();
  const accessKeyId = String(import.meta.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(import.meta.env.R2_SECRET_ACCESS_KEY || '').trim();
  const bucket = String(import.meta.env.R2_BUCKET_NAME || '').trim();
  const publicBaseUrl = String(import.meta.env.PUBLIC_R2_URL || '').trim().replace(/\/+$/, '');

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

export const POST = async ({ request, cookies }) => {
  try {
    await requireAuthenticatedUser(cookies);

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

    const { data: songRow, error: songError } = await supabase
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
    const status = message.startsWith('No autorizado') ? 401 : 500;
    console.error('Live Director upload-url error:', error);
    return jsonResponse({ error: message }, status);
  }
};
