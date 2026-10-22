# Roadmap de trazabilidad comercial y comunicaciones transaccionales

Estado: **mapa de lo que existe y de lo que falta**. Las plantillas definitivas y el motor se implementarán después, en PR independientes.

Base analizada: `integration/elephant-source` en `15d98e9`. Cuando un PR de la Ventana 2 aún sin fusionar cambia el diagnóstico, se indica expresamente:

| PR | Qué aporta |
|---|---|
| #153 | Perfil de comprador B2B/B2C |
| #154 | Aprobación excepcional en live |
| #156 | Impuesto esperado |
| #157 | Registro de facturas y documentos fiscales |
| #158 | Cambios de plan del Portal |

Restricciones vigentes durante todo este roadmap:
- `MAIL_MODE` sigue en `off` en live.
- No se habilita Brevo ni ningún proveedor real.
- No se abre el Checkout.
- No se cobra.
- No se toca ninguna pantalla del CRM, del Core ni de la web.

Leyenda de estado: **E** existe · **P** parcial · **A** ausente.

---

## 0. Resumen ejecutivo

1. **El núcleo transaccional es sólido.** Prueba, pedido, suscripción interna, licencias, eventos de Stripe y cola de correo son idempotentes. Todos dejan historial en tablas propias.
2. **Lo que falla es el tiempo.**
   - Ninguna tarea automática revisa pedidos, renovaciones sin Stripe, periodos de gracia ni suspensiones.
   - El único planificador es el de pruebas, y está apagado por defecto (`CP_TRIALS_SCHEDULER_ENABLED`).
   - Una prueba vencida queda `expired` indefinidamente.
   - El tenant se queda en `trial` en el registro aunque pase a ser de pago, cancelado o suspendido.
3. **La compra de módulos no existe para el cliente.**
   - El catálogo y el cotizador los conocen, pero solo un operador puede añadirlos.
   - Stripe rechaza explícitamente cualquier pedido `change` o con complementos (`stripe/checkout.ts:159-166`).
   - Las ampliaciones por cantidad (`users`, `sites`, `storageGb`) se cotizan, pero no se convierten en partidas.
4. **La baja de la empresa no existe.** No hay exportación, ni plazo de conservación, ni borrado. `deleted` es solo una etiqueta.
5. **Hay 12 correos de plataforma que funcionan** (con `MAIL_MODE=off` no sale ninguno). Faltan:
   - el fallo del pago inicial;
   - los recordatorios durante la gracia;
   - la suspensión;
   - el fin efectivo de la suscripción;
   - los reembolsos y rectificativas;
   - la tarjeta a punto de caducar;
   - los módulos;
   - los tickets;
   - la seguridad (MFA, cambio de contraseña, bloqueo);
   - el mantenimiento o la caída del servicio.
6. **No hay plantillas versionadas ni un catálogo central de eventos.** Cada disparador llama directamente al notificador. Esa es la pieza que propone la sección 8.
7. **Riesgos detectados en el correo**, fuera del ámbito de la Ventana 2 y por tanto no corregidos aquí:
   - `mergeGlobalCc` pone en copia una dirección global en **todos** los correos del Core, incluidos los enlaces de restablecimiento e invitación.
   - La cuota del plan puede bloquear correos críticos.
   - Ver sección 3.4.

---

## 1. Diagrama del ciclo de vida

```
                     (web, CP_PUBLIC_TRIAL_ENABLED)          (operador)
                                 │                                │
                     pending_verification ──expire_verification──► cancelled
                                 │ verify
                              verified ◄──provisioning_failed──┐
                                 │ activate                     │
                            provisioning ───────────────────────┘
                                 │  12 pasos, empresa CRM, suscripción «trialing», licencias Essential validUntil=trialEnd
                                 ▼
   ┌──────────────── PRUEBA active (15 d) ── avisos −3d, −1d ──► expired (0 d, solo lectura)  ──► [A] gracia / archivado / borrado
   │                       │  │ suspend (manual) ──► suspended ──reactivate──┘
   │                       │  └ extension/approve (1 vez, ≤15 d)
   │  /trials/:id/convert  │ POST /orders {trialId}
   │  (sin pago) [riesgo]  ▼
   │               PEDIDO requested → quoted → contracted ──► confirmed ──► subscribed ──► licensed ──► ACTIVE
   │                             accept      firma / web-terms   pago verificado        suscripción       licencias
   │                                                             o approve (#154)        interna
   └──────────────────────────────────────────────────────────────────────────────────────────┘
                                                                                             │
     ACTIVE ◄─payment_recovered── PAST_DUE ◄──payment_failed── ACTIVE ──cancel──► CANCEL_SCHEDULED ──► CANCELLED
        ▲                            │ gracia (7 d) vencida [sin tarea automática]          │ (fin de periodo)     │
        │                            ▼                                                       │                      ▼
        └──────reactivate──────── SUSPENDED ── licencias «suspended»                         │            licencias cancelled | read_only
                                                                                               │            [inconsistente]
     Cambio de plan: pedido «change» (operador) → supersede del pedido anterior                │
     Cambio de plan en el Portal: hoy solo se registra como pago; con #158 → applyExternalPlanChange
     Módulos: solo operador (pedido «change» con items, o /subscriptions/:id/items + licences/apply)
     Reembolso total o disputa perdida → retención (coverageLost) → past_due → suspended

     TENANT (registro): provisioning → trial ─────────[A: nada lo mueve]───────── active / grace / suspended / archived / deleting / deleted
                                         (solo POST /tenants/:id/status, manual)
```

---

## 2. Matriz de eventos y estados (MISIÓN 1)

Columnas: disparador · estado previo → siguiente · entidades · identificadores · persistencia y auditoría · idempotencia · acceso resultante · comunicación debida · estado.

### 2.1 Prueba de 15 días — **E**, apagada por defecto

- **Disparador.** Web `POST /cp/v1/public/trial` → `/verify` (necesita `CP_PUBLIC_TRIAL_ENABLED=1`; la activación automática necesita `CP_TRIAL_AUTO_PROVISION=1`). Operador: `POST /trials`, que crea, verifica y activa.
- **Estados.** `pending_verification → verified → provisioning → active → expired`. Además: `suspended`, `converted`, `rejected` y `cancelled`.
- **Entidades.**
  - `trial_requests` y `trial_events`;
  - registro: `tenants`, `tenant_domains`, `tenant_databases`, `tenant_provisioning`, `tenant_events`;
  - CRM: `companies`;
  - `subscriptions` (`trialing`, Essential mensual);
  - `tenant_capabilities` y `tenant_capability_events`.
- **Identificadores.** `trial.id`, `tenantId = t<id>-<slug>`. No hay identificadores de Stripe. Del token y de la IP solo se guarda el hash.
- **Auditoría.** `trial_events` guarda cada transición y `notice_queued`.
- **Idempotencia.** `uq_trial_idempotency`, `uq_trial_open_email`, `uq_trial_tenant` y versión optimista.
- **Acceso.** Capacidades Essential `active` con `validUntil = trialEnd`. Al vencer, el Core las trata como solo lectura.
- **Comunicación.**
  - Verificación (E), bienvenida (E, sin fecha de fin) y avisos a 3 días, 1 día y 0 días (E).
  - Faltan (A): el aviso a 7 días o a mitad de la prueba; prueba ampliada; prueba suspendida; prueba convertida; fin de la gracia o archivado.
- **Huecos.**
  - Si no se activa el planificador, no hay vencimiento ni avisos.
  - Tras vencer no hay suspensión, gracia ni borrado.
  - `request_extension` no tiene ruta.

### 2.2 Conversión de prueba a pago — **E** (vía pedido) / **riesgo** (vía atajo)

- **Disparador.**
  - Vía A: `POST /orders {trialId}`, de tipo `trial_conversion`, seguido de `accept`, Checkout o `approve`, y `advance`.
  - Vía B: `POST /trials/:id/convert`.
- **Estados.**
  - Pedido: `requested→quoted→contracted→confirmed→subscribed→licensed→active`.
  - Prueba: `active→converted`.
  - Suscripción: `trialing→active`.
  - Tenant: **sigue en `trial`** (A).
- **Identificadores.** `order.id`/`reference`, `trialId`, `contractId`, `subscriptionId`, `tenantId`. En Stripe: `stripe_customer_id`, la sesión de Checkout y `commercial_payments.provider_ref = stripe:inv:<id>`.
- **Auditoría.** `commercial_order_events`, `commercial_payment_events`, `stripe_events`. Con #157 se añaden `stripe_invoices` y `fiscal_documents`.
- **Idempotencia.** `uq_order_idempotency` (más `payloadHash`), `uq_order_open_company`, `uq_payment_key`, más la unicidad de `stripe_events` por `event_id`.
- **Acceso.** Licencias sin caducidad. Solo se aplican con base `payment`, `admin_approval` o `inherited`.
- **Comunicación.**
  - E: `signup_received`, `payment_confirmed` (o `test_payment_confirmed`), `invoice_available` (sin enlace ni PDF) y `contract_confirmed`.
  - A: un correo propio de «tu prueba se ha convertido».
  - La vía B no envía nada.
- **Riesgo.** La vía B activa licencias de pago sin pago, contrato ni pedido. En live debería exigir los mismos requisitos que `approve` (#154): categoría, motivo y alerta. Es de propiedad compartida con la Ventana 3 (pruebas); ver la sección 5.

### 2.3 Suscripciones mensuales y anuales — **P**

- **Stripe (live).**
  - `customer.subscription.*` sincroniza el estado y `cancelAt` del pedido (`applyExternalBilling`).
  - `invoice.paid` con `subscription_cycle` registra la renovación.
- **Interna.** `server/subscriptions` en modo **sombra**: calcula, nunca cobra.
- **Estados.**
  - Suscripción: `trialing/active/canceled`, más `cancelAt` y `pendingInterval`.
  - Pedido: `active/past_due/suspended/cancel_scheduled/cancelled`.
- **Auditoría.** `subscription_events`, `shadow_invoices`, `shadow_charges`.
- **Idempotencia.** `uq_subscription_live_contract`, `uq_shadow_invoice`, `uq_shadow_charge_attempt`.
- **Hueco.** La renovación interna **no está programada**: solo `POST /subscriptions/:id/renewals`, `/orders/:id/renew` u `/orders/review`, todas manuales. El `tick()` del motor heredado `_core/billing` tampoco se programa.

### 2.4 Renovaciones y pagos — **E** con Stripe / **P** sin Stripe

- **Disparador.** `invoice.paid` (ciclo), que da `paymentRecorded(purpose=renewal, succeeded)`.
- **Estados.** El pedido sigue en `active` y el periodo avanza.
- **Comunicación.** `renewal_confirmed` (E) y `invoice_available` (E, sin enlace).
- **Fiscal.** Con #156, cada factura cobrada se contrasta con el impuesto esperado (alerta `stripe.invoice_tax_mismatch`). Con #157 se registra en `stripe_invoices` y genera un documento fiscal pendiente.
- **Faltan (A).** El aviso previo de renovación anual (recomendable 7 a 30 días antes) y la tarjeta a punto de caducar.

### 2.5 Fallos de pago y recuperación — **P**

- **Disparador.**
  - Renovación: `invoice.payment_failed`, o una suscripción de Stripe en `past_due`/`unpaid`; en ambos casos, `payment_failed`.
  - Recuperación: `invoice.paid` posterior, que da `payment_recovered`.
  - SCA: `invoice.payment_action_required`, que relee la factura.
- **Estados.** `active → past_due` (gracia) `→ suspended`. Se vuelve a `active` con `payment_recovered` o `reactivate`.
- **Acceso.** En `past_due` se mantiene. En `suspended`, licencias `suspended`.
- **Comunicación.**
  - E: `payment_failed` (un solo aviso por transición) y `subscription_reactivated`.
  - A:
    - los recordatorios durante la gracia (por ejemplo, días 3 y 6);
    - el aviso de suspensión inminente;
    - la suspensión efectiva;
    - la acción requerida (SCA) con enlace a la factura alojada.
- **Fallo del pago inicial (A).**
  - `checkout.session.async_payment_failed` y `checkout.session.expired` solo dejan una nota o el log; no hay `move` ni correo.
  - Debería haber un correo «tu pago no se ha completado» con el enlace para reintentar, una sola vez por sesión.
- **Hueco temporal.** Si la gracia se gestiona fuera de Stripe, nada la hace vencer sin `/orders/review`. Con Stripe, el paso a `suspended` depende de que Stripe marque `unpaid` o `canceled`, según su configuración de reintentos (Smart Retries).

### 2.6 Cambios de plan — **P**; queda **E** al fusionar #158

- **Operador.** Pedido `change` → `applyChange` (plan e intervalo) → `supersede` del pedido anterior. Se confirma con pago verificado o con `approve`.
- **Portal de Stripe.**
  - En integración: `customer.subscription.updated` con precio nuevo solo se registra como pago; **no cambia partidas ni licencias**.
  - Con #158: `applyExternalPlanChange` (bandera `external: "stripe"`, motivo `PORTAL_APPROVAL`) cambia el plan y luego la periodicidad, y reaplica las licencias.
  - El Portal live tiene los cambios de plan **desactivados**; el plan deseado se puede consultar en `GET /stripe/portal/plan` (#158).
- **Comunicación.** E: `contract_confirmed` (genérico). A: «plan cambiado», con plan anterior y nuevo, fecha efectiva y prorrateo; y «cambio programado» para bajadas a fin de periodo.

### 2.7 Compra y activación de módulos — **A** para el cliente / **P** para el operador

- **Hecho comprobado:** el catálogo de módulos **no** implica compra.
  - El autoservicio público solo admite los planes Essential y Business.
  - Stripe devuelve `unsupported` para `kind=change` y para cualquier pedido con `items`, `users`, `sites`, `storageGb` o `fiscalEntities` (`stripe/checkout.ts:159-166`).
  - El gateway no tiene ninguna operación para modificar los items de una suscripción.
- **Vía 1 del operador.** Pedido `change` con items → `addItem`. Se confirma con `approve` (en live, con #154: categoría y motivo).
- **Vía 2 del operador.** `POST /subscriptions/:id/items`. **No aplica licencias**; hay que llamar aparte a `POST /subscriptions/:id/licences/apply`.
- **Acceso.** `LicensingService.apply` recalcula plan, herencias, items y paquetes en una transacción, con un evento por cada cambio.
- **Comunicación.** A: módulo activado; módulo pendiente de pago; módulo dado de baja programada.

### 2.8 Ampliaciones y bajas de módulos — **P**

- **Ampliaciones por cantidad.** Se cotizan como líneas de complemento, pero `orchestrator.specs()` solo convierte `request.items`. Usuarios, sedes y almacenamiento **no generan partida**. No existe la operación de cambiar cantidad, y `addItem` rechaza un producto ya contratado.
- **Baja.** `removeItem`, por defecto a fin de periodo. La capacidad recibe `validUntil` y pasa a `cancelled` cuando se reaplican las licencias después de esa fecha, lo que **depende de que alguien las reaplique** (A: tarea automática).
- **Comunicación.** A.

### 2.9 Reembolsos — **P**

- **Disparador.** `charge.refunded`, `charge.refund.updated` y `charge.dispute.*`. El procesador relee el cargo y guarda el ajuste en `stripe_charge_adjustments`.
- **Efecto.**
  - Un reembolso total o una disputa perdida suponen pérdida de cobertura: retención, `past_due → suspended` y licencias suspendidas.
  - Un reembolso parcial o una disputa abierta solo generan alerta.
  - La retención se levanta con un nuevo periodo pagado, una disputa ganada o `POST /stripe/adjustments/:chargeId/resolve`.
- **Fiscal (#157).** `recordRefund` crea una rectificativa pendiente con impuesto proporcional en `fiscal_documents`. La emisión legal está pendiente del sistema de facturación (D-10 y VeriFactu).
- **Comunicación.** A: reembolso emitido; rectificativa disponible; servicio suspendido por retención. Las disputas **no** se comunican al cliente por correo automático: es un asunto del operador.

### 2.10 Cancelación y baja de la empresa — **E** la cancelación / **A** la baja

- **Disparador.**
  - Stripe: `cancel_at` o `canceled`.
  - `POST /orders/:id/cancel`, que se rechaza si el pedido se cobra en Stripe.
  - `POST /subscriptions/:id/cancel`.
  - Cascada desde contratos del CRM vía `/orders/review`.
- **Estados.** `active|past_due|suspended → cancel_scheduled → cancelled`.
- **Acceso.** **Inconsistente:** las licencias acaban `cancelled` por la vía interna y `read_only` por Stripe. Hay que decidir uno solo; se propone `read_only` durante la conservación y `cancelled` tras la exportación o el borrado.
- **Tenant.** Nada lo mueve. Solo `POST /tenants/:id/status`, manual, con motivo para `deleting` y `deleted`. Ningún estado borra la base de datos; solo `provisioning.abort` la borra, y únicamente en altas no activadas.
- **Comunicación.** E: `cancellation` («cancelación registrada»). A:
  - fin efectivo / solo lectura;
  - exportación disponible;
  - aviso previo de borrado;
  - confirmación de borrado.
- **Ausente:** exportación de datos para el cliente, plazo de conservación, archivado y borrado real, y su auditoría.

### 2.11 Tabla resumen

| # | Operación | Estado | Acceso correcto | Correo | Tarea automática |
|---|---|---|---|---|---|
| 1 | Prueba 15 d | E (apagada) | E | P | P (planificador apagado) |
| 2 | Conversión | E / riesgo vía B | E | P | — |
| 3 | Suscripción mensual/anual | P (sombra) | E | — | A |
| 4 | Renovación | E Stripe / P interna | E | P | A sin Stripe |
| 5 | Impago y recuperación | P | E | P | A (gracia y suspensión) |
| 6 | Cambio de plan | P (E con #158) | P (E con #158) | P | — |
| 7 | Compra de módulos | A cliente / P operador | P | A | — |
| 8 | Ampliación y baja de módulos | P | P | A | A |
| 9 | Reembolsos | P | E (retención) | A | — |
| 10 | Cancelación y baja | E / A | P (inconsistente) | P | A |

---

## 3. Inventario de correos existentes (MISIÓN 2)

### 3.1 Infraestructura existente

**Cola persistente.** Tablas `mail_outbox`, `mail_events` y `mail_suppressions`, en dos copias idénticas:
- plataforma, en la base del CRM (migración CRM `0011`);
- empresa, en la base de cada tenant (migración `0010`).

Clave única `(tenant_id, idempotency_key)`.

**Estados.**
- `pending`, `sending`, `accepted`, `delivered`, `soft_bounced`, `bounced`, `blocked`, `complained`, `failed`, `skipped`.
- Al llegar a un estado final se purga el cuerpo y la dirección; se conservan la dirección enmascarada y su hash.

**Reintentos.** Espera de 1, 2, 4, 8… minutos con tope de 1 h, `MAIL_MAX_ATTEMPTS=5` y bloqueo de 120 s.
- Se reintentan 429, 5xx y errores de red.
- Los 4xx son definitivos.

**Guardas, por orden:**
1. remitente;
2. contenido;
3. modo;
4. lista de sandbox;
5. supresión;
6. límites (300/h por tenant, 8/h por destinatario).

**Modos:**
- `off` (por defecto): la fila queda `skipped/mode_off`.
- `sandbox`: requiere lista de permitidos.
- `live`: requiere `MAIL_LIVE_AUTHORIZED=1` y `MAIL_SENDING_DOMAIN`.

**Proveedor.** Brevo API, o SMTP si falta; sin ninguno, `failed/no_provider`.

**Webhook de Brevo.** `POST /cp/v1/mail/brevo/webhook`, con token de al menos 32 caracteres.
- Transiciones solo hacia delante.
- Supresión automática por rebote definitivo, queja o baja.
- Cada evento se aplica una vez.

**Alerta** `rate.mail.send_failed`: 5 fallos en 15 min. Solo abre incidencia en el plano de control.

### 3.2 Correos de plataforma (Elephant Source → empresa cliente)

Todos pasan por la cola de plataforma.

| Categoría actual | Asunto | Disparador | Destinatario | Clave de idempotencia | Estado |
|---|---|---|---|---|---|
| `email_verification` | Confirma tu correo… / Tu nuevo enlace… | registro o reenvío de la prueba | solicitante | `trial:{id}:verification:{sha16(token)}` | E (requiere `CP_TRIAL_VERIFY_URL`) |
| `trial_activated` | Tu prueba de Elephant Source está lista | activación de la prueba | propietario | `trial-welcome:{tenant}:{sha16}` | E (sin `endsAt`) |
| `trial_expiry` (3 d y 1 d) | Tu prueba termina en 3 días / mañana | planificador | solicitante | `trial:{id}:expiry:{endsAt}:{d}` | E (planificador apagado) |
| `trial_expiry` (0 d) | Tu prueba ha terminado | `markExpired` | solicitante | ídem | E |
| `tenant_welcome` | La plataforma de {empresa} está lista | activación asistida desde el CRM | contacto del contrato | `assisted-welcome:{tenant}:{sha16}` | E (los errores se ignoran) |
| `signup_received` | Hemos recibido tu solicitud de alta | `sign` con `web-terms:` | contacto principal del CRM | `order:{id}:sign:{v}` | E |
| `payment_confirmed` / `test_payment_confirmed` | Pago (de prueba) confirmado | `confirm` con base payment | ídem | `order:{id}:confirm:{v}` | E |
| `invoice_available` | Factura disponible | `confirm` o `payment_recorded` con Stripe | ídem | `order:{id}:invoice_available:p{pago}` | P (sin enlace ni PDF) |
| `renewal_confirmed` | Renovación confirmada | `paymentRecorded(renewal)` | ídem | `order:{id}:renewal_confirmed:p{pago}` | E |
| `contract_confirmed` | Contratación confirmada | `activate` (también cambios y módulos) | ídem | `order:{id}:activate:{v}` | E (genérico) |
| `payment_failed` | No hemos podido cobrar tu recibo | `active → past_due` | ídem | `order:{id}:payment_failed:{v}` | E (un solo aviso) |
| `subscription_reactivated` | Suscripción al corriente / reactivada | `payment_recovered` / `reactivate` | ídem | `order:{id}:{acción}:{v}` | E |
| `cancellation` | Cancelación registrada | `cancel` | ídem | `order:{id}:cancel:{v}` | E |
| `password_reset` (operadores) | Big Elephant CRM — restablecer la contraseña | `operatorAuth` | operador | `operator-reset:{sha40}` | E (la vía `CP_RESET_SMTP_URL` se salta la cola; la marca no es «Elephant Source») |

**Definidas pero sin uso:** `signupConfirmation` y `tenantNotice`.

**Ruta antigua:** `trials/emailNotifier.ts`, SMTP directo sin cola. Solo se usa si falta la migración 0011.

### 3.3 Correos del Core (empresa → sus usuarios y clientes)

**Cuenta:**
- restablecer contraseña (60 min);
- invitación (72 h);
- accesos a los portales de gestoría, empleado, colaboradores y proveedores.

**Comercial de la empresa:**
- presupuesto, propuesta y solicitudes;
- recordatorios comerciales 1, 2 y 3 (cola `email_scheduled_jobs`, flag apagado).

**Otros envíos:**
- reservas y pagos de sus clientes;
- facturas y abonos con PDF;
- anulaciones y reembolsos de sus clientes;
- avisos fiscales internos;
- liquidaciones de proveedores.

**Mecánica común.** Todo pasa por `sendEmail()`, que aplica la cuota del plan y la copia global, y usa la cola de la empresa en multiempresa. Casi ningún llamante pasa clave de idempotencia; se usa una clave por contenido con ventana de 10 min.

Estos correos son **del producto de la empresa**, no del circuito comercial de Elephant Source. Quedan fuera del motor comercial, pero comparten infraestructura.

### 3.4 Riesgos detectados en el correo (no corregidos: fuera del ámbito de la Ventana 2)

| # | Riesgo | Ámbito | Propuesta |
|---|---|---|---|
| R1 | `mergeGlobalCc` (`mailer.ts:211-221`) pone en copia `email_cc_all` (o la dirección de Náyade en instalación única) en **todos** los correos, también en los restablecimientos e invitaciones, de modo que la copia recibe los enlaces con token | Core (V3) | excluir las categorías `password_reset`, `user_invite` y de seguridad |
| R2 | `enforceQuota(EMAIL_SENT)` puede bloquear restablecimientos e invitaciones | Core (V3) | exentar las categorías transaccionales críticas |
| R3 | La cola de la empresa solo se drena con `email_automation_job_enabled` (apagado) o al enviar otro correo | Core (V3) | drenaje independiente del flag |
| R4 | El reset de operador por `CP_RESET_SMTP_URL` se salta la cola, la idempotencia y `MAIL_MODE` | CRM/operadores (V3) | retirarlo cuando exista la cola en live |
| R5 | El evento `unsubscribed` de Brevo suprime también correos transaccionales | Correo (V2) | suprimir solo la clase `marketing` (sección 8.6) |
| R6 | El límite de 300/h del carril de plataforma comparte el tenant `platform`: es un tope global | Correo (V2) | clave de límite por tenant destinatario |
| R7 | No hay retención de las filas de `mail_outbox` y `mail_events` | Correo (V2) | retención de 24 meses y purga |
| R8 | Por SMTP no hay eventos de entrega: los mensajes se quedan en `accepted` | Correo (V2) | documentado; Brevo será el proveedor con seguimiento |

---

## 4. Catálogo propuesto de correos que faltan

**Identificador estable:** `es.<familia>.<evento>`. La versión va aparte (`@vN`) y se registra en cada envío.

**Prioridad:**
- **P0:** imprescindible antes de abrir la contratación.
- **P1:** primer mes de operación.
- **P2:** mejora.

**Clases:**
- **T:** transaccional. No admite baja y se envía aunque haya `unsubscribed`; solo la bloquean el rebote definitivo y la queja.
- **M:** comercial o marketing. Requiere base legal y admite baja.

### 4.1 Prueba y bienvenida

| ID | Nombre | Disparador (evento de dominio) | Destinatario | Enviar si / bloquear si | Momento | Prioridad | Clase | Datos | Estado |
|---|---|---|---|---|---|---|---|---|---|
| `es.trial.verification` | Verifica tu correo | `trial.verification_requested` | solicitante | token nuevo / prueba ya verificada | inmediato | P0 | T | enlace, caducidad | E |
| `es.trial.welcome` | Tu prueba está lista | `trial.activated` | propietario | token de invitación / — | inmediato | P0 | T | host, enlace, **fecha de fin** | P (falta `endsAt`) |
| `es.trial.midpoint` | Te quedan 7 días | `trial.ending(7)` | propietario | prueba `active` / convertida o cancelada | 09:00 hora local | P1 | T | fin, enlace de planes | A |
| `es.trial.ending_3d` | Termina en 3 días | `trial.ending(3)` | propietario | ídem | 09:00 | P0 | T | ídem | E |
| `es.trial.ending_1d` | Termina mañana | `trial.ending(1)` | propietario | ídem | 09:00 | P0 | T | ídem | E |
| `es.trial.expired` | Tu prueba ha terminado (solo lectura) | `trial.expired` | propietario | — / convertida | inmediato | P0 | T | gracia, enlace de planes | E |
| `es.trial.extended` | Prueba ampliada | `trial.extended` | propietario | — | inmediato | P2 | T | nuevo fin | A |
| `es.trial.converted` | Bienvenido a {plan} | `trial.converted` | propietario y facturación | — | inmediato | P1 | T | plan, periodicidad | A |
| `es.trial.grace_ending` | Tus datos se archivarán el {fecha} | `trial.grace_ending` | propietario | política de gracia aprobada | −3 d | P1 | T | fecha, exportación | A (depende de la política) |
| `es.trial.archived` | Prueba archivada | `trial.archived` | propietario | ídem | inmediato | P2 | T | conservación | A |

### 4.2 Suscripciones, pagos, renovaciones y recobro

| ID | Nombre | Disparador | Destinatario | Enviar si / bloquear si | Momento | Prioridad | Clase | Datos | Estado |
|---|---|---|---|---|---|---|---|---|---|
| `es.order.received` | Solicitud de alta recibida | `order.signed` | contacto de facturación | — | inmediato | P0 | T | referencia | E |
| `es.payment.confirmed` | Pago confirmado | `payment.succeeded(initial)` | facturación | pago verificado live / pago de prueba → variante test | inmediato | P0 | T | importe con IVA, referencia | E |
| `es.payment.initial_failed` | Tu pago no se ha completado | `checkout.async_failed` / `checkout.expired` con intento | facturación | una vez por sesión / pedido ya pagado | inmediato | **P0** | T | enlace para reintentar | **A** |
| `es.subscription.activated` | Contratación confirmada | `order.activated` | propietario y facturación | — | inmediato | P0 | T | plan, módulos, host | E (genérico) |
| `es.renewal.upcoming` | Tu renovación anual será el {fecha} | `renewal.upcoming(30/7)` | facturación | solo anual / cancelación programada | −30 d y −7 d | P1 | T | importe, fecha, enlace al Portal | A |
| `es.renewal.confirmed` | Renovación confirmada (cobro mensual o anual) | `payment.succeeded(renewal)` | facturación | — | inmediato | **P0** | T | importe, periodo | E |
| `es.payment.failed` | No hemos podido cobrar tu recibo | `payment.failed(renewal)` | facturación y propietario | transición desde `active` | inmediato | **P0** | T | gracia, enlace a la factura alojada | E (sin enlace) |
| `es.payment.action_required` | Confirma tu pago (autenticación) | `invoice.payment_action_required` | facturación | — | inmediato | P0 | T | enlace a la factura alojada | A |
| `es.dunning.reminder` | Recordatorio: recibo pendiente | `dunning.reminder(n)` | facturación | `past_due` / recuperado | días +3 y +6 de gracia | P1 | T | días restantes | A |
| `es.service.suspended` | Servicio suspendido por impago | `order.suspended(reason=payment)` | propietario y facturación | — | inmediato | **P0** | T | cómo reactivar | **A** |
| `es.payment.recovered` | Pago recibido, servicio al corriente | `payment.recovered` | facturación | — | inmediato | P0 | T | — | E |
| `es.card.expiring` | Tu tarjeta caduca pronto | `payment_method.expiring` | facturación | suscripción activa / cancelada | −30 d | P2 | T | enlace al Portal | A (requiere `customer.source.expiring` o una consulta mensual) |

### 4.3 Módulos y cambios de plan

| ID | Nombre | Disparador | Destinatario | Prioridad | Estado |
|---|---|---|---|---|---|
| `es.plan.changed` | Tu plan ha cambiado | `subscription.plan_changed` | propietario y facturación | P1 | A |
| `es.plan.change_scheduled` | Cambio programado para el {fecha} | `subscription.plan_change_scheduled` | ídem | P1 | A |
| `es.module.activated` | Módulo {nombre} activado | `module.activated` | propietario | P1 | A |
| `es.module.pending_payment` | Completa el pago para activar {módulo} | `module.pending_payment` | facturación | P2 (cuando exista la compra) | A |
| `es.module.removal_scheduled` | Baja de {módulo} programada | `module.removal_scheduled` | propietario | P1 | A |
| `es.module.removed` | {módulo} desactivado | `module.removed` | propietario | P2 | A |
| `es.capacity.changed` | Ampliación aplicada (usuarios, sedes, almacenamiento) | `capacity.changed` | propietario | P2 | A (las ampliaciones aún no existen) |

### 4.4 Facturas, rectificativas y reembolsos

| ID | Nombre | Disparador | Prioridad | Estado / condición |
|---|---|---|---|---|
| `es.invoice.available` | Factura disponible | `fiscal_document.issued(invoice)` | P0 | P: hoy se envía al cobrar, sin enlace. Debe enviarse **cuando el documento legal se emita** (#157 `issued`) o, mientras tanto, con el enlace a la factura alojada de Stripe |
| `es.refund.issued` | Reembolso emitido | `refund.succeeded` | P0 | A. Importe, medio y plazo bancario |
| `es.credit_note.available` | Factura rectificativa disponible | `fiscal_document.issued(rectification)` | P1 | A. Depende de D-10 y VeriFactu |
| `es.service.held` | Servicio suspendido por retención de pago | `coverage.lost` | P1 | A. Redacción neutra: no se mencionan disputas |

### 4.5 Tickets de soporte (los emite la Ventana 1)

| ID | Disparador | Destinatario | Prioridad |
|---|---|---|---|
| `es.ticket.received` | `ticket.created` | solicitante | P1 |
| `es.ticket.replied` | `ticket.comment_added(public)` | solicitante | P1 |
| `es.ticket.waiting_customer` | `ticket.status_changed(waiting_customer)` | solicitante | P2 |
| `es.ticket.resolved` | `ticket.status_changed(resolved)` | solicitante | P1 |
| `es.ticket.assigned` (interno) | `ticket.assigned` | operador | P2 |

Requisito previo: `support_tickets.requester` es texto libre. Hace falta vincularlo a un contacto o usuario con correo verificado.

### 4.6 Cuenta y seguridad (los emite la Ventana 3)

| ID | Disparador | Destinatario | Prioridad |
|---|---|---|---|
| `es.security.password_reset` | `password_reset_requested` | usuario u operador | E |
| `es.security.password_changed` | `password_changed` / `password_set_by_admin` | afectado | P1 |
| `es.security.mfa_enabled` / `es.security.mfa_disabled` / `es.security.mfa_reset` | `mfa_*` | afectado | P1 |
| `es.security.account_locked` | `account_locked` / `login_locked` | afectado | P1 |
| `es.security.new_login` | `login_success` desde un dispositivo nuevo | afectado | P2 |
| `es.security.role_changed` | `role_changed` | afectado | P2 |
| `es.security.support_access` | `support.granted` / `support.session_started` | admin de la empresa | P1 |
| `es.account.invite` | `user_invited` | invitado | E |

Los correos de seguridad **nunca** contienen enlaces con token salvo el de restablecimiento. Nunca van en copia (ver R1).

### 4.7 Incidencias y continuidad del servicio

| ID | Disparador | Destinatario | Prioridad | Estado |
|---|---|---|---|---|
| `es.ops.incident` (interno) | `incident.opened` / `incident.escalated` / `incident.resolved` con severidad crítica | guardia | P1 | P: solo webhook; falta correo de respaldo |
| `es.service.maintenance` | `maintenance.scheduled` (manual) | administradores de los tenants afectados | P2 | A |
| `es.service.outage` / `es.service.restored` | `status.incident` publicado | ídem | P2 | A |
| `es.tenant.quota_near` | `quota.near` | admin de la empresa | P2 | A (hoy solo incidencia) |
| `es.tenant.entitlement_expiring` | `entitlement.expiring` | propietario | P1 | A |

### 4.8 Baja de la empresa

| ID | Disparador | Prioridad | Estado |
|---|---|---|---|
| `es.subscription.ended` | `order.cancelled` (fin efectivo, solo lectura) | **P0** | A |
| `es.offboarding.export_ready` | `export.ready` | P1 | A (no hay exportación) |
| `es.offboarding.deletion_notice` | `tenant.deletion_scheduled(−7 d)` | P1 | A |
| `es.offboarding.deleted` | `tenant.deleted` (con certificado) | P1 | A |

---

## 5. Mapa de dependencias entre ventanas

**Contrato de eventos común.** Cada ventana emite eventos de dominio en una tabla `domain_events` (sección 8). La Ventana 2 los consume para notificar. **Nadie llama al motor de correo directamente** desde CRM, Core o tickets.

| Emisor | Evento que debe emitir | Dónde (archivo actual) | Hoy | Consume |
|---|---|---|---|---|
| **V1 (CRM y tickets)** | `ticket.created` · `ticket.comment_added{visibility}` · `ticket.status_changed{from,to}` · `ticket.assigned` | `server/_core/support/tickets.ts` (create :232, comment :303, setStatus :287, assign :268) | solo `support_ticket_events` | V2 (4.5) |
| V1 | vincular `requester` a `contact_id` / `user_id` con correo | `db/registry/0006_support_tickets.sql` | texto libre | — |
| V1 | `contract.cancelled` (cascada a pedidos) | contratos del CRM | lo lee `/orders/review` | V2 |
| **V3 (Core, acceso, MFA)** | `security.*` de operadores (ya auditados) publicados como eventos | `controlPlane/operatorAuth.ts:241` (`audit()`) | `cp_operator_events` | V2 (4.6) |
| V3 | auditoría de usuarios del Core: `user_invited`, `invite_accepted`, `password_reset_*`, `login_locked`, `role_changed` | nueva tabla por tenant | solo log | V2 |
| V3 | `tenant.status_changed{from,to,reason}` desglosado en `trial_started`, `grace_entered`, `suspended`, `reactivated`, `archived`, `deleted` | `tenantRegistry/service.ts:94` | `status.changed` | V2 |
| V3 | `support.granted` / `support.revoked` / `support.session_started` | `_core/support/grants.ts:106,127`, `session.ts:147` | `tenant_events` (sesión: solo log) | V2 |
| V3 | `quota.near`, `entitlement.expiring` como eventos (no solo incidencias) | `_core/ops/alerts.ts` | `ops_incidents` | V2 |
| V3 | sincronizar el estado del tenant con el comercial: escuchar `order.*` y `trial.*` y mover el registro | `tenantRegistry/lifecycle.ts` | nada | — |
| V3 | `/trials/:id/convert` en live: exigir pedido, o motivo y categoría como `approve` | `trials/onboarding.ts:292` | sin pago | — |
| V3 | R1 (copia global), R2 (cuota), R3 (drenaje), R4 (SMTP de reset) | `server/mailer.ts`, `emailAutomationJob.ts`, `operatorSetup.ts` | — | — |
| V3 | exportación y borrado de la base del tenant (offboarding) | `provisioning/*` | solo `abort` | V2 (4.8) |
| **V2 (esta)** | `trial.*`, `order.*`, `payment.*`, `renewal.*`, `dunning.*`, `subscription.*`, `module.*`, `refund.*`, `fiscal_document.*`, `coverage.*` | orquestador, pruebas, `server/stripe/*` | llamadas directas a `orderNotifier` | V2 y V3 |

**Decisiones del propietario que bloquean:**
- **D-15:** duración de la gracia tras impago (hoy 7 días) y número de recordatorios.
- **D-16:** gracia tras vencer la prueba y plazo de archivado y borrado.
- **D-17:** plazo de conservación tras la baja y formato de la exportación.
- **D-18:** remitente y dominio definitivos (`MAIL_SENDING_DOMAIN`) y Reply-To de soporte.
- **D-19:** base legal y consentimiento para correos de clase M; hasta entonces, **no se envía ningún correo M**.
- **D-10 (existente):** rectificativas y sistema de facturación legal.

---

## 6. Priorización

**P0: antes de abrir la contratación.**
1. Motor de eventos y notificaciones (sección 8), con la tabla de eventos y la de plantillas versionadas, reutilizando la cola existente.
2. Migrar los 12 correos existentes al catálogo sin cambiar su texto. Las claves de idempotencia actuales se conservan.
3. `es.payment.initial_failed`, `es.payment.action_required`, `es.service.suspended`, `es.subscription.ended`, `es.refund.issued`.
4. Enlace a la factura alojada en `payment.failed` e `invoice.available` (guardar `hosted_invoice_url` en `stripe_invoices`, #157).
5. Tarea automática de revisión de pedidos (gracia, suspensión, fin de `cancel_at`, reaplicar licencias con `validUntil` vencido). Con bloqueo entre réplicas, como el planificador de pruebas, y **apagada por defecto**.
6. Unificar el acceso tras la cancelación (`read_only` frente a `cancelled`).
7. R5: separar la supresión transaccional de la comercial.

**P1:**
- recordatorios de gracia y aviso de renovación anual;
- cambio de plan y módulos (correos);
- `trial.midpoint`, `trial.converted` y `endsAt` en la bienvenida;
- tickets (con V1) y seguridad (con V3);
- correo de respaldo para incidencias;
- rectificativa disponible (tras D-10);
- retención de las tablas de correo.

**P2:**
- tarjeta a punto de caducar;
- nuevo inicio de sesión;
- mantenimiento y caída;
- cuota cercana;
- ampliaciones por cantidad;
- compra de módulos por el cliente con Stripe (requiere diseño de `subscription_items` en Stripe y del Portal).

---

## 7. Modelo de trazabilidad

Cada operación comercial debe poder reconstruirse de punta a punta con una sola clave de correlación.

```
correlation_id  (= order.id o trial.id; un pedido «change» hereda el del pedido original en parent_correlation_id)
   │
   ├─ domain_events        event_id, type, version, tenant_id, environment, correlation_id, causation_id,
   │                       actor{kind: system|operator|customer|stripe, id}, occurred_at, payload (sin datos personales)
   ├─ commercial_order_events / trial_events / subscription_events / tenant_capability_events   (ya existen)
   ├─ stripe_events        stripe event_id → causation_id del evento de dominio que produce
   ├─ commercial_payments  provider_ref stripe:inv:<id>
   ├─ stripe_invoices / fiscal_documents   (#157)
   └─ notifications        notification_id, event_id, template_id@version, recipient_hash, channel, class (T|M),
                           decision (queued|blocked:<motivo>), mail_outbox.id
          └─ mail_outbox / mail_events   (ya existen: estado de entrega, rebote, queja)
```

Reglas:
- `causation_id` encadena cada efecto con su causa: evento de Stripe → pago → movimiento del pedido → licencias → notificación.
- Ningún evento lleva datos personales en `payload`. Los datos se resuelven al renderizar, a partir de los identificadores.
- `environment` (`integration` | `live`) en cada evento y notificación. El motor **rechaza** procesar un evento de otro entorno.
- Consulta de soporte prevista: `GET /cp/v1/trace/:correlationId` (solo lectura, `ops:read`), con la línea temporal unificada.

---

## 8. Diseño del motor de eventos y notificaciones (MISIÓN 3)

### 8.1 Flujo

```
 emisor (orquestador, pruebas, Stripe, tickets, seguridad)
      │  en la MISMA transacción que el cambio de estado
      ▼
 domain_events (outbox de dominio)  ── uq(event_key)
      │  despachador (tarea con bloqueo, apagable)
      ▼
 reglas de notificación (catálogo: evento → plantillas, destinatarios, condiciones, momento)
      │  decisión registrada en `notifications` (queued | blocked:<motivo> | scheduled:<fecha>)
      ▼
 renderizado con plantilla versionada (template_id@vN, idioma)
      ▼
 mail_outbox (cola existente) ── uq(tenant_id, idempotency_key)
      ▼
 MailProvider (interfaz: brevo | smtp | none)  ◄── webhook de entrega → mail_events
```

### 8.2 Principios

1. **Un fallo de correo nunca deshace un pago o una activación.**
   - El evento de dominio se escribe en la transacción del cambio de estado.
   - El correo es un efecto posterior y asíncrono. Ninguna excepción del motor se propaga al orquestador.
   - Hoy `orderNotifier` se llama tras el cambio y los errores se capturan. Se mantiene, pasando de la llamada directa a la emisión del evento.
2. **Idempotencia en tres niveles:**
   - `domain_events.event_key` (por ejemplo `order:{id}:activate:{version}`);
   - `notifications (event_id, template_id, recipient_hash)`;
   - `mail_outbox (tenant_id, idempotency_key)`.
3. **Reintentos controlados.**
   - El despachador reintenta con espera exponencial y pasa a `dead` tras N intentos, con alerta.
   - La cola de correo conserva su propia política (5 intentos, tope de 1 h).
4. **Plantillas versionadas.**
   - Tabla `notification_templates (template_id, version, locale, class, subject, html, text, variables_schema, status: draft|approved|retired, approved_by, approved_at)`.
   - Solo se envían versiones `approved`. Cada envío guarda `template_id@version`.
   - Al principio las plantillas viven en código (`server/mail/templates.ts`) con versión explícita. Pasar a base de datos es opcional y posterior.
5. **Separación por tenant.** Carriles `platform` y `tenant` como hoy. El límite por destinatario se calcula por tenant real (R6).
6. **Separación integración y live.**
   - `environment` en eventos y notificaciones; el motor de integración no procesa eventos de live, ni al revés.
   - En integración, `MAIL_MODE=sandbox` con lista de permitidos. En live, `off` hasta autorización.
7. **Cambio de proveedor sin reescribir procesos.**
   - Los procesos comerciales solo emiten eventos. El catálogo solo conoce plantillas.
   - El proveedor es una interfaz (`MailProvider`, que ya existe) elegida por configuración.
   - El webhook normaliza los estados del proveedor a los de `mail_events`.
8. **Transaccional frente a marketing.**
   - `class` en la plantilla.
   - Las M exigen consentimiento registrado (D-19) y enlace de baja.
   - Las T ignoran `unsubscribed` y solo las bloquean el rebote definitivo y la queja.
   - Las M nunca comparten plantilla con las T.
9. **Programación temporal.**
   - Los avisos con fecha (prueba a −7, −3 y −1 días; renovación a −30 y −7; gracia a +3 y +6) se generan como `notifications` con `scheduled_for`.
   - Se re-evalúan al vencer: si el estado ya no lo justifica (prueba convertida, pago recuperado), pasan a `blocked:stale`.
10. **Alertas internas.**
    - `notification.dead`;
    - `mail.bounce_rate` (más del 5 % en 24 h);
    - `mail.complaint`;
    - una plantilla P0 sin versión aprobada al arrancar.
    - Van a `ops_incidents` y al webhook, con correo de respaldo a guardia **solo** cuando exista proveedor autorizado.

### 8.3 Contrato del evento de dominio

```ts
interface DomainEvent {
  eventKey: string;            // idempotencia: "order:123:activate:4"
  type: string;                // "order.activated"
  schemaVersion: 1;
  environment: "integration" | "live";
  tenantId: string | null;     // null = plataforma
  correlationId: string;       // pedido o prueba
  causationId?: string;        // evento de Stripe u otro evento de dominio
  actor: { kind: "system" | "operator" | "customer" | "stripe"; id?: string };
  occurredAt: string;          // ISO
  data: Record<string, string | number | boolean | null>;  // identificadores e importes; sin correos ni nombres
}
```

### 8.4 Tablas nuevas (migración CRM, aislada)

| Tabla | Columnas | Restricciones |
|---|---|---|
| `domain_events` | `id`, `event_key`, `type`, `schema_version`, `environment`, `tenant_id`, `correlation_id`, `causation_id`, `actor_kind`, `actor_id`, `occurred_at`, `data_json`, `dispatch_status` (`pending`/`done`/`dead`), `attempts`, `next_attempt_at` | `uq(event_key)` |
| `notifications` | `id`, `event_id`, `rule_id`, `template_id`, `template_version`, `class`, `tenant_id`, `recipient_hash`, `recipient_masked`, `scheduled_for`, `decision`, `reason`, `mail_outbox_id`, `created_at` | `uq(event_id, template_id, recipient_hash)` |
| `notification_templates` | — | fase 2, opcional |

### 8.5 Estado del interruptor

| Interruptor | Valor | Efecto |
|---|---|---|
| `CP_EVENTS_DISPATCH_ENABLED` | 0 por defecto | Los eventos se registran, pero no se despachan |
| `MAIL_MODE` | `off` (sin cambios) | Con el despachador encendido, todas las notificaciones quedan `skipped/mode_off` en la cola: trazables y sin envío |

### 8.6 Cambio necesario en la supresión (R5)

`mail_suppressions` debe ganar una columna `scope` (`all` | `marketing`):
- `unsubscribed` suprime `marketing`;
- `hard_bounce`, `invalid` y `spam` suprimen `all`.

---

## 9. Plan por PR independientes

Cada PR se hace sobre `integration/elephant-source`, en su propia rama, con pruebas y sin fusionar sin autorización. Ninguno activa envíos ni Checkout.

| # | Rama | Contenido | Depende de | Infra |
|---|---|---|---|---|
| 1 | `docs/roadmap-trazabilidad-comercial` | Este documento | — | no |
| 2 | `feat/eventos-dominio-tabla` | Migración CRM `domain_events` y `notifications` (con `.down`) y almacén en memoria y MySQL. Sin consumidores | — | **sí (migración aislada)** |
| 3 | `feat/eventos-dominio-emision` | El orquestador, las pruebas y el procesador de Stripe emiten eventos en la misma transacción. `orderNotifier` sigue funcionando igual (doble vía) | 2 | no |
| 4 | `feat/notificaciones-catalogo` | Catálogo `es.*`, plantillas en código con versión, reglas evento→plantilla y despachador apagado por defecto. Migración de los 12 correos existentes con el mismo texto y claves | 3 | no |
| 5 | `feat/notificaciones-p0-pagos` | `initial_failed`, `action_required`, `service.suspended`, `subscription.ended`, `refund.issued` y enlace a la factura alojada | 4, #157 | no |
| 6 | `feat/pedidos-revision-programada` | Tarea de revisión de pedidos con bloqueo y **apagada por defecto**; unificación `read_only`/`cancelled` | 3 | no |
| 7 | `feat/correo-supresion-por-clase` | `mail_suppressions.scope` (R5), límite por tenant real (R6) y retención (R7) | — | **sí (migración)** |
| 8 | `feat/notificaciones-programadas` | `scheduled_for`, re-evaluación y avisos de prueba (−7 días), de renovación y de gracia | 4, 6 | no |
| 9 | `feat/traza-comercial` | `GET /cp/v1/trace/:correlationId` (solo lectura) | 3 | no |
| 10 | `feat/notificaciones-p1` | Plan, módulos, conversión, retención y rectificativa (tras D-10) | 4 | no |
| — | V1 | Eventos `ticket.*` y vínculo de `requester` | 2 | — |
| — | V3 | Eventos `security.*`, auditoría de usuarios del Core, `tenant.*` desglosados, sincronización del estado del tenant, R1–R4 y offboarding | 2 | — |

Cada PR que toque migraciones se despliega solo, con la migración aplicada como paso explícito (nunca al arrancar), según `CLAUDE.md`.

---

## 10. Plan de pruebas de extremo a extremo

Todas se ejecutan en integración (sandbox de Stripe, cuando haya credenciales) o con la pasarela simulada. `MAIL_MODE=off` o `sandbox` con lista de permitidos. **Ninguna en live.**

| # | Escenario | Comprobaciones |
|---|---|---|
| E1 | Prueba completa: registro → verificación → activación → avisos a −7, −3 y −1 días → vencimiento | estados `trial_*`; licencias con `validUntil`; 1 notificación por aviso aunque el planificador pase dos veces; aviso bloqueado `stale` si se convierte antes |
| E2 | Conversión por pedido con pago verificado | `trial.converted`, suscripción `active`, licencias sin caducidad, correos `payment.confirmed` y `subscription.activated`; misma `correlation_id` en todo |
| E3 | Conversión por el atajo del operador en live | se rechaza sin categoría ni motivo (cuando V3 lo implemente) |
| E4 | Pago inicial fallido (`async_payment_failed`, sesión expirada) | pedido sin activar; un único `es.payment.initial_failed` por sesión |
| E5 | Renovación mensual cobrada | `renewal.confirmed`; factura registrada (#157); impuesto contrastado (#156) |
| E6 | Impago → recordatorios → suspensión → recuperación | `past_due`; recordatorios a +3 y +6 días; `suspended` con licencias suspendidas; `payment.recovered` las reactiva; recordatorios pendientes pasan a `blocked:stale` |
| E7 | SCA (`payment_action_required`) | correo con el enlace a la factura alojada; sin cambio de estado |
| E8 | Cambio de plan en el Portal (subida inmediata y bajada programada) | con #158: plan, periodicidad y licencias; `plan.changed` y `plan.change_scheduled` |
| E9 | Módulo por operador (pedido `change` y `approve` live con #154) | partida, licencias y `module.activated`; baja programada → `validUntil` → `cancelled` por la tarea de revisión |
| E10 | Reembolso total y disputa perdida | retención, suspensión, `refund.issued`, rectificativa pendiente (#157); resolución que levanta la retención |
| E11 | Cancelación a fin de periodo | `cancel_scheduled`, después `cancelled`; `cancellation` y `subscription.ended`; acceso `read_only` uniforme |
| E12 | Repetición de eventos | reenviar el mismo evento de Stripe 3 veces y reiniciar el despachador a mitad: 0 duplicados en `domain_events`, `notifications` y `mail_outbox` |
| E13 | Fallo del proveedor | proveedor en error 5xx: el pago y la activación se mantienen; la notificación se reintenta y pasa a `dead` con alerta |
| E14 | Rebote y queja (webhook simulado) | supresión `all`; los siguientes T se bloquean con motivo; `unsubscribed` solo suprime M |
| E15 | Separación de entornos | un evento con `environment=live` en integración se rechaza y genera alerta |
| E16 | Separación por tenant | una notificación de A nunca usa datos, remitente ni cola de B |
| E17 | Modo off | con despachador encendido y `MAIL_MODE=off`: todo queda `skipped/mode_off`; nada sale |

---

## Anexo: eventos de Stripe que procesa hoy el webhook (18)

- `checkout.session.completed` · `.expired` · `.async_payment_succeeded` · `.async_payment_failed`
- `customer.subscription.created` · `.updated` · `.deleted` · `.paused` · `.resumed`
- `invoice.paid` · `.payment_failed` · `.payment_action_required`
- `charge.refunded` · `charge.refund.updated`
- `charge.dispute.created` · `.updated` · `.closed` · `.funds_reinstated`

El procesador relee el objeto en la API de Stripe: el resultado depende del estado, no del tipo de evento.

**Para la tarjeta a punto de caducar (P2)** haría falta añadir `customer.source.expiring` o una consulta periódica de los métodos de pago. Para el aviso de renovación anual bastaría con `invoice.upcoming`. Cualquier evento nuevo exige actualizar el webhook en Stripe live, una operación que autoriza el propietario.
