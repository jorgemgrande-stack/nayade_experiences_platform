# Despliegue del plano de control y del CRM

Estado: **preparado, NO desplegado** (B12: aloja­miento y coste). `TENANT_MODE=single` en producción no cambia.
El plano de control es un proceso aparte del Core de Náyade, con sus propias bases de datos.

## 1. Piezas
| Pieza | Artefacto | Notas |
|---|---|---|
| Plano de control (`/cp/v1`) | `Dockerfile.controlplane` (`pnpm build:cp` → `dist-cp/main.js`, `pnpm start:cp`) | puerto `CP_PORT` (4100) |
| CRM (SPA) | repo `big-elephant-crm` → `dist/` estático | se sirve en un origen HTTPS propio |
| BD del registro | MySQL aparte | migraciones: `scripts/registry-migrate.ts` |
| BD ERM / facturación / CRM comercial | MySQL (pueden compartir servidor, esquemas distintos) | `ERM_DATABASE_URL`, `BILLING_DATABASE_URL`, `CRM_DATABASE_URL` |

## 2. Orden de puesta en marcha
1. **Crear** las bases de datos vacías y un usuario con permisos solo sobre ellas.
2. **Migrar el registro** (plan y después ejecución):
   `REGISTRY_ADMIN_DATABASE_URL=… pnpm tsx scripts/registry-migrate.ts` → revisar → `… --execute`.
   Comprueba `registry_meta.schema_version` = última (`0006` con tickets).
3. **Secretos** (generar con `openssl rand -base64 32`; no reutilizar los de Náyade):
   `REGISTRY_KEYS`, `REGISTRY_ACTIVE_KEY_ID`, `INTEGRATION_KEYS`, `INTEGRATION_ACTIVE_KEY_ID`, `CP_SESSION_SECRET`, `SUPPORT_JWT_SECRET` (≥ 32).
4. **Tokens de servicio**: `CP_TOKENS` = JSON `[{id, sha256, scopes}]` (guardar solo el hash SHA-256 del token; ámbitos mínimos).
5. **Arrancar** el proceso y comprobar `/cp/v1/auth/me` con un token y `/metrics`.
6. **Publicar el CRM** con `CP_ALLOWED_ORIGINS` = su origen exacto (sin comodines).
7. **Primer acceso**: SSO (`CP_OIDC_*`, `CP_OIDC_USERS`, B10) o token de operador.

## 3. Variables
| Variable | Obligatoria | Uso |
|---|---|---|
| `CP_TOKENS` | sí | tokens de servicio con ámbitos (si falta, el proceso **no arranca**) |
| `REGISTRY_ADMIN_DATABASE_URL` | sí | BD del registro (lectura/escritura) |
| `REGISTRY_KEYS`, `REGISTRY_ACTIVE_KEY_ID` | sí | cifrado de DSN de tenants |
| `CP_ALLOWED_ORIGINS` | CRM web | orígenes CORS exactos |
| `CP_PLATFORM_TARGET`, `CP_PLATFORM_DOMAIN` | dominios/alta | CNAME de plataforma y dominio de subdominios |
| `ERM_DATABASE_URL` | cuotas/uso | medición |
| `BILLING_DATABASE_URL`, `BILLING_CATALOG_FILE` | facturación | catálogo parametrizable (sin precios inventados) |
| `BILLING_CHARGES_ENABLED` + proveedor | **no activar** | cobros reales requieren autorización (B11) |
| `CRM_DATABASE_URL` | CRM comercial | leads, oportunidades, contratos |
| `PROVISIONING_DB_ADMIN_URL`, `PROVISIONING_DB_HOST/PORT/ALIAS` | alta de empresas | servidor donde se crean BDs de tenant |
| `CP_OIDC_ISSUER/CLIENT_ID/JWKS_URL`, `CP_OIDC_USERS` | SSO | |
| `CP_ALERT_WEBHOOK`, `CP_ALERTS_EVERY_SECONDS` | alertas | webhook https |
| `SUPPORT_JWT_SECRET` | soporte delegado | ≥ 32 caracteres |

## 4. Verificación posterior
- `GET /cp/v1/auth/me` → 200 con token válido, 401 sin él.
- `GET /cp/v1/tenants` → lista vacía o la esperada; `GET /cp/v1/billing/plans` → catálogo.
- `/metrics` accesible solo desde la red interna / con el control de acceso del proveedor.
- Logs sin errores `internal_error`.

## 5. Reversión
El plano de control no escribe en la BD de Náyade ni en `TENANT_MODE`. Para revertir: detener el proceso y retirar el origen
del CRM. Las migraciones del registro son aditivas (`IF NOT EXISTS`); restaurar la copia previa si hiciera falta.

## 6. Fuera de alcance de este runbook (requieren autorización)
Activar `TENANT_MODE=multi`, cobros reales, DNS de dominios reales, rotación de credenciales externas.
