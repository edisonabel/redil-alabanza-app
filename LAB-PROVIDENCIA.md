# Laboratorio local de Providencia

Rama `codex/livedirector-providencia-lab`, base `main` en `483d1cf`. Sin push, merge ni despliegue. Providencia se lee desde una copia de sus metadatos y sus 15 stems existentes; este laboratorio no guarda cambios en Alabanza.

## Prueba manual habilitada

```sh
npm run lab:providencia
```

Abre **http://127.0.0.1:4322/** en Chrome. La pantalla monta el componente real de LiveDirector y selecciona Providencia; también permite cambiar a Tu palabra (JCA). Necesita `.lab/songs.json`, una copia privada de los metadatos existentes, ignorada por Git. Las mezclas se conservan sólo mientras esta página esté abierta y se reinician al recargar. La API local sólo admite GET/HEAD; las rutas de guardado y carga de archivos no están disponibles. No se copió `.env`.

La recuperación tras underrun está activa. Los saltos armados y repeticiones en Chrome de escritorio preparan el destino mientras la sección actual sigue sonando y cambian todos los buffers en el reloj de AudioWorklet. Las búsquedas manuales y los botones Anterior/Siguiente conservan su transición con fade y seek. Las rutas nativa, buffer y de tempo manual conservan su transición anterior. Los fades de congregación por stem siguen usando su implementación anterior.

El evento `render-error` ahora detiene el transporte, muestra un aviso y permite recargar. La recuperación requiere pulsar reproducir explícitamente. Si falla el procesador completo (`processorerror`), se recrea el nodo al recargar.

## Herramientas experimentales

Pulsa **Herramientas**, en la barra superior, para preparación y saltos. **Grupos** tiene un botón propio debajo de Mezcla/Secciones, en la columna junto al master; ocupa el mismo espacio que los faders.

- **Preparación**: muestra el inicio disponible de la canción actual, el número de stems, motor y salidas. No valida todo el repertorio ni garantiza reproducción sin conexión.
- **Salto de sección**: en **Secciones**, durante la reproducción un toque selecciona el destino; doble toque lo arma, o puedes confirmar con **Armar salto** en la propia línea de tiempo. En Mac, flechas para elegir y Enter para armar; Escape cancela. El selector alternativo de Herramientas comparte el mismo estado. Prepara el destino antes de terminar la sección actual y muestra «Preparando stems…» / «Stems listos». Al llegar al límite, AudioWorklet cambia todas las pistas juntas sin pausar ni vaciar sus buffers. Si falta una pista o llega tarde, continúa la canción sin saltar. Admite repetir una sección anterior. Pausar, mover la posición o llegar demasiado tarde cancela el salto; la línea de tiempo muestra el destino y un botón Cancelar. En mezcla/grupos aparece una fila de estado sin desplazar los controles de transporte.
- **Grupos**: usa exactamente `ChannelStrip`, el mismo fader vertical de Mezcla, con color por familia, nivel, S (solo de grupo), M (silencio) y medidores basados en telemetría de los stems. Ritmo, Armonía, Voces, Otros y Click/guía. Una ganancia adicional conserva los faders individuales, mute/solo y ruteo. En **Configurar grupos** puedes corregir la asignación sugerida o restaurar niveles/silencios/solos. No son buses de salida independientes. Los grupos conservan sus niveles, silencio y asignaciones al alternar entre mezcla, secciones y grupos. Se reinician al recargar o cambiar de canción y no se guardan.

### Repeticiones y guía dinámica

En **Secciones**, con la canción sonando:

- **↻ 1 vez** repite la sección actual una vez y sigue su recorrido normal.
- **∞ Mantener** repite la sección actual hasta pedir **Salir al terminar**. Se muestra el número de vueltas completadas.
- **Salir al terminar** deja acabar la pasada actual y continúa hacia la siguiente sección. Pausar o mover manualmente la posición cancela el modo. Armar un salto reemplaza la repetición pendiente.
- **Guía dinámica** prepara las voces españolas suministradas por el usuario. Anuncia secciones, el destino de un salto y «Repetir» cuando procede. Sustituye temporalmente el stem Guide; al apagarla o si falla la preparación vuelve la grabación original. No altera el click de la canción.

El volumen, mute, solo, grupo y salida de la voz se toman de la pista Guide. La voz mono se enruta únicamente a izquierda o derecha según esa pista. Los samples se programan en Web Audio aproximadamente cuatro pulsos antes de la entrada, ajustando el margen a la duración de la frase. Si se arma demasiado tarde para pronunciarla antes del cambio, se omite ese aviso; el salto sigue pendiente. Pausar o cambiar de destino cancela voces programadas.

Se importaron 44 muestras mono PCM16 a 24 kHz (1.7 MB), derivadas de `Click and Guide Samples/Spanish Guides`. Se recortó silencio y se normalizó el pico a 0.75. El manifiesto de `public/audio/guide-es/` registra los nombres originales. No se importaron proyectos Ableton ni archivos `.asd`.

La repetición usa el mismo cambio preparado que los saltos armados en Chrome de escritorio. Se conserva un productor de reserva para reutilizar índices y decodificadores en la siguiente vuelta. Todas las pistas deben tener audio real alineado y al menos 0,5 s de reserva; no significa descargar toda la canción. Si la preparación no llega a tiempo, se cancela la repetición y la canción sigue su recorrido. La primera preparación necesita margen, especialmente con muchos stems o red lenta. La guía anuncia destinos preparados y omite avisos que ya no caben antes del límite. El guiado es de nombres de sección y repetición, no reproduce todos los avisos/count-offs que pudiera contener la guía grabada.

El salto se solicita desde un temporizador de UI que consulta el reloj de audio cada 25 ms. No está programado a precisión de muestra: una interfaz ocupada o en segundo plano puede retrasarlo o cancelarlo. La preparación de PCM puede producir una pausa; no hay transición continua ni precarga PCM de la siguiente canción conectada a esta pantalla.

La precarga de archivos en `ModoEnsayoDirector.jsx` ya no marca éxito con solicitudes fallidas, HTTP omitidos, cargas concurrentes incompletas o cancelación. Libera las URLs que reservó al cancelarse. Ese contenedor no se monta en este laboratorio; el flujo se verificó mediante su función real con caché/red simuladas.

Verificación de la pantalla: `npm run test:providencia-lab`. Pasó en Chrome con 15 tracks en `streaming-worker`, niveles PCM no nulos, reproducción/pausa, cambio de canción, vista horizontal compacta y bloqueo HTTP 405 a escrituras. Resultados y capturas privados en `.lab/results/`.

Experimentos:

- Worklet: recuperar la posición exacta después de una falta de PCM conocida, sin conservar desfases inferiores al umbral normal de 15 ms. Descarta muestras atrasadas; no recupera audio perdido. Fuera de loops.
- Worklet: emitir una sola notificación `render-error` ante excepción, detenerse y mostrar recuperación explícita en la UI.
- `src/services/AudioGainRamp.ts`: envolvente cúbica en AudioParam, conectada a los saltos del motor streaming.

Pruebas locales:

```sh
npm run test:live-repeats
npm run test:live-dynamic-guide
npm run test:live-tools
npm run test:live-timeline-jump
npm run test:live-audio-fades
npm run test:live-prewarm-completion
node scripts/test-live-director-underrun-recovery.mjs
node --experimental-strip-types scripts/test-live-director-hard-output-routing.mjs
node --experimental-strip-types scripts/test-live-director-engine-policy.mjs
node scripts/test-audio-producer-range-timeout.mjs
node scripts/test-live-director-preload-policy.mjs
```

Informe, comandos de medición y resultados en el proyecto de análisis:

`/Users/edisonaular/Documents/ChatGPT/proyecto reverse ingeniering/analysis/livedirector/REVISION-PROFUNDA.md`

Desde la raíz de ese proyecto:

```sh
LD_SOURCE_ROOT="$PWD/experiments/alabanza-providencia" LD_RESULT_NAME=providencia-experiment.json node analysis/livedirector/providencia-benchmark.mjs
node analysis/livedirector/fade-benchmark.mjs
```

Requieren Chrome instalado, dependencias locales existentes y `analysis/livedirector/.private/songs.json` (snapshot privado no versionado). El runner sólo expone GET en loopback y silencia la salida física. No es un despliegue público ni monta el sitio completo.

La captura completa de trabajo falló por una lectura cancelada del proveedor de archivos; se preparó un checkout selectivo del código necesario. No copiar `.env` de producción ni activar guardados para la prueba. La pantalla manual usa el componente real, recursos compilados y un proxy de audio local, sin arrancar todo el sitio Astro o sus endpoints de producción.

Los ensayos de Providencia fueron breves: ambas versiones pudieron reproducir 15 stems y tolerar un bloqueo UI de 750 ms sin underruns en esa fase. La repetición de main también pasó el seek sin underruns, por lo que no se atribuyen ventajas de rendimiento global a esta rama. Los beneficios demostrados están en la recuperación controlada de desfase y la temporización del fade. Falta la comparación de ejecución con Playback y pruebas prolongadas/dispositivos reales.

## Verificación de esta iteración

Chrome 156: 15 stems de Providencia; silencio de grupo confirmado con niveles PCM, faders/rutas conservados, ajuste de grupo al 50%, reasignación y restauración, salto armado hacia delante, repetición hacia atrás, cancelación por pausa/seek, error controlado y recarga sin autoplay. Vistas 1728×1000 y 844×390 inspeccionadas, con acceso directo a grupos y conservación de estado entre vistas. Sin escrituras de la UI.

En un grafo Web Audio con salida física silenciada, la envolvente de 800 ms llegó a cero durante un bloqueo de UI de 750 ms. También pasaron cancelación manteniendo la ganancia intermedia, sustitución de rampa y suspensión del AudioContext. No demuestra ausencia de cortes durante un seek de red.

Pasaron revisión de tipos de los componentes/hook y sus dependencias, recuperación de underrun, grupos, política de motor, routing, precarga y timeouts de Range. No se ejecutó build completo Astro ni validación en Safari, iOS o equipo de audio del culto. Capturas y resultados locales en `.lab/results/`.

La prueba de navegación directa verificó un toque sin seek, confirmación explícita, doble clic para repetir una sección anterior, flechas/Enter y cancelación con Escape. Usa los límites reales de los marcadores con su desfase guardado. Se inspeccionaron los faders de grupos en escritorio y horizontal compacto.

Verificación de repeticiones/voz: Chrome con Providencia (15 stems), una repetición seguida de recorrido normal, dos vueltas mantenidas, salida a final de pasada y cancelación al pausar. La voz respeta fader/mute/solo/grupo/ruteo, selecciona PCM de «Repetir» y «Coro 1» según la navegación y restaura Guide sin alterar sus ajustes. Un probe AudioWorklet midió los samples reales en L/R, mute cero, cancelación y omisión de avisos tardíos. Sin escrituras de la UI. Resultados: `.lab/results/repeats-check.json` y `dynamic-guide-check.json`.

## Salto preparado: validación y límites

La pausa del recorrido anterior quedó medida con Providencia: primer PCM del destino 1,17–1,36 s después del límite hacia delante y 2,54–2,62 s hacia atrás, además de la espera musical. Dominaba la preparación de pistas posterior al límite. La inspección ARM64 de Playback encontró preparación y concatenación anticipada de PCM en su cola; no se midió su latencia en ejecución ni se reconstruyó toda la conexión Swift.

El prototipo usa un segundo juego de buffers y un cambio atómico en AudioWorklet. Conserva los 15 stems, faders, grupos, mute/solo, guía y ruteo. Cancelación y cambio compiten mediante un control compartido: una cancelación anterior al cambio descarta el destino; una posterior adopta el transporte que ya está sonando. Pausar, buscar o cambiar de canción libera la reserva.

La preparación en frío inicialmente alimentaba cabeceras y audio del inicio al mismo decodificador que después saltaba al preroll. La prueba de contenido detectó PCM distinto pese a posiciones aparentes correctas; se corrigió leyendo solo el índice antes de decodificar el destino. Después de la corrección, 4096 muestras de cada uno de los 15 stems en Coro 1 coinciden exactamente con el seek normal al mismo punto. Esta comprobación corta no sustituye una escucha completa.

Comandos adicionales:

```sh
npm run test:live-prepared-switch
npm run test:live-prepared-jump
npm run test:live-prepared-content
npm run test:live-prepared-repeat
```

La ruta nueva está limitada a Chrome de escritorio con SharedArrayBuffer y stems M4A. Necesita preparar todos los stems antes del límite; armar tarde puede descartar el salto, sin cortar la reproducción actual. Se mantienen como máximo dos juegos de productores/buffers: Providencia añade aproximadamente 28,8 MB de PCM cuando existe preparación o reserva, además de memoria de decodificadores y archivos. El contador de memoria del motor muestra el juego activo, no esa reserva adicional. No se verificaron Safari, iOS, salida física, funcionamiento sin conexión ni estabilidad prolongada.

La repetición corta se verificó con dos vueltas de una sección de 8 s: primera preparación 3,13 s y siguientes 1,58/1,50 s reutilizando productores, sin nuevos frames de underrun. La prueba de repeticiones/guía volvió a pasar con la nueva ruta, incluido fallo de biblioteca, restauración de Guide y anuncios según destino. Capturas de estados listos en 1728×1000 y 844×390 inspeccionadas. Estos tiempos son observaciones puntuales, no garantías de red.

La pasada final del salto preparado verificó ambos destinos con 15/15 stems, preparación de 3,16 s y 2,68 s antes del límite, error de cambio inferior a una muestra, dispersión entre pistas de 0 frames y ningún quantum silencioso en ±30 ms. Pasaron bloqueo de UI de 750 ms, Escape/pausa/seek, destino tardío y 14/15 preparados sin detener la canción. Resultados `.lab/results/prepared-jump-check.json`; salida física silenciada durante la captura PCM. TypeScript de los componentes/motor modificados y pruebas de procesador, recuperación de underruns, rutas y política de precarga aprobadas. No se ejecutó un build completo de Astro.
