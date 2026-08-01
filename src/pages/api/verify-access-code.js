import { readEnv } from '../../lib/server/supabase-env.js';

export const prerender = false;

export async function POST({ request }) {
  try {
    const { code } = await request.json();
    const generalCode = readEnv('REGISTRATION_CODE');
    const sinFiltrosCode = readEnv('YOUTH_REGISTRATION_CODE', 'SIN_FILTROS_REGISTRATION_CODE');

    if (!generalCode && !sinFiltrosCode) {
      console.error('[verify-access-code] No registration codes are configured');
      return new Response(JSON.stringify({ valid: false, error: 'Configuración del servidor incompleta.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    const normalizedCode = String(code || '').trim().toLocaleUpperCase('es');
    const registrationTarget = sinFiltrosCode
      && normalizedCode === String(sinFiltrosCode).trim().toLocaleUpperCase('es')
      ? 'sin_filtros'
      : generalCode && normalizedCode === String(generalCode).trim().toLocaleUpperCase('es')
        ? 'general'
        : '';

    return new Response(JSON.stringify({
      valid: Boolean(registrationTarget),
      registration_target: registrationTarget || null,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch {
    return new Response(JSON.stringify({ valid: false, error: 'Error al verificar el código.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}
