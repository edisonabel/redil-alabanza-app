# Director musical, correos y repertorio

Estado del 14 de octubre de 2026: las migraciones 053 y 054 ya se aplicaron
y verificaron en el Supabase de producción del proyecto Alabanza Redil Estadio.
Se conservaron las 22 asignaciones de dirección, se retiró el cron del sábado y
se confirmaron la cola privada con RLS, la función de guardado y el cron de
reintentos. No volver a ejecutar la migración 054: la tabla ya existe.
La migración 055 también se aplicó: se eliminó el cargo vacío `director_musical`
tras confirmar cero personas calificadas, cero asignaciones y cero plantillas.
Solo queda el antiguo Talkback, llamado **Director musical**, con sus cinco
personas calificadas y sus asignaciones. Falta desplegar la función de correo
para incorporar la clave de idempotencia en la ruta alternativa de Resend.

Aplicar `053_musical_director_and_retire_saturday_email.sql` y después
`054_playlist_ready_notifications.sql` antes de desplegar la aplicación.
Desplegar también la función `supabase/functions/send-notification-email`.
Se reutilizan el remitente de Resend, el secreto interno y el cron de asignaciones
existentes; no se necesitan nuevas credenciales.

- En Programación y Equipo debe aparecer un solo cargo de **Director musical**,
  con las personas y los permisos del antiguo Talkback. El líder permanece.
- El cron `aviso-sabado-noche-servicio` debe desaparecer. Las llamadas antiguas al
  recordatorio del sábado quedan desactivadas también en la aplicación.
- Guardar canciones en un evento publicado y futuro encola un correo por cada
  persona asignada. Se intenta enviarlo al guardar; el cron existente reintenta
  los pendientes cada cinco minutos. Guardar otra vez o tener varios roles no
  repite un correo ya enviado. Los borradores esperan a que se publique el evento.
- Un repertorio vacío no envía avisos. Los eventos cancelados o pasados y las
  asignaciones retiradas cancelan sus envíos pendientes.
- El correo usa el diseño existente por bloques y enlaza al ensayo del servicio.
- Un integrante de Sin Filtros ve ambas bibliotecas en Repertorio general, con
  la etiqueta **Sin Filtros** en las canciones correspondientes. El filtro
  Repertorio Sin Filtros muestra únicamente esas canciones. Se conservan los
  permisos y la restricción de programarlas solo en eventos de Sin Filtros.

Pruebas locales sin correos reales:

```sh
npm run test:playlist-ready
npm run test:team-leadership
npm run test:migrations
node scripts/test-song-repertoire-database.mjs
node scripts/test-event-scheduling-database.mjs
npm run check
npm run build
```

Las pruebas de base de datos requieren `@electric-sql/pglite`, como las pruebas
existentes de programación y repertorio. También admiten `PGLITE_MODULE_PATH`.
La cola tiene RLS y solo la procesa el servidor con `service_role`.
Los reintentos conservan el contenido y usan una clave de idempotencia de Resend;
la auditoría y el estado persistente de la cola evitan repetir envíos confirmados.
