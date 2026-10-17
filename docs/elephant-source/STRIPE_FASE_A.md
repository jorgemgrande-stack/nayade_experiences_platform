# Stripe Billing · Fase A: preparación técnica (17/10/2026)

**Rama:** `feat/stripe-fase-a`, sacada de `integration/elephant-source`. **No se ha desplegado nada ni se ha configurado ninguna clave.** Parte de la arquitectura aprobada el 17/10/2026 sobre `AUDITORIA_STRIPE_BILLING.md`, con estas condiciones:
- Essential y Business por autoservicio; Enterprise solo por propuesta.
- Prueba de 15 días sin tarjeta.
- Solo modo test.
- Sin cobros reales ni registro público.

## 1. Resultado de la Fase A

| Entregable | Estado |
|---|---|
| Documentación oficial de Stripe verificada (§2) | Hecho |
| Modelo de datos y migración `db/crm/migrations/0012_stripe_billing` (§4) | Hecho y probado contra MySQL 8.4 (ida, vuelta, rechazo de filas live, unicidad). **No aplicado en Railway** |
| Configuración segura `server/stripe/config.ts` (solo test, rechaza live, separada del motor antiguo) | Hecho, 19 pruebas unitarias |
| Claves restringidas y permisos exactos (§5) | Definidos. **Pendiente de que el propietario cree las claves** |
| Seguridad del webhook, procesamiento duradero y conciliación (§6) | Diseñado; se implementa en la Fase C |
| Correspondencia de estados Stripe ↔ pedido ↔ licencias (§7) | Diseñada |
| Enrutamiento por empresa sin pasarela por cliente (§9) | Analizado y con propuesta. Requiere DNS (autorización) |
| Retirada del motor antiguo (§10) | Dependencias auditadas y plan por pasos. Nada eliminado |

## 2. Documentación oficial vigente (comprobada hoy)

- **Versión de la API: `2026-09-30.endive`** (https://docs.stripe.com/api/versioning).
  - Se fija en el código con `STRIPE_API_VERSION` y en el destino de webhooks al crearlo.
  - El SDK oficial `stripe` **23.0.0** para Node fija exactamente esa versión (`cjs/apiVersion.js`). No tiene dependencias, pide Node ≥ 20 y se publicó el 01/10/2026.
- **Sandbox frente a test mode:** para integraciones nuevas Stripe recomienda **sandboxes generales**, con ajustes aislados de live. El «test mode» comparte ajustes con live (https://docs.stripe.com/sandboxes). **Se usará un sandbox general.**
- **Cambios recientes que afectan al diseño:**
  - **Periodo de la suscripción.** `current_period_start` y `current_period_end` están ahora en `items.data[]`, no en la Subscription (desde `2025-03-31.basil`).
  - **Modo de facturación.** `flexible` es el predeterminado (desde `2025-09-30.clover`). Una cancelación desde el Portal llega como `cancel_at` y no como `cancel_at_period_end`, así que se leen ambos.
  - **Checkout.** Se elimina `payment_method_types` (endive): se usan los métodos dinámicos.
  - **`billing_cycle_anchor`.** Pasa a ser un objeto en las actualizaciones (endive).
- **Checkout en `mode=subscription`:**
  - **Precios y periodos:** `line_items[].price` sale de nuestro catálogo, nunca del navegador.
  - **Cliente:** `customer` es un Customer existente nuestro. En este modo Checkout siempre crea uno si no se le pasa.
  - **Referencias:** `client_reference_id` y `metadata` / `subscription_data.metadata` con el pedido y la empresa.
  - **Vuelta del navegador:** `success_url` con `{CHECKOUT_SESSION_ID}`, y `cancel_url`.
  - **Datos fiscales y condiciones:** `tax_id_collection`, `billing_address_collection` y `consent_collection.terms_of_service` (exige la URL de condiciones en el Dashboard).
  - **Caducidad:** entre 30 min y 24 h, con el evento `checkout.session.expired`.
  - **Idempotencia:** cabecera `Idempotency-Key`.
  - Fuente: https://docs.stripe.com/api/checkout/sessions/create.
- **Prueba gestionada por nosotros:** no se usan los `trial_*` de Stripe, así que la suscripción empieza en `incomplete` y pasa a `active` al pagar la primera factura. Stripe no envía `trial_will_end` ni recordatorios: los enviamos nosotros (con `MAIL_MODE=off` ahora mismo).
- **Dar y quitar acceso** (https://docs.stripe.com/billing/subscriptions/webhooks):
  - **Dar:** tras `invoice.paid`, releer la suscripción y comprobar que está `active`. En Checkout, `checkout.session.completed` con `payment_status != 'unpaid'`.
  - **Quitar:** cuando pasa a `canceled` o `unpaid`. Con `past_due`, avisar.
- **Webhooks** (https://docs.stripe.com/webhooks):
  - **Firma:** `Stripe-Signature` con `t` y uno o varios `v1` (varios durante una rotación del secreto); se ignora `v0`. Tolerancia de 300 s y cuerpo crudo obligatorio (`express.raw`).
  - **Reintentos:** hasta 3 días en live y unas pocas veces en sandbox.
  - **Orden y duplicados:** no hay orden garantizado y puede haber duplicados.
  - **Respuesta:** devolver 2xx rápido.
- **Customer Portal:**
  - `POST /v1/billing_portal/sessions` (`customer`, `return_url`) devuelve una URL de corta duración.
  - La configuración se crea con `POST /v1/billing_portal/configurations`: historial de facturas, cambio de método de pago, cancelación `at_period_end` y cambio entre los precios permitidos.
- **Impagos:** Smart Retries y la acción tras el último intento (cancelar, `unpaid`, `past_due` o pausar) se configuran en Dashboard → Billing → Revenue recovery. En sandbox Stripe no envía correos a clientes por defecto.
- **Precios:**
  - El importe de un Price es **inmutable**: un precio nuevo es otro Price.
  - `lookup_key` es exclusiva en la cuenta (`transfer_lookup_key`).
  - `tax_behavior` no se puede cambiar una vez fijado.
- **Facturas:** las suscripciones generan Invoices automáticamente. En la UE se recomienda numeración secuencial por cuenta.

## 3. Decisiones de diseño

1. **Stripe es la fuente de verdad del cobro; el plano de control lo es del acceso.** Nada da acceso por la URL de éxito ni por el contenido de un evento: siempre se **relee el objeto en la API de Stripe** y se aplica su estado actual. Así se toleran eventos desordenados, repetidos y retrasados.
2. **Se reutiliza el circuito existente.** Un pedido del orquestador (`commercial_orders`) es la «solicitud de contratación provisional». Su estado `contracted` equivale a «pago pendiente», con la Checkout Session abierta. La confirmación tiene un nuevo origen, `stripe_subscription`, en `confirmation_json`. A partir de ahí el orquestador hace lo que ya hace: aprovisionar, crear la suscripción contractual, aplicar las licencias y activar. **No hace falta ningún estado nuevo** en la máquina de pedidos.
3. **Las altas por prueba y por pago van separadas.**
   - **Prueba** (`trial_requests`): sin Stripe y sin tarjeta, 15 días. Al vencer, las licencias pasan solas a solo lectura y no se borra nada.
   - **Conversión de la prueba:** pedido `trial_conversion` con Checkout sobre la empresa que ya existe. No vuelve a aprovisionar.
   - **Alta de pago** (pedido `new`): Checkout y, después, aprovisionamiento.
4. **Un Customer de Stripe por empresa del CRM**, resuelto siempre en el servidor (`stripe_customers`). Nunca se acepta `customerId` desde el navegador.
5. **El SDK oficial `stripe` 23.0.0** se usa para `constructEvent` y las llamadas. Se añadirá en un **commit aislado** (`package.json` y lockfile), según las reglas del repositorio, en la Fase B.
6. **Nombres de variables propios (`CP_STRIPE_*`)**, distintos de los `STRIPE_*` y `BILLING_*` del motor antiguo. Si el motor antiguo está configurado con Stripe, el servicio no arranca.
7. **Enterprise no se publica en Checkout.** Se contrata por propuesta con el circuito de operador que ya existe. Su cobro en Stripe se estudiará en la Fase E.

## 4. Modelo de datos: `0012_stripe_billing` (BD del CRM, incluida en las copias)

| Tabla | Para qué | Unicidad y garantías |
|---|---|---|
| `stripe_prices` | Precio aprobado del catálogo (`web_prices`) ↔ Product/Price de Stripe y `lookup_key` | Un Price por precio aprobado; `stripe_price_id` y `lookup_key` únicos |
| `stripe_customers` | Empresa del CRM ↔ Customer de Stripe (y tenant) | Uno por empresa, por Customer y por tenant |
| `stripe_checkout_sessions` | Sesiones de un pedido (clave de idempotencia, precios enviados, estado y caducidad); la URL no se guarda | **Como mucho una abierta por pedido** (columna generada única) |
| `stripe_subscriptions` | Copia local de la Subscription, **actualizada solo con el objeto releído**: estado, `cancel_at`, fin de periodo (máximo de los items), última factura | Clave primaria = id de Stripe; versión optimista |
| `stripe_events` | Cada `event.id` una vez, con su procesamiento duradero `received → processing → processed / ignored / failed`, intentos, siguiente intento y arrendamiento. **No guarda el cuerpo** | Clave primaria = `event_id` |
| `stripe_sync_state` | Cursores y bloqueo de la conciliación entre réplicas | — |

Todas las tablas con datos de Stripe llevan `CHECK (livemode = 0)`: **la base de datos rechaza cualquier fila live**. La reversión no toca pedidos, contratos, suscripciones contractuales ni licencias.

**Probado contra MySQL 8.4 real:** `server/stripe/schema.mysql.test.ts`, 7/7. La prueba de reversión de `0010` (`orchestrator.mysql.test.ts`) se ha ajustado para revertir en orden inverso las migraciones posteriores, igual que hace `down --steps`, porque `0012` depende de `commercial_orders`.

## 5. Claves de Stripe Test: qué crear, permisos mínimos y dónde

**Dónde se crean:** en la cuenta de Stripe de la entidad que facturará (decisión DF-1 pendiente). Se crea un **sandbox general** llamado, por ejemplo, «Elephant Source · integración». Después, en Dashboard → Developers → API keys → **Crear clave restringida**. Identificadores según https://docs.stripe.com/keys/permissions-reference.

### Clave 1: `CP_STRIPE_API_KEY` (`rk_test_…`). Solo en el servicio **`controlplane`**

| Permiso | Nivel | Para qué |
|---|---|---|
| `customer_write` | Escritura | Crear y actualizar el Customer de cada empresa y sus identificadores fiscales |
| `checkout_session_write` | Escritura | Crear, leer y caducar Checkout Sessions |
| `subscription_read` | Lectura | Releer suscripciones y sus items (webhook y conciliación) |
| `invoice_read` | Lectura | Releer facturas (`invoice.paid`, impagos) y la vista previa de prorrateos |
| `plan_read` | Lectura | Leer Prices (en Stripe los Prices van bajo «plan») |
| `product_read` | Lectura | Leer Products |
| `customer_portal_write` | Escritura | Crear sesiones del Customer Portal (Stripe no separa sesiones y configuraciones) |
| `event_read` | Lectura | Conciliación: listar los eventos perdidos |

Todo lo demás en **Ninguno**. En particular, sin `subscription_write` (los cambios y cancelaciones los hace el cliente en el Portal), sin `plan_write` ni `product_write`, y sin `webhook_*`.

### ~~Clave 2: `CP_STRIPE_ADMIN_KEY`~~ (retirada en la revisión del §16)

No se guardará ninguna credencial administrativa de Stripe en Railway. El catálogo y la configuración del Portal los crea una persona, bajo demanda (ver §16.3). La configuración del plano de control rechaza cualquier variable `CP_STRIPE_ADMIN*`.

En la Fase F se pedirá **otra** clave, solo para las pruebas automatizadas en el sandbox (§16.8).

### Secreto 3: `CP_STRIPE_WEBHOOK_SECRET` (`whsec_…`). Solo en **`controlplane`**

Se obtiene al crear el destino de webhooks en Workbench (sandbox), **en la Fase C**, con esta configuración:
- **URL:** `https://elephant-source-crm.up.railway.app/cp/v1/stripe/webhook`. Requiere una excepción en la pasarela del CRM igual que la de Brevo (solo `POST`, cabecera `Stripe-Signature`, JSON y tamaño máximo). Se preparará y probará en la Fase C.
- **Tipo de carga:** snapshot.
- **Versión de la API fijada:** `2026-09-30.endive`.
- **Eventos:**
  - `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`;
  - `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`;
  - `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`.

### Variable 4: `CP_STRIPE_MODE=test`. Solo en `controlplane`

**Nada de esto se configura todavía.** Las claves se crean cuando empiece la Fase B (catálogo) y se pegan **directamente en Railway**. Nunca en el chat ni en Git.

### Ajustes del sandbox en el Dashboard (Fase B y Fase E, los hace el propietario)

- **Revenue recovery:** Smart Retries con la política recomendada y, tras el último intento, **marcar la suscripción como `unpaid`**. Así se conserva la suscripción y se restringe el acceso sin borrar nada. Pendiente de la decisión DC-4 sobre la gracia.
- **Correos a clientes:** desactivados (en sandbox ya lo están por defecto).
- **Condiciones de servicio:** URL pública de las condiciones de contratación, necesaria para `consent_collection`. Hoy son borradores (bloqueo legal).
- **Facturas:** numeración secuencial por cuenta, con prefijo de prueba.

## 6. Webhook: verificación, persistencia y recuperación (Fase C)

1. **Ruta propia** `POST /cp/v1/stripe/webhook`, montada **antes** del `express.json` global, con `express.raw({ type: "application/json", limit: "1mb" })`. Verificación con `stripe.webhooks.constructEvent` (admite varios `v1`), tolerancia de 300 s, y rechazo de `livemode !== false`.
2. **Persistencia inmediata:** `INSERT … stripe_events (status='received')`. Si el id ya existe es un duplicado: se responde 200 sin hacer nada. **Se responde 2xx en cuanto el evento queda guardado**, antes de procesarlo.
3. **Procesador** en el plano de control. Toma eventos pendientes con arrendamiento (`locked_until` y `SELECT … FOR UPDATE SKIP LOCKED`, válido con varias réplicas), **relee el objeto en Stripe**, aplica su estado en una transacción junto con el cambio a `processed` y reintenta con espera creciente si falla (`failed` + `next_attempt_at`). Hay alerta por eventos atascados o con fallos repetidos (`recordFailure`).
4. **Conciliación periódica:**
   - Lista `GET /v1/events` desde el último cursor (`stripe_sync_state`) para recuperar los eventos que no llegaron.
   - Relee las suscripciones locales no terminales para detectar divergencias.
   - Se protege con un bloqueo en BD para no ejecutarse dos veces a la vez.
5. **Límite de peticiones propio** en la ruta, holgado (Stripe manda ráfagas), más la IP real ya corregida en las pasarelas. La lista de IP de Stripe (`ips_webhooks.json`) queda como defensa adicional opcional.
6. **El motor antiguo no se reutiliza en ningún punto.** Sus defectos están documentados en la auditoría (C1 y C2).

## 7. Estados: Stripe ↔ pedido ↔ licencias

Las licencias se aplican siempre con `LicensingService` (auditadas y atómicas). **Nunca se borran datos**: la peor situación es solo lectura.

| Situación en Stripe (objeto releído) | Pedido | Licencias | Empresa (tenant) |
|---|---|---|---|
| Sesión abierta / `incomplete` | `contracted` (pago pendiente) | sin cambios (ninguna, o las de la prueba) | sin cambios |
| `checkout.session.expired` / `incomplete_expired` | sigue `contracted`; se puede abrir otra sesión | sin cambios | sin cambios |
| `active` (primera vez) | `confirmed` → … → `active` (circuito existente) | `active` hasta el fin del periodo | aprovisionada (alta de pago) o la de la prueba |
| `active` tras un impago | `payment_recovered` → `active` | `active` | `active` |
| `past_due` | `past_due` | `active` durante la gracia (configurable, DC-4) | `active` |
| `unpaid` (tras el último reintento) | `suspended` | `read_only` | `active` en solo lectura, nunca borrada |
| `cancel_at` / `cancel_at_period_end` | `cancel_scheduled` | `active` hasta el fin | `active` |
| `canceled` | `cancelled` | `read_only` (conservación configurable) | sin borrado automático |
| `paused` (no se usa) | `suspended` | `read_only` | — |

## 8. Seguridad

- **Solo test, a tres niveles:**
  - configuración: claves `rk_test_` / `sk_test_`, rechazo de cualquier `_live_` y ninguna variable que autorice live;
  - objetos: `assertTestObject` (`livemode === false`);
  - base de datos: `CHECK (livemode = 0)`.
- **Nunca se registran** claves, `client_secret`, URL de sesión, cuerpos de eventos, datos de tarjeta ni direcciones completas. Las tarjetas solo existen en Stripe.
- **Importes, planes y precios** salen siempre del servidor (pedido y catálogo aprobado); nunca del navegador.
- **Customer Portal y cambios de plan desde el panel del cliente:**
  - un tRPC del Core, solo propietario o `admin`, con la empresa resuelta por el Host;
  - una llamada servidor a servidor al plano de control con un token de **ámbito nuevo y estrecho**, `billing:session`, guardado en una variable del Core;
  - el plano de control comprueba la pertenencia y resuelve el Customer de esa empresa;
  - Fase E, con límite de peticiones por empresa y usuario.
- **Coherencia de identificadores:** se comprueba que Customer, Subscription, pedido y empresa coinciden antes de aplicar nada. Un evento que no coincide queda `ignored` con su motivo y una alerta.
- **Auditoría:** `commercial_order_events`, `tenant_capability_events` y `stripe_events`.

## 9. Altas sin pasarela por empresa (bloqueo C5)

**Situación:** cada empresa tiene hoy su propio servicio Caddy y su dominio `*.up.railway.app`, creados a mano. Railway da **un único** dominio `up.railway.app` por servicio (https://docs.railway.com/cli/domain).

**Comprobado en el código:** el Core resuelve la empresa por **coincidencia exacta del Host** en `tenant_domains`, y el aprovisionamiento ya registra `<empresa>.<CP_PLATFORM_DOMAIN>` como dominio principal (`server/_core/provisioning/service.ts:286-292`). **No hace falta cambiar el Core.**

**Propuesta: un dominio comodín en una única pasarela compartida.**

| Opción | Altas automáticas | Límite | Coste | Veredicto |
|---|---|---|---|---|
| **(a) Comodín `*.app.<dominio>` en una pasarela compartida** | Sí: el alta solo escribe en el registro | Ninguno práctico; es una sola entrada y un solo certificado | Nulo adicional | **Recomendada** (es la que recomienda Railway para multiempresa) |
| (b) Un dominio propio por empresa, por API, en una pasarela | Sí, pero depende del DNS de cada cliente | **20 por servicio en Pro, y Railway no lo amplía para multiempresa** | Nulo | Solo para dominios propios puntuales |
| (c) Un servicio por empresa (actual) | No: pasos manuales | — | ~0,25–0,50 $/mes por empresa (estimación) más la operación | Descartada |

Fuentes: https://docs.railway.com/networking/public-networking/specs-and-limits, https://docs.railway.com/networking/domains/working-with-domains y la respuesta oficial de Railway en Station sobre el límite de 20 dominios.

- **Se mantiene la pasarela:** no se apunta el comodín directamente al Core. La pasarela conserva el Host y la autenticación básica de la beta privada, y entrega solo la IP real del cliente. El Core, con `trust proxy 1`, tomaría la de la CDN de Railway.
- **Pasos** (requieren **autorización de DNS**):
  1. Elegir el dominio de las empresas, por ejemplo `*.app.bigelephant.es`.
  2. Añadir el dominio comodín personalizado a la pasarela compartida (`core-gateway`) en Railway.
  3. Crear en Dinahosting los registros que indique Railway: el CNAME del comodín, el CNAME `_acme-challenge` y el TXT de verificación. Hay que confirmar que Dinahosting admite CNAME comodín.
  4. Esperar al certificado (normalmente menos de 1 h).
  5. Comprobar con una empresa de prueba que llegan el Host y la IP real.
  6. `CP_PLATFORM_DOMAIN=app.bigelephant.es`.
  7. Las empresas demo actuales se pueden migrar después; sus pasarelas siguen funcionando mientras tanto.
- **Sin esto, el onboarding no se puede declarar terminado.** Se hará en la Fase D.

## 10. Motor antiguo (`server/_core/billing`): retirada segura

**Hallazgo:** Náyade (`main`) **no lo ejecuta**. Su `build` compila solo `server/_core/index.ts`, que no lo importa. En `main` solo lo tocan el código del plano de control, que no se despliega desde `main`, los tests y el filtro de `ci.yml`. **En Railway no está montado.**

**Pasos:**

| Paso | Qué | Dónde | Cuándo |
|---|---|---|---|
| 1 | No configurar `BILLING_DATABASE_URL` ni `BILLING_CATALOG_FILE` (ya es así). `stripeConfigFromEnv` impide que conviva con Stripe | Railway | Ya |
| 2 | Sustituir lo que hoy depende de él: la validación de planes al publicar la web (`planIds`), los módulos por plan en `/tenants/:id/modules` y el límite de dominios propios por plan. Se pasa a usar el catálogo publicado y la suscripción contractual | integración | Fase C |
| 3 | Retirar del CRM la pestaña de facturación antigua (`TenantView`), `/billing/plans` en `Onboarding` y «Pagos pendientes» en `CrmPanel` / `Dashboard`. Se reorientan a los pedidos y a Stripe | CRM | Fase C/E |
| 4 | Desconectar el motor en `controlPlane/main.ts` y `api.ts`, en `crm/onboarding.ts`, `crm/api.ts` y `crm/dashboard.ts`, y adaptar tres tests. **Se mantienen los ámbitos `billing:*`**, que se usan fuera del motor | integración | Fase E |
| 5 | Marcar como obsoleto y, más adelante, borrar `server/_core/billing`, `db/billing` y sus tests | integración; en `main` **solo de acuerdo con Náyade** | Después de la beta |

## 11. Facturación e impuestos (sin aprobar)

- **Stripe Tax: no se activa.**
- **Precios:** en el sandbox se crean con `tax_behavior: "exclusive"` («IVA no incluido»), irreversible por Price pero sin efecto fiscal en sandbox.
- **Facturas de prueba:** sin tipos impositivos, así que muestran el importe sin IVA. **No son facturas fiscales.**
- **Sin duplicados:** Elephant Source **no emitirá facturas propias** de la suscripción SaaS. Las `shadow_invoices` siguen siendo un libro interno del contrato y no se emiten como documento. Quién emite la factura fiscal definitiva queda pendiente de las decisiones DF-1 a DF-6.

## 12. Pruebas de esta fase

| Prueba | Resultado |
|---|---|
| `scripts/db/migrate.ts verify --dir db/crm/migrations` | 12 migraciones válidas |
| `server/stripe/config.test.ts` | 19/19 |
| `server/stripe/schema.mysql.test.ts` (MySQL 8.4 local) | 7/7 |
| Baterías MySQL que aplican todo el carril del CRM (`orchestrator`, `subscriptions`, `webCatalog`, `trials`, `mail.outbox`) | Verde, con la prueba de reversión de `0010` ajustada |
| Batería MySQL completa en local | 258 pasan. Fallan 9 de `fileStorage`, `essential.billing` y `clienteNuevo`, que **fallan igual en la rama base sin estos cambios** (entorno local de Windows). Se confirmará en CI |
| `tsc` | Sin errores nuevos (los existentes los vigila `tscBaseline`) |

## 13. Riesgos y dependencias pendientes

| Riesgo o dependencia | Impacto | Mitigación o quién decide |
|---|---|---|
| Cuenta y entidad de Stripe sin decidir (DF-1) | El sandbox debe pertenecer a la cuenta de la entidad que facturará | Propietario |
| Condiciones legales en borrador | Checkout con `consent_collection` necesita una URL de condiciones | Propietario y asesoría |
| Productos `partial` / `planned` en el catálogo | Se cobraría por funciones no operativas | Confirmar Essential y Business antes de abrir la beta |
| Dominio comodín y DNS | Sin él, cada alta exige una pasarela manual | Autorización de DNS (§9) |
| Gracia y conservación de datos (DC-4) | Define cuándo se pasa a solo lectura | Propietario; configurable |
| `MAIL_MODE=off` | No hay invitación del administrador ni avisos por correo en las pruebas | Se mantiene; el acceso se entrega por operador o por la página de estado en la beta privada |
| Nuevas tablas sin aplicar | Hay que migrar el CRM antes de desplegar la Fase B | Migración explícita, nunca al arrancar |
| SDK `stripe` | Cambio de `package.json` y lockfile | Commit aislado y verificado, Fase B |

## 14. Contraste con el plugin oficial de Stripe para Claude Code (17/10/2026)

**Estado de la conexión:**
- **Plugin:** `stripe` 0.7.5 del repositorio oficial `github.com/stripe/ai`, instalado desde el directorio de Anthropic (`stripe@anthropic-plugin-directory`, ámbito de usuario). El marketplace `claude-plugins-official` no existe en esta versión de Claude Code (2.1.301).
- **Servidor MCP `https://mcp.stripe.com`:** configurado por el plugin, pero en estado **«Needs authentication»**. Necesita un inicio de sesión OAuth en el navegador con la cuenta de Stripe; lo tiene que hacer el propietario en una sesión interactiva (`/mcp`).
- **`stripe_implementation_planner`:** no disponible hasta autenticar el MCP y recargar la sesión.
- **Cuenta y entorno de Stripe:** sin verificar hasta entonces.
- **Alternativa `npx skills add https://docs.stripe.com`:** no se ha ejecutado. Las instrucciones la reservan para cuando el planificador siga sin aparecer después de autenticar, y el plugin ya incluye las guías oficiales (`stripe-best-practices`, `stripe-docs`, `test-cards`…).

**Guías oficiales del plugin (`stripe-best-practices`: billing y security) frente a este diseño:**

| Recomendación de Stripe | Diseño de la Fase A | Ajuste |
|---|---|---|
| Suscripciones con Billing APIs + Checkout Sessions (`mode: subscription`); autogestión con Customer Portal | Igual | — |
| No hacer renovaciones propias con PaymentIntents | Igual: no se reutiliza el motor antiguo | — |
| El webhook de `customer.subscription.*`, `invoice.paid` e `invoice.payment_failed` es obligatorio | Igual (§5 y §6) | — |
| Entregar en el handler de `checkout.session.completed` y `async_payment_succeeded`, condicionado a `payment_status` | Igual; la página de estado solo desencadena una relectura idempotente | — |
| Nunca enviar `payment_method_types` | Igual (eliminado en endive) | — |
| **Un Product por plan.** Mensual y anual como dos Prices del mismo Product; nunca planes distintos en un mismo Product | Implícito | **Se fija:** Products `Elephant Source Essential` y `Elephant Source Business`, cada uno con su Price mensual y anual |
| Pasar `integration_identifier` en `checkout.sessions.create` (desde dahlia), con sufijo de 8 letras aleatorias | No estaba | **Se añade** en la Fase B (`elephant-source-checkout-<8 letras>`) |
| Instanciar `StripeClient`; no usar la clave global | — | **Se fija** para el código de la Fase B |
| Claves restringidas, una por servicio, con mínimo privilegio | Igual (§5: dos claves) | — |
| Políticas de acceso por IP en las claves | No estaba | Railway no tiene IP de salida fija sin una opción de red específica: **se deja como pendiente** y se documenta |
| Lista de IP de Stripe en el endpoint del webhook (defensa en profundidad) | Opcional | **Se adopta** en la excepción de la pasarela del CRM (Fase C) |
| Incluir Stripe Tax en la UE y no activar `automatic_tax` sin registro activo | Stripe Tax **no se activa** (decisión del propietario) | Se mantiene. Si se activa, antes hay que dar de alta el registro fiscal y verificarlo con un cálculo de prueba |
| Consumo por uso: Metronome en integraciones nuevas | Fuera de alcance (los consumos de `subscription_usage` no se cobran) | Se tendrá en cuenta si se venden consumos |
| `stripe sandbox create` desde la CLI | No se usa: el sandbox debe pertenecer a la cuenta de la entidad que facturará | — |

**Discrepancia de versiones:** la guía del plugin cita la API `2026-08-26.dahlia` y el SDK de Node 22.6.0. La documentación oficial vigente (`docs.stripe.com/api/versioning`) y el paquete publicado en npm (`stripe` 23.0.0, `ApiVersion = '2026-09-30.endive'`) indican `endive`. **Se mantiene `2026-09-30.endive`**, comprobado en la fuente.

## 15. Para empezar la Fase B necesito

Sustituido por la revisión del §16: autenticación del MCP (§16.1), creación de **una sola** clave de ejecución (§16.9) y autorización expresa de la migración `0012` en Railway.

## 16. Revisión del 17/10/2026 (8 puntos del propietario)

**Sigue sin autorizarse:** la Fase B, la migración `0012` en Railway y las claves en Railway. En esta revisión solo cambian código y documentación de la rama `feat/stripe-fase-a`. No se ha tocado infraestructura, DNS, bases de datos ni despliegues.

### 16.1 Autenticación del MCP oficial de Stripe

- **Estado:** `plugin:stripe:stripe` (`https://mcp.stripe.com`) sigue en «Needs authentication».
- **Por qué no la hago yo:** es un inicio de sesión OAuth en el navegador con la cuenta de Stripe. Ni el agente ni una sesión no interactiva pueden completarlo.
- **Pasos del propietario:**
  1. En Claude Code, `/mcp` → `plugin:stripe:stripe` → «Authenticate».
  2. En la ventana de Stripe, elegir la **cuenta de la entidad que facturará** y, dentro, el **sandbox general** creado para Elephant Source (§16.9). Nunca live.
  3. Recargar la sesión, o abrir otra, para que aparezcan sus herramientas.
- **Verificación posterior (solo lecturas):**
  - identificador y nombre de la cuenta;
  - que el entorno es el sandbox (`livemode: false`);
  - que `stripe_implementation_planner` está disponible.

  **Ninguna operación de escritura** sin autorización expresa.

### 16.2 `stripe_implementation_planner`

No está disponible hasta completar el 16.1. Cuando lo esté, se ejecutará y su plan se comparará con este documento, en particular con los §3, §5, §6 y §7.

Mientras tanto se ha hecho el contraste con las guías oficiales que incluye el plugin (§14): coinciden con este diseño y sus recomendaciones ya están incorporadas.

### 16.3 Credencial administrativa fuera de `restore-drill`: propuesta corregida

**Decisión: ninguna clave administrativa de Stripe queda guardada en ningún servicio.**

Las operaciones administrativas son pocas y esporádicas:
- crear los Products y Prices del catálogo;
- crear la configuración del Customer Portal.

Las hace **una persona**, bajo demanda, en el sandbox:

| Operación | Cómo | Quién | Credencial guardada |
|---|---|---|---|
| Crear Products y Prices (Essential y Business; mensual y anual) con su `lookup_key` | Dashboard del sandbox o MCP oficial de Stripe con la sesión OAuth del propietario, tras presentar la lista exacta de operaciones y confirmarla | Propietario (o el agente bajo su sesión y su confirmación) | **Ninguna** |
| Configurar el Customer Portal (historial de facturas, método de pago, cancelación a final de periodo, cambio entre los precios permitidos) | Dashboard → Settings → Billing → Customer portal (la configuración predeterminada se gestiona desde ahí) | Propietario | **Ninguna** |
| Enlazar el catálogo con nuestra BD (`stripe_prices`) | El plano de control **lee** los Prices por `lookup_key` con la clave de ejecución (`plan_read`, `product_read`) y guarda la correspondencia. Comprueba importe, moneda e intervalo contra el precio aprobado | Automático, solo lectura en Stripe | La de ejecución, que no puede escribir catálogo |

- **Si algún día hiciera falta automatizarlo:**
  - proceso aparte `stripe-admin`, que solo se lanza a mano;
  - sin dominio ni red pública;
  - con un usuario de MySQL limitado a `stripe_prices` (escritura) y `web_entries`/`web_prices` (lectura);
  - con una clave `product_write` + `plan_write` **creada justo antes y revocada al terminar**.

  No se propone ahora.
- **Garantía en el código:** `stripeConfigFromEnv` rechaza cualquier variable `CP_STRIPE_ADMIN*` (prueba incluida).

### 16.4 Webhooks: firma criptográfica y cuerpo original (la IP es solo un refuerzo)

**Obligatorio en el código (Fase C):**

1. **Cuerpo crudo propio.**
   - Ruta montada **antes** del `express.json` global del plano de control, con `express.raw({ type: "application/json", limit: "1mb" })`.
   - Así la firma se calcula sobre los **bytes exactos** recibidos, no sobre un JSON reinterpretado.
   - El `express.json` global tiene un límite de 256 KB y no debe tocar esta ruta.
2. **Verificación oficial** con `stripe.webhooks.constructEvent(cuerpo, Stripe-Signature, CP_STRIPE_WEBHOOK_SECRET)`:
   - HMAC-SHA256 sobre `t.cuerpo`;
   - admite varios `v1` durante la rotación del secreto;
   - ignora `v0`;
   - tolerancia de 300 s frente a repeticiones.

   Sin firma válida: **400 y nada se guarda**.
3. **Después de la firma:**
   - `livemode === false` obligatorio;
   - tipo de evento en la lista permitida;
   - `event.id` registrado una sola vez (clave primaria).
4. **Lo que nunca se hace:**
   - El cuerpo del evento **nunca** decide nada: se relee el objeto en la API con la clave de ejecución.
   - Un evento falsificado con firma válida es imposible sin el secreto. Uno real pero repetido o antiguo no cambia nada, porque se aplica siempre el estado actual de Stripe.
5. **Refuerzo opcional:** la lista de IP de Stripe en la pasarela. **No sustituye a la firma.** Si la lista se queda desactualizada, la seguridad no depende de ella.
6. **Pruebas obligatorias (Fase C):**
   - sin cabecera;
   - firma con otro secreto;
   - cuerpo alterado en un byte;
   - JSON reformateado (mismo contenido y otros bytes: debe fallar);
   - marca de tiempo fuera de tolerancia;
   - varios `v1` con uno válido;
   - evento con `livemode: true`;
   - tipo no permitido;
   - duplicado;
   - más de 1 MB.

### 16.5 Prueba de 15 días sin tarjeta: aprovisionamiento sin pago y acceso al terminar

**Confirmado en el código** (`server/trials/onboarding.ts:158-210`, probado en `trialJourney.mysql.test.ts` y en la aceptación A15 en Railway):

- **Activar la prueba no pasa por ningún pago.** El circuito es: plataforma (base propia, migraciones, administrador e invitación) → empresa en el CRM → suscripción contractual Essential en prueba (`trialing`, modo sombra, sin cobro) → licencias Essential con `validUntil` = fin de la prueba.
- **Al terminar la prueba:**
  - **Lo que ocurre solo:** las licencias vencidas pasan a **solo lectura** en el Core (`server/_core/capabilities/model.ts:55`). Se puede leer y exportar, pero las escrituras se rechazan en el servidor (403, verificado en Railway).
  - **Lo que nunca ocurre:** no se borra la base ni ningún documento.
  - **Acceso:** el administrador sigue pudiendo entrar para ver sus datos y contratar.
- **Lo que falta y se hará en la Fase D:**
  - **Tarea programada** con bloqueo en BD que marque la prueba `expired` y prepare los avisos de 3, 1 y 0 días. Hoy lo hace un operador. Con `MAIL_MODE=off` los avisos no salen.
  - **Contratar estando en solo lectura:** la acción del panel «Contratar» abre Checkout de un pedido `trial_conversion` sobre la empresa existente, sin volver a aprovisionar. Debe quedar **fuera** del guardián de licencias: una empresa en solo lectura tiene que poder pagar. Tendrá prueba específica.
  - **Política tras la prueba:** cuántos días en solo lectura antes de suspender la empresa, y cuánto tiempo se conservan los datos. Configurable y **sin borrado automático** (decisión DC-4).
  - **Registro público:** sigue cerrado. En la beta privada las pruebas se dan de alta por operador.

### 16.6 Revisión de la migración `0012`

| Aspecto | Revisión |
|---|---|
| **BD de destino** | Solo la BD del **CRM** (`es_crm`, carril `db/crm/migrations`). No toca el registro ni las bases de las empresas. La BD del CRM entra en las copias cifradas cada 15 min. |
| **Tablas** | 6 nuevas con prefijo `stripe_`. No modifica ninguna tabla existente (ni `ALTER` ni datos). |
| **Claves foráneas** | `stripe_prices → web_prices`; `stripe_customers → crm_companies`; `stripe_checkout_sessions → commercial_orders`; `stripe_subscriptions → stripe_customers, crm_companies, commercial_orders`. **Efectos:** (1) no se puede borrar un precio, empresa o pedido enlazado con Stripe. El único borrado existente en el código es el de precios **en borrador** (`server/web/store.ts:389`), y solo se enlazan precios aprobados, así que no hay conflicto. (2) La reversión de `0010` exige revertir antes `0012`, igual que hace `down --steps`; la prueba del orquestador ya lo hace así. |
| **Índices y unicidad** | Un precio aprobado ↔ un Price; `stripe_price_id` y `lookup_key` únicos; un Customer por empresa, por id y por tenant; **como mucho una sesión de Checkout abierta por pedido** (columna generada única); clave de idempotencia de la sesión única; `event_id` como clave primaria. Índices de trabajo: `stripe_events (status, next_attempt_at)`, `stripe_subscriptions (company_id)`, `(order_id)` y `(status, synced_at)`. |
| **Corrección aplicada** | Las columnas con identificadores de Stripe pasan a `utf8mb4_bin` (comparación exacta). Stripe distingue mayúsculas y la colación por defecto de MySQL no, lo que podía dar falsos duplicados. Hay prueba específica. |
| **Idempotencia** | Evento: clave primaria más estado. Sesión: `Idempotency-Key` guardada y única. Customer: único por empresa. Catálogo: único por precio y por `lookup_key`. |
| **Solo pruebas** | `CHECK (livemode = 0)` en las cinco tablas con datos de Stripe; MySQL 8.4 lo aplica (probado). |
| **Datos personales** | No guarda correos, tarjetas, direcciones, cuerpos de eventos ni URL de sesión: solo identificadores y estados. |
| **Efectos sobre lo existente** | Ninguno hasta que el código lo use. Ningún servicio lee estas tablas todavía. |
| **Pruebas** | `schema.mysql.test.ts` 7/7; orquestador 5/5; `migrate verify` válido. |

### 16.7 Permisos de la clave de ejecución: suficientes y sin excesos

| Necesidad | Llamadas a Stripe | Permiso | ¿Incluido? |
|---|---|---|---|
| Checkout | `POST /v1/customers` (y sus `tax_ids`), `POST /v1/checkout/sessions`, `GET …/{id}`, `POST …/{id}/expire` | `customer_write`, `checkout_session_write` (la escritura incluye la lectura) | Sí |
| Customer Portal | `POST /v1/billing_portal/sessions` (también con `flow_data` para ir directamente a cambiar de plan o de método de pago) | `customer_portal_write` | Sí |
| Webhook y conciliación | `GET /v1/events`, `GET /v1/subscriptions/{id}`, `GET /v1/invoices/{id}`, `GET /v1/checkout/sessions/{id}`, `GET /v1/customers/{id}` | `event_read`, `subscription_read`, `invoice_read`, `checkout_session_write`, `customer_write` | Sí (*) |
| Enlazar el catálogo | `GET /v1/prices?lookup_keys[]=…`, `GET /v1/products/{id}` | `plan_read`, `product_read` | Sí |
| Vista previa del prorrateo | `POST /v1/invoices/create_preview` | `invoice_read` | Sí |
| **Cambios de suscripción** (plan, periodicidad, cancelación, reactivación) | Los hace **el cliente en el Customer Portal**, con nuestra configuración de precios permitidos y prorrateo | No requiere `subscription_write` | **No se concede** |
| Cambios hechos por un operador desde el servidor (Enterprise o cancelación administrativa) | `POST /v1/subscriptions/{id}` | `subscription_write` | **No se concede ahora.** Se pedirá en la Fase E solo si se aprueba ese caso |
| Catálogo, Portal y webhooks | `POST /v1/products`, `/v1/prices`, `/v1/billing_portal/configurations`, `/v1/webhook_endpoints` | `product_write`, `plan_write`, `webhook_*` | **No** (lo hace una persona, §16.3) |

(*) La documentación indica que leer un evento con clave restringida puede exigir lectura sobre el recurso de ese evento. La clave ya lee clientes, sesiones, suscripciones y facturas, que son los recursos de los eventos suscritos. **Se comprobará en el sandbox** y cualquier 403 se resolverá con el mínimo permiso adicional, documentándolo.

`customer_portal_write` permite también modificar la configuración del Portal: Stripe no separa ambos permisos. Se acepta porque es una clave de solo prueba y la configuración se revisa en la conciliación.

### 16.8 Cómo se evita usar Stripe real por accidente

| Capa | Control |
|---|---|
| **Cuenta de Stripe** | Solo se crean claves dentro de un **sandbox general**, que está aislado de live: un objeto de un entorno no existe en el otro. **No se crea ninguna clave live.** |
| **Configuración** (`server/stripe/config.ts`) | Solo `rk_test_`/`sk_test_`. Cualquier valor con `_live_`, cualquier variable `*LIVE*` o `CP_STRIPE_ADMIN*`, o `BILLING_PROVIDER=stripe`, **impiden arrancar**. No existe ninguna variable que autorice live. |
| **Objetos y eventos** | `assertTestObject`: todo objeto o evento con `livemode` distinto de `false` se rechaza antes de aplicarse. |
| **Base de datos** | `CHECK (livemode = 0)`: aunque fallara todo lo anterior, la BD rechaza la fila. |
| **Pruebas unitarias y de integración (CI)** | Sin red ni claves. El cliente de Stripe se inyecta y se sustituye por un doble. CI no tiene ningún secreto de Stripe y gitleaks bloquea cualquier clave `sk_`/`rk_` en el código (las pruebas construyen valores ficticios en tiempo de ejecución). |
| **Pruebas reales contra Stripe (Fase F)** | Un **segundo sandbox** «Elephant Source · pruebas automáticas» (Stripe recomienda separar desarrollo e integración continua). Una clave restringida propia, con Test Clocks y clientes y suscripciones de prueba. Se ejecutan bajo demanda en un proceso aparte, nunca en los servicios que atienden tráfico. Cada prueba comprueba `livemode: false` en la primera respuesta y se detiene si no. |
| **Webhooks** | El secreto `whsec_` es del destino del sandbox. Un evento de otro entorno no verifica la firma. |
| **Personas** | En el MCP solo se autoriza el sandbox. Toda escritura (catálogo, Portal) se presenta antes y se confirma de forma expresa. |

### 16.9 Pasos concretos para crear las credenciales de Stripe Sandbox (cuando se autorice la Fase B)

**No hay que hacerlo todavía.**

1. Entrar en el Dashboard de Stripe con la **cuenta de la entidad que facturará** (DF-1).
2. **Crear un sandbox general:** selector de cuenta → Sandboxes → «Create sandbox». Nombre: «Elephant Source · integración». No usar el «test mode» de la cuenta, que comparte ajustes con live.
3. Dentro del sandbox, **Developers → API keys → Create restricted key**. Nombre: `elephant-source-controlplane`. Marcar **solo**:
   - Escritura: `Customers`, `Checkout Sessions`, `Customer portal`.
   - Lectura: `Subscriptions`, `Invoices`, `Prices` (en el panel puede aparecer como «Plans/Prices»), `Products`, `Events`.
   - Todo lo demás: **None**.
4. Si el Dashboard ofrece políticas de acceso por IP, dejarla sin política por ahora (Railway no tiene IP de salida fija) y anotarlo.
5. Copiar la clave **una sola vez** y pegarla directamente en Railway → proyecto «Elephant Source» → `production` → servicio **`controlplane`** → Variables → `CP_STRIPE_API_KEY`. Desplegar **sin** redeploy automático, si se ofrece.

   No pegarla en el chat, en ficheros ni en capturas. No guardar copia salvo en el gestor de secretos del propietario.
6. **Dejar para la Fase C:**
   - el destino de webhooks (Workbench → Webhooks → «Add destination»: URL `https://elephant-source-crm.up.railway.app/cp/v1/stripe/webhook`, carga snapshot, versión `2026-09-30.endive` y los eventos del §5);
   - su secreto `CP_STRIPE_WEBHOOK_SECRET` en `controlplane`.
7. **Dejar para la Fase F:** el segundo sandbox «pruebas automáticas» y su clave.
8. **No crear:** claves live, `CP_STRIPE_ADMIN_KEY` ni la clave secreta estándar (`sk_test_`) para ningún servicio.
9. **Avisar al agente.** Con la clave ya puesta, comprobaré solo con lecturas que es de prueba, que pertenece al sandbox correcto y que tiene exactamente los permisos indicados: una llamada permitida y otra que debe dar 403. Antes de nada más, presentaré las escrituras del catálogo para su confirmación.
