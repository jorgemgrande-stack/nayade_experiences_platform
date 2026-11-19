# Cobros con la cuenta Stripe de cada empresa (preparado, desactivado)

Estado: **diseño aprobado para implementar; ningún cobro activo.** Primer caso: Quantum Soulrise (cuenta de Indira, aún sin facilitar).

## Reglas que no se rompen

1. **Una cuenta Stripe por empresa.** El dinero de los productos de una empresa va a su cuenta, nunca a la de Big Elephant. La cuenta de Big Elephant solo cobra suscripciones y licencias (`server/commercialTerms/stripe*`, `server/finance/stripe*`): no se toca ni se reutiliza para productos de empresas.
2. **Sin cuenta verificada, sin cobro.** Mientras la empresa no tenga su cuenta conectada y verificada, el cobro online no existe: el circuito sigue siendo solicitud → presupuesto → aceptación → cobro manual registrado con motivo (ya publicado, #865/#866).
3. **Sin inscripción confirmada por un cobro no confirmado.** La inscripción solo pasa a «confirmada por pago» con el evento firmado de Stripe, nunca por la redirección del navegador.
4. **Nada duplicado.** Cada cobro y cada evento se aplica una sola vez (claves de idempotencia).
5. Los secretos (claves, secretos de webhook) viven en el almacén de secretos de la plataforma, cifrados, por empresa; nunca en la base de datos de la empresa en claro, nunca en registros ni en el cliente.

## Arquitectura

**Conexión (Stripe Connect, cuenta de la empresa).** La empresa conecta su propia cuenta desde Ajustes › Cobros mediante el flujo de alta de Stripe (Account Link). La plataforma guarda solo el identificador de la cuenta (`acct_…`) y el estado (`no_conectada | pendiente | verificada | restringida`) leído de Stripe (`charges_enabled`, `payouts_enabled`, `requirements`). El estado se refresca por webhook `account.updated` y a demanda; no se confía en lo que diga el navegador.

**Dónde vive.** Registro por empresa en el plano de control (alcance de empresa, aislado como el resto): `tenant_payment_accounts(tenant_id, provider='stripe', account_id, status, charges_enabled, payouts_enabled, connected_at, verified_at, disabled_reason)`. Migración **aditiva** cuando se implemente. Un interruptor por empresa, `payments_online_enabled`, apagado por defecto y que solo se puede encender si el estado es `verificada`.

**Cobro.** Se reutiliza el cobro por presupuesto del CRM (`quotes`, plan de pagos e importes congelados): el enlace de pago de un presupuesto aceptado crea una sesión de Checkout **en la cuenta de la empresa** (`Stripe-Account: acct_…`), con importe y moneda leídos del presupuesto, nunca del navegador. Comisión de plataforma: ninguna hasta nueva decisión (si se añade, `application_fee_amount` aparte y visible).

**Confirmación (webhook de Connect).** Un endpoint propio recibe los eventos de las cuentas conectadas:
- verifica la firma con el secreto del endpoint Connect;
- resuelve la empresa por `event.account` (cuenta desconocida → 200 sin efecto y alerta);
- aplica `checkout.session.completed` (con `payment_status = paid`) y `payment_intent.succeeded` al presupuesto y a su cuota, registra el pago en el presupuesto y confirma la inscripción **una sola vez**;
- idempotencia: tabla de eventos procesados por `event.id`; reintentos de Stripe no duplican nada;
- reembolsos y disputas (`charge.refunded`, `charge.dispute.*`) marcan el pago y generan aviso interno, sin borrar inscripciones solos.

**Inscripción y planificación.** No cambian: la inscripción ya cuelga del presupuesto y lleva sus sesiones (#865). El cobro online solo sustituye al «cobro manual con motivo» como prueba de pago.

## Implementación de la entrega 1 (cambios respecto al diseño)

Procedimiento y estado: [docs/runbooks/COBROS_STRIPE_EMPRESA.md](../runbooks/COBROS_STRIPE_EMPRESA.md).

- **Dónde vive el registro.** En la **BD de cada empresa** (migración 0080: `payment_accounts`, `payment_events`,
  `payment_checkouts`), no en el plano de control: el Core lee el registro con un usuario de SOLO LECTURA y no puede
  escribirlo, y es el Core quien aplica el cobro al presupuesto. Una fila por modo (`test` = Prueba, `live` = Real).
- **Webhook.** Un único destino central en el Core (`POST /api/stripe/connect/webhook`), montado antes de resolver la
  empresa. La empresa sale del metadato `tenant_id` que pusimos nosotros (cuenta y sesión) **y solo se aplica si
  `event.account` es exactamente la cuenta que esa empresa tiene vinculada**: el metadato no es una autoridad, solo
  dónde buscar. Idempotencia por `event.id` y por sesión (`pending → paid` atómico). Un evento que falla al aplicarse
  queda `failed` y es reintentable.
- **Cuenta.** Se crea con `controller` (panel completo de Stripe para la empresa, comisiones y pérdidas a su cargo), no
  con una clave por empresa: la plataforma usa su clave Connect (`CONNECT_STRIPE_*`, separada de `CP_STRIPE_*`) y la
  cabecera `Stripe-Account`. Los cobros reales (`live`) se rechazan al arrancar.
- **Cobro.** Se reutiliza `crm.quotes.confirmPayment` para facturar y cerrar el presupuesto (misma lógica que el
  cobro manual). Pago único; los planes de cuotas quedan fuera de esta entrega.

## Qué hace falta de Indira (y no se puede adelantar)

- Su cuenta Stripe (alta en Stripe con sus datos fiscales y bancarios; no los vemos ni los pedimos).
- Confirmar moneda (EUR), si cobra IVA y cómo, y las condiciones de reembolso por producto.

## Orden de implementación

1. Registro de cuenta por empresa + interruptor (migración aditiva) + pantalla «Cobros» solo de estado.
2. Alta de cuenta con Account Link y lectura de estado (modo prueba de Stripe, cuenta de prueba de la empresa).
3. Webhook Connect con idempotencia y pruebas de firma, duplicados y cuenta desconocida.
4. Sesión de Checkout desde el enlace de pago del presupuesto, en la cuenta de la empresa.
5. Verificación con la cuenta real de Indira en modo prueba; después, activación explícita autorizada.

Hasta el paso 5 no se activa ningún cobro real. Stripe y sus cobros son de su ventana responsable: los pasos 1–4 se implementan sin tocar la lógica de la facturación de Big Elephant.
