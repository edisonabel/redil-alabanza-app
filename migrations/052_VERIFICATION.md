# Repertorio exclusivo de Sin Filtros

Aplicar `052_sin_filtros_repertoire.sql` después de la migración 051 y **antes de publicar el código**. La aplicación consulta la nueva columna `canciones.repertorio` y la función de acceso.

Todas las canciones existentes conservan `general`. La migración no mueve ni duplica canciones.

## Acceso

- Miembro de Alabanza general: ve el repertorio general.
- Miembro de Sin Filtros, incluyendo quien sirve en ambos: ve ambas bibliotecas.
- Administrador: acceso a ambas bibliotecas.
- Gestor operativo: puede cargar/editar SF únicamente si también pertenece a Sin Filtros. La carga conserva los permisos administrativos actuales; ser miembro o líder por sí solo no concede permiso para cargar canciones.

El botón **Cargar canciones de Sin Filtros** abre `/admin/sin-filtros`. Esa pantalla carga solamente SF y crea canciones con `repertorio = 'sin_filtros'`. `/admin` carga y crea canciones generales. Ninguna de las pantallas ofrece un selector que cambie accidentalmente el destino.

## Comprobación manual

1. Con administrador o gestor miembro de SF, abrir Repertorio y pulsar el botón de carga SF. Crear una canción con sus recursos. Confirmar que solo aparece en la administración SF.
2. Abrir la biblioteca Sin Filtros: la canción debe mostrar la etiqueta incluso en la lista compacta. Cambiar a General: no debe aparecer.
3. Con miembro solo de Alabanza general, confirmar que no aparecen la biblioteca SF ni sus canciones. Una lectura directa por ID y la API Live Director deben devolver ningún registro/404.
4. Programar un evento SF: se pueden seleccionar canciones de ambas pestañas y conservar la selección al cambiar de pestaña.
5. Programar un evento general con usuario que pertenece a ambos: solo se ofrecen canciones generales. Enviar un ID SF directamente al API debe ser rechazado. La base de datos también rechaza INSERT/UPDATE directo, cambios de evento de playlist y cambios de ministerio que introducirían una canción SF en el grupo general.

## Pruebas locales

```sh
PGLITE_MODULE_PATH=/ruta/a/@electric-sql/pglite/dist/index.js node scripts/test-song-repertoire-database.mjs
node scripts/test-admin-chordpro-workflow.mjs
node scripts/test-event-scheduling.mjs
node scripts/check-migration-history.mjs
npm run build
```

La prueba PostgreSQL valida la migración real, visibilidad por rol/membresía, carga restringida y cambios posteriores de contexto. La revisión visual se hace con datos ficticios locales; no carga archivos ni modifica producción.

La separación protege catálogo, selección y APIs. Los archivos de audio y portadas siguen usando las URL públicas del almacenamiento actual; los enlaces de archivos ya conocidos no se vuelven privados.
