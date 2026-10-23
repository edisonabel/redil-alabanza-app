# Modo Light 2 · beta privada

URL: https://light2-edison-beta--alabanzaredilestadio.netlify.app

- Solo accede la cuenta verificada Edison Aular (`80f063de-6eac-4f53-9e98-acadf481dc1c`). Sin vencimiento, según la última indicación del usuario.
- Se inicia sesión normalmente, se abre el evento en modo ensayo y se pulsa **Modo Light 2**.
- Publicación independiente con alias Netlify. No se publica esta rama en el dominio principal ni se fusiona con main.
- La restricción de cuenta se comprueba en middleware y al crear las cookies de sesión; no depende del nombre mostrado ni de parámetros de URL. Las páginas y API privadas no se almacenan en caché.
- Las mezclas del evento se guardan en `live-director/light2-beta/event-mixes`. Si no hay una mezcla beta, se lee la del sitio principal como punto de partida.
- Los arreglos del evento se guardan en `live-director/light2-beta/event-arrangements`. Los cambios fuera de eventos siguen siendo temporales.
- La beta no permite reemplazar stems ni persistir cambios en la canción original. Se mantienen los permisos propios del evento para editar su arreglo.
- Providencia usa los marcadores REAPER confirmados, compás 4/4 y desfase cero; las rejillas de clic calibradas se aplican en memoria. No hay migraciones ni cambios en canciones, perfiles o roles.
- Se incluyó la recuperación de sesión que ya existía en el checkout local principal; los archivos originales se mantuvieron intactos.

Despliegue verificado: `6adacfda32c34bf48e7ad09c`. La publicación principal permaneció en `6ad63f9f361cea6a78f905f0`.

## Validación

`npm run build`, `node scripts/test-light2-beta-access.mjs`, `node scripts/test-auth-session-bridge.mjs`, `node scripts/test-authenticated-fetch-recovery.mjs` y prueba en navegador con un evento real (15 stems, reproducción y pausa).

Se verificó también el enlace remoto: inicio de sesión propio, bloqueo de invitados y de API sin sesión, bloqueo de escrituras sobre canciones originales, 15 stems, primer marcador de Providencia en 12 s y reproducción/pausa sin errores. En WebKit se comprobó el salto a compás mientras siguen sonando los 15 stems, además del seek tras cerrar el editor. El modo Safari usa el cambio sincronizado al límite de sección; la preparación anticipada de Worker se reserva para navegadores que cumplen esa ruta exacta. Se corrigió la extracción de los estilos de los buses y el chequeo de artefactos detecta dependencias CSS/JS faltantes.

La prueba `scripts/test-light2-beta-browser.mjs` usa una sesión de QA privada en `.lab/` y admite `LIGHT2_QA_URL`. Los tokens no se versionan ni se incluyen en la publicación; la sesión de QA se revoca al terminar.

El entorno de compilación se mantiene fuera de iCloud en `~/.cache/livedirector/light2-beta-build`; el laboratorio conserva su checkout y su puerto 4322. No iniciar Astro dev dentro del entorno de compilación antes de publicar: el adaptador limpia los artefactos SSR al arrancar. Compilar después de detener dev y desplegar el resultado con un alias, sin `--prod`.
