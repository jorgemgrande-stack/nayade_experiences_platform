# Stripe Billing · Fase C: webhooks, ciclo de vida y conciliación (18/10/2026)

**Rama:** `feat/stripe-fase-a`, PR #128. **Nada desplegado ni migrado en Railway.** Solo modo pruebas. Diseño: `STRIPE_FASE_A.md` (§6, §7, §16 y §17) y `STRIPE_FASE_B.md`.

## 1. Qué hay

| Pieza | Fichero | Qué hace |
|---|---|---|
| Webhook | `server/stripe/webhook.ts` | `POST /cp/v1/stripe/webhook`, montado **antes** del `express.json` global con `express.raw` (1 MB) y 600/min por IP. **Firma:** `constructEvent` oficial sobre los bytes originales; admite varios `v1`, ignora `v0`, tolerancia de 300 s. **Filtros:** rechaza los eventos live, solo acepta los tipos permitidos y registra cada `event.id` una sola vez. **Respuesta:** 2xx tras guardar; 500 si no se puede guardar, para que Stripe reintente. No registra cuerpo, firma ni secreto |
| Procesador | `server/stripe/events.ts` | **Toma:** eventos con arrendamiento (`FOR UPDATE SKIP LOCKED`) y un pedido a la vez (`order:<id>`). **Relee** sesión, factura y suscripción en Stripe y aplica su estado actual, así que el orden de llegada da igual. **Comprobaciones:** pedido de Elephant Source, Customer de esa empresa, los Prices de un Checkout de ese pedido y la moneda. **Pago:** una factura `paid` de esa suscripción se registra como pago verificado (`commercial_payments`, `stripe_test`, idempotente por factura). **Fallos:** reintentos con espera creciente (1 min → 12 h, 8 intentos); los datos que no corresponden se ignoran con alerta |
| Orquestador | `server/orchestrator/service.ts` | **Alta:** con el pago verificado, el circuito **existente** confirma → aprovisiona → suscribe → licencia → activa. **Pedidos vivos:** `applyExternalBilling` aplica impago con gracia, suspensión, recuperación, cancelación programada, reactivación y fin (licencias en **solo lectura**, nunca se borra nada). **Límites:** un pedido de Stripe solo se cancela o rechaza en Stripe, y la revisión periódica no lo cancela ni lo suspende por su cuenta |
| Conciliación | `server/stripe/reconcile.ts` | Con un único arrendamiento entre réplicas: **(1)** eventos perdidos desde un cursor, sin avanzarlo si quedan páginas por leer; **(2)** pendientes y reintentos; **(3)** relectura de suscripciones antiguas, que recupera pagos no aplicados y altas interrumpidas; **(4)** sesiones caducadas. **Programación:** `CP_STRIPE_WORKER_ENABLED=1`, cada 60 s los pendientes y cada 15 min la conciliación. **Apagada por defecto** |
| Estado público | `server/stripe/status.ts` | `GET /cp/v1/public/checkout/status?session_id=` con el contrato de la web (#9): `{ state, message, accessUrl?, retryAfterSeconds? }`. Solo progreso, `no-store` y 60/min por IP. **Nunca dice `ready` sin el pedido activo.** Apagado salvo `CP_PUBLIC_CHECKOUT_ENABLED=1` |
| Autoservicio | `server/stripe/selfService.ts` | `POST /cp/v1/public/checkout/start`: solicitud provisional → empresa y administrador → pedido → aceptación → Checkout. **Defensas:** origen, ticket firmado, campo trampa, límites e idempotencia. **Apagado** (`CP_PUBLIC_SELF_SERVICE_ENABLED`) y **inutilizable** hasta que el plan esté `available` y exista `CP_TERMS_VERSION` |
| Rutas de operador | `server/stripe/api.ts` | `GET /stripe/status`, `/stripe/catalog/plan`, `/stripe/events`; `POST /stripe/catalog/sync`, `/stripe/orders/:id/checkout(/expire)`, `/stripe/checkout/:id/sync` (`orders:write`), `/stripe/events/:id/retry`, `/stripe/reconcile` |
| Pasarela del CRM | CRM PR #21 | Excepción `POST /cp/v1/stripe/webhook` (JSON y `Stripe-Signature`, 1 MB) con `STRIPE_WEBHOOK_PUBLIC=1` y la lista de IP de Stripe opcional (`STRIPE_WEBHOOK_IPS`) |

## 2. Eventos ↔ acciones (sobre el objeto releído)

| Evento | Acción |
|---|---|
| `checkout.session.completed` / `async_payment_succeeded` | Sesión `complete` → se relee su suscripción |
| `checkout.session.expired` / `async_payment_failed` | Sesión `expired`; el pedido sigue `contracted` y admite otra sesión |
| `invoice.paid` | Se relee su suscripción: pago verificado → alta del pedido, o renovación y recuperación |
| `invoice.payment_failed` / `payment_action_required` | Se relee la suscripción: `past_due` → gracia; `unpaid` → suspensión |
| `customer.subscription.created/updated/deleted/paused/resumed` | **Estado:** `active`, `past_due`, `unpaid`, `canceled`. **Cancelación:** `cancel_at` / `cancel_at_period_end` → programada, y deshacerla → reactivación |

## 3. Pruebas

| Batería | Tipo | Resultado |
|---|---|---|
| `webhook.test.ts` | Criptografía real del SDK: las 10 del §16.4 de la Fase A, más guardado y error de guardado | 12/12 |
| `lifecycle.mysql.test.ts` | MySQL 8.4 con el orquestador, pedidos, contratos, suscripciones y licencias **reales**; Stripe es un doble | 20/20 |
| `reconcile.test.ts` | Sin red: recuperación, cursor con trabajo pendiente (M1) y concurrencia | 3/3 |
| `selfService.test.ts` | Dobles; ticket firmado real | 9/9 |
| `checkout.test.ts`, `config.test.ts`, `schema.mysql.test.ts`, `store.mysql.test.ts` | Fase B | 24 + 20 + 7 + 4 |
| Total `server/stripe` | — | **99** |
| Orquestador y plano de control (existentes) | Unitarias y MySQL | En verde |
| Fusión de prueba con `feat/trials-autonomia` (#129) | Sin conflictos | 435/435 |
| **Contra el sandbox real de Stripe** | — | **Ninguna** (escrituras pausadas, §5) |

**Escenarios del ciclo de vida** contra MySQL con el orquestador real y Stripe simulado:
- altas Essential y Business, mensual y anual;
- checkout abandonado y pago rechazado;
- evento duplicado y desordenado;
- reintento tras un fallo de aprovisionamiento;
- empresa ya existente;
- cancelación, reactivación y fin con solo lectura;
- impago, recuperación y suspensión;
- renovación;
- cliente de otra empresa;
- caída de Stripe;
- webhooks perdidos recuperados por la conciliación;
- estado público del alta;
- regresiones de la revisión de seguridad (A1, M2, M3 y M4).

## 4. Revisión de seguridad (17/10/2026, subagente de solo lectura)

**Sin hallazgos críticos.**

**Corregido con prueba de regresión** (commit `1a6d332`):
- **A1 (alto):** el bucle cancelar → reactivar mientras Stripe seguía cobrando.
- **M1:** eventos perdidos por el cursor.
- **M2:** precio y moneda del pedido.
- **M3:** impago con la cancelación programada.
- **M4:** el fin del periodo interno cortaba el acceso pagado.
- **B1:** carrera de dos sesiones.
- **B3:** un pedido de uno en uno.
- **B5:** proxy de confianza obligatorio.
- **B6:** índice de la toma de eventos.
- **B7:** ámbito de la relectura.
- **B8:** clave restringida en producción.

**Resuelto el 18/10/2026** (detalle en `PREPARACION_DESPLIEGUE_STRIPE.md` §2):
- **B2:** una sesión huérfana repetida por Stripe se registra cerrada y se usa la clave siguiente.
- **B4:** reembolsos y disputas. Con la cobertura perdida, el pedido queda suspendido y retenido hasta un pago nuevo, una disputa ganada o un operador.
- **B9:** prefijo del entorno en las claves y en `metadata.es_env`.
- **Purga** diaria de los eventos terminados, con retención mínima de 35 días y constancia.
- **Alertas:** las `stripe.*` ahora abren incidencia (antes se descartaban por no tener regla).

**Se mantiene:** `unpaid` suspende (no deja en solo lectura). Es coherente con las suspensiones existentes y no borra datos.

## 5. Customer Portal: reglas provisionales y cómo las soporta Stripe

| Regla | Mecanismo de Stripe | Estado |
|---|---|---|
| Historial de facturas visible | `features.invoice_history.enabled` | Se puede activar ya |
| Actualizar la tarjeta | `features.payment_method_update.enabled` | Se puede activar ya (no hay nada que sincronizar) |
| Cancelación a final del periodo pagado, con motivo | `features.subscription_cancel` con `mode: at_period_end` y `cancellation_reason.enabled` | Soportado y **sincronizado** (`cancel_at` → `cancel_scheduled` → fin en solo lectura) |
| Business → Essential al final del periodo | `subscription_update` + `schedule_at_period_end.conditions: [decreasing_item_amount]` | **Desactivado** (ver abajo) |
| Anual → mensual al final del periodo | `schedule_at_period_end.conditions: [shortening_interval]` | **Desactivado** |
| Essential → Business inmediato con prorrateo | `proration_behavior: always_invoice` | **Desactivado** |
| Enterprise excluido | `subscription_update.products` solo con Essential y Business | Previsto |

**Por qué los cambios de plan siguen desactivados:**
- **Lo que pasa hoy:** un cambio de plan hecho en el Portal llega como una suscripción con otros Prices y el procesador lo **ignora con alerta** (corrección M2), para no conceder licencias que el pedido no recoge.
- **Lo que falta:** traducirlo a un pedido `change` del orquestador, con nueva cotización, renovación del contrato y aceptación. Hay una **decisión** pendiente: los productos `on_request` exigen hoy una aprobación motivada, así que un cambio automático desde el Portal la saltaría. Hasta decidirlo, `subscription_update` no se activa.
- **Alternativa segura mientras tanto:** el cambio de plan lo hace un operador desde el CRM, con un pedido `change`, y en Stripe con la suscripción.

**La configuración del Portal NO se ha creado:** las escrituras siguen pausadas (`STRIPE_FASE_B.md` §1).

## 6. Despliegue conjunto de las Fases B y C (preparado, NO ejecutado)

**Requisitos previos:**
- tu confirmación de que el sandbox es independiente de la cuenta real;
- la clave restringida en `controlplane`;
- autorización de la migración `0012` y del despliegue.

1. **Catálogo en Stripe** (sandbox, por MCP con confirmación): las 6 operaciones del `STRIPE_FASE_B.md` §2.
2. **Copia de seguridad:** comprobar que la última copia del CRM es reciente y está bien. Si no, lanzar `backup-job run` y esperar a que termine bien.
3. **Migración `0012` en `es_crm`:**
   - Abrir un proxy TCP temporal.
   - `scripts/db/migrate.ts up --dir db/crm/migrations` en seco y revisar.
   - `--apply --confirm-database es_crm`.
   - `status` y comprobar las 6 tablas.
   - Borrar el proxy.

   **Vuelta atrás:** `down --steps 1`. Solo borra la correspondencia local; Stripe conserva sus objetos.
4. **Variables de `controlplane`:**
   - `CP_STRIPE_MODE=test`;
   - `CP_STRIPE_API_KEY` (la pones tú);
   - `CP_STRIPE_WEBHOOK_SECRET` (paso 6);
   - `CP_STRIPE_SUCCESS_URL=https://elephant-source-web.up.railway.app/contratacion/estado`;
   - `CP_STRIPE_CANCEL_URL=https://elephant-source-web.up.railway.app/contratacion/cancelada`;
   - `CP_STRIPE_PORTAL_RETURN_URL`.

   **Apagadas al principio:** `CP_STRIPE_CHECKOUT_ENABLED`, `CP_STRIPE_WORKER_ENABLED`, `CP_PUBLIC_CHECKOUT_ENABLED` y `CP_PUBLIC_SELF_SERVICE_ENABLED`.
5. **Pasarela del CRM:** desplegar la PR #21 con `STRIPE_WEBHOOK_PUBLIC=1`.
6. **Destino de webhooks** en Workbench (sandbox):
   - URL `https://elephant-source-crm.up.railway.app/cp/v1/stripe/webhook`;
   - carga snapshot, versión `2026-09-30.endive`;
   - los 12 eventos de `HANDLED_EVENTS`.

   Su `whsec_` lo pones tú en `CP_STRIPE_WEBHOOK_SECRET`.
7. **Desplegar `controlplane`** (commit verificado) y comprobar la línea `{"ctx":"Stripe",...,"mounted":true}`.
8. **Verificar:**
   - `GET /stripe/status`;
   - `POST /stripe/catalog/sync`, con 4 precios enlazados;
   - la clave: un 403 en una operación no concedida y `livemode: false`.
9. **Prueba controlada:**
   - `CP_STRIPE_CHECKOUT_ENABLED=1`;
   - un pedido de una empresa demo y el enlace de pago desde el CRM (#22);
   - pagar con la tarjeta 4242 en el sandbox;
   - comprobar el webhook, el pedido `active` y las licencias.
10. **Después:** `CP_STRIPE_WORKER_ENABLED=1` (conciliación) y `CP_PUBLIC_CHECKOUT_ENABLED=1` (página de estado).

## 7. Qué falta

- Escrituras en el sandbox (catálogo y Portal): pendientes de tu confirmación.
- Despliegue conjunto y migración `0012`: pendientes de autorización.
- Cambios de plan desde el Portal: decisión sobre `on_request` y el pedido `change` automático.
- Autoservicio: plan `available` y `CP_TERMS_VERSION` (condiciones legales).
- Altas sin pasarela por empresa: dominio comodín (DNS, autorización).
- Política fiscal (IVA) y emisor de facturas.
- Pruebas reales contra Stripe con Test Clocks: segundo sandbox y su clave (Fase F).
