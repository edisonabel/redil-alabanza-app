import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  assertRequestBodySize,
  consumeRateLimit,
  requireAdminUser,
  securityErrorResponse,
  serviceRoleClient,
} from '../../lib/server/api-security.js';
import { readEnv } from '../../lib/server/supabase-env.js';

const PUBLIC_R2_HOST = 'stems.alabanzaredilestadio.com';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

const normalizePublicBaseUrl = (value = '') => {
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

const getR2ObjectKeyFromUrl = (fileUrl, publicBaseUrl) => {
  try {
    const parsed = new URL(String(fileUrl || '').trim());
    const allowedHost = new URL(publicBaseUrl).hostname.toLowerCase();
    const fileHost = parsed.hostname.toLowerCase();
    if (fileHost !== allowedHost && fileHost !== PUBLIC_R2_HOST && !fileHost.endsWith('.r2.dev')) {
      return '';
    }
    const key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    if (!key || key.includes('..') || key.length > 1024) return '';
    return key;
  } catch {
    return '';
  }
};

export const POST = async ({ request, cookies }) => {
  try {
    assertRequestBodySize(request, 16 * 1024);
    const user = await requireAdminUser(cookies);
    await consumeRateLimit({
      bucket: 'r2-delete',
      actorId: user.id,
      windowSeconds: 60 * 60,
      maxRequests: 120,
    });

    const body = await request.json().catch(() => ({}));
    const songId = String(body?.songId || '').trim();
    const fileUrl = String(body?.fileUrl || '').trim();
    if (!songId || !fileUrl) {
      return jsonResponse({ error: 'Se requieren songId y fileUrl.' }, 400);
    }

    const { data: song, error: songError } = await serviceRoleClient
      .from('canciones')
      .select('*')
      .eq('id', songId)
      .maybeSingle();
    if (songError) throw songError;
    if (!song) return jsonResponse({ error: 'La cancion no existe.' }, 404);

    // Solo se puede borrar un objeto que aun este referenciado por la cancion.
    if (!JSON.stringify(song).includes(fileUrl)) {
      return jsonResponse({ error: 'El archivo no pertenece a la cancion indicada.' }, 403);
    }

    const publicBaseUrl = normalizePublicBaseUrl(readEnv('PUBLIC_R2_URL', 'R2_PUBLIC_URL'));
    const objectKey = getR2ObjectKeyFromUrl(fileUrl, publicBaseUrl);
    if (!objectKey) {
      return jsonResponse({ deleted: false, skipped: true, reason: 'external-or-invalid-url' });
    }

    const endpoint = readEnv('R2_ENDPOINT');
    const accessKeyId = readEnv('R2_ACCESS_KEY_ID');
    const secretAccessKey = readEnv('R2_SECRET_ACCESS_KEY');
    const bucket = readEnv('R2_BUCKET_NAME');
    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
      return jsonResponse({ error: 'Almacenamiento no configurado.' }, 503);
    }

    const client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));

    return jsonResponse({ deleted: true });
  } catch (error) {
    if (error?.name === 'ApiSecurityError') return securityErrorResponse(error);
    console.error('[delete-upload] request failed:', error);
    return securityErrorResponse(error);
  }
};
