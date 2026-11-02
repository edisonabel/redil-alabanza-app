// Borra las copias transportadas de los eventos que ya pasaron, para no dejar basura en R2. Solo toca
// live-director/event-keys/: la canción original nunca se borra. Deja dos días de margen por si el servicio se repite o se alarga.
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';

export const config = { schedule: '0 8 * * *' };

const PREFIX = 'live-director/event-keys/';
const MARGIN_MS = 2 * 24 * 60 * 60 * 1000;

/** Un evento que ya no existe tampoco necesita su copia. */
export const expiredEventIds = (eventIds, events, now = Date.now()) => {
  const dates = new Map(events.map(event => [event.id, Date.parse(event.hora_fin || event.fecha_hora)]));
  return eventIds.filter(id => { const date = dates.get(id); return date === undefined || (Number.isFinite(date) && date + MARGIN_MS < now); });
};

export default async () => {
  const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const supabaseUrl = process.env.PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const client = new S3Client({ region: 'auto', endpoint: R2_ENDPOINT, credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY } });
  const folders = await client.send(new ListObjectsV2Command({ Bucket: R2_BUCKET_NAME, Prefix: PREFIX, Delimiter: '/' }));
  const eventIds = (folders.CommonPrefixes || []).map(item => item.Prefix.slice(PREFIX.length, -1)).filter(id => /^[0-9a-f-]{36}$/i.test(id));
  if (!eventIds.length) return new Response('sin copias');
  const database = createClient(supabaseUrl, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await database.from('eventos').select('id,fecha_hora,hora_fin').in('id', eventIds);
  // Si no se pudo leer la agenda no se borra nada: «no aparece» no puede confundirse con «no existe».
  if (error) throw error;
  let removed = 0;
  for (const eventId of expiredEventIds(eventIds, data)) {
    let token;
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket: R2_BUCKET_NAME, Prefix: `${PREFIX}${eventId}/`, ContinuationToken: token }));
      const keys = (page.Contents || []).filter(item => item.Key.startsWith(PREFIX)).map(item => ({ Key: item.Key }));
      if (keys.length) { await client.send(new DeleteObjectsCommand({ Bucket: R2_BUCKET_NAME, Delete: { Objects: keys } })); removed += keys.length; }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }
  return new Response(`borrados ${removed}`);
};
