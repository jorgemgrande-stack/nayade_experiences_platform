# Elephant Learning — traspaso a la primera ventana de Claude Code (21/11/2026)

Estado: **aceptado como desarrollo funcional terminado y publicado** (production sirve `8c29f8f0ea9ba96bebf78fda896b8d978c24dcb4`).
Este documento reúne todo lo necesario para continuar sin la ventana que lo construyó. No hay desarrollo funcional abierto.

## 1. Qué es
Elephant Learning es el gestor de formación digital **nativo** de Big Elephant (no un desarrollo a medida): cualquier empresa con el
módulo tiene cursos privados con matrícula nominativa, aula del alumno, y un panel de administración para crear, editar, publicar y
vender formación. Quantum Soulrise (`t12-quantum-soulrise`, curso RECONNECT ONLINE) es el primer proyecto real de validación.
No hay código específico de Quantum.

## 2. Arquitectura
**Una base de datos por empresa** (aislamiento por tenant). Tablas `learning_*` (migraciones 0079, 0083, 0084):

| Tabla | Para qué |
|---|---|
| `learning_courses` / `_modules` / `_lessons` / `_blocks` | Estructura. Los bloques apuntan a `learning_resources` (vídeo/audio/PDF) o llevan texto/enlace |
| `learning_resources` | Un recurso = un fichero vigente (`stored_object_id`, `sha256`, `size_bytes`, `status`) |
| `learning_resource_files` (0084) | Historial de ficheros por recurso: `staged` (pendiente de publicar), `active`, `replaced` (conservado) |
| `learning_course_drafts` (0083) | UN borrador por curso (JSON `doc` + `base_hash` de lo publicado cuando se abrió) |
| `learning_course_versions` (0083) | Estado publicado anterior a cada publicación (recuperable) |
| `learning_enrollments`, `_enrollment_modules`, `learning_progress` | Matrículas por módulo y progreso por usuario/lección (sobreviven a la caducidad) |
| `learning_access_rules`, `_rule_modules` | Reglas producto → modalidad → curso → módulos → duración |
| `learning_access_events` | Historial. La «matrícula 0» es el registro de auditoría de acciones de administración (`admin_*`) |

**Principios** (no romperlos): editar ≠ publicar; los ids son estables (progreso/matrículas/`last_block_id` sobreviven); nada se borra
(se archiva o se conserva); los ficheros solo se sirven por `/api/learning/resource/:id` con matrícula (URL firmada ≤ 300 s,
`private, no-store`, `noindex`); la cuota de Learning (`learning_storage_gb`) es independiente de la general.

**Código** (todo `adminProcedure` salvo el aula):
- `shared/learning.ts` (reglas de acceso), `learningEditor.ts` (árbol editable, validación, diff, hash), `learningMaterials.ts`
  (validación de subida, espacio), `learningAuthoring.ts` (tipos de bloque, slug), `learningRules.ts` (nombres comerciales),
  `learningText.ts` (textos del aula DE/ES, `resolveAulaLocale`, `withLang`, `contentNotice`).
- `server/learningDb.ts` (matrículas, reglas, auditoría `auditAdmin`), `learningEditor.ts` (borrador/publicar/versiones/restaurar),
  `learningMaterials.ts` (stage/publish/discard/restore de ficheros), `learningAuthoring.ts` (crear curso/módulo/lección/bloque,
  duplicar, archivar), `learningRoutes.ts` (HTTP: entrega, subida, `materials/:id/stage`, vista previa de fichero),
  `routers/learning.ts` (tRPC `learning.admin.{editor,materials,authoring,rules,catalog,progress,...}`).
- Cliente: `client/src/pages/admin/learning/{LearningAdmin,CourseEditor,Materials,Authoring,Rules,StudentProgress}.tsx`;
  aula `client/src/pages/learning/Aula.tsx` (vista previa de admin = mismos componentes con `preview`).

## 3. PR y commits publicados (integration/elephant-source)
| PR | Merge | Contenido |
|---|---|---|
| #919 | `95b253a6` (commit `0153e0b7`) | Selector Español/Alemán del aula: idioma de la interfaz independiente del del contenido; `?lang=` se conserva; aviso «solo disponible en alemán» (no se traduce nada) |
| #916 | `fc4deeca` | Lote 1 editor (`f310046a`, `131109dc`, `e1643b57`), pruebas reglas (`3deb7c63`), incidencia publicación (`ba95e685`), lote 2 materiales (`196240f6`), docs (`8f42a69e`) |
| #920 | `8c29f8f0` | Lote 3 crear formaciones (`b3aa6669`), lote 4 reglas y progreso (`27d51d89`) |

**Production** sirve `8c29f8f0…` en controlplane, core y core-gateway (acción `estado`, run 44896617576). Despliegue protegido
autorizado por el propietario: `preparar-production` 44895004622 y `aplicar-production` 44895757199 (ambos success).

## 4. Migraciones
`0083_learning_editor` y `0084_learning_materials`: **aditivas** (solo `CREATE TABLE`), con `.down.sql` que borra solo las tablas
nuevas. Aplicadas por `migrate-tenants --apply` en production (Quantum incluido, esquema `0084_learning_materials`).

## 5. Funcionalidades disponibles (panel `/admin/formacion`)
- **Matrículas / Progreso**: conceder, prorrogar, suspender, revocar, reactivar, invitar, demostraciones; progreso por persona.
- **Editor de cursos**: títulos, descripción, textos, atribución y orden; borrador, vista previa, publicar con confirmación, versiones.
- **Materiales**: subir/sustituir vídeo, audio, PDF como pendiente de publicar; vista previa; publicar sustitución; recuperar anterior;
  barra de progreso y reintento; validación de tipo, tamaño y cuota; espacio usado/disponible; análisis de ficheros sin referencias.
- **Crear**: cursos nuevos (borrador/privados), módulos, lecciones, bloques (texto, vídeo, audio, PDF, enlace https), reutilizar
  materiales sin duplicar, duplicar curso (comparte recursos), archivar/restaurar. Solo se añade estructura a cursos en borrador.
- **Reglas de acceso**: crear/editar con nombres comerciales; las nuevas **nacen inactivas**; activar pide confirmación.
- **Herramientas técnicas**: pestaña aparte (importación, matrícula técnica, auditoría). No se ocultan por permisos (ver §8).

## 6. Pruebas realizadas
Locales y CI (todo verde en #916, #919, #920): `learningEditor.test.ts` (7) y `.mysql.test.ts` (10), `learningMaterials.test.ts` (7) y
`.mysql.test.ts` (9), `learningAuthoring.test.ts` (3) y `.mysql.test.ts` (11), `learningGestion.mysql.test.ts` (5),
`learningRulesNombres.test.ts` (7), `learningText.test.ts` (7). Los MySQL son opt-in: `REGISTRY_TEST_DATABASE_URL=mysql://root:ci_only@127.0.0.1:3399/registry_test`
(contenedor `lms_test_db`, testkit `essentialApp.testkit`). Capturas reales (Chrome + app sobre MySQL desechable):
`capturas-learning-editor-916/` y `capturas-learning-lotes-2-4/` (fuera de git).
**En Quantum (solo lectura)**: RECONNECT en borrador, 3 módulos, 21 lecciones, 86 recursos con fichero, 5 reglas inactivas,
1 matrícula, 107 objetos / 16.675.549.787 B (cuota 25 GB); borrador idéntico guardado y descartado sin cambios; selector ES/DE correcto.

## 7. Estado de Quantum y almacenamiento
Cuota Learning 25 GB (excepción comercial) independiente de los 5 GB generales. 107 objetos = 86 referenciados + **21 huérfanos**
(2,34 GB, reenvíos del 19/11, idénticos a uno en uso) y 3 duplicados físicos en uso (~3 MB); 0 recursos compartidos; 0 faltantes.
**No se ha eliminado nada**; liberar los 21 exige el procedimiento protegido (`reconcileApply` con `planHash` y copia verificada) y
la decisión del propietario tras confirmar la recuperación. Detalle: `docs/runbooks/LEARNING_COPIA_Y_RECUPERACION.md`.

## 8. Limitaciones reales
- No se puede borrar contenido ni mover elementos entre padres; no se añade estructura a un curso **publicado** (volver a borrador).
- Sin portada de curso (no hay columna). Sin bloques de ejercicio interactivo creados desde la interfaz.
- Herramientas técnicas sin ocultar: el RBAC de Quantum está vacío (`auth.myPermissions` → `[]`; el admin entra por rol legacy) y
  `settings.advanced` no está sembrado: gatearlas por permiso bloquearía a todos. Antes, poblar RBAC y decidir qué rol las ve.
- Reglas de RECONNECT inactivas hasta que Dirección confirme las condiciones comerciales. RECONNECT sigue en borrador (privado).
- `attachResourceFile` (subida inicial de la importación) sobrescribe `stored_object_id`; el flujo nuevo (`materials/:id/stage`) no.

## 9. Procedimientos de recuperación
- **Curso editado por error**: Editor → Versiones → recuperar (carga como borrador; se publica por el mismo camino).
- **Material sustituido por error**: Materiales → «Versiones anteriores» → Recuperar (el anterior nunca se borra).
- **Acceso revocado/suspendido por error**: Matrículas → reactivar o prorrogar (con motivo; queda en el historial).
- **Base de datos de una empresa**: `docs/runbooks/BACKUPS_Y_RECUPERACION.md` §7 (`restore-tenant` en base nueva, `--switch` explícito).
  Copia cifrada cada 15 min en el bucket del proyecto de Railway (verificada con `verificar-copia`).
- **Ficheros**: réplica cifrada en `files/<empresa>/` (índice + objetos). Verificación de integridad **sin escribir** con la acción
  protegida `verificar-ficheros` (§10). Restauración real: `restore-files <empresa> --out <dir>` (§12 del runbook) — no permitida por el drill.
- **Copia externa independiente de Railway**: NO existe; estrategia en el runbook (segundo destino, §16 de BACKUPS_Y_RECUPERACION).
  Hoy la pérdida de la cuenta de Railway no estaría cubierta.

## 10. Simulacro de recuperación de ficheros (pendiente de autorización)
Ver el runbook. Resumen: acción protegida `verificar-ficheros` (`only=t12-quantum-soulrise`), orden `verify-files` (solo comprueba
SHA-256 y tamaño de cada objeto de la réplica, en memoria; no escribe disco ni bucket; no toca originales). Requiere que el PR de la
herramienta esté fusionado y desplegado (`desplegar-restore-drill` al commit) y la aprobación del propietario.

## 11. Incidencias pendientes (correcciones técnicas para la primera ventana)
**A. Falso positivo `truncate` en el clasificador de cambios críticos.** `CRITICAL_CODE` (`scripts/deploy/esRailwayLib.ts`) usa
`/\b(DROP\s+(TABLE|DATABASE|SCHEMA|USER)|TRUNCATE\s+(TABLE\s+)?[`\w]+|DELETE\s+FROM)\b/i`. En `.tsx`, la clase Tailwind `truncate`
seguida de espacio y otra clase (`className="min-w-0 truncate text-left"`) casa con `TRUNCATE\s+\w+` y marca «operación destructiva
de datos». Efecto: #916/#920 quedaron «bloqueado-protegido» (cuatro `.tsx`) y exigieron `aplicar-production`.
*Corrección propuesta*: aplicar la regla destructiva solo a ficheros de servidor/SQL (excluir `^client/` y `.tsx`/`.css`), o exigir
mayúsculas / contexto SQL (`TRUNCATE\s+TABLE`). Añadir prueba con `className="truncate text-left"` (no debe casar) y con
`TRUNCATE TABLE x` (sí). Es código de despliegue: se aprueba como cambio protegido.
**B. Publicación «solo CRM» sella `elephant-source/live`.** `publicacion.yml` con `solo: crm|web` publica ese servicio y marca
`elephant-source/live=success` en el commit sin esperar al CI del Core ni publicar el Core. Luego `disparar` ve «ya superó live» y no
lanza la publicación completa: el run sale verde, pero production sigue sirviendo el commit anterior (ocurrió con `95b253a6` y
`2310761b`). *Corrección propuesta*: que `solo` escriba únicamente `crm-live`/`web-live`; o que `disparar` ignore `live=success` si el
Core del commit no figura publicado. *Mitigación documentada*: `docs/elephant-source/PROTOCOLO_PUBLICACION.md` («Incidencia 21/11/2026»):
verificar con `estado` el SHA servido y, con CI verde, `gh workflow run publicacion.yml --ref integration/elephant-source`.
**C.** Tests locales en Windows fallan por CRLF (`deployElephantSource`, `publicacionContinua`, 4 casos); en CI (Linux) pasan o son informativos.
Ojo: `deployElephantSource.test.ts` espera 14 órdenes de drill y la rama base ya tiene 17 (preexistente).

## 12. Trampas de trabajo
Repos en CRLF (editar con scripts que normalicen); `for..of` sobre Set/Map da TS2802 (bucles indexados); worktrees con rutas largas
(`Filename too long` al borrar `wt-visual`); en Windows no crear ficheros con `cat <<EOF` que contengan comillas raras en Bash (usar
Write); fusionar a mano y de una en una; no dar por publicado hasta ver el SHA servido con `estado`.
