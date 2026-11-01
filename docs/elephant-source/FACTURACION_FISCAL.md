# Facturación fiscal automática de Big Elephant (DF-2)

Decisión del propietario (01/11/2026): Big Elephant emite sus propias facturas fiscales con el módulo de facturación
existente (`server/invoicing`). Stripe es la fuente de verdad del **cobro**, no un segundo emisor fiscal.

## Circuito

| Paso | Qué pasa | Dónde |
|---|---|---|
| 1. Proforma | El borrador de la mensualidad nace `CP_INVOICING_PROFORMA_DAYS` días antes del cobro (5 por defecto) y se envía al correo de facturación del cliente como **«PROFORMA — SIN VALIDEZ FISCAL»**: sin número, no se contabiliza. Nunca retroactiva. | `server/invoicing/delivery.ts` (`sendProformas`) |
| 2. Cobro | Lo ejecuta Stripe sin cambios en su motor; el webhook marca el borrador como cobrado (`paymentRef = stripe:in:<id>`). | `server/stripe`, `server/external` |
| 3. Contraste | Antes de expedir, la factura de Stripe se lee por API: pagada, mismo importe y misma moneda. Si no casa, no se expide (`invoice_issue_blocked`). | `StripeApiBalanceReader.invoice` |
| 4. Factura | Se expide **una vez**: serie y número correlativo por año (`EB-AAAA-NNNNN`, bloqueo de fila de la serie), fecha de expedición, datos fiscales del emisor y del cliente congelados y huella encadenada. | `InvoicingService.issue` |
| 5. PDF y envío | PDF corporativo y correo `invoice_available` al correo de facturación, con clave idempotente `invoicing:invoice:<id>:<número>`. La bandeja de salida reintenta la entrega; un encolado fallido se reintenta en la pasada siguiente (45 días). | `InvoicingAutomation.issueDue/redeliver` |
| 6. Libro | Asiento de venta `invoice:<id>` (430 / 705 / 477) una sola vez; el cobro entra por la transacción de Stripe (`stripe-txn:<id>`) contra la misma empresa. | `server/finance/automation.ts` |

Todo corre en la pasada contable cada 15 minutos (`FinanceAutomation`, paso `invoiceIssue`). Una factura expedida a
mano desde el CRM sale por el mismo envío. `GET /cp/v1/invoicing/invoices/:id/pdf` da el PDF (o la proforma del borrador).

**Interruptor:** la expedición real exige `CP_INVOICING_ISSUE_ENABLED=1` en el plano de control (variable protegida).
Sin él se preparan borradores y proformas, pero no se expide nada.

## Casos especiales

- **Crédito / impago:** con el cobro de Stripe fallido, la factura se expide el día 10 del mes siguiente a la operación
  (plazo legal para empresas: antes del día 16, art. 11 RD 1619/2012) y queda pendiente de cobro.
- **Sin ningún intento de cobro:** no se expide sola (puede ser una baja posterior a la proforma). Queda como incidencia.
- **Fin de contrato:** nunca se genera el borrador de un periodo posterior a `endsAt`.
- **Reembolsos y abonos:** la factura queda «reembolsada» y la **rectificativa la decide y expide una persona**
  (`POST /invoicing/invoices/:id/rectify` y expedir), en su propia serie (`EBR`).
- **Anticipos y pagos parciales:** los servicios externos cobran el día de la operación. Un cobro anterior a la operación
  o parcial no se factura solo: requiere una factura de anticipo que hoy expide una persona.
- **Cargos extraordinarios y altas inmediatas:** su borrador nace al aprobar el cargo (antes del enlace de pago) y se
  expide por el mismo circuito cuando consta el cobro.

## Requisitos legales comprobados (01/11/2026)

**Reglamento de facturación (RD 1619/2012), vigente:**
- **Contenido (art. 6):** el PDF lleva número y serie, fecha de expedición, fecha de operación, razón social, NIF y
  domicilio de las dos partes, descripción, base imponible, tipo y cuota de IVA y total.
- **Correlatividad:** una serie por año con bloqueo de fila. La serie de las rectificativas es aparte.
- **Plazo de expedición (art. 11):** antes del día 16 del mes siguiente a la operación cuando el destinatario es
  empresario o profesional.
- **Factura electrónica (art. 9):** el envío por correo requiere la aceptación del destinatario. Conviene que el
  contrato de cada cliente lo recoja de forma expresa (el actual de SkiNet no lo menciona).

**Reglamento de sistemas informáticos de facturación (RD 1007/2023, Orden HAC/1177/2024):** según el RD-ley 15/2025, es
obligatorio para los contribuyentes del Impuesto sobre Sociedades desde el **1 de enero de 2027**. Hay fuentes no
oficiales que anuncian otro aplazamiento, pero no consta en el BOE. A las facturas de 2026 no se les aplica. Lo que
falta antes de esa fecha:

1. **Modalidad:** VERI\*FACTU (remisión de cada registro a la AEAT) o no VERI\*FACTU (registros firmados y registro de
   eventos). Recomendación técnica: **VERI\*FACTU**, que no exige firma electrónica de cada registro ni registro de eventos.
2. **Registro de facturación de alta y anulación** con el formato y la huella SHA-256 encadenada de la Orden. La huella
   actual del módulo es propia y hay que adaptarla a los campos oficiales.
3. **Código QR** de cotejo en cada factura y la leyenda «VERI\*FACTU» en esa modalidad.
4. **Remisión al servicio web de la AEAT** con certificado electrónico de la sociedad.
5. **Declaración responsable** del sistema (productor del software).

## Decisiones humanas pendientes

- Modalidad del sistema de facturación (VERI\*FACTU o no) y el certificado electrónico para la remisión.
- Consentimiento expreso a la factura electrónica en los contratos.
- Política de facturas de anticipo y pagos parciales.
