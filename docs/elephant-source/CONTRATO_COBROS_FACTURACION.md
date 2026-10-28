# Contrato de integración v1: cobros (Stripe) ↔ administración comercial, facturación y contabilidad

Versión 1 · 28/10/2026 · Redacta: ventana de administración comercial («Ventana 2»). Pendiente de validación de la ventana de cobros y Stripe.
Base leída: Core `integration/elephant-source` en `b31d4872`.

Este documento fija **interfaces estables** entre dos responsables, para que ninguno escriba en los ficheros, tablas o migraciones del otro. No cambia código.

## 1. Responsables

| Responsable | Es dueño de | No toca |
|---|---|---|
| **Cobros** (ventana de Stripe) | Stripe, webhooks, métodos de pago, ejecución de cargos y suscripciones, calendario de cobros, reintentos, conciliación de pagos y endpoints financieros del controlplane: `server/stripe/**` (salvo el modelo fiscal, §5), la parte de cobro de `server/external/**`, `server/orchestrator/**` (pagos) y las tablas `stripe_*` | Fichas, condiciones comerciales, ERP |
| **Administración** (Ventana 2) | Fichas de empresa, modalidad tecnológica, condiciones y precios negociados, cargos extraordinarios y gastos variables (preparación y aprobación), interfaz del administrador, contabilidad, ERP y **modelo de documento fiscal** (`FiscalDocument`, `FiscalDocumentSink`, emisión, series, PDF) | Stripe, webhooks, cargos, calendario |

**Reglas comunes**
- Cada cambio de interfaz sube la versión de este documento.
- Una migración tiene un solo autor y va en un commit aislado.
- Nadie fusiona un cambio que rompa una interfaz v1 sin el visto bueno del otro responsable.

## 2. Estado real que condiciona el diseño

1. **Servicios externos (Nextair):**
   - Contrato y aceptación: `server/external/service.ts`, tablas de `0026`.
   - Autorización sin cargo: `POST /external/:id/payment-setup`.
   - Suscripción de Stripe con primer cargo programado (`trial_end`).
   - Evaluación del margen del día 5: `POST /external/evaluate`.
   - Al cobrarse, se registra el evento `invoice_paid` (`service.ts:454`).
   - **No se encola ningún documento fiscal.**
2. **Cola fiscal** (`fiscal_documents`, `0016`):
   - Exige `order_id NOT NULL` (FK a `commercial_orders`) y `stripe_invoice_id NOT NULL`.
   - Los servicios externos no tienen pedido, así que **sus cobros no pueden entrar en la cola**.
   - Adaptador por defecto `pendingSink`: no emite nada (DF-2, el sistema de facturación legal, sigue sin decidir).
3. **Facturas de Stripe:** Stripe emite su propia factura del cargo. No se usa como factura fiscal española mientras DF-2 no confirme que sirve (numeración, series, datos del emisor, VeriFactu).
4. **Pagos de pedidos:** `PaymentPurpose` admite solo `initial`, `change` y `renewal`. No hay cargos puntuales con concepto libre.

**Consecuencia para el 01/11/2026:** el primer cargo de Nextair (1.210 €) quedará registrado en Stripe y en el historial de la contratación, pero **sin documento fiscal en la cola**. Antes de esa fecha hay que aplicar la interfaz I-8 (§4) y tener resuelto DF-2. Si no, la factura legal se emite fuera del sistema, a mano, con la referencia del cobro.

## 3. Identificadores comunes

| Clave | Formato | Quién la crea |
|---|---|---|
| `companyId` | `companies.id` del CRM | Administración |
| `agreementRef` | `contract:<crm_contract_id>:v<versión>` (contrato y versión aceptados) | Administración (contrato) |
| `billingRef` | `external:<external_subscription_id>` · `order:<commercial_order_id>` · `charge:<charge_id>` | El dueño del objeto |
| `paymentRef` | `stripe:in:<invoice_id>` · `stripe:ch:<charge_id>` · `offline:<referencia>` | Cobros |
| `fiscalSourceKey` | `<billingRef>|<paymentRef>` para facturas; `refund:<charge>:<importe>` para rectificativas | Quien encola (§I-8) |

Importes en **céntimos enteros, sin IVA**, con `taxRateBp` aparte. Fechas en ms UTC; la zona comercial es `Europe/Madrid`.

## 4. Interfaces v1

| # | Interfaz | Dirección | Estado |
|---|---|---|---|
| I-1 | **Crear autorización** (método de pago sin cargo): `POST /external/:id/payment-setup`. Requiere contrato aceptado y `CP_EXTERNAL_LIVE_ENABLED`. Para los planes SaaS, el Checkout | Administración → Cobros | Existe (externos) |
| I-2 | **Crear plan de cobros**: `POST /external` con `companyId`, servicio, `amountCents`, `taxRateBp`, `billingDay`, `firstChargeAt`, `graceDays` y condiciones. Administración aporta las condiciones negociadas; Cobros crea el calendario | Administración → Cobros | Existe |
| I-3 | **Programar cargo** recurrente: lo hace I-2 (suscripción de Stripe con `trial_end` = primer vencimiento). La precisión real la documenta Cobros | Cobros | Existe |
| I-4 | **Crear cargo puntual** (`ChargeRequest`, abajo): Administración prepara y aprueba; Cobros lo ejecuta (tarjeta autorizada o `offline_payment`) | Administración → Cobros | **Nuevo** |
| I-5 | **Consultar estado**: `GET /external/:id` y `GET /orders/:id`; cargos puntuales con `GET /charges/:id` (nuevo) | Administración ← Cobros | Existe / nuevo |
| I-6 | **Evento de cobro** (`BillingEvent`, abajo): Cobros lo publica una vez por hecho verificado (pago, fallo, reembolso, disputa); Administración lo consume para la factura y la contabilidad | Cobros → Administración | **Nuevo** |
| I-7 | **Anular cargo pendiente**: `POST /charges/:id/cancel`, solo si no se ha intentado cobrar; si no, `invalid_state` | Administración → Cobros | **Nuevo** |
| I-8 | **Emitir documento fiscal**: Cobros encola un `FiscalDocument` por cada `BillingEvent` de pago o reembolso con su `fiscalSourceKey` (idempotente); Administración lo emite con el `FiscalDocumentSink` aprobado | Cobros → Administración | **Ampliar** (§5) |
| I-9 | **Conciliar factura y pago**: Administración marca el documento emitido con `externalRef` y comprueba base, IVA y total frente al `BillingEvent`; un descuadre es una alerta, nunca una corrección automática | Administración | Ampliar |

```ts
// I-4 · versión 1
interface ChargeRequest {
  idempotencyKey: string;        // único por cargo; el reintento devuelve el mismo cargo
  companyId: number;
  agreementRef: string | null;   // contrato que lo ampara (null solo con aprobación expresa)
  billingRef?: string;           // contratación a la que se suma (external:… u order:…)
  concept: string;               // texto de la factura, máx. 200
  kind: "extraordinary" | "variable_cost";
  amountCents: number;           // > 0, sin IVA
  taxRateBp: number;
  dueAt: number;                 // ms; nunca antes de la aprobación
  method: "card_on_file" | "offline";
  approvedBy: string;            // operador con orders:approve
  detail?: { provider?: string; periodStart?: number; periodEnd?: number; costCents?: number; marginBp?: number };
}

// I-6 · versión 1
interface BillingEvent {
  id: string;                    // = paymentRef + tipo; idempotente
  type: "payment_succeeded" | "payment_failed" | "refunded" | "dispute_opened" | "dispute_closed";
  companyId: number;
  billingRef: string;            // external:… · order:… · charge:…
  paymentRef: string;            // stripe:in:… · stripe:ch:… · offline:…
  periodStart: number | null;
  periodEnd: number | null;
  currency: "EUR";
  baseCents: number;             // neto después de descuentos (invoiceNetCents)
  taxCents: number;
  totalCents: number;
  occurredAt: number;
}
```

## 5. Cola fiscal generalizada (I-8)

**Problema:** `fiscal_documents` exige un pedido y una factura de Stripe.

**Propuesta**, en una migración aislada que redacta Administración y valida Cobros antes de aplicarla:
- `order_id` pasa a `NULL` permitido;
- `stripe_invoice_id` pasa a `NULL` permitido;
- se añaden `company_id NOT NULL`, `billing_ref` y `payment_ref`;
- `source_key` sigue siendo único con `livemode`.

Las filas existentes no cambian: tienen pedido y factura.

**Quién hace qué**
- **Cobros:** sigue encolando como hoy los pedidos SaaS, y añade el encolado de los externos y de los cargos puntuales al verificar el pago (I-6).
- **Administración:** es dueña del adaptador (`FiscalDocumentSink`) y de la emisión: series, numeración, PDF, rectificativas y estado.

**Cuándo se emite la factura** (pendiente de confirmación profesional, DF-2):
- **Cuota mensual por anticipado:** al cobrarse, con fecha del cobro y periodo del mes.
- **Cobro fallido:** sin factura mientras no se cobre. Si las partes acuerdan facturar a vencimiento, se emite el día 1 y queda pendiente de cobro; es decisión comercial.
- **Reembolso:** rectificativa sobre el documento original (`originalDocumentId`).
- **Cargo extraordinario y gasto variable:** al cobrarse; los offline, al registrar el pago.

**No hay doble factura:** si el sistema de facturación ya emitió el documento (`externalRef`), un nuevo encolado con la misma `fiscalSourceKey` no crea otro.

## 6. Pruebas de integración acordadas

| Prueba | Dueño | Comprueba |
|---|---|---|
| Pago de un externo → exactamente un documento en la cola, con base 100.000, IVA 21.000 y total 121.000 | Cobros (encolado) y Administración (contenido) | I-6 e I-8, idempotencia ante el webhook duplicado |
| Reintento del mismo `ChargeRequest` | Cobros | Un solo cargo |
| Anular un cargo ya intentado | Cobros | `invalid_state` |
| Reembolso parcial | Ambos | Rectificativa por el importe; el original no cambia |
| Empresa A no ve ni anula cargos de la empresa B | Ambos | Aislamiento por `companyId` |
| Descuadre de base o IVA entre evento y documento | Administración | Alerta, sin corrección automática |

## 7. Datos de Nextair que debe comprobar Administración (sin inventar ninguno)

En la ficha de Nextair SL de production hay que comprobar:
- razón social, NIF y domicilio fiscal (el IVA del 21 % exige Península o Baleares);
- correo contractual;
- persona autorizada para aceptar y su cargo;
- moneda EUR;
- sociedad emisora: Big Elephant, con sus datos fiscales en la cuenta de Stripe y en el futuro sistema de facturación.

La ficha debe indicar la **infraestructura externa** y el **acuerdo personalizado**. La visión comercial del CRM (#76) ya muestra el servicio externo con «importe pactado del servicio».

**Bloqueo de esta ventana:** el acceso de operador a production está caducado (401), así que la comprobación queda pendiente de una sesión válida. No se ha creado ni cambiado ningún dato.

## 8. Decisiones pendientes

1. **DF-2:** sistema de facturación legal (series, numeración, VeriFactu). Sin él, I-8 encola pero no emite.
2. **Factura a vencimiento o al cobro** para la cuota de Nextair (§5).
3. Validación de este documento por la ventana de cobros (§1 y §4) antes de implementar I-4, I-6, I-7 y la migración del §5.
