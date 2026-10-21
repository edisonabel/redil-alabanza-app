# Laboratorio local de Providencia

Rama `codex/livedirector-providencia-lab`, base `main` en `483d1cf`. Sin push, merge ni despliegue. Providencia se lee desde una copia de sus metadatos y sus 15 stems existentes; este laboratorio no guarda cambios en Alabanza.

Experimentos:

- Worklet: recuperar la posición exacta después de una falta de PCM conocida, sin conservar desfases inferiores al umbral normal de 15 ms. Descarta muestras atrasadas; no recupera audio perdido. Fuera de loops.
- Worklet: emitir una sola notificación `render-error` ante excepción, conservando silencio. Falta integrar aviso/recuperación en la UI normal.
- `src/services/AudioGainRamp.ts`: envolvente cúbica en AudioParam, probada con Web Audio real. Prototipo aún no conectado al cambio de sección.

Pruebas locales:

```sh
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

La captura completa de trabajo falló por una lectura cancelada del proveedor de archivos; se preparó un checkout selectivo del código necesario. No copiar `.env` de producción ni activar guardados para la prueba. Para una futura prueba manual de la UI completa, preparar un almacén de datos de prueba y cubrir los endpoints de persistencia.

Los ensayos de Providencia fueron breves: ambas versiones pudieron reproducir 15 stems y tolerar un bloqueo UI de 750 ms sin underruns en esa fase. La repetición de main también pasó el seek sin underruns, por lo que no se atribuyen ventajas de rendimiento global a esta rama. Los beneficios demostrados están en la recuperación controlada de desfase y la temporización del fade. Falta la comparación de ejecución con Playback y pruebas prolongadas/dispositivos reales.
