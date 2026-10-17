# Almacenamiento persistente de ficheros

Runbook del servicio de almacenamiento del Core: qué ficheros se guardan, dónde, quién puede leerlos, cómo se configura el proveedor, cómo se copia y se restaura, y cómo se cambia de proveedor.

Código: `server/_core/files/` (servicio, proveedores, tipos, categorías y restauración), `server/storedObjectsDb.ts` (metadatos), `server/fileRoutes.ts` (entrega), `server/storage.ts` (punto de entrada `storagePut`), `scripts/storage/cli.ts` (operador). Migración: `db/migrations/0009_stored_objects.sql`.

## 1. Inventario de rutas que escriben o sirven ficheros

Revisado sobre `integration/elephant-source` (2026-10-17). Toda escritura persistente pasa por `storagePut` y, con el servicio activo, por `FileService.put`.

| Origen | Ruta / procedimiento | Qué guarda | Categoría | Clase |
|---|---|---|---|---|
| CMS, catálogo, blog, galería, slideshow, logotipos | `POST /api/upload/image`, `POST /api/upload-media` (`server/uploadRoutes.ts`) | Imágenes (JPEG, PNG, WebP, GIF, AVIF, SVG seguro) | `media` | Pública |
| Restaurantes | `POST /api/upload/restaurant-menu` | Carta en PDF o imagen | `restaurant-menu` | Pública |
| Imágenes generadas | `server/_core/imageGeneration.ts`, `server/adapters/imageGeneration.ts` | PNG | `generated` | Pública |
| Cupones (formulario público) | `POST /api/upload-coupon`, `ticketing.uploadCouponAttachment` | Justificante del cliente | `coupon` | Privada |
| Cupones (equipo) | `ticketing.uploadAttachment`, `ticketing.markAsRedeemed` | Adjunto o justificante de canje | `coupon` | Privada |
| RRHH | `POST /api/upload/monitor-photo`, `POST /api/upload/monitor-doc` | Foto y documentos del empleado | `hr-photo`, `hr-doc` | Privada |
| Facturas | `crm.ts` → `generateInvoicePdf` | PDF de factura | `invoice` | Privada |
| Presupuestos | `crm.quotes.generatePdf` (PDF o HTML de respaldo) | Presupuesto | `quote` | Privada |
| Reservas | `crm.reservations` (PDF de reserva) | PDF | `reservation` | Privada |
| Justificantes de transferencia | `crm.quotes.uploadTransferProof`, `crm.quotes.uploadProofOnly` | JPG, PNG o PDF | `transfer-proof` | Privada |
| Bonos de compensación | `cancellations.uploadVoucherPdf` | PDF | `voucher` | Privada |
| Delegación de partners | `partners` (justificante de delegación) | PDF o imagen | `partner-proof` | Privada |
| Liquidaciones de proveedores y partners | `suppliers.ts`, `partners.ts` (PDF o HTML de respaldo) | Liquidación | `settlement` | Privada |
| Gastos | `expenses.uploadFile`, `publicExpenses` (formulario), `expenseEmailIngestionService` (correo) | Tickets y adjuntos | `expense` | Privada |
| Gestoría | `gestoria.dossiers.generate` | ZIP del expediente fiscal | `gestoria-export` | Privada |

Rutas que generan ficheros sin persistirlos (no cambian): exportación XLSX de liquidaciones (`settlementExportRoutes.ts`, descarga directa), CSV de gestoría (se devuelve al cliente en base64), ZIP de expedientes REAV (`routers.ts`, se genera al vuelo; ahora lee del servicio los adjuntos propios), vista HTML de factura bajo demanda (`/api/invoices/preview`, firmada). `pdfGenerator.ts` solo devuelve un buffer en memoria. Las copias (`server/_core/ops/backup*.ts`) escriben en su propio almacén, fuera del alcance de este servicio.

Heredado y conservado por compatibilidad: `/local-storage` (disco local, efímero en Railway) y las URL públicas del bucket que ya estén guardadas en la base de datos de Náyade. Siguen resolviéndose igual; el servicio no las reescribe.

## 2. Clases de objetos y política de permisos

El bucket es **siempre privado**. Ninguna URL del proveedor se guarda ni se publica.

- **Públicos autorizados** (`media`, `restaurant-menu`, `generated`): `GET /files/<id>/<nombre>`. Solo se sirven si la fila es `public` y está activa **en la base de datos de la empresa del host**: un id de otra empresa da 404. No hay listado. Cabeceras: `Cache-Control: public, max-age=STORAGE_PUBLIC_CACHE_SECONDS` (por defecto 86 400), `ETag` (SHA-256, con 304), `X-Content-Type-Options: nosniff`, CSP `sandbox` para SVG. La URL guardada es absoluta con la URL pública de la empresa (subdominio o dominio propio verificado), para que funcione también en correos.
- **Privados** (todo lo demás): `GET /api/files/<id>`. En servidor se comprueba, por este orden: sesión válida (la cookie está ligada a la empresa: una cookie de A no vale en el host de B), usuario activo, existencia en la base de la empresa y permiso de la categoría:

| Categorías | Permiso RBAC | Roles heredados con acceso |
|---|---|---|
| `invoice`, `quote`, `reservation`, `voucher`, `transfer-proof`, `partner-proof` | `crm.view` | admin, agente, readonly |
| `coupon` | `crm.view` | admin |
| `expense`, `settlement`, `gestoria-export` | `accounting.expenses.view` | admin |
| `hr-doc`, `hr-photo` | `hr.view` | admin |
| `internal` (por defecto) | `settings.manage` | admin |

- **Enlaces firmados del Core** (`/api/files/<id>?exp=…&sig=…`): para destinatarios externos (factura al cliente, liquidación al proveedor). HMAC con `JWT_SECRET` sobre empresa, objeto y caducidad (`STORAGE_LINK_TTL_SECONDS`, por defecto 7 días). Caducado: 410; alterado o de otra empresa: 403. Los adjuntos de correo con URL propia se envían como **contenido** (Brevo y SMTP), no por URL.
- **Entrega**: por defecto el Core lee el objeto, comprueba su SHA-256 y lo sirve (`private, no-store`; en línea solo imágenes, PDF y el HTML de respaldo con CSP `sandbox`; el resto como descarga). Con `STORAGE_PRIVATE_DELIVERY=redirect` responde 302 a una URL prefirmada del proveedor de **duración corta** (`STORAGE_SIGNED_URL_TTL_SECONDS`, por defecto 60 s, entre 5 y 900), siempre después de las mismas comprobaciones.
- **Borrado**: `DELETE /api/files/<id>` con el permiso de la categoría; «solo lectura» nunca. La fila pasa a `deleted` antes de tocar el bucket: si el proveedor falla, el fichero ya no se sirve y la limpieza lo retira después. `expenses.deleteFile` borra también el objeto.

Pendiente conocido: la foto de perfil (`hr-photo`) solo la ven quienes tienen `hr.view`. Un empleado sin ese permiso no ve su propia foto en «Mi perfil» cuando el servicio está activo.

## 3. Estructura de objetos y metadatos

```
t/<empresa>/o/<categoría>/<aaaa>/<mm>/<id>.<ext>     contenido (multiempresa)
t/<empresa>/o/_meta/<id>.json                         ficha de metadatos (para restaurar ficheros sueltos)
o/<categoría>/…                                       instalación única con el servicio activo
```

- `<id>`: 26 caracteres aleatorios (130 bits), no correlativos. La clave la genera el servidor: el nombre del cliente nunca forma parte de ella (solo se usa saneado en `Content-Disposition`).
- `stored_objects` (en la base de cada empresa): `object_id`, `storage_key`, `visibility`, `category`, `content_type` (el **detectado**), `size_bytes`, `sha256`, `original_name`, `owner_type`/`owner_id` (entidad que lo referencia), `uploaded_by`, `status` (`pending` → `active` → `replaced`/`deleted`; `failed`), `replaces_object_id`/`replaced_by`, `error`, fechas (ms) y `bytes_removed_at`.
- **Validación**: el tipo se detecta por la firma del contenido (no por la extensión ni por lo declarado) y debe estar permitido en la categoría. SVG público solo si no contiene scripts, manejadores de eventos, `javascript:`, `foreignObject`, entidades ni referencias externas; si no, se rechaza. Tamaño máximo: el menor entre el de la categoría y `STORAGE_MAX_BYTES` (por defecto 25 MB).
- **Subida**: fila `pending` → subida con reintentos (3 intentos con espera creciente ante fallos transitorios) → relectura y comparación de SHA-256 y tamaño → `active` y ficha `_meta`. Si algo falla: fila `failed`, se intenta borrar lo subido y se responde con un error controlado (400 contenido no válido, 503 almacenamiento no disponible). Nunca queda un objeto «activo» a medias ni una fila de negocio (p. ej. `media_files`) sin fichero.
- **Sustitución** (`replaces`): el anterior pasa a `replaced` solo después de confirmar el nuevo. Su contenido se conserva hasta la limpieza.

## 4. Limpieza de huérfanos

```bash
pnpm exec tsx scripts/storage/cli.ts cleanup --tenant <empresa> [--grace-hours 24]           # simulación
pnpm exec tsx scripts/storage/cli.ts cleanup --tenant <empresa> --grace-hours 24 --apply     # ejecuta
```

Más antiguo que la gracia: retira el contenido de las filas `pending`/`failed`, de las `replaced`/`deleted` y los objetos bajo `t/<empresa>/o/` sin fila (y fichas sin objeto). No toca nada fuera de la raíz del servicio (los ficheros heredados de Náyade, ni los de otras empresas). Instalación única: `--dsn-env VAR` en lugar de `--tenant`.

## 5. Copias y restauración

El formato de copias no cambia (`server/_core/ops/backupJob.ts`). Con `BACKUP_MEDIA=1` la réplica copia por prefijo `t/<empresa>/`, así que incluye el contenido **y** las fichas `_meta`. La tabla `stored_objects` viaja además con la copia de la base de datos de la empresa.

- Restauración completa: la base de datos y `restoreTenantFiles` (sin cambios).
- **Restauración individual**:

```bash
pnpm exec tsx scripts/storage/cli.ts restore-object --tenant <empresa> --object <id>           # simulación
pnpm exec tsx scripts/storage/cli.ts restore-object --tenant <empresa> --object <id> --apply
```

Descifra la ficha y el objeto (AAD por empresa y clave), comprueba los SHA-256, sube el objeto a su clave original, vuelve a escribir la ficha y deja la fila `active`. La réplica de una empresa no se puede restaurar en el espacio de otra.

Limitación: los ficheros heredados sin prefijo (Náyade con `TENANT_LEGACY_STORAGE_TENANT`) no están bajo `t/<empresa>/` y la réplica no los copia. Los nuevos sí, porque el servicio siempre escribe con prefijo en multiempresa.

## 6. Variables

| Variable | Defecto | Uso |
|---|---|---|
| `STORAGE_OBJECTS` | `on` en multiempresa, `off` en instalación única | Activa el servicio. En la instalación única de Náyade se mantiene el comportamiento heredado hasta aplicar la migración 0009 y poner `on` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | — | Proveedor S3 compatible (mismas variables que antes) |
| `S3_FORCE_PATH_STYLE` | `1` | `0` para URL virtual-hosted (p. ej. buckets nuevos de Railway) |
| `S3_PUBLIC_URL` | — | **Ya no se usa** en el servicio; solo en el camino heredado |
| `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY` | — | Forge (heredado). No admite borrado ni listado: la limpieza no retira sus objetos |
| `LOCAL_STORAGE_PATH` | `/tmp/local-storage` | Disco local (desarrollo y pruebas). **Efímero en Railway**: no usar en producción |
| `STORAGE_MAX_BYTES` | 26 214 400 | Tamaño máximo global |
| `STORAGE_TIMEOUT_MS` | 15 000 | Tiempo máximo por petición al proveedor |
| `STORAGE_PRIVATE_DELIVERY` | (a través del Core) | `redirect` para servir privados con una URL prefirmada |
| `STORAGE_SIGNED_URL_TTL_SECONDS` | 60 | Duración de la URL prefirmada (5–900) |
| `STORAGE_LINK_TTL_SECONDS` | 604 800 | Duración de los enlaces firmados del Core enviados por correo |
| `STORAGE_PUBLIC_CACHE_SECONDS` | 86 400 | `max-age` de los públicos |

Precedencia del proveedor: Forge, luego S3, luego disco local (igual que antes).

## 7. Proveedor: comparativa (precios públicos, consultados el 2026-10-17)

Precios de lista en USD de las páginas oficiales en esa fecha, sin impuestos ni descuentos. No es una recomendación: depende del volumen real y de cómo se entregue (ver la nota de egress).

| Proveedor | Almacenamiento | Operaciones | Salida (egress) | Notas | Fuente |
|---|---|---|---|---|---|
| Railway Buckets | 0,015 $/GB-mes | Gratis (todas las operaciones S3) | Salida del bucket gratis; la salida **de un servicio** de Railway se cobra a 0,05 $/GB | Solo privados («Public buckets are currently not supported»). URL prefirmadas sí. Sin versionado, bloqueo de objetos, ciclo de vida ni cifrado del lado del servidor configurable (cifrado en reposo sí). URL virtual-hosted por defecto | docs.railway.com/storage-buckets; docs.railway.com/reference/pricing/plans |
| Cloudflare R2 (Standard) | 0,015 $/GB-mes (10 GB-mes gratis) | Clase A 4,50 $/millón; clase B 0,36 $/millón (1 M y 10 M gratis al mes) | Gratis | Free tier solo en Standard | developers.cloudflare.com/r2/pricing |
| Backblaze B2 | Desde 6,95 $/TB-mes (10 GB gratis) | Clases A, B y C gratis en pago por uso; clase D 0,004 $/10 000 (2 500 al día gratis) | Gratis hasta 3 veces el almacenamiento medio mensual; después 0,01 $/GB | Sin mínimos de tamaño ni de duración | backblaze.com/cloud-storage/pricing |
| AWS S3 Standard, Irlanda (eu-west-1) | 0,023 $/GB-mes (primeros 50 TB) | PUT/COPY/POST/LIST 0,005 $/1 000; GET 0,0004 $/1 000 | 0,09 $/GB a internet (los primeros 100 GB al mes gratis, sumando servicios y regiones) | Versionado, ciclo de vida, bloqueo de objetos | aws.amazon.com/s3/pricing y tarifas del calculador oficial |
| AWS S3 Standard, Fráncfort (eu-central-1) | 0,0245 $/GB-mes | PUT 0,0054 $/1 000; GET 0,00043 $/1 000 | No verificado en esta revisión | — | Tarifas del calculador oficial de AWS |

Nota sobre el egress: con la entrega por defecto (a través del Core), el tráfico de descarga sale del **servicio** de Railway (0,05 $/GB), no del bucket. Con `STORAGE_PRIVATE_DELIVERY=redirect` los privados se descargan directamente del proveedor. Los públicos siempre pasan por el Core, con caché. Antes de elegir proveedor conviene medir el tráfico real de ficheros (métrica `files` de `requestMeter`).

No verificado en esta revisión: región física de los buckets de Railway (consultarla en la consola antes de guardar datos personales, por el RGPD) y los SLA de cada proveedor.

## 8. Puesta en marcha en Railway (bucket privado de Railway)

No lo hace este cambio: requiere autorización y acceso a Railway.

1. Crear el bucket en el proyecto y copiar sus credenciales a las variables `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY` y `S3_SECRET_KEY` del servicio Core (en un bucket nuevo, `S3_FORCE_PATH_STYLE=0` si la pestaña Credentials indica virtual-hosted).
2. Aplicar la migración `0009_stored_objects` a cada empresa con el carril de migraciones (`migrate-all` en simulación y luego `--apply`). Las empresas nuevas la reciben al aprovisionarse.
3. Comprobar `/readyz`, subir una imagen del CMS y un justificante y descargarlos. Para el redespliegue: los ficheros siguen ahí después.
4. Copias: `BACKUP_MEDIA=1` con las mismas variables S3_*.

## 9. Migración entre proveedores S3

El servicio no guarda URL del proveedor: solo claves. Cambiar de proveedor consiste en copiar los objetos con la misma clave y cambiar las variables.

1. Copiar el bucket completo conservando claves (`rclone sync origen:bucket destino:bucket --checksum` o `aws s3 sync` con dos perfiles). Lo que hay bajo `t/` y `o/` es lo del servicio.
2. Verificar: el número de objetos y, por muestreo, el SHA-256 contra `stored_objects.sha256` (también lo comprueba el Core en cada lectura: si no coincide, responde 503 y lo registra como `integrity_mismatch`).
3. Ventana corta: segunda sincronización incremental y cambio de `S3_*` en el Core (redespliegue).
4. Mantener el bucket anterior en solo lectura durante un periodo de seguridad antes de borrarlo.

Las URL guardadas (`/files/<id>/…`, `/api/files/<id>`) no cambian. Las URL públicas heredadas del bucket de Náyade (`S3_PUBLIC_URL`) sí dependen del proveedor anterior: hay que mantenerlo o reescribir esas URL en un cambio aparte.

## 10. Compatibilidad con la instalación única (Náyade)

Sin `STORAGE_OBJECTS=on` todo sigue como antes: Forge, S3 con URL pública o `/local-storage`, con las mismas claves y URL. Las URL ya guardadas siguen funcionando en ambos modos. Para activar el servicio en Náyade: aplicar la 0009, poner `STORAGE_OBJECTS=on` y comprobar subida y descarga. Las subidas nuevas pasan entonces a ser privadas y a servirse por el Core.
