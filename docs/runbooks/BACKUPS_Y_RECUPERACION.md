# Runbook: copias de seguridad por empresa y recuperación

Estado:

- **Destino primario: en marcha en Railway.** Servicio `backup-job`, cron cada 15 min, bucket del propio proyecto
  y restauración individual demostrada (`RAILWAY_ELEPHANT_SOURCE.md`, sección 5).
- **Destino secundario externo** (secciones 16–17): implementado y probado en contenedores (MySQL + dos MinIO).
  **No configurado**: el proveedor no está elegido ni contratado. Mientras no exista, las copias **no protegen**
  ante la pérdida del proyecto o de la cuenta de Railway.
- **Recuperación total**: `docs/runbooks/RECUPERACION_TOTAL.md`, probada en contenedores, no en Railway.

## 1. Qué hay y qué no

| Pieza | Estado |
|---|---|
| Copia lógica de cada empresa con base activa, del registro y del CRM comercial, cada una a su propio objeto | Hecho (`server/_core/ops/backupJob.ts`) |
| Cifrado AES-256-GCM con clave rotable (`BACKUP_KEYS`), manifiesto firmado (HMAC) | Hecho (`backupCrypto.ts`) |
| Almacenamiento S3 compatible (AWS, R2, B2, MinIO…) o directorio/volumen | Hecho (`backupStorage.ts`); ninguno viene configurado |
| Verificación de la subida (se relee el objeto y se compara su SHA-256) | Hecho |
| Inventario en el registro (`backup_inventory`, migración `0010`) y `/cp/v1/backups` | Hecho |
| Alerta `backup.stale` alimentada por el inventario | Hecho (plano de control y `cli.ts alerts-run`) |
| Retención 30 diarias / 12 semanales / 12 mensuales sobre almacenamiento e inventario | Hecho (`backupRetention.ts`) |
| Restauración individual en base NUEVA, verificada, con conmutación explícita (`--switch`) | Hecho (`backupRestore.ts`) |
| Restauración del registro y del CRM en base nueva | Hecho (sin conmutación automática: es un cambio de configuración) |
| Varios servidores MySQL (`PROVISIONING_DB_SERVERS`) y colocación por ocupación | Hecho (`server/_core/provisioning/servers.ts`) |
| Réplica cifrada e incremental de ficheros de cada empresa | Hecho, **solo si** el almacenamiento de medios está configurado y `BACKUP_MEDIA=1` |
| Segundo destino independiente (mismo objeto y manifiesto, verificado por SHA-256, estado por destino en `backup_copies`, migración `0011`) | Hecho y probado en contenedores; **sin proveedor configurado** (sección 16) |
| Alertas `backup.secondary_failed` y `backup.secondary_stale` (sin bloquear el primario) | Hecho (sección 16.4) |
| Retención independiente por destino, simulación primero | Hecho (sección 16.5) |
| Restauración desde el secundario (`--source secondary`) de empresa, registro, CRM y ficheros; registro de cada restauración (`backup_restores`) | Hecho (sección 16.6) |
| Paquete de configuración para recuperación, sin secretos, en cada destino | Hecho (sección 17) |
| Reconstrucción total ordenada desde el externo (`rebuild`) | Hecho y probado en contenedores (`RECUPERACION_TOTAL.md`) |
| Medida por ejecución y estimación de almacenamiento y coste (`estimate`) | Hecho (sección 18) |
| Recuperación a un instante (binlog / PITR) | **No implementado**; evaluación en la sección 20 |
| Simulacro de restauración programado | **No implementado** (manual, sección 7.4) |
| Panel visual en el CRM | **No** (solo API `/cp/v1/backups`, que ahora incluye `secondary`) |

## 2. Arquitectura

```
servicio programado (Railway cron)  →  node dist-cp/backup-job.js run
   │  lee el registro (REGISTRY_ADMIN_DATABASE_URL) y descifra el DSN de cada empresa (REGISTRY_KEYS)
   ├─ por cada empresa (trial, active, grace, suspended, archived) con base activa, en el servidor donde esté:
   │     volcado lógico consistente (START TRANSACTION WITH CONSISTENT SNAPSHOT; sin binarios externos)
   │     → gzip → cifrado AES-256-GCM (clave activa de BACKUP_KEYS; AAD = «tenant:<id>»)
   │     → subida → relectura y SHA-256 → manifiesto firmado → fila `ok` en backup_inventory
   │     (+ ficheros t/<id>/… del bucket de medios si BACKUP_MEDIA=1)
   ├─ registro (misma cadena, AAD «registry:registry»)
   └─ CRM comercial (CRM_DATABASE_URL, AAD «crm:crm»)
   Un fallo en un destino queda como fila `failed` con su error y no detiene los demás; el proceso
   termina con código 1 si algo falló (Railway lo muestra como ejecución fallida).
```

**Objetos** (rutas relativas al prefijo del almacenamiento):

```
tenants/<empresa>/<AAAA>/<MM>/<AAAAMMDDThhmmssZ>-<run>.sql.gz.enc   copia cifrada
tenants/<empresa>/<AAAA>/<MM>/<AAAAMMDDThhmmssZ>-<run>.manifest.json manifiesto firmado (sin datos)
registry/registry/…  crm/crm/…                                        igual
files/<empresa>/index.json.enc                                         índice cifrado de ficheros
files/<empresa>/objects/<hash>.enc                                     cada fichero, cifrado
```

**Manifiesto** (JSON, firmado con HMAC-SHA256 con una subclave derivada de la clave de la copia): destino,
momento, base, servidor, versión de esquema, `keyId`, objeto (`key`, `bytes`, `sha256`), volcado
(`bytes`, `sha256`), filas y `CHECKSUM TABLE` por tabla y triggers. Cualquier alteración se rechaza antes de
restaurar.

**Formato del volcado**: sentencias SQL separadas por `-- @@`; las columnas generadas no se vuelcan (MySQL las
recalcula); los triggers se vuelcan al final, sin `DEFINER` ni el nombre de la base de origen, y al restaurar
se crean con el usuario propio de la base restaurada. No incluye vistas, rutinas ni eventos (el esquema
actual no los usa: si se añadieran, hay que ampliar `backup.ts`).

**Inventario** (`backup_inventory`, registro): destino, `run_id`, estado (`running`, `ok`, `failed`,
`pruned`), inicio, fin, duración, servidor, base, versión de esquema, almacenamiento, ubicación, manifiesto,
tamaño, SHA-256, clave, tablas, filas, error. Sin DSN ni secretos.

## 3. Variables

| Variable | Uso |
|---|---|
| `REGISTRY_ADMIN_DATABASE_URL` | Registro (lectura de empresas, escritura del inventario). |
| `REGISTRY_KEYS`, `REGISTRY_ACTIVE_KEY_ID` | Descifrar el DSN de cada empresa. |
| `BACKUP_KEYS`, `BACKUP_ACTIVE_KEY_ID` | Llavero de copias: `id:base64(32 bytes)` separados por comas; **distinto** del de `REGISTRY_KEYS`. Generar: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. |
| `BACKUP_STORAGE` | `s3` o `fs`. Sin ella el trabajo no arranca (no hay almacenamiento por defecto). |
| `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY` | Bucket de copias. |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_S3_PREFIX`, `BACKUP_S3_FORCE_PATH_STYLE=1` | Proveedor compatible (R2, B2, MinIO), región, prefijo. |
| `BACKUP_FS_DIR` | Ruta absoluta (pruebas o un volumen). Un volumen del mismo proyecto **no** protege ante la pérdida del proyecto. |
| `CRM_DATABASE_URL` | BD del CRM comercial (si falta, se registra como «omitida»). |
| `BACKUP_MEDIA=1` + `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` (`S3_ENDPOINT`, `S3_REGION`) | Réplica de ficheros desde el bucket de medios del Core. |
| `BACKUP_KEEP_DAILY`, `BACKUP_KEEP_WEEKLY`, `BACKUP_KEEP_MONTHLY` | Retención (30 / 12 / 12 por defecto). |
| `BACKUP_APPLY_RETENTION=1` | Aplicar la retención al final de cada ejecución. |
| `BACKUP_MAX_AGE_HOURS` | (Plano de control) antigüedad máxima antes de `backup.stale` (36 h; crítica al doble). |
| `PROVISIONING_DB_SERVERS` / `PROVISIONING_DB_ADMIN_URL` | Servidores donde restaurar (sección 9). |

Credenciales del bucket de copias: idealmente propias del trabajo, con permiso de escribir, leer (la
verificación relee cada objeto) y borrar (retención). Para protegerse de un borrado malicioso, activar en el
bucket **versionado o bloqueo de objetos (object lock)** con una retención algo mayor que la de esta política.

## 4. Programación en Railway (proyecto «Elephant Source»)

1. Servicio nuevo desde el mismo repositorio, con `Dockerfile.controlplane` (la imagen ya contiene
   `dist-cp/backup-job.js` tras `pnpm build:cp`).
2. **Start command**: `node dist-cp/backup-job.js run`.
3. **Cron schedule** (UTC), por ejemplo `0 */6 * * *` (cada 6 h) o `30 2 * * *` (diaria). Railway arranca el
   contenedor a la hora indicada y el proceso debe terminar solo (este lo hace). Comprobar en la
   documentación vigente de Railway la frecuencia mínima y qué ocurre si una ejecución se solapa con la
   siguiente.
4. Variables de la sección 3 (las de base de datos referenciando las de MySQL del proyecto; el bucket, fuera
   del proyecto).
5. Sin puerto público ni dominio: el servicio no escucha.
6. Primera ejecución manual («Run now») y comprobar: logs `{"ctx":"Backups","event":"run_finished","ok":true,…}`,
   `GET /cp/v1/backups` con `summary.fresh` = número de empresas, y un simulacro (7.4).

El plano de control (otro servicio) solo **lee** el inventario: `/cp/v1/backups` y la alerta `backup.stale`
(con `CP_ALERTS_EVERY_SECONDS` o `POST /cp/v1/alerts/run`). Nunca ejecuta copias ni restauraciones.

## 5. Retención

`node dist-cp/backup-job.js retention` (simulación) / `--apply`. Por cada destino conserva la copia correcta más
reciente de cada uno de los últimos 30 días con copia, de cada una de las últimas 12 semanas ISO y de cada uno
de los últimos 12 meses, y **siempre** la más reciente (nunca deja a un destino sin copia válida). Borra el
objeto y su manifiesto y marca la fila como `pruned`; si el borrado falla, la fila sigue `ok` y se informa.
Las copias fallidas no se tocan. La réplica de ficheros no entra en esta retención (solo añade).

## 6. Consultar el estado

- `GET /cp/v1/backups` (`ops:read`): por empresa, última copia correcta, antigüedad, `fresh`, último intento
  y su error; resumen (`fresh`, `stale`, `never`, `lastAttemptFailed`) y estado del registro y del CRM.
- `GET /cp/v1/tenants/:id/backups?limit=50` (`ops:read`): historial de la empresa y de sus ficheros.
- `node dist-cp/backup-job.js list [--tenant <id>] [--kind tenant|registry|crm|files]`.
- Incidencias `backup.stale:<empresa>` en `/cp/v1/incidents`; se cierran solas con la siguiente copia.

## 7. Restauración individual de una empresa (paso a paso)

Se restaura **siempre en una base nueva** `es_<empresa>_r<AAAAMMDDhhmmss>`, en el servidor donde está la
empresa (o en `--server <alias>`), con un usuario propio con permisos solo sobre ella. La base original y las
demás empresas no se tocan.

1. **Elegir la copia**: `node dist-cp/backup-job.js list --tenant <empresa>` → anotar el `id` (por defecto, la
   última correcta).
2. **Simulación**: `node dist-cp/backup-job.js restore-tenant <empresa> [--backup <id>] [--server <alias>]` →
   muestra copia, servidor y nombre de la base nueva. No escribe nada.
3. **Restaurar y verificar sin conmutar**: añadir `--apply`. Comprueba la firma del manifiesto y el SHA-256 del
   objeto, descifra, crea la base nueva, carga, y compara SHA-256 del volcado, filas, `CHECKSUM TABLE` y
   triggers. Revisar `verification.ok` y, si procede, inspeccionar la base nueva.
4. **Conmutar** (decisión humana explícita): repetir con `--apply --switch`. Restaura de nuevo en otra base
   nueva, verifica, comprueba que el usuario propio conecta, y en el registro: registra el DSN (cifrado) y lo
   activa. Esto retira la base anterior (no la borra), deja eventos `database.registered`/`database.activated`
   en `tenant_events` e incrementa `registry_version`, con lo que el Core deja de usar las conexiones
   cacheadas de la base anterior. Si la verificación falla, **no** conmuta.
5. **Después**: comprobar la web y el panel de la empresa; `cli.ts diagnose <empresa>`. Las bases de restauración
   de ensayo (paso 3) y la original retirada se borran a mano cuando ya no hagan falta
   (`DROP DATABASE …; DROP USER esr_…`).

Los datos escritos en la empresa entre la copia y la conmutación se pierden en la base activa (siguen en la
base retirada): si hace falta recuperarlos, hay que hacerlo a mano antes de borrarla.

### 7.4 Simulacro periódico (recomendado mensual)

`restore-tenant <empresa> --apply` (sin `--switch`) sobre una empresa elegida al azar, comprobar
`verification.ok: true` y borrar la base de ensayo. Registrar fecha, duración y tamaño: es la única medida
real del RTO. No está automatizado.

## 8. Registro y CRM comercial

`node dist-cp/backup-job.js restore-platform registry|crm --admin-url-env <VAR> --database <base_nueva> [--backup <id>] --apply`

Con el registro perdido no hay inventario: localizar la copia con `objects registry/` y usar
`--manifest <clave del .manifest.json>`. La restauración crea la base nueva y la verifica; **no** cambia nada en
marcha. Para usarla: detener el plano de control (y el Core si fuera el registro), apuntar
`REGISTRY_ADMIN_DATABASE_URL` (y la URL de solo lectura del Core) o `CRM_DATABASE_URL` a la base nueva, revisar
con `pnpm exec tsx scripts/registry-migrate.ts` (plan: sin pendientes ni objetos ausentes) y arrancar. El
usuario de solo lectura del Core debe recibir de nuevo sus permisos sobre la base nueva.

## 9. Varios servidores MySQL

```
PROVISIONING_DB_SERVERS='[{"alias":"mysql-a","host":"mysql-a.railway.internal","port":3306,"adminUrlEnv":"MYSQL_A_ADMIN_URL"},
                          {"alias":"mysql-b","host":"mysql-b.railway.internal","port":3306,"adminUrlEnv":"MYSQL_B_ADMIN_URL","maxTenants":300}]'
PROVISIONING_DB_PLACEMENT=least_used        # o explicit (+ PROVISIONING_DB_DEFAULT_SERVER)
MYSQL_A_ADMIN_URL=…  MYSQL_B_ADMIN_URL=…     # variables aparte (referencias de Railway); nunca en la lista
```

- La lista solo admite `alias`, `host`, `port`, `adminUrlEnv`, `maxTenants`, `acceptsNew`: una URL con
  credenciales dentro se rechaza.
- `least_used`: el servidor con menos empresas (BD activas o pendientes en el registro) que admita altas
  (`acceptsNew` distinto de `false`, por debajo de `maxTenants`). `explicit`: el pedido en el alta
  (`cli.ts provision … --server <alias>`) o `PROVISIONING_DB_DEFAULT_SERVER`.
- El Core no cambia: cada empresa ya guarda su DSN cifrado y su `server_alias` en `tenant_databases`.
- Copia y restauración funcionan con empresas en servidores distintos (probado con dos contenedores).
- Sin `PROVISIONING_DB_SERVERS`, `PROVISIONING_DB_ADMIN_URL` sigue funcionando como único servidor.
- Mover una empresa de servidor = restaurar su última copia con `--server <otro> --apply --switch`
  (con la empresa en mantenimiento para no perder escrituras).

## 10. Recuperación ante desastre (pérdida del proyecto de Railway o del MySQL)

> Procedimiento completo y script ordenado (`rebuild`) desde el destino externo: **`RECUPERACION_TOTAL.md`**.
> Lo que sigue es el resumen manual, válido también si solo se pierde el MySQL (con el primario intacto).

Requisitos que **deben** existir fuera del proyecto: el bucket de copias y una copia segura de `BACKUP_KEYS`
(gestor de contraseñas de la empresa). Sin las claves, las copias no se pueden descifrar.

1. Nuevo MySQL (o varios) y servicios desde el repositorio.
2. Registro: `objects registry/` → manifiesto más reciente → `restore-platform registry --manifest … --apply`
   en una base nueva; apuntar `REGISTRY_ADMIN_DATABASE_URL` a ella. Su inventario incluye las copias de
   empresas de la misma ejecución (el registro se copia después de las empresas).
3. CRM: igual con `crm`.
4. Empresas: configurar `PROVISIONING_DB_SERVERS` con los servidores nuevos y, para cada empresa,
   `restore-tenant <empresa> --server <alias nuevo> --apply --switch` (el registro restaurado aún apunta a
   los servidores perdidos; la conmutación lo corrige).
5. Ficheros: `restore-files <empresa> --out <dir>` y subir al bucket de medios nuevo (o usar la réplica del
   proveedor, sección 12).
6. `GET /cp/v1/backups`, `diagnose` por empresa y lanzar una copia completa.

## 11. RPO y RTO (objetivo: 15 min / 4 h)

> Medidas actualizadas con la frecuencia de 15 min y la reconstrucción desde el externo: **sección 19**. El texto
> de esta sección describe el razonamiento original (copias cada 6 h o diarias).

**RPO (pérdida máxima de datos).** Este diseño hace copias lógicas periódicas: el RPO es el intervalo de
programación más la duración de la copia. Con una ejecución cada 6 h, el RPO es de hasta ~6 h; diaria, hasta
~24 h. **El objetivo de 15 min no se cumple con la configuración recomendada.** Opciones:

- Programar cada 15 min: posible si la ejecución completa dura bastante menos de 15 min. Hay que medir duración,
  carga en MySQL (cada copia recorre todas las tablas de todas las empresas) y coste de almacenamiento (la
  retención 30/12/12 se aplica por día, así que las copias intradía sobrantes se purgan en la siguiente
  retención). Referencia medida en pruebas locales (no producción): dos empresas con el esquema completo
  (~155 tablas casi vacías), registro y CRM en ~2 s.
- Recuperación a un instante con binlog (o el PITR del proveedor de MySQL): **no implementado**. Es la vía
  correcta para 15 min con muchas empresas.

**RTO (tiempo hasta volver a servir).** Una empresa: descarga + descifrado + carga + verificación + conmutación;
en pruebas locales, ~3 s para una empresa pequeña. Con datos reales depende del tamaño (la carga es secuencial,
sentencia a sentencia). Desastre completo (sección 10): suma del registro, CRM y todas las empresas una a una,
más la reconfiguración manual. **4 h es plausible con pocas empresas pequeñas, pero no está demostrado**: hace
falta un simulacro completo con un volumen realista y medir.

Qué falta para demostrar el objetivo: (1) programar y medir en Railway la duración real de `run`; (2) un
simulacro de desastre cronometrado; (3) binlog/PITR para 15 min; (4) paralelizar restauraciones si el número
de empresas lo exige.

## 12. Ficheros (medios de las empresas)

Los ficheros viven en el bucket de medios del Core (`S3_*`), bajo `t/<empresa>/…` en modo multiempresa.

- **Estrategia recomendada en el proveedor**: versionado del bucket (recupera borrados y sobrescrituras) y
  replicación a otra región/cuenta. Es lo más barato y no depende de este trabajo.
- **Copia periódica (implementada)**: con `BACKUP_MEDIA=1` y `S3_*` configurados, cada ejecución replica de
  forma incremental (por tamaño/ETag) y cifrada los ficheros de cada empresa en `files/<empresa>/…` del
  almacenamiento de copias, con un índice cifrado; nunca borra lo ya copiado. Recuperación:
  `restore-files <empresa> --out <dir>` (comprueba SHA-256 de cada fichero).
- **Huecos**: sin `BACKUP_MEDIA`/`S3_*` no se copian ficheros (el trabajo lo dice en `run_started`); los
  ficheros heredados sin prefijo `t/<empresa>/` (`TENANT_LEGACY_STORAGE_TENANT`) y el almacenamiento local
  `/tmp/local-storage` no están cubiertos; la réplica no tiene retención (crece) ni copia por versiones.

## 13. Rotación de la clave de copias

1. Añadir la nueva a `BACKUP_KEYS` (`k1:…,k2:…`) y poner `BACKUP_ACTIVE_KEY_ID=k2`.
2. Las copias nuevas se cifran con `k2` (consta en el manifiesto y en el inventario, columna `key_id`).
3. Mantener `k1` mientras exista alguna copia con `key_id = k1` (con 30/12/12, hasta 12 meses). Después,
   quitarla. Sin la clave, esas copias no se pueden restaurar.

## 14. Migración del registro `0010_backup_inventory`

Aditiva (una tabla nueva). Aplicar con el ejecutor del registro antes de desplegar el plano de control que la
use (sin ella, el plano de control arranca igual y registra `{"ctx":"Backups","inventory":false}`):

```bash
REGISTRY_MIGRATE_URL=mysql://…/<registro> pnpm exec tsx scripts/registry-migrate.ts                       # plan
REGISTRY_MIGRATE_URL=mysql://…/<registro> pnpm exec tsx scripts/registry-migrate.ts --execute --confirm-database <registro>
```

Reversión (pierde el inventario; las copias siguen en el almacenamiento):
`DROP TABLE backup_inventory; UPDATE registry_meta SET v = '0009' WHERE k = 'schema_version';`

### 14.1 Migración `0011_backup_copies`

Aditiva: dos tablas nuevas (`backup_copies`, `backup_restores`); no cambia `backup_inventory`. Aplicar igual que la
0010 (plan → `--execute --confirm-database`), **antes** de configurar el secundario. Sin ella:

- el trabajo sigue copiando al primario como hoy; si hay `BACKUP_SECONDARY_*`, registra el secundario como
  fallido («Falta la migración 0011…») y termina con código 1 (visible en Railway);
- el plano de control arranca igual (`{"ctx":"Backups","copies":false}`) y no evalúa alertas del secundario.

Reversión (pierde el estado por destino y el registro de restauraciones; las copias siguen en ambos destinos):
`DROP TABLE backup_restores; DROP TABLE backup_copies; UPDATE registry_meta SET v = '0010' WHERE k = 'schema_version';`

## 15. Limitaciones conocidas

- Copias lógicas secuenciales: con bases grandes, la duración crece linealmente; no hay copia incremental de
  bases.
- La lectura usa una transacción con instantánea consistente por base (InnoDB): no bloquea escrituras, pero
  una copia larga mantiene versiones antiguas de filas.
- El permiso del usuario de una base restaurada se concede por nombre de base (como en el alta): el `_` actúa
  como comodín de un carácter en `GRANT`, igual que en las bases del alta.
- Bases restauradas de ensayo y bases retiradas: limpieza manual.
- Pruebas: unitarias en `server/backupSecurity.test.ts` y `server/backupSecondary.test.ts`; MySQL en
  `server/backupJob.mysql.test.ts` (`BACKUP_TEST_SECOND_DATABASE_URL` opcional para el segundo servidor) y
  `server/backupExternal.mysql.test.ts` (dos destinos, pérdida del primario, pérdida total; `BACKUP_TEST_S3A_URL`,
  `BACKUP_TEST_S3B_URL` y `DR_TEST_NEW_SERVER_URL` opcionales para MinIO y un servidor MySQL nuevo).

## 16. Segunda ubicación independiente (destino secundario)

### 16.1 Qué hace

Si se configura `BACKUP_SECONDARY_*`, cada ejecución, **después** de dejar la copia primaria correcta y verificada:

1. sube al secundario el **mismo** objeto cifrado y el **mismo** manifiesto firmado (mismas claves de objeto);
2. relee el objeto y compara su SHA-256 y tamaño; relee el manifiesto y lo compara byte a byte;
3. anota el resultado en `backup_copies` (destino `secondary`, `backup_id` = id de la fila del inventario).

Ficheros: cada destino tiene su propio índice cifrado (`files/<empresa>/index.json.enc`); cada fichero se lee una vez
del bucket de medios y se sube a los destinos que no lo tienen. El paquete de recuperación (sección 17) también se
escribe en ambos.

**Nunca bloquea al primario:** cada operación del secundario tiene un tiempo máximo
(`BACKUP_SECONDARY_TIMEOUT_SECONDS`, 600 por defecto); si falla o se agota, se borra lo subido a medias (sin esperar
si el secundario no responde), se registra el fallo y el trabajo sigue. La copia primaria ya hecha no se toca. Si no
hay ninguna variable `BACKUP_SECONDARY_*`, el trabajo se comporta exactamente como antes.

Código de salida: 1 si falla cualquier copia, también si falla solo el secundario (en Railway la ejecución aparece
como fallida; el log `run_finished` distingue `ok` del primario y `secondary.ok`).

### 16.2 Variables (servicio `backup-job`)

| Variable | Uso |
|---|---|
| `BACKUP_SECONDARY_STORAGE` | `s3` (por defecto) o `fs` (solo pruebas). |
| `BACKUP_SECONDARY_S3_BUCKET`, `BACKUP_SECONDARY_S3_ACCESS_KEY`, `BACKUP_SECONDARY_S3_SECRET_KEY` | Bucket y credenciales **propias** del destino externo (distintas de las del primario). |
| `BACKUP_SECONDARY_S3_ENDPOINT`, `BACKUP_SECONDARY_S3_REGION`, `BACKUP_SECONDARY_S3_PREFIX`, `BACKUP_SECONDARY_S3_FORCE_PATH_STYLE=1` | Proveedor S3 compatible (R2, B2, AWS…). |
| `BACKUP_SECONDARY_TIMEOUT_SECONDS` | Tiempo máximo de cada operación en el secundario (600). |
| `BACKUP_SECONDARY_KEEP_DAILY`, `…_WEEKLY`, `…_MONTHLY` | Retención propia del secundario (30/12/12). |
| `BACKUP_SECONDARY_APPLY_RETENTION=1` | Aplicar la retención del secundario tras cada ejecución (sin ella, solo simulación). |
| `BACKUP_SECONDARY_MAX_AGE_HOURS` | (Plano de control) antigüedad máxima en el secundario antes de `backup.secondary_stale` (por defecto, la de `BACKUP_MAX_AGE_HOURS`). |
| `ES_DEPLOY_COMMIT` | (Opcional) commit desplegado, para el paquete de recuperación (los servicios se despliegan con `railway up`, sin metadatos de Git). |

Una configuración incompleta se registra como fallo del secundario con el motivo; un secundario igual al primario se
rechaza («no es una ubicación independiente»).

**Credenciales del externo.** Las del trabajo necesitan escribir, leer (verificación) y borrar (retención). Para
protegerse de un borrado malicioso desde un Railway comprometido, activar en el bucket externo **versionado o bloqueo
de objetos** con una retención algo mayor que la política. Para la recuperación, guardar en la carpeta privada unas
credenciales **de solo lectura** distintas.

### 16.3 Puesta en marcha (cuando haya proveedor; requiere autorización y tiene coste)

1. Elegir proveedor (sección 18.3), crear bucket en una región de la UE, versionado/bloqueo de objetos y dos pares de
   credenciales (trabajo; solo lectura para recuperación). Guardarlas en la carpeta privada.
2. Aplicar la migración `0011` en el registro (sección 14.1).
3. Añadir las variables al servicio `backup-job`; dejar `BACKUP_SECONDARY_APPLY_RETENTION` sin definir.
4. «Run now» y comprobar `run_started.secondary`, `run_finished.secondary.ok: true`, `list --destination secondary`.
5. Simulacro: `restore-tenant <empresa> --source secondary --apply` (sin `--switch`) y borrar la base de ensayo.
6. Tras unos días, revisar la simulación de retención (`retention --destination secondary`) y, si es la esperada,
   activar `BACKUP_SECONDARY_APPLY_RETENTION=1`.

### 16.4 Alertas

El plano de control (con la migración 0011) evalúa, solo si alguna vez hubo un intento en el secundario:

- `backup.secondary_failed:<tipo>:<destino>` (aviso): el último intento en el secundario de una empresa, sus
  ficheros, el registro, el CRM o el paquete falló. Se cierra sola con el siguiente intento correcto.
- `backup.secondary_stale:<empresa>` (aviso; crítica al doble): la última copia correcta en el secundario de una
  empresa activa, en prueba o en gracia supera `BACKUP_SECONDARY_MAX_AGE_HOURS`.

`GET /cp/v1/backups` incluye `secondary` (resumen y estado por empresa) cuando hay datos del secundario; `null` si no.

### 16.5 Retención por destino

- Primario: como siempre (sección 5), sobre `backup_inventory` y el almacenamiento primario. Nunca borra en el secundario.
- Secundario: `retention --destination secondary` (simulación) / `--apply`, sobre `backup_copies` y el almacenamiento
  secundario, con su propia política. Nunca toca el primario.
- **Salvaguarda del secundario:** antes de borrar copias antiguas de un destino, comprueba que su copia correcta más
  reciente existe en el almacenamiento con el SHA-256 registrado; si no, no borra nada de ese destino y lo informa
  (`skipped`).
- Tras cada ejecución con secundario el trabajo registra siempre la simulación (`{"event":"retention","destination":"secondary","applied":false,…}`);
  solo borra con `BACKUP_SECONDARY_APPLY_RETENTION=1`.
- Una copia podada en el primario puede seguir en el secundario y restaurarse desde él (probado).

### 16.6 Restaurar desde el secundario

Mismas órdenes y garantías que desde el primario (base nueva, verificación completa, conmutación explícita), con
`--source secondary`:

```bash
node dist-cp/backup-job.js list --destination secondary --tenant <empresa>
node dist-cp/backup-job.js restore-tenant <empresa> --source secondary [--backup <id>] [--server <alias>] --apply [--switch]
node dist-cp/backup-job.js restore-platform registry|crm --source secondary --admin-url-env VAR --database <nueva> [--manifest <clave>] --apply
node dist-cp/backup-job.js restore-files <empresa> --source secondary (--out <dir> | --to-media)
node dist-cp/backup-job.js restores                       # registro de restauraciones (backup_restores)
```

- La copia se elige en `backup_copies` (destino `secondary`, estado `ok`); `--backup` es el id del inventario.
- `--to-media` sube los ficheros recuperados al bucket de medios de `S3_*` (solo claves `t/<empresa>/…` de esa empresa).
- Cada restauración (correcta o no) queda en `backup_restores`: origen, copia, base, servidor, verificación,
  conmutación, número de ficheros, error.
- Fallos controlados (probados): objeto alterado (SHA-256), copia incompleta (objeto ausente), manifiesto alterado o
  clave equivocada (firma), credenciales erróneas o secundario caído: la restauración se detiene **antes** de crear
  la base y queda registrada como fallida.

## 17. Paquete de configuración para recuperación

Cada ejecución genera, sin secretos, y guarda cifrado (clave de copias, AAD `recovery:platform`) en cada destino:
`recovery/latest.json.enc` y `recovery/<AAAA>/<MM>/<AAAAMMDD>.json.enc` (uno por día). Contenido:

- servicios del proyecto (`core`, `controlplane`, `backup-job`, `crm`, `web`, pasarelas) con `dockerfilePath`, orden de
  arranque, cron, healthcheck y **nombres** de sus variables obligatorias y opcionales;
- qué variables tiene definidas el servicio de copias (`true`/`false`, nunca el valor);
- commit desplegado (`ES_DEPLOY_COMMIT` o `RAILWAY_GIT_COMMIT_SHA`) e ids públicos de Railway (`RAILWAY_PROJECT_ID`,
  `RAILWAY_SERVICE_ID`, …);
- base y versión del registro, base del CRM, servidores MySQL (`alias`, `host`, `port`, `adminUrlEnv`);
- empresas: estado, versión de esquema, servidor, dominios y la última copia correcta en cada destino;
- destinos (descripción sin credenciales), ids de clave de copias y política de retención; orden de restauración.

Garantía: antes de escribirlo se comprueba que no contiene el valor (ni la contraseña de un DSN, ni una clave de un
llavero) de ninguna variable sensible del entorno, ninguna URL con credenciales ni claves privadas; si lo hiciera, no
se escribe y la ejecución lo registra como fallo (`config:recovery`). Leerlo:
`node dist-cp/backup-job.js recovery-package [--source secondary]`.

## 18. Política, medidas y coste

### 18.1 Política

- **Bases** (cada empresa, registro, CRM): copia completa lógica, comprimida y cifrada **cada 15 min**
  (`*/15 * * * *`), en ambos destinos.
- **Ficheros**: réplica incremental (solo lo nuevo o cambiado) en cada ejecución.
- **Retención por destino**: 30 diarias / 12 semanales / 12 mensuales. En régimen estable quedan **48 copias por
  destino de copia** (simulación de dos años con 96 ejecuciones al día; `steadyStateCopies`).

### 18.2 Medidas por ejecución

El log `run_finished` incluye `durationMs`, `bytesByKind` y `msByKind`; el inventario guarda tamaño y duración de cada
copia. `node dist-cp/backup-job.js estimate [--days 7] [--price-gb … --price-a … --price-b …]` calcula, con lo
medido, el almacenamiento y las operaciones del mes:

```
K  = copias conservadas por destino de copia (48 con 30/12/12)
S  = Σ_bases K · tamaño_medio_cifrado + bytes de la réplica de ficheros
A  = ejecuciones/día · 30 · (2·bases + 2·empresas_con_ficheros + 2) + ficheros nuevos     (escrituras y listados)
B  = ejecuciones/día · 30 · (2·bases + 1·empresas_con_ficheros + 2) + ficheros nuevos     (lecturas: verificación)
coste/mes por destino = S · precio_GB_mes + A/10⁶ · precio_A + B/10⁶ · precio_B   (+ salida de red del origen)
```

Medido en contenedores locales con datos sintéticos (no es el tamaño real de Railway; medirlo con `estimate` en el
servicio `backup-job`): por ejecución, cada empresa con la baseline completa casi vacía ≈ 23 KB cifrados, registro
5–8 KB, CRM 0,3 KB, paquete 9 KB; ejecución completa con dos destinos 1,9–2,3 s.

### 18.3 Precios públicos de los candidatos (consultados el 17/10/2026)

| Proveedor | Almacenamiento | Escrituras (A) | Lecturas (B) | Salida | Gratis | Fuente |
|---|---|---|---|---|---|---|
| Cloudflare R2 (Standard) | 0,015 $/GB-mes | 4,50 $/millón | 0,36 $/millón | gratis | 10 GB-mes, 1 M A y 10 M B al mes | developers.cloudflare.com/r2/pricing/ |
| Backblaze B2 | 6,95 $/TB-mes (≈ 0,00695 $/GB) | gratis | gratis | gratis hasta 3× lo almacenado; después 0,01 $/GB | primeros 10 GB | backblaze.com/cloud-storage/pricing y …/transaction-pricing |
| AWS S3 Standard eu-west-1 (Irlanda) | 0,023 $/GB-mes | 0,005 $/1.000 | 0,0004 $/1.000 | 0,09 $/GB (primeros 10 TB) | (no verificado) | API pública de precios de AWS (`b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/s3/…`, publicada el 15/10/2026) |
| AWS S3 Standard eu-south-2 (España) | 0,023 $/GB-mes | 0,0053 $/1.000 | 0,0004 $/1.000 | 0,09 $/GB | (no verificado) | ídem |
| AWS S3 Standard eu-south-1 (Milán) | 0,024 $/GB-mes | 0,0053 $/1.000 | 0,0004 $/1.000 | 0,09 $/GB | (no verificado) | ídem |
| Railway Storage Buckets | 0,015 $/GB-mes (redondeado al GB-mes superior) | gratis | gratis | gratis desde el bucket | — | docs.railway.com/storage-buckets/billing |

Notas: la página de transacciones de B2 menciona además «0,005 $/GB/mes», que no cuadra con la principal (se toma la
principal). En Railway, la salida de red de un servicio cuesta 0,05 $/GB (docs.railway.com/reference/pricing/plans) y
**las subidas desde un servicio a un bucket o a un proveedor externo cuentan como salida** (los buckets no están en
la red privada). Un bucket de Railway **no** es una ubicación independiente: comparte proyecto, cuenta y proveedor.

### 18.4 Estimación

Fórmula de 18.2 con 96 ejecuciones al día y 30/12/12 (K = 48). Los escenarios B son **supuestos ilustrativos**, no
datos de clientes.

| Escenario | S por destino | A / B al mes | R2 | B2 | AWS eu-west-1 | AWS eu-south-2 | Salida Railway (subidas a 1 destino) |
|---|---|---|---|---|---|---|---|
| A. Hoy (sintético medido): 2 empresas, registro, CRM ≈ 54 KB por ejecución | ≈ 0,003 GB | 40.320 / 34.560 | 0 $ (dentro de la capa gratuita; 0,19 $ sin ella) | 0 $ | ≈ 0,22 $ | ≈ 0,23 $ | 0,16 GB → ≈ 0,01 $ |
| B. Supuesto: 50 empresas de 5 MB, registro 1 MB, CRM 5 MB (256 MB por ejecución) + 20 GB de ficheros | ≈ 32 GB | 593.280 / 449.280 | ≈ 0,33 $ (A y B dentro de la capa gratuita) | ≈ 0,16 $ | ≈ 3,89 $ | ≈ 4,07 $ | **737 GB → ≈ 37 $** |

Conclusión: hoy el coste del destino externo es despreciable con cualquiera de los candidatos. Con crecimiento, el
término dominante **no es el almacenamiento sino la salida de red de Railway** (copias completas cada 15 min se suben
enteras 2.880 veces al mes, a cada destino) y, en AWS, las escrituras.

### 18.5 Estrategia si el tamaño crece (propuesta; no implementado)

1. **Saltar copias sin cambios**: si el resumen (`CHECKSUM TABLE` por tabla) de una empresa coincide con el del último
   manifiesto, no subir nada (la mayoría de empresas no cambian cada 15 min). Reduce salida y escrituras en proporción.
2. **Copias completas comprimidas con menos frecuencia** (cada hora o cada 6 h) + **retención escalonada** (la actual).
3. **RPO de 15 min con binlog**: archivar los binlogs (PITR, sección 20) en lugar de volcados completos; el volcado
   completo pasa a ser la base diaria. Es la evolución correcta con muchas empresas o bases grandes.
4. Paralelizar volcados por servidor cuando la duración se acerque a 15 min (hoy, segundos).

## 19. RPO y RTO: objetivo frente a capacidad demostrada

Objetivos: **RPO 15 min, RTO 4 h**. **No se declaran cumplidos**: lo demostrado es la capacidad técnica en
contenedores con datos mínimos.

| Medida | Resultado | Dónde |
|---|---|---|
| Duración de una ejecución completa (2 empresas + ficheros + registro + CRM + paquete, dos destinos) | 1.977–2.312 ms | CLI y `backupExternal.mysql.test.ts` (MinIO) |
| Volumen por ejecución | ≈ 60 KB (bases ≈ 52 KB, ficheros 0,1–8 KB la primera vez, paquete 9 KB) | ídem |
| Secundario caído: retraso añadido al trabajo | ≈ 1 s (conexión rechazada); con un secundario que no responde, como máximo `BACKUP_SECONDARY_TIMEOUT_SECONDS` por operación | `backupExternal.mysql.test.ts` |
| Restauración de una empresa desde el secundario, verificada y conmutada | 3,6–4,3 s | ídem |
| Detección simulada (registro inaccesible + primario vacío) | < 10 ms (no representativo: en real depende de la monitorización y de una persona) | ídem |
| Reconstrucción total desde el externo a un MySQL nuevo (registro + CRM + 2 empresas + ficheros + validación) | 8,8 s (CLI) – 10,6 s (prueba) | `RECUPERACION_TOTAL.md` §7 |
| Arranque de la aplicación y verificación por host | 3,8 s (en proceso); Core de producción `node dist/index.js` sirviendo a ambas empresas | ídem |
| Edad de la última copia válida en el momento de la pérdida | 0 s en la prueba (copia justo antes); en producción, hasta 15 min + duración + retraso del secundario | — |
| Integridad | Firma del manifiesto, SHA-256 del objeto y del volcado, filas, `CHECKSUM TABLE` y triggers por tabla; SHA-256 por fichero | — |

**RPO.** Con el cron de 15 min y el secundario sano, la pérdida máxima esperada es ~15 min + duración de la ejecución.
Sin destino externo configurado, ante una pérdida total del proyecto **no hay recuperación posible** (RPO infinito).
Una ejecución fallida amplía el hueco hasta la siguiente correcta; las alertas avisan a partir de
`BACKUP_MAX_AGE_HOURS` / `BACKUP_SECONDARY_MAX_AGE_HOURS` (hoy 2 h en Railway): para vigilar un RPO de 15 min habría
que bajar ese umbral a ~1 h.

**RTO.** La parte técnica (restaurar y verificar) se mide en segundos con datos mínimos y crece con el volumen (carga
secuencial). La parte que domina un desastre real son los pasos manuales de `RECUPERACION_TOTAL.md` (proyecto,
servicios, variables, despliegues, dominios, DNS de clientes, pasarelas): **no medidos**. Para afirmar 4 h hace falta
un simulacro completo en un proyecto de Railway temporal, con el proveedor externo real y un volumen realista.

## 20. Evaluación de PITR en Railway (propuesta independiente; la imagen NO se cambia)

Fuentes (17/10/2026): railway.com/deploy/mysql-pitr, docs.railway.com/volumes/point-in-time-recovery,
docs.railway.com/volumes/backups.

**Qué es.** Railway ofrece recuperación a un instante para MySQL con su imagen
`ghcr.io/railwayapp-templates/mysql-ha/mysql:<major.minor>` (p. ej. `…/mysql:8.4`). Con `BINLOG_ARCHIVE_BUCKET` (y las
variables `BINLOG_ARCHIVE_*` que añade la plantilla) sube a un **bucket de Railway** cada binlog cerrado (rotación cada
minuto), comprimido, más un `mysqldump` completo al empezar y cada día. Retención 7 días; granularidad de 1 s y el punto
restaurable más reciente va ~1 min por detrás. Restaurar crea un **servicio hermano nuevo** (el original no se toca).
Sin cargo propio: se paga el bucket y la salida de las subidas. Se activa desde la pestaña Backups («Enable PITR»), que
cambia la imagen y redespliega (un corte).

**Compatibilidad con lo actual.**

- El MySQL del proyecto usa la imagen estándar con etiqueta flotante `mysql:8`. PITR exige `major.minor`: comprobar la
  versión real (`SELECT VERSION()`) y fijar la misma (`mysql-ha/mysql:8.4` si es 8.4). La documentación no detalla la
  migración del volumen desde la imagen estándar: hay que ensayarla.
- Un comando de arranque personalizado impide la migración automática (comprobar que no lo hay).
- **Triggers y binlog**: el registro (auditoría solo anexada) y la baseline de cada empresa crean triggers. Con binlog
  activo, crear triggers exige SUPER o `log_bin_trust_function_creators` (el ejecutor del registro lo advierte y nunca
  lo activa por su cuenta). El aprovisionamiento y las restauraciones usan el usuario administrador; hay que verificar
  en el ensayo que altas, migraciones y restauraciones (`CREATE DEFINER = …`) siguen funcionando.
- El archivo de binlogs vive **en Railway**: complementa (RPO de ~1 min ante errores lógicos o borrados) pero **no
  sustituye** al destino externo ante la pérdida del proyecto. Las credenciales del bucket en el servicio restaurado
  son de lectura y escritura.
- Un hilo de comentarios de Railway aún lista MySQL PITR como «Planned» aunque la documentación lo da por disponible:
  confirmar el estado con Railway antes de depender de él.
- Las «Backups» de volúmenes de Railway (diaria 6 días, semanal 27, mensual 89) se restauran solo en el mismo proyecto
  y entorno y se borran si se borra el volumen: tampoco son copia externa.

**Ensayo necesario (en instancia temporal, nunca en el MySQL en uso).**

1. Entorno o proyecto temporal de Railway con un MySQL `mysql:8.x` igual al actual, cargado con una reconstrucción de
   copias (`rebuild`) o una restauración de volumen.
2. Activar PITR; comprobar la imagen resultante, el archivo de binlogs en el bucket y el volcado inicial.
3. Ejercitar: alta de una empresa de prueba, migraciones del registro y de una empresa, `backup-job.js run`,
   restauración individual con `--switch`, escrituras durante unos minutos.
4. Restaurar a un instante T en un servicio hermano; verificar con `compareWithManifest` / recuentos que el estado es
   el de T; medir tiempo y coste.
5. Desactivar y volver a la imagen estándar (rollback) y comprobar que el volumen arranca.

**Plan de vuelta atrás (si se activa en producción tras el ensayo).** Antes: copia completa con `backup-job.js run`
(ambos destinos) y copia de volumen de Railway. Si algo falla: quitar las variables `BINLOG_ARCHIVE_*`, redesplegar la
imagen anterior con la misma `major.minor` sobre el mismo volumen; si el volumen no arrancara, restaurar la copia de
volumen o reconstruir desde las copias lógicas (`RECUPERACION_TOTAL.md`). Decisión del propietario; requiere ventana
de mantenimiento.
