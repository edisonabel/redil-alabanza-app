# Mapa Exhaustivo de la Codebase - ALABANZA

## 1. Resumen ejecutivo

ALABANZA es una aplicacion web de gestion para un ministerio de alabanza. El proyecto combina:

- `Astro 5` como framework principal y router basado en archivos.
- `React 19` para islas interactivas puntuales.
- `Tailwind CSS v4` para estilos.
- `Supabase` para auth, base de datos, storage y funciones edge.
- `Netlify` como target de despliegue SSR.
- `PWA` con manifest, service worker y soporte de notificaciones push.
- `Cloudflare R2` para subida/borrado de archivos de audio.

La app se organiza en cuatro dominios de negocio principales:

- `Repertorio`: catalogo de canciones, recursos, ChordPro, voces, MP3 y setlists.
- `Programacion`: calendario de eventos, asignaciones, series y detalle por servicio.
- `Equipo`: gestion de perfiles, roles maestros y plantillas de equipo.
- `Ensayo/Herramientas`: reproductor, metronomo, voces, ChordPro, modo director y utilidades para musicos.

## 2. Vista general del repositorio

### Directorios clave del workspace

| Ruta | Estado | Que contiene |
| --- | --- | --- |
| `src/` | runtime principal | paginas, componentes, layout, middleware, servicios y utilidades |
| `public/` | runtime publico | fuentes, iconos, backgrounds, manifest, service worker y worker del metronomo |
| `supabase/` | backend complementario | edge functions para notificaciones |
| `migrations/` | base de datos | historial de migraciones SQL del dominio |
| `scripts/` | operacion | script de migracion de MP3 desde Google Sheets |
| `dist/` | generado | build compilado |
| `.astro/` | generado | artefactos de Astro |
| `.netlify/` | generado/tooling | artefactos locales de Netlify |
| `node_modules/` | generado | dependencias instaladas |
| `.vscode/` | tooling | configuracion del editor |
| `.agent/`, `.agents/`, `.claude/`, `.trae/`, `.windsurf/` | tooling local | automatizaciones, skills, worktrees y metadata de asistentes/editor |

### Conteo rapido de areas

- `src/`: 79 archivos / 16 carpetas
- `public/`: 19 archivos / 3 carpetas
- `supabase/`: 2 archivos / 3 carpetas
- `migrations/`: 22 archivos
- `scripts/`: 1 archivo
- `dist/`: 81 archivos generados
- `node_modules/`: 71k+ archivos generados

## 3. Arquitectura de alto nivel

### Flujo de request

1. La request entra por Astro SSR.
2. `src/middleware.js` resuelve la sesion con cookies `sb-access-token` y `sb-refresh-token`.
3. El middleware expone `Astro.locals.user` y `Astro.locals.perfil`.
4. Cada pagina Astro hace SSR de datos iniciales desde Supabase.
5. Los componentes React se hidratan con `client:load`, `client:idle` o `client:only`.
6. Las acciones mutantes van por:
   - cliente Supabase directo, o
   - endpoints `src/pages/api/*`, o
   - edge functions de Supabase.

### Capas internas

- `Paginas Astro`: shell SSR, auth gate y carga inicial.
- `Islas React`: interacciones complejas como calendario, modales, paneles y ensayo.
- `Lib/Services`: utilidades puras, integracion Supabase, branding, audio, notificaciones.
- `SQL + Edge Functions`: modelo de datos, RLS y notificaciones transaccionales.

### Flujos transversales

- `Auth`: middleware + cookies Supabase + paginas protegidas.
- `Branding`: `Layout.astro` consulta configuracion semantica de colores desde Supabase.
- `Audio`: `AudioSessionService` coordina foco de audio entre reproductores y metronomo.
- `Push`: `BotonNotificaciones`, `NotificationBell`, `/api/send-push`, service worker y motor de entrega.
- `Onboarding`: sistema `driver.js` con persistencia en `perfiles.tour_completado`.

## 4. Stack y configuracion base

### Archivos raiz de configuracion

- `package.json`
  - Define scripts `dev`, `build`, `preview`, `astro`.
  - Dependencias principales: Astro, React, Supabase, Tailwind, Netlify adapter, AWS SDK, web-push, framer-motion, driver.js.
- `astro.config.mjs`
  - `output: 'server'`
  - sitio `https://alabanzaredilestadio.com`
  - integra `@vite-pwa/astro`, `@astrojs/react`, `@astrojs/netlify`, `@tailwindcss/vite`
  - registra alias `src/lib/react-jsx-runtime-shim.js`
- `tailwind.config.mjs`
  - define colores semanticos basados en CSS variables de branding
- `tsconfig.json`
  - extiende `astro/tsconfigs/strict`
  - excluye `src/archivos_legacy` y `dist`
- `netlify.toml`
  - build con `npm run build`
  - cache headers para fonts, assets Astro, imagenes, manifest y service worker
- `.env.example`
  - documenta variables de Supabase, R2, VAPID y codigo de registro

## 5. Middleware, layout y shell global

### `src/middleware.js`

Responsabilidad:

- protege rutas privadas: `/`, `/admin`, `/programacion`, `/repertorio`, `/perfil`, `/equipo`, `/herramientas`, `/configuracion`, `/ensayo`, `/panel`
- refresca sesion usando `refreshSession`
- setea/limpia cookies de auth
- resuelve `locals.user` y `locals.perfil`
- ignora assets estaticos, `_astro`, `sw.js` y archivos publicos

### `src/layouts/Layout.astro`

Es el shell global de casi toda la app.

Incluye:

- `src/styles/global.css`
- `BottomNav.astro`
- `ProPlayerGlobal.astro`
- `VocesModalGlobal.astro`
- `EnsayoGlobal.astro`
- `NotificationBell.jsx`
- `ClientRouter` para view transitions
- gestion de tema claro/oscuro con `localStorage`
- branding SSR dinamico desde `src/lib/branding.js`
- reglas para standalone PWA, safe areas y transiciones premium

Rutas que no usan este layout de forma tradicional:

- `src/pages/ensayo/[id].astro`
  - usa shell propio, aunque reinyecta audio global y branding

### Componentes shell transversales

- `src/components/BottomNav.astro`
  - navegacion inferior persistente
  - visibilidad condicionada por rol admin
  - prefetch por hover/touch y estados activos con eventos Astro
- `src/components/ProPlayerGlobal.astro`
  - reproductor de audio global en modal
  - soporta Google Drive via `/api/audio`
  - waveform, seek, loop A/B, artwork, haptics basicas
- `src/components/VocesModalGlobal.astro`
  - modal global para elegir pista de voces
  - dispara evento `play-pro-audio` hacia el reproductor global
- `src/components/EnsayoGlobal.astro`
  - wrapper Astro para `EnsayoGlobalIsland.jsx`

## 6. Mapa de rutas (`src/pages`)

### Rutas de app

- `src/pages/index.astro` -> `/`
  - dashboard principal
  - requiere auth
  - carga perfil, eventos especiales, cumpleaneros, roles, eventos y conteo de playlist
  - monta `DashboardInicio`, `DashboardShortcuts`, `ModalDetalle`, `OnboardingRoot`

- `src/pages/login.astro` -> `/login`
  - login y registro en la misma pantalla
  - valida `REGISTRATION_CODE` via `/api/verify-access-code`
  - permite seleccionar roles al registro
  - sube avatar inicial al bucket `avatars`
  - usa `supabase.auth.signInWithPassword` y `supabase.auth.signUp`

- `src/pages/reset-password.astro` -> `/reset-password`
  - flujo de recuperacion con token hash de Supabase
  - establece sesion temporal y actualiza password

- `src/pages/repertorio.astro` -> `/repertorio`
  - catalogo de canciones SSR
  - filtra por voz, categoria y tema
  - renderiza cards Astro con `CardCancion`
  - mantiene registro global de `chordpro` y `section_markers`
  - contiene logica cliente larga para setlists, seleccion multiple, copiado de enlaces y guardado en playlists
  - integra `OnboardingRoot`

- `src/pages/admin.astro` -> `/admin`
  - superficie de administracion del repertorio
  - monta `AdminRepertorio`

- `src/pages/programacion.astro` -> `/programacion`
  - calendario mensual SSR
  - carga eventos iniciales, roles, flag admin y si hay mas eventos
  - monta `CalendarioGrid`, `ModalEvento`, `ModalDetalle`, `ModalSerie`, `OnboardingRoot`

- `src/pages/equipo.astro` -> `/equipo`
  - pagina grande en Astro + JS inline
  - gestiona musicos, roles maestros, perfiles y plantillas/equipos
  - lee `roles`, `perfiles`, `perfil_roles`, `equipos`, `equipo_integrantes`
  - permite crear equipos, editar roles, borrar perfiles y asignar integrantes

- `src/pages/perfil.astro` -> `/perfil`
  - autoservicio del usuario
  - edicion de datos personales
  - avatar con cropper
  - gestion de ausencias
  - cambio de password y logout
  - suscripcion push con `BotonNotificaciones`
  - integra `OnboardingRoot`

- `src/pages/herramientas.astro` -> `/herramientas`
  - landing de utilidades del musico
  - enlaza a metronomo, calentamiento vocal, capo y ChordPro

- `src/pages/configuracion.astro` -> `/configuracion`
  - solo admins
  - panel de branding semantico
  - admin de push manual
  - modo experto

- `src/pages/panel.astro` -> `/panel`
  - dashboard analitico/operativo
  - calcula cobertura de recursos, gaps de perfiles, eventos por periodo, roles con baja cobertura y uso del repertorio
  - alimenta `PanelControl.jsx`

- `src/pages/ensayo/[id].astro` -> `/ensayo/:id`
  - experiencia de ensayo por evento
  - shell especializado con branding, audio y parsing ChordPro
  - carga perfil del usuario, evento, asignaciones, playlist, playlist voice assignments y canciones
  - monta `EnsayoHub.jsx`
  - contiene heuristicas para reparar/parsear ChordPro corrupto

### Rutas de herramientas

- `src/pages/herramientas/metronomo.astro` -> `/herramientas/metronomo`
  - UI del metronomo pro
  - usa `MetronomeEngine` y `ScreenWakeLockService`

- `src/pages/herramientas/calentamiento-vocal.astro` -> `/herramientas/calentamiento-vocal`
  - carga ejercicios desde Google Sheets CSV
  - experiencia swipable/mobile

- `src/pages/herramientas/capo.astro` -> `/herramientas/capo`
  - calculadora/guia de capotraste

- `src/pages/herramientas/chordpro.astro` -> `/herramientas/chordpro`
  - editor/transpositor ChordPro
  - puede cargar una cancion desde Supabase
  - monta `ChordProPreview`

- `src/pages/herramientas/chordpro-print.astro` -> `/herramientas/chordpro-print`
  - workspace de impresion/exportacion de ChordPro
  - monta `ChordProPrintWorkspace`

### Rutas API Astro

- `src/pages/api/audio.ts`
  - proxy/stream de audio de Google Drive a traves de `id`
- `src/pages/api/mp3-proxy.ts`
  - proxy alterno para URLs de Google Drive
- `src/pages/api/get-upload-url.js`
  - genera URL firmada de R2 para upload
- `src/pages/api/delete-upload.js`
  - borra objeto en R2
- `src/pages/api/send-push.js`
  - endpoint server para push/email/in-app via motor de notificaciones
- `src/pages/api/verify-access-code.js`
  - valida el codigo de registro
- `src/pages/api/auth/logout.ts`
  - limpia cookies de auth

## 7. Mapa de componentes (`src/components`)

### Componentes Astro base

- `AdminRepertorio.jsx`
  - modulo React mas grande del area admin
  - CRUD de canciones
  - upload de archivos con `/api/get-upload-url`
  - borrado/cleanup con `/api/delete-upload`
  - integra `AudioSessionService`

- `BottomNav.astro`
  - navegacion global inferior

- `BuscadorPredictivo.astro`
  - input de busqueda para repertorio

- `CardCancion.astro`
  - card individual de cancion
  - expone acciones sobre audio, recursos, voces y setlist

- `EnsayoGlobal.astro`
  - wrapper Astro para isla global de ensayo

- `ProPlayerGlobal.astro`
  - reproductor global persistente

- `VocesModalGlobal.astro`
  - selector global de pistas vocales

### Sistema de onboarding

- `src/components/onboarding/OnboardingRoot.tsx`
  - entrypoint React del onboarding
- `src/components/onboarding/useOnboarding.ts`
  - hook con persistencia Supabase
- `src/components/onboarding/onboardingSteps.ts`
  - catalogo de pasos por pagina: `home`, `repertorio`, `programacion`, `perfil`
- `src/components/onboarding/WelcomeOnboardingModal.tsx`
  - modal inicial
- `src/components/onboarding/onboarding.css`
  - estilos del tour

### Componentes React por dominio

#### Dashboard / home

- `DashboardInicio.jsx`
  - hero/dashboard con proximos servicios
- `DashboardShortcuts.jsx`
  - accesos rapidos, campana y acciones
- `ModalDetalle.jsx`
  - detalle de evento/playlist/asignaciones

#### Programacion

- `CalendarioGrid.jsx`
  - calendario principal
  - lectura/edicion de eventos
  - integra `event-display`, `roster-utils` y Supabase
- `ModalEvento.jsx`
  - crear/editar/borrar eventos
  - integra `RosterManager`
- `ModalSerie.jsx`
  - generador de series recurrentes
- `RosterManager.jsx`
  - asignaciones por rol, equipos plantilla, ausencias y restricciones de moderador

#### Perfil / notificaciones

- `BotonNotificaciones.jsx`
  - registrar/eliminar suscripcion push del navegador
- `NotificationBell.jsx`
  - centro de notificaciones in-app

#### Ensayo / director

- `EnsayoGlobalIsland.jsx`
  - isla React montada globalmente
- `EnsayoHub.jsx`
  - coordinador principal de la experiencia de ensayo
- `EnsayoPersonalView.jsx`
  - vista personalizada por rol/voz
- `ModoEnsayo.jsx`
  - modo ensayo clasico
- `ModoEnsayoCompacto.jsx`
  - reproductor/ensayo compacto con metronomo, wake lock y audio session
- `ModoLiveDirector.jsx`
  - modo director en vivo

#### ChordPro / hojas

- `ChordProPreview.tsx`
  - render de preview ChordPro
- `ChordProPrintWorkspace.tsx`
  - workspace de impresion/export
- `SongSheet.tsx`
  - renderer base de hojas/cifras

#### Administracion / configuracion

- `PanelBranding.jsx`
  - UI para editar branding semantico
- `PanelAdminPush.jsx`
  - envio manual de notificaciones desde admin
- `PanelModoExperto.jsx`
  - modo experto para operaciones directas
- `PanelControl.jsx`
  - visualizacion del dashboard analitico del `/panel`

## 8. Libs, servicios y utilidades (`src/lib`, `src/services`, `src/utils`)

### Cliente y auth

- `src/lib/supabase.js`
  - cliente browser de Supabase
  - sincroniza auth/cookies
  - helpers para `uploadAvatarAtomic`

### Branding y theming

- `src/lib/branding.js`
  - busca branding en tablas candidatas:
    - `configuracion_app`
    - `configuracion`
    - `branding_config`
  - soporta service role si existe

### Eventos y compatibilidad

- `src/lib/event-display.js`
  - helpers para componer titulo/tema/predicador
- `src/lib/predicador-compat.js`
  - fallback si la columna `eventos.predicador` no existe aun

### Roster

- `src/lib/roster-utils.js`
  - normalizacion de asignaciones y roles de voz

### Notificaciones

- `src/lib/server/notification-delivery.js`
  - motor server-side para:
    - insertar notificaciones in-app
    - enviar emails
    - enviar push web
    - auditar entregas en `notification_delivery_audit`
- `src/lib/cron-cumpleanios.js`
  - recordatorio de cumpleanos usando el motor anterior

### Audio

- `src/services/AudioSessionService.ts`
  - arbitro de audio global
  - media session
  - silent loop para mantener el contexto activo
  - recuperacion de audio al volver a foreground
- `src/services/MetronomeEngine.ts`
  - motor Web Audio + worker
  - scheduler de beats y eventos
- `src/services/ScreenWakeLockService.ts`
  - gestiona `navigator.wakeLock`

### Utilidades

- `src/utils/parseChordProToBlocks.ts`
  - parser tipado de ChordPro
- `src/utils/safeImageProcessor.ts`
  - saneamiento de imagen para cropper
- `src/lib/react-jsx-runtime-shim.js`
  - shim usado por Vite/Astro para `react/jsx-runtime`

## 9. Modelo de datos y tablas clave

### Entidades principales

- `perfiles`
  - usuario, nombre, avatar, telefono, fecha_nacimiento, admin, tour completado
- `roles`
  - catalogo maestro de instrumentos/funciones
- `perfil_roles`
  - roles maestros por perfil
- `eventos`
  - servicios/eventos del calendario
- `asignaciones`
  - roster por evento y rol
- `equipos`
  - plantillas/equipos guardados
- `equipo_integrantes`
  - integrantes de una plantilla con `rol_maestro`
- `canciones`
  - catalogo musical, recursos y ChordPro
- `playlists`
  - playlist por evento
- `playlist_canciones`
  - canciones ordenadas por playlist
- `playlist_voice_assignments`
  - mapa JSON de asignaciones de voces por playlist/evento
- `ausencias`
  - indisponibilidades por perfil
- `notificaciones`
  - inbox in-app
- `suscripciones_push`
  - endpoints web push por usuario
- `notification_delivery_audit`
  - auditoria de entregas
- `eventos_especiales`
  - feed especial mostrado en inicio

### Buckets / storage

- `avatars`
  - fotos de perfil publicas
- `Cloudflare R2`
  - subida de MP3/recursos via URLs firmadas

## 10. Historial de migraciones (`migrations/`)

- `001_playlists.sql`
  - crea `canciones`, `playlists`, `playlist_canciones`, trigger `updated_at` y RLS basica
- `002_ausencias.sql`
  - crea `ausencias`
- `002_ausencias_y_perfil.sql`
  - agrega `tonalidad_voz` y recrea `ausencias`
- `003_storage_avatars.sql`
  - bucket `avatars` y politicas iniciales
- `004_parche_final.sql`
  - endurece bucket/columnas de avatar
- `005_fecha_nacimiento.sql`
  - agrega `fecha_nacimiento`
- `006_rls_policies.sql`
  - RLS para `eventos`, `asignaciones`, `perfiles`
- `007_serie_id.sql`
  - agrega `serie_id` a `eventos`
- `007_whatsapp_perfil.sql`
  - agrega `telefono` y trigger de alta
- `008_rol_registration_trigger.sql`
  - trigger de alta con carga de roles desde metadata
- `009_rls_moderadores_asignaciones.sql`
  - habilita moderadores por evento y RPC `apply_equipo_template`
- `009_tour_completado.sql`
  - agrega `tour_completado`
- `010_rls_roles_perfil.sql`
  - RLS de lectura para `roles` y `perfil_roles`
- `011_add_caja_role.sql`
  - agrega rol `caja`
- `012_avatar_url_trigger_fix.sql`
  - unifica `avatar_url` y refuerza trigger de alta
- `013_notificacion_asignacion_copy.sql`
  - trigger de notificacion por asignacion
- `014_section_markers_canciones.sql`
  - agrega `section_markers` a canciones
- `015_playlist_voice_assignments.sql`
  - crea tabla de asignaciones de voces por playlist
- `016_push_subscriptions_alignment.sql`
  - agrega `endpoint`, `updated_at`, dedup e indices en `suscripciones_push`
- `017_asignaciones_unique_guard.sql`
  - dedup e indice unico de asignaciones
- `018_notification_delivery_audit.sql`
  - crea tabla de auditoria de entrega
- `019_eventos_predicador.sql`
  - agrega columna `predicador`

## 11. Supabase edge functions (`supabase/functions`)

- `notify-assignment/index.ts`
  - recibe webhook/manual payload por `perfil_id`
  - envia email via `send-notification-email`
  - envia web push
  - escribe auditoria en `notification_delivery_audit`

- `send-notification-email/index.ts`
  - usa `Resend`
  - arma HTML del correo
  - resuelve perfil/email
  - audita estado de envio

## 12. Assets y runtime publico (`public/`)

### Archivos clave

- `manifest.webmanifest`
  - manifest PWA servido al cliente
- `push-sw.js`
  - service worker de notificaciones push
- `workers/metronomeWorker.js`
  - worker del scheduler del metronomo
- `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`
  - iconografia PWA
- `LOGO REDIL.png`, `LOGO REDIL LIGHT.png`
  - logos principal/dark-light
- `afinacion-bg.webp`, `calentamiento-bg.webp`, `repertorio-bg.webp`
  - fondos visuales
- `fonts/redil/*`
  - fuentes `adineue` y `Modius`

## 13. Scripts operativos y mantenimiento fuera de `src/`

### Scripts utiles y relativamente estructurados

- `scripts/migrarMp3.js`
  - migra MP3 desde Google Sheets hacia `canciones.mp3`
- `generate_icons.mjs`
  - generacion de iconos
- `apply_migration_009.cjs`
- `apply_migration_010.cjs`
- `apply_migration_015.cjs`
  - wrappers puntuales para aplicar migraciones
- `check_schema.js`, `check_schema.mjs`, `test_schema.mjs`
  - validaciones de esquema
- `test_eventos.mjs`, `test_equipo_query.mjs`, `test_setlist_query.js`, `tmp_query_song.mjs`
  - pruebas puntuales sobre queries

### SQL raiz complementario

- `add_nuevos_roles.sql`
- `infraestructura_configuracion_app.sql`
- `infraestructura_notificaciones.sql`
- `seed_banda.sql`
- `seed_equipo.sql`
- `upgrade.sql`

Estos parecen complementar o preparar infraestructura fuera del folder `migrations/`.

### Scripts claramente ad hoc / one-shot

Los siguientes nombres indican reparaciones manuales, ajustes de layout o pruebas temporales:

- `debug_lines.cjs`
- `fix_badge.cjs`
- `fix_detalle_badges.cjs`
- `fix_detalle_badges2.cjs`
- `fix_detalle_layout_lines.cjs`
- `fix_layout_padding.cjs`
- `fix_lista_card.cjs`
- `fix_lista_card2.cjs`
- `fix_modal_mobile.cjs`
- `fix_modal_mobile_layout.cjs`
- `fix_perfil.cjs`
- `fix_policies.cjs`
- `fix_programacion_btn.cjs`
- `fix_song_card_layout_final.cjs`
- `fix_tools.cjs`
- `inspect_policies_asignaciones.cjs`
- `remove_logout.cjs`
- `update_colors.cjs`

### Artefactos temporales o de depuracion

- `.tmp-dev-err.log`
- `.tmp-dev-out.log`
- `.tmp-supa-debug.cjs`
- `astro_errors.txt`
- `old_history.txt`
- `schema.json`
- `script_test.js`
- `server.log`
- `test.js`
- `tmp-dev-log.txt`
- `tmp_chordpro_test.txt`
- `tmp_modoensayo.txt`
- `tmp_parse_test.cjs`
- `tmp_repertorio_51f508e.astro`

## 14. Legacy y zonas especiales

- `src/archivos_legacy/`
  - `old_programacion.astro`
  - `old_programacion2.astro`
  - `old_programacion_utf8.astro`
  - conserva una version antigua de Programacion en Astro + JS inline
  - esta excluido por `tsconfig.json`

## 15. Hotspots tecnicos (archivos mas densos)

Estos son los puntos mas grandes o con mas riesgo de acoplamiento:

- `src/components/react/ModoEnsayoCompacto.jsx` (~2081 lineas)
- `src/components/AdminRepertorio.jsx` (~1753 lineas)
- `src/components/react/ModoLiveDirector.jsx` (~1528 lineas)
- `src/pages/equipo.astro` (~1302 lineas)
- `src/components/react/EnsayoHub.jsx` (~1263 lineas)
- `src/pages/repertorio.astro` (~1170 lineas)
- `src/components/react/CalendarioGrid.jsx` (~1048 lineas)
- `src/pages/perfil.astro` (~952 lineas)
- `src/pages/herramientas/chordpro.astro` (~845 lineas)
- `src/components/ProPlayerGlobal.astro` (~778 lineas)
- `src/components/react/DashboardInicio.jsx` (~757 lineas)
- `src/pages/login.astro` (~734 lineas)
- `src/pages/panel.astro` (~727 lineas)
- `src/layouts/Layout.astro` (~659 lineas)
- `src/components/react/SongSheet.tsx` (~663 lineas)
- `src/lib/server/notification-delivery.js` (~590 lineas)

Interpretacion:

- la app mezcla una parte importante de logica de negocio dentro de paginas Astro grandes
- el dominio de ensayo/audio esta especialmente concentrado en pocos archivos muy grandes
- la capa de notificaciones ya tiene complejidad de backend real

## 16. Flujos funcionales clave

### Auth y sesion

`login.astro` -> Supabase Auth -> cookies -> `middleware.js` -> `Astro.locals.user/perfil`

### Setlist

`repertorio.astro` -> seleccion de canciones -> `playlists` + `playlist_canciones` -> `programacion` y `ensayo/[id]`

### Ensayo

`ensayo/[id].astro` -> carga playlist/canciones -> `EnsayoHub` -> `ModoEnsayoCompacto` / `ModoLiveDirector` -> `AudioSessionService` + `MetronomeEngine`

### Branding

`configuracion.astro` + `PanelBranding.jsx` -> Supabase tabla de branding -> `Layout.astro` -> CSS variables globales

### Notificaciones

`PanelAdminPush.jsx` o triggers de dominio -> `/api/send-push` o edge functions -> `notification-delivery.js` -> in-app + email + push + auditoria

### Registro de usuario

`login.astro` -> verificacion de codigo -> `supabase.auth.signUp` con metadata -> trigger SQL `handle_new_user()` -> `perfiles` + `perfil_roles`

## 17. Conclusiones practicas para navegar la codebase

Si alguien nuevo entra al repo, el orden mas util para entenderlo es:

1. `package.json`
2. `astro.config.mjs`
3. `src/middleware.js`
4. `src/layouts/Layout.astro`
5. `src/pages/index.astro`
6. `src/pages/programacion.astro`
7. `src/pages/repertorio.astro`
8. `src/pages/ensayo/[id].astro`
9. `src/lib/supabase.js`
10. `src/lib/server/notification-delivery.js`
11. `migrations/001_playlists.sql` hasta `019_eventos_predicador.sql`

En terminos de producto, el corazon real del sistema vive en:

- auth + middleware
- programacion/calendario
- repertorio/playlists
- ensayo/audio
- perfiles/roles/asignaciones
- notificaciones/branding

