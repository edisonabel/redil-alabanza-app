import 'dotenv/config';

const args = process.argv.slice(2);

const readArg = (flag) => {
  const index = args.indexOf(flag);
  if (index === -1) return '';
  return String(args[index + 1] || '').trim();
};

const hasFlag = (flag) => args.includes(flag);

const baseUrl = (
  readArg('--base-url') ||
  process.env.PUBLIC_SITE_URL ||
  process.env.SITE_URL ||
  process.env.URL ||
  'https://alabanzaredilestadio.com'
).replace(/\/$/, '');

const notificationSecret =
  process.env.NOTIFICATION_FUNCTION_SECRET ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';

const scope = readArg('--scope') || 'morning';
const date = readArg('--date') || '';
const eventId = readArg('--event') || '';
const perfilId = readArg('--perfil') || '';
const dryRun = !hasFlag('--live');

if (!notificationSecret) {
  throw new Error('Missing NOTIFICATION_FUNCTION_SECRET or SUPABASE_SERVICE_ROLE_KEY');
}

const payload = {
  scope,
  dry_run: dryRun,
};

if (date) payload.today = date;
if (eventId) payload.event_id = eventId;
if (perfilId) payload.perfil_id = perfilId;

const response = await fetch(`${baseUrl}/api/notify-service-reminders`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-notification-secret': notificationSecret,
  },
  body: JSON.stringify(payload),
});

const rawBody = await response.text();
let parsedBody = rawBody;

try {
  parsedBody = JSON.parse(rawBody);
} catch {
  parsedBody = rawBody;
}

console.log(
  JSON.stringify(
    {
      baseUrl,
      scope,
      date: date || null,
      eventId: eventId || null,
      perfilId: perfilId || null,
      dryRun,
      httpStatus: response.status,
      ok: response.ok,
      body: parsedBody,
    },
    null,
    2,
  ),
);
