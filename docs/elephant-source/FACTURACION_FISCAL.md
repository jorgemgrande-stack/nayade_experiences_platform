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
- **Saldo a favor del cliente** (customer balance): nunca reduce la base, la cuota ni el total de la factura en que se
  aplica. Queda en las notas y en `fiscal.balanceAppliedCents`. Desde la matriz fiscal (03/11/2026) su **origen fiscal**
  lo decide una persona (`POST /cp/v1/invoicing/invoices/:id/credit-origin`); sin decidirlo, la factura no se expide y
  el motivo queda en el bloqueo. Ver «Matriz fiscal versionada», apartado «Créditos».
- La rectificativa total de una factura con descuentos repite en negativo el bruto, el descuento, la base y la cuota de
  cada línea.

### 3. Casos fiscales

La tabla de casos, su estado y su fundamento están ahora en la **matriz fiscal versionada** (sección siguiente), que
sustituye a la tabla de `TREATMENTS`: `server/invoicing/fiscalCases.ts` deriva los tratamientos de
`server/invoicing/fiscalMatrix.ts` sin duplicarlos.

**Activación:** `CP_INVOICING_FISCAL_CASES=<caso>,<caso>` en el plano de control. Sin la variable, ninguno: todo caso
distinto de `business:es_mainland` se bloquea exactamente como hasta ahora. Un caso desconocido o **bloqueado en la
matriz** impide arrancar. Activar un caso aquí **no** cambia quién puede comprar: eso lo decide la elegibilidad de
Stripe (`CP_STRIPE_FISCAL_SCENARIOS`, hoy solo `business:es_mainland`). Con un caso activado se comprueban además el
IVA que cobró Stripe (21 %, 0 %, o un único tipo del país de destino en OSS) y las evidencias que exige su regla.

### 4. Facturas simplificadas

- Para particulares **sin NIF** con IVA español: de la península y Baleares (caso `consumer:es_mainland` activado) o
  de otro Estado miembro bajo el umbral del art. 73 (`consumer:eu` con `CP_INVOICING_EU_B2C_REGIME=below_threshold`),
  con `CP_INVOICING_SIMPLIFIED=1`. Nunca en destino (OSS).
- Límite: **400 € IVA incluido** (art. 4.1.a del RD 1619/2012). Por encima, bloqueo con el motivo: hacen falta el NIF y
  el domicilio para la factura completa. El límite de 3.000 € del art. 4.2 solo vale para los sectores que enumera (venta
  al por menor, hostelería, transporte de personas…), entre los que no está el SaaS: no se aplica.
- **Serie propia `EBS-AAAA-NNNNN`**, con numeración correlativa independiente de `EB`. Título «Factura simplificada» y
  la mención «Factura simplificada (arts. 4 y 7 del Real Decreto 1619/2012)». El destinatario solo con su nombre (el
  art. 7 no exige sus datos).
- Un particular **con NIF** recibe factura completa en la serie `EB`.
- Las rectificativas de simplificadas van en su **propia serie `EBSR`**: son a su vez simplificadas (art. 4.1.b) y el
  art. 7.1.a obliga a separar en series las simplificadas de las completas del mismo año, así que no pueden compartir la
  serie `EBR` de las rectificativas de completas. Título «Factura rectificativa simplificada»; en el libro registro,
  tipo `R5` (las simplificadas, `F2`).

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
| `factura_simplificada` | RD 1619/2012, art. 4.1.a) y art. 7 | ¿Procede la simplificada (serie EBS) para particulares sin NIF hasta 400 € IVA incluido? El límite de 3.000 € del art. 4.2 no alcanza al SaaS: ¿conforme? |
| `rectificativa_simplificada` | RD 1619/2012, arts. 15, 4.1.b) y 7.1.a) | Las rectificativas de simplificadas van en su serie propia EBSR (simplificadas y completas en series separadas): ¿conforme? |
| `canarias_ceuta_melilla_empresa` | Ley 37/1992, arts. 3.Uno y 69.Uno.1.º; Ley 20/1991, art. 19.1.2.º; IPSI | ¿No sujeción para empresas de Canarias, Ceuta y Melilla, texto de la mención y sin obligaciones formales de IGIC o IPSI para nosotros? |
| `canarias_ceuta_melilla_particular` | Ley 37/1992, arts. 69.Uno.2.º y 69.Dos; IGIC; IPSI | ¿Qué impuesto se repercute a particulares de Canarias, Ceuta y Melilla y qué registros nos exige? |
| `ue_empresa_isp` | Ley 37/1992, art. 69.Uno.1.º; Directiva 2006/112/CE, arts. 44 y 196; RD 1619/2012, art. 6.1; Reglamento (UE) 282/2011, art. 18 | ¿No sujeción con «Inversión del sujeto pasivo», modelo 349 y alta previa en el ROI (hoy nuestro NIF-IVA no consta en VIES)? |
| `ue_empresa_sin_vies` | Reglamento (UE) 282/2011, art. 18; Ley 37/1992, art. 69 | Una empresa de la UE sin NIF-IVA válido en VIES, ¿se trata como particular o no se le vende? |
| `ue_particular_oss` | Directiva 2006/112/CE, art. 58; Ley 37/1992, art. 73 y régimen de la Unión; Reglamento (UE) 282/2011, art. 24 ter | ¿OSS desde el primer euro o IVA español bajo el umbral de 10.000 €? ¿Qué pruebas de localización y qué factura? |
| `ue_territorio_especial` | Directiva 2006/112/CE, art. 6; Ley 37/1992, art. 3 | ¿Qué tratamiento tienen los territorios de la UE excluidos del IVA comunitario? |
| `tercer_pais_empresa` | Ley 37/1992, arts. 69.Uno.1.º y 70.Dos | ¿No sujeción para empresas de fuera de la UE, texto de la mención, prueba de su condición y descarte del art. 70.Dos? |
| `tercer_pais_particular` | Ley 37/1992, arts. 69.Uno.2.º, 69.Dos y 70.Uno.4.º; Directiva 2006/112/CE, art. 58 | El art. 69.Dos vigente ya no incluye los servicios electrónicos: ¿se localizan en España (regla general) o fuera (art. 58 de la Directiva)? ¿Qué países exigen registro propio? |

## Matriz fiscal versionada (03/11/2026, versión `2026-11-03.1`)

Código: `server/invoicing/fiscalMatrix.ts` (datos y reglas puras) y su prueba `fiscalMatrix.test.ts`. Cada factura de una
venta de Stripe guarda al expedirse, en `invoices.fiscal_json` (CRM 0045, sin migración nueva), la **versión de la
matriz** (`matrixVersion`), la **regla aplicada** (`ruleId`) y sus **evidencias** (`evidence`). Las facturas anteriores
no cambian. La huella no incluye estos datos: la factura del caso vigente es idéntica a la de antes.

Estados: `enabled` (vigente y a la venta), `ready` (la norma consultada determina el tratamiento; se puede activar por
configuración cuando Big Elephant tome las decisiones que se indican) y `blocked` (la norma consultada no basta; no se
puede activar ni forzar: aunque se meta en la configuración, la expedición se bloquea con el motivo). **Nada se activa
solo**: ni el alta en el ROI o en la OSS, ni abrir un territorio a la venta.

| Caso (regla) | Impuesto y tipo | Quién lo ingresa | Mención | Obligaciones | Evidencias exigidas | Estado |
|---|---|---|---|---|---|---|
| `business:es_mainland` | IVA español 21 % | Big Elephant | — | 303 y libro de expedidas | nombre, NIF español, dirección, dirección de Stripe Tax, tipo cobrado | **enabled** |
| `consumer:es_mainland` | IVA español 21 % | Big Elephant | — | 303; EB con NIF, EBS sin NIF (≤ 400 €) | nombre, dirección, dirección de Stripe Tax, tipo cobrado | ready |
| `business:es_canarias` | IVA no sujeta; IGIC con inversión del sujeto pasivo | destinatario | no sujeta (arts. 3 y 69.Uno.1.º) + IGIC ISP (art. 19.1.2.º.a Ley 20/1991) | ninguna autoliquidación; base en el 303 como no sujeta (casilla pendiente de cotejo) | + NIF español | ready |
| `business:es_ceuta`, `business:es_melilla` | IVA no sujeta; IPSI sin determinar | sin determinar | — | IPSI sin determinar | — | blocked |
| `consumer:es_canarias` | IGIC canario (art. 17 Ley 20/1991), sin inversión | Big Elephant | — | alta y declaraciones ante la Agencia Tributaria Canaria | — | blocked |
| `consumer:es_ceuta`, `consumer:es_melilla` | sin determinar | — | — | — | — | blocked |
| `business:eu_vies` | IVA del Estado del cliente, autoliquidado por él (0 % en la factura) | destinatario | «Inversión del sujeto pasivo…» | alta en el ROI (036), 349, NIF-IVA del cliente en la factura | + VIES válido con fecha y del mismo NIF-IVA | ready |
| `business:eu_unverified` | sin determinar | — | — | — | — | blocked |
| `consumer:eu` sin régimen declarado | según el régimen | — | — | — | — | blocked |
| `consumer:eu@below_threshold` | IVA español 21 % (art. 70.Uno.8.º) | Big Elephant | — | 303; vigilar el umbral de 10.000 € | + umbral comprobado (año anterior y en curso) | ready |
| `consumer:eu@destination_oss` | IVA del Estado de consumo (Stripe Tax) | Big Elephant (régimen de la Unión) | — | alta en la OSS (035), 369 trimestral; opción mínima de dos años | + dos pruebas de localización independientes y no contradictorias; impuesto cobrado | ready |
| `business:eu_special`, `consumer:eu_special` | sin determinar | — | — | — | — | blocked |
| `business:non_eu` | IVA no sujeta (0 %) | destinatario (según su país) | no sujeta (art. 69.Uno.1.º) | base en el 303 como no sujeta (casilla pendiente de cotejo); obligaciones del país del cliente | + identificador fiscal del cliente (art. 18.3.b) | ready |
| `consumer:non_eu` | sin determinar | — | — | — | — | blocked |

### Supuestos habilitables y decisiones que exigen (ninguna automática)

| Regla | Decisión censal | Decisión comercial | Configuración |
|---|---|---|---|
| `consumer:es_mainland` | — | abrir `consumer:es_mainland` en `CP_STRIPE_FISCAL_SCENARIOS` y decidir el desistimiento (`CP_CONSUMER_WITHDRAWAL`) | `CP_INVOICING_FISCAL_CASES=consumer:es_mainland`, `CP_INVOICING_SIMPLIFIED=1` |
| `business:es_canarias` | — | abrir `business:es_special` | `CP_INVOICING_FISCAL_CASES=business:es_canarias` |
| `business:eu_vies` | **alta de Big Elephant en el ROI** (modelo 036) | abrir `business:eu` | `CP_INVOICING_FISCAL_CASES=business:eu_vies` |
| `consumer:eu@below_threshold` | — (declaración de no haber superado 10.000 € ni haber optado) | abrir `consumer:eu` y decidir el desistimiento | `CP_INVOICING_EU_B2C_REGIME=below_threshold`, `CP_INVOICING_FISCAL_CASES=consumer:eu`; Stripe Tax sin registro OSS |
| `consumer:eu@destination_oss` | **alta en el régimen de la Unión** (035) y, sin superar el umbral, **opción** por destino (dos años) | abrir `consumer:eu` | `CP_INVOICING_EU_B2C_REGIME=destination_oss`; registro OSS en Stripe Tax; una segunda prueba de localización |
| `business:non_eu` | — | abrir `business:non_eu` país a país tras revisar sus obligaciones locales | `CP_INVOICING_FISCAL_CASES=business:non_eu` |

`CP_INVOICING_EU_B2C_REGIME` es una **declaración** de Big Elephant, nunca se infiere. Con `below_threshold` la
expedición suma además las bases de las facturas de particulares de la UE del año anterior y del año en curso (con la
venta que se expide): si el año anterior pasó de 10.000 € o esta venta lo supera en el año, se bloquea con el motivo
(«desde esta operación tributa en destino», art. 73.Uno).

### Bloqueos restantes y por qué

- **Ceuta y Melilla (empresas):** el IVA es claro (no sujeta), pero no se ha cotejado la normativa del IPSI (quién es
  sujeto pasivo, registro, mención).
- **Particulares de Canarias:** el servicio se localiza en Canarias y el IGIC lo debe el prestador (art. 17 y art. 19.1.2.º
  de la Ley 20/1991): exige alta ante la Agencia Tributaria Canaria y el tipo del IGIC, no preparados.
- **Particulares de Ceuta y Melilla:** la Ley 37/1992 no excluye estos servicios (art. 69.Uno.2.º; el 70.Uno.4.º exige
  particular en el territorio de aplicación) y el IPSI no se ha cotejado.
- **Empresa de la UE sin VIES válido:** el art. 18 del Reglamento 282/2011 no cubre un NIF-IVA comunicado pero no válido.
- **Particulares de la UE sin régimen declarado:** depende del umbral o de la opción del art. 73.
- **Territorios especiales de la UE:** dependen del territorio concreto (Directiva, art. 6, pendiente de cotejo).
- **Particulares de fuera de la UE:** **corrección** respecto de la versión anterior, que los daba por no sujetos con el
  art. 69.Dos: el texto vigente del 69.Dos ya no incluye los servicios prestados por vía electrónica, el 70.Uno.4.º solo
  alcanza a particulares del territorio de aplicación y la regla general (69.Uno.2.º) los localizaría en España, frente
  al art. 58 de la Directiva. Además, muchos países exigen registro propio.
- **Particulares de la UE en destino:** la regla está lista, pero hoy solo consta una prueba de localización (la dirección
  de facturación; la de Stripe Tax procede de ella). Hasta que el registro de Stripe guarde el país de la tarjeta o la IP
  (cambio en `server/stripe/`, publicación extraordinaria) la expedición se bloquea con el motivo.

### Evidencias por factura (`fiscal.evidence`)

Comprador (tipo, territorio, país, código postal, NIF y condición: empresa declarada, empresa con VIES o particular);
comprobación VIES (NIF-IVA, resultado y fecha); pruebas de localización (fuente, país y si deriva de otra); cálculo de
Stripe Tax (factura de Stripe, cuota, total, importe cobrado, tipos, país y código postal); fechas (operación, criterio
de devengo, exigibilidad = inicio del periodo, cobro, periodo de prestación y expedición); importes (bruto, descuentos,
base, cuota, total y saldo aplicado); norma aplicada con su URL. Las rectificativas guardan `fiscal.rectifies` (factura
rectificada: id, serie y número, fecha y tipo) y la regla y versión de la original.

**Reintentos de Stripe:** un reintento del cobro es la misma factura de Stripe (misma clave `order:<pedido>:in:<factura>`):
nunca otra factura ni otro periodo. Si el cobro llega después del inicio del periodo, el devengo es la exigibilidad
(art. 75.Uno.7.º) y las fechas originales de periodo y cobro quedan en las evidencias.

### Créditos (saldo a favor aplicado por Stripe)

- **Medio de pago** (saldo monetario del cliente): no toca ninguna base; la factura conserva su total y se concilia con lo
  cobrado (total − saldo).
- **Ajuste del precio de una factura anterior** (art. 80.Dos de la Ley 37/1992): se indica la factura anterior (expedida,
  de la misma empresa y con un único tipo) y se prepara el **borrador de su rectificativa** por el saldo (art. 15 del RD
  1619/2012), enlazado en `fiscal.credit.rectificationInvoiceId`; en la factura nueva el saldo queda como medio de pago.
- **Sin decidir:** la expedición se bloquea con el motivo. El registro de Stripe no guarda el origen de los saldos
  (transacciones de saldo del cliente), así que hoy siempre lo decide una persona:
  `POST /cp/v1/invoicing/invoices/:id/credit-origin` con `{ origin: "payment_means" | "price_adjustment",
  originalInvoiceId?, reason }` (permiso `billing:write`).

### Referencias oficiales

Cotejadas el 03/11/2026 con el texto consolidado vigente (servicio de datos abiertos del BOE, mismo texto que la URL) o
con la publicación del DOUE reproducida por el BOE:

- Ley 37/1992 del IVA, arts. 3, 69, 70, 73, 75, 78, 80, 90, 163 unvicies y duovicies, 164: https://www.boe.es/buscar/act.php?id=BOE-A-1992-28740
- Real Decreto 1619/2012 (facturación), arts. 4, 6, 7, 11 y 15: https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696
- Ley 20/1991 (IGIC), arts. 17 y 19: https://www.boe.es/buscar/act.php?id=BOE-A-1991-14463
- Reglamento de Ejecución (UE) 282/2011, art. 18: https://www.boe.es/buscar/doc.php?id=DOUE-L-2011-80529
- Reglamento de Ejecución (UE) 1042/2013 (arts. 24 ter y 24 septies del 282/2011): https://www.boe.es/buscar/doc.php?id=DOUE-L-2013-82115
- Reglamento de Ejecución (UE) 2017/2459 (art. 24 ter, una prueba de un tercero hasta 100.000 €): https://www.boe.es/buscar/doc.php?id=DOUE-L-2017-82606
- AEAT, ROI, VIES y 349: https://sede.agenciatributaria.gob.es/Sede/iva/iva-operaciones-comercio-exterior/identificacion-realizar-operaciones-otros-empresarios-ue.html
- AEAT, alta en la ventanilla única (035): https://sede.agenciatributaria.gob.es/Sede/iva/iva-comercio-electronico/registro-regimen-unionregimen-exterior-regimen_intermediario.html
- AEAT, modelo 369 del régimen de la Unión: https://sede.agenciatributaria.gob.es/Sede/iva/iva-comercio-electronico/presentacion-autoliquidaciones-periodicas-modelo-369/regimen-union.html

**Pendientes de cotejo con el texto oficial** (EUR-Lex rechaza la descarga automática): Directiva 2006/112/CE, arts. 6,
44, 58 y 196 (https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=CELEX:32006L0112). También las casillas concretas del
modelo 303 para las operaciones no sujetas por reglas de localización y la normativa del IPSI de Ceuta y Melilla.


## Decisiones humanas pendientes

- Modalidad del sistema de facturación (VERI\*FACTU o no) y el certificado electrónico para la remisión.
- Consentimiento expreso a la factura electrónica en los contratos.
- Política de facturas de anticipo y pagos parciales.
- Los supuestos de la gestoría de la lista anterior y, con ellos, qué casos fiscales se activan.
