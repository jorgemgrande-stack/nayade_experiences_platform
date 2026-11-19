# Almacenamiento: cuotas por ámbito y máximo por imagen

## Qué mide cada cuota

| Cuota | Qué cuenta | De dónde sale el límite | Por defecto |
|---|---|---|---|
| `storage_gb` (general) | Imágenes, documentos, adjuntos y demás ficheros. **No** incluye Elephant Learning ni las exportaciones de datos | Plan + ampliaciones (registro 0013) o excepción vigente (registro 0016) | Plan Essential 5 GB |
| `learning_storage_gb` (Learning) | Contenido de Elephant Learning (categoría `learning-content`: vídeo, audio y PDF educativos) | Excepción vigente del operador; si no, 0 | **0** (sin concesión no se sube contenido educativo) |
| `media_file_mb` (por imagen) | Tamaño máximo de una imagen subida desde CMS → Multimedia y los gestores de imágenes | Excepción vigente del operador; si no, 10 | 10 MB (techo técnico `STORAGE_MAX_BYTES`, 25 MB) |

El consumo se calcula siempre de los objetos guardados (`stored_objects`, estados `pending` y `active`): no hay contadores
que se desincronicen al borrar, duplicar o migrar. Reclasificar entre ámbitos no mueve ni duplica ficheros: es solo la
regla de qué categorías cuenta cada cuota (`categoryInScope`).

Origen del bloqueo de Quantum (19/11/2026): los ≈14,1 GB del curso RECONNECT entraron por `putFile` del LMS (que no
comprobaba cuota) y, al contar con el resto en una sola cifra, dejaron a Quantum por encima de sus 5 GB generales.
Desde este cambio `putFile` de Learning comprueba su propia cuota y el consumo educativo ya no resta del general.

## Cómo consulta el consumo un administrador de la empresa

Panel de la empresa → **Suscripción → Consumo** (`/admin/suscripcion/consumo`, rol `admin`). Sección «Almacenamiento»:
usado, cuota, disponible y nº de ficheros de cada ámbito, máximo por imagen y ficheros repetidos (misma huella SHA-256).
El tráfico de reproducción todavía no se mide (el almacén sirve o redirige sin contador propio).

## Cómo lo gestiona un operador de Big Elephant sin Claude Code

Rol de operador del plano de control con el permiso `quotas:write` (ver, `quotas:read`).

1. Consola de administración (admin.bigelephant.es) → **Empresas** → la empresa → pestaña **Cuotas**: muestra, entre otras,
   «Almacenamiento», «Almacenamiento Learning» y «Tamaño máximo por imagen», con límite efectivo, origen y explicación.
2. Una condición negociada se concede como **excepción comercial** de esa métrica: valor nuevo, motivo (5-300 caracteres),
   inicio y caducidad obligatoria (máximo 366 días; para más, se renueva o se cambia el contrato). Queda historial
   (quién, cuándo, valores). Se revoca con motivo.
   - Límite por imagen de Quantum: métrica `media_file_mb`, valor `25`.
   - Cuota Learning de Quantum: métrica `learning_storage_gb`, valor `25` (provisional de implantación).
   - Cuota total de un cliente negociado: métrica `storage_gb` con el valor acordado, o ampliación contratada.
3. Vía API (mismo permiso): `POST /cp/v1/tenants/<empresa>/quotas/exceptions` con
   `{"metric":"media_file_mb","period":"total","newLimit":25,"reason":"…","expiresAt":<ms>}`; `GET …/quotas/policy` para
   comprobar el resultado.

Una excepción es de la empresa, no de su suscripción: sigue vigente al pasar de prueba a suscripción.

## Lo que todavía no tiene interfaz o requiere un paso protegido

- **Condición permanente** (sin caducidad) por empresa: hoy solo hay excepciones (máx. 366 días). Una condición indefinida
  exigiría ampliar el registro (p. ej. un tipo de límite nuevo en `tenant_entitlement_limits`, migración 0018 del registro,
  paso protegido). No se ha aplicado.
- **Uso Learning declarado al plano de control:** el registro solo admite `storage_bytes` como uso declarado
  (`tenant_usage.metric` es un ENUM); el desglose Learning/general se ve en el panel de la empresa. Mostrarlo en la ficha
  del cliente del CRM requiere ampliar ese ENUM (migración 0018 del registro, paso protegido) y el cliente de la consola
  (que no está en este repositorio).
- Cambio mínimo recomendado en la ficha del cliente: columna «Usado» en cada fila de la pestaña Cuotas y botón
  «Crear excepción» por fila si no existe ya (la API existe).
