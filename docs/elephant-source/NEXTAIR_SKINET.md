# Nextair SL — SkiNet: contratación real desde admin.bigelephant.es

Decisión del propietario (27/10/2026): la contratación y los cobros reales de Big Elephant se centralizan en **production (`admin.bigelephant.es`) con la cuenta Stripe Live de Big Elephant**. No se usa el CRM de live como administrador comercial y no hay fase previa en sandbox. Circuito técnico: [CLIENTES_EXTERNOS.md](CLIENTES_EXTERNOS.md).

## 1. Stripe Live en production (comprobado el 28/10/2026)

Controlplane de production desplegado con Stripe **montado en modo live** (registro de arranque: `ctx="Stripe" mounted=true mode="live"`, `ctx="External" mounted=true liveCharges=true`).

| Variable (controlplane de production) | Valor |
|---|---|
| `CP_STRIPE_MODE` | `live` |
| `CP_STRIPE_API_KEY` | clave **restringida** `rk_live_…` (sin permiso de webhooks: mínimo privilegio) |
| `CP_STRIPE_WEBHOOK_SECRET` | `whsec_…` del endpoint de production |
| `CP_STRIPE_NAMESPACE` | `live` (fijado por modo en `stripe_sync_state` como `namespace:live`) |
| `CP_STRIPE_CHECKOUT_ENABLED` | `0`: Checkout de planes SaaS cerrado hasta decidir la política fiscal |
| `CP_STRIPE_WORKER_ENABLED` | `1`: conciliación cada 15 minutos y evaluación del día 5 |
| `CP_EXTERNAL_LIVE_ENABLED` | `1`: cobros reales de servicios externos habilitados |

El entorno live ya no tiene Stripe. Los tres pedidos de prueba con pagos simulados se cerraron (28/10/2026) con las transiciones de la aplicación.

**Precisión real del cobro.** La suscripción de Stripe se crea con `trial_end` = 01/11/2026 08:00 (Madrid). A esa hora Stripe genera la factura y la cobra al finalizarla, normalmente **en torno a una hora después** (hacia las 09:00). Elephant registra el cobro al llegar el webhook (inmediato) o, si no llega, en la siguiente conciliación (como máximo 15 minutos). No se promete la ejecución al segundo.

**Periodo de cada cobro.** Sale de las líneas de la factura (periodo del servicio: 01/11 → 01/12). El `period_start` de una factura de suscripción de Stripe mira un periodo atrás y no se usa (#396).

## 2. Webhook en la cuenta Stripe Live

- **URL:** `https://admin.bigelephant.es/cp/v1/stripe/webhook` (activo: rechaza avisos sin firma con 400).
- **Configurados hoy:** 10 eventos. La clave restringida no puede leer la configuración de webhooks, así que la lista exacta se comprueba en el Dashboard.
- **Que gestiona el código (21):** `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `customer.subscription.pending_update_applied`, `customer.subscription.pending_update_expired`, `invoice.paid`, `invoice.voided`, `invoice.payment_failed`, `invoice.payment_action_required`, `charge.refunded`, `charge.refund.updated`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_reinstated`.
- **Imprescindibles para Nextair:** `checkout.session.completed` (tarjeta autorizada → suscripción), `customer.subscription.updated`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded` y `charge.dispute.created`.
- **Lo que no esté suscrito no se pierde:** la conciliación lee la API de eventos cada 15 minutos y registra todos los tipos gestionados. Añadir los que falten solo quita ese retraso.
- El **secreto de firma** va en `CP_STRIPE_WEBHOOK_SECRET`.

## 3. Ajustes de la cuenta Stripe Live (Dashboard)

- **Datos de la empresa**, que aparecen en las facturas de Stripe (Ajustes → Datos de la empresa): razón social, NIF y domicilio de Big Elephant.
- **Reintentos**, dentro del margen del día 1 al 5 (Ajustes → Facturación → Recuperación de ingresos): reintentos inteligentes con la última tentativa antes del día 5, y correos al cliente de pago fallido y de tarjeta caducada.
- **Portal del cliente** (Ajustes → Facturación → Portal del cliente): activado, con historial de facturas y actualización del método de pago. **Cancelación desactivada en el portal**: la baja se pide conforme al contrato, con preaviso.
- **Stripe Tax:** no hace falta para este cliente. El IVA del 21 % se aplica con un tipo fijo, que Elephant crea solo si no existe uno igual.

## 4. Contrato de Nextair SL

En Comercial → Empresas → **Nextair SL**:

1. Comprueba la ficha: **NIF** y **domicilio fiscal** completos. Con domicilio en la Península o Baleares, el IVA es el 21 %. En Canarias, Ceuta o Melilla habría que revisarlo antes.
2. **Nueva contratación de servicio externo**, con estos valores:

| Campo | Valor |
|---|---|
| Clave del servicio | `skinet` |
| Nombre | `SkiNet — Servicio tecnológico gestionado` |
| Cuota mensual (sin IVA) | `1000` € |
| IVA | `21` % |
| Día de cobro | `1` |
| Primer vencimiento | `2026-11-01` |
| Margen de pago | `5` días |
| Referencia externa | `skicenter:nextair` |

**Condiciones del servicio** (texto que se pega en el formulario):

```
Objeto. Big Elephant presta a Nextair SL el servicio tecnológico gestionado SkiNet sobre la plataforma Skicenter, cuya
infraestructura es externa a Elephant Source y propiedad o responsabilidad de Nextair SL en los términos acordados.

Servicio en curso. El servicio SkiNet ya está operativo y se viene prestando a la fecha de firma. Este contrato
formaliza su prestación y establece su facturación mensual a partir de la mensualidad de noviembre de 2026; no se
facturan periodos anteriores.

Alcance. Mantenimiento correctivo y evolutivo, soporte técnico y operación del servicio según lo acordado entre las
partes.

Duración y baja. Duración indefinida desde la firma. Cualquiera de las partes puede resolverlo con un preaviso de
30 días naturales, por escrito; la baja surte efecto al final de la mensualidad en curso, sin devolución de la
mensualidad ya facturada.

Pago. Cuota mensual por anticipado el día 1 de cada mes mediante el método de pago autorizado en Stripe. El impago no
detiene por sí solo la infraestructura del cliente; las partes resolverán las incidencias de cobro de buena fe.
```

3. Las condiciones económicas (1.000 € + IVA 210 € = 1.210 € al mes, día 1, primer cargo el 01/11/2026 y margen hasta el día 5) se añaden solas al contrato. Lo aceptado es exactamente ese texto, con su versión y su huella.

## 5. Envío y activación

0. **Ficha de la empresa.** El 28/10/2026 **no existe Nextair en el CRM de production**: hay que crearla con su razón social, NIF y domicilio fiscal reales (no se inventan).
1. **Envío del contrato.** En la ficha de la contratación, «Enviar contrato» con el nombre, el correo y el cargo del representante. Con la casilla «Enviar el contrato por correo» marcada, el Core lo envía con la plantilla corporativa (#398) y el historial guarda el estado del correo. **El correo de production está en modo sandbox**: hasta que se active el correo real, solo llega a las direcciones autorizadas y el CRM lo indica; el enlace siempre queda disponible para enviarlo por otro canal.
2. **Aceptación.** Cuando acepte, la contratación pasa a «Pendiente de autorizar el pago» y el equipo recibe un aviso interno.
3. **Autorización de la tarjeta.** «Generar enlace de autorización de pago»: el representante registra la tarjeta en Stripe sin ningún cargo.
4. **Primer cargo.** Stripe cobra 1.210 € el **01/11/2026** (factura a las 08:00 de Madrid, cobro al finalizarla, hacia las 09:00) y después cada día 1. Si la tarjeta se autoriza después del 1 de noviembre, no se cobra noviembre automáticamente: la contratación queda en «Decisión pendiente».
5. **Margen de 5 días.** Si el cobro falla, «Pago pendiente» hasta el día 5 a las 23:59 (Madrid), con los reintentos de Stripe sobre la misma factura; cumplido el margen, una alerta interna por factura. El servicio de Nextair no se detiene automáticamente.
6. **Factura legal.** El cobro queda registrado con sus referencias (`external:<id>`, `stripe:in:<factura>`) para el módulo de facturación (#395). Mientras no esté decidido el sistema de facturación legal (DF-2), la factura de noviembre se emite fuera del sistema con la referencia del cobro.
