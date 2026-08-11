import { createClient } from '@supabase/supabase-js';

const readEnv = (...keys) => {
  const metaEnv = import.meta.env || {};
  const processEnv = typeof process !== 'undefined' && process.env ? process.env : {};

  for (const key of keys) {
    const value = metaEnv[key] || processEnv[key] || '';
    if (value) return value;
  }

  return '';
};

const rawUrl = readEnv('PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
const supabaseUrl = rawUrl.replace(/\/$/, '');
const supabaseAnonKey = readEnv('PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY');
if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials missing. Please check your .env file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    detectSessionInUrl: true,
    autoRefreshToken: true,
  },
});

const AVATAR_BUCKET = 'avatars';

const removeStorageObject = async (bucketName, filePath) => {
  if (!bucketName || !filePath) return false;

  try {
    const { error } = await supabase.storage.from(bucketName).remove([filePath]);
    if (error) {
      console.warn('No se pudo limpiar el archivo de Storage durante rollback.', error);
      return false;
    }
    return true;
  } catch (error) {
    console.warn('Fallo inesperado limpiando archivo de Storage.', error);
    return false;
  }
};

/**
 * Sube un avatar, actualiza el perfil y sincroniza auth metadata.
 * Si falla la actualización de perfil, elimina el archivo recién subido.
 * Si falla auth metadata, intenta revertir el perfil y limpia Storage solo si la reversión fue exitosa.
 */
export async function uploadAvatarAtomic(userId, fileBlob, fileName, options = {}) {
  if (!userId) {
    throw new Error('No se pudo identificar al usuario para subir el avatar.');
  }

  if (!(fileBlob instanceof Blob)) {
    throw new Error('El archivo del avatar no es válido.');
  }

  const bucketName = typeof options.bucketName === 'string' && options.bucketName.trim()
    ? options.bucketName.trim()
    : AVATAR_BUCKET;
  const folder = typeof options.folder === 'string' && options.folder.trim()
    ? options.folder.trim().replace(/\/+$/, '')
    : `perfil/${userId}`;
  const sanitizedFileName = String(fileName || `avatar-${Date.now()}`)
    .replace(/[^a-zA-Z0-9._/-]/g, '_')
    .replace(/^\/+/, '');
  const filePath = `${folder}/${sanitizedFileName}`.replace(/\/{2,}/g, '/');
  const contentType = String(options.contentType || fileBlob.type || 'application/octet-stream');
  const previousAvatarUrl = typeof options.previousAvatarUrl === 'string'
    ? options.previousAvatarUrl
    : null;
  const profilePhotoBlob = options.profilePhotoBlob instanceof Blob
    ? options.profilePhotoBlob
    : null;
  const profilePhotoFileName = String(
    options.profilePhotoFileName || `profile-${Date.now()}.webp`,
  )
    .replace(/[^a-zA-Z0-9._/-]/g, '_')
    .replace(/^\/+/, '');
  const profilePhotoPath = `${folder}/${profilePhotoFileName}`.replace(/\/{2,}/g, '/');
  const profilePhotoContentType = String(
    options.profilePhotoContentType || profilePhotoBlob?.type || 'image/webp',
  );
  const uploadedPaths = [];

  const cleanupUploadedFiles = async () => {
    await Promise.all(uploadedPaths.map((path) => removeStorageObject(bucketName, path)));
  };

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(bucketName)
    .upload(filePath, fileBlob, {
      cacheControl: '3600',
      upsert: true,
      contentType,
    });

  if (uploadError) {
    throw new Error(`Error al subir imagen: ${uploadError.message}`);
  }

  const uploadedPath = uploadData?.path || filePath;
  uploadedPaths.push(uploadedPath);
  const { data: publicUrlData } = supabase.storage.from(bucketName).getPublicUrl(uploadedPath);
  const publicUrl = String(publicUrlData?.publicUrl || '').trim();

  if (!publicUrl) {
    await cleanupUploadedFiles();
    throw new Error('No se pudo obtener la URL pública del avatar subido.');
  }

  let profilePhotoUrl = '';
  let uploadedProfilePhotoPath = '';

  if (profilePhotoBlob) {
    const { data: profileUploadData, error: profileUploadError } = await supabase.storage
      .from(bucketName)
      .upload(profilePhotoPath, profilePhotoBlob, {
        cacheControl: '3600',
        upsert: true,
        contentType: profilePhotoContentType,
      });

    if (profileUploadError) {
      await cleanupUploadedFiles();
      throw new Error(`Error al subir la foto completa: ${profileUploadError.message}`);
    }

    uploadedProfilePhotoPath = profileUploadData?.path || profilePhotoPath;
    uploadedPaths.push(uploadedProfilePhotoPath);
    const { data: profilePhotoPublicData } = supabase.storage
      .from(bucketName)
      .getPublicUrl(uploadedProfilePhotoPath);
    profilePhotoUrl = String(profilePhotoPublicData?.publicUrl || '').trim();

    if (!profilePhotoUrl) {
      await cleanupUploadedFiles();
      throw new Error('No se pudo obtener la URL pública de la foto completa.');
    }
  }

  const { data: updatedRows, error: dbError } = await supabase
    .from('perfiles')
    .update({ avatar_url: publicUrl })
    .eq('id', userId)
    .select('id, avatar_url');

  if (dbError) {
    await cleanupUploadedFiles();
    throw new Error(`Error al actualizar el perfil: ${dbError.message}`);
  }

  if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
    await cleanupUploadedFiles();
    throw new Error('La base de datos bloqueó la actualización del avatar.');
  }

  const { error: authError } = await supabase.auth.updateUser({
    data: {
      avatar_url: publicUrl,
      ...(profilePhotoUrl ? { profile_photo_url: profilePhotoUrl } : {}),
    },
  });

  if (authError) {
    let revertedProfile = false;

    try {
      const { data: revertedRows, error: revertError } = await supabase
        .from('perfiles')
        .update({ avatar_url: previousAvatarUrl })
        .eq('id', userId)
        .select('id');

      revertedProfile = !revertError && Array.isArray(revertedRows) && revertedRows.length > 0;

      if (!revertedProfile) {
        console.warn('No se pudo revertir avatar_url tras fallo de auth metadata.', revertError);
      }
    } catch (error) {
      console.warn('Fallo inesperado intentando revertir avatar_url.', error);
    }

    if (revertedProfile) {
      await cleanupUploadedFiles();
      throw new Error(`No se pudo sincronizar el avatar en la sesión: ${authError.message}`);
    }

    throw new Error(
      `No se pudo sincronizar el avatar en la sesión y no fue posible revertir automáticamente el perfil: ${authError.message}`,
    );
  }

  return {
    publicUrl,
    profilePhotoUrl,
    path: uploadedPath,
    profilePhotoPath: uploadedProfilePhotoPath,
    bucketName,
  };
}
