# Entorno `live` de Elephant Source: puesta en marcha y apertura (18/10/2026)

Entorno comercial definitivo, separado del de integración (`production`, que aloja el sandbox de Stripe). Mismo proyecto de Railway («Elephant Source», `5f32ccca-3f72-4c48-bc63-57881cb9e166`) y mismos servicios. En `live` cada servicio tiene su propia instancia, sus variables, sus volúmenes y su base de datos: **nada se comparte ni se copia** de `production`.

| | Estado |
|---|---|
| Entorno `live` (`3d5d4e36-6edc-4efb-b5ee-8406e127624a`) | Creado **vacío**: sin servicios, volúmenes, variables ni despliegues. Coste 0 $ |
| Stripe real (`acct_1URULE9RzfmCBuai`) | Productos, precios y Customer Portal creados (`STRIPE_PRODUCCION.md` §2 y §3). Sin webhook, sin clave y sin cobros |
| Código | Modo live en la PR #137 (`STRIPE_PRODUCCION.md` §8). Checkout live bloqueado sin política fiscal |

Hay dos estados:
- **Producción preparada:** todo desplegado y verificado, con la contratación cerrada.
- **Producción abierta:** contratación pública y cobros reales.

Cada paso tiene una aceptación. Si no se cumple, se para y se revierte ese paso; nunca se encadena un arreglo (`CLAUDE.md`).

## 1. Requisitos previos

1. PR #137 (modo live) fusionada en `integration/elephant-source`, con la CI en verde.
2. Commit exacto que se despliega: el de `integration/elephant-source` tras la fusión, exportado con `git archive`, sin `railway.toml` ni `data/seed.json` (`RAILWAY_ELEPHANT_SOURCE.md` §3).
3. El entorno `live` se crea **vacío** (hecho). **Nunca** se duplica `production`: copiaría la clave del sandbox, `BACKUP_KEYS`, `REGISTRY_KEYS` y el resto de secretos.

## 2. Datos (Producción preparada)

| # | Paso | Aceptación |
|---|---|---|
| D1 | Servicio MySQL 8.4 en `live`, con volumen propio y el mismo arranque que en `production`, pero con `--innodb-buffer-pool-size=256M` (suficiente para empezar; §5) | `mysqladmin ping`; volumen propio |
| D2 | Bases `es_registry` y `es_crm`, y usuarios de mínimo privilegio `es_cp` (escritura en las dos) y `es_core` (solo lectura en `es_registry`), con contraseñas **nuevas**. Mismo procedimiento que `RECUPERACION_TOTAL.md` §5.1 | Permisos comprobados con `SHOW GRANTS` |
| D3 | Registro: esquema y migraciones con `scripts/registry-migrate.ts --execute --confirm-database es_registry --allow-remote` (`MIGRACIONES_ELEPHANT_SOURCE.md`) | `status` sin pendientes |
| D4 | CRM: `db/crm/0000_crm.sql` y después `scripts/db/migrate.ts up --dir db/crm/migrations --apply --confirm-database es_crm --allow-remote` (de la 0001 a la **0013**) | `status`: 13 aplicadas y ninguna pendiente |
| D5 | Catálogo: `scripts/catalog/seed-elephant-source.ts --apply --confirm-database es_crm` | Precios aprobados con los id 1 a 4 = Essential y Business, mensual y anual. **Comprobado el 18/10/2026 sobre una base nueva:** 1 = 2900, 2 = 27900, 3 = 7900, 4 = 75900, 5 y 6 = Enterprise. Así coinciden con las `lookup_key` `…:v1` a `…:v4` de los precios reales ya creados |
| D6 | Buckets de Railway en `live`: copias y ficheros, **propios** | Credenciales S3 propias |

El acceso a la base desde fuera se hace solo con un proxy TCP **temporal**, que se borra al terminar (como en la 0012 del 18/10/2026).

## 3. Secretos

**Generados en el proceso**, sin pasar por la terminal: `crypto.randomBytes` y escritura con `railway variable set --stdin --skip-deploys`. Siempre nuevos, nunca los de `production`:

| Variable | Servicios |
|---|---|
| `REGISTRY_KEYS`, `REGISTRY_ACTIVE_KEY_ID` | `core`, `controlplane`, `backup-job`, `restore-drill` |
| `INTEGRATION_KEYS`, `INTEGRATION_ACTIVE_KEY_ID` | `core`, `controlplane` |
| `BACKUP_KEYS`, `BACKUP_ACTIVE_KEY_ID` (`bk1` propia de live) | `backup-job`, `restore-drill` |
| `JWT_SECRET`, `SUPPORT_JWT_SECRET` | `core` (y `controlplane` para el soporte) |
| `CP_SESSION_SECRET`, `CP_PUBLIC_FORM_SECRET` | `controlplane` |
| Contraseñas de MySQL y de los usuarios `es_cp` y `es_core` | `MySQL` y las URL de conexión de cada servicio |

**Que introduce el propietario**, porque son credenciales que debe conocer o que solo ve él. Directamente en Railway (`Get-Clipboard | railway variable set … --stdin --skip-deploys`) o en el Dashboard, nunca en el chat:

| Variable | Origen |
|---|---|
| `CP_STRIPE_API_KEY` | Clave **restringida** `rk_live_…` en la cuenta real, con los mismos permisos que la del sandbox (`STRIPE_FASE_A.md` §5): Customers, Checkout Sessions y Customer portal en escritura; Subscriptions, Invoices, Prices, Products, Events, Charges y Disputes en lectura; todo lo demás, ninguno |
| `CP_STRIPE_WEBHOOK_SECRET` | `whsec_` del destino del webhook **real**, cuya URL es `https://<dominio del crm de live>/cp/v1/stripe/webhook`, con los 18 eventos, carga snapshot y API `2026-09-30.endive` |
| `GATEWAY_USER` y `GATEWAY_PASSWORD_HASH` | Credenciales de las pasarelas (CRM, web y core). Hash bcrypt con `caddy hash-password` |
| Primer operador del CRM | Alta del operador administrador |
| `BREVO_API_KEY`, `BREVO_WEBHOOK_TOKEN` | Clave de Brevo para `live`. Solo cuando se active el correo (§6) |

## 4. Servicios (Producción preparada)

Mismos `dockerfilePath` que en `production` (`RAILWAY_ELEPHANT_SOURCE.md` §3), desplegados con `railway up … -e live` desde el export del commit verificado.

| Servicio | Configuración clave en `live` | Aceptación |
|---|---|---|
| `controlplane` | `CP_STRIPE_MODE=live`, `CP_STRIPE_NAMESPACE=live`, **sin** `CP_STRIPE_TAX_POLICY`, `CP_TRUST_PROXY=2`, `CP_ORCHESTRATOR_ENABLED=1`, `MAIL_MODE=off`, **sin** `CP_PAYMENTS_PROVIDER` ni `CP_PAYMENTS_TEST_WEBHOOK_SECRET` (los pagos simulados no arrancan en live). Apagados: `CP_STRIPE_CHECKOUT_ENABLED`, `CP_PUBLIC_SELF_SERVICE_ENABLED` y `CP_TRIALS_SCHEDULER_ENABLED` | `ctx="Stripe" mode="live" mounted=true`, `checkoutReason="tax_policy_pending"`, `/healthz` 200 |
| `core` | `TENANT_MODE=multi`, su propio `REGISTRY_DATABASE_URL` (usuario `es_core`) | `Server running` y `/healthz` 200 |
| `crm` (pasarela y SPA del CRM) | `STRIPE_WEBHOOK_PUBLIC=1` y `CP_UPSTREAM` hacia el `controlplane` de live | `/__gateway/health` 200; todo lo demás, 401 |
| `web` | `PUBLIC_INTAKE_URL` y `PUBLIC_ORIGIN` de live, `PUBLIC_CHECKOUT_RETURN_ENABLED=1` y **sin** `PUBLIC_CHECKOUT_ENABLED` | El `deploy.sh` de la web con las comprobaciones de rutas |
| `core-gateway` | Dominio propio con **comodín** para las empresas: una sola pasarela que da acceso a cada administrador (la `accessUrl`) sin crear una pasarela por empresa | Una empresa de prueba resuelve en su subdominio |
| `backup-job` | Tarea cada 15 min, `BACKUP_KEYS` de live y su bucket | `run_finished ok=true` y `config/recovery ok` |
| `restore-drill` | Arranque `node dist-cp/backup-job.js list`, `NEVER` | Ensayo de restauración del CRM de live en una base nueva (`verification.ok`) |

**Verificación final de Producción preparada:**
1. Copia de seguridad correcta y ensayo de restauración.
2. Catálogo sincronizado con los 4 precios **reales**: los `price_…` del §2 de `STRIPE_PRODUCCION.md`.
3. La clave da 403 en las operaciones no concedidas.
4. `GET /stripe/status` con `mode: "live"` y `checkoutBlocked`.
5. Ningún cargo ni suscripción en la cuenta real.

## 5. Coste

Con las tarifas y el consumo medido (`STRIPE_PRODUCCION.md` §5.2):
- **En reposo:** ≈ 9–11 $/mes con un buffer de MySQL de 256 MB, o ≈ 16–18 $/mes con 1 GB.
- **Con unas 50 empresas:** ≈ 25–35 $/mes.

Se mide de verdad con `railway metrics -a -e live` en cuanto haya servicios.

## 6. Producción abierta: lo que la bloquea

| # | Bloqueo | Quién lo levanta | Consecuencia técnica |
|---|---|---|---|
| A1 | **Política fiscal** (`FISCALIDAD_STRIPE.md` DF-2 a DF-8): quién emite la factura legal (Stripe Invoicing o software propio), el IVA por cliente y territorio (B2B nacional, intracomunitario con inversión del sujeto pasivo, fuera de la UE, consumidores), la numeración y las series, y Canarias, Ceuta y Melilla | Propietario y asesor fiscal | Fijar `CP_STRIPE_TAX_POLICY` (hoy solo `stripe_tax_exclusive`), revisar los países de facturación y la recogida de NIF |
| A2 | **VeriFactu** (RD 1007/2023 y su calendario de aplicación): si la factura legal la emite Stripe, comprobar si cumple el reglamento de sistemas de facturación o si se necesita un sistema propio o certificado | Asesor fiscal | Puede obligar a emitir las facturas fuera de Stripe |
| A3 | **Textos legales publicados** (condiciones, privacidad, contratación, cancelación): hoy son borradores | Legal | `CP_TERMS_VERSION`, y las URL en `business_profile` del Portal y en Checkout |
| A4 | **Correo real**: autenticación del dominio (DKIM de Brevo publicado; el SPF `v=spf1 a mx ~all` **no** incluye Brevo; DMARC en `p=none`), clave de live y prueba de entregabilidad a buzones propios | Propietario (DNS) | `MAIL_MODE` de live, y nunca envíos masivos |
| A5 | **Dominio de la web**: `www.bigelephant.es` apunta hoy al servicio `web` de **integración** (landing de prelanzamiento y lista de lanzamiento) | Propietario | Moverlo al `web` de live en la apertura, con sus formularios hacia el `controlplane` de live |
| A6 | **Alta automática del administrador**: con un dominio comodín propio, la `accessUrl` funciona sin crear una pasarela por empresa | DNS | `core-gateway` con comodín |
| A7 | **Primer cobro real**: autorización expresa del propietario | Propietario | `CP_STRIPE_CHECKOUT_ENABLED=1` y, para el autoservicio, `CP_PUBLIC_SELF_SERVICE_ENABLED=1` |
