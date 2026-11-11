# Clientes externos: contratación, aceptación y cobro recurrente desde el CRM

Clientes con tecnología e infraestructura propias, fuera de Elephant Core, cuyo servicio se contrata, se acepta y se cobra desde Big Elephant CRM con Stripe Billing. El primer caso es el **piloto Nextair SL / Skicenter (SkiNet)**. El mecanismo es genérico: sirve para cualquier otro cliente externo sin desarrollo específico.

**No se aprovisiona nada en Elephant Core:** ni tenants, ni bases de datos, ni subdominios, ni licencias. El impago no detiene la infraestructura del cliente.

## Circuito

```
Comercial → Empresas → <empresa> → Nueva contratación de servicio externo
  1. Contrato del CRM con las condiciones (servicio, cuota, IVA, día de cobro, primer vencimiento, margen) — versionado
  2. Enlace de aceptación para el representante → aceptación digital con evidencias
  3. Enlace de Stripe para autorizar el método de pago (Checkout modo setup) — SIN cargo
  4. Webhook → Elephant fija el método y crea la suscripción de Stripe con trial_end = primer vencimiento
  5. Día 1 de cada mes (08:00 Europe/Madrid): Stripe factura y cobra → webhooks → estado comercial
```

| Pieza | Dónde |
|---|---|
| Servicio y reglas | `server/external/service.ts` |
| Calendario (zona horaria) | `server/external/schedule.ts` |
| Documento contractual y su huella | `server/external/document.ts` |
| Rutas de operador y página pública | `server/external/api.ts` |
| Tablas (CRM 0026) | `external_subscriptions`, `crm_contract_acceptances`, `external_subscription_events` |
| Stripe | `server/stripe/gateway.ts`: modo setup, suscripción de servicio, IVA, relojes de prueba |
| Webhooks | `server/stripe/events.ts`: la sesión de setup y la suscripción con `es_external_id` van al módulo externo |
| Margen del día 5 | Trabajador de Stripe (cada conciliación) y `POST /cp/v1/external/evaluate` |

## Aceptación digital

- El contrato del CRM lleva las condiciones económicas en su texto, y su versión queda guardada de forma inmutable (`crm_contract_versions`).
- El documento que se presenta es determinista y se identifica por su huella SHA-256 y su versión. Si el contrato cambia después de enviar el enlace, el enlace deja de valer.
- **El enlace es de un solo uso:** caduca a los 14 días y solo se guarda el hash del token. Enviar un enlace nuevo revoca los anteriores.
- La página pública es `/cp/v1/public/contract-acceptance`, en el dominio del CRM. Es HTML sin scripts, con política de seguridad estricta y límite de peticiones.
- **Evidencias que se guardan:**
  - nombre y NIF declarados;
  - declaración aceptada;
  - fecha;
  - versión y huella del documento;
  - IP seudonimizada (SHA-256 con sal);
  - navegador.
- El contrato pasa a «Firmado» con método **electrónico** y la referencia `aceptacion:<id>:<huella>`.
- **Aceptar no autoriza ningún cobro:** la autorización del método de pago es un paso posterior y separado.

## Autorización del método de pago sin cargo

- Se usa Checkout de Stripe en **modo setup**. El cliente registra la tarjeta en Stripe y Elephant solo guarda el id del método de pago.
- **El texto de la página de Stripe** dice:
  - que se autorizan cobros recurrentes;
  - la cuota (1.000 € + IVA 210 € = 1.210 € al mes);
  - el día de cobro y el primer cargo;
  - que hoy no se cobra nada;
  - que existe un portal para consultar facturas, cambiar el método o pedir la baja.
- **Al completarse** (webhook firmado `checkout.session.completed`):
  1. Elephant fija el método por defecto del Customer.
  2. Crea la suscripción de Stripe con `trial_end` en el primer vencimiento, `proration_behavior: none` y el IVA como tipo exclusivo.
  3. La clave de idempotencia es la del contrato y la fecha: repetir nunca crea otra suscripción.
- **Si la autorización llega después del primer vencimiento,** no se cobra con retroactividad. La contratación queda en «Decisión pendiente» y un operador con `orders:approve` fija una nueva fecha futura con motivo, que se registra en el contrato.

## Calendario

- El cobro es el día 1 a las **08:00 Europe/Madrid**. Stripe ancla los cobros mensuales al mismo día y hora UTC: a las 08:00 de Madrid el cobro cae el día 1 en invierno y en verano. A medianoche, el día 1 de Madrid sería el último día del mes en UTC.
- **Un cargo ordinario por periodo:** lo emite Stripe. Elephant nunca crea cargos sueltos. Cada factura se identifica por su mensualidad (p. ej. «noviembre de 2026»).
- Cambiar el calendario exige registrar el cambio en el contrato.

## Impagos (días 1 a 5)

- **Día 1, cobro fallido:** la contratación pasa a «Pago pendiente», con margen hasta el día 5 a las 23:59 (Madrid). Queda en el historial y salta la alerta `external.payment_failed`.
- **Reintentos:** los de Stripe (Smart Retries de la cuenta). Si se recupera, se cobra **la misma factura**; nunca hay un segundo cargo por el periodo.
- **Día 5 cumplido:** evaluación automática y alerta administrativa `external.overdue_after_grace`, una sola vez por factura, con nota en el contrato.
- **El servicio del cliente no se detiene.**
- **El cliente puede actualizar su método de pago** desde el portal de facturación (enlace desde el CRM).
- **Avisos al cliente:** los envía Stripe según la configuración de la cuenta (correos de pago fallido y de actualización de tarjeta). Elephant no envía todavía comunicaciones propias.

## Fiscalidad

- **IVA:** tipo exclusivo **fijo** de Stripe (`TaxRate`, 21 %, país ES), reutilizado si ya existe uno igual. No depende de Stripe Tax.
- **Es correcto para** una empresa establecida en la Península o Baleares que recibe un servicio de un prestador español. **No sirve** si el cliente está en Canarias, Ceuta o Melilla (no hay IVA, sino IGIC o IPSI), si es de otro país de la UE (inversión del sujeto pasivo) o si es de fuera de la UE.
- **Antes de emitir facturas reales** hay que confirmar el domicilio fiscal y el NIF de Nextair SL.
- **Factura legal:** la de Stripe es el justificante de cobro. La emisión de la factura legal sigue el circuito de facturación aprobado (`server/stripe/fiscalDocuments.ts`), que hoy está pendiente de decisión.

## Pruebas

- **`server/controlPlane.externalServices.test.ts`:** aplicación real del plano de control y doble de Stripe con firmas reales del SDK. Cubre:
  - contratación sin duplicados;
  - aceptación con evidencias;
  - autorización sin cargo;
  - suscripción programada para el día 1;
  - cobro de 1.210 €;
  - renovación;
  - impago y recuperación de la misma factura;
  - alerta del día 5 una sola vez;
  - webhooks repetidos;
  - ningún aprovisionamiento;
  - autorización tardía con decisión.
- **`scripts/stripe/externalSandboxE2E.ts`:** el mismo circuito contra el **sandbox real** de Stripe con **Test Clocks**. Necesita una clave de pruebas en `ES_SANDBOX_STRIPE_KEY`; se niega con cualquier clave live.
  - Para la tarjeta usa el mecanismo oficial de pruebas: SetupIntent confirmado con `pm_card_visa`, porque la página de Checkout exige navegador.
  - Para el impago usa `pm_card_chargeCustomerFail`.

## Activación en Stripe Live (pendiente de autorización)

1. Confirmar la fiscalidad de Nextair SL (domicilio y NIF) y el tipo de IVA aplicable.
2. Aprobar el texto contractual definitivo: condiciones del servicio, duración, baja y preaviso.
3. Configurar en la cuenta live:
   - los reintentos (Smart Retries) dentro del margen de 5 días;
   - los correos de Stripe de pago fallido;
   - el portal de facturación.
4. Aplicar la migración 0026 en el entorno con Stripe live. Allí el módulo solo se monta con la tabla y un origen https del CRM en `CP_ALLOWED_ORIGINS`.
5. Con autorización expresa: enviar el contrato real a la representante de Nextair, que autoriza su tarjeta real. El primer cargo será el 01/11/2026 si la autorización llega antes.

## Entornos y Stripe (comprobado el 28/10/2026 en los registros de arranque)

| Entorno | Stripe | Módulo de clientes externos |
|---|---|---|
| production (`admin.bigelephant.es`) | Cuenta **real** (clave restringida live, espacio `live`) | Completo, con cobros reales (`CP_EXTERNAL_LIVE_ENABLED=1`) |
| live (`elephant-source-crm-live.up.railway.app`) | Sin Stripe | Contrato, aceptación y seguimiento; la autorización de pago responde que Stripe no está configurado |

El sandbox de Stripe no está configurado en ningún entorno. La validación en sandbox se hace con `scripts/stripe/externalSandboxE2E.ts` y una clave de pruebas.

## Eventos de cobro para la facturación

Cada hecho de cobro queda una sola vez en `external_subscription_events` (`INSERT IGNORE` por contratación, tipo y referencia). Lo lee el módulo de facturación (CONTRATO_COBROS_FACTURACION.md, I-6):

| Tipo | Referencia | Detalle |
|---|---|---|
| `invoice_paid` / `invoice_payment_failed` | id de la factura de Stripe | `companyId`, `billingRef` (`external:<id>`), `paymentRef` (`stripe:in:<factura>`), `baseCents`, `taxCents`, `totalCents`, `periodStart`/`periodEnd` (periodo del servicio, de las líneas), `period` |
| `charge_refunded` | `<cargo>:<total reembolsado>` | lo añadido (`refundedDeltaCents`), acumulado y si es total, con los mismos campos de facturación |
| `charge_dispute` | `<cargo>:<estado>` | `disputeStatus` |
| `acceptance_email` | id del enlace | destinatario y estado de la bandeja de salida |

## Notas de cobro: pago por transferencia (CRM 0050)

Una nota de cobro de «Servicios externos» (cobro único o periodo de infraestructura, `server/external/operations.ts`)
emitida con enlace de pago de Stripe puede pagarse por transferencia sin que el cliente use Stripe. Desde la ficha de la
operación, «Registrar pago externo» abre el formulario de transferencia.

- **Quién:** `orders:approve` y `billing:write` para registrar, rectificar y anular (administración); `orders:approve`
  para ver el justificante. No hay permisos nuevos.
- **Qué se pide:** se muestra el pendiente (IVA incluido); fecha de recepción (no futura), referencia opcional y el
  **justificante en PDF, obligatorio** (hasta 10 MB). Solo comprobaciones de seguridad: base64, tamaño y firma `%PDF-`.
  Sin OCR, sin consulta al banco y sin validar el contenido: el justificante es la prueba que aporta el administrador,
  no una verificación bancaria (la ficha lo dice).
- **Solo el total pendiente:** el modelo de cargos no admite pagos parciales (un cargo, una factura, cobrada o no).
- **Confirmación expresa** (casilla + diálogo) y **clave de idempotencia** del formulario: un doble envío devuelve el
  mismo pago (`replay`), sin otro pago, documento ni evento.
- **Efectos:** pago `offline` con `method = bank_transfer` en `billing_charge_payments`, que liquida el cargo
  (`settles_charge_id`); la factura del cargo pasa a cobrada con `payment_ref = transfer:<id>` y fecha de recepción; la
  nota y la operación se ven «Pagado» (el estado se lee de la factura, como con Stripe). Ni segunda factura ni otro
  ingreso. Historial: `paid_transfer` (operador, fecha, importe, medio, operación, documento con su sha256 y qué se
  hizo con cada enlace de Stripe).
- **Justificante:** en el almacén privado ya existente del plano de control (`fin_documents`, contenido en la BD) con el
  tipo de propietario `charge_receipt`; las rutas de documentos de las finanzas no lo listan, no lo sirven ni lo
  archivan (solo tratan sus propios tipos). Se sirve por
  `GET /external-ops/:id/periods/:pid/receipts/:docId` (sin caché, `nosniff`, como adjunto). Nunca se borra.
- **Coexistencia con Stripe Live** (con el cerrojo del cargo tomado, `GET_LOCK` en MySQL):
  1. Se relee cada sesión de Checkout abierta del cargo. Si Stripe ya cobró, se registra ese cobro y la transferencia se
     rechaza («Stripe ya ha cobrado…»). Si ya consta cobrada por Stripe, también se rechaza.
  2. Si sigue abierta, se caduca en Stripe (`checkout.sessions.expire`, por la pasarela existente; idempotente: una ya
     caducada no se toca) y se vuelve a leer. No se usan Payment Links de Stripe: el enlace es una sesión de Checkout.
  3. Si Stripe no responde al LEER la sesión, la transferencia no se registra (error, sin cambios: se reintenta). Si
     responde a la lectura pero falla al caducarla, se consolida (`expire_failed` en el historial y aviso en la ficha)
     y un cobro posterior de ese enlace queda como duplicado.
  3 bis. Una sesión completada con el pago aún en proceso (método diferido, p. ej. adeudo SEPA) bloquea la
     transferencia hasta que Stripe lo confirme o lo rechace.
  4. Un cobro de Stripe que llegue después (o a la vez) no se contabiliza: como mucho un pago liquida cada cargo (clave
     única por entorno). Queda `duplicate`, sale la alerta `admin.billing_error` («Revisar y reembolsar») y se ve en
     los movimientos de la ficha. El reembolso en Stripe es manual.
  5. Nunca se tocan suscripciones recurrentes ni pagos de otros clientes: solo las sesiones del propio cargo.
- **Rectificación y anulación** (con motivo, auditadas): la rectificación cambia la fecha, la referencia o el
  justificante (el anterior se conserva) y deja el antes y el después en `transfer_rectified`; el importe no se
  rectifica. La anulación deja el pago `voided` (no se borra), libera el cargo y la nota vuelve a pendiente
  (`transfer_voided`); los enlaces caducados no se reabren. Se anula con la factura aún en borrador. Ya expedida, primero
  la rectificativa TOTAL en Facturación (`POST /invoicing/invoices/:id/rectify` y expedirla: la original queda
  «rectificada») y después la anulación, que libera el cargo y prepara una factura NUEVA en borrador
  (`charge:<id>:tras:<rectificada>`, mismos conceptos e importes), enlazada a la nota, para volver a cobrarla por el
  circuito normal. Nunca con el abono ya conciliado con el banco ni con un cobro de Stripe duplicado sin resolver.
  Reenviar la clave de un pago anulado es un error. El justificante y el historial se conservan.
- **Ruta de cargos:** `POST /invoicing/charges/:id/offline-payment` rechaza una nota de una operación externa (se
  registra en la ficha, con justificante); para los cargos de empresa sigue igual y no llama a Stripe.
- **Sin transacción entre almacenes:** el justificante se guarda antes que el pago; si el pago no se registra, el
  justificante se archiva (nunca se borra). Si falla al marcar la factura, reenviar con la misma clave lo completa.
- **Panel e informes:** `/revenue/metrics` añade `charges` (cobros únicos de la ventana por medio: Stripe,
  transferencia bancaria u otro; sin duplicados ni anulados), visible en el Dashboard y en Finanzas → Revenue &
  Margin (métricas comerciales).

### Factura y contabilidad: el mismo circuito que con Stripe

| Paso | Cobro por Stripe | Cobro por transferencia |
|---|---|---|
| Factura | Nace en borrador al emitir la nota (`ChargeService.approve`, `charge:<id>`) | La misma; el cobro nunca crea otra |
| Cobro | Webhook firmado y sesión releída → `paid`, `stripe:pi:<id>` | Confirmación con PDF → `paid`, `transfer:<pago>` |
| Expedición | La pasada periódica de `FinanceAutomation` (`InvoicingAutomation.issueDue`, cada 15 min): número correlativo, datos fiscales congelados, PDF y envío. **Sin cambios** | **La misma pasada**: hasta entonces, borrador cobrado. Una factura ya expedida antes del cobro solo se marca cobrada |
| Asiento de la factura | `invoice:<id>` (venta: 430 / 70x + 477) en la pasada contable | El mismo |
| Asiento del cobro | Al importarse la transacción de saldo de Stripe (`stripe-txn:<id>`: 572-Stripe y 626 / 430) | Al conciliar el abono del extracto con la factura (`bankmov:<id>`: 572 banco / 430). La factura cobrada por transferencia declarada sigue entre las sugerencias de conciliación |
| Texto del PDF | «Cobrada mediante Stripe.» | «Cobrada mediante transferencia bancaria.» |

En los dos casos el cobro llega al libro con la prueba del dinero (el saldo de Stripe o el extracto del banco), nunca
con la confirmación (webhook o administrador): por eso no se contabiliza dos veces. Diferencias propias de cada medio:
la comisión de Stripe (626) y su payout solo existen en Stripe; la transferencia lleva el justificante del administrador
y su conciliación es con el extracto. Un fallo al expedir nunca deshace el cobro: lo reintenta la pasada siguiente, que
además salta sin incidencia una factura expedida mientras tanto (a mano o en otra réplica). Ninguno de los dos medios
deja un evento de expedición en la operación: la expedición es de Facturación.
- Sin la migración 0050 o sin `fin_documents`, el formulario anterior (solo referencia) sigue funcionando.
