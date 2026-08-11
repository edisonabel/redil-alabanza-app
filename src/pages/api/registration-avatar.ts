import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import {
  ApiSecurityError,
  assertRequestBodySize,
  consumeRateLimit,
  securityErrorResponse,
  serviceRoleClient,
} from '../../lib/server/api-security.js';
import { readEnv } from '../../lib/server/supabase-env.js';

const AVATAR_BUCKET = 'avatars';
const MAX_CROP_BYTES = 2 * 1024 * 1024;
const MAX_PROFILE_BYTES = 6 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_CROP_BYTES + MAX_PROFILE_BYTES + 512 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const json = (body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
    },
  },
);

const resolveRegistrationTarget = (rawCode: unknown) => {
  const normalizedCode = String(rawCode || '').trim().toLocaleUpperCase('es');
  const generalCode = readEnv('REGISTRATION_CODE');
  const youthCode = readEnv('YOUTH_REGISTRATION_CODE', 'SIN_FILTROS_REGISTRATION_CODE');

  if (youthCode && normalizedCode === youthCode.trim().toLocaleUpperCase('es')) {
    return 'sin_filtros';
  }
  if (generalCode && normalizedCode === generalCode.trim().toLocaleUpperCase('es')) {
    return 'general';
  }
  return '';
};

const assertSameOrigin = (request: Request) => {
  const requestOrigin = request.headers.get('origin');
  if (requestOrigin && requestOrigin !== new URL(request.url).origin) {
    throw new ApiSecurityError('Origen no permitido.', 403);
  }
};

const optimizeAvatar = async (file: Blob) => sharp(Buffer.from(await file.arrayBuffer()), {
  failOn: 'warning',
  limitInputPixels: 32_000_000,
})
  .rotate()
  .resize(400, 400, { fit: 'cover', position: 'centre' })
  .webp({ quality: 88, effort: 4 })
  .toBuffer();

const optimizeProfilePhoto = async (file: Blob) => sharp(Buffer.from(await file.arrayBuffer()), {
  failOn: 'warning',
  limitInputPixels: 32_000_000,
})
  .rotate()
  .resize({
    width: 1800,
    height: 1800,
    fit: 'inside',
    withoutEnlargement: true,
  })
  .webp({ quality: 82, effort: 4 })
  .toBuffer();

const getPublicUrl = (path: string) => {
  const { data } = serviceRoleClient!.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  return String(data?.publicUrl || '').trim();
};

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    assertSameOrigin(request);
    assertRequestBodySize(request, MAX_REQUEST_BYTES);

    if (!serviceRoleClient) {
      return json({ error: 'El servicio de imágenes no está configurado.' }, 503);
    }

    const formData = await request.formData();
    const registrationTarget = resolveRegistrationTarget(formData.get('code'));
    if (!registrationTarget) {
      return json({ error: 'Código de registro inválido.' }, 403);
    }

    const avatarFile = formData.get('avatar');
    const profilePhotoFile = formData.get('profile_photo');
    if (!(avatarFile instanceof Blob) || !(profilePhotoFile instanceof Blob)) {
      return json({ error: 'Debes seleccionar y ajustar una foto.' }, 400);
    }
    if (!avatarFile.type.startsWith('image/') || !profilePhotoFile.type.startsWith('image/')) {
      return json({ error: 'Los archivos enviados no son imágenes válidas.' }, 415);
    }
    if (avatarFile.size > MAX_CROP_BYTES || profilePhotoFile.size > MAX_PROFILE_BYTES) {
      return json({ error: 'La foto es demasiado pesada. Intenta con otra imagen.' }, 413);
    }

    const actorAddress = String(
      request.headers.get('x-nf-client-connection-ip')
      || request.headers.get('x-forwarded-for')?.split(',')[0]
      || 'unknown',
    ).trim();
    await consumeRateLimit({
      bucket: 'registration-avatar',
      actorId: actorAddress,
      windowSeconds: 60 * 60,
      maxRequests: 20,
    });

    let avatarBuffer: Buffer;
    let profilePhotoBuffer: Buffer;
    try {
      [avatarBuffer, profilePhotoBuffer] = await Promise.all([
        optimizeAvatar(avatarFile),
        optimizeProfilePhoto(profilePhotoFile),
      ]);
    } catch {
      return json({ error: 'No se pudo procesar la foto seleccionada.' }, 422);
    }

    const uploadId = randomUUID();
    const folder = `registration/${uploadId}`;
    const avatarPath = `${folder}/avatar.webp`;
    const profilePhotoPath = `${folder}/profile.webp`;
    const uploadedPaths: string[] = [];

    const upload = async (path: string, body: Buffer) => {
      const { error } = await serviceRoleClient!.storage.from(AVATAR_BUCKET).upload(path, body, {
        contentType: 'image/webp',
        cacheControl: '31536000',
        upsert: false,
      });
      if (error) throw error;
      uploadedPaths.push(path);
    };

    try {
      await upload(avatarPath, avatarBuffer);
      await upload(profilePhotoPath, profilePhotoBuffer);
    } catch (error) {
      if (uploadedPaths.length > 0) {
        await serviceRoleClient.storage.from(AVATAR_BUCKET).remove(uploadedPaths);
      }
      throw error;
    }

    return json({
      avatar_url: getPublicUrl(avatarPath),
      profile_photo_url: getPublicUrl(profilePhotoPath),
      registration_target: registrationTarget,
      upload_id: uploadId,
    });
  } catch (error) {
    if (error instanceof ApiSecurityError) return securityErrorResponse(error);
    console.error('[registration-avatar] upload failed:', error);
    return json({ error: 'No se pudo guardar la foto de registro.' }, 500);
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  try {
    assertSameOrigin(request);
    assertRequestBodySize(request, 8 * 1024);
    if (!serviceRoleClient) {
      return json({ error: 'El servicio de imágenes no está configurado.' }, 503);
    }

    const body = await request.json().catch(() => ({}));
    if (!resolveRegistrationTarget(body?.code)) {
      return json({ error: 'Código de registro inválido.' }, 403);
    }

    const uploadId = String(body?.upload_id || '').trim();
    if (!UUID_PATTERN.test(uploadId)) {
      return json({ error: 'Carga de registro inválida.' }, 400);
    }

    const folder = `registration/${uploadId}`;
    const { error } = await serviceRoleClient.storage.from(AVATAR_BUCKET).remove([
      `${folder}/avatar.webp`,
      `${folder}/profile.webp`,
    ]);
    if (error) throw error;

    return json({ ok: true });
  } catch (error) {
    if (error instanceof ApiSecurityError) return securityErrorResponse(error);
    console.error('[registration-avatar] cleanup failed:', error);
    return json({ error: 'No se pudo limpiar la foto de registro.' }, 500);
  }
};
