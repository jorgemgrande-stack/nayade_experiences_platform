# Elephant Learning — editor de formación (plan técnico por fases)

Estado: lote 1 en implementación. No es un LMS paralelo: reutiliza `learning_courses / modules / lessons / blocks / resources`,
`learning_progress`, `learning_enrollments`, la entrega privada de recursos y los procedimientos `learning.admin.*`.

## Capacidades del backend existente (comprobadas)

| Necesidad | Estado |
|---|---|
| Aislamiento entre empresas | Ya resuelto: una base de datos por empresa (`getDb`). El editor no añade ninguna consulta entre empresas. |
| Estructura y textos | Solo se pueden cambiar con `importInventory` (técnico). Sin edición desde el panel. |
| Progreso | `learning_progress(user_id, lesson_id)`: por lección, no por fichero. Reordenar o sustituir ficheros no lo toca mientras los ids no cambien. |
| Acceso | `learning_enrollment_modules(module_id)` y reglas por módulo. Mientras los ids de módulo no cambien, el acceso se conserva. |
| Ficheros | `POST /api/learning/upload/:id` ya acepta sobrescribir un recurso verificado, pero deja el objeto anterior huérfano y no lo ofrece el panel. |
| Publicación | Solo el estado del curso (`draft/published/archived`). No hay borrador de contenido ni versiones. |
| Cuotas / limpieza | `storage.reconcile` / `reconcileApply` (operador) con protección de gracia; cuota `learning_storage_gb` separada. |

## Principios de diseño

1. **Identidad estable.** Editar nunca recrea filas: módulos, lecciones, bloques y recursos conservan su `id`. Por eso progreso, matrículas,
   `last_block_id`, accesos y relaciones comerciales siguen valiendo.
2. **Edición separada de publicación.** El editor trabaja sobre un **borrador por curso** (`learning_course_drafts`, un documento
   JSON). Los alumnos siguen leyendo las tablas vivas hasta que un administrador pulsa «Publicar cambios».
3. **Publicar es una transacción** que (a) comprueba que lo publicado no ha cambiado desde que se abrió el borrador (huella),
   (b) guarda una **versión** con el estado anterior (`learning_course_versions`) y (c) aplica solo lo cambiado.
4. **Recuperación segura.** Cualquier versión se puede cargar de nuevo como borrador y publicarla por el mismo camino.
5. **Nada destructivo en el lote 1.** No se borran filas ni ficheros. En fases posteriores un elemento con progreso o referencias
   solo se podrá archivar, y un fichero solo se libera tras verificar referencias, cuota y copia verificada.
6. **Ningún cambio comercial.** No toca reglas, ventas, correos, precios ni el estado de publicación del curso.

## Fases

### Lote 1 (este PR) — estructura y textos, con borrador, publicación y versiones
- Migración aditiva `0083_learning_editor` (2 tablas, sin tocar las existentes) con `down`.
- `shared/learningEditor.ts` (reglas puras): árbol editable, validación, huella, diferencias, reconciliación de versiones.
- `server/learningEditor.ts` + `learning.admin.editor.*`: `state`, `saveDraft`, `discardDraft`, `publish`, `versions`, `restoreVersion`.
- Pantalla «Editor» en Formación: árbol de módulos/lecciones/bloques, edición de títulos y textos, reordenar con flechas,
  vista previa del borrador, resumen de cambios, confirmación antes de publicar y recuperar versiones.
- Editable: título/descripción del curso, títulos de módulos y lecciones, título/texto/atribución de bloques, orden de todo.
- Aún NO (lotes siguientes): crear/borrar módulos, lecciones, bloques; sustituir ficheros; mover entre padres.

### Lote 2 — sustituir materiales y espacio
- «Sustituir fichero» por recurso: sube a un objeto nuevo, deja el recurso apuntando al nuevo en la publicación del borrador, conserva id, progreso y acceso.
- El objeto anterior pasa a «sustituido» (referenciado por la versión) y solo lo libera una limpieza protegida.
- Espacio usado/disponible de Learning y bloqueo si no hay cuota.

### Lote 3 — creación de contenidos y biblioteca
- Crear módulos, lecciones y bloques; subir vídeo/audio/PDF nuevos; biblioteca de recursos reutilizables.
- Archivar en lugar de borrar cuando hay progreso o matrículas; impedir borrar recursos referenciados.

### Lote 4 — gestión y publicación
- Reglas de acceso por modalidad editables; invitaciones; borradores/publicado; limpieza protegida de sustituidos con comprobación de copia verificada.

## Pruebas previstas del lote 1
- Reglas puras (vitest): validación (ids ajenos, duplicados, vacíos, longitudes), huella estable, diferencias, reconciliación.
- MySQL (patrón `learning*.mysql.test.ts`): guardar borrador sin tocar lo publicado; publicar aplica títulos, textos y orden;
  **progreso, matrículas y módulos concedidos intactos**; conflicto si lo publicado cambió; versión guardada y restaurable;
  segunda publicación idéntica sin efectos; borrador inexistente.
- Aislamiento: el editor exige administrador; sin sesión 401; usuario normal 403.
- Interfaz: tipado y compilación (`tsc`), humo de la pantalla.
