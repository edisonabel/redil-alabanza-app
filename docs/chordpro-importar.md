# Importar ChordPro desde capturas y PDF · laboratorio

## Uso normal: una canción a la vez

En **Administración → Importar ChordPro** (`http://localhost:4322/admin?area=chordpro`):

1. **Canción:** escribe parte del nombre; solo aparecen las canciones que aún no tienen ChordPro.
2. **Captura:** pega con ⌘V (o arrastra, o elige imágenes/PDF). Si la canción ocupa varias capturas,
   pégalas en orden.
3. **Transcribir con IA:** usa la misma clave de OpenAI de la app en modo económico (`gpt-5.4`,
   razonamiento bajo): la IA solo lee acordes y letra; la posición la pone la imagen, gratis.
   Gasto medido en el piloto: unos 4–6 mil tokens por canción, más poco por cada línea dudosa.
   Si quedan líneas dudosas aparece **Releer con más precisión** (`gpt-5.5`): cuesta varias veces
   más y solo se usa si lo pulsas.
4. Revisa el ChordPro al lado de la imagen (arriba aparecen las líneas dudosas) y pulsa **Guardar**.
   Solo se guarda si la canción sigue sin ChordPro.

Funciona en el laboratorio de la Mac porque usa el OCR de macOS; en un servidor sin macOS responde
que no está disponible. Lo de abajo es la importación por carpeta, para cargas grandes.

Carga masiva de ChordPro priorizando la exactitud. Corre en la Mac (usa el OCR y PDFKit de
macOS) con la misma clave de OpenAI de la app (`OPENAI_API_KEY`). No escribe en la base de
datos: deja borradores que se revisan y aprueban en **Administración → Importar ChordPro**.

## 1. Preparar la carpeta

- **Una canción por archivo:** `Aquella Cruz.png`, `La Gloria de la Cruz.pdf`.
- **Varias capturas de una canción:** una subcarpeta con el nombre de la canción y las capturas
  numeradas en orden (`Bendito Jesus/1.png`, `Bendito Jesus/2.png`). Pueden solaparse.
- Los PDF se convierten a imagen página por página; todo sigue el mismo camino.
- El nombre del archivo o de la carpeta se usa para encontrar la canción en el catálogo. Si no
  coincide, se busca el título dentro de la imagen.

Para la máxima exactitud, haz **capturas con zoom solo de la canción**: letra y acordes grandes,
sin la barra lateral ni la página completa. Con letra pequeña bajan mucho las líneas verificadas.

## 2. Ejecutar en la Mac

```bash
npm run chordpro:importar -- "/ruta/a/la/carpeta"
```

Opciones: `--solo "Bendito"` (una canción), `--presupuesto 150000` (tope de tokens por corrida),
`--preciso` (modelo fuerte, mucho más caro), `--modelo`, `--razonamiento`, `--relectura-total` (relee todas las líneas: más exacto y
mucho más caro), `--sin-relectura`, `--forzar` (transcribe aunque ya tenga ChordPro).

### Cuidar los tokens de OpenAI

- Cada canción cuesta una lectura completa más una relectura **solo de las líneas que la imagen no
  confirma**. Las canciones que ya tienen ChordPro no gastan nada.
- Cada respuesta queda en caché en la Mac (`.lab/chordpro-import/cache`): volver a correr las mismas
  imágenes no cuesta nada.
- Al pasar `--presupuesto` no empieza canciones nuevas; avisa cuántas faltan.
- Empieza con pocas canciones (`--solo`) y revisa `informe.md`, que muestra los tokens usados.

Por cada canción:

1. Lee el catálogo y **omite las canciones que ya tienen ChordPro**, sin gastar tokens.
2. El modelo lee la hoja completa: secciones, acordes de cada línea y letra exacta.
3. El OCR de macOS ubica cada letra en la imagen y un análisis de píxeles ubica cada acorde.
   Si hay tantos acordes en la imagen como en la lectura, cada uno se coloca exactamente sobre su
   sílaba.
4. Las líneas que la imagen no confirma se **releen solas** desde un recorte ampliado ×3. Si las
   lecturas no coinciden, una tercera lectura con más zoom desempata; si no hay mayoría, la línea
   queda marcada para revisar. Una medición de 0 acordes nunca reemplaza una lectura con acordes.
5. Las secciones que la hoja no nombra se marcan como «nombre deducido».

El resultado queda en `<carpeta>/_alabanza/`: `borradores.json`, un `.cho` por canción e
`informe.md` con líneas verificadas y tokens usados.

## 3. Revisar y aprobar

1. **Administración → Importar ChordPro → Cargar borradores.json.**
2. Cada canción muestra la imagen original al lado del ChordPro editable, y arriba la lista de
   lo que hay que revisar (número de línea y motivo).
3. Si no se emparejó sola, elige la canción en «Canción del catálogo» (solo aparecen las que no
   tienen ChordPro).
4. **Aprobar y guardar.** «Aprobar N listas sin revisión pendiente» guarda de una vez las que
   salieron completamente verificadas.

Antes de guardar se vuelve a leer la canción: si alguien guardó ChordPro mientras tanto, no se
sobrescribe. El laboratorio usa la base de datos real, así que lo aprobado queda guardado en la
canción.

## Pruebas

`npm run test:chordpro-import` (lógica: sílabas, tinta, colocación, catálogo) y
`npm run test:chordpro-import-ui` (panel con Supabase simulado; nunca escribe en la base real).
