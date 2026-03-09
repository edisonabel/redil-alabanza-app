import { supabase } from './supabase';

let cachedBranding = null;
let hasCachedBranding = false;
let lastFetchTime = 0;

const CACHE_DURATION = 1000 * 60 * 5;
const BRANDING_TABLE_CANDIDATES = ['configuracion_app', 'configuracion', 'branding_config'];

const isTableNotFoundError = (error) => {
  if (!error) return false;
  const message = String(error.message || '').toLowerCase();
  return error.code === 'PGRST205' || message.includes('could not find the table');
};

const hasValidBranding = (value) =>
  Boolean(value && typeof value === 'object' && Object.keys(value).length > 0);

export function invalidarCacheBranding() {
  cachedBranding = null;
  hasCachedBranding = false;
  lastFetchTime = 0;
  console.log('[branding.js] Caché de branding invalidada manualmente');
}

export async function getBrandingConfig({ forceFresh = false } = {}) {
  const now = Date.now();

  if (!forceFresh && hasCachedBranding && now - lastFetchTime < CACHE_DURATION) {
    return cachedBranding;
  }

  let resultado = null;

  for (const table of BRANDING_TABLE_CANDIDATES) {
    try {
      const { data, error } = await supabase
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

      console.log(`[branding.js] Tabla ${table} sin datos válidos, probando siguiente...`);
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

  console.warn('[branding.js] Consulta devolvió resultado vacío o null, no se cachea.');
  return hasValidBranding(cachedBranding) ? cachedBranding : null;
}
