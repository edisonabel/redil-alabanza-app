# Laboratorio local de Providencia

Rama `codex/livedirector-providencia-lab`, base `main` en `483d1cf`. Sin push, merge ni despliegue. Providencia se lee desde una copia de sus metadatos y sus 15 stems existentes; este laboratorio no guarda cambios en Alabanza.

## Prueba manual habilitada

```sh
npm run lab:providencia
```

Abre **http://127.0.0.1:4322/** en Chrome. La pantalla monta el componente real de LiveDirector y selecciona Providencia; también permite cambiar a Tu palabra (JCA). Necesita `.lab/songs.json`, una copia privada de los metadatos existentes, ignorada por Git. Las mezclas se conservan sólo mientras esta página esté abierta y se reinician al recargar. La API local sólo admite GET/HEAD; las rutas de guardado y carga de archivos no están disponibles. No se copió `.env`.

La recuperación tras underrun está activa. Los saltos armados y repeticiones en Chrome de escritorio preparan el destino mientras la sección actual sigue sonando y cambian todos los buffers en el reloj de AudioWorklet. Las búsquedas manuales y los botones Anterior/Siguiente conservan su transición con fade y seek. Las rutas nativa, buffer y de tempo manual conservan su transición anterior. Los fades de congregación por stem siguen usando su implementación anterior.

El evento `render-error` ahora detiene el transporte, muestra un aviso y permite recargar. La recuperación requiere pulsar reproducir explícitamente. Si falla el procesador completo (`processorerror`), se recrea el nodo al recargar.

## Interfaz experimental

El botón Herramientas se retiró. En escritorio (desde 1100 × 760) se ven secciones arriba y mezcla o grupos debajo, con un solo encabezado de sección. En horizontal compacto se alternan secciones y mezcla. **Grupos** conserva un botón propio junto al master y exactamente los mismos faders verticales.

- **Salto de sección**: en **Secciones**, durante la reproducción un toque selecciona el destino; doble toque lo arma, o puedes confirmar con **Armar salto** en la propia línea de tiempo. En Mac, flechas para elegir y Enter para armar; Escape cancela. Prepara el destino antes de terminar la sección actual y muestra un punto ámbar mientras prepara y verde cuando está listo, junto al destino y Cancelar. Al llegar al límite, AudioWorklet cambia todas las pistas juntas sin pausar ni vaciar sus buffers. Si falta una pista o llega tarde, continúa la canción sin saltar. Admite repetir una sección anterior. Pausar, mover la posición o llegar demasiado tarde cancela el salto; la línea de tiempo muestra el destino y un botón Cancelar. El estado está junto a Secciones; ya no hay una segunda barra sobre la navegación.
- **Grupos**: usa exactamente `ChannelStrip`, el mismo fader vertical de Mezcla, con color por familia, nivel, S (solo de grupo), M (silencio) y medidores basados en telemetría de los stems. Ritmo, Armonía, Voces, Otros y Click/guía. Una ganancia adicional conserva los faders individuales, mute/solo y ruteo. En **Configurar grupos** puedes corregir la asignación sugerida o restaurar niveles/silencios/solos. No son buses de salida independientes. Los grupos conservan sus niveles, silencio y asignaciones al alternar entre mezcla, secciones y grupos. Se reinician al recargar o cambiar de canción y no se guardan.

### Repeticiones y guía dinámica

En **Secciones**, con la canción sonando:

- **Icono de repetir** repite la sección actual una vez y sigue su recorrido normal.
- **∞** repite la sección actual hasta volver a pulsar **∞**. Se muestra el número de vueltas completadas.
- Volver a pulsar **∞** deja acabar la pasada actual y continúa hacia la siguiente sección. Pausar o mover manualmente la posición cancela el modo. Armar un salto reemplaza la repetición pendiente.
- **Guía automática**: sin interruptor, prepara las voces españolas suministradas por el usuario. Conserva la grabación Guide en recorrido normal. Anuncia únicamente el destino de un salto o «Repetir», cuando el destino está preparado; atenúa solo el stem Guide durante esa ventana mediante el reloj de AudioWorklet y lo restaura al límite. Cancelar o pausar limpia la voz y la atenuación. Si falla la biblioteca, la guía grabada sigue y aparece un pequeño icono para reintentar. No altera el click de la canción.

El volumen, mute, solo, grupo y salida de la voz se toman de la pista Guide. La voz mono se enruta únicamente a izquierda o derecha según esa pista. Los samples se programan en Web Audio aproximadamente cuatro pulsos antes de la entrada, ajustando el margen a la duración de la frase. Si se arma demasiado tarde para pronunciarla antes del cambio, se omite ese aviso; el salto sigue pendiente. Pausar o cambiar de destino cancela voces programadas.

Se importaron 44 muestras mono PCM16 a 24 kHz (1.7 MB), derivadas de `Click and Guide Samples/Spanish Guides`. Se recortó silencio y se normalizó el pico a 0.75. El manifiesto de `public/audio/guide-es/` registra los nombres originales. No se importaron proyectos Ableton ni archivos `.asd`.

La repetición usa el mismo cambio preparado que los saltos armados en Chrome de escritorio. Se conserva un productor de reserva para reutilizar índices y decodificadores en la siguiente vuelta. Todas las pistas deben tener audio real alineado y al menos 0,5 s de reserva; no significa descargar toda la canción. Si la preparación no llega a tiempo, se cancela la repetición y la canción sigue su recorrido. La primera preparación necesita margen, especialmente con muchos stems o red lenta. La guía anuncia destinos preparados y omite avisos que ya no caben antes del límite. El guiado es de nombres de sección y repetición, no reproduce todos los avisos/count-offs que pudiera contener la guía grabada.

El temporizador de UI de 25 ms supervisa el estado. En el salto preparado, el límite y el cambio de todos los buffers se ejecutan en AudioWorklet, incluso si la UI se bloquea. Las rutas que no admiten preparación conservan fade y seek. No hay precarga PCM de la siguiente canción conectada a esta pantalla.

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

## Interfaz, guía automática y precisión de faders · 22 de octubre de 2026

Se eliminó el control Herramientas y el interruptor de guía. La fila de Secciones contiene los iconos de repetir/∞ y solo muestra destino/cancelación cuando procede. Escritorio combina secciones y faders; 844×390 conserva páginas alternas. Ajuste de desfase experimental con entrada de 1 ms y botones de 10 ms; es local, no guarda en base de datos. No se alinearon marcadores automáticamente a un compás supuesto.

La interacción de stems y grupos antes solo enviaba volumen al soltar y cuantizaba al 1 %. Ahora envía valores continuos durante el arrastre, conserva el punto de agarre de la perilla y permite Shift para movimiento fino. Flechas ±1 %, Shift+flechas ±0,1 %, Home/End. El master comparte el mismo componente de control. La escala de ganancia sigue siendo lineal; no se inventó una curva de Playback no demostrada.

La lectura de la guía grabada se atenúa por muestra en una ventana de tiempo de audio, con rampas de 5 ms, únicamente para avisos de navegación. Por defecto no se aplica override a Guide. Pruebas de procesador verifican default sin atenuación, ventana, cancelación, restauración en cambio preparado, mezcla/grupo/ruta conservados y ausencia de efecto sobre otra pista. Los 44 samples siguen pasando PCM L/R, mute y cancelación.

Pruebas: `npm run test:live-ui`, `test:live-fader-precision`, `test:live-guide-duck`, `test:live-dynamic-guide`. Las capturas 1728×1000, 1280×800 y 844×390 están en `.lab/results/minimal-*.png`. `test:live-tools` es ahora alias de la verificación de interfaz mínima; el antiguo dialog no se monta. La investigación del mapa musical y el metrónomo está en el informe del repositorio de análisis, fuera de este checkout. El editor de arreglo sigue pendiente. El metrónomo de subdivisiones se añadió en la iteración siguiente, descrita abajo.

Verificación final de esta interfaz: guía automática y fallo/reintento de voces, repetición única, dos vueltas, salida y salto con 15 stems aprobados; respuesta de fader al arrastrar y master fino aprobados. La regresión de saltos preparados pasó con límite dentro del bloque, UI bloqueada 750 ms, cancelación y 14/15 pistas preparadas sin parar el recorrido original. No hubo errores de página ni escrituras HTTP. La comprobación final de tamaños también incluye 1280×720, que usa vistas alternas por falta de altura.

## Metrónomo por capas · 22 de octubre de 2026

Pulsa el nombre **Click** debajo de su fader para abrir el metrónomo. El click grabado sigue seleccionado por defecto. Con la reproducción pausada, revisa BPM (en negras), pulso de referencia en segundos y compás; pulsa **Click generado**. Carga las cuatro muestras Classic proporcionadas por el usuario antes de sustituir el PCM del stem Click. Un error de carga deja seleccionado el click grabado y permite reintentar. Cerrar el panel conserva el modo y niveles mientras permanece esta canción abierta; cambiar de canción o recargar los reinicia. No se guardan en la base de datos.

Cinco faders reales de `ChannelStrip`: acento, blancas, negras, corcheas y semicorcheas, con S/M por capa y ajuste fino. Las blancas reutilizan quarter. Corcheas añaden los contratiempos y semicorcheas los pulsos intermedios restantes. El acento está desactivado hasta marcar explícitamente que el pulso de referencia es el primer pulso de un compás y que el compás es correcto. Cambiar cualquier dato del mapa borra esa confirmación. El 4/4 inicial es un valor editable, no un análisis confirmado de la canción.

Todas las capas siguen volumen/grupo/mute/solo/salida del stem Click y el master existente. Solo se sustituye su PCM audible; el archivo sigue consumiéndose para conservar la sincronización y permitir restaurarlo. No se mezclan la grabación y el click generado a la vez. La generación usa la posición fuente del mismo AudioWorklet que mezcla los stems: al saltar o repetir adopta la fase del destino dentro del mismo bloque, sin temporizador de UI ni AudioContext separado. Las muestras se decodifican a la frecuencia real del contexto; los eventos usan posiciones absolutas redondeadas a frames, sin acumular el redondeo de intervalos.

**Límites actuales:** tempo y compás constantes por canción; no hay importador/editor de cambios internos, detección automática de mapa ni ajuste automático de marcadores. El pulso sugerido es el primer marcador de sección ya desplazado; necesita comprobarse con la grabación. En Providencia los pulsos y 120 BPM están verificados, pero el primer compás y los finales 1/3 aún no están confirmados. Mantener acento apagado permite probar subdivisiones sobre la cuadrícula de negras sin inventar ese dato. El generador sigue la duración del archivo Click, incluido su silencio final; no detecta automáticamente el final musical. El metrónomo de canciones manuales Click+Pad conserva su motor previo.

Pruebas nuevas:

```sh
npm run test:live-generated-click
npm run test:live-click-audio
npm run test:live-click-ui
```

El procesador real, ejecutado en VM con PCM controlado, verifica todas las capas, rejilla fraccionaria sin deriva acumulada, 6/8, pausa/reanudación, cambio preparado dentro del bloque, rutas, mezcla y restauración del archivo. Un navegador real compara la salida del AudioWorklet contra las muestras Classic ubicadas en una lista de eventos de referencia, incluyendo 750 ms de bloqueo de UI. La integración con la pantalla verifica carga fallida/reintento, acento pendiente, faders finos durante reproducción, bloqueo de edición de mapa, retorno a grabado y salto preparado con los 15 stems reales. Salida física silenciada; sin escrituras HTTP. No sustituye escucha musical ni prueba prolongada con la interfaz de audio del culto.

## Calibración de Tu palabra (JCA) · 22 de octubre de 2026

El click grabado mide 68,5 BPM constantes; el snapshot de la canción declara 68. Usar 68 BPM acumula aproximadamente 1,66 s de diferencia al pulso 258. Además, su primer marcador desplazado (4,633 s) no cae sobre la rejilla del archivo Click: queda unos 248 ms después de la negra más cercana. Por eso no se debe derivar el origen del metrónomo de un marcador manual sin verificarlo.

`lab/click-grids.json` separa las calibraciones medidas de los marcadores de sección: Providencia conserva 120 BPM y referencia 12,5 s; Tu palabra usa 68,5 BPM y referencia de ataque del click de 0,005 s, redondeada al milisegundo. `generatedClickGrid` permite pasar esos datos explícitamente a LiveDirector. La barra de tempo conserva decimales, en lugar de redondear 68,5 a 69. La guía usa el tempo corregido en el laboratorio, pero no se cambió ningún marcador ni el snapshot de producción. El acento sigue sin confirmar: detectar pulsos no demuestra cuál es el primer pulso de compás.

La medición estudió el archivo completo, 517 pulsos de corchea. Se ajustaron los 258 ataques de timbre estable (corcheas a contratiempo), con cuatro umbrales; las cuatro variantes dan 68,500003 BPM y residual máximo de pico inferior a 0,030 ms. Inicio/mitad/final dan el mismo tempo dentro del redondeo observado. Los picos incluyen el ataque de la muestra: se usa el origen de ataque como referencia práctica, no se mueve un marcador para hacerlo coincidir con el pico. El valor de 0,005 s es una calibración auditiva inicial contra el archivo, no una reconstrucción a precisión de muestra de su origen en el DAW.

La prueba `npm run test:live-click-calibration` verifica ambos valores iniciales, BPM decimal visible, conservación de la rejilla al mover el desfase de secciones, búsqueda a 180 s y reproducción con los 14 stems de Tu palabra y señal real de Click. Se verificó también la reproducción inicial por separado.

La primera comprobación a 180 s descubrió un timeout de 13/14 productores: solo faltaba Click. La carga de cabeceras del inicio podía quedar suspendida por backpressure y continuar enviando AAC antiguo después de crear el decodificador del destino. Chromium anclaba sus timestamps de salida a ese audio antiguo. Se corrigió haciendo que `feedDemuxedSamples` capture siempre la generación de lookahead, incluso cuando el caller de carga inicial no pasa un token. El seek invalida esa generación y evita enviar sus muestras al decodificador nuevo. Se mantienen la espera por los 14 stems y las comprobaciones de contenido; no se sustituyó audio faltante por silencio.

`npm run test:live-producer-cancel` reproduce la cancelación de la carga inicial durante configuración de decoder, recuperación y backpressure, usando el método real del worker. La prueba de navegador que fallaba a 180 s pasa después del cambio. Evidencia privada anterior en `tu-palabra-late-seek-before.json` y posterior en `tu-palabra-late-seek-check.json`. Se conservan fuente grabada por defecto y acento desactivado.

Para revisar musicalmente los finales de Providencia se prepararon dos extractos privados (`.lab/results/providencia-outro-1.mp3`, `providencia-outro-3.mp3`): 14 s, con Click/Guide a izquierda y Drums/Bass a derecha, sin click sintético ni acento supuesto. Empiezan 9 s antes de cada marcador; el límite aparece en el segundo 9 del extracto. El mapa de compás sigue pendiente de validación por escucha. Ninguno de estos extractos ni stems se añadió a Git.

## Final real de la última sección · 22 de octubre de 2026

El constructor de marcadores daba +12 s a la última sección sin `endSec`. En Providencia eso dejaba Outro 3 en 317,5–329,5 s y la UI mostraba 5:29 cuando la ruta worker todavía informaba duración cero. Los 15 archivos originales tienen duración de presentación 340 s (5:40), y el análisis del tramo final confirma señal de bajo y guitarra después de 335 s: no conviene truncar automáticamente en 5:35.

El worker ya leía la duración del MP4, pero no la enviaba al motor al anunciar que una pista estaba lista. Ahora las tres vías `producer-track-ready` la incluyen. Se prefiere la duración de presentación (`movie_duration / movie_timescale`), que respeta la lista de edición, con fallback a la duración del medio. Así se evita sumar el padding AAC al tiempo visible. El motor conserva el máximo entre las duraciones conocidas de los stems.

Los marcadores visuales distinguen final explícito, siguiente marcador y estimación provisional. Solo la estimación provisional de la última sección se sustituye por la duración real del audio, después de aplicar el desfase a las entradas. El final del archivo es absoluto: variar el desfase de secciones no lo desplaza. El getter de duración real separa los metadatos del tiempo transcurrido estimado para mantener fijo ese límite incluso al superar EOF. Los límites explícitos del usuario se respetan. La resolución automática de la sección final está habilitada en la superficie experimental. No se modificaron marcadores ni datos de Alabanza.

Providencia queda en **Outro 3: 317,5–340 s (22,5 s)**, conservando todas las entradas anteriores. Esto también sirve para otras canciones cargadas: el final no está hardcodeado a Providencia. La fuente grabada y el comportamiento de transporte al alcanzar EOF conservan su implementación previa; este cambio resuelve la duración informada y el límite de sección.

Pruebas: `npm run test:live-terminal-section` y `npm run test:live-terminal-section-ui`. Casos de endSec ausente/null/vacío, duración desconocida, final explícito conservado, offset independiente, MP4 con padding AAC y evento de duración del worker. El navegador verificó 15 duraciones de 340 s, audio real de la cola después de 5:35, ausencia de repetición al antiguo límite y repetición preparada a 340 s hacia 317,5 s con 15/15 pistas. Sin errores de página ni escrituras HTTP; salida física silenciada. Captura y reporte privados en `.lab/results/terminal-section-check.json` y `providencia-full-ending.png`.

Extracto de escucha privado: `.lab/results/providencia-cola-5m25-5m40.mp3`. Es una mezcla reducida de instrumentos originales, de 5:25 a 5:40; 5:35 corresponde al segundo 10. No tiene click generado ni se subió a Git.


## Guías sin voces montadas · 22 de octubre de 2026

El usuario precisa que el último clic de Providencia está en **5:32**. Ese dato musical no equivale al final del archivo: se conserva la cola instrumental hasta 5:40.

La captura previa de un salto de Outro 1 a Outro 3 mostró la voz original desde unos 477 ms antes del aviso nuevo, con pico 0,545, mientras el silencio empezaba solo 15 ms antes. En ese caso no se midieron muestras simultáneas durante la voz nueva, pero sí se dejaba oír el comienzo de la frase original inmediatamente antes. No se generaliza esa captura a todos los saltos observados por el usuario.

Ahora el silencio completo de Guide se anticipa dos pulsos a la voz dinámica (1 s a 120 BPM, mínimo 250 ms), con la rampa de 5 ms para evitar clics. La voz espera confirmación del AudioWorklet: si falta, llega tarde o se cancela el plan, no arranca. Se reservan al menos 120 ms para programarla y se omiten avisos que ya no caben. La restauración se liga al límite preparado y nunca adelanta el final de la voz nueva más su margen de 120 ms, aunque el reloj estimado se corrija. El fader, grupo, mute/solo, ruteo y los demás stems mantienen sus valores; la guía grabada sigue sonando en el recorrido normal.

Pruebas `test:live-guide-duck`, `test:live-dynamic-guide`, `test:live-guide-exclusion`. El worklet valida confirmación, protección de la cola de voz, cancelación y conservación del resto de mezcla. La prueba del reproductor comprueba que no hable antes de la confirmación, con confirmación tardía, rechazada o cancelada. La prueba integrada usa los 15 stems reales, aísla Guide antes del master y resta esa señal a la mezcla para medir la voz secundaria muestra por muestra. Salto a Outro 3 y repetición: pico original cero en la ventana protegida, voz nueva audible y cero muestras solapadas; la repetición incluye 750 ms de bloqueo de UI. Sin errores de página ni escrituras HTTP y salida física silenciada. Evidencia privada en `.lab/results/guide-exclusion-check.json`.

## Editor de arreglos · 22 de octubre de 2026

Botón **Editar** en la cabecera, disponible con la canción pausada, todos los stems listos y la ruta streaming-worker. El diálogo permite agregar una sección existente al final, duplicarla junto a la original, subirla/bajarla y quitarla del arreglo. Muestra las posiciones originales con precisión de milisegundos y la duración resultante. Conserva al menos una sección y admite hasta 80. Cerrar o cancelar descarta el borrador. Aplicar vuelve a la primera sección elegida; **Restaurar original** recupera el recorrido completo desde cero. Los cambios solo viven en esta pantalla: no se guardan, se descartan al recargar y no modifican los marcadores ni stems de Alabanza.

`liveDirectorArrangement.ts` mantiene identidades por ocurrencia y rangos fuente inmutables. El timeline visible, reloj, progreso y minimapa se proyectan al tiempo del arreglo; los decodificadores y el metrónomo conservan la posición fuente real. Elegir una copia repetida selecciona su ocurrencia, aunque dos entradas tengan exactamente el mismo audio. Al pausar, terminar o restaurar se reconcilian los relojes actualizados directamente por telemetría, evitando que una etiqueta conserve el tiempo o duración del arreglo anterior. Los tramos contiguos continúan directamente. Un cambio de recorrido prepara todos los stems con el motor existente y solo cambia de buffers en el límite renderizado; anuncia el destino mediante la guía automática con silencio confirmado de la grabada. Si la preparación falla, se pausa el arreglo y se muestra el motivo, sin omitir stems ni continuar por secciones quitadas.

Las repeticiones y saltos manuales tienen prioridad. Su cancelación del juego automático se distingue de un fallo de carga; al terminar, se retoma el orden editado. La repetición de una copia final conserva esa ocurrencia. Cada cancelación automática especifica su serial para no cancelar por accidente un salto manual nuevo. El final del arreglo se programa en AudioWorklet y deja el resto del quantum en cero, sin depender de un temporizador de interfaz. Pausa, seek, restauración y cambio de sesión cancelan ese final. Un final tardío se informa como fallido, en lugar de quedar pendiente indefinidamente.

Pruebas: `npm run test:live-arrangement`, `npm run test:live-arrangement-ui`. La prueba real construye **Intro 2 → Interludio 2 → Intro 2** (25 s), verifica ambos destinos con 15/15 stems, avisos de guía confirmados y parada en 100,5 s de fuente / 25 s de arreglo. También comprueba borrador cancelado, selección de copias, repetición manual seguida del orden editado, repetición de la última copia y restauración original. La prueba unitaria comprueba proyección temporal, rangos originales, identidades únicas, parada dentro de un quantum y cancelación. El diálogo conserva el comportamiento horizontal de LiveDirector. Capturas y reporte privados en `.lab/results/arrangement-*.png` y `arrangement-check.json`. Salida física silenciada; sin escrituras HTTP. No hay editor de límites, creación de audio nuevo, exportación ni persistencia del arreglo en esta primera prueba.

Una repetición de la prueba observó que el segundo destino de un tramo de 9 s no llegó a prepararse a tiempo; el arreglo se pausó en 285,481 s antes del límite de 285,5 s. El comportamiento de seguridad no se relajó. La anticipación disponible y la red siguen condicionando los tramos cortos; las mediciones exitosas no garantizan preparación a tiempo en toda sesión.

La revisión visual encontró dos estados desfasados de la telemetría imperativa: etiquetas de reloj que conservaban el valor del arreglo anterior y una carrera del contador de carga que podía volver a dejar el overlay después de terminar. Se reconcilian los relojes al pausar/cambiar recorrido y el texto del progreso se deriva al renderizar, sin otro efecto que escriba busyMessage tras finalizar. Editar también queda bloqueado mientras exista carga inicial o una operación ocupada.


## Edición sobre secciones y guardado por evento · 22 de octubre de 2026

Reemplaza el diálogo de la primera prueba: **Editar** muestra `+` entre las secciones, `−` en cada tarjeta y `···` para duplicar o mover. Conserva **Stems** en la cabecera. Se agregan Deshacer, Cancelar y Restaurar original dentro del borrador. Los controles de transporte y sus atajos se bloquean durante la edición. El ancho del editor se limita a su columna; solo las tarjetas se desplazan, manteniendo accesibles Aplicar/Guardar y Cancelar en 844×390, 1280×720 y 1728×1000.

Fuera de un evento, **Aplicar temporalmente** solo afecta la sesión actual y se descarta al cambiar de canción, salir o recargar. En un evento, **Guardar en este evento** usa un objeto separado por evento y canción: `live-director/event-arrangements/{evento_id}/{cancion_id}.json`. No escribe marcadores originales, sesiones ni stems. Restaurar original guarda un arreglo nulo para ese evento; la mezcla conserva su objeto independiente.

La autorización del servidor permite guardar arreglos y mezcla únicamente al **director musical asignado en ese evento** (cargo Talkback, mostrado como Director musical; compatible con el alias antiguo director_musical) y al **administrador**, conservando la excepción que pidió el usuario. Ser líder de alabanza, líder vocal, gestor de secuencias o tener el rol en otro evento no autoriza la escritura. Los demás músicos asignados pueden leer el arreglo y la mezcla; sus ajustes de faders no se envían al servidor.

El guardado comprueba pertenencia de la canción al repertorio, referencias válidas a secciones y firma de los marcadores/desfase originales. Usa revisión ETag con escritura condicional para rechazar una edición que sobrescriba otra versión. Si los marcadores originales cambian, se solicita revisión en lugar de reproducir silenciosamente un arreglo distinto. Una canción sin marcadores y sin arreglo guardado conserva su reproducción normal, con Editar desactivado. El primer play de un arreglo recargado busca la primera sección retenida antes de sonar.

Condiciones de escritura documentadas por [Cloudflare R2](https://developers.cloudflare.com/r2/api/s3/extensions/): `If-Match`/`If-None-Match` en PutObject y rechazo 412 de revisión incompatible.

Pruebas: `npm run test:live-event-access`, `npm run test:live-event-arrangement-ui`, `npm run test:event-mix`, `npm run test:live-arrangement`, `npm run test:live-arrangement-ui` y TypeScript de la superficie. Las APIs reales se compilan y ejecutan con autenticación, base y almacenamiento simulados. Chrome usa los stems reales con salida física silenciada y simula solo la persistencia del evento. Comprueba guardado/recarga, aislamiento entre eventos, descarte temporal, solo lectura, conflictos que conservan el borrador y restauración sin tocar la canción fuente.

**Alcance:** código y APIs preparados en la rama experimental, sin despliegue ni escritura real en R2/Supabase. El laboratorio normal sigue bloqueando escrituras; `?labEvent=<uuid>` es un punto de prueba para HTTP simulado, no un evento conectado a producción. `ModoEnsayoDirector` recibe el evento y su título en esta rama, pero su integración autenticada completa aún requiere una prueba en un entorno de ensayo con las APIs habilitadas. No se verificó Safari/iOS para este editor ni el guardado real del evento.


## Nivel por canción y repetición visible · 22 de octubre de 2026

Los botones **Una vez** y **∞ Hasta salir** se movieron de la barra de Secciones a la columna lateral, inmediatamente debajo de Grupos. Conservan sus estados, cancelación, salida al terminar la pasada y motor de saltos preparados. En escritorio llevan icono y texto; en horizontal compacto se conservan iconos de 24/26 px con nombres accesibles. El icono de Una vez incluye el número 1. No se duplican en la línea de tiempo y siguen accesibles en mezcla y grupos.

Un botón pequeño **Nivel canción**, debajo de Master, abre un ajuste de −24 a 0 dB en pasos de 0,1 dB y Restaurar 0 dB. Sirve para reducir las canciones más fuertes hasta equilibrarlas con la más suave. Es una ganancia fija por canción, separada de los faders individuales y multiplicada por la ganancia de grupo. No cambia el Master ni los archivos. Los stems reconocidos como Click/Guide quedan excluidos, incluso si se reasignan a otro grupo. La suavización de ganancia ya existente del worklet sigue activa.

El valor se guarda solo en `sessionStorage`, con contexto de evento/canción: recuerda el ajuste al cambiar entre canciones y recargar la misma pestaña durante la prueba; otros eventos mantienen su propio ajuste. No se envía a la mezcla del evento ni se guarda en el catálogo, y puede perderse al cerrar la pestaña. Si el almacenamiento está bloqueado, funciona en esa apertura. No incluye análisis LUFS, igualación automática, amplificación, compresión o limitador. Los pads del reproductor independiente mantienen su control previo. Disponible solo en la ruta experimental con ganancia de grupo.

Prueba `npm run test:live-song-level-ui`: Providencia a −6 dB aplica 0,5011872336 a la música y conserva Click/Guide en 1; mantiene valores de stems y Master; compone con mute de Ritmo, recupera al volver a la canción/recargar, aísla eventos y restaura 0 dB. Comprueba ambos botones, orden debajo de Grupos y visibilidad en 1728×1000, 1280×720 y 844×390. Chrome con stems reales y salida física silenciada; sin errores ni escrituras HTTP. Capturas y resultado privados en `.lab/results/song-level-*.png` y `song-level-loops-check.json`.

Regresión de repetición completa: `npm run test:live-repeats` pasó con 15 stems, una vuelta y continuación, dos vueltas en infinito, salida en el límite, cancelación al pausar y guía respetando mezcla/salida. Sin errores ni escrituras HTTP. TypeScript de LiveDirector también pasó.


## Medidor real y Auto picos · 22 de octubre de 2026

El botón Nivel incluye una barra discreta, color y pico retenido en dBFS. Un AudioWorklet en una rama silenciosa observa el bus de stems/guía después de Master, incluyendo la voz dinámica, sin duplicar audio. Retiene transitorios entre lecturas de UI y permite reiniciar el máximo. No mide el Pad Player independiente, la salida física ni true peak.

**Auto picos**, optativo dentro de Nivel canción, aprende una atenuación fija mientras reproduce: reduce la música si sus picos superan −6 dBFS después de Master. Nunca sube el nivel en pasajes suaves. Un acumulador separado suma la señal musical real con su mezcla/ruteo y excluye Click/Guide; estos no disparan la reducción ni cambian sus niveles. La suavización del motor sigue activa. Espera un segundo al activar/cambiar estado/reducir y rechaza datos atrasados más de 250 ms. La reducción sigue limitada a −24…0 dB. Puede funcionar con el panel cerrado; la corrección se conserva durante la sesión de la pestaña y Auto se desactiva al salir/recargar. El ajuste manual o Restaurar 0 dB lo apagan.

Es control de **picos observados**, no normalización LUFS ni limitador: no predice un pico futuro, no aumenta canciones suaves y no garantiza evitar saturación si los cues solos saturan o se alcanza el máximo de reducción. La indicación de salida completa permanece independiente. Los grupos/faders y los archivos conservan sus valores.

Se corrigió en la superficie experimental el envío inicial de Master: el primer valor podía preceder a la creación del grafo y quedar como aplicado aunque el motor arrancara en 1. Se reaplica una vez listo el motor, haciendo coincidir su ganancia audible con el fader (0,82 inicial).

Pruebas `npm run test:live-level-meter` y `npm run test:live-level-meter-ui`: suma/cancelación real, cues excluidos, PCM local/compartido, transitorio de una muestra, rama silenciosa y audio bit a bit idéntico con/sin análisis. Chrome carga los 15 stems reales y añade señales controladas **solo en su página aislada**: verifica salida después de Master, cue fuerte que no reduce música, ajuste de −4,3 dB hacia pico 0,49982 (≈−6 dBFS), estabilidad, pasaje suave sin subida, máximo reiniciable, persistencia fija/Auto apagado al recargar y tres tamaños de pantalla. Salida física silenciada y cero escrituras HTTP. También pasaron `node scripts/test-live-director-prepared-switch.mjs --metering` con 15 stems y regresiones de guía, click y finales. No se verificó Safari/iOS.

El flujo externo recomendado para el mapa musical es REAPER: conservar el cero de los stems, fijar los ítems de audio al tiempo, calibrar tempo/compases y crear secciones, guardar el proyecto y exportar marcadores con timecode. Su CSV no contiene por sí solo el mapa completo de tempo/compás. **El importador de estos mapas en LiveDirector aún está pendiente**. Informe con fuentes y pasos en el proyecto de análisis: `analysis/livedirector/FLUJO-REAPER-Y-AUTO-PICOS.md`. No se instaló otro editor ni se alteraron audios.


### Medidor integrado en el carril del Master

La barra horizontal bajo el rótulo se sustituyó por la barra vertical dentro del carril del fader Master, detrás de la perilla, con el mismo ancho y estilo de los stems. Responde al pico real después de Master: cian, ámbar y rojo según nivel; queda vacía al pausar. El máximo retenido y su reinicio siguen dentro de Nivel canción. El botón Nivel y Auto picos conservan su funcionamiento.

La lectura y el automático permanecen en su componente: la actualización visual se lleva al carril mediante un portal, sin renderizar toda la pantalla cada 50 ms. La superficie de arrastre/teclado conserva su capa y eventos. La prueba de navegador verifica que el medidor sea descendiente del carril, se llene con señal real controlada, baje ante una señal más suave, llegue a cero con Master en cero y se vacíe al pausar, además de la regresión de Auto picos y tres tamaños de pantalla. Capturas privadas: `.lab/results/master-rail-live-hot.png`, `master-rail-live-soft.png` y `level-meter-*.png`.


## Portadas, BPM/compás y estado del ruteo

Se restauraron las dos portadas reales del catálogo. La copia de prueba no incluía MP3/arte y por eso se dibujaban fondos de reserva; el servidor local ahora ofrece, por rutas fijas, las imágenes existentes `cover-500.webp` de esas dos canciones. Solo GET, sin subir arte ni modificar audio. LiveDirector acepta una portada directa por canción y en la cola, manteniendo la extracción MP3 anterior como alternativa cuando no se suministra una portada.

El bloque de tempo muestra **BPM arriba y compás abajo**. Las filas reales de ambas canciones no incluyen compás: se muestra **—/—**, con explicación de pendiente, en lugar de asignar 4/4 sin verificar. Tocar el bloque abre el metrónomo experimental; confirmar allí el compás/uno actualiza el encabezado. Cambiar el mapa invalida esa confirmación. No activa el click generado por sí solo ni escribe marcadores. Canciones de Click+Pad muestran el compás de su configuración manual y conservan el control de subdivisión por toque. Se admite un compás explícito suministrado como metadato a la vista para la futura integración del mapa; no se implementó el importador REAPER ni un mapa variable.

`npm run test:live-covers-meter-ui` comprobó ambas imágenes reales decodificadas, BPM decimal, estado pendiente, reflejo de una confirmación **de prueba** en 6/8 (no una afirmación musical sobre Providencia), invalidación al editar, click grabado conservado, cambio de canción y tres tamaños de pantalla. Sin errores ni escrituras. TypeScript de la vista pasó. Las expectativas del test de tempo manual se actualizaron al nuevo encabezado; ese test requiere el servidor Astro completo y no se ejecutó en el servidor aislado del laboratorio.

**Ruteo actual:** el motor streaming crea dos canales de salida; el diseño inicial separa Click/Guide a L (1) y música a R (2), con opción de invertir. Grupos modifica ganancias, sin asignación a canales físicos independientes. La prueba de Chrome detectó 2 canales actuales y 2 máximos en el dispositivo presente, con API para seleccionar dispositivo disponible. macOS enumeró los altavoces internos y un dispositivo virtual; no estaba conectada la M-Audio. La cifra de canales de los archivos fuente no representa las salidas de la interfaz.

El usuario propone una M-Audio posiblemente de 4 salidas. Distribución candidata **pendiente de implementación y prueba física**: 1 Click/Guide, 2 Ritmo/Bajo, 3 Armonía, 4 Voces/Extras; cuatro señales mono. Hace falta confirmar modelo y cuatro salidas independientes expuestas al navegador, implementar matriz/asignaciones y probar cada canal por separado, incluyendo guía dinámica, medidores y silencio seguro ante desconexión. Conectar la interfaz por sí solo no habilita esa matriz. Los niveles y el margen de cada bus siguen siendo necesarios para evitar saturación. REAPER y la activación en main permanecen pendientes.

La regresión `npm run test:live-click-ui` también pasó: fuente grabada por defecto, rechazo de mapa inválido, carga fallida/reintento, confirmación de uno, faders de capas, salto con 15/15 stems y restauración al click grabado.

## Marcadores corregidos en REAPER — 22 de octubre de 2026

Se importaron las 14 entradas que Edison corrigió directamente en `Providencia - revision WAV.RPP`. `lab/providencia-reaper-map.json` conserva los tiempos absolutos, los identificadores de sección, el nombre y SHA-256 del RPP, el uno corregido en 4 s y el final de audio en 340 s. Este mapa sustituye la referencia anterior del uno en 4,5 s. Los inicios son 12, 28, 60, 92, 100, 132, 164, 180, 212, 244, 276, 284, 300 y 316 s; no se redondearon ni ajustaron después de leer REAPER.

El servidor local aplica el mapa solamente a Providencia y fija `sectionOffsetSeconds: 0`, porque los tiempos de REAPER ya incluyen la posición absoluta en el audio. Los finales se enlazan con la siguiente entrada y Outro 3 termina en 340 s. Conserva los 15 stems, niveles y rutas; Tu palabra sigue usando sus marcadores anteriores. La referencia de click es ahora 4 s y el compás confirmado se muestra como 4/4. No se escribieron datos en Alabanza ni se alteró main.

## Plantilla REAPER y vista de secciones — 22 de octubre de 2026

`docs/reaper/Alabanza - Mapear secciones.RPP` es una plantilla sin medios ni marcadores, con pistas Click, Guide y Referencia musical, velocidad 1, timebase Time (pistas/proyecto/mapa de tempo), Master −12 dB y metrónomo apagado. Los 120 BPM y 4/4 son valores iniciales para revisar por canción. Se instaló y abrió desde File → Project templates en REAPER 7.82; la prueba se cerró volviendo a Providencia.

El editor reutiliza la envolvente visual decorativa de la línea de secciones; no mide picos PCM ni se usa para calibrar transitorios. Duplicar/reordenar una sección conserva su patrón. El minimapa inferior muestra bloques con colores CSS válidos (los acentos rgba antes recibían un sufijo hexadecimal inválido), números, posición de reproducción y rango visible. Sigue el arreglo, incluidas apariciones duplicadas, y mantiene navegación por puntero; añade teclado, con Home reutilizando el reinicio de transporte existente. Se muestra también en horizontal compacto. No se cambió la clasificación ni la ganancia de los grupos.

Validación: TypeScript y `npm run test:live-overview-ui`, con 15 stems, navegación por puntero/teclado, duplicado/reordenación/aplicación/cancelación, minimapa del arreglo, 1728×1000, 1280×720 y 844×390; conserva el aviso existente en vertical. Capturas y resultados en `.lab/results/section-visuals-check.json`, `editor-waves-*.png`, `section-map-*.png`. Salida física silenciada, sin escrituras HTTP.

## Buses por familia — 22 de octubre de 2026

La vista Grupos ofrece seis familias musicales fijas: Teclas / Pads (pianos, órganos, teclados, synths y pads), Guitarra acústica, Guitarra eléctrica, Bajos (incluidos bajos synth), Voces y Ritmo (batería, percusión y platillos). Click y guía conserva su bus separado; Otros reúne las pistas sin familia reconocible. Se muestran únicamente buses con pistas, con un máximo de ocho incluyendo esos dos auxiliares. Se reutilizan los mismos ChannelStrip y faders precisos de Mezcla. Los buses multiplican la ganancia de sus stems y conservan los faders individuales, asignaciones de salida y el ajuste por canción.

La clasificación usa el catálogo de instrumentos existente, admite nombres numerados/en español y distingue Electric Piano de guitarra eléctrica, Synth/Electric Bass de teclados/guitarras y Bass Drum de bajo. Se mantienen las reasignaciones manuales durante la prueba. Al vaciar un bus que estaba en solo, su solo deja de silenciar buses que sí tienen pistas.

Validación: `npm run test:live-mix-groups` (70 nombres, fallbacks por ID/archivo y seis familias), `npm run test:live-buses-ui` (los 15 stems, ganancia de todas las pistas de cada familia, independencia de bajos/ritmo, mute/solo, reasignación, conservación de volúmenes individuales y visibilidad en 1728×1000, 1280×720 y 844×390), TypeScript. Sin errores de página ni escrituras HTTP; salida física silenciada. Evidencia en `.lab/results/buses-check.json` y `buses-*.png`. No se cambió el motor de audio ni se configuraron salidas físicas nuevas.
