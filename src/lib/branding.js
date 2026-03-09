import { createClient } from '@supabase/supabase-js';

let cachedBranding = null;
let hasCachedBranding = false;
let lastFetchTime = 0;

const CACHE_DURATION = 1000 * 60 * 5;
const BRANDING_TABLE_CANDIDATES = ['configuracion_app', 'configuracion', 'branding_config'];
const rawUrl = import.meta.env.PUBLIC_SUPABASE_URL || import.meta.env.SUPABASE_URL || '';
const supabaseUrl = rawUrl.replace(/\/$/, '');
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY || '';
const supabaseServiceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY || import.meta.env.SERVICE_ROLE_KEY || '';

const supabaseBrandingAdmin = supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;

const isTableNotFoundError = (error) => {
  if (!error) return false;
  const message = String(error.message || '').toLowerCase();
  return error.code === 'PGRST205' || message.includes('could not find the table');
};

const hasValidBranding = (value) =>
  Boolean(value && typeof value === 'object' && Object.keys(value).length > 0);

const createBrandingClient = (accessToken = '') => {
  if (supabaseBrandingAdmin) {
    return supabaseBrandingAdmin;
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  const global = accessToken
    ? {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    : undefined;

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global,
  });
};

export function invalidarCacheBranding() {
  cachedBranding = null;
  hasCachedBranding = false;
  lastFetchTime = 0;
  console.log('[branding.js] Cache de branding invalidada manualmente');
}

export async function getBrandingConfig({ forceFresh = false, accessToken = '' } = {}) {
  const now = Date.now();

  if (!forceFresh && hasCachedBranding && now - lastFetchTime < CACHE_DURATION) {
    return cachedBranding;
  }

  const brandingClient = createBrandingClient(accessToken);
  if (!brandingClient) {
    console.warn('[branding.js] Cliente de branding no disponible. Conservando cache actual si existe.');
    return hasValidBranding(cachedBranding) ? cachedBranding : null;
  }

  let resultado = null;

  for (const table of BRANDING_TABLE_CANDIDATES) {
    try {
      const { data, error } = await brandingClient
        .from(table)
        .select('colores')
        .eq('id', 1)
        .single();

      if (error) {
        if (isTableNotFoundError(error)) continue;
        console.warn(`[branding.js] Error consultando tabla ${table}:`, error.message || error);
        continue;
      }

      const colores = data?.colores ?? null;
      if (hasValidBranding(colores)) {
        resultado = colores;
        console.log(`[branding.js] Branding cargado desde tabla: ${table}`);
        break;
      }

      console.log(`[branding.js] Tabla ${table} sin datos validos, probando siguiente...`);
    } catch (error) {
      console.warn(`[branding.js] Error consultando tabla ${table}:`, error?.message || error);
      continue;
    }
  }

  if (hasValidBranding(resultado)) {
    cachedBranding = resultado;
    hasCachedBranding = true;
    lastFetchTime = now;
    return cachedBranding;
  }

  console.warn('[branding.js] Consulta devolvio resultado vacio o null, no se cachea.');
  return hasValidBranding(cachedBranding) ? cachedBranding : null;
}
