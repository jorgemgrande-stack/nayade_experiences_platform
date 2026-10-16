# Runbook: copias de seguridad por empresa y recuperación

Estado: **implementado y probado contra MySQL desechable; no desplegado ni programado en Railway.** Nada de
este documento está activo hasta que se configuren las variables y el servicio programado (sección 4) y se
haga el primer simulacro de restauración (sección 7.4).

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
| Recuperación a un instante (binlog / PITR) | **No implementado** |
| Simulacro de restauración programado | **No implementado** (manual, sección 7.4) |
| Panel visual en el CRM | **No** (solo API `/cp/v1/backups`) |

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

## 15. Limitaciones conocidas

- Copias lógicas secuenciales: con bases grandes, la duración crece linealmente; no hay copia incremental de
  bases.
- La lectura usa una transacción con instantánea consistente por base (InnoDB): no bloquea escrituras, pero
  una copia larga mantiene versiones antiguas de filas.
- El permiso del usuario de una base restaurada se concede por nombre de base (como en el alta): el `_` actúa
  como comodín de un carácter en `GRANT`, igual que en las bases del alta.
- Bases restauradas de ensayo y bases retiradas: limpieza manual.
- Pruebas: unitarias en `server/backupSecurity.test.ts`; MySQL en `server/backupJob.mysql.test.ts`
  (`BACKUP_TEST_SECOND_DATABASE_URL` opcional para el segundo servidor).
