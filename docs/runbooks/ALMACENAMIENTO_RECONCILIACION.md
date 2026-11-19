# Reconciliación de almacenamiento y borrado seguro de multimedia

Qué hace: encuentra los ficheros activos que **ninguna fila de la base de datos de la empresa referencia** (huérfanos) y permite
retirarlos. Cada empresa tiene su base y su prefijo de bucket; el procedimiento solo ve y toca los de la empresa en curso.

## Procedimientos (tRPC `storage.*`, rol `admin` de la empresa)

| Procedimiento | Tipo | Para qué |
|---|---|---|
| `storage.reconcile` | consulta (solo lectura) | Informe previo: clasificación, huérfanos, protegidos, compartidos, faltantes y `planHash`. |
| `storage.reconcileApply` | mutación | Borra **solo** los `objectIds` indicados, si `planHash` coincide con el del informe. |
| `storage.reconcileRetryRemovals` | mutación | Reintenta retirar del proveedor los bytes de objetos ya borrados cuyo proveedor falló. |
| `storage.reconcilableCategories` | consulta | Categorías que pueden proponerse (`learning-content`, `media`). |

### Flujo

1. `storage.reconcile {limit?, graceHours?, categories?, checkProvider?}` → leer `orphans`, `protected`, `shared`, `missing`, `byCategory`.
   - `graceHours` (por defecto 24, mínimo 10 min): antigüedad mínima de un objeto sin referencias para considerarlo huérfano.
   - Los objetos `pending` o más recientes que la gracia salen como **protegidos** y no se pueden borrar.
2. Revisar el informe. Un huérfano con `sameHashAsReferenced: true` es un duplicado exacto de un objeto que sí se usa (informativo).
3. `storage.reconcileApply {objectIds: [...los de orphans], planHash, graceHours}`. Si algo cambió desde el informe (objeto nuevo,
   referencia, tamaño) responde `CONFLICT` y no borra nada: repetir desde el paso 1.
4. Resultado: `deletedIds`, `freedBytes`, `skipped[{objectId, reason}]`, `pendingRemoval`. Si `pendingRemoval > 0`, ejecutar
   `storage.reconcileRetryRemovals` cuando el proveedor responda.

### Garantías

- **Referencia** = cualquier columna de texto de la base de la empresa (salvo `stored_objects`) que contenga el id del objeto (id suelto, URL del
  Core o clave del bucket). No se borra por nombre ni por huella SHA-256: un duplicado exacto referenciado por otra fila **no** se borra.
- Un objeto compartido por varios recursos/entradas queda referenciado.
- Solo `learning-content` y `media`. Otras categorías (facturas, justificantes…) solo se cuentan.
- Ajenos: una clave fuera del prefijo de la empresa se clasifica como `foreign_tenant` y nunca se toca.
- Antes de cada borrado se bloquea la fila, se vuelve a comprobar estado, antigüedad y las referencias «calientes»
  (`learning_resources.stored_object_id`, `media_files`) y se marca `deleted` con compare-and-set; los bytes se retiran después.
- Trazabilidad: la fila queda con `status = deleted`, `deleted_at`, `bytes_removed_at` y `error = "reconcile:orphan by admin:<id>"`;
  además un log `Storage/reconcile_object_deleted`.
- El consumo (`storage.overview`) se calcula de las filas activas: baja solo al borrar. No hay contadores que corregir.

## Biblioteca multimedia (`cms.deleteMediaFile`)

Además de borrar la fila de biblioteca, libera el objeto **solo si nada más lo usa** (otra fila de biblioteca, un texto de CMS, etc.).
Si el proveedor falla, la fila de biblioteca se borra igual, el objeto deja de contar y los bytes se reintentan con
`storage.reconcileRetryRemovals`. La respuesta incluye `storage: {released, reason}`.

## Consultas que ejecuta sobre la base de la empresa

- `information_schema.columns/tables` (columnas de texto de tablas base de la base en curso).
- Una consulta de agregado por columna de texto: `SELECT SUM(CAST(col AS CHAR) LIKE ?) … FROM tabla` (lectura; un recorrido por columna).
- `stored_objects` (lectura, y `UPDATE … WHERE object_id = ? AND status = 'active'` bajo `SELECT … FOR UPDATE` al borrar).
- `stat` al proveedor de los objetos referenciados (informe de integridad).

Coste: del orden de una consulta por columna de texto de la base (cientos o pocos miles). Es mantenimiento, no una operación de cada petición.

## Riesgos y límites

- Si una tabla guarda el objeto de forma cifrada, troceada o con otra codificación, no se vería como referencia. Hoy no hay ninguna en las
  categorías reconciliables; ante la duda, no ejecutar `reconcileApply` y consultar el informe.
- Un fallo de lectura de cualquier columna aborta el informe y el borrado (sin referencias completas no se decide nada).
- Un huérfano reciente (menos de la gracia) no se puede borrar aunque se pida: bajar `graceHours` (mínimo 10 min) solo cuando se está seguro.
- No toca cuotas, excepciones ni licencias.
