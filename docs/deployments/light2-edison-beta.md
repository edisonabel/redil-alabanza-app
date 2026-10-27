# Modo Light 2 · beta privada

URL: https://light2-edison-beta--alabanzaredilestadio.netlify.app

- Solo accede la cuenta verificada Edison Aular (`80f063de-6eac-4f53-9e98-acadf481dc1c`). Sin vencimiento, según la última indicación del usuario.
- Se inicia sesión normalmente, se abre el evento en modo ensayo y se pulsa **Modo Light 2**.
- Publicación independiente con alias Netlify. No se publica esta rama en el dominio principal ni se fusiona con main.
- La restricción de cuenta se comprueba en middleware y al crear las cookies de sesión; no depende del nombre mostrado ni de parámetros de URL. Las páginas y API privadas no se almacenan en caché.
- Las mezclas del evento se guardan en `live-director/light2-beta/event-mixes`. Si no hay una mezcla beta, se lee la del sitio principal como punto de partida.
- Los arreglos del evento se guardan en `live-director/light2-beta/event-arrangements`. Los cambios fuera de eventos siguen siendo temporales.
- La beta no permite reemplazar stems ni persistir cambios en la canción original. Se mantienen los permisos propios del evento para editar su arreglo.
- Administración incluye **REAPER**: descarga un ZIP con Click, Guide y cada instrumento como stem independiente, ofrece la plantilla `.RPP`, y guarda proyectos por canción en `live-director/light2-beta/reaper-projects`. El lector muestra tempo/compás iniciales y marcadores; subir un RPP no escribe `section_markers` ni cambia el playback.
- Providencia usa los marcadores REAPER confirmados, compás 4/4 y desfase cero; las rejillas de clic calibradas se aplican en memoria. No hay migraciones ni cambios en canciones, perfiles o roles.
- Se incluyó la recuperación de sesión que ya existía en el checkout local principal; los archivos originales se mantuvieron intactos.

Despliegue verificado: `6adad36db08d4820973683dc`. La publicación principal permaneció en `6ad63f9f361cea6a78f905f0`.

## Validación

`npm run build`, `npm run test:reaper-project`, `node scripts/test-light2-beta-access.mjs`, `node scripts/test-auth-session-bridge.mjs`, `node scripts/test-authenticated-fetch-recovery.mjs` y prueba en navegador con un evento real (15 stems, reproducción y pausa).

Se verificó también el enlace remoto: inicio de sesión propio, bloqueo de invitados y de API sin sesión, bloqueo de escrituras sobre canciones originales, 15 stems, primer marcador de Providencia en 12 s y reproducción/pausa sin errores. En WebKit se comprobó el salto a compás mientras siguen sonando los 15 stems, además del seek tras cerrar el editor. El modo Safari usa el cambio sincronizado al límite de sección; la preparación anticipada de Worker se reserva para navegadores que cumplen esa ruta exacta. Se corrigió la extracción de los estilos de los buses y el chequeo de artefactos detecta dependencias CSS/JS faltantes.

Para la pantalla REAPER se verificó el build beta, el parser de marcadores, la plantilla publicada (HTTP 200), la redirección del Admin privado al login (HTTP 302) y el rechazo de API sin sesión (HTTP 401).

La prueba `scripts/test-light2-beta-browser.mjs` usa una sesión de QA privada en `.lab/` y admite `LIGHT2_QA_URL`. Los tokens no se versionan ni se incluyen en la publicación; la sesión de QA se revoca al terminar.

El entorno de compilación se mantiene fuera de iCloud en `~/.cache/livedirector/light2-beta-build`; el laboratorio conserva su checkout y su puerto 4322. No iniciar Astro dev dentro del entorno de compilación antes de publicar: el adaptador limpia los artefactos SSR al arrancar. Compilar después de detener dev y desplegar el resultado con un alias, sin `--prod`.


## Arranque del audio · 24 de octubre de 2026

- R2 permite GET/HEAD desde la URL exacta de esta beta. Se conservó la política
  anterior para los demás sitios. El reproductor beta descarga los stems públicos
  directamente de `stems.alabanzaredilestadio.com`, sin `mp3-proxy` ni relay Netlify.
- El primer Range solicita 64 KB y mantiene las descargas posteriores de 256 KB.
  Los fallos de red producen un error recuperable, sin convertir la sesión en una
  reproducción parcial ni lanzar automáticamente una carga completa en memoria.
- La versión del motor no cambia el límite de pistas durante la inicialización.
  Las lecturas simultáneas de una misma mezcla comparten su petición en curso.
- El productor publicado incluye MP4Box en un único archivo con hash de contenido;
  los Workers no dependen de otra descarga síncrona de vendor para arrancar.
- Se usan las portadas ya almacenadas. La extracción opcional de portadas desde MP3
  espera al audio y se realiza en serie. Las imágenes CORS usan una clave de caché
  separada de las imágenes sin CORS del catálogo.
- Se mantiene desactivada la descarga completa anticipada de stems en web, para no
  competir con el audio activo. La política de precarga nativa se conserva.

La comprobación remota usa el evento del 25 de octubre y su mezcla guardada de 9
stems activos (los 3 desactivados por la mezcla no se habilitan). Comprueba PCM
inicial en los 9, una sola sesión del productor, ninguna pista omitida, descargas
directas, portadas cargadas y reproducción/pausa en Chrome y WebKit. Las sesiones
de QA se revocan al finalizar. Las mediciones corresponden a esta conexión y no
son una garantía de tiempo para todas las redes.


Despliegue final de esta corrección: `6add5a874c46587fcdae86be`. Validación remota
final: Chrome 10,7 s y WebKit 7,0 s, los 9 stems listos, sin errores de consola ni
pistas omitidas, portadas visibles y reproducción/pausa. No se realizaron
extracciones MP3 de portadas ni peticiones `mp3-proxy` durante la prueba. El deploy
principal continúa en `6ad63f9f361cea6a78f905f0`. Verificación local adicional:
rutas de audio, Range y cancelación, mezcla del evento, política de precarga,
política del motor, portadas y build con higiene de 1379 archivos.

## Mapa REAPER en ensayo · 24 de octubre de 2026

Despliegue `6add601ecb9c6f0ebe91c6e7`: el director de ensayo y la vista compartida
priorizan `multitrack_session.sectionMarkers` frente al mapa de la letra. Se
conserva la metadata REAPER al resolver la sesión y se detectan actualizaciones de
tiempos aunque no cambien las pistas ni el `updatedAt` antiguo. Las nuevas
aplicaciones de RPP actualizan también `updatedAt`. No se modificó ningún dato
musical ni se volvió a importar el archivo del usuario para esta reparación.

Se compararon las 12 entradas del RPP de Cristo con las tarjetas y porcentajes del
minimapa en la beta publicada, en Chrome y WebKit, con tolerancia menor a un
microsegundo para sus entradas. El salto a Coro 2 llega a 121.578947 s y la
reproducción avanza desde allí antes de pausar. Siguen cargando los 9 stems de la
mezcla, sin errores ni omisiones. Pruebas: `test:live-reaper-map`,
`test:reaper-project`, `test:live-terminal-section`, `test:live-arrangement`,
`test:live-sections-performance`, `test:event-mix`, build e higiene. Main conserva
el deploy `6ad63f9f361cea6a78f905f0`.

La revisión visual detectó además una suma incorrecta de `left` porcentual y
`transform` en píxeles al pausar el minimapa. El deploy final
`6add6157e34937ca4ae7dfd6` mantiene una única posición por transform para reproducción
y pausa. Se validó la posición geométrica de la línea blanca contra el tiempo del
motor tras saltar a Coro 2, reproducir y pausar, en Chrome y WebKit. Se añadió el
caso de pausa a mitad de canción a la prueba de overview. Resultado remoto final:
12 entradas idénticas al RPP, minimapa alineado, 9 stems y ninguna pista omitida.

## Precarga de saltos en vivo · 24 de octubre de 2026

La comparación remota reprodujo en WebKit un hueco de PCM de aproximadamente
1,45 s: el modo ensayo excluía Safari de los saltos preparados y esperaba al
límite para hacer un seek en primer plano. Se separó la capacidad de precargar
un destino (WebCodecs + SAB + aislamiento en desktop) de la política histórica
de seek foreground de Chrome. No se alteraron las políticas de seek/fallback
para los demás casos.

El destino se prepara con productores y buffers independientes mientras el origen
continúa. El worklet cambia los stems juntos en el límite solo cuando todos
están listos. La vista ahora muestra «Precargando…», «Listo · N/N» y verde en la
tarjeta y minimapa del destino. Anterior/Siguiente en reproducción usan esta
misma preparación al final de la sección; pausados conservan el seek directo.
La sección activa se actualiza al cruzar un límite o salto sin volver a renderizar
React en cada frame. Anterior consulta el reloj real, no una selección visual vieja.

Deploy final `6add660fba1ae7344a98d5e7`. QA remota en Chrome y WebKit: salto armado
Intro → Coro 2, segundo salto/reinicio por Anterior reutilizando el pool de destino,
y preparación por Siguiente → Interludio 2. Todos llegan a «Listo · 9/9» antes del
límite; destino verde en tarjeta/minimapa. El probe de PCM después de Master no
registró huecos >=20 ms durante estas reproducciones, incluida la segunda
transición. Solo hubo un seek inicial pausado para posicionar la prueba; ninguno
en primer plano durante los cambios. Cancelar Siguiente mantuvo el audio sonando.
La sesión de QA se revocó al terminar. Main conserva
`6ad63f9f361cea6a78f905f0` y localhost 4322 quedó activo.

Checks: build/higiene, política del motor y capacidades de precarga, arreglo,
secciones/performance y precedencia del mapa REAPER. Se extendió la regresión de
timeline para que Anterior/Siguiente en vivo armen sin adelantar el reloj.

## REAPER, avance desde Final y guardado de mezcla · 24 de octubre de 2026

Se auditó cada canción con `reaperTiming.source = reaper-rpp`. El RPP adjunto de
«Todo lo que creo el Rey» coincide con sus 8 marcadores aplicados, pero la sesión
conservaba un offset antiguo de +4,25 s. Se corrigió a cero y se actualizó la
versión temporal; «Digno y Santo» conservaba offset cero y también recibió la
versión pendiente de su importación. «Cristo nuestra esperanza…» ya coincidía.
El respaldo previo está en `.lab/results/reaper-legacy-offsets-backup.json`.
Los cambios afectan el mapa multitrack; no reescriben los marcadores de letras.

Aplicar un RPP ahora elimina el desfase anterior porque sus entradas son posiciones
absolutas del audio. Al regresar al evento se refresca la sesión persistida.
Tempo, compás y origen UNO del RPP tienen prioridad en el transporte: en
«Todo lo que creo el Rey» se muestran 76 BPM y 4/4, en vez de los 75 BPM del catálogo.
Final corresponde a 274,736842 s y FIN AUDIO a 285,197 s.

El contador de cinco segundos comienza al entrar en el último marcador Final,
con la cola aún sonando. Muestra números grandes sobre la pantalla y admite
cancelación mediante Espacio, Play o botón visible. La cancelación se mantiene
hasta una nueva pasada; rebobinar antes de Final permite volver a contar. Si no
hay Final se conserva el final de audio como respaldo. El siguiente tema espera
su mezcla, arreglo y motor preparados antes de iniciar. Espacio también cancela
cuando el foco permanece en una tarjeta de canción, sin activarla accidentalmente.

La selección de canción se confirma inmediatamente y muestra qué tema se está
preparando. Tanto Play como el teclado verifican que la preparación pertenece a
la sesión seleccionada. El autosave también espera esa preparación: durante una
lectura lenta no puede copiar los faders ni habilitar stems de la canción anterior.
El guardado agrupa snapshots, permite una petición en vuelo por canción, conserva
solo el último cambio pendiente y comparte los reintentos. La respuesta del
servidor confirma persistencia sin reaplicar faders. Se eliminó el toast repetido;
queda un estado discreto y los errores pendientes conservan recuperación local.
No se reintenta por cada pointerup/keyup.

Checks: contador y cancelación por pasada, cola de guardado, persistencia y
recuperación de mezcla, precedencia/refresh de mapas REAPER, tempo/compás/UNO,
subida RPP, política del motor, precarga, arreglos, build e higiene de artefactos.
Deploy final: `6add72257305c10511eebe8d`, alias privado `light2-edison-beta`.
El despliegue principal sigue en `6ad63f9f361cea6a78f905f0`.

QA remota final en Chrome y WebKit: las 8 entradas de «Todo lo que creo el Rey»
coinciden con el RPP, encabezado 76 BPM/4/4 y 9 stems según la mezcla existente.
Una demora artificial de 3,5 s en la lectura de mezcla mantuvo reacción visual de
61 ms y 78 ms respectivamente. Abrir/cambiar canción no generó ningún PUT de
mezcla. Se compararon IDs habilitados y volúmenes contra la mezcla leída.
Dos gestos de fader con respuestas demoradas 1,6 s produjeron dos escrituras,
sin rollback, peticiones posteriores por interacciones ajenas ni reinicio del
motor. La prueba interceptó esas escrituras; no alteró la mezcla real del evento.

Final inicia la cuenta mientras el audio sigue sonando; números de 352 px en
1440×900 y vista revisada en 844×390. Espacio con una tarjeta enfocada cancela
sin reiniciar ni cambiar de canción. Una nueva pasada sin cancelar inicia
«Espera en Dios» tras preparar su sesión. Ambos navegadores terminaron sin
pageerrors. Resultados en `.lab/results/beta-final-mix.json`; capturas
`final-countdown-chromium.png`, `final-countdown-webkit.png` y
`final-countdown-compact.png`. Las sesiones temporales de QA se revocaron.

Se cubrió además por prueba de persistencia la confirmación de un snapshot ya
guardado: al volver al último valor confirmado la deduplicación limpia solo el
registro pendiente coincidente, evitando reintentos perpetuos de un cambio que
ya está guardado. El registro más nuevo nunca se borra por una respuesta anterior.

## Volumen y cancelación con cualquier control · 25 de octubre de 2026

Se mantiene la nivelación común de todos los instrumentos, con un objetivo más
alto en conversiones nuevas: −14 LUFS frente a −18. El margen previo a AAC queda
en −2 dBTP (−1 produjo un pico codificado de +0,67 dB en la prueba WASM); la
prueba final de AAC-LC/15 stems vuelve a quedar por debajo de cero. El máximo de
subida durante análisis pasa de +12 a +24 dB para que fuentes suaves alcancen el
objetivo, siempre sujeto al pico de la mezcla y al del stem más alto. No se
modifican ni se recodifican los audios ya subidos.

El nivel de escucha de Light Director admite −24…+12 dB, añade «Subir +3 dB» y
conserva «Restaurar 0 dB». La ganancia positiva se permite hasta 4× en los motores
y en el worklet; deja de ser un control que solo atenúa. Buses y faders mantienen
su composición; el nivel de canción no sube click/guía. Master inicia en 1,0 en
la superficie experimental, frente a 0,82. Auto picos sigue siendo optativo y
sin bombeo en pasajes suaves, con objetivo −1 dBFS frente a −6.

Durante la cuenta regresiva, cualquier pointerdown o tecla de acción cancela el
avance. La captura consume el gesto y su click asociado antes de los controles:
tocar una tarjeta no selecciona otro tema y tocar un fader no cambia su volumen.
El siguiente gesto funciona normalmente. Se conserva la cancelación mientras
se prepara el siguiente tema. El contador indica «Cualquier botón o tecla».

QA remota en Chrome y WebKit: Master 100 %, aumento musical hasta +12 dB,
click/guía en unidad, restauración a cero; cancelación por tarjeta de otro tema,
fader Master y ArrowDown, sin ejecutar esa acción ni reiniciar la canción. El
segundo click abre el control normalmente. Cero escrituras de mezcla y cero
pageerrors. `.lab/results/beta-volume-cancel.json` y `volume-boost-webkit.png`.
La prueba PCM verifica que ganancia 2× duplica instrumentos y deja cues iguales.
Pasaron medición real FFmpeg, núcleo WASM/AAC-LC/Fast Start, medidor, estado de
avance, cola de guardado, persistencia de mezcla, política del motor y build.

Deploy final `6ade11f5c55757a550bf3aa6`. Worklet versionado como
`20261025-song-gain-1` para no reutilizar la copia antigua que limitaba la ganancia
a 1. Main conserva el despliegue principal previo; localhost 4322 usa la misma
versión final de código.

## Reinicio con entrada y números de secuencia · 25 de octubre de 2026

Deploy de la beta `6ade1d62966b21334480d8d0`. Las tarjetas muestran su posición;
1–9 cargan esa secuencia y 0 carga la décima, sin arrancar la reproducción.
Se respetan campos de edición, diálogos y los atajos existentes. El botón
«Reiniciar», disponible durante la reproducción, y la tecla E cancelan saltos
y repeticiones, preparan el inicio y dan de nuevo la entrada.

Cuando UNO identifica un compás previo completo, se reproduce el comienzo
original y los números grandes siguen el último compás anterior a UNO mediante
el reloj del motor. No se añade otra voz encima de la guía grabada. Si falta
ese preámbulo, se cuenta un compás con números y voz antes de arrancar los
stems; la voz usa el volumen y la salida del cue Guide/Click activo. Sin ese
bus se indica conteo visual. Se usa el numerador y la unidad del compás: 1–2–3
en 3/4, 1–2–3–4 en 4/4 y seis subdivisiones en 6/8. Espacio, Escape o Play
cancelan el conteo añadido; cambiar de canción invalida cualquier inicio viejo.

Se corrigió también una carrera de carga: si la mezcla del evento llegaba
mientras los mismos audios ya estaban cargando, el motor podía conservar los
volúmenes iniciales y guardarlos por encima de los leídos. Ahora aplica la
mezcla más reciente antes de habilitar transporte y guardado, sin añadir
volúmenes a la identidad que recarga el audio.

QA remota en Chrome y WebKit: tarjetas/atajos, exclusión de campos de edición,
reinicio por E y botón mientras suena, números alineados con UNO de REAPER,
conteo añadido antes de reproducir, cancelación por Escape/Espacio y cambio de
canción sin arranques tardíos. Reinicio medido alrededor de 1,1 s; números a
menos de 60 ms de los pulsos esperados. Cero pageerrors y cero escrituras de
mezcla al escuchar, reiniciar o navegar. Capturas revisadas en 1440×900 y
844×390; resultados `.lab/results/beta-entry-count.json`.

La prueba de stems cambió una pista encendida por otra apagada y verificó el
payload completo (incluidos los false), una sola escritura, IDs reales del
motor, reinicio, regreso a la canción y recarga. El almacenamiento se simuló
interceptando únicamente la API de mezcla; no se alteró la selección real del
usuario. Ambos navegadores conservaron exactamente la selección aplicada.
Resultados `.lab/results/beta-enabled-stems.json`. Pasaron las pruebas de
conteo/estado (incluido 3/4), persistencia de mezcla, cola de guardado y build.
Sesiones de QA revocadas. Localhost 4322 restaurado con el código final; el
deploy principal conserva `6ad63f9f361cea6a78f905f0`.

## Transiciones musicales de reinicio y repertorio · 25 de octubre de 2026

Beta `6ade6b20d8654019156fd320`. «Al cerrar» y Shift+E preparan el inicio y
reinician al terminar la sección que está sonando. El menú contiguo conserva
«Reiniciar ahora» y E como emergencia inmediata. Tras el cierre vuelve a darse
la entrada: audio/conteo original identificado por UNO, o un compás añadido si
no hay preámbulo. Esc cancela la preparación sin detener la canción.

Mientras suena, las tarjetas y 1–9 (0 para la décima) arman un cambio de canción.
La tarjeta de destino muestra PREPARANDO y luego LISTO en verde; la actual
sigue seleccionada y sonando hasta el cierre. El motor prepara todos los stems
habilitados y elige un compás futuro de la cuadrícula de tempo, compás y UNO.
Si la carga consume el primer límite, elige el siguiente; no corta para cargar.
En pausa la selección sigue siendo inmediata.

La preparación usa productores y anillos independientes; el worklet sustituye
el conjunto completo en el mismo frame, también entre canciones con distinto
número de stems. Aplica la mezcla y salida de destino, limpia solos y añade un
suavizado de 3 ms a cada lado del cambio. React adopta esa sesión ya preparada
sin ejecutar stop ni otra inicialización al cambiar la identidad visible. Si
hace falta un conteo añadido, el destino queda preparado y pausado durante el
conteo. Los arreglos del evento se revisan antes del cambio y preparan su primera
sección. Cancelaciones invalidan las cargas anteriores; una lectura tardía de
otra selección no vuelve a aplicar su mezcla.

QA remota de esta versión en Chrome y WebKit: reinicio en 31,578947 s de «Todo
lo que creo el Rey», entrada original visible, cambio por número a «Cristo
nuestra esperanza…» en 63,157895 s o 66,315789 s según cuándo acabó la carga,
con cinco stems de origen y seis de destino elegidos por la mezcla actual del
usuario. IDs y volúmenes coinciden con la mezcla leída. La canción continúa
reproduciéndose tras la adopción; E conserva el reinicio inmediato y Esc cancela
el preparado. Cero pageerrors, errores de consola o escrituras de mezcla.
La selección real no se modificó: las escrituras estaban interceptadas.
`.lab/results/beta-musical-navigation.json`.

Una segunda prueba en Chrome interceptó solo UNO del destino para simular una
canción sin preámbulo: el destino quedó pausado, contó 1–2–3–4 y después arrancó
con los seis stems y sus volúmenes. Sin modificar el RPP ni datos reales.
`.lab/results/beta-musical-navigation-synthetic.json`. Revisión visual en
1440×900 y 844×390, menú con foco y navegación de teclado; capturas
`musical-restart-ready-*`, `musical-song-ready-*` y `musical-restart-options-*`.

Pasaron los tests del controlador musical, cambios PCM entre 2 y 18 stems,
conmutación atómica/repeticiones existentes, conteo y 3/4, mezcla del evento,
cola de guardado, duck de guía, medidor y build. La comprobación de tipos no
señala errores nuevos en estos archivos; siguen dos errores previos de firmas
de callbacks en AuthSessionBridge.astro. Sesiones de QA revocadas. Localhost
4322 restaurado; producción conserva `6ad63f9f361cea6a78f905f0`.

## Atajo R para repetir una sección · 25 de octubre de 2026

En la beta, R activa «Repetir sección una vez» para la sección que está sonando;
al llegar al final vuelve a reproducirla y luego continúa. Pulsar R de nuevo
cancela la repetición pendiente. El botón muestra R y conserva el mismo
comportamiento. El reinicio sigue en E y Shift+E. En el modo no experimental,
R conserva su función anterior de volver al inicio. Publicado en el alias privado
con deploy `6ade7ed4260fc98c5fb308ef`; la publicación principal no cambió.

## Frontera de sección y compás de Cristo · 25 de octubre de 2026

Beta `6ade826fb34cf2a468b71555`. Mientras suena, el cambio de canción con
tarjeta o número fija la frontera al final de la sección que sonaba en el
instante de la solicitud. La precarga ocurre antes de esa frontera; si no llega
a tiempo, el motor cancela el cambio y deja continuar la canción, sin mover la
frontera a otro compás o ejecutar una transición tardía.

«Cristo nuestra esperanza en vida y muerte (Versión Instrum.)» conserva 76 BPM
y ahora usa 3/4 en la sesión persistida del multitrack. La copia del proyecto
REAPER corregida está en Descargas con el nombre
`Cristo nuestra esperanza en vida y muerte _Version Instrum._ - revisar 3-4.RPP`.
La carga original de 4/4 se preservó. Deploy publicado en el alias de beta;
producción principal sin cambios.

## Conteo al repetir sección · 26 de octubre de 2026

La repetición de sección (una vez o hasta salir) programa el conteo de entrada
al final de cada pasada, antes de reiniciar la sección. El conteo usa el
numerador y denominador de la métrica activa: cuatro pulsos en 4/4 y tres en
3/4. Los controles indican que la repetición incluye conteo. Publicado en el
alias privado con deploy `6adf766dcbfb8e6c96d01262`; producción principal sin
cambios.

## Caché de stems y saltos locales · 26 de octubre de 2026

Beta `6adf9b4136d8b2e25aa6745c` (alias privado, sin `--prod`). Los productores
guardan los bytes descargados en bloques de 64 KB en Cache Storage
(`light2-stem-blocks-v1`, máx. ~380 MB, se eliminan primero los más antiguos).
Cada stem se valida por ETag/tamaño; los Workers nuevos de un salto confían en
esa validación durante 30 min y leen todo localmente. Al cargar una canción se
precargan en segundo plano, con prioridad baja y solo con el anillo lleno, los
3 s previos y 6 s posteriores a cada inicio de sección. Las voces del conteo y
de la guía dinámica se descargan y decodifican una sola vez. El worklet reporta
`renderLoadPct` en diagnóstico. Los medidores escriben solo valores que cambian
y la variable de nivel va en la barra, no en toda la tira. Sin cambios visuales.
Worklet versionado como `20261026-stem-cache-1`; productor `producer.bee9d71eba0702d0.js`.

Medido con «Espera en Dios» (7 stems): en local los saltos quedan listos en
0,14–0,94 s (antes 4,1 s y saltos cancelados). En la beta: primer salto en frío
7,4 s, segundo 4,5 s con la precarga aún en curso, tercero 0,14 s. Cero cortes
de audio, deriva 0 ms y carga del hilo de audio ~1 % del presupuesto. Pausa y
reanudación no vacían el anillo (1 ms). Checks: build e higiene (1381 archivos),
REAPER, acceso beta, sesión, recuperación de fetch, productor, precarga, cambio
preparado, conteo, medidor y conteo de saltos. Siguen fallando, igual que antes
de este cambio, `test-live-director-engine-policy` (regex de `resetTracks`) y
`test-live-director-musical-navigation`. Respaldo previo del laboratorio en
`refs/claude/pre-light2-perf`. Producción principal sin cambios.

## Guardar el ensayo en el equipo · 26 de octubre de 2026

Beta `6adfa1e1794541fa472f7766`. Al final de la fila de canciones de Light 2 hay
una tarjeta con el mismo estilo de «Click + Pad»: Guardar ensayo → Guardando N %
→ En este equipo. Guarda completos solo los stems habilitados de las canciones de
ese ensayo, con su mezcla del evento, en un Worker aparte. Se detiene mientras
suena la música, descarga tres stems a la vez y omite los bloques que ya
existen. Al terminar elimina todo lo que no pertenece a ese ensayo: en el equipo
queda un solo ensayo y guardar otro lo reemplaza. Los stems guardados no se
recortan por el límite de la caché. Se pide almacenamiento persistente al
navegador (Chrome lo concede solo con instalación o uso frecuente).

Si la red falla, el productor lee los bloques guardados antes de reintentar; sin
conexión usa la última validación aunque tenga más de 30 min. Con conexión, una
sesión de otro día hace una sola petición de validación por stem y lee el resto
del equipo. El manifiesto añade `id`, `scope` y `description` para instalar la
app desde Chrome/Edge en Mac y Windows; las actualizaciones llegan con cada
deploy porque el service worker no guarda páginas. Worklet
`20261026-rehearsal-download-1`, productor `producer.546defa467d1b9b2.js`.

Medido en la beta con el ensayo del 25 de octubre: 28 stems de 5 canciones,
172 MB, ~15 s preparando la lista y ~17 s descargando desde R2. Ningún otro
contenido quedó guardado. Con el ensayo guardado, los 7 stems de «Espera en
Dios» quedan listos 43 ms después de recibir la sesión y el primer salto se
prepara en 0,9 s (antes 7,4 s en frío). En local, reproducir otra canción del
ensayo no hizo ninguna petición de audio. Las API de sesión, mezcla y arreglo
tardaron 13 s en esa prueba; esa espera es del servidor, no del audio. Checks:
tipos, productor, precarga, cambio preparado, conteo, medidor, build e higiene,
REAPER, acceso beta, sesión y recuperación de fetch.

## Datos de canción en el equipo y archivos para seguir sin red · 26 de octubre de 2026

Beta `6adfa66431ab6fd78c2f7603`. Light 2 guarda en el equipo la última respuesta
de sesión multitrack, mezcla del evento y arreglo del evento de cada canción
(`light2-rehearsal-data-v1`). Si el servidor responde en 2,5 s se usa su
respuesta; si tarda más o falla, se usa la copia del equipo y la respuesta tardía
solo actualiza esa copia. Un arreglo leído del equipo se reproduce pero no se
edita. Solo las lecturas de Light 2 usan la copia; administración, impresión y
EnsayoHub siguen leyendo el servidor. Guardar el ensayo refresca las tres copias
de cada canción y elimina las de otros ensayos. Cerrar sesión desde el perfil
borra estas copias.

El service worker `redil-sw-v5` conserva `/_astro/` y `/audio-runtime/` (primero
caché, son inmutables) y `/workers/`, `/vendor/` y las voces de guía/click
(primero red, copia si falla), para crear Workers y conteos sin conexión. No
guarda páginas ni respuestas parciales; los stems siguen en su caché de bloques.

Medido en la beta: cambio de canción 1,4–2,6 s con el ensayo guardado (antes
3,1–5,7 s y hasta 14,5 s con API lentas). Quedaron 15 copias de datos (5
canciones) y la caché de ejecución con 79 bundles, 46 voces, el productor y 2
Workers. En local, con el servidor detenido y la página abierta, la canción
cargó su sesión y mezcla del equipo y los stems de Workers ya iniciados
sonaron desde el equipo; los Workers nuevos dependían del script de desarrollo,
que ahora cubre el service worker en la beta. En localhost el layout borra todas
las cachés al abrir login o inicio (comportamiento previo de desarrollo).

## Navegación musical, encadenado e integración · 27 de octubre de 2026

Beta `6ae0ce903e59a91ab24672f8` (alias privado, sin `--prod`), desde la rama
`codex/livedirector-providencia-lab` en `bcf7321`. Integra el trabajo de las dos
sesiones en cuatro commits: impresión V2 paginada con notas y preferencias
personales (migración 056), asistente REAPER con lista de secciones y guía
visual, importador de ChordPro desde capturas (solo en el laboratorio de la Mac)
y Light 2.

Light 2: volver al inicio espera el final de la sección mientras suena y
rebobina al instante detenido; el conteo de entrada solo se añade en canciones
con `reaperTiming`; «Encadenar» (solo PC) pasa a la siguiente canción del
evento sin silencio, por transición y recordado en el equipo; las pantallas de
menos de 1080 abren las secciones con «Secciones» y los teléfonos la tira con
«Canciones»; «Editar» explica por qué no está disponible. El productor cuenta
el silencio de priming AAC en la cabeza del archivo para que el reinicio
preparado a 0 no falle.

Checks: suite completa 82/83 (la restante requiere astro dev en 4322), build e
higiene (1397 archivos), acceso beta, puente de sesión y recuperación de fetch.
Remoto: `/` y `/admin` redirigen a login sin sesión, la API privada responde 401,
worker y asistente REAPER 200. El despliegue principal no cambió.

Migración `056_chordpro_personal_preferences.sql` aplicada en producción el 27 de
octubre desde el editor SQL de Supabase (texto idéntico al archivo, verificado por
hash antes de ejecutar). Comprobado por API: la tabla
`cancion_chart_preferencias_usuario` existe con sus columnas y la escritura sin
sesión es rechazada por RLS. Solo crea objetos nuevos; no modifica datos existentes.
