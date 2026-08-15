import { createClient } from '@supabase/supabase-js';
import { getSupabaseServerEnv, getSupabaseServiceRoleKey } from './server/supabase-env.js';

const BRANDING_TABLE_CANDIDATES = ['configuracion_app', 'configuracion', 'branding_config'];
const BRANDING_CACHE_TTL_MS = 5 * 60 * 1000;
const BRANDING_NEGATIVE_CACHE_TTL_MS = 60 * 1000;
const { supabaseUrl, supabaseAnonKey } = getSupabaseServerEnv();
const supabaseServiceRoleKey = getSupabaseServiceRoleKey();

const supabaseBrandingAdmin = supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;

let cachedBranding = null;
let brandingCacheExpiresAt = 0;
let brandingCacheInitialized = false;
let brandingRequestInFlight = null;
let preferredBrandingTable = '';

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
  brandingCacheExpiresAt = 0;
  brandingCacheInitialized = false;
}

export async function getBrandingConfig({ accessToken = '' } = {}) {
  const now = Date.now();
  if (brandingCacheInitialized && now < brandingCacheExpiresAt) {
    return cachedBranding;
  }
  if (brandingRequestInFlight) return brandingRequestInFlight;

  const brandingClient = createBrandingClient(accessToken);
  if (!brandingClient) {
    return null;
  }

  brandingRequestInFlight = (async () => {
    let resultado = null;
    const tableOrder = preferredBrandingTable
      ? [preferredBrandingTable, ...BRANDING_TABLE_CANDIDATES.filter((table) => table !== preferredBrandingTable)]
      : BRANDING_TABLE_CANDIDATES;

    for (const table of tableOrder) {
      try {
        const { data, error } = await brandingClient
          .from(table)
          .select('colores')
          .eq('id', 1)
          .single();

        if (error) {
          if (isTableNotFoundError(error)) continue;
          continue;
        }

        const colores = data?.colores ?? null;
        if (hasValidBranding(colores)) {
          resultado = colores;
          preferredBrandingTable = table;
          break;
        }
      } catch {
        // Prueba la siguiente tabla legacy.
      }
    }

    cachedBranding = hasValidBranding(resultado) ? resultado : null;
    brandingCacheInitialized = true;
    brandingCacheExpiresAt = Date.now() + (
      cachedBranding ? BRANDING_CACHE_TTL_MS : BRANDING_NEGATIVE_CACHE_TTL_MS
    );
    return cachedBranding;
  })();

  try {
    return await brandingRequestInFlight;
  } finally {
    brandingRequestInFlight = null;
  }
}
