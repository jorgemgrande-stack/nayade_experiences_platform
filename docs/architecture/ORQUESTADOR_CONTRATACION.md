# Orquestador comercial de la contratación

Código: `server/orchestrator/` (servicio, máquina de estados, almacén, pagos de prueba y API).
Migración: `db/crm/migrations/0010_commercial_orders` (BD del CRM). Pruebas:
`server/orchestrator.test.ts`, `server/controlPlane.orchestrator.test.ts`, `server/orchestrator.mysql.test.ts`.

## Para qué

El plano de control ya tenía todas las piezas (CRM, cotizador, suscripciones, licencias por capacidad,
prueba gratuita y aprovisionamiento), pero tras el contrato cada paso era una llamada manual
(huecos documentados en `server/controlPlane.contractingFlow.test.ts` y en el PR #101). El orquestador
las encadena con un **pedido** que recorre:

```
Solicitud → Cotización → Contrato → Confirmación → Suscripción → Licencia → Activación
requested    quoted       contracted  confirmed     subscribed    licensed   active
```

y, una vez activo:

```
active ⇄ past_due (impago, 7 días de gracia) → suspended (reversible al pagar)
active | past_due | suspended ─cancel→ cancel_scheduled ─(fin de periodo)→ cancelled
active | past_due | suspended | cancel_scheduled ─(cambio de plan activado)→ superseded
requested | quoted | contracted ─reject→ rejected
```

Las transiciones están en `server/orchestrator/machine.ts`; ninguna otra es posible. Cada cambio de
estado, y también cada hecho sin cambio de estado (pago solicitado, fallo de un paso, renovación),
queda como evento con versión (`commercial_order_events`).

## Tipos de pedido

| Tipo | Origen | Qué hace |
|---|---|---|
| `new` | Solicitud de la web (`leadRequestId`, con el lead ya convertido) o empresa (`companyId`) | Contrato nuevo, alta de la plataforma, suscripción nueva |
| `trial_conversion` | Prueba gratuita (`trialId`) | Contrato nuevo y conversión de la MISMA suscripción y plataforma de la prueba |
| `change` | Pedido activo (`changeOf`) | Renovación del contrato con la nueva configuración y cambio sobre la suscripción viva |

La configuración del formulario web (`{plan, extensions, industries, interests}`) se traslada al pedido
y de ahí al contrato como petición del cotizador `{plan, interval, items}`: extensiones y sectoriales
son productos; los intereses (hoja de ruta) no se contratan. La periodicidad, si la web no la indica,
es mensual.

## Reglas

1. **Nada se activa por una solicitud.** Crear un pedido solo cotiza (catálogo publicado, en el
   servidor) y prepara el contrato en borrador. Lo «Próximamente» bloquea la cotización.
2. **Contrato**: la aceptación (`/accept`) registra la firma (`signatureRef`) y, si hay productos
   «bajo solicitud», exige el motivo de aprobación (regla del CRM).
3. **Confirmación**: lo ÚNICO que autoriza activar licencias de pago es
   - un **pago verificado**: evento `payment.succeeded` firmado por el proveedor de pruebas, con
     importe y moneda iguales a los del pago;
   - una **aprobación administrativa registrada** (`/approve`, ámbito propio `orders:approve`, con
     responsable y motivo);
   - en un cambio **sin importe a pagar que no añade ninguna capacidad** (bajada), la base del pedido
     al que sustituye (`inherited`, comprobada de forma recursiva).
   La comprobación se repite antes de crear la suscripción y antes de conceder licencias
   (`paidBasis`). Las licencias de una **prueba válida** las sigue concediendo la propia prueba, con
   caducidad al final; el orquestador no las toca hasta la confirmación.
4. **Suscripción**: alta desde el contrato (cliente nuevo, tras dar de alta la plataforma), conversión
   de la prueba en una sola operación (`SubscriptionService.convertTrial`: enlaza el contrato, termina
   la prueba y sustituye las partidas por las acordadas con su precio aprobado) o cambio (plan: subida
   inmediata y bajada a fin de periodo; complementos; periodicidad a fin de periodo) y enlace de la
   suscripción con el contrato de renovación (`linkContract`). Periodicidades mixtas: un plan anual
   lleva sus complementos mensuales (regla del motor).
5. **Licencias**: solo capacidades (`LicensingService.apply`). Los entitlements por módulo del motor
   anterior no se tocan: los contratos con configuración no llevan módulos.
6. **Activación**: contrato activo (la activación del CRM es idempotente con la plataforma ya creada),
   prueba convertida y, en un cambio, contrato anterior cancelado («Sustituido por…») y pedido anterior
   `superseded`.

## Idempotencia, reintentos y recuperación

- Alta del pedido idempotente por clave (`idempotencyKey` o cabecera `Idempotency-Key`); la misma clave
  con otro contenido → 409. La BD impide un segundo pedido de alta/conversión abierto por empresa y un
  segundo cambio en curso por suscripción (columnas generadas únicas).
- Cada paso se apoya en lo ya persistido: contrato del pedido, suscripción viva del contrato, licencias
  ya aplicadas (aplicar dos veces no cambia nada). `POST /orders/:id/advance` reanuda desde el paso
  pendiente; un fallo queda como `step_failed` con `attempts` y `lastError`.
- Pagos idempotentes por clave (`ord:<pedido>:<propósito>:a<intento>`; renovación:
  `ord:<pedido>:renewal:<inicio del periodo>`). Un nuevo intento solo tras un fallo.
- Cada evento del proveedor se registra una sola vez (clave primaria) en la MISMA transacción que su
  efecto sobre el pago. Duplicados → `duplicate`; eventos tardíos sobre un pago ya confirmado →
  `ignored`; importe, moneda o pago desconocidos → `rejected`. El efecto sobre el pedido va después:
  si falla, `review` lo retoma.
- `POST /orders/review` (acción explícita; también la lanza el motor de ciclo de vida si está encendido) recupera
  pedidos confirmados o con pago verificado que no llegaron al final, aplica fines de periodo, impagos y
  cancelaciones en cascada. No espera entre reintentos, pero nunca reintenta un fallo definitivo o agotado.

### Recuperación automática de la activación (`server/orchestrator/recovery.ts`)

- Solo pedidos en `confirmed`, `subscribed` o `licensed` (cobro verificado, aprobación registrada o herencia). Un
  cobro rechazado, caducado o revertido nunca avanza: cada paso repite `paidBasis` y la retención de Stripe.
- Cada fallo queda en `step_failed` con `transient` y `retryable` (sin migración). Transitorios: red, tiempo
  agotado, bloqueos de MySQL, `conflict`/`version_conflict`/`unavailable`, HTTP 408/429/5xx y errores desconocidos.
  Definitivos: `invalid_input`, `invalid_state`, `not_found`, `forbidden` (este último, no reintentable), HTTP 4xx y
  errores de programación.
- Esperas tras cada fallo: 1, 5, 15 y 60 minutos y después 6 horas; agotado al 10.º fallo o si el siguiente
  reintento pasaría de 72 h desde la confirmación. Definitivo o agotado = «Error de activación» en el panel.
- Idempotencia: suscripción viva única por contrato (BD y memoria), cambios ya aplicados detectados (partidas
  vigentes, bajada de plan ya programada, periodicidad pendiente, enlace del contrato), licencias por diferencia y
  contrato ya activo. Ningún paso cobra. Dos avances del mismo pedido en un proceso se serializan; entre réplicas,
  la versión optimista decide.
- Tarea frecuente (`CP_ORDERS_RECOVERY_INTERVAL_MS`, por defecto 1 min, mínimo 30 s): reanuda los reintentos
  vencidos y los pedidos en activación sin fallos parados más de 2 minutos.
- Conciliación de respaldo (`CP_ORDERS_RECONCILE_INTERVAL_MS`, por defecto 24 h; también a los pocos minutos de
  arrancar): reanuda todas las activaciones reanudables sin esperar y revisa los pedidos sin ningún pago en
  `requested`, `quoted` o `contracted` sin cambios en `CP_ORDERS_EXPIRY_DAYS` días (por defecto 30). Con
  `CP_ORDERS_EXPIRY_MODE=report` (POR DEFECTO) solo registra cada candidato en el log (`expiry_candidate`: pedido,
  estado, días sin cambios y empresa; sin datos personales) y no cambia nada. Solo con `CP_ORDERS_EXPIRY_MODE=apply`
  los rechaza con `code: "expired"` («Pago caducado» en el panel). Cambiar estados comerciales exige decisión explícita.
- Botón «Reintentar»: `POST /cp/v1/commerce/tenants/:t/activation/retry` (`{ key? }`, token del Core con
  `commerce:purchase`). Solo pedidos de esa empresa en activación con algún fallo y base válida; 200 si ya está
  activo, 202 si se reanudó o hay otra ejecución en curso, 429 si se repite antes de 1 minuto por pedido (o de 5 s
  por empresa), 409 si no hay nada que reintentar.

## Pagos: solo modo pruebas

- Puerto `TestPaymentPort`; proveedor disponible: `SignedTestProvider` (reutiliza `SimulatedProvider`
  con idempotencia por clave y firma HMAC-SHA256 los webhooks: cabecera `x-test-signature: t=<s>,v1=<hex>`,
  comparación en tiempo constante y 5 minutos de tolerancia; solo `livemode: false`).
- El adaptador de Stripe del motor anterior no se reutiliza: cobra «off_session» a un cliente ya
  registrado y necesita credenciales de pruebas que no existen en este entorno.
- **Sin cobro automático**: no existe ningún cobro programado. `CP_PAYMENTS_AUTO_CHARGE` activado
  impide arrancar. Un pago empieza con una acción explícita (`POST /orders/:id/payments`, checkout de
  prueba) y solo el evento firmado lo da por pagado. La BD solo admite `mode = 'test'`.
- Webhook: `POST /cp/v1/payments/test/webhook` (sin token; firma obligatoria). Solo existe con
  proveedor configurado.

## Impago (regla mínima, sobre la del motor de facturación)

La regla existente (`server/_core/billing/service.ts`) es `active → past_due (7 días de gracia) →
suspended (reversible)`. El orquestador la aplica así:

- En cada renovación de un pedido pagado en línea se emite un recibo de prueba pendiente del periodo
  nuevo (importe de la simulación de facturación sombra), con vencimiento al inicio del periodo.
- Pago fallido (evento firmado) o recibo vencido sin pagar (al revisar) → `past_due` con 7 días de
  gracia; las licencias siguen activas.
- Fin de la gracia sin pago (al revisar) → `suspended`: las licencias de esa suscripción pasan a
  `suspended`. Los datos y la plataforma no se tocan.
- Pago verificado → `active` y licencias reactivadas.
- Pedidos confirmados por aprobación administrativa: sin recibos en línea (facturación fuera de la
  plataforma).

## Renovaciones y cancelación

- `POST /orders/:id/renew` aplica los periodos vencidos de la suscripción, reaplica licencias, deja
  constancia en el contrato («Periodo renovado…») y, si procede, emite el recibo de prueba. Así la
  renovación de la suscripción y la del contrato dejan de ir por separado.
- `POST /orders/:id/cancel`: contrato cancelado → suscripción con cancelación a fin de periodo →
  (al vencer, con `renew` o `review`) licencias `cancelled` y pedido `cancelled`. Nada se borra; la
  empresa puede volver a contratar sobre la misma plataforma.
- Un contrato cancelado directamente en el CRM se detecta en `review` y se cancela la suscripción en
  cascada.

## API (`/cp/v1`)

| Método y ruta | Ámbitos |
|---|---|
| `GET /orders`, `GET /orders/:id`, `GET /orders/payments/config` | `orders:read` |
| `POST /orders` (crear; cotiza y prepara el contrato) | `orders:write` |
| `POST /orders/:id/accept` (firma registrada) | `orders:write` |
| `POST /orders/:id/payments` (checkout de prueba) | `orders:write` |
| `POST /orders/:id/reject` | `orders:write` |
| `POST /orders/:id/approve` | `orders:approve` + `provisioning:write`, `subscriptions:write`, `entitlements:write` |
| `POST /orders/:id/advance`, `/renew`, `POST /orders/review` | `orders:write` + `provisioning:write`, `subscriptions:write`, `entitlements:write` |
| `POST /orders/:id/cancel` | `orders:write` + `subscriptions:write` |
| `POST /payments/test/webhook` | firma del proveedor de pruebas |

Roles de operador: lectura para todos los que leen; el comercial prepara pedidos (`orders:write`); la
aprobación sin pago y la activación quedan para administración.

## Motivo tipificado del rechazo

`reject` (y `POST /orders/:id/reject`) admite un `code` opcional además del texto `reason`: `payment_failed`,
`payment_reversed`, `payment_expired`, `expired` (pedido sin cobro vencido por inactividad), `activation`,
`conflict` o `manual`. Se guarda en el evento `reject` (`detail.code`, sin migración) y el detalle del pedido lo
expone como `rejectCode`. Los pedidos anteriores no lo tienen (el panel los trata como antes).

## Estado en el panel (`server/commerce/panelActivation.ts`)

Contrato aditivo de `activation` en el catálogo del panel (`GET /commerce/tenants/:t/catalog`):

| Pedido | `state` | `payment` | Otros |
|---|---|---|---|
| requested · quoted · contracted | pending | pending (failed si el último intento de cobro falló, con `error.kind` payment) | |
| confirmed · subscribed · licensed | processing | confirmed (cobro verificado) | `nextRetryAt` |
| active | active | confirmed | `renewal` active |
| past_due (gracia) | active | overdue | |
| suspended | suspended | overdue | sin acceso |
| cancel_scheduled | active | confirmed | `activeUntil` (Stripe `cancel_at` o fin de periodo; si no, la suscripción interna), `renewal` cancelled, `canReactivate` solo con `cancel_at_period_end` |
| módulo retirado con la partida vigente | active | — | `activeUntil` = `effectiveTo` de la partida, `renewal` cancelled |
| rejected (7 días) | error | failed (payment_failed/reversed) · expired (payment_expired/expired) | `error.kind` payment (activation con activation/conflict), `retryable` true |
| cancelled · superseded | none | — | |

## Configuración

| Variable | Efecto |
|---|---|
| `CP_ORCHESTRATOR_ENABLED=1` | Monta `/orders` (requiere CRM, web, suscripciones, licencias y la migración 0010) |
| `CP_PAYMENTS_PROVIDER=simulated` + `CP_PAYMENTS_TEST_WEBHOOK_SECRET` (≥ 32 caracteres) | Pagos de prueba y webhook firmado |
| `CP_PAYMENTS_AUTO_CHARGE` | No autorizado: si se activa, el servicio no arranca |
| `CP_ORDERS_RECOVERY_ENABLED=0` | Apaga la recuperación automática y la conciliación diaria (encendidas con los pedidos) |
| `CP_ORDERS_RECOVERY_INTERVAL_MS` | Intervalo de los reintentos (30 s – 1 h; por defecto 60 000) |
| `CP_ORDERS_RECONCILE_INTERVAL_MS` | Intervalo de la conciliación (1 h – 7 días; por defecto 24 h) |
| `CP_ORDERS_EXPIRY_DAYS` | Días sin cambios para vencer un pedido sin cobro (0 = no vencen; por defecto 30) |
| `CP_ORDERS_EXPIRY_MODE` | `report` (por defecto: solo registra los candidatos) o `apply` (los rechaza con `code: "expired"`) |

## Decisiones sobre los huecos del PR #101

| Hueco | Estado |
|---|---|
| 1. La configuración web no pasa al contrato | Resuelto: pedido desde la solicitud |
| 2. Oportunidad ganada ↔ contrato | Parcial: el contrato se enlaza con la oportunidad de la conversión; cerrarla como ganada sigue siendo manual |
| 3. Activar el contrato no crea suscripción ni licencias | Resuelto por el pedido |
| 4. Cambios de suscripción sin licencias | Resuelto para los cambios hechos con pedidos y en renovaciones; las rutas manuales `/subscriptions/*` siguen sin aplicar licencias |
| 5. Renovaciones independientes | Resuelto con `renew`/`review` (constancia en el contrato) |
| 6. Cancelar el contrato no cancela la suscripción | Resuelto (cascada en `cancel` y en `review`) |
| 7. Suscripción enlazada al contrato original | Resuelto: `linkContract` al contrato de renovación |
| 8. Entitlements y capacidades | Decisión: el orquestador solo usa capacidades |

## Pendiente

- Proveedor de pagos real (y su modo de pruebas con credenciales): requiere autorización.
- Interfaz en el CRM para los pedidos.
- Programar `review` completo: la recuperación de activaciones y el vencimiento ya son periódicos; el resto lo
  programa el motor de ciclo de vida cuando está encendido.
- Cambio simultáneo de plan y periodicidad: en dos pedidos.
