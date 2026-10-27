# Nextair SL — SkiNet: contratación real desde admin.bigelephant.es

Decisión del propietario (27/10/2026): la contratación y los cobros reales de Big Elephant se centralizan en **production (`admin.bigelephant.es`) con la cuenta Stripe Live de Big Elephant**. No se usa el CRM de live como administrador comercial y no hay fase previa en sandbox. Circuito técnico: [CLIENTES_EXTERNOS.md](CLIENTES_EXTERNOS.md).

## 1. Stripe Live en production

Se configura en Railway, proyecto **Elephant Source**, entorno **production**, servicio **controlplane** → Variables.

| Variable | Valor | Estado hoy |
|---|---|---|
| `CP_STRIPE_MODE` | `live` | Falta |
| `CP_STRIPE_API_KEY` | Clave **restringida** live `rk_live_…` (el código rechaza `sk_live_`) | Falta |
| `CP_STRIPE_WEBHOOK_SECRET` | `whsec_…` del endpoint del paso 2 | Falta |
| `CP_STRIPE_NAMESPACE` | `beta` (**no cambiarlo**: production ya lo tiene registrado en su base de datos y con otro valor Stripe no se monta) | Ya está |
| `CP_STRIPE_CHECKOUT_ENABLED` | `0`: el Checkout de planes SaaS sigue cerrado hasta decidir la política fiscal | Está a `1`: cambiar |
| `CP_STRIPE_WORKER_ENABLED` | `1`: conciliación y evaluación del día 5 | Ya está |
| `CP_EXTERNAL_LIVE_ENABLED` | **No crearla todavía**: es el interruptor protegido de los cobros reales | Ausente |

**Permisos de la clave restringida.** Se puede usar la misma clave que tiene hoy el entorno live si los incluye; si no, conviene crear una nueva («Elephant production») en Dashboard → Desarrolladores → Claves de API → Crear clave restringida:

| Permiso | Recursos |
|---|---|
| Escritura | Customers, Checkout Sessions, Subscriptions, **Products**, **Tax Rates**, Customer portal |
| Lectura | Invoices, Payment Methods, Setup Intents, Prices, Events, Charges, Disputes, Refunds |

**Stripe en el entorno live.** Hoy también usa esta misma cuenta, con el espacio de nombres `live`. No interfiere (cada entorno ignora los objetos del otro), pero para tener una única cuenta comercial en uso conviene retirarle `CP_STRIPE_API_KEY`, `CP_STRIPE_WEBHOOK_SECRET` y `CP_STRIPE_MODE` cuando production esté verificado.

## 2. Webhook en la cuenta Stripe Live

Dashboard (modo live) → Desarrolladores → Webhooks → Añadir endpoint.

- **URL:** `https://admin.bigelephant.es/cp/v1/stripe/webhook`
- **Eventos:** `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `customer.subscription.pending_update_applied`, `customer.subscription.pending_update_expired`, `invoice.paid`, `invoice.voided`, `invoice.payment_failed`, `invoice.payment_action_required`, `charge.refunded`, `charge.refund.updated`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_reinstated`
- El **secreto de firma** (`whsec_…`) va en `CP_STRIPE_WEBHOOK_SECRET`.

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

## 5. Envío y activación (mecanismos de autorización)

1. **Envío del contrato.** En la ficha de la contratación, «Enviar enlace de aceptación» con el nombre, el correo y el cargo de la representante. El CRM no envía correo automáticamente: el enlace se copia y se le envía.
2. **Aceptación.** Cuando acepte, la contratación pasa a «Pendiente de autorizar el pago».
3. **Cobros reales.** Se activan con `CP_EXTERNAL_LIVE_ENABLED=1` en el controlplane de production. Es un interruptor protegido, que activa el propietario. Sin él, el CRM no genera el enlace de Stripe.
4. **Autorización de la tarjeta.** «Generar enlace de autorización de pago»: la representante registra la tarjeta en Stripe sin ningún cargo.
5. **Primer cargo.** Stripe cobra 1.210 € el **01/11/2026 a las 08:00** (Madrid) y después cada día 1. Si la tarjeta se autoriza después del 1 de noviembre, no se cobra noviembre automáticamente: la contratación queda en «Decisión pendiente».
