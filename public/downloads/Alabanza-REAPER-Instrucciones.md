# Guía rápida · REAPER y Alabanza

El flujo tarda tres momentos: prepara el ZIP, marca la canción en REAPER con el
asistente y súbela a Alabanza para revisar y aplicar. Hazlo una vez por cada canción
y versión del multitrack. La letra y los acordes se administran por separado en ChordPro.

## 1. Preparar

1. En **Administración → REAPER**, elige la canción.
2. Pulsa **Descargar proyecto + stems** y espera a que el ZIP termine.
3. Descomprime la carpeta completa y abre `Nombre - revisar.RPP` en REAPER. No
   abras el RPP dentro del ZIP ni separes la carpeta `Media`.

El ZIP incluye stems originales alineados desde el inicio, el asistente Lua,
esta referencia, la guía visual PDF y un mapa original para consulta. Los
marcadores iniciales vienen como borrador.

### Instalar o actualizar el asistente

REAPER ejecuta siempre el archivo que cargaste la primera vez. Para que cada versión
nueva se use sin volver a registrarla:

1. En REAPER abre **Options → Show REAPER resource path** y entra en `Scripts`.
2. Copia ahí `Alabanza-Asistente.lua` (reemplaza el anterior si ya existía).
3. Solo la primera vez: **Actions → Show action list → New action → Load ReaScript**
   y elige ese archivo. Después basta con **Run** (o asignarle un atajo).

Si ves botones como «Confirmar entrada aquí» o no ves los grupos «Sección» e
«Instrucción», REAPER está usando una copia antigua: repite el paso 2.

## 2. Marcar en REAPER

El asistente muestra cuatro pasos arriba: **1 Tempo y UNO → 2 Secciones → 3 FIN AUDIO
→ 4 Guardar**. El paso en el que estás va relleno en verde y dice «Estás aquí»; los
terminados muestran ✓ y «Listo», y los que faltan, «Pendiente». En cada paso hay una
sola acción principal, el botón verde grande: se ejecuta también con **Enter**. A la
izquierda ves todas las entradas con su tiempo: ✓ confirmada, ○ pendiente y ◆
instrucción; haz clic en una para ir a ella. Los nombres se muestran normalizados
(un marcador antiguo `final` se ve como «Final») sin cambiar el RPP.

Atajos: **Espacio** reproduce y detiene dejando el cursor donde paraste, **←/→**
recorren las secciones, **A** añade la sección elegida, **I** añade la instrucción
elegida y **Esc** cierra.

1. **Tempo y UNO.** Escucha el click con la música, coloca el cursor en el primer
   pulso real y pulsa **Marcar UNO aquí**. Para medir tempo, selecciona en la regla
   de un UNO a otro UNO posterior y cuenta los compases completos (inicio del compás 1
   al del 9 = 8 compases). Pulsa **Medir tempo** e introduce `8, 4, 4` en 4/4.
   REAPER no detecta automáticamente el compás ni el nombre de las secciones.
2. **Secciones e instrucciones.** Reproduce con Espacio y detén al empezar cada parte.
   La acción verde cambia según lo que falte:
   - con un borrador seleccionado, **Confirmar … aquí** (lo confirma en el cursor y
     selecciona el siguiente);
   - con una entrada ya confirmada y otras pendientes, **Ir a … (pendiente)**;
   - con todo confirmado, **Secciones listas · seguir a FIN AUDIO →**.

   Añadir es una acción secundaria: elige el tipo en el grupo **Sección** y pulsa
   **Añadir sección** (o **A**). El grupo arranca en «Elige sección» y solo propone un
   tipo («· sugerida») cuando la canción lo indica: si después de `Verso 1` vino
   `Coro 1`, tras `Verso 2` propone `Coro 2`; al principio de una canción sin Intro
   propone `Intro`. Nunca propone por su cuenta una segunda Intro, Final u Outro.
   Debajo, el grupo **Instrucción** tiene su propio desplegable, **Añadir** (o **I**) y
   **Quitar**. **Cambiar nombre** corrige la sección seleccionada sin moverla, y
   **Mover sección aquí** lleva una ya confirmada al cursor.
3. **FIN AUDIO.** **Ir al final del audio** lleva el cursor al final del ítem más
   largo. Escucha la cola y pulsa **Marcar FIN AUDIO aquí**. El último golpe del click
   y el final de las colas pueden ser puntos distintos.
4. **Guardar.** El resumen muestra secciones, instrucciones, tempo, UNO y FIN AUDIO.
   En rojo aparece lo que Alabanza exigirá antes de aplicar y en ámbar los avisos.
   **Guardar RPP y abrir Alabanza** guarda el archivo, abre la página de subida de la
   beta con la canción elegida y te dice dónde quedó el RPP. **Solo guardar** no abre
   el navegador.

No muevas los stems para compensar un desfase del mapa. Si el tempo cambia durante
la canción, conserva ese mapa de tempo en REAPER y no fuerces un solo BPM.

### Secciones e instrucciones: dos cosas distintas

- **Sección** define la estructura y sus límites: Intro, Verso, Pre-coro, Coro,
  Post-coro, Puente, Interludio, Instrumental, Solo, Rap, Vamp, Baja intensidad,
  Estribillo, Exhortación, Repetir, Outro y Final. Cada una crea una tarjeta en
  Live Director.
- **Instrucción** es un aviso hablado en un punto, que no crea ni mueve secciones:
  Sube intensidad, Pausa, Hits, Entra batería, Toda la banda, Sube tono, Baja tono,
  Suave, A capella, Swell, Final grande, Sostener, Última vez, Teclado, Bajo, Batería
  y Guitarra. Puede repetirse (Hits, Hits…). En REAPER se ve como un marcador violeta
  `[INSTRUCCIÓN] Hits`. Para quitarla, elígela en la lista y pulsa **Quitar**.

Las dos listas vienen de la biblioteca de voces de la app (`public/audio/guide-es`),
así que no hay que escribir nombres:

- El grupo **Sección** muestra el nombre final antes de añadirlo («Se llamará Coro 3»).
  Verso, Pre-coro, Coro y Puente siempre van numerados (tienen voz propia «Coro 2»);
  el resto se numera desde la segunda vez (`Interludio`, `Interludio 2`). Añade las
  secciones en el orden de la canción.
- **Otro nombre…** permite escribir una sección libre. Si no está en la lista, el
  asistente la marca en ámbar: se guarda, pero puede quedar sin voz guía.
- Los RPP anteriores siguen funcionando: sus marcadores sin prefijo son secciones.

### Canción nueva, sin secciones

1. En **Administración → REAPER** elige la canción. Si tiene stems, pulsa
   **Descargar proyecto + stems**; si no tiene secuencia, pulsa **Descargar proyecto
   (MP3)**: el RPP trae el MP3 final de la canción solo como referencia para marcar.
   Si la canción no tenía secciones, el RPP llega sin entradas, solo con `FIN AUDIO`
   en borrador.
2. Abre el RPP y el asistente, y sigue los cuatro pasos. En el paso 2, mientras no
   haya secciones, la acción verde es **Añadir … aquí**. Después, en cada cambio
   detén, elige el tipo en el grupo **Sección** y pulsa **A**. Calibra el tempo y el
   compás desde el UNO.
3. Sube el RPP y aplica el mapa (siguiente apartado). En una canción sin secuencia,
   el Live Director la toca con el **click digital** (tu tempo y compás) y el **pad
   interno**, con las secciones e instrucciones que marcaste. El MP3 no suena ahí.

Las secciones de REAPER mandan: si no coinciden con las del ChordPro, o la canción no
tiene ChordPro, Alabanza lo avisa pero aplica igual y quedan como las de la canción.

La **plantilla vacía** sirve para practicar o para un trabajo manual, pero no está
vinculada a ninguna canción: Administración no la deja aplicar y el asistente no se
abre en ella. Para aplicar, usa siempre el RPP descargado de la canción.

## 3. Subir y aplicar

1. **Guardar RPP y abrir Alabanza** abre **Administración → REAPER** en el paso de
   subida con la canción ya elegida. También puedes entrar a mano y elegirla.
2. Pulsa **Elegir archivo .RPP** y elige el archivo guardado. No tienes que subir otra
   vez los stems.
3. Revisa las alertas, las diferencias y los nombres/tiempos. Si hay un bloqueo,
   corrígelo en REAPER, guarda y vuelve a subir.
4. Desmarca cualquier sección que no quieras aplicar y pulsa **Aplicar mapa al
   multitrack**. Las instrucciones aparecen aparte y se aplican con el mapa, salvo
   las que queden fuera de UNO–FIN AUDIO.
5. Reabre la canción en Live Director para cargar el mapa actualizado.

La aplicación cambia únicamente el mapa de la sesión multitrack (secciones,
instrucciones y tempo). No modifica la canción original, sus letras, acordes ni
arreglos de eventos.

## Qué hace Live Director con el mapa

Con las herramientas experimentales, y en sesiones que tienen pista Guide, la guía
dinámica:

- dice cada **instrucción** antes de su punto, con la misma anticipación, volumen y
  salida que los avisos de sección, también durante la reproducción normal;
- anuncia las **secciones** al saltar o repetir una sección y en los arreglos de
  evento, con conteo cuando hace falta.

Las instrucciones no crean tarjetas: aparecen como marcas finas en el minimapa y
como «Próx. instrucción» en la barra de secciones. El botón del megáfono, en esa misma
barra, abre la lista **Instrucciones** para decir una en el momento. Una canción sin
pista Guide guarda el mapa igual, pero todavía no oye la guía dinámica.

## Solución rápida

- **Audio no encontrado:** descomprime de nuevo todo el ZIP; conserva juntas la
  carpeta del proyecto y `Media`.
- **Tempo o entradas se separan al final:** confirma que mediste entre dos primeros
  pulsos, contando compases completos; revisa un posible cambio de tempo.
- **El botón Aplicar está deshabilitado:** corrige los bloqueos estructurales que
  muestra el informe y vuelve a subir el RPP.
- **El RPP no coincide con la canción:** vuelve a Administración y elige el tema
  correcto antes de cargarlo.
- **«Ese nombre ya existe»:** cada aparición necesita su número. Usa el nombre que
  propone el grupo Sección o cambia el número con **Otro nombre…**.
- **Una sección no dice su nombre en Live Director:** si el asistente la muestra en
  ámbar, renómbrala con **Cambiar nombre**.
- **Una instrucción no suena:** comprueba que esté entre UNO y FIN AUDIO y que la
  canción tenga pista Guide.
