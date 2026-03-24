import { createClient } from '@supabase/supabase-js';
import {
  insertInAppNotifications,
  listNotificationRecipients,
  sendEmailNotifications,
  sendPushNotifications,
} from '../../lib/server/notification-delivery.js';

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

const getErrorMessage = (error) => {
  if (error instanceof Error) return error.message;
  return String(error || 'Error desconocido');
};

export async function POST({ request, cookies }) {
  try {
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
      return new Response(JSON.stringify({ error: 'Solo administradores pueden enviar alertas.' }), {
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

    const recipients = await listNotificationRecipients();

    if (recipients.length === 0) {
      return new Response(JSON.stringify({ error: 'No hay destinatarios válidos para esta alerta.' }), {
        status: 422,
        headers: jsonHeaders,
      });
    }

    const [inApp, email, push] = await Promise.all([
      insertInAppNotifications({
        recipients,
        title,
        body,
        type: 'recordatorio',
      }),
      sendEmailNotifications({
        recipients,
        title,
        body,
      }),
      sendPushNotifications({
        recipients,
        title,
        body,
        url: targetUrl,
      }),
    ]);

    return new Response(
      JSON.stringify({
        ok: true,
        recipients: recipients.length,
        inApp,
        email,
        push,
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
