import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

export const prerender = false;

const rawUrl =
  import.meta.env.SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  import.meta.env.PUBLIC_SUPABASE_URL ||
  process.env.PUBLIC_SUPABASE_URL ||
  '';
const supabaseUrl = rawUrl.replace(/\/$/, '');
const supabaseAnonKey =
  import.meta.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  import.meta.env.PUBLIC_SUPABASE_ANON_KEY ||
  process.env.PUBLIC_SUPABASE_ANON_KEY ||
  '';
const supabaseServiceRoleKey =
  import.meta.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';
const vapidPublicKey =
  import.meta.env.VAPID_PUBLIC_KEY ||
  process.env.VAPID_PUBLIC_KEY ||
  import.meta.env.PUBLIC_VAPID_KEY ||
  process.env.PUBLIC_VAPID_KEY ||
  '';
const vapidPrivateKey = import.meta.env.VAPID_PRIVATE_KEY || process.env.VAPID_PRIVATE_KEY || '';
const vapidSubject = import.meta.env.VAPID_SUBJECT || process.env.VAPID_SUBJECT || '';

const authClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const serviceRoleClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const jsonHeaders = {
  'content-type': 'application/json',
};

const isExpiredPushError = (error) => {
  const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : NaN;
  const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : NaN;
  return statusCode === 404 || statusCode === 410 || status === 404 || status === 410;
};

const getErrorMessage = (error) => {
  if (error instanceof Error) return error.message;
  return String(error || 'Error desconocido');
};

const configureWebPush = () => {
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    throw new Error('Faltan credenciales de Supabase en variables de entorno.');
  }

  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    throw new Error('Faltan variables VAPID necesarias para enviar Web Push.');
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
};

export async function POST({ request, cookies }) {
  try {
    configureWebPush();

    const token = cookies.get('sb-access-token')?.value || '';
    if (!token) {
      return new Response(JSON.stringify({ error: 'No autenticado.' }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Sesión inválida.' }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const { data: perfil, error: perfilError } = await serviceRoleClient
      .from('perfiles')
      .select('id, is_admin')
      .eq('id', user.id)
      .single();

    if (perfilError || !perfil?.is_admin) {
      return new Response(JSON.stringify({ error: 'Solo administradores pueden enviar notificaciones push.' }), {
        status: 403,
        headers: jsonHeaders,
      });
    }

    const payload = await request.json().catch(() => null);
    const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
    const body = typeof payload?.body === 'string' ? payload.body.trim() : '';
    const targetUrl = typeof payload?.url === 'string' && payload.url.trim() ? payload.url.trim() : '/';

    if (!title || !body) {
      return new Response(JSON.stringify({ error: 'Debes enviar title y body en el JSON.' }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const { data: subscriptions, error: subscriptionsError } = await serviceRoleClient
      .from('suscripciones_push')
      .select('id, user_id, suscripcion');

    if (subscriptionsError) {
      throw subscriptionsError;
    }

    const validSubscriptions = (subscriptions || []).filter(
      (row) => row?.suscripcion && typeof row.suscripcion === 'object'
    );

    const notificationPayload = JSON.stringify({
      title,
      body,
      url: targetUrl,
    });

    let sent = 0;
    let deleted = 0;
    let failed = 0;

    await Promise.all(
      validSubscriptions.map(async (row) => {
        try {
          await webpush.sendNotification(row.suscripcion, notificationPayload);
          sent += 1;
        } catch (error) {
          if (isExpiredPushError(error)) {
            if (row.id) {
              const { error: deleteError } = await serviceRoleClient
                .from('suscripciones_push')
                .delete()
                .eq('id', row.id);

              if (deleteError) {
                console.error('Push cleanup: no se pudo eliminar la suscripción expirada', {
                  id: row.id,
                  error: deleteError,
                });
              } else {
                deleted += 1;
              }
            } else {
              console.warn('Push cleanup: suscripción expirada sin id, no se pudo limpiar automáticamente.', row);
            }
            return;
          }

          failed += 1;
          console.error('Push send: fallo enviando notificación', {
            id: row.id,
            userId: row.user_id,
            error: getErrorMessage(error),
          });
        }
      })
    );

    return new Response(
      JSON.stringify({
        ok: true,
        sent,
        deleted,
        failed,
        total: validSubscriptions.length,
      }),
      {
        status: 200,
        headers: jsonHeaders,
      }
    );
  } catch (error) {
    console.error('send-push endpoint error:', error);
    return new Response(
      JSON.stringify({
        error: getErrorMessage(error),
      }),
      {
        status: 500,
        headers: jsonHeaders,
      }
    );
  }
}
