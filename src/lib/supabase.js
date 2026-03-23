import { createClient } from '@supabase/supabase-js';

const rawUrl = import.meta.env.PUBLIC_SUPABASE_URL || import.meta.env.SUPABASE_URL || '';
const supabaseUrl = rawUrl.replace(/\/$/, '');
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY || '';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const AUTH_STORAGE_KEY_REGEX = /supabase\.auth\.token/i;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials missing. Please check your .env file.');
}

const isBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined';

const getSecureCookieSuffix = () =>
  isBrowser() && window.location.protocol === 'https:' ? '; Secure' : '';

const setAuthCookie = (name, value) => {
  if (!isBrowser() || !name || !value) return;
  document.cookie = `${name}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax${getSecureCookieSuffix()}`;
};

const clearAuthCookie = (name) => {
  if (!isBrowser() || !name) return;
  document.cookie = `${name}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 UTC; SameSite=Lax${getSecureCookieSuffix()}`;
};

const syncAuthCookiesFromValue = (rawValue) => {
  if (!isBrowser()) return;

  if (!rawValue) {
    clearAuthCookie('sb-access-token');
    clearAuthCookie('sb-refresh-token');
    return;
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (parsed?.access_token) {
      setAuthCookie('sb-access-token', parsed.access_token);
    }
    if (parsed?.refresh_token) {
      setAuthCookie('sb-refresh-token', parsed.refresh_token);
    }
  } catch (error) {
    console.warn('Supabase auth cookie sync failed', error);
  }
};

const createBrowserStorage = () => ({
  getItem(key) {
    return window.localStorage.getItem(key);
  },
  setItem(key, value) {
    window.localStorage.setItem(key, value);
    if (AUTH_STORAGE_KEY_REGEX.test(key)) {
      syncAuthCookiesFromValue(value);
    }
  },
  removeItem(key) {
    window.localStorage.removeItem(key);
    if (AUTH_STORAGE_KEY_REGEX.test(key)) {
      syncAuthCookiesFromValue(null);
    }
  },
});

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    storage: isBrowser() ? createBrowserStorage() : undefined,
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
  const { data: publicUrlData } = supabase.storage.from(bucketName).getPublicUrl(uploadedPath);
  const publicUrl = String(publicUrlData?.publicUrl || '').trim();

  if (!publicUrl) {
    await removeStorageObject(bucketName, uploadedPath);
    throw new Error('No se pudo obtener la URL pública del avatar subido.');
  }

  const { data: updatedRows, error: dbError } = await supabase
    .from('perfiles')
    .update({ avatar_url: publicUrl })
    .eq('id', userId)
    .select('id, avatar_url');

  if (dbError) {
    await removeStorageObject(bucketName, uploadedPath);
    throw new Error(`Error al actualizar el perfil: ${dbError.message}`);
  }

  if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
    await removeStorageObject(bucketName, uploadedPath);
    throw new Error('La base de datos bloqueó la actualización del avatar.');
  }

  const { error: authError } = await supabase.auth.updateUser({
    data: { avatar_url: publicUrl },
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
      await removeStorageObject(bucketName, uploadedPath);
      throw new Error(`No se pudo sincronizar el avatar en la sesión: ${authError.message}`);
    }

    throw new Error(
      `No se pudo sincronizar el avatar en la sesión y no fue posible revertir automáticamente el perfil: ${authError.message}`,
    );
  }

  return {
    publicUrl,
    path: uploadedPath,
    bucketName,
  };
}
