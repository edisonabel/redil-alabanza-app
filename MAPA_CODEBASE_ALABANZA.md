# Mapa Exhaustivo de la Codebase - ALABANZA

_Actualizado contra el arbol real del repositorio el 2026-04-05._

## 1. Resumen ejecutivo

ALABANZA es una aplicacion web SSR para la gestion de un ministerio de alabanza. El proyecto combina:

- `Astro 5` como framework principal y router basado en archivos.
- `React 19` para islas interactivas y UIs complejas.
- `Tailwind CSS v4` con tokens semanticos basados en CSS variables.
- `Supabase` para auth, base de datos, RLS, RPCs y funciones edge.
- `Netlify` como target de despliegue SSR.
- `PWA` con manifest, service worker, cache selectiva y soporte de push web.
- `Cloudflare R2` para uploads/borrado de archivos.
- `Puppeteer` + `@react-pdf/renderer` para exportacion e impresion de hojas ChordPro.

Los dominios funcionales mas claros hoy son:

- `Repertorio`: catalogo de canciones, MP3, recursos, ChordPro, playlists y voces.
- `Programacion`: calendario, eventos, series, asignaciones, disponibilidad y predicacion.
- `Equipo`: perfiles, roles maestros, ausencias, equipos y roster.
- `Ensayo y herramientas`: reproductor, metronomo, capo, calentamiento vocal y modo director.
- `Notificaciones y operaciones`: push, email, inbox in-app, cron jobs, branding y paneles admin.

## 2. Vista general del repositorio

### Directorios clave del workspace

| Ruta | Estado | Que contiene |
| --- | --- | --- |
| `src/` | runtime principal | paginas, componentes, layout, middleware, servicios, utilidades y logica server |
| `public/` | runtime publico | fuentes, iconos, logos, fondos, manifest, push service worker y worker del metronomo |
| `supabase/` | backend complementario | config local de Supabase y funciones edge |
| `migrations/` | base de datos | historial SQL del dominio, cron bridges y guardas de integridad |
| `scripts/` | operacion | scripts estructurados de migracion y mantenimiento |
| `docs/` | documentacion interna | invariantes del flujo de impresion ChordPro |
| `dist/` | generado | build compilado |
| `.astro/` | generado | artefactos de Astro |
| `.netlify/` | generado/tooling | artefactos locales de Netlify |
| `node_modules/` | generado | dependencias instaladas |
| `.vscode/` | tooling | configuracion del editor |
| `.agent/`, `.agents/`, `.claude/`, `.trae/`, `.windsurf/` | tooling local | automatizaciones, skills, worktrees y metadata de asistentes/editor |

### Conteo rapido de areas

- `src/`: 104 archivos / 19 carpetas
- `src/pages/`: 34 archivos / 6 carpetas
- `src/pages/api/`: 16 archivos / 2 carpetas
- `src/components/`: 36 archivos / 3 carpetas
- `src/components/react/`: 23 archivos
- `public/`: 25 archivos / 3 carpetas
- `supabase/`: 4 archivos / 4 carpetas
- `migrations/`: 27 archivos
- `scripts/`: 3 archivos
- `docs/`: 1 archivo
- `dist/`: 96 archivos / 4 carpetas generadas

### Observacion importante

Aunque `scripts/` solo tiene 3 utilidades estructuradas, la raiz del repo sigue teniendo bastantes archivos `fix_*`, `test_*`, `tmp_*`, `apply_migration_*` y `.sql` complementarios. Es decir: la operacion real del proyecto todavia esta repartida entre `scripts/` y la raiz.

## 3. Arquitectura de alto nivel

### Flujo base de request

1. La request entra por Astro SSR.
2. `src/middleware.js` valida o refresca la sesion con cookies `sb-access-token` y `sb-refresh-token`.
3. El middleware expone `Astro.locals.user` y `Astro.locals.perfil`.
4. Cada pagina Astro hace SSR de los datos iniciales desde Supabase.
5. Las interacciones complejas se hidratan con islas React.
6. Las mutaciones pasan por una de estas vias:
   - cliente Supabase directo desde la UI,
   - rutas `src/pages/api/*`,
   - RPCs/SQL en Supabase,
   - funciones edge de Supabase.

### Capas internas

- `Paginas Astro`: shell SSR, auth gate, carga inicial y composicion general.
- `Islas React`: calendario, modales, paneles, notificaciones, ensayo, impresion y flujos complejos.
- `Lib/Services`: branding, audio, parsing ChordPro, notificaciones, ausencias y helpers de dominio.
- `SQL + cron + edge functions`: integridad de datos, RLS, programacion de jobs y entrega externa.

### Flujos transversales mas importantes

- `Auth`: middleware + cookies Supabase + paginas protegidas.
- `Branding`: `Layout.astro` resuelve colores semanticos desde Supabase y los expone como CSS vars.
- `Audio`: `AudioSessionService` arbitra el foco entre reproductor global, voces y metronomo.
- `Push/Email/In-app`: `push-subscription`, `send-push`, `notification-delivery.js`, service worker y auditoria.
- `Ausencias`: creacion/reconciliacion de ausencias con liberacion de asignaciones y avisos a liderazgo.
- `Asignaciones`: cola diferida para notificar solo el estado final despues de cambios de roster.
- `ChordPro print/PDF`: preview React, documento de impresion, ruta render y generacion server-side de PDF.
- `Onboarding`: `driver.js` con persistencia de progreso en `perfiles.tour_completado`.

## 4. Stack y configuracion base

### Archivos raiz de configuracion

- `package.json`
  - Scripts base: `dev`, `build`, `preview`, `astro`.
  - Dependencias clave: Astro, React, Supabase, Tailwind, Netlify adapter, AWS SDK, `web-push`, `driver.js`, `framer-motion`, `@react-pdf/renderer`, `puppeteer`, `pg`.
- `astro.config.mjs`
  - `output: 'server'`
  - `site: 'https://alabanzaredilestadio.com'`
  - integra `@vite-pwa/astro`, `@astrojs/react`, `@astrojs/netlify`, `@tailwindcss/vite`
  - define prefetch por hover
  - registra alias `src/lib/react-jsx-runtime-shim.js`
- `tailwind.config.mjs`
  - mapea colores semanticos a CSS variables: `background`, `surface`, `brand`, `action`, `danger`, `success`, `warning`, `info`, `accent`, `neutral`, `overlay` y colores por rol
- `tsconfig.json`
  - extiende `astro/tsconfigs/strict`
  - excluye `src/archivos_legacy` y `dist`
- `netlify.toml`
  - build con `npm run build`
  - cache headers para fuentes, assets Astro, imagenes, `sw.js` y `manifest.webmanifest`
- `.env.example`
  - documenta variables de Supabase, R2, VAPID y codigo de registro
- `supabase/config.toml`
  - configuracion local del proyecto Supabase

## 5. Middleware, layout y shell global

### `src/middleware.js`

Responsabilidad actual:

- protege rutas privadas: `/`, `/admin`, `/programacion`, `/repertorio`, `/perfil`, `/equipo`, `/herramientas`, `/configuracion`, `/ensayo`, `/panel`
- valida `sb-access-token`
- intenta `refreshSession()` con `sb-refresh-token` cuando hace falta
- setea o limpia cookies de auth
- expone `locals.user` y `locals.perfil`
- ignora assets estaticos, `/_astro`, `/assets`, `workbox-*`, `sw.js` y archivos publicos

### `src/layouts/Layout.astro`

Es el shell principal de la app.

Incluye:

- `src/styles/global.css`
- `BottomNav.astro`
- `ProPlayerGlobal.astro`
- `VocesModalGlobal.astro`
- `EnsayoGlobal.astro`
- `NotificationBell.jsx`
- `ClientRouter` para view transitions
- gestor de tema light/dark con `localStorage` y sync con `prefers-color-scheme`
- branding SSR dinamico desde `src/lib/branding.js`
- cache bust explicito de branding via cookie/header/query param
- preloads de fuentes y soporte para standalone PWA / boot splash

Decisiones de shell visibles hoy:

- oculta `BottomNav` en `/admin`
- oculta `BottomNav` en `/herramientas/chordpro-print`
- mantiene audio global y modales transversales en casi toda la app

### Componentes shell transversales

- `src/components/BottomNav.astro`
  - navegacion inferior persistente
  - estados activos y visibilidad condicional
- `src/components/ProPlayerGlobal.astro`
  - reproductor global persistente
  - integra proxies de Google Drive, waveform, seek, loop A/B y control de foco
- `src/components/VocesModalGlobal.astro`
  - modal global para elegir pista de voces
- `src/components/EnsayoGlobal.astro`
  - wrapper Astro para la isla global de ensayo

## 6. Mapa de rutas (`src/pages`)

### Rutas de app

- `src/pages/index.astro` -> `/`
  - dashboard principal
  - requiere auth
  - carga perfil, eventos especiales, cumpleaneros, roles, eventos y conteos
  - monta `DashboardInicio`, `DashboardShortcuts`, `ModalDetalle` y `OnboardingRoot`

- `src/pages/login.astro` -> `/login`
  - login y registro
  - valida `REGISTRATION_CODE` via `/api/verify-access-code`
  - permite seleccion de roles al registrarse
  - sube avatar inicial y crea sesion Supabase

- `src/pages/reset-password.astro` -> `/reset-password`
  - flujo de recuperacion de password con token/hash de Supabase

- `src/pages/repertorio.astro` -> `/repertorio`
  - catalogo SSR de canciones
  - filtros de voz, categoria y tema
  - setlists, seleccion multiple, copiado de enlaces y guardado en playlists
  - integra `CardCancion`, `BuscadorPredictivo` y onboarding

- `src/pages/admin.astro` -> `/admin`
  - superficie admin del repertorio
  - monta `AdminRepertorio`

- `src/pages/programacion.astro` -> `/programacion`
  - calendario mensual SSR
  - carga ventana inicial de eventos de 2 meses
  - distingue admin, permiso de editar predicacion y si hay mas eventos para paginar
  - monta `CalendarioGrid`, `ModalEvento`, `ModalDetalle`, `ModalSerie` y `OnboardingRoot`

- `src/pages/equipo.astro` -> `/equipo`
  - gestion de perfiles, roles maestros, equipos, integrantes y ausencias
  - pagina Astro grande con mucho JS inline y logica operativa

- `src/pages/perfil.astro` -> `/perfil`
  - autoservicio del usuario
  - edicion de datos, avatar, ausencias, password y logout
  - integra `BotonNotificaciones` y onboarding

- `src/pages/herramientas.astro` -> `/herramientas`
  - landing de herramientas del musico

- `src/pages/configuracion.astro` -> `/configuracion`
  - panel admin de branding, push manual y modo experto

- `src/pages/panel.astro` -> `/panel`
  - dashboard analitico y operativo
  - cobertura de recursos, gaps de perfiles, eventos por periodo y uso del repertorio

- `src/pages/ensayo/[id].astro` -> `/ensayo/:id`
  - shell especializado de ensayo por evento
  - carga evento, asignaciones, playlist, voces y canciones
  - monta `EnsayoHub.jsx`

### Rutas de herramientas

- `src/pages/herramientas/metronomo.astro` -> `/herramientas/metronomo`
  - UI del metronomo pro
  - usa `MetronomeEngine` y `ScreenWakeLockService`

- `src/pages/herramientas/calentamiento-vocal.astro` -> `/herramientas/calentamiento-vocal`
  - carga ejercicios desde Google Sheets CSV
  - experiencia mobile/swipe

- `src/pages/herramientas/capo.astro` -> `/herramientas/capo`
  - calculadora/guia de capotraste

- `src/pages/herramientas/chordpro.astro` -> `/herramientas/chordpro`
  - editor, transpositor y visualizador ChordPro
  - puede cargar una cancion desde Supabase
  - monta `ChordProPreview`

- `src/pages/herramientas/chordpro-print.astro` -> `/herramientas/chordpro-print`
  - workspace de impresion/exportacion de hojas
  - monta `ChordProPrintWorkspace`

### Rutas de render internas

- `src/pages/render/chordpro-print-pdf.astro` -> `/render/chordpro-print-pdf`
  - documento intermedio para preview/print del PDF
  - recibe payload por token server-side o `clientToken`
  - monta `ChordProPdfDocument`

### Rutas API Astro

- `src/pages/api/absences.js` -> `/api/absences`
  - crea ausencias del usuario autenticado
  - libera asignaciones futuras afectadas
  - dispara notificaciones asociadas

- `src/pages/api/absences/reconcile.js` -> `/api/absences/reconcile`
  - reevalua ausencias futuras del usuario y reconcilia asignaciones existentes

- `src/pages/api/assignment-availability.js` -> `/api/assignment-availability`
  - valida disponibilidad de perfiles para un evento/fecha
  - comprueba permisos de gestion del usuario

- `src/pages/api/audio.ts` -> `/api/audio`
  - proxy robusto para audio de Google Drive por `id`
  - maneja headers `range`, cookies de confirmacion y respuestas HTML intermedias de Drive

- `src/pages/api/mp3-proxy.ts` -> `/api/mp3-proxy`
  - proxy mas simple para URLs de Google Drive via `src`

- `src/pages/api/chordpro-print-pdf.ts` -> `/api/chordpro-print-pdf`
  - genera PDF usando `puppeteer` local o `@sparticuz/chromium` en runtime serverless
  - usa tokens temporales de payload para render seguro

- `src/pages/api/get-upload-url.js` -> `/api/get-upload-url`
  - genera URL firmada de R2 para upload

- `src/pages/api/delete-upload.js` -> `/api/delete-upload`
  - elimina objetos R2 cuando la URL pertenece al namespace controlado por la app

- `src/pages/api/notify-assignment.js` -> `/api/notify-assignment`
  - encola notificaciones diferidas de asignacion
  - evita mandar avisos inmediatos por cada cambio de roster

- `src/pages/api/process-assignment-notifications.js` -> `/api/process-assignment-notifications`
  - procesa la cola vencida de asignaciones
  - pensado para ser invocado por cron interno/seguro

- `src/pages/api/notify-birthdays.js` -> `/api/notify-birthdays`
  - endpoint interno protegido por `x-notification-secret`
  - soporta `scope: daily | monthly`

- `src/pages/api/notify-service-reminders.js` -> `/api/notify-service-reminders`
  - endpoint interno protegido por `x-notification-secret`
  - soporta `scope: morning | saturday-night`

- `src/pages/api/push-subscription.js` -> `/api/push-subscription`
  - upsert/delete de suscripciones push del navegador autenticado

- `src/pages/api/send-push.js` -> `/api/send-push`
  - envio admin multicanal
  - soporta push, email e inbox in-app

- `src/pages/api/verify-access-code.js` -> `/api/verify-access-code`
  - valida el codigo de registro

- `src/pages/api/auth/logout.ts` -> `/api/auth/logout`
  - limpia cookies y cierra sesion

## 7. Mapa de componentes (`src/components`)

### Componentes Astro base

- `BottomNav.astro`
  - navegacion global inferior
- `BuscadorPredictivo.astro`
  - buscador de repertorio
- `CardCancion.astro`
  - card de cancion con acciones sobre audio, recursos, voces y setlists
- `EnsayoGlobal.astro`
  - wrapper Astro para la isla global de ensayo
- `ProPlayerGlobal.astro`
  - reproductor global persistente
- `VocesModalGlobal.astro`
  - selector global de pistas vocales

### Sistema de onboarding

- `src/components/onboarding/OnboardingRoot.tsx`
  - entrypoint React del tour
- `src/components/onboarding/useOnboarding.ts`
  - hook con persistencia Supabase
- `src/components/onboarding/onboardingSteps.ts`
  - catalogo de pasos por pagina
- `src/components/onboarding/WelcomeOnboardingModal.tsx`
  - modal inicial
- `src/components/onboarding/onboarding.css`
  - estilos del onboarding

### Componentes React por dominio

#### Dashboard / home

- `DashboardInicio.jsx`
  - hero principal, proximos servicios y resumenes
- `DashboardShortcuts.jsx`
  - accesos rapidos y acciones frecuentes
- `ModalDetalle.jsx`
  - detalle de evento/playlist/asignaciones

#### Programacion

- `CalendarioGrid.jsx`
  - calendario principal
  - lectura/edicion de eventos y asignaciones
- `ModalEvento.jsx`
  - crear/editar/borrar eventos
- `ModalSerie.jsx`
  - generar series recurrentes
- `RosterManager.jsx`
  - asignaciones por rol, equipos plantilla, ausencias y restricciones de moderador

#### Perfil / notificaciones

- `BotonNotificaciones.jsx`
  - registrar o eliminar la suscripcion push del navegador
- `NotificationBell.jsx`
  - centro de notificaciones in-app

#### Ensayo / director

- `EnsayoGlobalIsland.jsx`
  - isla global montada en el shell
- `EnsayoHub.jsx`
  - coordinador principal de la experiencia de ensayo
- `EnsayoPersonalView.jsx`
  - vista por rol/voz
- `ModoEnsayo.jsx`
  - modo ensayo clasico
- `ModoEnsayoCompacto.jsx`
  - experiencia compacta con metronomo, wake lock y audio session
- `ModoLiveDirector.jsx`
  - modo director en vivo

#### ChordPro / hojas / PDF

- `ChordProPreview.tsx`
  - render de preview ChordPro
- `ChordProPrintWorkspace.tsx`
  - workspace de impresion/exportacion
- `ChordProPdfDocument.tsx`
  - documento React para la ruta de render e impresion en navegador
- `src/components/pdf/ChordProPdfFile.tsx`
  - documento `@react-pdf/renderer` para exportacion server-side
- `SongSheet.tsx`
  - renderer base de hojas/cifras y soporte de modos de visualizacion

#### Administracion / configuracion

- `AdminRepertorio.jsx`
  - modulo React mas grande del area admin
  - CRUD de canciones, uploads y cleanup remoto
- `PanelBranding.jsx`
  - edicion de branding semantico
- `PanelAdminPush.jsx`
  - envio manual de notificaciones
- `PanelModoExperto.jsx`
  - operaciones directas / modo experto
- `PanelControl.jsx`
  - dashboard analitico del `/panel`

## 8. Libs, servicios y utilidades (`src/lib`, `src/services`, `src/utils`)

### Cliente y auth

- `src/lib/supabase.js`
  - cliente browser de Supabase
  - sincroniza auth/cookies
  - helpers como `uploadAvatarAtomic`

### Branding y shell

- `src/lib/branding.js`
  - resuelve branding desde tablas candidatas de configuracion
- `src/lib/open-branded-tab.js`
  - abre pestañas auxiliares con shell visual de marca
- `src/lib/react-jsx-runtime-shim.js`
  - shim para `react/jsx-runtime` usado por Vite/Astro

### Eventos, roster y compatibilidad

- `src/lib/event-display.js`
  - helpers para componer titulo, tema y predicador
- `src/lib/event-slug.js`
  - slugs de fecha/evento con timezone Bogota
- `src/lib/predicador-compat.js`
  - fallback si `eventos.predicador` aun no existe
- `src/lib/roster-utils.js`
  - normalizacion de asignaciones y roles de voz

### Audio

- `src/lib/audio-playback.js`
  - normalizacion de URLs de audio
  - deteccion de Google Drive, proxies internos y fuentes reproducibles
- `src/services/AudioSessionService.ts`
  - arbitro de audio global
  - media session, foco y recuperacion al volver a foreground
- `src/services/MetronomeEngine.ts`
  - scheduler Web Audio + worker
- `src/services/ScreenWakeLockService.ts`
  - wrapper de `navigator.wakeLock`

### Notificaciones y recordatorios

- `src/lib/server/notification-delivery.js`
  - motor server-side de entrega
  - inserta notificaciones in-app
  - envia emails y push web
  - audita resultados
- `src/lib/cron-cumpleanios.js`
  - logica diaria/mensual de cumpleanos
- `src/lib/service-reminder-notifications.js`
  - recordatorios de servicio por ventanas de tiempo
- `src/lib/server/assignment-notification-queue.js`
  - cola diferida de notificaciones de asignacion
  - reagrupa cambios y entrega el estado final

### Ausencias

- `src/lib/server/absence-management.js`
  - crea ausencias
  - reconcilia asignaciones futuras
  - libera roles afectados
  - notifica a liderazgo

### ChordPro, print y PDF

- `src/lib/chordproPdfLayout.ts`
  - planificacion/layout de bloques para PDF
- `src/lib/chordproPdfPayload.ts`
  - normalizacion tipada del payload de impresion
- `src/lib/chordproPdfPayloadStore.ts`
  - store temporal en disco para payloads server-side
- `src/lib/chordproPdfBrowserStore.ts`
  - store browser-side para payloads de preview/print

### Utilidades generales

- `src/utils/inferChordProTone.ts`
  - inferencia de tonalidad
- `src/utils/parseChordProSemantic.ts`
  - parser semantico
- `src/utils/parseChordProToBlocks.ts`
  - parser tipado a bloques
- `src/utils/resolveSongSheetSemanticBlocks.ts`
  - resolucion de bloques para render de hoja
- `src/utils/safeImageProcessor.ts`
  - saneamiento de imagen para cropper/avatar

## 9. Modelo de datos y entidades clave

### Entidades principales

- `perfiles`
  - usuario, nombre, avatar, telefono, fecha_nacimiento, flags admin y onboarding
- `roles`
  - catalogo maestro de funciones e instrumentos
- `perfil_roles`
  - relacion perfil <-> roles
- `eventos`
  - servicios/eventos del calendario
- `asignaciones`
  - roster por evento y rol
- `ausencias`
  - indisponibilidades por perfil
- `equipos`
  - plantillas/equipos guardados
- `equipo_integrantes`
  - integrantes de un equipo con rol maestro
- `canciones`
  - catalogo musical, recursos, MP3 y ChordPro
- `playlists`
  - playlist por evento
- `playlist_canciones`
  - canciones ordenadas por playlist
- `playlist_voice_assignments`
  - mapa de asignaciones de voces por playlist/evento
- `notificaciones`
  - inbox in-app
- `suscripciones_push`
  - endpoints push por usuario/dispositivo
- `notification_delivery_audit`
  - auditoria de entregas
- `assignment_notification_queue`
  - cola diferida de avisos por asignacion
- `eventos_especiales`
  - feed especial del inicio

### RPCs y helpers de base de datos visibles en la app

- `apply_equipo_template`
  - aplicacion de equipos plantilla a un evento
- `has_sermon_edit_role`
  - permiso especial para editar `tema_predicacion` / `predicador`
- `update_evento_tema`
  - RPC para actualizar tema de predicacion y predicador

### Buckets, storage y secretos

- `avatars`
  - bucket de fotos de perfil
- `Cloudflare R2`
  - subida/borrado de MP3 y otros recursos
- `Vault secrets`
  - `public_site_url`
  - `notification_function_secret`

## 10. Historial de migraciones (`migrations/`)

- `001_playlists.sql`
  - crea `canciones`, `playlists`, `playlist_canciones`, trigger `updated_at` y RLS base
- `002_ausencias.sql`
  - crea `ausencias`
- `002_ausencias_y_perfil.sql`
  - agrega `tonalidad_voz` y ajusta `ausencias`
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
  - trigger de alta con roles desde metadata
- `009_rls_moderadores_asignaciones.sql`
  - moderadores por evento y RPC `apply_equipo_template`
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
  - dedup, indices y alineacion de `suscripciones_push`
- `017_asignaciones_unique_guard.sql`
  - dedup e indice unico de asignaciones
- `018_notification_delivery_audit.sql`
  - crea `notification_delivery_audit`
- `019_birthday_cron_bridge.sql`
  - puente `pg_net` + Vault hacia `/api/notify-birthdays`
  - conserva jobs diario y mensual de cumpleanos
- `019_eventos_predicador.sql`
  - agrega columna `predicador`
- `020_service_reminder_cron.sql`
  - puente cron para recordatorios matutinos y de sabado en la noche
- `021_assignment_notification_delay_queue.sql`
  - crea `assignment_notification_queue`
  - programa el procesamiento diferido de avisos de asignacion
- `022_assignment_absence_guard.sql`
  - trigger que bloquea asignar personas ausentes en la fecha del evento
- `023_roles_pastor_audiovisuales.sql`
  - agrega roles `pastor` y `audiovisuales`
  - define `has_sermon_edit_role()` y RPC `update_evento_tema()`

## 11. Supabase edge functions (`supabase/functions`)

- `notify-assignment/index.ts`
  - recibe payload por `perfil_id`
  - envia email via `send-notification-email`
  - envia web push
  - escribe auditoria

- `send-notification-email/index.ts`
  - usa `Resend`
  - arma HTML del correo
  - resuelve perfil/email
  - audita estado de envio

### Lectura practica

La app hoy usa una mezcla de:

- API routes Astro para cron interno y operacion app,
- funciones edge de Supabase para ciertos envios desacoplados,
- SQL/RPC/cron del lado de base de datos para puentes programados.

## 12. Assets y runtime publico (`public/`) + docs

### Archivos publicos clave

- `manifest.webmanifest`
  - manifest PWA
- `push-sw.js`
  - service worker de notificaciones push
- `workers/metronomeWorker.js`
  - worker del scheduler del metronomo
- `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`
  - iconografia PWA
- `favicon.*`
  - favicons del sitio
- `LOGO REDIL.png`, `LOGO REDIL LIGHT.png`
  - logos de marca
- `afinacion-bg.webp`, `calentamiento-bg.webp`, `repertorio-bg.webp`
  - fondos visuales
- `fonts/redil/*`
  - familia `adineue` y `Modius`
- `CNAME`
  - dominio personalizado

### Documentacion interna

- `docs/chordpro-print-invariants.md`
  - invariantes que se deben preservar mientras conviven el parser viejo y el nuevo flujo de print/PDF

## 13. Scripts operativos y mantenimiento fuera de `src/`

### Scripts estructurados en `scripts/`

- `scripts/migrarMp3.js`
  - migra MP3 desde Google Sheets hacia `canciones.mp3`
- `scripts/backfill-upcoming-assignment-emails.mjs`
  - backfill/regularizacion de correos de asignaciones proximas
- `scripts/dry-run-service-reminders.mjs`
  - simulacion de recordatorios de servicio

### SQL raiz complementario

- `add_nuevos_roles.sql`
- `infraestructura_configuracion_app.sql`
- `infraestructura_notificaciones.sql`
- `seed_banda.sql`
- `seed_equipo.sql`
- `upgrade.sql`

Estos archivos siguen funcionando como infraestructura complementaria fuera del folder `migrations/`.

### Wrappers y utilidades puntuales en raiz

Ejemplos relevantes:

- `apply_migration_009.cjs`
- `apply_migration_010.cjs`
- `apply_migration_015.cjs`
- `check_schema.js`
- `check_schema.mjs`
- `inspect_policies_asignaciones.cjs`
- `generate_icons.mjs`

### Scripts ad hoc / one-shot visibles

La raiz todavia contiene varios archivos de reparacion y pruebas temporales:

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
- `remove_logout.cjs`
- `update_colors.cjs`

### Artefactos temporales o de depuracion

Tambien hay archivos que no forman parte del runtime:

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

## 14. Legacy y hotspots tecnicos

### Legacy

- `src/archivos_legacy/`
  - `old_programacion.astro`
  - `old_programacion2.astro`
  - `old_programacion_utf8.astro`
  - conserva versiones viejas del flujo de Programacion
  - esta excluido por `tsconfig.json`

### Hotspots actuales por tamano/acoplamiento

- `src/components/react/ModoEnsayoCompacto.jsx` (~2191 lineas)
- `src/components/AdminRepertorio.jsx` (~1753 lineas)
- `src/components/react/ModoLiveDirector.jsx` (~1670 lineas)
- `src/pages/equipo.astro` (~1302 lineas)
- `src/components/react/EnsayoHub.jsx` (~1263 lineas)
- `src/pages/repertorio.astro` (~1170 lineas)
- `src/components/react/CalendarioGrid.jsx` (~1152 lineas)
- `src/components/react/SongSheet.tsx` (~1149 lineas)
- `src/pages/perfil.astro` (~1032 lineas)
- `src/layouts/Layout.astro` (~838 lineas)
- `src/pages/herramientas/chordpro.astro` (~845 lineas)
- `src/pages/ensayo/[id].astro` (~807 lineas)
- `src/components/react/DashboardInicio.jsx` (~757 lineas)
- `src/lib/server/notification-delivery.js` (~740 lineas)
- `src/pages/login.astro` (~734 lineas)
- `src/pages/panel.astro` (~727 lineas)
- `src/components/ProPlayerGlobal.astro` (~723 lineas)

Interpretacion:

- la complejidad del dominio de ensayo/audio sigue concentrada en pocos archivos muy grandes
- `SongSheet.tsx` ya es un hotspot comparable a calendario o perfil
- `Layout.astro` crecio bastante por branding, tema, boot splash y shell global
- la capa de notificaciones ya tiene complejidad de backend real
- `equipo.astro` sigue siendo una pagina con mucho peso operativo y tecnico

## 15. Flujos funcionales clave

### Auth y sesion

`login.astro` -> Supabase Auth -> cookies -> `middleware.js` -> `Astro.locals.user/perfil`

### Programacion y permisos de predicacion

`programacion.astro` -> SSR de eventos/roles -> `CalendarioGrid` -> asignaciones/modales -> RPC `has_sermon_edit_role` / `update_evento_tema`

### Ausencias

`perfil.astro` -> `/api/absences` -> `absence-management.js` -> liberacion de asignaciones -> notificaciones a liderazgo

### Cola diferida de asignaciones

edicion de roster -> `/api/notify-assignment` -> `assignment_notification_queue` -> `/api/process-assignment-notifications` -> `notification-delivery.js`

### Recordatorios y cumpleanos

`pg_cron` + `pg_net` + Vault -> `/api/notify-birthdays` o `/api/notify-service-reminders` -> motor de notificaciones

### Setlists

`repertorio.astro` -> `playlists` + `playlist_canciones` + `playlist_voice_assignments` -> `programacion` y `ensayo/[id]`

### Ensayo

`ensayo/[id].astro` -> `EnsayoHub` -> `ModoEnsayoCompacto` / `ModoLiveDirector` -> `AudioSessionService` + `MetronomeEngine`

### Audio remoto

UI -> `audio-playback.js` -> `/api/audio` o `/api/mp3-proxy` -> Google Drive / R2

### ChordPro print y PDF

`ChordProPrintWorkspace` -> payload normalizado -> browser store o payload token -> `/render/chordpro-print-pdf` o `/api/chordpro-print-pdf`

### Branding

`configuracion.astro` + `PanelBranding.jsx` -> tablas de configuracion -> `Layout.astro` -> CSS variables globales

## 16. Conclusiones practicas para navegar la codebase

Si alguien nuevo entra al repo, hoy el orden mas util para entenderlo es:

1. `package.json`
2. `astro.config.mjs`
3. `src/middleware.js`
4. `src/layouts/Layout.astro`
5. `src/pages/index.astro`
6. `src/pages/programacion.astro`
7. `src/components/react/CalendarioGrid.jsx`
8. `src/pages/repertorio.astro`
9. `src/pages/ensayo/[id].astro`
10. `src/components/react/EnsayoHub.jsx`
11. `src/lib/supabase.js`
12. `src/lib/server/absence-management.js`
13. `src/lib/server/assignment-notification-queue.js`
14. `src/lib/server/notification-delivery.js`
15. `src/pages/api/chordpro-print-pdf.ts`
16. `docs/chordpro-print-invariants.md`
17. `migrations/001_playlists.sql` hasta `migrations/023_roles_pastor_audiovisuales.sql`

### Corazon real del sistema hoy

- auth + middleware
- programacion/calendario/asignaciones
- repertorio/playlists
- ensayo/audio
- ausencias + disponibilidad
- notificaciones/cron
- branding/configuracion
- print/PDF de ChordPro
