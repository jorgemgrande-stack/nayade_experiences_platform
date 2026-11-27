# Runbook: restauración local y aislada de la copia de UNA empresa

Para comprobar que la copia de una empresa se puede restaurar **en tu equipo**, sin tocar Railway, el registro ni el CRM. Complementa a `BACKUPS_Y_RECUPERACION.md` (§2–§7); el comando oficial `restore-tenant` no sirve aquí porque exige el registro de production y escribe en él.

## Qué hace y qué garantiza

`scripts/restoreTenantLocal.ts` (código en `server/_core/ops/restoreLocal.ts`, que reutiliza `restoreIntoNewDatabase`):

1. Lee del almacenamiento de copias (`BACKUP_STORAGE=s3|fs`) en **solo lectura**: cualquier escritura o borrado lanza error.
2. Verifica la firma HMAC del manifiesto, el SHA-256 del objeto cifrado, descifra (AES-256-GCM, AAD `tenant:<empresa>`) y comprueba el SHA-256 del volcado.
3. Crea una base **NUEVA** (si existe, falla) en un MySQL local y compara filas, `CHECKSUM TABLE` y triggers con el manifiesto.
4. Rechaza el destino salvo `localhost`, `127.0.0.1` o `::1` (y siempre `*.railway.internal`, `*.rlwy.net`, `*.railway.app`); con `--apply` comprueba además que la conexión real es de bucle local.
5. **Aislamiento del entorno:** si hay definida cualquier variable `REGISTRY_*`, `CRM_*`, `PROVISIONING_*` o `DATABASE_URL`, el script **falla** (no las ignora) para evitar mezclas. Nunca abre registro ni CRM.
6. Por defecto es una **simulación** (verifica firma, SHA-256 y descifrado, sin tocar MySQL). Con `--apply` escribe en el MySQL local.
7. Imprime solo contadores y veredicto: ni filas ni secretos. Las claves solo se leen del entorno.

Nota: el volcado descifrado se escribe unos instantes en el directorio temporal del sistema y se borra al terminar (es el comportamiento de la restauración oficial).

## 1. MySQL local (solo en 127.0.0.1)

Elige tú la contraseña de root (no la guardes en ficheros ni en Git):

```bash
read -r -s -p "Contraseña root del MySQL local: " MYSQL_LOCAL_PW; echo
docker volume create restauracion_local_data
docker run -d --name restauracion_local_mysql -p 127.0.0.1:33990:3306 \
  -e MYSQL_ROOT_PASSWORD="$MYSQL_LOCAL_PW" -v restauracion_local_data:/var/lib/mysql mysql:8.4
# esperar a que responda
until docker exec restauracion_local_mysql mysqladmin ping -uroot -p"$MYSQL_LOCAL_PW" --silent 2>/dev/null; do sleep 3; done
export LOCAL_MYSQL_ADMIN_URL="mysql://root:${MYSQL_LOCAL_PW}@127.0.0.1:33990/"
```

## 2. Variables de copias en TU shell (sin escribirlas en ficheros)

Abre una sesión **limpia** (sin variables `REGISTRY_*`, `CRM_*`, `PROVISIONING_*`, `DATABASE_URL`). Introduce cada valor con lectura interactiva (no queda en el historial) o tómalo de tu gestor de secretos:

```bash
read -r -s -p "BACKUP_KEYS (id:base64): " BACKUP_KEYS; export BACKUP_KEYS
read -r -p "BACKUP_ACTIVE_KEY_ID: " BACKUP_ACTIVE_KEY_ID; export BACKUP_ACTIVE_KEY_ID
export BACKUP_STORAGE=s3
read -r -p "BACKUP_S3_BUCKET: " BACKUP_S3_BUCKET; export BACKUP_S3_BUCKET
read -r -p "BACKUP_S3_ENDPOINT (vacío si es AWS): " BACKUP_S3_ENDPOINT; export BACKUP_S3_ENDPOINT
read -r -s -p "BACKUP_S3_ACCESS_KEY: " BACKUP_S3_ACCESS_KEY; export BACKUP_S3_ACCESS_KEY
read -r -s -p "BACKUP_S3_SECRET_KEY: " BACKUP_S3_SECRET_KEY; export BACKUP_S3_SECRET_KEY
# opcionales: BACKUP_S3_REGION, BACKUP_S3_PREFIX, BACKUP_S3_FORCE_PATH_STYLE=1
```

Para copias en un volumen/directorio: `BACKUP_STORAGE=fs` y `BACKUP_FS_DIR=<ruta absoluta>`. Usa credenciales S3 de **solo lectura** si el proveedor lo permite.

## 3. Listar las copias de la empresa

```bash
npx tsx scripts/restoreTenantLocal.ts --list <empresa>
```

Devuelve `bytes<TAB>clave` de cada manifiesto, la más reciente primero.

## 4. Simulación y restauración

```bash
CLAVE="tenants/<empresa>/AAAA/MM/<fecha>-<run>.manifest.json"

# Simulación (por defecto): firma, SHA-256 y descifrado; no toca MySQL
npx tsx scripts/restoreTenantLocal.ts --manifest "$CLAVE" \
  --admin-url-env LOCAL_MYSQL_ADMIN_URL --database restaurada_prueba

# Restauración real en la base NUEVA
npx tsx scripts/restoreTenantLocal.ts --manifest "$CLAVE" \
  --admin-url-env LOCAL_MYSQL_ADMIN_URL --database restaurada_prueba --apply
```

## 5. Cómo leer el resultado

- `verificacion.ok: true` con `problemas: []`: todas las tablas con las filas y el checksum del manifiesto, y los triggers presentes. Código de salida 0.
- `ok: false` o error: código de salida 1. Errores habituales: clave ausente en `BACKUP_KEYS`, manifiesto manipulado o de otra empresa, base ya existente (elige otro `--database`).
- `aislamiento.conexionBucleLocal: true`: la conexión era realmente local.

Para inspeccionar la base restaurada, entra tú mismo: `docker exec -it restauracion_local_mysql mysql -uroot -p restaurada_prueba` (tecleando la contraseña cuando la pida).

## 6. Limpieza al terminar

```bash
docker rm -f restauracion_local_mysql
docker volume rm restauracion_local_data
unset BACKUP_KEYS BACKUP_ACTIVE_KEY_ID BACKUP_S3_BUCKET BACKUP_S3_ENDPOINT BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY \
      BACKUP_STORAGE LOCAL_MYSQL_ADMIN_URL MYSQL_LOCAL_PW
```

Cierra la terminal; no queda nada en disco salvo lo que hayas creado tú.

## Pruebas del script

```bash
docker run -d --name rl_test -p 127.0.0.1:33981:3306 -e MYSQL_ROOT_PASSWORD=<clave de prueba> mysql:8.4
RESTORE_LOCAL_TEST_ADMIN_URL='mysql://root:<clave de prueba>@127.0.0.1:33981/' npx vitest run server/restoreLocal.mysql.test.ts
docker rm -f rl_test
```
