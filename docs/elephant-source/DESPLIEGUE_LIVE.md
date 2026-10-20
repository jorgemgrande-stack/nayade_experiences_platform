# Paquete de despliegue de Railway `live`

**Estado (20/10/2026, 22:00 UTC).** Preparado y validado en simulación contra `live`. **No se ha desplegado ni migrado nada.** Railway mantiene los despliegues pausados. La ejecución necesita tu **autorización expresa** en dos momentos: las migraciones (§4) y el despliegue (§5). Cuando Railway vuelva, nada se ejecuta solo.

## 1. Versiones exactas

| Repositorio | Commit | Rama | Servicios |
|---|---|---|---|
| Core (`nayade_experiences_platform`) | **`COMMIT_CORE`** | `integration/elephant-source` | `controlplane`, `backup-job`, `restore-drill` (`Dockerfile.controlplane`); `core` (`deploy/railway/core.Dockerfile`); `core-gateway` (`deploy/railway/gateway/Dockerfile`) |
| CRM (`big-elephant-crm`) | **`24bb93e`** (incluye el #26: Stripe live y sincronización del catálogo) | `integration/elephant-source` | `crm` (`deploy/railway/Dockerfile`) |
| Web (`bigelephant-web`) | **`42741e2`**, la de `production` | `feat/elephant-web-portfolio` | `web` (`deploy/railway/Dockerfile`) |

**Decisión pendiente sobre la web:** `feat/web-marketing-design` (`5ea5be6`) tiene el diseño comercial y las páginas legales **en borrador** (`noindex`, «Pendiente de revisión legal»). Se despliega cuando apruebes los textos. Hasta entonces, `42741e2`.

**Estado actual de `live` (inventario de solo lectura de esta noche):**
- código anterior al 19/10;
- CRM en la 0013 y registro en la 0011;
- **0 empresas**;
- operador `jorge`;
- copias del registro y del CRM al día (cada 15 minutos; última a las 21:45 UTC).

**Puntos de vuelta atrás (despliegues actuales de `live`):**

| Servicio | Despliegue |
|---|---|
| controlplane | `4eb0ddf7-f35e-4d69-8461-fd7d35a8fdee` |
| core | `b49a04a0-f7c3-4855-8088-91770f5b7464` |
| core-gateway | `40269ad5-6cf0-4d95-a1eb-fad51fa39fe4` |
| crm | `07255a2b-5fd5-4540-ae2b-3b3b7e19f4a6` |
| web | `8d3627c7-25ef-41fa-8a05-f430fc1ca7d0` |
| backup-job | `c50af34d-4ebc-4ea4-bf83-8c6edce09238` |
| restore-drill | `b03b105d-8b43-456f-bcb4-587b39120db2` (arranque `list`) |

## 2. Migraciones pendientes (verificadas en simulación contra `live`)

| Base | Migraciones | Tipo | Reversión |
|---|---|---|---|
| Registro | 0012 (verificación en dos pasos de los operadores), 0013 (límites contratados y uso) | Aditivas y repetibles | SQL en la cabecera de cada fichero. **Ojo:** después de la 0012, el rol que exige MFA tendrá que darlo de alta al entrar |
| Permiso del Core | `GRANT INSERT, UPDATE ON es_registry.tenant_usage TO 'es_core'@'%'` (después de la 0013) | Permiso | `REVOKE INSERT, UPDATE ON es_registry.tenant_usage FROM 'es_core'@'%'` |
| CRM | 0014 a 0022 (9 migraciones, 13 sentencias) | Aditivas | Ficheros `.down.sql`. **No se revierten en la práctica:** el código anterior funciona con las tablas nuevas. Las de 0014, 0016, 0021 y 0022 borran evidencia (consentimiento, facturas, VIES, desistimientos): exportar antes. La 0013 ya aplicada **falla a propósito** si hay filas live |
| Empresas | Ninguna (0 empresas en `live`). Las nuevas se crean con la línea base y todas las migraciones | — | — |

**Paquete:**
```
scripts/railway/build-migration-bundle.sh COMMIT_CORE <salida>
# → migrations-COMMIT_CORE.tgz y su SHA-256 (comprobar el mismo SHA dentro del contenedor)
```
Validado esta noche con `0f6a99d`: registro con 0012 y 0013 pendientes, CRM con 9 pendientes, sin incompletas ni conflictos.

## 3. Requisitos previos

1. Railway sin la pausa de despliegues.
2. **Copia nueva y ensayo de restauración** del registro y del CRM en bases **nuevas** (`es_registry_drill_live_AAAAMMDD` y `es_crm_drill_live_AAAAMMDD`), con `restore-drill`:
   ```
   node dist-cp/backup-job.js run
   node dist-cp/backup-job.js restore-platform registry --admin-url-env PROVISIONING_DB_ADMIN_URL --database es_registry_drill_live_AAAAMMDD --apply
   node dist-cp/backup-job.js restore-platform crm --admin-url-env PROVISIONING_DB_ADMIN_URL --database es_crm_drill_live_AAAAMMDD --apply
   ```
   Comprobar `verification.ok: true` y el número de tablas y filas de cada base. Al terminar, devolver `restore-drill` a `list`.
3. Tu autorización: «autorizo migraciones live».

## 4. Migraciones (con autorización)

Dentro del contenedor de `controlplane` de `live` (red privada), con el paquete verificado por su SHA-256:
```
cd /app/.mig
node run.cjs registry plan            # debe listar 0012 y 0013
node run.cjs registry apply           # aplica 0012 y 0013
#   permiso del Core (con la URL de administración, desde el mismo contenedor):
#   GRANT INSERT, UPDATE ON es_registry.tenant_usage TO 'es_core'@'%';
node run.cjs crm plan                 # debe listar de la 0014 a la 0022
node run.cjs crm apply
node run.cjs crm status               # todas aplicadas
```
Después de cada paso: un inventario de solo lectura (versión del registro, registro de migraciones del CRM y permisos del Core). Si un paso falla, **se para**: §7.

## 5. Despliegue (con autorización), en este orden

Cada servicio: `git archive <commit> | tar -x -C <dir>` y después `railway up <dir> --path-as-root -s <servicio> -p 5f32ccca-3f72-4c48-bc63-57881cb9e166 -e live --detach -m "<repo> <commit>"`. Tras cada uno, comprobar el arranque antes de seguir.

| # | Servicio | Comprobar en el arranque |
|---|---|---|
| 1 | `backup-job` y `restore-drill` | La siguiente copia programada sale `ok` |
| 2 | `controlplane` | `ctx` sin errores: `CommercialEvents enabled`, `Limits enabled`, `Withdrawals mounted`, `Stripe mounted` con `checkout: false` y `checkoutReason: tax_policy_pending`, `Mail mode: off`, `Commerce purchases enabled: false` |
| 3 | `core` | `Server running`, sin errores de jobs |
| 4 | `core-gateway` | `/__gateway/health` = 200 |
| 5 | `crm` | Login de operador; en Pedidos, «MODO REAL» y el aviso fiscal pendiente |
| 6 | `web` | `/cp/v1/public/site` = 200, sin `internalOnly` |

Después, en el CRM: **«Sincronizar catálogo de Stripe»**, que enlaza los 4 precios live existentes sin crear ninguno. Comprobar que quedan `linked: 4` y ningún precio nuevo en Stripe.

## 6. Variables de `live` (no aplicadas)

| Servicio | Variable | Cuándo |
|---|---|---|
| controlplane | `CP_ALERT_EMAIL` (avisos al equipo) | Con el despliegue |
| controlplane | `CP_TOKENS`: token del Core con `commerce:withdrawal` (y `commerce:purchase` si se activan las compras) | Con el despliegue |
| core | `CP_COMMERCE_URL` y `CP_COMMERCE_TOKEN` | Con el despliegue |
| core | `CENTRAL_LOGIN_HOST=app.bigelephant.es` | Con el traslado de dominios |
| gateways y controlplane | Variables de dominios (ver `LANZAMIENTO_COMERCIAL.md` §5) | Con el traslado de dominios |
| controlplane y core | Proveedor de correo (ver `CORREO_PROVEEDOR.md`), `MAIL_MODE` | Con tu autorización de envíos |
| controlplane | `CP_STRIPE_TAX_POLICY`, `CP_STRIPE_FISCAL_SCENARIOS`, `CP_STRIPE_TAX_EXPECTATIONS`, `CP_STRIPE_SCENARIO_COUNTRIES`, `CP_STRIPE_CONSUMER_RATES`, `CP_TERMS_*`, `CP_PRIVACY_*`, `CP_PRECONTRACT_VERSION`, `CP_CONSUMER_WITHDRAWAL` | Con la aprobación fiscal y legal |
| controlplane | `CP_ORCHESTRATOR_ENABLED=1`, `CP_STRIPE_WORKER_ENABLED=1`, `CP_STRIPE_CHECKOUT_ENABLED=1`, `CP_PUBLIC_SELF_SERVICE_ENABLED=1` | **Apertura**, con tu confirmación expresa |

## 7. Reversión y recuperación

| Fallo | Acción |
|---|---|
| Un servicio no arranca tras desplegar | Volver a su despliegue anterior (§1, puntos de vuelta atrás) con `railway up` desde el export de su commit anterior. Railway no reutiliza la imagen subida con `railway up`. Las migraciones aditivas no obligan a revertir |
| Falla una migración del CRM a medias | El DDL de MySQL **no es transaccional**: el ejecutor marca la migración al empezar y, si falla a medias, **se niega a continuar** hasta que una persona revise el esquema y la resuelva (`migrate.ts resolve --id <NNNN> --as applied|not-applied`). Revisar con `crm status` y comparar con el fichero; deshacer lo parcial a mano (o con su `.down.sql`) y volver a `apply`. Si no se puede: restaurar el CRM de la copia de §3 en una base nueva y conmutar (`RECUPERACION_TOTAL.md`) |
| Falla una migración del registro | Son repetibles: corregir y repetir `registry apply`. Si no se puede: la reversión SQL de su cabecera |
| El código nuevo funciona mal con datos reales | Vuelta atrás del código (§1). La base nueva es compatible con el código anterior |
| Pérdida de datos | Restaurar la copia verificada en §3 en una base nueva y conmutar el servicio |
