# Historial de migraciones

Estas migraciones ya fueron aplicadas manualmente en Supabase. No se deben borrar,
renombrar ni volver a ejecutar en produccion para "corregir" su numeracion: hacerlo
reescribiria historial y puede repetir cambios de esquema o datos.

Existen cuatro prefijos duplicados heredados:

- `002`: `ausencias` y `ausencias_y_perfil`
- `007`: `serie_id` y `whatsapp_perfil`
- `009`: `rls_moderadores_asignaciones` y `tour_completado`
- `019`: `birthday_cron_bridge` y `eventos_predicador`

Se conservan como registro inmutable. Toda migracion nueva debe usar un unico numero,
comenzando en `033`, y debe validarse con:

```sh
npm run test:migrations
```

La prueba permite exclusivamente estos cuatro grupos legacy y falla si aparece otra
duplicacion o si se altera el historial documentado.
