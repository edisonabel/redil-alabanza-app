import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const notificationSecret = process.env.NOTIFICATION_FUNCTION_SECRET || serviceRoleKey;

if (!supabaseUrl || !serviceRoleKey || !notificationSecret) {
  throw new Error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or NOTIFICATION_FUNCTION_SECRET');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const rangeStart = process.env.BACKFILL_START || '2026-03-30T00:00:00-05:00';
const rangeEnd = process.env.BACKFILL_END || '2026-04-12T23:59:59-05:00';
const source =
  process.env.BACKFILL_SOURCE || 'assignment_backfill_2026_03_30_to_2026_04_12';
const onlyPerfilId = String(process.env.ONLY_PERFIL_ID || '').trim();

const formatEventDate = (value) =>
  new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Bogota',
  }).format(new Date(value));

const toDisplayTitle = (evento) => {
  const tema = String(evento.tema_predicacion || '').trim();
  return tema || String(evento.titulo || 'Servicio').trim() || 'Servicio';
};

const firstName = (nombre = '') => String(nombre || '').trim().split(/\s+/)[0] || 'equipo';

const buildEmailCopy = ({ nombre, eventos }) => {
  const sortedEvents = [...eventos].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  const summary = sortedEvents
    .map((evento) => `${formatEventDate(evento.fecha)}: ${evento.titulo}`)
    .join('; ');

  const titulo =
    sortedEvents.length > 1
      ? 'Tienes una asignaci\u00f3n confirmada en los pr\u00f3ximos servicios'
      : 'Tienes una asignaci\u00f3n confirmada en el pr\u00f3ximo servicio';

  const contenido = `Hola ${firstName(nombre)}. Te compartimos tus servicios confirmados: ${summary}. Entra a la app para revisar tu rol y prepararte.`;

  return { titulo, contenido };
};

const { data: eventos, error: eventosError } = await supabase
  .from('eventos')
  .select('id, titulo, tema_predicacion, fecha_hora, estado, asignaciones(id, perfil_id, perfiles(id, nombre, email))')
  .eq('estado', 'Publicado')
  .gte('fecha_hora', rangeStart)
  .lte('fecha_hora', rangeEnd)
  .order('fecha_hora', { ascending: true });

if (eventosError) {
  throw eventosError;
}

const recipientsMap = new Map();
for (const evento of eventos || []) {
  for (const asig of evento.asignaciones || []) {
    const perfil = asig.perfiles;
    const perfilId = String(asig.perfil_id || perfil?.id || '').trim();
    const email = String(perfil?.email || '').trim();
    const nombre = String(perfil?.nombre || '').trim();
    if (!perfilId || !email || !nombre) continue;
    if (onlyPerfilId && perfilId !== onlyPerfilId) continue;

    const existing = recipientsMap.get(perfilId) || {
      perfilId,
      email,
      nombre,
      eventos: [],
    };

    if (!existing.eventos.some((item) => item.id === evento.id)) {
      existing.eventos.push({
        id: evento.id,
        fecha: evento.fecha_hora,
        titulo: toDisplayTitle(evento),
      });
    }

    recipientsMap.set(perfilId, existing);
  }
}

const recipients = Array.from(recipientsMap.values()).sort((a, b) =>
  a.nombre.localeCompare(b.nombre, 'es')
);

const { data: existingAudit, error: auditError } = await supabase
  .from('notification_delivery_audit')
  .select('perfil_id, status, source')
  .in('perfil_id', recipients.map((item) => item.perfilId))
  .eq('channel', 'email')
  .eq('source', source);

if (auditError) {
  throw auditError;
}

const alreadySent = new Set(
  (existingAudit || [])
    .filter((row) => row.status === 'sent')
    .map((row) => String(row.perfil_id || '').trim())
);

const results = [];
for (const recipient of recipients) {
  if (alreadySent.has(recipient.perfilId)) {
    results.push({
      perfilId: recipient.perfilId,
      email: recipient.email,
      status: 'skipped_already_sent',
    });
    continue;
  }

  const { titulo, contenido } = buildEmailCopy(recipient);

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/send-notification-email`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-notification-secret': notificationSecret,
      },
      body: JSON.stringify({
        perfil_id: recipient.perfilId,
        titulo,
        contenido,
        source,
        url: '/programacion',
        cta_label: 'Ver mi agenda',
      }),
    });

    const raw = await response.text();
    let body = raw;
    try {
      body = JSON.parse(raw);
    } catch {
      // keep raw text
    }

    results.push({
      perfilId: recipient.perfilId,
      email: recipient.email,
      status: response.ok ? 'sent' : 'failed',
      httpStatus: response.status,
      body,
    });
  } catch (error) {
    results.push({
      perfilId: recipient.perfilId,
      email: recipient.email,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

console.log(
  JSON.stringify(
    {
      source,
      rangeStart,
      rangeEnd,
      onlyPerfilId: onlyPerfilId || null,
      recipients: recipients.length,
      sent: results.filter((item) => item.status === 'sent').length,
      failed: results.filter((item) => item.status === 'failed').length,
      skipped: results.filter((item) => item.status === 'skipped_already_sent').length,
      results,
    },
    null,
    2
  )
);
