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
- `POST /orders/review` (acción explícita; nada la programa) recupera pedidos confirmados o con pago
  verificado que no llegaron al final, aplica fines de periodo, impagos y cancelaciones en cascada.

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

## Configuración

| Variable | Efecto |
|---|---|
| `CP_ORCHESTRATOR_ENABLED=1` | Monta `/orders` (requiere CRM, web, suscripciones, licencias y la migración 0010) |
| `CP_PAYMENTS_PROVIDER=simulated` + `CP_PAYMENTS_TEST_WEBHOOK_SECRET` (≥ 32 caracteres) | Pagos de prueba y webhook firmado |
| `CP_PAYMENTS_AUTO_CHARGE` | No autorizado: si se activa, el servicio no arranca |

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
- Programar `review` (hoy es una acción explícita).
- Cambio simultáneo de plan y periodicidad: en dos pedidos.
