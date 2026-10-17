# Runbook: recuperación ante la pérdida total del proyecto de Railway

Estado: **procedimiento y script probados en contenedores locales** (MySQL 8.4 y dos MinIO), **no ensayados en
Railway ni con un proveedor externo real**: el destino externo aún no está elegido ni contratado. Hasta que exista
el destino secundario (`BACKUP_SECONDARY_*`, ver `BACKUPS_Y_RECUPERACION.md`, sección 16), las copias viven solo
en el bucket del propio proyecto y **una pérdida total del proyecto o de la cuenta no es recuperable**.

Escenario: el proyecto «Elephant Source» de Railway (servicios, MySQL, bucket de copias, variables y dominios)
deja de existir o no es accesible. Se reconstruye en un proyecto nuevo a partir de:

1. el **destino externo de copias** (bucket S3 compatible fuera de Railway);
2. la **carpeta privada del propietario** (secretos, sección 2);
3. el **paquete de configuración para recuperación** (`recovery/latest.json.enc` en el destino externo; sin
   secretos: servicios, imágenes, nombres de variables, commit desplegado, topología, empresas y ubicación de
   sus copias);
4. los repositorios en GitHub (Core, CRM, web).

## 1. Orden y responsables

| Paso | Qué | Quién decide |
|---|---|---|
| 0 | Declarar el desastre y congelar cambios (sección 3) | Propietario |
| 1 | Proyecto y servicios nuevos, sin tráfico | Operador |
| 2 | MySQL nuevo | Operador |
| 3 | Variables desde el paquete + secretos de la carpeta privada | Operador (secretos: propietario) |
| 4 | Reconstrucción: registro → CRM → empresas → ficheros (`rebuild`) | Operador |
| 5 | Despliegue de servicios desde los commits del paquete | Operador |
| 6 | Pasarelas, dominios, pasarelas de pago y correo | Propietario |
| 7 | Validación de consistencia | Operador |
| 8 | Reapertura controlada | Propietario |

## 2. Qué debe existir FUERA de Railway (antes del desastre)

| Elemento | Dónde | Sin él |
|---|---|---|
| `BACKUP_KEYS` (todas las claves vivas, con su id) | Carpeta privada **y** gestor de contraseñas del propietario | Las copias no se pueden descifrar: **pérdida total** |
| `REGISTRY_KEYS` | Igual | No se pueden leer ni volver a cifrar los DSN del registro restaurado |
| `INTEGRATION_KEYS`, `JWT_SECRET`, `EMAIL_ENCRYPTION_KEY`, `CP_TOKENS` (o sus valores de origen), `SUPPORT_JWT_SECRET`, `CP_SESSION_SECRET`, `CP_PUBLIC_FORM_SECRET` | Igual | Credenciales de integración cifradas ilegibles; sesiones, formularios y tokens a regenerar |
| Credenciales de lectura del destino externo (`BACKUP_SECONDARY_S3_*`) | Igual (y la consola del proveedor, con su propia autenticación de dos factores) | No se llega a las copias |
| Usuario y hash de la pasarela, contraseña del primer operador | Igual | Se regeneran (no bloquea) |
| Acceso a GitHub y a la cuenta de Railway (o una nueva) | Propietario | — |

**Custodia de la clave de copias (`BACKUP_KEYS`).** No debe vivir solo en Railway:

- Dos ubicaciones independientes del propietario: la carpeta privada (fuera de cualquier repositorio) y un gestor
  de contraseñas con autenticación de dos factores; opcionalmente una tercera copia cifrada fuera de línea
  (memoria USB cifrada en un lugar físico seguro).
- **Nunca** en el mismo proveedor ni en la misma cuenta que el bucket externo, ni en el paquete de recuperación,
  ni en el registro, ni en correos o tickets.
- Al rotar (`BACKUP_ACTIVE_KEY_ID`), guardar la clave nueva **antes** de activarla y conservar las antiguas mientras
  existan copias cifradas con ellas (columna `key_id`; con 30/12/12, hasta 12 meses).
- Comprobar cada trimestre que la copia custodiada descifra: `node dist-cp/backup-job.js recovery-package --source secondary`
  con las variables tomadas **solo** de la carpeta privada.

## 3. Declarar el desastre

1. Confirmar la pérdida: el proyecto no aparece o no responde, y el soporte de Railway no da plazo de recuperación
   compatible con el objetivo (4 h).
2. Anotar la hora (inicio del RTO) y la de la última copia válida en el externo (paso 4.2): diferencia = datos perdidos.
3. Aviso a las empresas cliente según el plan de comunicación (fuera de este runbook). Nada se envía de forma
   automática.

## 4. Reconstrucción

### 4.1 Proyecto, servicios y MySQL

1. Proyecto nuevo en Railway (o en la cuenta nueva). Entorno `production`.
2. Servicio MySQL (imagen `mysql:8.4` o la que figure en el paquete; ver `BACKUPS_Y_RECUPERACION.md` sección 20 para
   PITR). Sin proxy TCP público salvo durante la carga; se cierra al terminar.
3. Servicios vacíos, **sin dominio y sin tráfico**: `core`, `controlplane`, `backup-job` (sin cron aún), `crm`, `web`,
   pasarelas. Su `dockerfilePath`, arranque y healthcheck están en el paquete (`services`) y en
   `RAILWAY_ELEPHANT_SOURCE.md`.

### 4.2 Leer el paquete de configuración

Desde un equipo del operador con el repositorio Core en el commit del paquete (o el último verificado):

```bash
pnpm install --frozen-lockfile && pnpm build:cp
# Solo variables de la carpeta privada:
export BACKUP_KEYS=… BACKUP_ACTIVE_KEY_ID=…
export BACKUP_SECONDARY_S3_BUCKET=… BACKUP_SECONDARY_S3_ACCESS_KEY=… BACKUP_SECONDARY_S3_SECRET_KEY=… BACKUP_SECONDARY_S3_ENDPOINT=… [BACKUP_SECONDARY_S3_PREFIX=…]
node dist-cp/backup-job.js recovery-package --source secondary > paquete.json     # NO subir a ningún sitio
node dist-cp/backup-job.js objects registry/ --source secondary                     # copias del registro disponibles
```

El paquete da: commit desplegado (`deployment.commit`, si se informó `ES_DEPLOY_COMMIT`), ids públicos de Railway
del proyecto perdido, servicios con sus variables obligatorias y opcionales (**solo nombres**), servidores MySQL
(alias, host, puerto, nombre de la variable de administración), empresas con estado, servidor, dominios y la
última copia de cada una en cada destino, y la política de retención.

### 4.3 Variables

Para cada servicio del paquete, crear las variables de `required` (y las de `optional` que se usaban), tomando
los **valores** de la carpeta privada y las referencias de Railway (`${{MySQL.…}}`) para las URL de base de datos.
Los usuarios de mínimo privilegio (`es_cp`, `es_core` de solo lectura) se crean de nuevo en el MySQL nuevo
(`docs/runbooks/RAILWAY_ELEPHANT_SOURCE.md`, sección 1) **después** del paso 4.4.

### 4.4 Restaurar en orden (script)

Con el proxy TCP del MySQL nuevo abierto temporalmente:

```bash
export NEW_ADMIN_URL='mysql://root:…@<proxy>:<puerto>/mysql'                  # servidor NUEVO (no se imprime)
export PROVISIONING_DB_SERVERS='[{"alias":"mysql-a","host":"mysql.railway.internal","port":3306,"adminUrlEnv":"NEW_ADMIN_URL"}]'
export REGISTRY_KEYS=… REGISTRY_ACTIVE_KEY_ID=…                               # carpeta privada
export S3_BUCKET=… S3_ACCESS_KEY=… S3_SECRET_KEY=… S3_ENDPOINT=…              # bucket de medios NUEVO (para --to-media)

# Simulación: qué hay, qué se va a crear
node dist-cp/backup-job.js rebuild --source secondary --admin-url-env NEW_ADMIN_URL --server mysql-a \
     --registry-db es_registry --crm-db es_crm --to-media
# Ejecución
node dist-cp/backup-job.js rebuild --source secondary --admin-url-env NEW_ADMIN_URL --server mysql-a \
     --registry-db es_registry --crm-db es_crm --to-media --apply > rebuild.json
```

`host` en `PROVISIONING_DB_SERVERS` es el que usará el Core para conectar (red privada del proyecto nuevo); la URL de
administración (`NEW_ADMIN_URL`) puede ser la del proxy temporal.

Qué hace, en orden (y se detiene o informa con precisión de cada fallo):

1. Lee el paquete (si falta, sigue con lo que hay en el almacenamiento).
2. **Registro**: elige el manifiesto más reciente en `registry/registry/` del destino externo, verifica firma y
   SHA-256, lo restaura en la base **nueva** `es_registry` y compara filas, `CHECKSUM TABLE` y triggers.
3. **Esquema del registro**: plan del ejecutor de migraciones sin pendientes ni objetos ausentes.
4. **CRM comercial** en `es_crm` (igual que el registro).
5. **Cada empresa** (estados `trial`, `active`, `grace`, `suspended`, `archived` del registro restaurado): última
   copia de `tenants/<empresa>/`, base nueva `es_<empresa>_r<fecha>` en `--server`, usuario propio con permisos solo
   sobre ella, verificación completa y **conmutación** del registro restaurado (DSN nuevo cifrado con
   `REGISTRY_KEYS`; la referencia al servidor perdido queda retirada). Una empresa que falla no detiene las demás.
6. **Ficheros** de cada empresa (`t/<empresa>/…`) al bucket de medios nuevo, comprobando el SHA-256 de cada uno.
7. **Validación de consistencia**: cada empresa del registro apunta a su base restaurada y esta responde; ninguna
   empresa del paquete queda sin recuperar.
8. Deja constancia en `backup_restores` del registro restaurado (origen, copia, base, verificación, conmutación).

Salida: JSON con `ok`, duración de cada fase (medida del RTO técnico), fechas de las copias usadas (medida del RPO) y
el resultado por empresa. Código de salida 1 si algo no quedó verificado.

Si una empresa falla: `restore-tenant <empresa> --source secondary --server mysql-a --apply --switch` con
`REGISTRY_ADMIN_DATABASE_URL` apuntando al registro restaurado, o `--backup <id>` para elegir una copia anterior
(`list --destination secondary --tenant <empresa>`).

### 4.5 Usuarios de mínimo privilegio y despliegue

1. Crear `es_cp` (escritura en `es_registry` y `es_crm`) y `es_core` (solo lectura en `es_registry`) con contraseñas
   nuevas; guardarlas en la carpeta privada y en las variables.
2. Cerrar el proxy TCP.
3. Desplegar cada servicio desde el commit del paquete (`RAILWAY_ELEPHANT_SOURCE.md`, sección 3). Comprobar en logs
   `Server running` (Core) y el arranque limpio del plano de control (`{"ctx":"Backups","inventory":true,"copies":true}`).

### 4.6 Pasarelas, dominios y pasarelas de pago

1. Pasarelas Caddy (usuario y hash de la carpeta privada) y un dominio por empresa (`<empresa>.up.railway.app`) o el
   dominio comodín si ya existe. Los dominios propios verificados del paquete (`tenants[].domains`) requieren
   actualizar el CNAME en el DNS de cada cliente (lo hace el propietario con el cliente).
2. Pasarelas de pago y correo: **apagadas** hasta la reapertura (paso 6). Revisar en el proveedor que las URL de
   notificación (webhooks) apunten a los dominios nuevos antes de encenderlas.

## 5. Validación de consistencia (antes de reabrir)

- `GET /cp/v1/backups` y `cli.ts diagnose <empresa>` por empresa: sin incidencias.
- Por empresa: la web responde por su host, el propietario inicia sesión y ve sus datos; ninguna ve datos de otra.
- Recuento de empresas del registro restaurado = empresas del paquete (el `rebuild` ya lo comprueba).
- Ficheros: muestreo de imágenes y documentos por empresa.
- Lanzar una copia completa (`backup-job.js run`) y comprobar `run_finished` con `ok: true` y `secondary.ok: true`.
- Registrar: hora de cada paso, datos perdidos (hora del desastre − `copies.newestCreatedAt`), incidencias.

## 6. Reapertura controlada

1. Primero el CRM (operadores) y el plano de control; después las empresas, de una en una o por grupos.
2. Encender correo y pasarelas de pago tras comprobar sus webhooks.
3. Activar el cron de `backup-job` (`*/15 * * * *`) y la retención (`BACKUP_APPLY_RETENTION=1`;
   `BACKUP_SECONDARY_APPLY_RETENTION=1` solo tras revisar su simulación).
4. Comunicar el cierre del incidente y conservar el informe.

## 7. Prueba realizada (contenedores locales, 17/10/2026)

Entorno: MySQL 8.4 «origen» (`be_o5_dr`), MySQL 8.4 «nuevo» (`be_o5_dr2`), MinIO A (almacenamiento del proyecto y
medios) y MinIO B (externo), imagen MinIO fijada `bitnamilegacy/minio:2025.7.23`. Datos sintéticos.

1. Alta de dos empresas con la baseline completa, registro con migraciones hasta 0011, CRM sintético, un fichero
   por empresa en `t/<empresa>/`.
2. `backup-job.js run` con primario (MinIO A) y secundario (MinIO B): 7 destinos copiados en ambos (2 empresas,
   2 réplicas de ficheros, registro, CRM, paquete), 1.977 ms, 60.782 bytes.
3. «Pérdida total»: `DROP DATABASE` del registro, CRM y las dos empresas, `DROP USER` de sus usuarios, borrado del
   prefijo de copias del MinIO A y del bucket de medios.
4. `backup-job.js rebuild --source secondary … --apply` contra el MySQL **nuevo**, solo con variables de «carpeta
   privada» (sin `REGISTRY_ADMIN_DATABASE_URL` ni el almacenamiento primario): `ok: true` en 8.800 ms (registro
   663 ms, esquema 12 ms, CRM 53 ms, empresas 7.954 ms, ficheros 46 ms, validación 11 ms). Registro restaurado con
   las dos empresas activas en `mysql-nuevo` y las referencias antiguas retiradas; 6 filas en `backup_restores`.
5. El **Core de producción** (`pnpm build` → `node dist/index.js`, `TENANT_MODE=multi`) arrancó contra el registro
   reconstruido (`Server running on http://localhost:3998/`, sin errores) y sirvió `public.getCategories` de cada
   empresa por su host (200, datos propios), con 404 para un host desconocido.

La misma secuencia está automatizada en `server/backupExternal.mysql.test.ts` (también con inicio de sesión real
por empresa y rechazo cruzado) y pasa con directorios, con dos MinIO y con un segundo servidor MySQL.

**No probado:** proveedor externo real, red de Railway, creación real de proyecto/servicios/variables/dominios
(pasos manuales), volúmenes realistas, varias decenas de empresas. Los tiempos de los pasos manuales (4.1–4.6) no
están medidos.
