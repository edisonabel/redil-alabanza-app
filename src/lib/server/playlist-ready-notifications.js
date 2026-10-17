import { getServiceRoleClient, sendEmailNotifications } from './notification-delivery.js';

const TABLE = 'playlist_ready_notification_queue';
const RETRY_MS = 5 * 60 * 1000;
const LEASE_MS = 10 * 60 * 1000;

export const buildPlaylistReadyEmail = ({ event, recipient }) => ({
  title: 'El repertorio de tu servicio ya está listo 🎶',
  body: [
    `Hola, ${String(recipient.name || 'Equipo').trim().split(/\s+/)[0]}. Dios te bendiga.`,
    'Las canciones ya están cargadas. Ya puedes escucharlas y prepararte para el ensayo.',
    [
      `Servicio: ${event.titulo || 'Servicio de alabanza'}`,
      `Fecha: ${new Intl.DateTimeFormat('es-CO', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota',
      }).format(new Date(event.fecha_hora))}`,
    ].join('\n'),
    'Entra al modo ensayo para revisar el repertorio y practicar con tiempo.',
    'Gracias por tu disposición para servir. Bendiciones.',
  ].join('\n\n'),
  url: `/ensayo/${encodeURIComponent(event.id)}`,
  ctaLabel: 'Entrar al modo ensayo',
});

const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export async function processPlaylistReadyNotifications({
  onlyEventId = '', onlyPerfilId = '', limit = 12, dryRun = false,
  client = getServiceRoleClient(), sendEmail = sendEmailNotifications, now = new Date(),
} = {}) {
  const nowIso = now.toISOString();
  const staleIso = new Date(now.getTime() - LEASE_MS).toISOString();
  const retryIso = new Date(now.getTime() + RETRY_MS).toISOString();
  const availableLease = `processing_started_at.is.null,processing_started_at.lt.${staleIso}`;
  let query = client.from(TABLE).select('*').is('sent_at', null).is('canceled_at', null)
    .lte('next_attempt_at', nowIso).or(availableLease)
    .order('next_attempt_at').limit(limit);
  if (onlyEventId) query = query.eq('evento_id', onlyEventId);
  if (onlyPerfilId) query = query.eq('perfil_id', onlyPerfilId);
  const rows = unwrap(await query) || [];
  const summary = { due: rows.length, sent: 0, failed: 0, deferred: 0, canceled: 0, dry_run: dryRun };

  for (const row of rows) {
    if (dryRun) continue;
    // Compare-and-set evita que el guardado y el cron envien el mismo correo.
    const claimed = unwrap(await client.from(TABLE).update({
      processing_started_at: nowIso, attempt_count: row.attempt_count + 1,
    }).eq('id', row.id).is('sent_at', null).is('canceled_at', null).lte('next_attempt_at', nowIso)
      .or(availableLease).select('id').maybeSingle());
    if (!claimed) continue;

    try {
      const [eventResult, playlistResult, assignmentResult, profileResult] = await Promise.all([
        client.from('eventos').select('id, titulo, fecha_hora, estado, sin_servicio_motivo').eq('id', row.evento_id).maybeSingle(),
        client.from('playlists').select('id, playlist_canciones(id)').eq('evento_id', row.evento_id).maybeSingle(),
        client.from('asignaciones').select('id').eq('evento_id', row.evento_id).eq('perfil_id', row.perfil_id).limit(1),
        client.from('perfiles').select('id, nombre, email').eq('id', row.perfil_id).maybeSingle(),
      ]);
      const event = unwrap(eventResult);
      const playlist = unwrap(playlistResult);
      const assignments = unwrap(assignmentResult);
      const profile = unwrap(profileResult);
      if (!event || event.sin_servicio_motivo || new Date(event.fecha_hora) <= now
        || !assignments?.length || !profile) {
        unwrap(await client.from(TABLE).update({
          canceled_at: nowIso, processing_started_at: null, last_error: 'event-or-assignment-no-longer-active',
        }).eq('id', row.id));
        summary.canceled += 1;
        continue;
      }
      if (event.estado !== 'Publicado' || !playlist?.playlist_canciones?.length || !profile.email) {
        unwrap(await client.from(TABLE).update({
          processing_started_at: null, next_attempt_at: retryIso, last_error: 'not-ready-or-recipient-unavailable',
        }).eq('id', row.id));
        summary.deferred += 1;
        continue;
      }

      const source = `playlist_ready__${row.evento_id}__${row.perfil_id}`;
      const sentAudit = unwrap(await client.from('notification_delivery_audit').select('id')
        .eq('source', source).eq('perfil_id', row.perfil_id).eq('channel', 'email').eq('status', 'sent').limit(1));
      if (!sentAudit?.length) {
        // Mantener el mismo contenido en los reintentos con clave de idempotencia.
        const notification = row.notification || buildPlaylistReadyEmail({
          event, recipient: { name: profile.nombre },
        });
        if (!row.notification) {
          unwrap(await client.from(TABLE).update({ notification }).eq('id', row.id));
        }
        const result = await sendEmail({
          recipients: [{ id: profile.id, name: profile.nombre, email: profile.email }],
          ...notification, source, idempotencyKey: source,
        });
        if (result.sent !== 1) throw new Error('playlist-ready-email-not-sent');
      }
      unwrap(await client.from(TABLE).update({
        sent_at: nowIso, processing_started_at: null, last_error: null,
      }).eq('id', row.id));
      summary.sent += 1;
    } catch (error) {
      unwrap(await client.from(TABLE).update({
        processing_started_at: null, next_attempt_at: retryIso,
        last_error: error instanceof Error ? error.message : String(error),
      }).eq('id', row.id));
      summary.failed += 1;
    }
  }
  return summary;
}
