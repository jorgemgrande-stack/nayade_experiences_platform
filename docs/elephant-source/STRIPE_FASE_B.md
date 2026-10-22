# Stripe Billing · Fase B: catálogo, Checkout y Customer Portal (17/10/2026)

**Rama:** `feat/stripe-fase-a`, PR #128 contra `integration/elephant-source`. Autorizada por el propietario el 17/10/2026, **solo en pruebas**. Diseño de referencia: `STRIPE_FASE_A.md` (§16 y §17).

## 0. Estado en una línea

**Código de la Fase B hecho y probado.**

**Pausadas hasta la comprobación humana del sandbox (§1):**
- las escrituras en Stripe (catálogo y configuración del Customer Portal);
- la migración `0012` en Railway;
- las credenciales y el despliegue.

## 1. Verificación del entorno (obligatoria antes de escribir)

Lecturas por el MCP oficial (sesión OAuth del propietario), con las herramientas de escritura bloqueadas:

| Comprobación | Resultado |
|---|---|
| Cuentas accesibles por la conexión | **Una:** `acct_1URULO5wMYhQ9O0d`, «Entorno de prueba de Iron Elephant Consulting» |
| `livemode` | **false** |
| Products, Prices, Customers, Subscriptions, configuraciones del Portal, webhooks | **0** en todos: no hay nada que duplicar |
| Stripe Tax (`/v1/tax/settings`) | `status: pending` (falta `head_office`), así que **no calcula ni cobra impuestos** |
| ¿Sandbox general independiente de la cuenta real? | **No demostrable con la API.** Todo apunta a que sí: nombre propio de sandbox, creada hoy (`created` 17/10/2026 09:56 UTC), identificador propio, sin ninguna cuenta live en la conexión, sin datos y con `charges_enabled: false`. Pero ningún campo lo confirma |

**Decisión:** siguiendo la instrucción («si no puedes demostrarlo, detente y solicita comprobación humana»), **no se ha hecho ninguna escritura en Stripe.**

**Comprobación que se pide al propietario** (2 minutos, en el Dashboard):
1. Abrir el selector de cuenta. «Entorno de prueba de Iron Elephant Consulting» debe aparecer en la sección **Sandboxes**, no como el «modo de prueba» de la cuenta real.
2. Dentro de la cuenta **real**: Settings → Account details → identificador `acct_…`. Debe ser **distinto** de `acct_1URULO5wMYhQ9O0d`.
3. Confirmarlo por escrito. Con esa confirmación se ejecutan las operaciones del §2 y, si se decide, las del §3.

## 2. Catálogo: operaciones exactas previstas en el sandbox (no ejecutadas)

Origen de los importes: precios **aprobados** del catálogo de Railway (`GET /cp/v1/subscriptions/offer`, leído hoy). Enterprise no está en la oferta de autoservicio y no se crea.

| # | Operación (Stripe, sandbox) | Parámetros |
|---|---|---|
| 1 | `POST /v1/products` | `name` «Elephant Core Essential», `metadata` { `es_product_key`: `essential`, `es_catalog`: `elephant-source` } |
| 2 | `POST /v1/prices` | `product` = (1), `currency` `eur`, `unit_amount` **2900**, `recurring` { `interval`: `month`, `interval_count`: 1 }, `tax_behavior` `exclusive`, `lookup_key` **`es:essential:monthly:eur:v1`**, `nickname` «Elephant Core Essential · mensual», `metadata` { `es_product_key`: `essential`, `es_web_price_id`: `1`, `es_kind`: `monthly` } |
| 3 | `POST /v1/prices` | `product` = (1), `eur`, **27900**, `recurring.interval` `year`, `exclusive`, `lookup_key` **`es:essential:yearly:eur:v2`**, `metadata.es_web_price_id` `2` |
| 4 | `POST /v1/products` | `name` «Elephant Core Business», `metadata` { `es_product_key`: `business`, `es_catalog`: `elephant-source` } |
| 5 | `POST /v1/prices` | `product` = (4), `eur`, **7900**, `month`, `exclusive`, `lookup_key` **`es:business:monthly:eur:v3`**, `metadata.es_web_price_id` `3` |
| 6 | `POST /v1/prices` | `product` = (4), `eur`, **75900**, `year`, `exclusive`, `lookup_key` **`es:business:yearly:eur:v4`**, `metadata.es_web_price_id` `4` |

- **Sin duplicados al repetir:** antes de cada creación se buscan los Prices por `lookup_key` (exclusiva en la cuenta). `planCatalogWrites` devuelve solo lo que falta. Repetirlo tras crearlos da una lista vacía (probado).
- **Identificadores estables:** la `lookup_key` incluye el id del precio aprobado. Un precio aprobado nuevo es otra clave y otro Price; un Price nunca cambia de importe.
- **Enlace con nuestro catálogo:** después de crearlos, `POST /cp/v1/stripe/catalog/sync` (solo lectura en Stripe) los enlaza en `stripe_prices`. Solo enlaza si coinciden importe, moneda, periodicidad, `tax_behavior`, `es_web_price_id`, Product activo y su `es_product_key`.
- **Sin IVA:** con `tax_behavior: exclusive` y sin Stripe Tax ni tipos fijos, Stripe cobrará el importe **sin IVA**. Es coherente con la decisión de no aplicar un 21 % fijo hasta decidir la política fiscal. **Aviso:** la cotización interna del pedido (`firstPeriodCents`) incluye IVA; el cobro de Stripe en el sandbox no. Hasta resolver la decisión fiscal, ese importe no debe presentarse como el total cobrado.
- **Ejecutado el 18/10/2026** por el MCP oficial, tras la comprobación visual del propietario (sandbox `acct_1URULO5wMYhQ9O0d`, distinto de la cuenta real) y con `livemode=false` verificado. Antes de crear: 0 Products, 0 Prices con esas `lookup_key` y 0 configuraciones del Portal. Después: exactamente estos 6 objetos, todos `livemode: false`.

| Plan | Product | Periodicidad | Price | `lookup_key` | Importe |
|---|---|---|---|---|---|
| Essential | `prod_VSjvJJnk9dvSOT` | mensual | `price_1URoSC5wMYhQ9O0dtacPffCy` | `es:essential:monthly:eur:v1` | 29,00 € |
| Essential | `prod_VSjvJJnk9dvSOT` | anual | `price_1URoSD5wMYhQ9O0dBmJowxvX` | `es:essential:yearly:eur:v2` | 279,00 € |
| Business | `prod_VSjvvEI26Ra062` | mensual | `price_1URoSD5wMYhQ9O0dTZKfzsnV` | `es:business:monthly:eur:v3` | 79,00 € |
| Business | `prod_VSjvvEI26Ra062` | anual | `price_1URoSE5wMYhQ9O0doq5eqhut` | `es:business:yearly:eur:v4` | 759,00 € |

Todos con `tax_behavior: exclusive`, `nickname` y `metadata` (`es_product_key`, `es_web_price_id`, `es_kind`) exactamente como en la tabla anterior. El catálogo no lleva el prefijo de entorno (B9): las `lookup_key` son las mismas para todos los entornos del sandbox.

## 3. Customer Portal: análisis y configuración propuesta (no creada)

Comportamiento según la documentación oficial (§2 y §17 de `STRIPE_FASE_A.md`):

| Pregunta | Respuesta |
|---|---|
| ¿Qué cambios de plan y periodicidad se pueden hacer? | Solo entre los Prices que se declaren en `features.subscription_update.products`. Se propondrían los cuatro (Essential y Business, mensual y anual) |
| ¿Cómo se calculan los prorrateos? | `proration_behavior`: `create_prorations` (predeterminado; el ajuste va a la siguiente factura), `always_invoice` (factura inmediata) o `none`. Con billing mode `flexible` (fijado en nuestro Checkout) el ancla de facturación **no se reinicia sola** |
| ¿Cuándo se aplican los cambios? | Por defecto, al momento. Con `schedule_at_period_end.conditions` (`decreasing_item_amount`, `shortening_interval`), las bajadas de plan y el paso de anual a mensual se programan para el final del periodo |
| ¿Cómo funciona la cancelación a final de periodo? | `features.subscription_cancel` con `mode: at_period_end`. En billing mode flexible llega como `cancel_at` = fin de periodo. El acceso se mantiene hasta entonces y después `customer.subscription.deleted` |
| ¿Qué pasa al cambiar el método de pago? | Queda como predeterminado del Customer para las siguientes facturas. Nosotros no guardamos métodos de pago, así que no hay nada que sincronizar |
| ¿Cómo se evita acceder a la suscripción de otra empresa? | La sesión del Portal se crea **solo en el servidor** con el Customer enlazado a la empresa (`stripe_customers`), nunca con un id que llegue del navegador. La URL es de corta duración y `return_url` es fija. En el código, `StripeCheckoutService.portalUrl(companyId)` exige el enlace y no existe ninguna ruta que acepte un `customerId` |

**Propuesta:**
- **Activables desde ahora** (no requieren sincronización ni decisión):
  - `invoice_history.enabled: true`;
  - `payment_method_update.enabled: true`.
- **Desactivadas hasta la Fase C** (webhooks, porque sus cambios deben reflejarse en pedidos y licencias):
  - `subscription_cancel`;
  - `subscription_update`.
- **Desactivada hasta decidirlo** (afecta a los datos de facturación, que dependen de la política fiscal): `customer_update` (dirección, NIF, nombre, correo).
- **Decisiones comerciales pendientes** antes de activar los cambios de plan:
  1. ¿Se permite bajar de Business a Essential desde el Portal? Recomendación: sí, programado a final de periodo.
  2. ¿Se permite pasar de anual a mensual? Recomendación: sí, a final de periodo.
  3. ¿Se factura al momento la subida de plan (`always_invoice`) o en la siguiente factura (`create_prorations`)?
  4. Motivo de cancelación: ¿se recoge (`cancellation_reason`)?
- **Además:** `business_profile` (políticas de privacidad y condiciones) queda pendiente de los textos legales.
- **El Portal no se ofrece a ningún cliente** hasta que existan el puente seguro Core → plano de control (Fase E) y los webhooks (Fase C).

## 4. Código (Fase B)

| Fichero | Qué hace |
|---|---|
| `server/stripe/gateway.ts` | Puerto con solo las operaciones usadas y adaptador del SDK oficial `stripe` 23.0.0 (instancia propia, API `2026-09-30.endive` fijada, 2 reintentos de red, 15 s de tiempo máximo y `Idempotency-Key`). Todo objeto pasa por `assertTestObject`. Los errores se traducen sin datos sensibles |
| `server/stripe/catalog.ts` | Precios que deben existir (solo Essential y Business), plan exacto de escrituras, comprobación estricta de cada Price y sincronización de **solo lectura** |
| `server/stripe/store.ts` | Correspondencia en la BD del CRM (0012), en MySQL y en memoria. Nunca reasigna un precio en silencio; un Customer por empresa (también ante una carrera); una sesión abierta por pedido |
| `server/stripe/checkout.ts` | Checkout para pedidos `contracted` (`new` o `trial_conversion`) de Essential o Business sin complementos. Precio resuelto en el servidor; Customer por empresa; metadatos y `client_reference_id` del pedido; URL de vuelta solo del entorno (https). Caducidad de 2 h, `billing_mode: flexible`, `tax_id_collection`, dirección obligatoria, `integration_identifier` y sin `payment_method_types`. Reutiliza la sesión viva, sustituye la caducada y **nunca abre otra si el pago ya se completó**. `sync` relee sesión y suscripción y comprueba pedido, empresa y Customer, **sin confirmar el pedido** |
| `server/stripe/api.ts` | Rutas de **operador** `/cp/v1/stripe/*` con token y ámbito (`ops:read`, `orders:write`, `orders:read`). No hay rutas públicas ni del Portal |
| `server/controlPlane/{api,main}.ts` | Montaje **solo** con `CP_STRIPE_MODE=test` válida, pedidos activos y la migración `0012` aplicada. Checkout exige además `CP_STRIPE_CHECKOUT_ENABLED=1` y las tres URL. Hoy, en Railway, no se monta nada |
| `package.json` | SDK `stripe` 23.0.0 fijado, en commit aislado |

**Sin Fase C:**
- no hay webhook;
- ningún pago confirma un pedido ni activa una empresa;
- no se lee la URL de éxito.

Un pago completado en el sandbox deja el pedido en `contracted` con la suscripción copiada, a la espera de los webhooks.

## 5. Pruebas

| Batería | Resultado |
|---|---|
| `server/stripe/config.test.ts` | 19/19 |
| `server/stripe/checkout.test.ts` (doble de Stripe sin red) | 24/24: catálogo (solo dos planes, Enterprise excluido, IVA incluido rechazado, plan de escrituras exacto e idempotente, sincronización de solo lectura sin duplicados, cinco tipos de discordancia que no se enlazan, sin reasignaciones), Checkout (precio y metadatos del servidor, Customer único por empresa, reutilización y sustitución con clave nueva, carrera de dos peticiones, 7 rechazos, sin catálogo no hay sesión, pago completado sin confirmación y sin segunda sesión, metadatos ajenos rechazados), Portal (solo con el Customer de la empresa), URL https sin parámetros y objetos live rechazados |
| `server/stripe/schema.mysql.test.ts` (MySQL 8.4) | 7/7 |
| `server/stripe/store.mysql.test.ts` (MySQL 8.4) | 4/4: idempotencia de precios, carrera de Customer, carrera de sesiones abiertas y copia de la suscripción con versión |
| Plano de control (`server/controlPlane`, unitarias) | 198/198 |
| Orquestador MySQL | 5/5 |
| `tsc` | Sin errores en los ficheros nuevos ni en los modificados |
| `pnpm build:cp` | Compila y el SDK se resuelve en ejecución |

**Fallo real encontrado por las pruebas y corregido:** una vez pagada la sesión, el pedido podía volver a abrir otra Checkout Session. Ahora `hasCompletedSession` lo impide.

## 6. Migración `0012` (preparada, **no aplicada**)

| Comprobación previa | Resultado |
|---|---|
| BD exacta de destino | **`es_crm`** (la `CRM_DATABASE_URL` del plano de control, usuario `es_cp`). Carril `db/crm/migrations` |
| Copia de seguridad recuperable | Última copia del CRM **correcta** hoy a las 20:17:07 UTC, cifrada (`crm/crm/2026/10/20261017T201707Z-….sql.gz.enc`), 30 tablas, `fresh: true`. Copia cada 15 min con restauración ensayada. No hay copia secundaria externa (pendiente desde el Overnight 5) |
| ¿Aditiva? | Sí: 6 tablas nuevas `stripe_*` y ningún `ALTER` ni cambio de datos en tablas existentes. Reversión probada |
| ¿Toca BD de empresas? | No: solo el carril del CRM. Las bases `es_t*` no se tocan |
| ¿Impacto sobre Náyade? | Ninguno: Náyade no usa la BD `es_crm` ni el proyecto Railway de Elephant Source, y `main` no se modifica |
| Procedimiento (cuando se autorice) | Proxy TCP temporal (se borra después), `scripts/db/migrate.ts up --dir db/crm/migrations` en seco, revisión del plan, `--apply --confirm-database es_crm`, `status` y verificación de las 6 tablas |

## 7. Credenciales (las introduce el propietario)

| Variable | Servicio | Qué es | Permisos mínimos |
|---|---|---|---|
| `CP_STRIPE_API_KEY` | `controlplane` | Clave **restringida** `rk_test_…` del sandbox | Escritura: Customers, Checkout Sessions, Customer portal. Lectura: Subscriptions, Invoices, Prices, Products, Events. Todo lo demás: None (§16.9 de la Fase A) |
| `CP_STRIPE_MODE` | `controlplane` | `test` | — |
| `CP_STRIPE_WEBHOOK_SECRET` | `controlplane` | `whsec_…` del destino del sandbox | **Fase C**. Hoy la configuración lo exige con la clave, así que la Fase B en Railway se desplegaría junto con la Fase C, o con un secreto del destino ya creado |
| `CP_STRIPE_CHECKOUT_ENABLED`, `CP_STRIPE_SUCCESS_URL`, `CP_STRIPE_CANCEL_URL`, `CP_STRIPE_PORTAL_RETURN_URL` | `controlplane` | Interruptor y URL https | Solo cuando se autorice probar Checkout |

**Cómo verificar que la clave es del sandbox y no da acceso live** (lo hará el agente tras introducirla):
1. **Formato:** el servicio no arranca si no empieza por `rk_test_` (o `sk_test_`) o si contiene `_live_`.
2. **Entorno:** una lectura permitida (`GET /v1/prices?limit=1`) debe devolver `livemode: false`, y ese Price debe ser uno de los creados en el sandbox. Así se comprueba que la clave es de esa cuenta.
3. **Permisos:** una operación no concedida (por ejemplo `POST /v1/products` o `GET /v1/balance`) debe dar **403**.
4. **Sin acceso live:** las claves de un sandbox no ven objetos live. Además, el código rechaza cualquier objeto con `livemode` distinto de `false` y la BD rechaza cualquier fila live.

## 8. Riesgos y tareas pendientes

| Riesgo o tarea | Estado |
|---|---|
| Independencia del sandbox no demostrable por API | **Bloquea las escrituras.** Comprobación humana (§1) |
| IVA: la cotización interna incluye el 21 % y Stripe cobra sin IVA | Decisión fiscal pendiente. No presentar la cotización como total cobrado |
| Configuración exige el secreto del webhook junto con la clave | Desplegar la Fase B en Railway junto con la Fase C (o con el destino ya creado) |
| Cambios de plan y cancelación en el Portal | Desactivados hasta la Fase C y las decisiones del §3 |
| `customer_update` en el Portal | Desactivado hasta la política fiscal |
| Textos legales (condiciones, privacidad) | Pendientes: `consent_collection` y `business_profile` del Portal sin activar |
| Copia de seguridad secundaria externa | Pendiente desde el Overnight 5 |
| Productos `partial` en el catálogo | Revisar antes de la beta (C7 de la auditoría) |

## 9. Qué falta para iniciar la Fase C

1. **Ruta del webhook** `POST /cp/v1/stripe/webhook`:
   - cuerpo crudo con `express.raw` **antes** del `express.json` global;
   - `stripe.webhooks.constructEvent` y `livemode === false`;
   - lista de eventos permitidos;
   - registro en `stripe_events` y respuesta 2xx.
2. **Excepción en la pasarela del CRM** para esa ruta (POST, cabecera `Stripe-Signature`, JSON y 1 MB), como la de Brevo, con pruebas.
3. **Procesador duradero:**
   - arrendamiento con `SKIP LOCKED`;
   - relectura del objeto en Stripe;
   - transiciones del §17.5 de la Fase A sobre el orquestador: `confirmed` con el origen `stripe_subscription`, `past_due`, `suspended`, `cancel_scheduled`, `cancelled` y `payment_recovered`;
   - reintentos con espera y alertas.
4. **Conciliación periódica** con `GET /v1/events` y relectura de suscripciones, con bloqueo en BD.
5. **Pruebas:** las 10 de la firma del §16.4 de la Fase A; duplicados, desorden y retrasos; reintento tras fallo; aislamiento entre dos empresas.
6. **Configuración del propietario:** destino de webhooks en el sandbox (URL, snapshot, `2026-09-30.endive` y eventos del §5 de la Fase A) y `CP_STRIPE_WEBHOOK_SECRET` en `controlplane`.
7. **Autorizaciones:** migración `0012`, credenciales y despliegue conjunto de las Fases B y C, con `CP_STRIPE_CHECKOUT_ENABLED` apagado hasta la prueba controlada.
