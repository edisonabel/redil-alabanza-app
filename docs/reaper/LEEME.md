# Plantilla para mapear canciones en REAPER

Instalada como **File → Project templates → Alabanza - Mapear secciones**. También puedes abrir `Alabanza - Mapear secciones.RPP` y guardar enseguida una copia con el nombre de la nueva canción.

Incluye tres pistas vacías: Click, Guide y Referencia musical. Timebase de proyecto y pistas en **Time**, timebase del mapa de tempo en **Time**, velocidad 1, metrónomo de REAPER desactivado y Master inicial −12 dB. No contiene audio, marcadores ni mapa de Providencia. Los **120 BPM y 4/4 iniciales son valores de partida**, que debes revisar para cada canción.

1. Crear el proyecto desde la plantilla y usar **Save project as…** con el nombre de la canción y su propia carpeta. No guardar la canción encima de la plantilla.
2. Importar el Click en su pista, la Guide en la suya y una referencia musical en la tercera, todos desde su segundo cero original. Si utilizas todos los stems, añadir pistas separadas conservando su posición relativa y los silencios iniciales.
3. Medir/corregir BPM y confirmar compás. Marcar `UNO` en el primer uno real, distinguiendo las subdivisiones. Ajustar la cuadrícula sin mover ni estirar el audio. Registrar cambios de tempo/compás donde existan.
4. Marcar las entradas: `Intro 1`, `Verso 1`, `Coro 1`, etc. El anuncio de la Guide puede anticiparse; su voz no define el inicio. Comprobar principio, mitad y final para detectar deriva.
5. Marcar `FIN AUDIO` en la duración original, incluyendo la cola. El último clic y el final del archivo pueden ser distintos.
6. Guardar el RPP de esa canción para revisar/importar sus marcadores. No hace falta renderizar otra vez los stems; conservar el mismo audio y el mismo cero de tiempo.

## Flujo desde Administración

En **Administración → REAPER**, elige la canción y descarga **stems para REAPER**. Es un ZIP único con Click, Guide e instrumentos como archivos independientes, más un LEEME; no se hace una mezcla estéreo. Abre la plantilla, importa los archivos desde el mismo cero de tiempo, añade marcadores y guarda el `.RPP`.

Puedes subir ese `.RPP` desde la misma pantalla. Administración guarda una copia asociada a la canción y muestra tempo, compás y marcadores para revisarlos. Esta copia no cambia todavía las secciones que usa el reproductor; así podemos revisar el mapa antes de aplicarlo a la beta.

La letra y los acordes siguen en ChordPro, en la ficha de la canción. Playback separa el audio de la letra: ChartBuilder muestra letra/acordes sincronizados, y las cues MIDI pueden mandar comandos a ProPresenter.

La plantilla no sustituye la confirmación del compás ni identifica automáticamente las secciones.
