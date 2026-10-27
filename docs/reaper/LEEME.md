# Flujo asistido REAPER · rama experimental

La herramienta está en **Administración → REAPER** y se presenta como un wizard
de tres pasos: preparar el paquete, ajustar marcadores en REAPER y subir/revisar/
aplicar el mapa. **Descargar proyecto + stems** genera un ZIP con los audios
originales ya colocados en un RPP, los marcadores iniciales, el asistente Lua,
una referencia de texto y la guía visual PDF.

La guía breve de texto está en
[`public/downloads/Alabanza-REAPER-Instrucciones.md`](../../public/downloads/Alabanza-REAPER-Instrucciones.md),
y la guía visual de tres páginas con capturas está en
[`public/downloads/Alabanza-REAPER-Guia-visual.pdf`](../../public/downloads/Alabanza-REAPER-Guia-visual.pdf).
El asistente está en
[`public/downloads/Alabanza-Asistente.lua`](../../public/downloads/Alabanza-Asistente.lua).

El asistente guía cuatro pasos (Tempo y UNO, Secciones, FIN AUDIO, Guardar) con una
acción principal por paso (Enter), una lista de entradas con tiempo y estado, y dos
grupos separados: **Sección** (estructura, numeración automática con vista previa) e
**Instrucción** (avisos hablados que no crean secciones). Confirma la entrada del
cursor sin redondearla, mide tempo con compases completos y al final guarda el RPP y
abre `/admin?area=reaper&paso=subir&song=<id>` en la beta. No detecta automáticamente
el compás ni el nombre de una sección.

Las instrucciones se guardan como marcadores `[INSTRUCCIÓN] Nombre` (violeta). El
parser las separa en `instructions` y nunca las cuenta como secciones; al aplicar se
guardan en `multitrack_session.instructionMarkers` (solo las que están entre UNO y
FIN AUDIO). Los RPP anteriores no tienen ese prefijo y se leen igual que antes.

Las listas del asistente (`SECTION_TYPES`, `INSTRUCTION_TYPES` y el prefijo) se
generan desde `public/audio/guide-es/manifest.json` (campo `kind`) con
`npm run reaper:sections`
([`src/utils/guideSectionCatalog.ts`](../../src/utils/guideSectionCatalog.ts) decide
orden y etiqueta en español). Cada etiqueta se comprueba con `resolveGuideCue`, y
`npm run test:reaper-sections` falla si el bloque generado no coincide con el
manifiesto o si algún nombre no llega a una voz guía. Las voces de instrucción se
generan con `scripts/prepare-guide-cues.mjs` (ver `public/audio/guide-es/README.md`).

Al subir un RPP, Administración guarda una copia por canción, muestra diferencias
con el mapa actual y advierte sobre borradores, duplicados, límites, audio movido o
estirado y mapas variables. Desde ese informe se puede aplicar explícitamente el
mapa validado a la sesión multitrack. La aplicación conserva letras, catálogo y
arreglos de eventos. El mapa ya integrado de Providencia no se altera.

La plantilla vacía sigue disponible para trabajo manual. Sus 120 BPM y 4/4 son
valores iniciales que se deben revisar por canción.

Acceso directo en desarrollo: `http://localhost:4322/admin?area=reaper`.

Validación: `npm run test:reaper-project`, `npm run test:reaper-sections`, `npm run test:live-guide-instructions`,
`npm run test:live-guide-instructions-ui` (arranca el laboratorio Providencia; necesita red), `npm run test:reaper-preparation`,
`npm run test:reaper-upload`, `npm run test:reaper-ui`. El último usa el componente
real con WAV sintético y almacenamiento simulado; nunca visita el Admin autenticado.
Para la lógica del asistente: Lua 5.3+ con `scripts/test-reaper-assistant.lua`
(o `npm exec --yes --package=fengari-node-cli -- fengari scripts/test-reaper-assistant.lua`).
La prueba de Lua simula la API de REAPER; no sustituye la comprobación visual nativa.
