import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const db = new PGlite();
const u = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
await db.exec(`
CREATE SCHEMA auth; CREATE ROLE authenticated; CREATE ROLE anon;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULLIF(current_setting('test.user_id',true),'')::uuid $$;
CREATE TABLE perfiles(id uuid PRIMARY KEY, is_admin boolean DEFAULT false);
CREATE TABLE gestores_operativos(perfil_id uuid);
CREATE TABLE ministerios(id uuid PRIMARY KEY, codigo text);
CREATE TABLE perfil_ministerios(perfil_id uuid,ministerio_id uuid);
CREATE TABLE canciones(id uuid PRIMARY KEY,titulo text);
CREATE TABLE eventos(id uuid PRIMARY KEY,ministerio_id uuid);
CREATE TABLE playlists(id uuid PRIMARY KEY,evento_id uuid REFERENCES eventos);
CREATE TABLE playlist_canciones(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,playlist_id uuid REFERENCES playlists,cancion_id uuid REFERENCES canciones);
CREATE FUNCTION is_current_user_admin() RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM perfiles WHERE id=auth.uid() AND is_admin) $$;
CREATE FUNCTION is_current_user_operations_manager() RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM gestores_operativos WHERE perfil_id=auth.uid()) $$;
ALTER TABLE canciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY canciones_select ON canciones FOR SELECT TO authenticated USING(true);
CREATE POLICY canciones_insert_admin ON canciones FOR INSERT TO authenticated WITH CHECK(is_current_user_admin() OR is_current_user_operations_manager());
CREATE POLICY canciones_update_admin ON canciones FOR UPDATE TO authenticated USING(is_current_user_admin() OR is_current_user_operations_manager());
GRANT USAGE ON SCHEMA auth,public TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
INSERT INTO canciones VALUES('${u(100)}','Shared before migration');
`);
await db.exec(await readFile(new URL('../migrations/052_sin_filtros_repertoire.sql', import.meta.url), 'utf8'));
assert.equal((await db.query(`SELECT repertorio FROM canciones WHERE id='${u(100)}'`)).rows[0].repertorio, 'general');
await db.exec(`
INSERT INTO ministerios VALUES('${u(10)}','alabanza_general'),('${u(11)}','sin_filtros');
INSERT INTO perfiles VALUES('${u(1)}',false),('${u(2)}',false),('${u(3)}',false),('${u(4)}',true),('${u(5)}',false),('${u(6)}',false);
INSERT INTO gestores_operativos VALUES('${u(5)}'),('${u(6)}');
INSERT INTO perfil_ministerios VALUES('${u(1)}','${u(10)}'),('${u(2)}','${u(11)}'),('${u(3)}','${u(10)}'),('${u(3)}','${u(11)}'),('${u(6)}','${u(11)}');
INSERT INTO canciones VALUES('${u(101)}','Youth song','sin_filtros'),('${u(102)}','Unscheduled shared song','general');
INSERT INTO eventos VALUES('${u(20)}','${u(10)}'),('${u(21)}','${u(11)}'),('${u(22)}',NULL);
INSERT INTO playlists VALUES('${u(30)}','${u(20)}'),('${u(31)}','${u(21)}'),('${u(32)}','${u(22)}'),('${u(33)}',NULL);
`);
for (const [user, expected] of [[1, [100,102]], [2,[100,101,102]], [3,[100,101,102]], [4,[100,101,102]], [5,[100,102]], [6,[100,101,102]]]) {
  await db.exec(`SET test.user_id='${u(user)}'; SET ROLE authenticated;`);
  assert.deepEqual((await db.query('SELECT id FROM canciones ORDER BY id')).rows.map((r) => r.id), expected.map(u));
  assert.equal((await db.query(`SELECT * FROM canciones WHERE id='${u(101)}'`)).rows.length, [1,5].includes(user) ? 0 : 1);
  if (user === 1) await assert.rejects(() => db.query(`INSERT INTO canciones VALUES('${u(103)}','Unauthorized upload','sin_filtros')`), /row-level security/);
  if (user === 5) {
    await assert.rejects(() => db.query(`INSERT INTO canciones VALUES('${u(103)}','Unauthorized SF upload','sin_filtros')`), /row-level security/);
    await assert.rejects(() => db.query(`UPDATE canciones SET repertorio='sin_filtros' WHERE id='${u(102)}'`), /row-level security/);
  }
  if (user === 6) {
    await db.query(`INSERT INTO canciones VALUES('${u(104)}','Scoped SF upload','sin_filtros')`);
    await db.exec('RESET ROLE');
    await db.query(`DELETE FROM canciones WHERE id='${u(104)}'`);
  }
  await db.exec('RESET ROLE');
}
console.log('RLS: general, SF, dual ministry, admin and manager; direct ID lookup protected');
await db.exec(`SET test.user_id='${u(3)}'; SET ROLE authenticated;`);
await db.query(`INSERT INTO playlist_canciones(playlist_id,cancion_id) VALUES('${u(30)}','${u(100)}'),('${u(31)}','${u(100)}'),('${u(31)}','${u(101)}')`);
for (const playlist of [30,32]) await assert.rejects(() => db.query(`INSERT INTO playlist_canciones(playlist_id,cancion_id) VALUES('${u(playlist)}','${u(101)}')`), /solo se pueden programar/);
await assert.rejects(() => db.query(`UPDATE playlist_canciones SET cancion_id='${u(101)}' WHERE playlist_id='${u(30)}'`), /solo se pueden programar/);
await assert.rejects(() => db.query(`UPDATE playlists SET evento_id='${u(20)}' WHERE id='${u(31)}'`), /solo se pueden programar/);
await assert.rejects(() => db.query(`UPDATE eventos SET ministerio_id='${u(10)}' WHERE id='${u(21)}'`), /solo se pueden programar/);
await assert.rejects(() => db.query(`UPDATE eventos SET ministerio_id=NULL WHERE id='${u(21)}'`), /solo se pueden programar/);
await db.exec('RESET ROLE');
await assert.rejects(() => db.query(`UPDATE canciones SET repertorio='sin_filtros' WHERE id='${u(100)}'`), /solo se pueden programar/);
await db.query(`UPDATE canciones SET repertorio='sin_filtros' WHERE id='${u(102)}'`);
await db.query(`INSERT INTO playlist_canciones(playlist_id,cancion_id) VALUES('${u(33)}','${u(101)}')`);
await assert.rejects(() => db.query(`UPDATE playlists SET evento_id='${u(20)}' WHERE id='${u(33)}'`), /solo se pueden programar/);
await assert.rejects(() => db.query(`INSERT INTO playlist_canciones(playlist_id,cancion_id) VALUES('${u(30)}','${u(101)}')`), /solo se pueden programar/);
await assert.rejects(() => db.query(`UPDATE canciones SET repertorio='unknown' WHERE id='${u(102)}'`), /check constraint/);
console.log('Programming: shared in both; SF in general rejected for dual members and privileged writes; changes of song, playlist and event context guarded');
await db.close();
