import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const rawUrl = import.meta.env.PUBLIC_SUPABASE_URL || import.meta.env.SUPABASE_URL || '';
const supabaseUrl = rawUrl.replace(/\/$/, '');
const supabaseServiceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY || '';
const vapidPublicKey = import.meta.env.VAPID_PUBLIC_KEY || import.meta.env.PUBLIC_VAPID_KEY || '';
const vapidPrivateKey = import.meta.env.VAPID_PRIVATE_KEY || '';
const vapidSubject = import.meta.env.VAPID_SUBJECT || '';

const serviceRoleClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const isExpiredPushError = (error) => {
  const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : NaN;
  const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : NaN;
  return statusCode === 404 || statusCode === 410 || status === 404 || status === 410;
};

const configureWebPush = () => {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Faltan credenciales de Supabase para el cron de cumpleaños.');
  }

  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    throw new Error('Faltan variables VAPID para el cron de cumpleaños.');
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
};

export async function enviarPushCumpleaniosHoy({ today = new Date() } = {}) {
  configureWebPush();

  const month = today.getUTCMonth() + 1;
  const day = today.getUTCDate();

  const { data: perfiles, error: perfilesError } = await serviceRoleClient
    .from('perfiles')
    .select('id, nombre, fecha_nacimiento')
    .not('fecha_nacimiento', 'is', null);

  if (perfilesError) {
    throw perfilesError;
  }

  const cumpleaneros = (perfiles || []).filter((perfil) => {
    if (!perfil?.fecha_nacimiento) return false;
    const date = new Date(`${perfil.fecha_nacimiento}T00:00:00Z`);
    return date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
  });

  if (cumpleaneros.length === 0) {
    return { ok: true, sent: 0, deleted: 0, failed: 0, usuarios: 0 };
  }

  const cumpleanerosIds = cumpleaneros.map((perfil) => perfil.id);
  const nombrePorUsuario = new Map(cumpleaneros.map((perfil) => [perfil.id, perfil.nombre || 'Miembro del equipo']));

  const { data: subscriptions, error: subscriptionsError } = await serviceRoleClient
    .from('suscripciones_push')
    .select('id, user_id, suscripcion')
    .in('user_id', cumpleanerosIds);

  if (subscriptionsError) {
    throw subscriptionsError;
  }

  let sent = 0;
  let deleted = 0;
  let failed = 0;

  await Promise.all(
    (subscriptions || []).map(async (row) => {
      if (!row?.suscripcion || typeof row.suscripcion !== 'object') return;

      const nombre = nombrePorUsuario.get(row.user_id) || 'Miembro del equipo';
      const payload = JSON.stringify({
        title: 'Feliz cumpleaños',
        body: `Hoy celebramos a ${nombre}. Que tengas un día muy especial.`,
        url: '/perfil',
      });

      try {
        await webpush.sendNotification(row.suscripcion, payload);
        sent += 1;
      } catch (error) {
        if (isExpiredPushError(error)) {
          const { error: deleteError } = await serviceRoleClient
            .from('suscripciones_push')
            .delete()
            .eq('id', row.id);

          if (deleteError) {
            console.error('Cron cumpleaños: no se pudo limpiar suscripción expirada', {
              id: row.id,
              error: deleteError,
            });
          } else {
            deleted += 1;
          }
          return;
        }

        failed += 1;
        console.error('Cron cumpleaños: fallo enviando push', {
          id: row.id,
          userId: row.user_id,
          error,
        });
      }
    })
  );

  return {
    ok: true,
    sent,
    deleted,
    failed,
    usuarios: cumpleaneros.length,
  };
}
