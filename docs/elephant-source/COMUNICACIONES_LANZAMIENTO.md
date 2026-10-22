# Comunicaciones del lanzamiento de Elephant Source

**Estado (20/10/2026).** La matriz de §2 se genera desde el catálogo del código (`server/notifications/catalog.ts`), así que documentación y realidad no se separan.

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

## 5. Sistema transaccional completo (21/10/2026)

**Matriz detallada**, con asunto, momento, condiciones, prioridad, variables, CTA, reintentos, idempotencia y estado de cada aviso: `MATRIZ_COMUNICACIONES.md`. Se genera desde el código con `scripts/mail/matrix.ts`.

### Diseño común (todas las plantillas)

- **Maquetación** con tablas, compatible con Outlook, Gmail, Apple Mail y móviles. Ancho de 600 px y estilos en línea.
- **Texto previo de la bandeja de entrada:** el primer párrafo de cada aviso.
- **Cabecera:**
  - avisos de plataforma: logotipo oficial (`MAIL_LOGO_URL`; por defecto `https://www.bigelephant.es/brand/big-elephant-logo.png`, solo https);
  - avisos de una empresa: su nombre, sin logotipo ni datos de la plataforma.
- **Tarjeta** con acento rojo de la marca, título y botón grafito con buen contraste. La dirección del botón se repite como texto, para cuando el botón no funciona.
- **Pie** con el aviso transaccional («No es publicidad»), el soporte si está configurado y, en plataforma, el emisor: IRON ELEPHANT CONSULTING, S.L., con su NIF y su domicilio.
- **Versión de texto** equivalente. Cada valor dinámico se escapa y los enlaces solo pueden ser https.
- **Aviso de seguridad del Core** (contraseña cambiada): migrado al diseño común, con la marca de la empresa (`server/mail/securityTemplates.ts`).

### Calendario de la prueba gratuita (15 días)

| Día | Aviso |
|---|---|
| 0 | Verificación del correo y, al verificar, bienvenida con la fecha de fin |
| 8 (quedan 7) | **Nuevo:** recordatorio de 7 días |
| 12 (quedan 3) | Recordatorio de 3 días |
| 14 (queda 1) | Recordatorio de «termina mañana» |
| 15 | Fin de la prueba: solo lectura, sin borrar nada, con «Ver planes» |

**Reglas:**
- un aviso por umbral y fecha de fin;
- si la tarea estuvo parada, solo se envía el aviso más cercano;
- una ampliación de la prueba vuelve a avisar del nuevo fin;
- una prueba convertida o suspendida no recibe avisos;
- una sola réplica envía, gracias al bloqueo con nombre en la base de datos.

La tarea está apagada salvo `CP_TRIALS_SCHEDULER_ENABLED=1`.

### Lo pedido frente a lo que hay

| Proceso | Comunicación | Estado |
|---|---|---|
| Registro | Bienvenida (prueba, alta asistida, contratación confirmada) | ✅ Existente |
| Registro | Verificación de dirección | ✅ Existente |
| Registro | Recuperación de contraseña (Core y operadores) | ✅ Existente |
| Registro | Contraseña modificada | ✅ **Corregida:** diseño común |
| Registro | Invitación a la empresa | ✅ Existente (Core) |
| Registro | Cambio de email | ⏸️ **Pendiente:** el producto no permite cambiar el correo de acceso |
| Prueba gratuita | Inicio, 3 días, 24 horas y fin, con instrucciones para contratar | ✅ Existente |
| Prueba gratuita | 7 días | ✅ **Nuevo** |
| Suscripción | Activada, renovada, cambio de plan, cancelación solicitada, cancelación efectiva, reactivación | ✅ Existentes |
| Pagos | Confirmación, factura disponible, pago rechazado (día 0) y recuperación | ✅ Existentes |
| Pagos | Actualizar el método de pago: reintentos y tarjetas a punto de caducar | ✅ Delegado en Stripe (sin duplicar) |
| Ciclo de vida | Inicio y fin de la solo lectura | ✅ Existentes |
| Ciclo de vida | Exportación lista o fallida | ⏸️ **Pendiente:** la exportación tiene backend (`dataExport.*`), pero **no tiene pantalla** en la aplicación. Un correo invitaría a una acción que la interfaz no ofrece |
| Ciclo de vida | Solicitud y confirmación de eliminación | ⏸️ **Pendiente:** no existe la función. La supresión se hace hoy a mano |
| Seguridad | Contraseña cambiada | ✅ Existente |
| Seguridad | Inicio de sesión nuevo y segundo factor | ⏸️ **Pendiente:** el Core no detecta dispositivos ni tiene segundo factor para los clientes |
| Interno | Incidencias críticas de envío, fallos de procesos esenciales y avisos de facturación para revisión | ✅ Existentes (`ops.incident`) |
| Interno | Quejas de spam y rebotes permanentes repetidos | ✅ **Nuevo:** `mail.complaint` (una queja basta) y `mail.hard_bounce` (5 en una hora) abren una incidencia deduplicada |

### Trazabilidad y vista previa

**Plano de control** (requieren `ops:read`):

| Ruta | Qué devuelve |
|---|---|
| `GET /cp/v1/mail/outbox` | Avisos de plataforma con filtros (estado, plantilla, empresa) y paginación |
| `GET /cp/v1/mail/outbox/:id` | Detalle e historial, incluidos los eventos del proveedor: entrega, rebote, queja y baja |
| `GET /cp/v1/notifications/preview` y `/:id` | Vista previa con datos ficticios |

Nunca devuelven la dirección completa ni el cuerpo del mensaje: solo la dirección enmascarada.

**CRM:** Atención al cliente → **Comunicaciones**.
- Pestaña **Catálogo:** cada aviso, con su vista previa en un marco aislado y su versión de texto.
- Pestaña **Envíos:** la bandeja de plataforma, con filtros, paginación y el historial de cada envío.

**Galería estática:** `pnpm exec tsx scripts/mail/preview.ts <carpeta>`.

**Correos de las empresas:** sus envíos quedan en la bandeja de cada empresa (su propia base de datos) y no se muestran en el CRM. Así se mantiene la separación entre empresas.

### Postmark

**Ya configurado:**
- webhook 26051423, con la cabecera `x-elephant-webhook-token` y los eventos Delivery, Bounce, Spam Complaint y Subscription Change;
- dominio con DKIM y Return-Path verificados;
- los avisos de plataforma llevan la referencia opaca en `Metadata`, que vuelve en cada evento.

**Para activar** (en este orden):
1. Desplegar `crm` y `controlplane`. Pendiente por la incidencia de Railway.
2. Que Postmark apruebe la cuenta: hoy sigue en Test mode.
3. `MAIL_MODE=sandbox` con buzones propios para probar.
4. `MAIL_MODE=live` y `MAIL_LIVE_AUTHORIZED=1`, con tu autorización.
