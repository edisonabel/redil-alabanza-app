import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const readEnv = (...keys) => {
  for (const key of keys) {
    const value = import.meta.env?.[key] || process.env?.[key] || '';
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
};

const supabaseUrl = readEnv('SUPABASE_URL', 'PUBLIC_SUPABASE_URL').replace(/\/$/, '');
const supabaseAnonKey = readEnv('SUPABASE_ANON_KEY', 'PUBLIC_SUPABASE_ANON_KEY');
const supabaseServiceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');

const jsonHeaders = {
  'content-type': 'application/json',
};

let cachedAuthClient = null;
let cachedServiceRoleClient = null;

const getErrorMessage = (error) => {
  if (error instanceof Error) return error.message;
  return String(error || 'Error desconocido.');
};

const getAuthClient = () => {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Faltan credenciales públicas de Supabase para autenticar la suscripción push.');
  }

  if (!cachedAuthClient) {
    cachedAuthClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return cachedAuthClient;
};

const getServiceRoleClient = () => {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Faltan credenciales privadas de Supabase para guardar la suscripción push.');
  }

  if (!cachedServiceRoleClient) {
    cachedServiceRoleClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return cachedServiceRoleClient;
};

async function getUserFromCookies(cookies) {
  const token = cookies.get('sb-access-token')?.value || '';
  if (!token) {
    return { user: null, error: 'No autenticado.' };
  }

  const {
    data: { user },
    error,
  } = await getAuthClient().auth.getUser(token);

  if (error || !user) {
    return { user: null, error: 'Sesión inválida.' };
  }

  return { user, error: null };
}

export async function POST({ request, cookies }) {
  try {
    const { user, error: authError } = await getUserFromCookies(cookies);
    if (authError) {
      return new Response(JSON.stringify({ error: authError }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Body inválido, se esperaba JSON.' }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const suscripcion = body?.subscription ?? body;
    const endpoint = typeof suscripcion?.endpoint === 'string' ? suscripcion.endpoint.trim() : '';

    if (!endpoint || !suscripcion?.keys) {
      return new Response(
        JSON.stringify({ error: 'Suscripción inválida: falta endpoint o keys.' }),
        {
          status: 400,
          headers: jsonHeaders,
        },
      );
    }

    const { error: upsertError } = await getServiceRoleClient()
      .from('suscripciones_push')
      .upsert(
        {
          user_id: user.id,
          endpoint,
          suscripcion,
        },
        { onConflict: 'endpoint' },
      );

    if (upsertError) {
      console.error('[push-subscription] upsert error:', upsertError);
      return new Response(
        JSON.stringify({
          error: 'No se pudo guardar la suscripción.',
          detail: upsertError.message,
        }),
        {
          status: 500,
          headers: jsonHeaders,
        },
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (error) {
    console.error('[push-subscription] unexpected POST error:', error);
    return new Response(
      JSON.stringify({
        error: getErrorMessage(error),
      }),
      {
        status: 500,
        headers: jsonHeaders,
      },
    );
  }
}

export async function DELETE({ request, cookies }) {
  try {
    const { user, error: authError } = await getUserFromCookies(cookies);
    if (authError) {
      return new Response(JSON.stringify({ error: authError }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Body inválido, se esperaba JSON.' }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : '';
    if (!endpoint) {
      return new Response(JSON.stringify({ error: 'Falta endpoint.' }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const { error: deleteError } = await getServiceRoleClient()
      .from('suscripciones_push')
      .delete()
      .eq('user_id', user.id)
      .eq('endpoint', endpoint);

    if (deleteError) {
      console.error('[push-subscription] delete error:', deleteError);
      return new Response(
        JSON.stringify({
          error: 'No se pudo eliminar la suscripción.',
          detail: deleteError.message,
        }),
        {
          status: 500,
          headers: jsonHeaders,
        },
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (error) {
    console.error('[push-subscription] unexpected DELETE error:', error);
    return new Response(
      JSON.stringify({
        error: getErrorMessage(error),
      }),
      {
        status: 500,
        headers: jsonHeaders,
      },
    );
  }
}
