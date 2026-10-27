Samples de guía en español aportados por el usuario desde «Click and Guide Samples». Copia local para la rama experimental. Derivados WAV mono PCM16 a 24 kHz, silencio inicial/final recortado y pico normalizado a 0.75. El manifiesto conserva el nombre de origen. No se usan los archivos de análisis .asd ni los clicks.

Cada voz del manifiesto tiene `kind`: `section` (Song Sections: nombran una sección y marcan su límite), `instruction` (Guide Cues: avisos puntuales que no crean secciones) o `count` (1–7, conteo de entrada).

Las instrucciones nuevas se generan con `node scripts/prepare-guide-cues.mjs "<carpeta Guide Cues>"`: recorta en torno a −60 dB, conserva 40 ms de cola y normaliza el pico a 0.75. Hold y Last Time ya existían y conservan su audio original. Después ejecuta `npm run reaper:sections` para actualizar el asistente de REAPER.
