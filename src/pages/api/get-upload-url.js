import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  assertRequestBodySize,
  consumeRateLimit,
  requireAdminUser,
  securityErrorResponse,
  serviceRoleClient,
} from '../../lib/server/api-security.js';
import { readEnv } from '../../lib/server/supabase-env.js';

const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;
const PUBLIC_R2_HOST = 'stems.alabanzaredilestadio.com';
const ALLOWED_PURPOSES = new Set(['mp3', 'acordes', 'voces', 'secuencia', 'otro']);

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

const normalizePublicR2BaseUrl = (value = '') => {
  const fallback = `https://${PUBLIC_R2_HOST}`;
  try {
    const parsed = new URL(String(value || fallback).trim() || fallback);
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

const sanitizeFileName = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9._-]/g, '_')
  .replace(/^\.+/, '')
  .slice(0, 120)
  .toLowerCase();

const isAllowedContentType = (value = '') => {
  const contentType = String(value || '').toLowerCase();
  return contentType.startsWith('audio/')
    || contentType === 'application/pdf'
    || contentType === 'text/plain'
    || contentType === 'application/octet-stream';
};

export const POST = async ({ request, cookies }) => {
  try {
    assertRequestBodySize(request, 16 * 1024);
    const user = await requireAdminUser(cookies);
    await consumeRateLimit({
      bucket: 'r2-upload-url',
      actorId: user.id,
      windowSeconds: 60 * 60,
      maxRequests: 60,
    });

    const body = await request.json().catch(() => ({}));
    const songId = String(body?.songId || '').trim();
    const fileName = sanitizeFileName(body?.fileName);
    const fileType = String(body?.fileType || 'application/octet-stream').trim().toLowerCase();
    const fileSize = Number(body?.fileSize);
    const purpose = ALLOWED_PURPOSES.has(String(body?.purpose || ''))
      ? String(body.purpose)
      : 'otro';

    if (!songId || !fileName) {
      return jsonResponse({ error: 'Se requieren songId y fileName.' }, 400);
    }
    if (!Number.isFinite(fileSize) || fileSize < 1 || fileSize > MAX_UPLOAD_BYTES) {
      return jsonResponse({ error: 'Tamano de archivo invalido o superior a 150 MB.' }, 413);
    }
    if (!isAllowedContentType(fileType)) {
      return jsonResponse({ error: 'Tipo de archivo no permitido.' }, 415);
    }

    const { data: song, error: songError } = await serviceRoleClient
      .from('canciones')
      .select('id')
      .eq('id', songId)
      .maybeSingle();
    if (songError) throw songError;
    if (!song) return jsonResponse({ error: 'La cancion no existe.' }, 404);

    const endpoint = readEnv('R2_ENDPOINT');
    const accessKeyId = readEnv('R2_ACCESS_KEY_ID');
    const secretAccessKey = readEnv('R2_SECRET_ACCESS_KEY');
    const bucket = readEnv('R2_BUCKET_NAME');
    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
      return jsonResponse({ error: 'Almacenamiento no configurado.' }, 503);
    }

    const objectKey = `songs/${songId}/${purpose}/${Date.now()}-${fileName}`;
    const client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: fileType,
      ContentLength: fileSize,
    });
    const presignedUrl = await getSignedUrl(client, command, { expiresIn: 600 });
    const publicBaseUrl = normalizePublicR2BaseUrl(readEnv('PUBLIC_R2_URL', 'R2_PUBLIC_URL'));

    return jsonResponse({
      presignedUrl,
      publicUrl: `${publicBaseUrl}/${objectKey}`,
      expiresIn: 600,
    });
  } catch (error) {
    if (error?.name === 'ApiSecurityError') return securityErrorResponse(error);
    console.error('[get-upload-url] request failed:', error);
    return securityErrorResponse(error);
  }
};
