import { createClient } from '@supabase/supabase-js';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSupabaseServerEnv, readEnv } from '../../lib/server/supabase-env.js';

const { supabaseUrl, supabaseAnonKey } = getSupabaseServerEnv();

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const jsonResponse = (body, status = 200) => (
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
);

const PUBLIC_R2_HOST = 'stems.alabanzaredilestadio.com';
const PUBLIC_R2_BASE_URL = `https://${PUBLIC_R2_HOST}`;

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

export const POST = async ({ request, cookies }) => {
  try {
    const token = cookies.get('sb-access-token')?.value;
    if (!token) {
      return jsonResponse({ error: 'No autorizado. Falta token de acceso.' }, 401);
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse({ error: 'No autorizado. Token invalido o expirado.' }, 401);
    }

    const body = await request.json().catch(() => ({}));
    const fileUrl = String(body?.fileUrl || '').trim();

    if (!fileUrl) {
      return jsonResponse({ error: 'Se requiere la URL actual del archivo.' }, 400);
    }

    const publicR2Url = normalizePublicBaseUrl(readEnv('PUBLIC_R2_URL', 'R2_PUBLIC_URL'));
    const objectKey = getR2ObjectKeyFromUrl(fileUrl, publicR2Url);

    if (!objectKey) {
      return jsonResponse({ deleted: false, skipped: true, reason: 'external-or-legacy-url' });
    }

    const r2Endpoint = readEnv('R2_ENDPOINT');
    const r2AccessKey = readEnv('R2_ACCESS_KEY_ID');
    const r2SecretKey = readEnv('R2_SECRET_ACCESS_KEY');
    const r2Bucket = readEnv('R2_BUCKET_NAME');

    if (!r2Endpoint || !r2AccessKey || !r2SecretKey || !r2Bucket) {
      return jsonResponse({ deleted: false, skipped: true, reason: 'missing-r2-config' });
    }

    const s3Client = new S3Client({
      region: 'auto',
      endpoint: r2Endpoint,
      credentials: {
        accessKeyId: r2AccessKey,
        secretAccessKey: r2SecretKey,
      },
    });

    await s3Client.send(new DeleteObjectCommand({
      Bucket: r2Bucket,
      Key: objectKey,
    }));

    return jsonResponse({ deleted: true, key: objectKey });
  } catch (error) {
    console.error('Error eliminando archivo remoto:', error);
    return jsonResponse({ error: `Error interno del servidor: ${error.message}` }, 500);
  }
};
