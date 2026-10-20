# Comunicaciones del lanzamiento de Elephant Source

**Estado (22/10/2026).** La matriz de §2 se genera desde el catálogo del código (`server/notifications/catalog.ts`), así que documentación y realidad no se separan.

**Reglas comunes:**
- Todo sale por la **bandeja de salida**: idempotencia por clave, reintentos con espera, supresión de rebotes y límites, y trazabilidad (`mail_outbox` y `mail_events`).
- `MAIL_MODE=off` (valor por defecto): no sale nada y la fila queda `skipped`.
- Ninguna plantilla lleva tokens de acceso ni de recuperación. Los correos con enlaces de un solo uso (invitación, recuperación, bienvenida, verificación y aviso de seguridad) **nunca** llevan la copia global de la empresa (PR #185).
- **Idioma:** el producto está en **español**, que es también el idioma de respaldo. No hay otro idioma soportado: añadir inglés exige traducir las plantillas y la interfaz, y queda fuera del camino crítico.
- **Marca:** cabecera de Elephant Source, pie con el emisor y «No es publicidad» (plantilla `layout`).

## 1. Reparto con Stripe (sin duplicados)

| Comunicación | La envía | Configuración |
|---|---|---|
| Factura y recibo (PDF) | **Stripe** | Settings → Customer emails: «Successful payments» y «Finalized invoices». Elephant solo avisa de que está disponible (`billing.invoice_available`) |
| Pago que requiere autenticación (3DS) | **Stripe** | «Send a reminder when a payment requires 3D Secure» |
| Reintentos de cobro y recordatorios de impago | **Stripe** (Smart Retries) | «Send emails when card payments fail». Elephant avisa solo el día 0 (`subscription.payment_failed`) |
| Tarjeta a punto de caducar | **Stripe** | «Expiring cards» |
| Todo lo demás | **Elephant** | Tabla de §2 |

## 2. Matriz (generada del catálogo)

| Id | Disparador | Destinatario | Envía | Categoría | Variables | Estado |
|---|---|---|---|---|---|---|
| `trial.verification` | Alta de la prueba (TrialNotifier.verification) | Quien pidió la prueba | Elephant | `email_verification` | — | ✅ Notificador propio |
| `trial.started` | Prueba activada (TrialNotifier.welcome): bienvenida con fecha de fin | Quien pidió la prueba | Elephant | `trial_activated` | — | ✅ Notificador propio |
| `trial.reminder` | Motor temporal (D-16): 7, 3 y 1 días antes del fin | Quien pidió la prueba | Elephant | `trial_expiry` | — | ✅ Notificador propio |
| `trial.ended` | Motor temporal: aviso de vencimiento con 0 días (TrialNotifier.expiryNotice, plantilla trialExpiry) | Quien pidió la prueba | Elephant | `trial_expiry` | — | ✅ Notificador propio |
| `subscription.signup_received` | Pedido firmado en la web (orderNotifier: sign web-terms) | Contacto de facturación | Elephant | `signup_received` | — | ✅ Notificador propio |
| `subscription.contract_confirmed` | Pedido activado (orderNotifier: activate) | Contacto de facturación | Elephant | `contract_confirmed` | — | ✅ Notificador propio |
| `subscription.initial_payment` | Pago inicial verificado (orderNotifier: confirm basis=payment) | Contacto de facturación | Elephant | `payment_confirmed` | — | ✅ Notificador propio |
| `subscription.renewal_paid` | Renovación mensual o anual cobrada (orderNotifier: payment_recorded) | Contacto de facturación | Elephant | `renewal_confirmed` | — | ✅ Notificador propio |
| `subscription.payment_failed` | Impago (orderNotifier: payment_failed); día 0 de la gracia (D-15) | Contacto de facturación | Elephant | `payment_failed` | — | ✅ Notificador propio |
| `subscription.recovered` | Cobro recuperado o baja deshecha (orderNotifier) | Contacto de facturación | Elephant | `subscription_reactivated` | — | ✅ Notificador propio |
| `subscription.cancellation` | Baja programada (orderNotifier: cancel) | Contacto de facturación | Elephant | `cancellation` | — | ✅ Notificador propio |
| `subscription.payment_action_required` | invoice.payment_action_required: Stripe envía el enlace para autenticar el pago (3DS) | Contacto de facturación | **Stripe** | `payment_failed` | — | ✅ Delegado en Stripe |
| `subscription.dunning_reminder` | Reintentos de Stripe (Smart Retries): Stripe avisa de cada intento fallido; Elephant solo avisa el día 0 | Contacto de facturación | **Stripe** | `payment_failed` | — | ✅ Delegado en Stripe |
| `billing.invoice_document` | Factura y recibo de Stripe (PDF): los envía Stripe; Elephant solo avisa de que está disponible | Contacto de facturación | **Stripe** | `invoice_available` | — | ✅ Delegado en Stripe |
| `subscription.suspended` | Pedido suspendido (gracia vencida o cobro revertido) | Contacto de facturación | Elephant | `subscription_suspended` | reference, host | ✅ Despachador de eventos |
| `subscription.plan_changed` | Cambio de plan aplicado a la suscripción | Contacto de facturación | Elephant | `plan_changed` | plan, direction, effectiveFrom, host | ✅ Despachador de eventos |
| `subscription.ended` | Fin efectivo de la suscripción (pedido cancelado) | Contacto de facturación | Elephant | `subscription_ended` | reference, host | ✅ Despachador de eventos |
| `access.read_only_started` | Empieza el periodo de solo lectura (30 días tras el fin) | Contacto de facturación | Elephant | `access_read_only` | readOnlyUntil, host | ✅ Despachador de eventos |
| `access.read_only_ended` | Termina el periodo de solo lectura | Contacto de facturación | Elephant | `access_read_only` | host | ✅ Despachador de eventos |
| `module.purchase_requested` | Compra enviada a Stripe con cobro pendiente (purchases.ts: payment_pending) | Contacto de facturación | Elephant | `module_change` | productName, paymentUrl | ⏸️ Sin disparador |
| `module.activated` | Módulo añadido a la suscripción (tras cobro verificado o aprobación) | Contacto de facturación | Elephant | `module_activated` | productName, host | ✅ Despachador de eventos |
| `module.quantity_changed` | Ampliación aplicada o reducción programada (usuarios, sedes, almacenamiento) | Contacto de facturación | Elephant | `module_change` | metric, quantity, direction, effectiveFrom, host | ✅ Despachador de eventos |
| `module.removal_scheduled` | Baja de un módulo a fin de periodo | Contacto de facturación | Elephant | `module_change` | productName, effectiveTo, host | ✅ Despachador de eventos |
| `module.purchase_failed` | Compra no completada (el cambio caducó sin cobro) | Contacto de facturación | Elephant | `module_change` | reference, host | ✅ Despachador de eventos |
| `module.removal_effective` | Fin efectivo de la baja de un módulo (renovación) | Contacto de facturación | Elephant | `module_change` | productName | ⏸️ Sin disparador |
| `billing.invoice_available` | Factura de Stripe cobrada (orderNotifier) | Contacto de facturación | Elephant | `invoice_available` | — | ✅ Notificador propio |
| `billing.refund_recorded` | Reembolso registrado en Stripe | Contacto de facturación | Elephant | `refund_recorded` | amountCents, currency, full, host | ✅ Despachador de eventos |
| `billing.credit_note` | Rectificativa emitida por el sistema de facturación aprobado | Contacto de facturación | Elephant | `refund_recorded` | documentNumber | ⏸️ Sin disparador |
| `billing.incident` | Cobro revertido (reembolso total o disputa perdida) | Contacto de facturación | Elephant | `billing_incident` | host | ✅ Despachador de eventos |
| `support.ticket_received` | Ticket creado (TicketService → PlatformMailer.ticketNotifier) | Quien abrió el ticket | Elephant | `operational` | — | ✅ Notificador propio |
| `support.ticket_replied` | Respuesta pública del equipo (TicketService.comment, nunca las notas internas) | Quien abrió el ticket | Elephant | `operational` | — | ✅ Notificador propio |
| `support.ticket_resolved` | Ticket resuelto (TicketService.setStatus → resolved) | Quien abrió el ticket | Elephant | `operational` | — | ✅ Notificador propio |
| `support.ticket_reopened` | Ticket reabierto (TicketService.setStatus → open desde resolved) | Quien abrió el ticket | Elephant | `operational` | — | ✅ Notificador propio |
| `consumer.withdrawal_receipt` | Solicitud de desistimiento (WithdrawalService.request → withdrawalNotifier.receipt) | El particular | Elephant | `withdrawal_receipt` | — | ✅ Notificador propio |
| `consumer.withdrawal_resolution` | Resolución del desistimiento (WithdrawalService.decide: accept, reject o complete) | El particular | Elephant | `withdrawal_resolution` | — | ✅ Notificador propio |
| `ops.incident` | Incidencia operativa abierta, reabierta o escalada (IncidentService → incidentNotifier; incluye fallos de cobro rate:stripe.*) | Equipo (CP_ALERT_EMAIL) | Elephant | `operational` | — | ✅ Notificador propio |
| `ops.new_customer` | Pedido activado de alta o conversión (orderNotifier: activate) | Equipo (CP_ALERT_EMAIL) | Elephant | `operational` | — | ✅ Notificador propio |
| `ops.withdrawal_requested` | Solicitud de desistimiento registrada (withdrawalNotifier.receipt) | Equipo (CP_ALERT_EMAIL) | Elephant | `operational` | — | ✅ Notificador propio |
| `ops.ticket_created` | Ticket creado (ticketNotifier: received) | Equipo (CP_ALERT_EMAIL) | Elephant | `operational` | — | ✅ Notificador propio |
| `security.password_changed` | Contraseña restablecida en el Core (POST /api/auth/reset-password → passwordChangedEmail) | La propia persona | Elephant | `security_notice` | — | ✅ Notificador propio |
| `security.new_login` | Inicio de sesión desde un dispositivo nuevo | La propia persona | Elephant | `operational` | at, approximateLocation | ⏸️ Sin disparador |
| `security.mfa_changed` | Segundo factor activado o desactivado | La propia persona | Elephant | `operational` | at, enabled | ⏸️ Sin disparador |

**Del Core (bandeja de cada empresa, fuera del catálogo de plataforma):**

| Comunicación | Disparador | Destinatario | Estado |
|---|---|---|---|
| Invitación y activación de cuenta | Alta de usuario (`sendInviteEmail`), con enlace de un solo uso para crear la contraseña | El usuario invitado | ✅ Sin copia global |
| Recuperación de contraseña | `POST /api/auth/forgot-password` | La propia persona | ✅ Sin copia global |
| Contraseña cambiada | `POST /api/auth/reset-password` correcto | La propia persona | ✅ Nuevo; sin enlaces ni copia global |
| Avisos de límites y bloqueos por capacidad | Límites contratados (registro 0013) | — | Solo en la aplicación (mensaje al alcanzar el límite y página de suscripción). Sin correo: no bloquea el lanzamiento |

## 3. Sin disparador (no bloquean el lanzamiento)

| Id | Motivo |
|---|---|
| `billing.credit_note` | Depende de quién emite la factura legal (DF-2). Hoy la rectificativa queda `pending` |
| `module.purchase_requested`, `module.removal_effective` | El estado se ve en la página de suscripción; el correo es opcional |
| `security.new_login`, `security.mfa_changed` | Solo los operadores internos tienen segundo factor; el Core no detecta dispositivos |

## 4. Configuración para activar los envíos (no aplicada)

| Variable | Servicio | Uso |
|---|---|---|
| `MAIL_MODE=live` y `MAIL_LIVE_AUTHORIZED=1` | controlplane y core | Envío real (**con tu autorización**) |
| `MAIL_SENDING_DOMAIN=bigelephant.es` | controlplane y core | Remitente `no-reply@bigelephant.es` |
| `ELEPHANT_SUPPORT_EMAIL` | controlplane | Reply-To de los avisos de plataforma |
| `CP_ALERT_EMAIL` | controlplane | **Nuevo:** hasta 5 direcciones del equipo para incidencias, nuevos clientes, desistimientos y tickets |
| `CP_ALERT_WEBHOOK` | controlplane | Mismo aviso por webhook (opcional) |
| `CP_NOTIFICATIONS_SINCE` | controlplane | Corte del despachador de eventos |
| Proveedor | controlplane y core | Ver `CORREO_PROVEEDOR.md` |
