import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv({ quiet: true });

const supabaseUrl = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

assert(supabaseUrl, 'Falta SUPABASE_URL o PUBLIC_SUPABASE_URL.');
assert(anonKey, 'Falta PUBLIC_SUPABASE_ANON_KEY o SUPABASE_ANON_KEY.');
assert(serviceRoleKey, 'Falta SUPABASE_SERVICE_ROLE_KEY.');

const clientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

const anonClient = createClient(supabaseUrl, anonKey, clientOptions);
const serviceClient = createClient(supabaseUrl, serviceRoleKey, clientOptions);

const runStaticProfilePrivacyChecks = async () => {
  const migration = await readFile(
    new URL('../migrations/044_profile_data_minimization.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /REVOKE SELECT ON TABLE public\.perfiles FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_team_birthdays/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_team_roster_private/);
  assert.match(migration, /RAISE EXCEPTION 'No tienes permisos para consultar datos privados del equipo\.'/);

  const publicRosterFiles = [
    '../src/pages/index.astro',
    '../src/pages/programacion.astro',
    '../src/pages/ensayo/[id].astro',
    '../src/components/react/CalendarioGrid.jsx',
    '../src/components/react/RosterManager.jsx',
  ];
  for (const relativePath of publicRosterFiles) {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
    assert.doesNotMatch(
      source,
      /perfiles(?:!inner)?\s*\([^)]*\bemail\b/i,
      `${relativePath}: no debe solicitar email dentro del roster publico.`,
    );
  }

  const profileApi = await readFile(
    new URL('../src/pages/api/profile-data.js', import.meta.url),
    'utf8',
  );
  assert.match(profileApi, /serviceRoleClient[\s\S]+\.from\('perfiles'\)/);
  console.log('authorization profile privacy static checks: ok');
};

const runStaticCredentialHardeningChecks = async () => {
  const loginSource = await readFile(new URL('../src/pages/login.astro', import.meta.url), 'utf8');
  const resetSource = await readFile(new URL('../src/pages/reset-password.astro', import.meta.url), 'utf8');
  assert.match(loginSource, /passwordInput\.minLength = 12/);
  assert.match(loginSource, /contraseña debe tener al menos 12 caracteres/i);
  assert.match(resetSource, /minlength="12"/);
  assert.match(resetSource, /newPass\.length < 12/);

  const dedicatedSecretFiles = [
    '../src/pages/api/process-assignment-notifications.js',
    '../src/pages/api/notify-birthdays.js',
    '../src/pages/api/notify-service-reminders.js',
    '../src/lib/server/notification-delivery.js',
    '../netlify/functions/reconcile-google-calendar.mjs',
    '../netlify/functions/reconcile-google-calendar-background.mjs',
    '../supabase/functions/send-notification-email/index.ts',
    '../supabase/functions/notify-assignment/index.ts',
  ];

  for (const relativePath of dedicatedSecretFiles) {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
    assert.doesNotMatch(
      source,
      /NOTIFICATION_FUNCTION_SECRET[\s\S]{0,120}(?:\|\||,)\s*(?:process\.env\.|Deno\.env\.get\()?['"]?SUPABASE_SERVICE_ROLE_KEY/i,
      `${relativePath}: no debe reutilizar SUPABASE_SERVICE_ROLE_KEY como secreto interno.`,
    );
  }

  console.log('authorization credential hardening static checks: ok');
};

const expectPermissionDenied = (result, label) => {
  assert(result.error, `${label}: el acceso anonimo no fue rechazado.`);
  assert.equal(
    result.error.code,
    '42501',
    `${label}: se esperaba PostgreSQL 42501 y se recibio ${result.error.code || 'sin codigo'}.`,
  );
};

const runDatabaseBoundaryChecks = async () => {
  const [anonSongs, anonRateLimits, serviceSongs, serviceRateLimits, anonAdminCheck] = await Promise.all([
    anonClient.from('canciones').select('id').limit(1),
    anonClient.from('api_rate_limits').select('bucket').limit(1),
    serviceClient.from('canciones').select('id').limit(1),
    serviceClient.from('api_rate_limits').select('bucket').limit(1),
    anonClient.rpc('is_current_user_admin'),
  ]);

  expectPermissionDenied(anonSongs, 'canciones');
  expectPermissionDenied(anonRateLimits, 'api_rate_limits');
  assert.ifError(serviceSongs.error);
  assert.ifError(serviceRateLimits.error);

  if (anonAdminCheck.error) {
    assert.equal(anonAdminCheck.error.code, '42501');
  } else {
    assert.equal(anonAdminCheck.data, false, 'Un usuario anonimo nunca puede ser administrador.');
  }

  console.log('authorization database boundaries: ok');
};

const runUnauthenticatedApiChecks = async (baseUrl) => {
  const endpoints = [
    '/api/get-upload-url',
    '/api/delete-upload',
    '/api/auto-markers',
    '/api/chordpro-print-pdf-v2',
    '/api/admin/team-member',
  ];

  for (const path of endpoints) {
    const response = await fetch(new URL(path, baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });

    assert.equal(response.status, 401, `${path}: se esperaba 401 y se recibio ${response.status}.`);
  }

  console.log('authorization unauthenticated API boundaries: ok');
};

const runAuthenticatedRoleChecks = async () => {
  const nonAdminEmail = process.env.TEST_NON_ADMIN_EMAIL;
  const nonAdminPassword = process.env.TEST_NON_ADMIN_PASSWORD;
  const adminEmail = process.env.TEST_ADMIN_EMAIL;
  const adminPassword = process.env.TEST_ADMIN_PASSWORD;

  if (!nonAdminEmail || !nonAdminPassword || !adminEmail || !adminPassword) {
    console.log('authorization authenticated roles: omitidas (faltan credenciales TEST_*)');
    return;
  }

  const { data: referenceSong, error: referenceSongError } = await serviceClient
    .from('canciones')
    .select('id, titulo')
    .limit(1)
    .maybeSingle();
  assert.ifError(referenceSongError);
  assert(referenceSong, 'Se requiere al menos una cancion para probar permisos de escritura.');

  const verifyRole = async ({ email, password, expectedAdmin }) => {
    const client = createClient(supabaseUrl, anonKey, clientOptions);
    const { data: signInData, error: signInError } = await client.auth.signInWithPassword({ email, password });
    assert.ifError(signInError);
    assert(signInData.user, `No se pudo iniciar sesion con ${email}.`);

    const { data: profile, error: profileError } = await client
      .from('perfiles')
      .select('id, is_admin')
      .eq('id', signInData.user.id)
      .maybeSingle();
    assert.ifError(profileError);
    assert.equal(Boolean(profile?.is_admin), expectedAdmin, `${email}: rol administrativo inesperado.`);

    const songWrite = await client
      .from('canciones')
      .update({ titulo: referenceSong.titulo })
      .eq('id', referenceSong.id)
      .select('id');

    if (expectedAdmin) {
      assert.ifError(songWrite.error);
      assert.equal(songWrite.data?.length, 1, 'El administrador no pudo actualizar canciones.');
    } else {
      assert(
        songWrite.error || songWrite.data?.length === 0,
        'Un usuario normal pudo actualizar canciones.',
      );

      await client
        .from('perfiles')
        .update({ is_admin: true })
        .eq('id', signInData.user.id);

      const { data: profileAfterEscalation, error: escalationReadError } = await client
        .from('perfiles')
        .select('is_admin')
        .eq('id', signInData.user.id)
        .maybeSingle();
      assert.ifError(escalationReadError);
      assert.equal(
        Boolean(profileAfterEscalation?.is_admin),
        false,
        'El usuario normal logro elevar is_admin.',
      );
    }

    await client.auth.signOut();
  };

  await verifyRole({ email: nonAdminEmail, password: nonAdminPassword, expectedAdmin: false });
  await verifyRole({ email: adminEmail, password: adminPassword, expectedAdmin: true });
  console.log('authorization authenticated roles: ok');
};

await runStaticProfilePrivacyChecks();
await runStaticCredentialHardeningChecks();
await runDatabaseBoundaryChecks();

if (process.env.TEST_APP_URL) {
  await runUnauthenticatedApiChecks(process.env.TEST_APP_URL);
} else {
  console.log('authorization API boundaries: omitidas (define TEST_APP_URL para ejecutarlas)');
}

await runAuthenticatedRoleChecks();
