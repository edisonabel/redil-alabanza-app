// This checkout is deployed separately. Access is tied to the verified auth ID,
// never to a display name or a query parameter. It has no expiration date.
export const LIGHT2_BETA_USER_ID = '80f063de-6eac-4f53-9e98-acadf481dc1c';
export const canAccessLight2Beta = (userId) => userId === LIGHT2_BETA_USER_ID;
export const LIGHT2_PUBLIC_AUTH_PATHS = new Set([
  '/login', '/reset-password', '/api/auth/session', '/api/auth/logout',
]);

export const light2AccessDenied = (api = false, status = 403) => new Response(
  api ? JSON.stringify({ error: 'Esta beta está habilitada únicamente para Edison Aular.' })
    : '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width"><title>Modo Light 2 · Acceso privado</title><body style="margin:0;background:#17191b;color:#f4f4f5;font:16px system-ui;display:grid;min-height:100vh;place-items:center"><main style="max-width:34rem;padding:2rem"><h1>Modo Light 2</h1><p>Esta beta está habilitada únicamente para Edison Aular.</p><a style="color:#a5f3fc" href="https://alabanzaredilestadio.com">Volver a Alabanza</a></main></body></html>',
  { status, headers: { 'content-type': api ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8', 'cache-control': 'private, no-store' } },
);
