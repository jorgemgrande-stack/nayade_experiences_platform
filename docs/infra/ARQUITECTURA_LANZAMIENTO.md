# Arquitectura de lanzamiento de Big Elephant (preparada, no ejecutada)

**Estado:** propuesta. **No se ha creado ningún servicio, dominio, base de datos ni credencial, y no se ha tocado DNS ni Railway.** Cada bloque requiere autorización.

Los dominios previstos son `www.bigelephant.es` (web comercial), `crm.bigelephant.es` (CRM) y `control.bigelephant.es` (plano de control, `/cp/v1`).

## 1. Situación actual (verificada el 16/10/2026)

**Railway, proyecto «Nayade Experiences»:**
- servicio `nayade_experiences_platform`, que sirve `www.nayadeexperiences.es`;
- servicio `MySQL`;
- entorno único `production`;
- despliegue automático de **cada push a `main`**, sin esperar al CI y también en cambios de solo documentación.

**Resto:**
- el plano de control, el CRM y la web de Big Elephant **no están desplegados**;
- la cuenta de Railway tiene otros proyectos ajenos a Big Elephant, que **no se tocan**.

**Qué compila Náyade:** según el *metafile* de esbuild, el binario de Náyade (`dist/index.js`) incluye `server/_core`, `server/routers`, `server/*.ts` propios de Náyade, `shared/` y `drizzle/schema.ts`. **No incluye** `server/controlPlane`, `server/crm`, `server/web`, `server/subscriptions`, `server/trials`, `db/`, `docs/` ni `scripts/`.

## 2. Propuesta urgente: que un push a `main` no despliegue Náyade sin necesidad ni antes del CI

Son decisiones de configuración de Railway (**requieren autorización**). Se recomienda aplicar A y B juntas:

| | Medida | Efecto | Riesgo |
|---|---|---|---|
| **A** | **Esperar al CI** («Wait for CI» en el servicio de Railway) | Railway solo despliega un commit de `main` cuando sus *checks* de GitHub han terminado en verde. Un `main` con el CI bloqueante en rojo no llega a producción. | Bajo. El despliegue se retrasa lo que tarda el CI (~10 min). |
| **B** | **Filtros de rutas** (*watch paths*) en el servicio de Náyade | Solo despliegan los cambios que afectan al binario o al build de Náyade. Patrones propuestos (estilo gitignore): `client/**`, `server/**`, `shared/**`, `drizzle/**`, `patches/**`, `package.json`, `pnpm-lock.yaml`, `railway.toml`, `vite.config.ts`, `tsconfig.json`; excluyendo `!server/controlPlane/**`, `!server/crm/**`, `!server/web/**`, `!server/subscriptions/**`, `!server/trials/**` y `!server/**/*.test.ts`. | Medio si se excluye algo que sí entra en el binario. Antes de aplicarlo hay que **repetir la medición** con el *metafile* sobre `main` y añadir una prueba de CI que falle si el binario empieza a importar una ruta excluida. |
| C | Desactivar el despliegue automático y desplegar desde GitHub Actions (`railway up` tras el CI, con un token de proyecto) | Control total del momento del despliegue | Más piezas: un token en GitHub y un *workflow* nuevo |

**Con A + B, la integración del Bloque 2 al 4 dejaría de redesplegar Náyade.** Los PR de documentación, del plano de control y de migraciones del CRM y del registro no generarían despliegues. Solo desplegarían los PR que tocan Náyade: #79, #85, #73, #64, #65, el `package.json` de #66 y #75, y los demás que cambien `server/_core`.

## 3. Arquitectura objetivo (proyecto Railway nuevo: «Big Elephant»)

**Separación:** un proyecto propio, separado del de Náyade, con dos entornos, `staging` y `production`. Las variables y bases de datos de cada entorno son independientes.

| Servicio | Origen | Dominio (producción) | Build / arranque | Salud |
|---|---|---|---|---|
| `web` | repo `bigelephant-web` (`main`) | `www.bigelephant.es` (+ redirección del dominio raíz) | `pnpm build` → estáticos servidos por un servidor estático, o CDN | `GET /` 200 |
| `crm` | repo `big-elephant-crm` (`main`) | `crm.bigelephant.es` | `pnpm build` → SPA estática, con `VITE_CP_URL=https://control.bigelephant.es` | `GET /` 200 |
| `control` | repo Core (`main`), `Dockerfile.controlplane` (`build:cp`/`start:cp`) | `control.bigelephant.es` | imagen mínima sin cliente | `GET /healthz` (existe en `controlPlane/api.ts`); falta `/readyz` con comprobación de BD |
| `mysql-cp` | MySQL 8 gestionado por Railway | privado (`*.railway.internal`) | — | — |

**Bases de datos** (en `mysql-cp`; esquemas separados y un usuario de aplicación por esquema con permisos mínimos):

| Esquema | Uso | Migraciones (explícitas, nunca al arrancar) |
|---|---|---|
| `be_registry` | registro de tenants, operadores, tickets | `scripts/registry-migrate.ts` (`REGISTRY_MIGRATE_URL`, `--confirm-database`) |
| `be_crm` | CRM, catálogo comercial, suscripciones, pruebas | `scripts/db/migrate.ts --dir db/crm/migrations --confirm-database` |
| `be_billing` | motor de facturación v1 (apagado) | `db/billing/0000_billing.sql` |
| `be_erm` | consumos y cuotas | `db/erm` |
| (tenants) | una BD por tenant | aprovisionamiento (baseline + `db/migrations`), **solo con la multiempresa autorizada** |

**Mismo origen para el CRM:** como la sesión del CRM va por cookie, el CRM y el plano de control deben compartir **sitio** (`*.bigelephant.es`). Si no, el navegador no conserva la sesión, como se comprobó en las E2E de esta noche. `CP_ALLOWED_ORIGINS=https://crm.bigelephant.es`.

### Variables de entorno de `control` (solo nombres; los valores se generan en Railway y nunca van al repositorio)

| Grupo | Variables |
|---|---|
| Básicas | `NODE_ENV=production`, `CP_PORT`, `CP_TRUST_PROXY=1`, `CP_COOKIE_SECURE=true` |
| Autorización | `CP_TOKENS` (solo hashes), `CP_SESSION_SECRET`, `CP_OPERATOR_AUTH`, `CP_SESSION_IDLE_MINUTES`, `CP_SESSION_MAX_HOURS` |
| Registro | `REGISTRY_ADMIN_DATABASE_URL`, `REGISTRY_KEYS`, `REGISTRY_ACTIVE_KEY_ID` (y `REGISTRY_MIGRATE_URL` **solo** al migrar) |
| CRM y web | `CRM_DATABASE_URL`, `CP_ALLOWED_ORIGINS`, `CP_PUBLIC_ORIGINS=https://www.bigelephant.es`, `CP_PUBLIC_FORM_SECRET`, `CP_WEB_PUBLISH_HOOK` |
| Facturación (apagada) | `BILLING_DATABASE_URL`, `BILLING_CATALOG_FILE`. **No** se definen `BILLING_PROVIDER` ni `BILLING_CHARGES_ENABLED` |
| Otros | `ERM_DATABASE_URL`, `SUPPORT_JWT_SECRET`, `CP_ALERT_WEBHOOK`, `CP_RESET_*` (correo de restablecimiento) |
| Multiempresa | `PROVISIONING_DB_*` y `CP_PLATFORM_*`, **sin definir** hasta autorizarla |

## 4. Dominios y HTTPS (requiere autorización; no se toca DNS)

1. En Railway, añadir el dominio personalizado a cada servicio, que generará el `CNAME` que hay que crear.
2. Crear en el proveedor DNS de `bigelephant.es` los registros `CNAME` de `www`, `crm` y `control`, más la redirección del dominio raíz a `www`. Railway emite los certificados TLS automáticamente.
3. Activar HSTS cuando todo funcione por HTTPS. El plano de control ya fija cabeceras de seguridad y cookies `Secure`.

## 5. CI/CD

- **Bloqueante:** el CI del Core ya lo es para las suites multiempresa. Para el CRM y la web se propone convertir sus *workflows* actuales en *checks* obligatorios de la protección de `main`, que hoy no está activa.
- **Protección de ramas** en los tres repositorios: PR obligatorio, *checks* en verde, sin *force push* y con revisión.
- **Despliegue:** Railway con «Wait for CI» (§2-A). El `staging` despliega desde `main`; `production`, desde una etiqueta o rama `release` (o con aprobación manual).
- **Migraciones:**
  - siempre explícitas, antes del despliegue que las necesita;
  - con copia de seguridad previa;
  - nunca en el arranque (ya aplicado en #79);
  - si se automatizan, como `preDeployCommand` aislado y con `--confirm-database`, previa autorización.

## 6. Copias de seguridad y recuperación

- **Copias:** activar las copias del volumen de MySQL en Railway, y además un `mysqldump --single-transaction` diario por esquema a un almacenamiento externo cifrado (S3 o MinIO), con retención de 30 días y una **prueba de restauración mensual** en `staging`.
- **Antes de cada migración:** copia verificada y anotación del punto de restauración.
- **Recuperación por capa** (como en `docs/runbooks/INTEGRACION_CONTROLADA.md` §5):
  - código: *rollback* de despliegue o `git revert`;
  - esquema: `down` del ejecutor o restauración;
  - datos: restauración puntual;
  - configuración: valor anterior anotado.

## 7. Logs y observabilidad

- **Logs:** el plano de control ya escribe en JSON (`ctx`, `event`), y Railway los conserva y permite filtrarlos. Se propone enviarlos además a un servicio externo (Better Stack, Grafana Cloud…) con alertas.
- **Métricas:** `/metrics` (Prometheus) existe en el plano de control y debe quedar **solo en la red interna**.
- **Alertas:** `CP_ALERT_WEBHOOK` (https), con avisos de caída, errores 5xx, cuotas y aprovisionamientos fallidos.
- **Salud:** `/healthz` del plano de control y `/healthz`/`/readyz` de Náyade, enlazados como *healthcheck* de Railway, para que un arranque fallido no sustituya al despliegue bueno.

## 8. Secretos

- **Dónde viven:** solo en las variables de Railway, por entorno. Nunca en el repositorio, en `.env` versionados ni en variables `VITE_*`/`PUBLIC_*`.
- **Tokens de servicio:** se guardan como hash (`CP_TOKENS`) y con ámbitos mínimos.
- **Rotación:** procedimiento existente (`REGISTRY_KEYS` con identificador activo y lectura con claves anteriores).
- **Antes de lanzar:** auditar las dependencias vulnerables (ver `docs/overnight/INFORME_OVERNIGHT_BIG_ELEPHANT.md`).

## 9. Orden de puesta en marcha propuesto (todo con autorización)

1. Medidas §2-A y §2-B en el servicio de Náyade, que **reducen el riesgo de toda la integración**.
2. Integración controlada (`INTEGRACION_CONTROLADA.md`).
3. Proyecto «Big Elephant» en Railway con el entorno `staging` y los servicios `mysql-cp` y `control`. Migraciones explícitas, operador inicial (`scripts/cp-operators.ts bootstrap`) y comprobaciones.
4. Los servicios `crm` y `web` en `staging`, con E2E contra `staging`.
5. Dominios y HTTPS (§4).
6. `production`: repetir 3 y 4 con copias de seguridad y monitorización activas.
7. **No incluido:** cobros reales, multiempresa en Náyade, prueba autónoma pública. Cada uno tiene su propia autorización.
