# Handoff tecnico: Drift acumulado SPSC en iPhone Safari

## Sintoma actual

El motor SPSC arranca sincronizado y estable, pero en iPhone Safari con 7 stems la sincronizacion se destruye alrededor de 2:30 de reproduccion.

El problema aparece despues de haber habilitado:

- SharedArrayBuffer en produccion.
- Streaming SPSC con AudioWorklet + DedicatedWorker.
- Decodificacion AAC/M4A via MP4Box/WebCodecs.
- Fallback mono para iOS.
- Micro-sync por timestamp absoluto en el Worker.
- Correccion de drift en el Worklet usando reloj maestro.

Ultimo commit relacionado:

```text
b86deaf fix: add master-clock drift correction to SPSC worklet
```

## Prompt para pegar a otra IA

```text
Necesito que audites un motor multitrack web SPSC que usa SharedArrayBuffer, AudioWorklet y DedicatedWorker.

Sintoma:
En iPhone Safari, con 7 stems, la reproduccion arranca sincronizada pero alrededor de 2:30 la sincronizacion se destruye. En desktop funciona mejor. El problema parece drift acumulado o underflow/realineacion incorrecta.

Archivos criticos:
- public/workers/MultitrackWorkletProcessor.js
- public/workers/AudioProducerWorker.js
- src/services/StreamingMultitrackEngine.ts
- src/hooks/useMultitrackEngine.ts
- src/components/react/LiveDirectorView.tsx

Contexto tecnico:
- El Worklet mezcla todas las pistas.
- El ProducerWorker descarga por Range Requests, demuxea M4A/AAC con MP4Box, decodifica con WebCodecs y escribe PCM en SharedArrayBuffer.
- StreamingMultitrackEngine orquesta Worker, Worklet, seek, pre-flight, telemetry y fallback.
- La UI lee telemetria de SAB sin React state continuo.
- Los audios vienen de https://stems.alabanzaredilestadio.com con COEP/CORP/CORS correcto.

Cambios recientes sospechosos:
- MultitrackWorkletProcessor.js ahora usa currentTime del AudioWorklet como reloj maestro.
- Se agrego applyMasterDriftCorrection().
- Correccion fina: skip/hold microscópico de samples.
- Correccion dura: si una pista esta atrasada >40ms y hay data disponible, adelanta su read pointer.
- Si una pista esta adelantada >40ms, no se lee hacia atras; solo se hace hold gradual.

Necesito que busques:
1. Si el reloj maestro esta calculado correctamente dentro del AudioWorklet.
2. Si absoluteReadFrame puede desfasarse respecto al frame real del RingBuffer.
3. Si hay mismatch entre sampleRate del AudioContext, WebCodecs y tracks.
4. Si la correccion de drift puede pelear contra el ProducerWorker o contra el micro-sync de escritura absoluta.
5. Si el Worker escribe PCM viejo/stale o con timestamp incorrecto despues de 2 minutos.
6. Si availableRead/WRITE_INDEX/READ_INDEX permiten detectar underflow antes de que se destruya la sincronizacion.
7. Si el hard realign deberia ocurrir por pista o si debe pausarse todo el motor y resincronizar globalmente.
8. Si el Worklet esta corrigiendo pistas muteadas/solo/volumen cero igual que las audibles.
9. Si los logs/telemetria actuales son suficientes para saber que pista se va primero.

Objetivo:
Proponer un fix sample-accurate que mantenga los 7 stems sincronizados hasta el final en iPhone Safari sin re-render de React ni carga alta de CPU.
```

## Archivos involucrados

### 1. Worklet DSP y mezcla final

```text
public/workers/MultitrackWorkletProcessor.js
```

Responsabilidad:

- Mezcla todos los stems.
- Lee los RingBuffers.
- Maneja mute/solo/loop/fade/seek.
- Publica telemetria de tiempo y niveles.
- Contiene la correccion activa de drift agregada en el commit `b86deaf`.

Zonas a revisar:

- Constantes `SYNC_FINE_DRIFT_MS`, `SYNC_HARD_DRIFT_MS`, `SYNC_HARD_REALIGN_INTERVAL_FRAMES`.
- `getAudioContextTime()`.
- `getMasterPositionSeconds()`.
- `getMasterFrameForTrack()`.
- `applyMasterDriftCorrection()`.
- `advanceTrackReadFrame()`.
- `mixSharedTrack()`.
- `mixLocalTrack()`.
- `maybePostSyncDrift()`.

### 2. Worker productor, demux/decoder y escritura al SAB

```text
public/workers/AudioProducerWorker.js
```

Responsabilidad:

- Fetch con Range Requests.
- MP4Box demux.
- WebCodecs AudioDecoder.
- Fallback AAC mono/stereo para iOS.
- Escritura al RingBuffer principal.
- Micro-sync por `absoluteStartSample`.
- Retry/backoff de red.
- Seek serial / stale PCM guard.

Zonas a revisar:

- Construccion de `EncodedAudioChunk`.
- Calculo de `absoluteStartSample`.
- `writeNormalRingBufferIfAvailable()`.
- Padding/trimming de gaps.
- Actualizacion de `WRITE_INDEX_SLOT`.
- Manejo de `seekSerial`.
- Backpressure de `decodeQueueSize`.

### 3. Orquestador principal del motor

```text
src/services/StreamingMultitrackEngine.ts
```

Responsabilidad:

- Inicializa AudioContext, AudioWorklet, ProducerWorker.
- Crea SharedArrayBuffers.
- Orquesta play/pause/seek/pre-flight.
- Lee telemetria estable desde SAB.
- Decide fallback SPSC/legacy.

Zonas a revisar:

- `play()`.
- `pause()`.
- `seekTo()`.
- Pre-flight / sync barrier.
- `readStableStreamingTelemetryTime()`.
- `getSharedTelemetry()`.
- `runSyncAudit()`.
- Manejo de `producer-seek-ready`.

### 4. Hook usado por la UI

```text
src/hooks/useMultitrackEngine.ts
```

Responsabilidad:

- Decide si usar motor SPSC o legacy.
- Expone API de reproduccion para React.
- Maneja cleanup.
- Expone errores de carga.

Zonas a revisar:

- Detector `canUseAdvancedStreamingEngine`.
- Fallback a legacy.
- Construccion de URLs de tracks.
- Cleanup de Worklet/Worker.

### 5. Vista Live Director

```text
src/components/react/LiveDirectorView.tsx
```

Responsabilidad:

- UI principal del director.
- Selective loading de stems.
- Controles de transporte.
- Lectura pasiva de telemetria.
- Secciones / ChordPro / playhead.

Zonas a revisar:

- requestAnimationFrame de tiempo/playhead.
- Botones de secciones/seek.
- Estado visual de carga.
- Mutacion DOM directa para no re-renderizar continuo.

## Archivos que NO son fuente oficial

No analizar como fuente principal salvo que se necesite comparar:

```text
public/workers/AudioProducerWorker 2.js
logs/
```

Ambos estan sin trackear en git y pueden ser restos locales.

## Hipotesis iniciales para investigar

1. El Worklet corrige contra un reloj maestro correcto, pero `absoluteReadFrame` de alguna pista deja de representar el frame real leido.
2. El ProducerWorker podria estar escribiendo PCM con timestamps absolutos correctos al inicio, pero con drift despues de AAC padding/priming o timestamps de WebCodecs.
3. Puede existir mismatch de sampleRate entre `sampleRate` del AudioWorklet, `AudioData.sampleRate` y metadata del stem.
4. El hard realign actual solo adelanta pistas atrasadas si hay suficiente `availableRead`; si una pista se adelanta fuerte, solo hace hold gradual.
5. Si una pista entra en underflow en iOS, el Worklet podria seguir avanzando silencio y luego retomar desfasado.
6. La barrera de arranque puede asegurar el inicio, pero no garantiza que el Worker mantenga look-ahead uniforme por pista durante toda la cancion.

## Telemetria recomendada para la siguiente prueba

Agregar logs de baja frecuencia, solo cada 5s o cuando el drift supere 15ms:

```text
trackId
trackIndex
masterFrame
absoluteReadFrame
driftFrames
driftMs
availableRead
readIndex
writeIndex
sampleRate
decoderQueueSize
lastDecodedAbsoluteSample
lastWrittenAbsoluteSample
underflowEvents
```

No activar logs por chunk en iPhone; eso calienta y distorsiona la prueba.
