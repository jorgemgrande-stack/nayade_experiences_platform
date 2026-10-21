# Exportación de datos de las empresas

Estado al 21/10/2026. Código: `server/dataExport/*`, `server/routers/dataExportRouter.ts`, `server/controlPlane/relationshipExport.ts`, pantalla `client/src/pages/admin/subscription/DataExportPage.tsx`.

## 1. Qué se entrega y cómo

| Categoría | Dónde vive | Cómo la obtiene la empresa | Automatizado |
|---|---|---|---|
| Datos operativos (todas las tablas de su base, en CSV y JSON) | BD de la empresa | Panel › Suscripción › Exportar mis datos (ZIP) | Sí |
| Ficheros (facturas emitidas, documentos, imágenes, adjuntos) | Almacenamiento de la empresa | En el mismo ZIP (`files/`) | Sí |
| Contrato, pedidos y plan | Plano de control (CRM) | A petición: paquete de relación contractual | Generación sí; entrega manual verificada |
| Facturas de la suscripción (Stripe) y documentos fiscales | Plano de control + Stripe | A petición (número, importes y estado); el PDF oficial lo emite Stripe y llega por correo al cobrarse | Igual |
| Tickets de soporte (mensajes públicos) | Plano de control | A petición, en el mismo paquete | Igual |

**No se incluye nunca:** contraseñas, tokens, claves y credenciales; sesiones; la cola técnica de correo; registros técnicos de webhooks; las notas internas de soporte. Un ZIP con ficheros que faltaban en el almacenamiento queda marcado **INCOMPLETO** (LÉEME, `manifest.json` → `complete: false`, aviso en el panel y en el correo).

## 2. Arquitectura de la exportación de datos

1. **Solicitud** (`dataExport.request`, solo la persona propietaria): solo registra una fila `pending` en `data_exports`. Límites: una en curso por empresa (índice único), `DATA_EXPORT_DAILY_LIMIT` al día (3 por defecto) y la cuota `data_export.runs` del gestor de recursos.
2. **Generación** en el trabajo `data-export` (cada minuto, también en empresas suspendidas o en solo lectura) y en un primer intento inmediato tras la solicitud:
   - Se **reclama** con arriendo (`heartbeat_at`, latido cada minuto; arriendo de 5 min). Si el proceso se reinicia, el arriendo caduca y se reintenta (máximo 3 intentos); agotados, queda fallida con aviso.
   - Antes de escribir: tamaño estimado frente al máximo, cuota `data_export.bytes` y espacio temporal libre.
   - El ZIP se escribe en **streaming** a `os.tmpdir()/elephant-data-export/<empresa>/<id>-<intento>/` (0700/0600), leyendo las tablas **por lotes** (por clave primaria cuando es simple) dentro de **una instantánea coherente** (REPEATABLE READ, solo lectura) y copiando los ficheros en flujo. La memoria no depende del tamaño de la empresa (prueba: 120 000 filas + 64 MB con menos de 48 MB de crecimiento del montón).
   - Se sube en streaming (`FileService.putFile`: una petición PUT de hasta 5 GB, sin cargar en memoria) como fichero privado `data-export` con propietario `export:<id>`. En un reintento se retiran antes los ZIP de intentos anteriores (sin duplicados); si al terminar la fila ya no estaba en curso, se retira el recién subido (sin huérfanos).
   - El temporal se borra siempre al terminar; los que deje un proceso caído se retiran a las 6 h.
   - Se registran en el gestor de recursos `data_export.bytes` (sin comprimir) y `data_export.ms`; en la fila, intentos, duración y bytes.
3. **Entrega:** enlace firmado de 24 h (ligado a la empresa), descarga en streaming, cada enlace y descarga registrados. El correo («disponible» / «fallida») nunca lleva el enlace.
4. **Concurrencia:** una generación a la vez por proceso (`DATA_EXPORT_CONCURRENCY`, máximo 4); el resto espera turno en la cola.

Variables: `DATA_EXPORT_MAX_MB` (1024), `DATA_EXPORT_MAX_MB_OVERRIDES` (`empresa:MB,…`; techo 4096), `DATA_EXPORT_DAILY_LIMIT` (3), `DATA_EXPORT_CONCURRENCY` (1). Cuotas por defecto (gestor de recursos, ajustables por empresa con las cuotas del plano de control): `data_export.runs` 5/día y `data_export.bytes` 20 GB/mes. Flag por empresa del trabajo: `data_export_job_enabled` (activo por defecto).

> La generación sigue corriendo en el proceso del Core, pero ya no en la petición web ni en memoria. Pasarla a un servicio de trabajos aparte es una mejora posible (requiere un servicio nuevo en Railway).

## 3. Migraciones necesarias (BD de cada empresa)

- `0011_data_exports` (registro) y `0012_data_export_jobs` (columnas del trabajo; aditiva, solo columnas con valor por defecto o nulas y un índice). Sin 0011 la pantalla dice «aún no disponible»; sin 0012, «pendiente de una actualización de la base de datos».
- **Estado en producción: NO verificado** (ver §7). No se presupone aplicado.

Procedimiento (servicio `restore-drill` en la red privada; runbook `docs/runbooks/RAILWAY_ELEPHANT_SOURCE.md`):

1. Copia: `node dist-cp/backup-job.js run` (todas las empresas) y comprobar `list`.
2. Simulación: `node dist-cp/backup-job.js migrate-tenants` → revisar en los registros qué empresas tienen pendientes 0011 y/o 0012.
3. Aplicar: `node dist-cp/backup-job.js migrate-tenants --apply` (empresa canario primero; nunca toca empresas en alta, archivadas o borradas).
4. Volver el arranque del servicio a `list`.
5. Reversión de una empresa si hiciera falta: `0012_data_export_jobs.down.sql` (pierde solo intentos y métricas) con `scripts/db/migrate.ts down --steps 1 --apply --confirm-database <bd>`. Desplegar antes el código anterior.

**Orden de despliegue:** migraciones 0011/0012 aplicadas → después el código. Si el código llega antes, la exportación muestra el aviso de actualización pendiente y no genera nada (no rompe nada más).

## 4. Exportaciones de más de 1024 MB

1. La empresa ve el fallo «supera el tamaño máximo… pídela a soporte».
2. Soporte verifica que la petición viene del correo de la persona propietaria (`company_owner_email`).
3. Operaciones añade la excepción `DATA_EXPORT_MAX_MB_OVERRIDES=<empresa>:<MB>` (hasta 4096) en el servicio del Core, con registro en el ticket, y pide a la empresa que vuelva a solicitarla.
4. Tras la descarga, se retira la excepción.
5. Por encima de 4096 MB: entrega por la copia de seguridad de la empresa (`backup-job`) en un canal acordado; decisión del responsable de datos.

## 5. Documentación de la relación contractual (procedimiento verificable)

1. La persona propietaria escribe al contacto de soporte con el asunto «Documentación contractual» (lo indica la pantalla).
2. Soporte abre un ticket y comprueba que el remitente es el `company_owner_email` de la empresa.
3. Operaciones genera el paquete: `GET /cp/v1/tenants/<empresa>/relationship-export` (token con `billing:read` y `tickets:read`). Si `complete` es `false`, se indica qué fuente faltaba (`sources`).
4. Se entrega por un canal acordado (nunca adjunto a un correo sin cifrar si contiene datos personales) y se deja constancia en el ticket: fecha, quién, qué fuentes.

## 6. Acceso y caducidad (comportamiento actual, probado en `server/dataExport.policy.test.ts`)

| Fase | Estado de la empresa | ¿Puede exportar? |
|---|---|---|
| Prueba, activa, gracia | trial / active / grace | Sí |
| Impago agotado o suscripción terminada | suspended (panel en solo lectura) | Sí: pedir y descargar son las únicas escrituras permitidas |
| Fin de los 30 días de solo lectura | suspended; el motor cancela las licencias (`read_only_end`, si `CP_LIFECYCLE_MODE=apply`) | **Sí**: la exportación no depende de licencias |
| Archivada por un operador | archived / deleting / deleted | No (410) |

No hay corte automático a los 30 días ni borrado automático (de datos ni de ZIP generados).

## 7. Decisiones pendientes de aprobación

1. **Despliegue:** autorizar `railway.exe` en Windows o dar un token de proyecto de Railway (secreto nuevo) para un despliegue desde GitHub Actions. Sin eso no se puede desplegar ni verificar migraciones desde aquí.
2. **Acceso tras los 30 días:** hoy la exportación sigue disponible hasta que se archiva la empresa. ¿Se corta en `readOnlyUntil` (+ margen) o se mantiene hasta archivar?
3. **Conservación de los ZIP generados:** nunca se borran. ¿Plazo de retirada (p. ej., 30 días tras caducar el enlace)?
4. **Plazo de entrega de la documentación contractual:** la pantalla dice «lo antes posible»; ¿se fija un plazo?
5. **Portal de Stripe para descargar facturas** (existe en el código, no expuesto): ¿se habilita para la persona propietaria?
6. **Cuotas por defecto** (5 solicitudes/día en el gestor de recursos, 3/día en el Core, 20 GB/mes): ¿valores comerciales definitivos?
