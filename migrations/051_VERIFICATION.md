La migración `051_ministry_scheduling_and_service_notices.sql` debe aplicarse
antes de desplegar esta versión: añade `eventos.sin_servicio_motivo` y el RPC
atómico para los dos cupos de guitarra electroacústica.

No modifica los roles ni el permiso de administrador de Josué. Las API consultan
`can_manage_event_assignments` con la sesión de la persona. El liderazgo habilita
la programación en los ministerios que lidera, incluso sin asignación al evento.
Se conservan los permisos existentes de administradores, gestores operativos y
líderes asignados al evento.

El aviso de sábado sin servicio solo se admite en Sin Filtros y exige motivo.
Conserva las asignaciones y canciones anteriores, oculta la programación de ese
día y suspende recordatorios y sincronización como servicio. Al reactivar se
restaura el ensayo. El aviso no se propaga a los demás eventos de una serie.

Validación de lógica:

```sh
node scripts/test-event-scheduling.mjs
npm run test:migrations
npm run test:team-leadership
npm run test:event-voice-slots
node scripts/test-sin-filtros.mjs
```

Validación en PostgreSQL temporal (PGlite; no usa Supabase ni datos reales):

```sh
npm install --prefix /tmp/alabanza-sql-verify --no-save --ignore-scripts @electric-sql/pglite
PGLITE_MODULE_PATH=/tmp/alabanza-sql-verify/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-event-scheduling-database.mjs
```

La vista `/dev/event-scheduling` usa los componentes reales con consultas locales
simuladas y únicamente está disponible en desarrollo.
