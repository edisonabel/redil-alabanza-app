export const prerender = false;

export async function POST({ request }) {
  try {
    const { code } = await request.json();
    const validCode = import.meta.env.REGISTRATION_CODE;

    if (!validCode) {
      console.error('[verify-access-code] REGISTRATION_CODE env var not set');
      return new Response(JSON.stringify({ valid: false, error: 'Configuración del servidor incompleta.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const isValid = String(code || '').trim().toUpperCase() === String(validCode).trim().toUpperCase();

    return new Response(JSON.stringify({ valid: isValid }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ valid: false, error: 'Error al verificar el código.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
