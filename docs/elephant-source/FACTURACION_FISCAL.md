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

## Ventas cobradas por Stripe desde el panel

Alta de Essential o Business desde la prueba, compra de módulos y ampliaciones (prorrateo), cambios de plan y
renovaciones (`server/invoicing/stripeSales.ts`):

- **Origen:** cada cobro verificado deja un documento `invoice` pendiente en `fiscal_documents`. En el paso de
  borradores, cada uno genera **un** borrador (`order:<pedido>:in:<factura de Stripe>`, ya cobrado,
  `paymentRef = stripe:in:<id>`) con las líneas de `stripe_invoice_lines` y la cuota de IVA cobrada por Stripe, sin
  recalcularla. Con descuento, cada línea lleva su importe, su descuento y su base (o una línea agrupada exacta); ver
  «Fechas, descuentos, casos fiscales y facturas simplificadas». Fecha de operación: el día del cobro (cobro anticipado,
  art. 75.Dos de la Ley 37/1992), o el inicio del periodo si el cobro llegó después. No hay proforma.
- **Expedición:** el mismo `issueDue`, con contraste por API, número `EB`, PDF y envío. El cliente es el perfil fiscal
  del comprador del pedido (`stripe_buyer_profiles`), o la ficha del CRM si el pedido no tiene perfil.
- **Bloqueos:** no se expide (`invoice_issue_blocked`, con el motivo) en estos casos:
  - faltan la razón social, el NIF válido o el domicilio;
  - el comprador no es de la península o Baleares;
  - el IVA cobrado no es el 21 %;
  - la dirección de la factura de Stripe es de otro territorio;
  - el pedido es de otra empresa;
  - el documento fiscal consta emitido con otro número.

  Un documento sin copia de la factura de Stripe, o con la factura sin cobrar, no genera borrador y aparece en el
  mismo bloqueo.
- **Al expedir:** el documento fiscal queda `issued` con el número `EB` (`markFiscalDocumentIssued`). Si esa marca
  falla, la pasada siguiente la repara.
- **Reembolsos:** la factura queda «reembolsada» (total) o con aviso (parcial). La rectificativa la expide una persona
  y, al expedirla, liquida el documento de reembolso pendiente del mismo importe.

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

## Fechas, descuentos, casos fiscales y facturas simplificadas (02/11/2026)

Criterios aprobados por el propietario. Código: `server/invoicing/fiscalCases.ts`, `stripeSales.ts`, `document.ts` y
`delivery.ts`; datos en `invoices.fiscal_json` e `invoice_lines.gross_cents/discount_cents` (CRM 0045, aditiva; sin
ella todo funciona como antes).

### 1. Fechas por separado

La factura y el PDF muestran cada fecha por separado, sin suponer que coinciden:

| Fecha | Qué es | De dónde sale |
|---|---|---|
| Fecha de expedición | El día en que se numera la factura | `issueDate`, al expedir |
| Fecha de operación (devengo) | Ventas de Stripe: el cobro si es anticipado (art. 75.Dos de la Ley 37/1992); el inicio del periodo si el cobro llegó después por un reintento (art. 75.Uno.7.º). Servicios externos: el vencimiento pactado, como siempre | `operationDate` |
| Periodo de prestación del servicio | Desde–hasta de las partidas de Stripe (`period_start/period_end`) o de la mensualidad | `periodLabel`, y también en cada línea |
| Fecha de cobro | Solo si es distinta de la de operación | `fiscal.collectionDate` o `paidAt` |

El criterio de devengo usado queda en `fiscal.accrualBasis` (`advance_payment` o `due_date`). Pendiente de confirmar por
la gestoría (supuesto `devengo_cobro_anticipado`).

### 2. Descuentos

- **Por línea** (cupón de Stripe en toda la factura): cada partida lleva su importe antes del descuento, el descuento y la
  base neta. El reparto es proporcional al importe de cada partida, con su signo, como lo aplica Stripe, y solo se usa
  si casa con la cuota que Stripe cobró en **cada** línea (±1 céntimo) y cada tipo es el 21 % o el 0 %. Base, cuota y
  total son siempre los cobrados en Stripe.
- **Línea agrupada:** si el reparto no casa (p. ej. un cupón de una partida concreta), una sola línea con el importe
  bruto, el descuento y la base totales, y solo con un único tipo impositivo exacto. Con varios tipos, el tipo efectivo
  no es el 21 % y la expedición se bloquea con el motivo: nunca un desglose falso.
- **Limitación:** el registro de líneas de Stripe (CRM 0019, `server/stripe/`) no guarda `discount_amounts` ni
  `tax_amounts` por línea. El descuento se deduce de la diferencia entre las partidas y la base cobrada. Guardar el
  descuento de Stripe por línea exige cambiar `server/stripe/` (publicación extraordinaria).
- **Saldo a favor del cliente** (customer balance): es una **forma de pago**, no un descuento. No cambia la base, la
  cuota ni el total. Queda en las notas y en `fiscal.balanceAppliedCents`. El contraste con Stripe antes de expedir
  compara lo cobrado con el total, así que una factura pagada en parte con saldo queda bloqueada para revisión manual,
  como hasta ahora.
- La rectificativa total de una factura con descuentos repite en negativo el bruto, el descuento, la base y la cuota de
  cada línea.

### 3. Casos fiscales (preparados y desactivados)

Clasificación: tipo de comprador × territorio (del perfil fiscal del pedido) × NIF-IVA válido en VIES ×
naturaleza del servicio (SaaS prestado por vía electrónica).

| Caso | Tratamiento preparado | Norma | ¿Activable? |
|---|---|---|---|
| `business:es_mainland` | IVA 21 % | Ley 37/1992, arts. 69.Uno.1.º y 90.Uno | **Vigente** (siempre activo) |
| `consumer:es_mainland` | IVA 21 % | arts. 69.Uno.2.º y 90.Uno | Sí |
| `business:es_canarias`, `business:es_ceuta`, `business:es_melilla` | No sujeto, con mención | arts. 3.Uno y 69.Uno.1.º | Sí |
| `consumer:es_canarias`, `consumer:es_ceuta`, `consumer:es_melilla` | Sin determinar | arts. 69.Uno.2.º y 69.Dos; IGIC; IPSI | **No** |
| `business:eu_vies` | Inversión del sujeto pasivo, con mención | art. 69.Uno.1.º; Directiva 2006/112/CE, arts. 44 y 196 | Sí, tras el alta en el ROI |
| `business:eu_unverified` | Sin determinar | Reglamento de Ejecución (UE) 282/2011, art. 18 | **No** |
| `consumer:eu` | IVA del país del cliente (OSS) | Directiva 2006/112/CE, art. 58; Ley 37/1992, art. 73 y régimen de la Unión | Sí, tras el alta en OSS |
| `business:eu_special`, `consumer:eu_special` | Sin determinar | Directiva 2006/112/CE, art. 6 | **No** |
| `business:non_eu` | No sujeto, con mención | art. 69.Uno.1.º (y descartar el 70.Dos) | Sí |
| `consumer:non_eu` | No sujeto, con mención | art. 69.Dos | Sí |

Todos salvo el vigente llevan `requiresAdvisor: true` y la pregunta concreta para la gestoría (lista de abajo). Las
menciones legales son **plantillas** (`TREATMENTS[caso].mention`) que la gestoría debe validar.

**Activación:** `CP_INVOICING_FISCAL_CASES=<caso>,<caso>` en el plano de control. Sin la variable, ninguno: todo caso
distinto de `business:es_mainland` se bloquea exactamente como hasta ahora. Un caso desconocido o sin tratamiento
determinado impide arrancar. Activar un caso aquí **no** cambia quién puede comprar: eso lo decide la elegibilidad de
Stripe (`CP_STRIPE_FISCAL_SCENARIOS`, hoy solo `business:es_mainland`). Con un caso activado se comprueba además que el
IVA que cobró Stripe es el del tratamiento (21 %, 0 %, o un único tipo del país de destino en OSS).

### 4. Facturas simplificadas

- Para particulares **sin NIF** de la península y Baleares (caso `consumer:es_mainland` activado), con
  `CP_INVOICING_SIMPLIFIED=1`.
- Límite: **400 € IVA incluido** (art. 4.1.a del RD 1619/2012). Por encima, bloqueo con el motivo: hacen falta el NIF y
  el domicilio para la factura completa. El límite de 3.000 € del art. 4.1.b no se aplica.
- **Serie propia `EBS-AAAA-NNNNN`**, con numeración correlativa independiente de `EB`. Título «Factura simplificada» y
  la mención «Factura simplificada (arts. 4 y 7 del Real Decreto 1619/2012)». El destinatario solo con su nombre (el
  art. 7 no exige sus datos).
- Un particular **con NIF** recibe factura completa en la serie `EB`.
- Las rectificativas de simplificadas van en `EBR`, pendiente de confirmar (supuesto `rectificativa_simplificada`).

### Supuestos pendientes de confirmar por la gestoría

Lista exacta (identificadores de `ADVISOR_QUESTIONS` en `server/invoicing/fiscalCases.ts`). Cada factura guarda en
`fiscal.advisorPending` los que le afectan.

| Supuesto | Norma | Pregunta |
|---|---|---|
| `devengo_cobro_anticipado` | Ley 37/1992, art. 75.Uno.7.º y art. 75.Dos | ¿Es correcto tomar como fecha de operación la del cobro cuando es anterior o igual al inicio del periodo, y el inicio del periodo cuando el cobro llega después por un reintento? |
| `periodo_prestacion` | RD 1619/2012, art. 6.1 | ¿Basta con indicar el periodo de prestación (desde–hasta) en la línea y en la cabecera, junto a la fecha de operación? |
| `descuento_por_linea` | Ley 37/1992, art. 78.Tres.2.º; RD 1619/2012, art. 6.1.f) | ¿Es correcto repartir un cupón de factura entre las líneas en proporción a su importe y mostrar por línea el bruto, el descuento y la base, comprobando la cuota cobrada de cada línea? |
| `saldo_a_favor` | Ley 37/1992, art. 78.Tres.2.º y art. 80.Dos | ¿Es correcto tratar el saldo a favor del cliente como forma de pago, sin reducir la base, o alguno debe documentarse como rectificativa? |
| `consumidor_peninsula` | Ley 37/1992, art. 69.Uno.2.º y art. 90.Uno | ¿Tributa al 21 % el SaaS a particulares de la península y Baleares? |
| `factura_simplificada` | RD 1619/2012, art. 4.1.a) y art. 7 | ¿Procede la simplificada (serie EBS) para particulares sin NIF hasta 400 € IVA incluido? ¿Encaja el SaaS en algún supuesto del art. 4.1.b) (3.000 €)? |
| `rectificativa_simplificada` | RD 1619/2012, art. 15 y art. 4.1.c) | ¿Pueden las rectificativas de simplificadas ir en la serie EBR o conviene una serie propia? |
| `canarias_ceuta_melilla_empresa` | Ley 37/1992, arts. 3.Uno y 69.Uno.1.º; Ley 20/1991, art. 19.1.2.º; IPSI | ¿No sujeción para empresas de Canarias, Ceuta y Melilla, texto de la mención y sin obligaciones formales de IGIC o IPSI para nosotros? |
| `canarias_ceuta_melilla_particular` | Ley 37/1992, arts. 69.Uno.2.º y 69.Dos; IGIC; IPSI | ¿Qué impuesto se repercute a particulares de Canarias, Ceuta y Melilla y qué registros nos exige? |
| `ue_empresa_isp` | Ley 37/1992, art. 69.Uno.1.º; Directiva 2006/112/CE, arts. 44 y 196; RD 1619/2012, art. 6.1; Reglamento (UE) 282/2011, art. 18 | ¿No sujeción con «Inversión del sujeto pasivo», modelo 349 y alta previa en el ROI (hoy nuestro NIF-IVA no consta en VIES)? |
| `ue_empresa_sin_vies` | Reglamento (UE) 282/2011, art. 18; Ley 37/1992, art. 69 | Una empresa de la UE sin NIF-IVA válido en VIES, ¿se trata como particular o no se le vende? |
| `ue_particular_oss` | Directiva 2006/112/CE, art. 58; Ley 37/1992, art. 73 y régimen de la Unión; Reglamento (UE) 282/2011, art. 24 ter | ¿OSS desde el primer euro o IVA español bajo el umbral de 10.000 €? ¿Qué pruebas de localización y qué factura? |
| `ue_territorio_especial` | Directiva 2006/112/CE, art. 6; Ley 37/1992, art. 3 | ¿Qué tratamiento tienen los territorios de la UE excluidos del IVA comunitario? |
| `tercer_pais_empresa` | Ley 37/1992, arts. 69.Uno.1.º y 70.Dos | ¿No sujeción para empresas de fuera de la UE, texto de la mención, prueba de su condición y descarte del art. 70.Dos? |
| `tercer_pais_particular` | Ley 37/1992, art. 69.Dos | ¿No sujeción para particulares de fuera de la UE y qué países exigen registro propio? |

## Decisiones humanas pendientes

- Modalidad del sistema de facturación (VERI\*FACTU o no) y el certificado electrónico para la remisión.
- Consentimiento expreso a la factura electrónica en los contratos.
- Política de facturas de anticipo y pagos parciales.
- Los supuestos de la gestoría de la lista anterior y, con ellos, qué casos fiscales se activan.
