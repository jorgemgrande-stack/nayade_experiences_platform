# Elephant Learning — Lote 2: gestión autónoma de vídeo, audio y PDF (diseño, 21/11/2026)

Herramienta nativa de Big Elephant, por empresa. Nada de lo siguiente es específico de Quantum: usa las cuotas, el
almacén y las tablas que ya tiene toda empresa con Learning.

## Punto de partida (verificado en el código)
- Subida: `POST /api/learning/upload/:id` (administrador) → `attachResourceFile`. **Hoy sobrescribe** `stored_object_id`
  del recurso: el objeto anterior queda huérfano y la conciliación de almacenamiento podría liberarlo tras la gracia.
  No sirve tal cual para sustituir sin riesgo.
- Entrega: `/api/learning/resource/:id` (matrícula activa, URL firmada ≤ 300 s) y vista previa de administración.
- Espacio: `storageUsage.overview` ya devuelve usado, cuota y disponible de Learning (`learning_storage_gb`) y de general,
  con ficheros repetidos. Panel de la empresa: Suscripción → Consumo.
- Quantum (21/11): 16 GB usados de 25 GB, 9,5 GB disponibles, 107 ficheros, 24 repetidos (2,3 GB).

## Principios
1. **Subir y publicar son pasos distintos.** Un fichero nuevo nunca sustituye al vigente hasta que se publica.
2. **El anterior no se borra.** Queda referenciado por la versión del curso (`learning_course_versions`) y solo lo libera
   una limpieza protegida, con copia verificada y simulación previa (`planHash`).
3. **Ids estables.** El recurso conserva su id, bloques, lecciones, progreso, matrículas y reglas.
4. **Cuota antes de subir.** Se rechaza si `usado + tamaño > cuota` (mensaje con el espacio disponible); sin concesión de
   Learning la cuota es 0 y no se sube nada.
5. **Sin permisos nuevos.** Mismo `adminProcedure`; ninguna ruta de borrado de ficheros.

## Modelo (migración aditiva 0084, solo tablas nuevas)
`learning_resource_staged(id, resource_id, stored_object_id, sha256, size_bytes, mime_type, original_name, status
['staged','published','discarded'], created_by, created_at, published_at)`.
- Subir a un recurso crea una fila `staged` (objeto nuevo en el almacén, categoría `learning-content`).
- El borrador del editor (`learning_course_drafts.doc`) admite `resources: {resourceId: stagedId}`; `validateDraft` exige que
  el staged pertenezca a ese recurso y al tipo (`mimeMatchesKind`).
- `publishDraft` (misma transacción): fija `stored_object_id`/`sha256`/`size_bytes`/`mime_type` del recurso al staged, marca
  `published` y **guarda en el snapshot el objeto anterior** para poder restaurar la versión.
- `restoreVersion` vuelve a apuntar al objeto del snapshot (sigue en el almacén).

## Interfaz (en el editor de cursos)
- Por recurso: miniatura/duración, tamaño, «Sustituir fichero» (arrastrar), barra de subida, comparación antes/después,
  aviso de duplicado por huella, y «pendiente de publicar» en el indicador de cambios.
- Cabecera del editor: espacio de Learning (usado/disponible, 25 GB en Quantum) con alerta al 80 % y al 95 %.
- Vista previa del borrador reproduce el fichero nuevo (ruta de vista previa de administración, auditada).

## Pruebas previstas
- Subir no cambia lo servido a alumnos; publicar sí; restaurar vuelve al anterior; el objeto anterior sigue existiendo.
- Tipo incorrecto, cuota 0, cuota agotada, duplicado por huella, staged de otro recurso, doble publicación idempotente.
- Progreso, matrículas y reglas intactos tras sustituir. Aislamiento entre empresas.
- Conciliación: un `staged` o un objeto referenciado por una versión **no** se propone para liberar.

## Fuera de este lote
Crear/borrar recursos y lecciones (lote 3), reglas editables (lote 4), limpieza de sustituidos (protegida).

## Herramientas técnicas fuera del uso diario
Hoy están en su propia pestaña, a la derecha. Para ocultarlas sin ampliar privilegios hay que fijar con qué permiso
existente se muestran: `settings.advanced` existe pero **no está sembrado** en las migraciones, así que no se sabe qué roles
lo tienen en cada empresa. Antes de aplicarlo: listar los permisos efectivos del administrador de Quantum (solo lectura) y
decidir. Propuesta: `learning.admin.capabilities` (consulta) → `{ technicalTools }` según ese permiso; las mutaciones
técnicas siguen con `adminProcedure` hasta confirmar que el permiso lo tiene quien debe.
