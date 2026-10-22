# Laboratorio local de Providencia

Rama `codex/livedirector-providencia-lab`, base `main` en `483d1cf`. Sin push, merge ni despliegue. Providencia se lee desde una copia de sus metadatos y sus 15 stems existentes; este laboratorio no guarda cambios en Alabanza.

## Prueba manual habilitada

```sh
npm run lab:providencia
```

Abre **http://127.0.0.1:4322/** en Chrome. La pantalla monta el componente real de LiveDirector y selecciona Providencia; también permite cambiar a Tu palabra (JCA). Necesita `.lab/songs.json`, una copia privada de los metadatos existentes, ignorada por Git. Las mezclas se conservan sólo mientras esta página esté abierta y se reinician al recargar. La API local sólo admite GET/HEAD; las rutas de guardado y carga de archivos no están disponibles. No se copió `.env`.

La recuperación tras underrun está activa. Los cambios de sección del motor streaming ya usan `AudioGainRamp.ts` sobre `AudioParam`, con finalización observada en el reloj de audio, cancelación y detección de suspensión. Las rutas nativa, buffer y de tempo manual conservan su transición anterior. Los fades de congregación por stem siguen usando su implementación anterior.

El evento `render-error` ahora detiene el transporte, muestra un aviso y permite recargar. La recuperación requiere pulsar reproducir explícitamente. Si falla el procesador completo (`processorerror`), se recrea el nodo al recargar.

## Herramientas experimentales

Pulsa **Herramientas**, en la barra superior, para preparación y saltos. **Grupos** tiene un botón propio debajo de Mezcla/Secciones, en la columna junto al master; ocupa el mismo espacio que los faders.

- **Preparación**: muestra el inicio disponible de la canción actual, el número de stems, motor y salidas. No valida todo el repertorio ni garantiza reproducción sin conexión.
- **Salto de sección**: en **Secciones**, durante la reproducción un toque selecciona el destino; doble toque lo arma, o puedes confirmar con **Armar salto** en la propia línea de tiempo. En Mac, flechas para elegir y Enter para armar; Escape cancela. El selector alternativo de Herramientas comparte el mismo estado. Al terminar la sección actual solicita el cambio con fade y la barrera de preparación. Admite repetir una sección anterior. Pausar, mover la posición o llegar demasiado tarde cancela el salto; la línea de tiempo muestra el destino y un botón Cancelar. En mezcla/grupos aparece una fila de estado sin desplazar los controles de transporte.
- **Grupos**: usa exactamente `ChannelStrip`, el mismo fader vertical de Mezcla, con color por familia, nivel, S (solo de grupo), M (silencio) y medidores basados en telemetría de los stems. Ritmo, Armonía, Voces, Otros y Click/guía. Una ganancia adicional conserva los faders individuales, mute/solo y ruteo. En **Configurar grupos** puedes corregir la asignación sugerida o restaurar niveles/silencios/solos. No son buses de salida independientes. Los grupos conservan sus niveles, silencio y asignaciones al alternar entre mezcla, secciones y grupos. Se reinician al recargar o cambiar de canción y no se guardan.

El salto se solicita desde un temporizador de UI que consulta el reloj de audio cada 25 ms. No está programado a precisión de muestra: una interfaz ocupada o en segundo plano puede retrasarlo o cancelarlo. La preparación de PCM puede producir una pausa; no hay transición continua ni precarga PCM de la siguiente canción conectada a esta pantalla.

La precarga de archivos en `ModoEnsayoDirector.jsx` ya no marca éxito con solicitudes fallidas, HTTP omitidos, cargas concurrentes incompletas o cancelación. Libera las URLs que reservó al cancelarse. Ese contenedor no se monta en este laboratorio; el flujo se verificó mediante su función real con caché/red simuladas.

Verificación de la pantalla: `npm run test:providencia-lab`. Pasó en Chrome con 15 tracks en `streaming-worker`, niveles PCM no nulos, reproducción/pausa, cambio de canción, vista horizontal compacta y bloqueo HTTP 405 a escrituras. Resultados y capturas privados en `.lab/results/`.

Experimentos:

- Worklet: recuperar la posición exacta después de una falta de PCM conocida, sin conservar desfases inferiores al umbral normal de 15 ms. Descarta muestras atrasadas; no recupera audio perdido. Fuera de loops.
- Worklet: emitir una sola notificación `render-error` ante excepción, detenerse y mostrar recuperación explícita en la UI.
- `src/services/AudioGainRamp.ts`: envolvente cúbica en AudioParam, conectada a los saltos del motor streaming.

Pruebas locales:

```sh
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
