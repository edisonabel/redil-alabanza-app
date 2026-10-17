import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getEventAssignableRoles, getRoleDisplayName } from '../src/lib/role-permissions.js';
import { matchesSongLibrary } from '../src/lib/song-library.js';
import { getReminderKeyForEvent, runServiceReminderNotifications } from '../src/lib/service-reminder-notifications.js';
import { buildPlaylistReadyEmail, processPlaylistReadyNotifications } from '../src/lib/server/playlist-ready-notifications.js';
import { resolveRehearsalEventById } from '../src/lib/server/rehearsal-event.js';
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const db = new PGlite();
assert.equal(matchesSongLibrary('general', 'general'), true);
assert.equal(matchesSongLibrary('sin_filtros', 'general'), true);
assert.equal(matchesSongLibrary('general', 'sin_filtros'), false);
assert.equal(matchesSongLibrary('sin_filtros', 'sin_filtros'), true);
const u = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
await db.exec(`
CREATE SCHEMA auth; CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULLIF(current_setting('test.user_id',true),'')::uuid $$;
CREATE TABLE perfiles(id uuid PRIMARY KEY, nombre text, email text);
CREATE TABLE roles(id uuid PRIMARY KEY, codigo text UNIQUE, nombre text UNIQUE);
CREATE TABLE perfil_roles(perfil_id uuid, rol_id uuid, UNIQUE(perfil_id,rol_id));
CREATE TABLE equipo_integrantes(perfil_id uuid, rol_maestro uuid);
CREATE TABLE ministerios(id uuid PRIMARY KEY, codigo text);
CREATE TABLE eventos(id uuid PRIMARY KEY, titulo text, fecha_hora timestamptz, estado text, sin_servicio_motivo text, ministerio_id uuid);
CREATE TABLE asignaciones(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, evento_id uuid REFERENCES eventos, perfil_id uuid REFERENCES perfiles, rol_id uuid REFERENCES roles, UNIQUE(evento_id,perfil_id,rol_id));
CREATE TABLE canciones(id uuid PRIMARY KEY, repertorio text);
CREATE TABLE playlists(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, evento_id uuid UNIQUE REFERENCES eventos, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE playlist_canciones(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, playlist_id uuid REFERENCES playlists, cancion_id uuid REFERENCES canciones, orden integer);
CREATE TABLE notification_delivery_audit(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, source text, perfil_id uuid, channel text, status text);
CREATE FUNCTION can_manage_event_assignments(evt_id uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT auth.uid()='${u(1)}'::uuid AND EXISTS(SELECT 1 FROM eventos WHERE id=evt_id) $$;
CREATE FUNCTION can_access_sin_filtros_repertoire() RETURNS boolean LANGUAGE sql AS $$ SELECT auth.uid()='${u(1)}'::uuid $$;
INSERT INTO perfiles VALUES('${u(1)}','Ana Música','ana@example.com'),('${u(2)}','Luis Voz','luis@example.com');
INSERT INTO roles VALUES('${u(10)}','talkback','Talkback'),('${u(11)}','director_musical','Director'),('${u(12)}','lider_alabanza','Líder');
INSERT INTO ministerios VALUES('${u(20)}','alabanza_general'),('${u(21)}','sin_filtros');
INSERT INTO eventos VALUES('${u(30)}','Domingo','2026-10-18T09:00:00-05:00','Publicado',NULL,'${u(20)}'),('${u(31)}','Sin Filtros','2026-10-17T18:30:00-05:00','Publicado',NULL,'${u(21)}');
INSERT INTO asignaciones(evento_id,perfil_id,rol_id) VALUES('${u(30)}','${u(1)}','${u(10)}'),('${u(30)}','${u(1)}','${u(11)}'),('${u(31)}','${u(2)}','${u(11)}'),('${u(31)}','${u(1)}','${u(12)}');
INSERT INTO perfil_roles VALUES('${u(2)}','${u(11)}');
INSERT INTO equipo_integrantes VALUES('${u(2)}','${u(11)}');
INSERT INTO canciones VALUES('${u(40)}','general'),('${u(41)}','sin_filtros'),('${u(42)}','general');
INSERT INTO eventos VALUES('${u(32)}','Aviso sin servicio','2026-10-17T18:30:00-05:00','Publicado','Asamblea','${u(21)}');
INSERT INTO asignaciones(evento_id,perfil_id,rol_id) VALUES('${u(32)}','${u(2)}','${u(11)}');
CREATE FUNCTION guard_canceled_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM eventos WHERE id=NEW.evento_id AND sin_servicio_motivo IS NOT NULL) THEN
  RAISE EXCEPTION 'No se pueden asignar músicos en un día sin servicio';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_canceled_assignment BEFORE UPDATE ON asignaciones FOR EACH ROW EXECUTE FUNCTION guard_canceled_assignment();
`);
for (const migration of ['053_musical_director_and_retire_saturday_email.sql', '054_playlist_ready_notifications.sql']) {
  await db.exec(await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
}
assert.equal((await db.query(`SELECT count(*)::int AS n FROM asignaciones WHERE rol_id='${u(11)}' AND evento_id<>'${u(32)}'`)).rows[0].n, 0);
assert.equal((await db.query(`SELECT count(*)::int AS n FROM asignaciones WHERE rol_id='${u(11)}' AND evento_id='${u(32)}'`)).rows[0].n, 1, 'Los días sin servicio conservan sus registros históricos');
assert.equal((await db.query(`SELECT count(*)::int AS n FROM asignaciones WHERE rol_id='${u(10)}'`)).rows[0].n, 2);
assert.equal((await db.query('SELECT rol_maestro FROM equipo_integrantes')).rows[0].rol_maestro, u(10));
assert.equal((await db.query(`SELECT nombre FROM roles WHERE codigo='talkback'`)).rows[0].nombre, 'Director musical');
const visibleRoles = getEventAssignableRoles((await db.query('SELECT * FROM roles')).rows);
assert.equal(visibleRoles.filter((r) => r.nombre === 'Director musical').length, 1);
assert.equal(getRoleDisplayName({ codigo: 'talkback', nombre: 'Talkback' }), 'Director musical');
assert.deepEqual(getEventAssignableRoles([{ id: u(11), codigo: 'director_musical', nombre: 'Director' }]), [], 'El cargo eliminado tampoco reaparece con un catálogo incompleto');
assert.equal(getReminderKeyForEvent({ scope: 'saturday-night', daysUntil: 1, eventWeekday: 0 }), '');
assert.equal((await runServiceReminderNotifications({ scope: 'saturday-night' })).executed, false);

const save = (event, songs) => db.query('SELECT save_event_playlist($1,$2::uuid[]) AS id', [u(event), songs.map(u)]);
await assert.rejects(() => save(30, [40]), /permisos/);
await db.exec(`SET test.user_id='${u(2)}';`);
await assert.rejects(() => save(30, [40]), /permisos/);
await db.exec(`SET test.user_id='${u(1)}';`);
await save(30, []);
assert.equal((await db.query('SELECT * FROM playlist_ready_notification_queue')).rows.length, 0);
await save(30, [40,42]);
assert.equal((await db.query('SELECT * FROM playlist_ready_notification_queue')).rows.length, 1);
await save(30, [42,40]);
assert.equal((await db.query('SELECT * FROM playlist_ready_notification_queue')).rows.length, 1);
assert.deepEqual((await db.query('SELECT cancion_id FROM playlist_canciones ORDER BY orden')).rows.map((r) => r.cancion_id), [u(42),u(40)]);
await assert.rejects(() => save(30, [41]), /solo se pueden programar/);
await assert.rejects(() => save(30, [99]), /inválidas/);
await assert.rejects(() => save(30, [40,40]), /inválidas/);
assert.equal((await db.query('SELECT * FROM playlist_canciones')).rows.length, 2, 'Un guardado inválido conserva el repertorio anterior');
await save(31, [41,40]);
assert.equal((await db.query('SELECT * FROM playlist_ready_notification_queue')).rows.length, 3, 'Dos roles de la misma persona reciben un solo aviso');
await db.exec('SET ROLE authenticated');
await assert.rejects(() => db.query('SELECT * FROM playlist_ready_notification_queue'), /permission denied/);
await db.exec('RESET ROLE');

// Adaptador PostgREST para ejecutar el procesador real contra PostgreSQL local.
class Query {
  constructor(table) { this.table = table; this.filters = []; this.values = []; this.columns = '*'; }
  select(columns) { this.columns = columns; return this; }
  update(patch) { this.patch = patch; return this; }
  param(value) { this.values.push(value); return `$${this.values.length}`; }
  eq(key,value) { this.filters.push(`${key}=${this.param(value)}`); return this; }
  is(key,value) { assert.equal(value,null); this.filters.push(`${key} IS NULL`); return this; }
  lte(key,value) { this.filters.push(`${key}<=${this.param(value)}`); return this; }
  or(value) {
    const stale = value.split('processing_started_at.lt.')[1];
    this.filters.push(`(processing_started_at IS NULL OR processing_started_at<${this.param(stale)})`);
    return this;
  }
  order(column) { this.sort = column; return this; }
  limit(n) { this.max = n; return this; }
  maybeSingle() { this.single = true; return this; }
  async then(resolve) {
    try {
      let columns = this.columns;
      if (this.table === 'playlists' && columns.includes('playlist_canciones')) {
        columns = "id, (SELECT coalesce(json_agg(json_build_object('id',pc.id)),'[]') FROM playlist_canciones pc WHERE pc.playlist_id=playlists.id) AS playlist_canciones";
      }
      const where = this.filters.length ? ` WHERE ${this.filters.join(' AND ')}` : '';
      const sql = this.patch
        ? `UPDATE ${this.table} SET ${Object.entries(this.patch).map(([key,value]) => `${key}=${this.param(value)}`).join(',')}${where} RETURNING ${columns}`
        : `SELECT ${columns} FROM ${this.table}${where}${this.sort ? ` ORDER BY ${this.sort}` : ''}${this.max ? ` LIMIT ${this.max}` : ''}`;
      const { rows } = await db.query(sql, this.values);
      resolve({ data: this.single ? rows[0] || null : rows, error: null });
    } catch (error) { resolve({ data: null, error }); }
  }
}
const client = { from: (table) => new Query(table) };
// The new email URL and the already-sent playlist URL must resolve the same event.
const { rows: [eventPlaylist] } = await db.query('SELECT id FROM playlists WHERE evento_id=$1', [u(30)]);
const email = buildPlaylistReadyEmail({
  event: { id: u(30), titulo: 'Domingo', fecha_hora: '2026-10-18T14:00:00Z' },
  recipient: { name: 'Ana Música' },
});
assert.equal(email.url, `/ensayo/${u(30)}`);
assert.notEqual(email.url, `/ensayo/${eventPlaylist.id}`);
for (const routeId of [email.url.split('/').at(-1), eventPlaylist.id]) {
  const resolved = await resolveRehearsalEventById(client, routeId, 'id, titulo');
  assert.equal(resolved.error, null);
  assert.equal(resolved.data.id, u(30));
  const { rows: songs } = await db.query(`SELECT pc.cancion_id FROM playlist_canciones pc
    JOIN playlists p ON p.id=pc.playlist_id WHERE p.evento_id=$1 ORDER BY pc.orden`, [resolved.data.id]);
  assert.deepEqual(songs.map((song) => song.cancion_id), [u(42), u(40)]);
}
assert.equal((await resolveRehearsalEventById(client, u(999), 'id')).data, null);
const personalPlaylist = u(998);
await db.query('INSERT INTO playlists(id) VALUES($1)', [personalPlaylist]);
assert.equal((await resolveRehearsalEventById(client, personalPlaylist, 'id')).data, null,
  'A personal playlist must not resolve to an event');

const now = new Date('2026-10-14T18:00:00Z');
await db.query('UPDATE playlist_ready_notification_queue SET next_attempt_at=$1', [now]);
let deliveries = 0;
let fail = true;
const sendEmail = async (message) => {
  deliveries += 1;
  assert.equal(message.recipients.length,1);
  assert.match(message.body, /\n\n/);
  const eventId = message.idempotencyKey.split('__')[1];
  assert.equal(message.url, `/ensayo/${eventId}`);
  assert.match(message.idempotencyKey, /^playlist_ready__/);
  return { sent: fail ? 0 : 1 };
};
assert.equal((await processPlaylistReadyNotifications({ client, sendEmail, now, dryRun: true })).due, 3);
assert.equal(deliveries,0);
let result = await processPlaylistReadyNotifications({ client, sendEmail, now });
assert.equal(result.failed,3);
assert.equal((await db.query('SELECT * FROM playlist_ready_notification_queue WHERE sent_at IS NOT NULL')).rows.length,0);
fail = false;
const retry = new Date(now.getTime()+6*60*1000);
await Promise.all([
  processPlaylistReadyNotifications({ client, sendEmail, now: retry }),
  processPlaylistReadyNotifications({ client, sendEmail, now: retry }),
]);
assert.equal(deliveries,6,'Cada destinatario se envía una vez en dos procesadores concurrentes');
assert.equal((await db.query('SELECT * FROM playlist_ready_notification_queue WHERE sent_at IS NOT NULL')).rows.length,3);
await save(30, [40]);
await processPlaylistReadyNotifications({ client, sendEmail, now: retry });
assert.equal(deliveries,6,'Volver a guardar no repite avisos enviados');

// Una auditoría exitosa recupera un envío cuyo cierre de cola se interrumpió.
await db.query('UPDATE playlist_ready_notification_queue SET sent_at=NULL, next_attempt_at=$1 WHERE evento_id=$2',[now,u(30)]);
await db.query("INSERT INTO notification_delivery_audit(source,perfil_id,channel,status) VALUES($1,$2,'email','sent')",[`playlist_ready__${u(30)}__${u(1)}`,u(1)]);
await processPlaylistReadyNotifications({ client, sendEmail, now: retry });
assert.equal(deliveries,6);

// Un repertorio vacío o un evento sin servicio nunca genera un correo.
await db.query('UPDATE playlist_ready_notification_queue SET sent_at=NULL, next_attempt_at=$1 WHERE evento_id=$2',[now,u(31)]);
await save(31, []);
result = await processPlaylistReadyNotifications({ client, sendEmail, now: retry });
assert.equal(result.deferred,2);
assert.equal(deliveries,6);
const removeUnusedRole = await readFile(new URL('../migrations/055_remove_unused_director_role.sql', import.meta.url), 'utf8');
await assert.rejects(() => db.exec(removeUnusedRole), /cargo sobrante tiene referencias/);
await db.exec('ROLLBACK');
assert.equal((await db.query(`SELECT count(*)::int AS n FROM roles WHERE codigo='director_musical'`)).rows[0].n,1, 'No se elimina un rol todavía en uso');
await db.query(`DELETE FROM asignaciones WHERE rol_id='${u(11)}'`);
await db.query(`DELETE FROM perfil_roles WHERE rol_id='${u(11)}'`);
await db.exec(removeUnusedRole);
await db.exec(removeUnusedRole);
assert.equal((await db.query(`SELECT count(*)::int AS n FROM roles WHERE codigo='director_musical'`)).rows[0].n,0);
assert.equal((await db.query(`SELECT nombre FROM roles WHERE codigo='talkback'`)).rows[0].nombre, 'Director musical');
assert.equal((await db.query(`SELECT count(*)::int AS n FROM asignaciones WHERE rol_id='${u(10)}'`)).rows[0].n,2, 'El Talkback operativo conserva sus asignaciones');
await db.close();
console.log('Playlist ready: migration, permissions, atomic saves, scopes, recipients, deduplication, concurrency, retry and disabled Saturday email: ok');
