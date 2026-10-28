# Contrato de integración v1: cobros (Stripe) ↔ administración comercial, facturación y contabilidad

Versión 1 · 28/10/2026 · Redacta: ventana de administración comercial («Ventana 2»). La ventana de cobros y Stripe lo validó el 28/10/2026 con 4 cambios, ya incorporados (I-4, I-6, §2 y §5).
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

**Consecuencia para el 01/11/2026:** el cargo de 1.210 € se ejecuta y se concilia igualmente; no es un bloqueo del cobro. La factura legal de noviembre se emite fuera del sistema, con la referencia del cobro, salvo que DF-2 y la facturación propia (§5) estén listas antes.

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
| I-8 | **Emitir documento fiscal**: Administración factura por devengo en su módulo propio (§5). Para servicios externos lee los eventos de cobro existentes; para pedidos SaaS, implementa `FiscalDocumentSink` sobre la cola actual. Idempotente por `source_key` | Administración (lee de Cobros) | **Nuevo** (§5) |
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
  // Por defecto, enlace de pago: la autorización de la tarjeta (Checkout en modo setup) solo cubre la cuota recurrente
  // pactada, que es lo que ve el cliente. Con card_on_file, `mandateRef` es obligatorio (sin él, Cobros: invalid_input)
  method: "payment_link" | "card_on_file" | "offline";
  mandateRef?: string;           // autorización expresa del cliente para este tipo de cargo
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
  // Neto después de descuentos: invoiceNetCents depende de #390 (sin fusionar, ficheros protegidos). Mientras no esté,
  // en facturas sin descuentos (Nextair) baseCents = subtotal, que es el mismo valor
  baseCents: number;
  taxCents: number;
  totalCents: number;
  occurredAt: number;
}
```

## 5. Facturación propia de Elephant Source (I-8)

**Decisión v1.** No se modifica `fiscal_documents`. Pasar `order_id` y `stripe_invoice_id` a nulos sería un `MODIFY COLUMN`, que `destructiveMigration` (`scripts/deploy/esRailwayLib.ts:405`) clasifica como extraordinario. Además, esa tabla es la cola de los pedidos de Stripe y seguirá siéndolo.

La facturación vive en un **módulo propio de Administración**, `server/invoicing/**`, con una migración **aditiva**: `db/crm/migrations/0027_invoicing.sql`, que solo hace `CREATE TABLE` de `invoice_series`, `invoices` e `invoice_lines`.

**Qué hace el módulo**
- **Series y numeración:** correlativa, por serie y año, asignada al emitir y nunca reutilizada.
- **Datos fiscales:** del emisor (configuración) y del cliente (ficha del CRM), congelados en cada factura.
- **Importes:** base, tipo y cuota de IVA, y total.
- **Estado de emisión:** `draft` → `issued` → (`rectified`).
- **Estado de cobro:** independiente del de emisión (`pending`, `paid`, `failed`, `refunded`).
- **Rectificativas** que remiten a la factura original.
- **PDF**, generado desde lo emitido.

**Idempotencia:** `source_key` única por hecho facturable (`external:<id>:<AAAA-MM>`, `order:<id>:<periodo>`, `charge:<id>`). Nunca hay dos facturas del mismo hecho.

**Quién aporta qué**
- **Servicios externos (Nextair):** Administración genera la factura del periodo a partir del calendario pactado de la contratación. El cobro lo lee en solo lectura de `external_subscription_events` (`invoice_paid` e `invoice_payment_failed`, con `ref` = factura de Stripe y `detail.period`). Cobros **no tiene que encolar nada**; solo debe mantener estable la forma de esos eventos.
- **Pedidos SaaS:** siguen encolándose en `fiscal_documents`. Más adelante, el módulo implementa `FiscalDocumentSink` para emitirlos, sin tocar `fiscalDocuments.ts`.
- **Cargos extraordinarios y gastos variables:** su factura nace del cargo aprobado (I-4), con `source_key` `charge:<id>`.

### Cuándo se emite cada factura

Normativa española aplicada (a confirmar por la asesoría fiscal; no bloquea la implementación):

- **Devengo del IVA en servicios de tracto sucesivo** (art. 75.1.7.º de la Ley 37/1992): se produce cuando resulta exigible cada parte del precio.
  - Para la cuota mensual pactada a día 1, el devengo es **el día de vencimiento**, no el del cobro.
  - Un cobro **anticipado** devenga en el momento del pago, por el importe cobrado (art. 75.2).
- **Plazo de expedición entre empresarios** (art. 11 del Real Decreto 1619/2012): antes del día 16 del mes siguiente al devengo.
- **Facturar no es cobrar.** La factura se expide por el devengo con su fecha de operación, y el cobro se registra aparte.
  - Si el cargo falla, la factura sigue siendo debida y queda «pendiente de cobro».
  - No se anula por impago; solo una rectificativa la corrige.

| Operación | Fecha de operación (devengo) | Se expide | Cobro |
|---|---|---|---|
| Cuota mensual de servicio externo | Día de vencimiento (día 1, Europe/Madrid) | Al llegar el devengo, y siempre antes del día 16 del mes siguiente | Estado aparte, por los eventos de cobro |
| Cuota cobrada antes del vencimiento | Día del cobro (anticipo) | Al cobrarse | Pagada |
| Cargo extraordinario | Fecha pactada de la operación | Al aprobarse y prestarse | Por I-6 |
| Gasto variable | Fin del periodo de consumo | Al cerrar el periodo | Por I-6 |
| Reembolso total o parcial | Fecha del reembolso | Rectificativa sobre la original | Reembolsado |

**Nextair (1.000 € + 21 % de IVA):**
- Factura con fecha de operación **01/11/2026**, periodo noviembre de 2026, base 1.000,00 €, IVA 210,00 € y total 1.210,00 €.
- Se genera como **borrador** con `source_key` `external:<id>:2026-11`.
- Solo se **expide** cuando se cumplen dos condiciones:
  - los datos fiscales del cliente están verificados (razón social, NIF y domicilio completos);
  - la emisión real está habilitada en el entorno (`CP_INVOICING_ISSUE_ENABLED`, apagado por defecto).
- El cobro (`invoice_paid`) la marca como pagada; si falla, queda «pendiente de cobro».

**VeriFactu:** según el Real Decreto 1007/2023 y su aplazamiento, la obligación empieza en 2027. El módulo guarda cada factura de forma inmutable y encadenada por huella, para poder remitirla al sistema que se apruebe (DF-2). La fecha exacta y el formato quedan pendientes de confirmación profesional.

**No hay doble factura:** la misma `source_key` devuelve la factura existente. Si DF-2 decide usar un sistema externo, el módulo actúa como origen y guarda su `externalRef`.

## 6. Pruebas de integración acordadas

| Prueba | Dueño | Comprueba |
|---|---|---|
| Cuota de un externo → exactamente una factura del periodo, con base 100.000, IVA 21.000 y total 121.000; el evento `invoice_paid` duplicado no crea otra y la marca como pagada | Administración | I-8, idempotencia y devengo frente a cobro |
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

1. **DF-2:** sistema de facturación legal y remisión VeriFactu. Mientras tanto, el módulo propio genera, numera y guarda, y la emisión real queda apagada.
2. **Confirmación profesional** de la regla de devengo y plazos del §5 y de los datos del emisor (razón social, NIF, domicilio y serie).
3. I-4, I-6 e I-7: los implementa Cobros después del 01/11; la facturación no depende de ellos para Nextair.
