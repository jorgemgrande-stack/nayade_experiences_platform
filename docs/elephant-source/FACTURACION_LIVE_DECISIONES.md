# Elephant Source · Cobro, facturación y fiscalidad en `live`: estado técnico y decisiones pendientes (19/10/2026)

**Para:** el propietario de IRON ELEPHANT CONSULTING, S.L. y su asesor fiscal y legal.

**Alcance:** contratación de Essential y Business con Stripe live, para empresas y profesionales (B2B) y para particulares (B2C).

Aquí no se toma ninguna decisión fiscal ni jurídica. Cada decisión dice qué implica técnicamente y qué prueba queda después.

Complementa `FISCALIDAD_STRIPE.md` (DF-1 resuelta; DF-2…DF-8) y `CONTRATACION_B2B_B2C.md` (diseño técnico B2B/B2C).

**Situación hoy:**
- Stripe live conectado.
- Checkout bloqueado (`tax_policy_pending`).
- Ningún escenario fiscal aprobado.
- Contratación pública cerrada.
- `MAIL_MODE=off`.
- 0 clientes, 0 suscripciones, 0 cobros.

## 1. Estado técnico pieza a pieza

Comprobado con el código (`live` corre `b1e3786`) y con lecturas de la cuenta real.

**Leyenda:**
- ✅ funciona y está probado;
- ⚠️ listo en el código, pero pendiente de decisión o configuración;
- ❌ falta.

| Pieza | Estado | Detalle |
|---|---|---|
| Planes mensuales y anuales | ✅ | 4 precios live sin IVA (`exclusive`), enlazados con los `web_prices` 1–4: Essential 29 €/mes y 279 €/año; Business 79 €/mes y 759 €/año |
| Comprador B2B y B2C | ⚠️ | PR #153: perfil fiscal por pedido, territorio, 10 escenarios bloqueados hasta aprobarlos, consentimiento con versiones. Pendiente de merge, de la migración 0014 y de las pantallas del CRM y la web |
| IVA (Stripe Tax) | ⚠️ | Código listo (`stripe_tax_exclusive`: `automatic_tax`; confirmación por **subtotal sin IVA**). **0 registros fiscales** en la cuenta (H1) |
| Facturas | ⚠️ | Las emite Stripe Invoicing. Pendientes DF-2 (factura legal), DF-4 (series) y VeriFactu (§5) |
| Abonos y rectificativas | ❌ | Los reembolsos se registran (`stripe_charge_adjustments`) y retienen el servicio si se pierde la cobertura, pero no se emite ningún documento rectificativo (D-10) |
| Cambios de plan | ❌ | El Portal live los tiene desactivados y el procesador rechaza cambios hechos fuera de un Checkout del pedido (H2, D-11) |
| Cancelaciones | ✅ | Portal, a final de periodo, sin prorrateo y con motivo → cancelación programada → fin. Deshacerla reactiva |
| Renovaciones | ✅ | `invoice.paid` (`subscription_cycle`) → pago de renovación, pedido renovado y avisos (con el correo encendido) |
| Impagos | ⚠️ | Gracia de **7 días** (`GRACE_DAYS`), después suspensión; el pago recuperado reactiva; nunca se borran datos. **No hay reintentos propios** (`autoCharge=false`): los hace Stripe. Falta configurar Revenue recovery en el Dashboard (D-13) |
| Reembolsos | ⚠️ | Desde el Dashboard (la clave del sistema no reembolsa). Total o disputa perdida → retención; parcial o disputa abierta → aviso |
| Prueba gratuita | ✅ | 15 días (`TRIAL_DAYS`), sin tarjeta; conversión por Checkout (`trial_conversion`) con el tenant de la prueba. Registro público apagado |
| Aprobación sin pago | ⚠️ | PR #154: en live, categoría, motivo, referencia si el cobro es externo, nunca con un cobro en curso, e incidencia por cada una |
| Conciliación y webhook | ✅ | Firma, antigüedad, tamaño, idempotencia, persistencia antes del 200, reintentos con espera, recuperación de webhooks perdidos y lectura del estado actual (orden indiferente). Probado en live salvo un evento real firmado (§8) |

## 2. Hallazgos técnicos

| # | Hallazgo | Estado |
|---|---|---|
| H1 | Stripe Tax activo (sede Madrid; código por defecto `txcd_10103001`, SaaS para empresas) con **0 registros**: hoy se cobraría sin IVA | Pendiente D-9. La comprobación se hace con el MCP, porque la clave del sistema no lee registros a propósito |
| H2 | Cambios de plan sin camino operativo | Pendiente D-11. Diseño en §6 |
| H3 | Reembolsos sin documento rectificativo | Pendiente D-10 |
| H4 | Portal live sin URL de condiciones y privacidad | Con los textos legales |
| H5 | Aprobación administrativa sin pago, poco controlada | **PR #154** |
| H6 | Conciliación apagada en live | **Corregido** (`worker=true`) |
| H7 | Primera clave live sin Events, Charges ni Disputes | **Corregido** (clave v2; la antigua revocada) |
| H8 | El Checkout no distinguía empresa y particular ni territorio | **PR #153** |
| H9 | En la contratación en línea, un consentimiento incompleto se detectaba tras crear la empresa y el pedido | **Corregido en PR #153** (encontrado por las pruebas) |

## 3. Matriz fiscal (para el asesor; nada está activo)

Para cada escenario:
- la **información** que se recoge (PR #153);
- la **regla propuesta como hipótesis**, a confirmar;
- de qué **depende**;
- qué **valida** técnicamente el sistema.

**Ningún escenario se cobra hasta añadirlo a `CP_STRIPE_FISCAL_SCENARIOS`.**

| Escenario | Información | Hipótesis a confirmar | Depende de | Validación técnica |
|---|---|---|---|---|
| `business:es_mainland` (empresa, península y Baleares) | Razón social, NIF, país y CP | IVA español al tipo general sobre servicios prestados por vía electrónica | Registro de España en Stripe Tax (D-9) | NIF obligatorio en Checkout; aviso si la factura no lleva NIF |
| `consumer:es_mainland` (particular, península y Baleares) | Nombre, país y CP; NIF opcional | IVA español; precio final con impuestos visible antes de pagar (normativa de consumo) | D-9, DF-5, DF-8 (precio con IVA) y requisitos B2C (§4) | Bloqueado sin decisión legal sobre el desistimiento y sin información precontractual |
| `business:es_special` (empresa, Canarias, Ceuta o Melilla) | Igual que la península | Fuera del territorio de aplicación del IVA; impuestos locales (IGIC/IPSI) según el caso | DF-7 | Se detecta por el código postal (35/38, 51, 52) |
| `consumer:es_special` | Igual | Igual que la fila anterior, con los requisitos B2C | DF-7, DF-5 | Igual |
| `business:eu` (empresa UE) | Razón social, VAT ID, país y CP | Inversión del sujeto pasivo si el VAT ID es **válido** (VIES); si no, como particular | Validación VIES, que no es responsabilidad de este sistema (D-14) | VAT ID obligatorio; se guarda como `unverified` |
| `consumer:eu` (particular UE) | Nombre, país y CP | IVA del país del cliente (servicios electrónicos), en general mediante OSS | Alta en OSS (D-9), DF-6 | Bloqueado sin decisión |
| `business:eu_special` y `consumer:eu_special` (DOM franceses, Büsingen, Livigno, Monte Athos, Åland…) | Igual que la UE | Fuera del IVA comunitario; tratamiento específico | DF-6, DF-7 | Se detecta por país (AX) y código postal |
| `business:non_eu` (empresa fuera de la UE) | Razón social, identificador fiscal, país | En general, no sujeto a IVA español; posibles impuestos locales del país del cliente | DF-6 | Identificador fiscal obligatorio |
| `consumer:non_eu` (particular fuera de la UE) | Nombre, país | Posibles obligaciones fiscales en el país del cliente (algunos países gravan servicios digitales a consumidores) | DF-6 | Bloqueado sin decisión |

**Nota para el asesor:**
- Stripe Tax **calcula** el impuesto donde la cuenta tiene registro. **No sustituye** la determinación fiscal, ni los registros ante las administraciones, ni la contabilidad.
- El sistema separa la **residencia declarada** (perfil) de la **dirección facturada** (Stripe) y avisa si no casan (`stripe.buyer_territory_mismatch`).

## 4. Contratación con particulares (B2C): requisitos previstos

Los implementa la PR #153 con bloqueo por defecto. Los textos los aporta el asesor legal.

- **Información precontractual** publicada y versionada (`CP_PRECONTRACT_VERSION`), con confirmación separada.
- **Precio final con impuestos** visible antes del pago (DF-8).
- **Desistimiento:** decisión legal sobre la ejecución inmediata del servicio digital y el reconocimiento del consumidor (`CP_CONSUMER_WITHDRAWAL`). Mientras esté en `pending`, los particulares no pueden contratar.
- **Renovación automática:** información clara de la renovación y de cómo cancelar (Portal: cancelación a final de periodo).
- **Registro verificable:** versión, fecha, origen (web u operador) y huella de cada aceptación, con historial por versión.

## 5. Facturación, abonos y VeriFactu

**Circuito documental previsto** (depende de DF-2):

| Hecho | Documento | Hoy |
|---|---|---|
| Alta, renovación | Factura (Stripe Invoicing) | Se emite en Stripe; aviso «factura disponible» |
| Cambio de plan | Factura del prorrateo | Sin camino operativo (H2) |
| Reembolso parcial o total | **Factura rectificativa** o documento exigible | ❌ (D-10) |
| Impago y recuperación | La misma factura pasa a pagada | ✅ (estados de Stripe) |
| Corrección de datos fiscales | Rectificativa | ❌ (D-10) |
| Cobro fuera de Stripe (`offline_payment`) | Factura en el sistema de facturación | Referencia registrada (PR #154) |

**Trazabilidad que ya existe:**
- pedido, empresa, suscripción, `invoice_id` de Stripe, moneda, importe cobrado e impuestos (en el log de cada pago);
- estado del cargo (reembolsos y disputas) e historial de eventos;
- idempotencia por factura.

**Falta:** guardar base, impuesto y total de cada factura en una tabla propia si DF-2 decide que la factura legal la emite otro sistema.

**VeriFactu.** Calendario vigente según el Real Decreto-ley 15/2025, publicado en el BOE del 3/12/2025:
- **1 de enero de 2027** para quienes tributan en el Impuesto sobre Sociedades, como IRON ELEPHANT CONSULTING, S.L.;
- **1 de julio de 2027** para el resto de obligados.

Hacienda anunció el 5/10/2026 un nuevo aplazamiento a 2028 que, a 17/10/2026, **no está en el BOE**. **Hay que confirmarlo en el BOE y en la sede de la AEAT antes de decidir.** Están exentos, entre otros, los obligados al SII.

Fuentes: [Auris Legal](https://auris.legal/en/nuevo-aplazamiento-del-reglamento-verifactu-la-aplicacion-obligatoria-se-retrasa-a-2027/), [SF Abogados](https://www.sfabogados.com/publicaciones/verifactu-se-aplaza-a-2027), [Webpsilon](https://www.webpsilon.com/blog/verifactu-que-es-cuando-entra-en-vigor-y-a-quien-afecta/).

**Implicación (D-12):**
- Si la factura legal la emite **Stripe Invoicing**, ese es el sistema informático de facturación de la empresa, y habría que comprobar con el asesor si cumple o cómo se integra.
- La alternativa es un **software de facturación que cumpla VeriFactu**. Stripe quedaría como pasarela, y este sistema enviaría cada cobro y cada reembolso a ese software.

**Elephant Source no implementa hoy VeriFactu y no se debe afirmar que lo cumpla.**

## 6. Ciclo de vida de la suscripción

| Proceso | Estado | Diseño o pendiente |
|---|---|---|
| Prueba de 15 días sin tarjeta, conversión y activación tras el pago | ✅ | Registro público apagado |
| Doble alta | ✅ | Un pedido de alta abierto por empresa; idempotencia por clave; un Customer por empresa |
| Subida o bajada de plan, mensual ↔ anual | ❌ (D-11) | Opciones: (a) Portal con `subscription_update` y prorrateo; el procesador acepta el precio si está en el catálogo enlazado y la licencia se ajusta al plan nuevo. (b) Solo por el equipo, con un pedido `change` y su pago. En los dos casos, una bajada se aplica a final de periodo y nunca borra datos |
| Cancelación al final del periodo y reactivación | ✅ | Portal |
| Cancelación inmediata | Por decidir | Solo desde el Dashboard (`applyExternalBilling` la refleja) |
| Impago: gracia de 7 días y suspensión | ✅ | Política sujeta a confirmación (D-13) |
| Conservación y exportación de datos | Por decidir | Política de datos tras la baja (Ventana 3) |

**Revenue recovery (D-13):** los reintentos los hace **solo Stripe** (Smart Retries). Elephant Source no cobra por su cuenta, así que no hay duplicidad. Recomendación: después del último intento, marcar la suscripción como `unpaid`.

## 7. Portal del cliente

**Hoy permite:**
- facturas;
- método de pago;
- cancelación a final de periodo con motivo.

**Hoy no permite:**
- cambio de plan (D-11);
- edición de datos de facturación (afecta a DF-2 y D-10);
- pausa.

**Falta:** las URL legales (H4). No se activa ninguna opción con efecto económico sin autorización.

## 8. Pruebas realizadas (19/10/2026)

Las pruebas simuladas **no** equivalen a operaciones verificadas contra Stripe live.

- **Contra Stripe live, sin dinero:**
  - permisos de la clave (10 recursos);
  - catálogo (4 enlazados, 0 discordancias);
  - conciliación (`200`, sin errores);
  - webhook: firma falsa → 400, marca de tiempo antigua → 400, más de 1 MB → 413, otro método → 401.
  - **Falta:** un evento real firmado. La prueba sin coste (crear y caducar una sesión de Checkout) la bloquea el sistema de permisos.
- **Automáticas** (dobles de Stripe y MySQL 8.4 desechable), por escenario:
  - B2B y B2C en España, Canarias, Ceuta, Melilla, la UE (con y sin código postal), territorios especiales y fuera de la UE;
  - escenario pendiente y aprobado;
  - consentimientos;
  - alta, pago y activación;
  - webhook duplicado y fuera de orden;
  - webhook perdido (conciliación);
  - evento de otro entorno y de otro modo;
  - suscripción de otra empresa;
  - fallo temporal de Stripe y de BD con reintento;
  - impago y recuperación;
  - reembolso parcial y total;
  - disputa;
  - renovación;
  - aprobación sin pago.
- **Sin cubrir, a la espera de decisiones:** cambios de plan (D-11), rectificativas (D-10) y validación de VAT ID (D-14).

## 9. Sandbox de integración (`production`)

Stripe está **desactivado de forma explícita**: sin `CP_STRIPE_MODE`, clave ni secreto. Sus credenciales se sobrescribieron en el incidente del 19/10.

**Pasos mínimos del propietario (unos 10 minutos)**, en el **sandbox** de Stripe (`acct_1URULO5wMYhQ9O0d`):
1. Crear una clave restringida `rk_test_` con los mismos 10 permisos que la de live.
2. Webhooks → destino `we_1URwYC5wMYhQ9O0dtLgZjBsu` → **Reveal** del secreto.
3. Guardar las dos en Railway, entorno **`production`** → `controlplane` (`CP_STRIPE_API_KEY` y `CP_STRIPE_WEBHOOK_SECRET`), con `--skip-deploys`.
4. Avisar. La ventana de Stripe fija `CP_STRIPE_MODE=test`, despliega y verifica.

**Nunca usar credenciales live** en este entorno.

## 10. Decisiones pendientes y orden de aprobación propuesto

| Orden | # | Decisión | Tipo | Riesgo si se retrasa | Implementación técnica después |
|---|---|---|---|---|---|
| 1 | DF-5 | ¿B2B, B2C o ambos al abrir? | Empresarial y legal | Sin ella no se sabe qué escenarios abrir | Lista de escenarios |
| 2 | DF-2 + D-12 | Quién emite la factura legal y cómo se cumple VeriFactu | Fiscal | Facturas no válidas; VeriFactu desde el 1/1/2027 salvo aplazamiento | Configurar Stripe Invoicing, o integrar un software certificado |
| 3 | D-9 + DF-3 | Registros en Stripe Tax (España; OSS si hay B2C en la UE) | Fiscal | Cobro sin IVA (H1) | Registro en el Dashboard; `CP_STRIPE_TAX_POLICY=stripe_tax_exclusive` |
| 4 | DF-6, DF-7 | Mercados y territorios especiales | Fiscal y empresarial | Cobros con tratamiento dudoso | `CP_STRIPE_FISCAL_SCENARIOS` |
| 5 | DF-8 | Precio publicado sin o con IVA | Empresarial, legal (B2C) | Incumplir la normativa de consumo en B2C | Precios con IVA (Prices nuevos) si B2C |
| 6 | Textos | Condiciones, privacidad, precontractual y desistimiento | Legal | Sin ellos no se puede contratar | `CP_TERMS_VERSION`, `CP_PRIVACY_VERSION`, `CP_PRECONTRACT_VERSION`, `CP_CONSUMER_WITHDRAWAL`; URL del Portal |
| 7 | D-10 | Abonos y rectificativas | Fiscal | Reembolsos sin documento | Procedimiento y, si es en Stripe, notas de crédito |
| 8 | DF-4 | Series de numeración | Fiscal | — | Prefijo en Stripe |
| 9 | D-13 | Recuperación de impagos | Empresarial | Suspensiones mal sincronizadas | Revenue recovery en el Dashboard |
| 10 | D-11 | Cambios de plan | Empresarial | Clientes que no pueden cambiar sin intervención | Portal o procedimiento; ajuste de código |
| 11 | D-14 | Validación de VAT ID (VIES) para la inversión del sujeto pasivo | Fiscal | Inversión aplicada a quien no corresponde | Proceso o servicio de validación |

## 11. Qué falta exactamente para el primer cobro real

1. Decisiones 1–6 de la tabla anterior.
2. Merge y despliegue aprobado de #153 y #154, con la migración 0014 en live (copia y simulación previas).
3. Pantallas del CRM (perfil fiscal y aprobación tipificada) y, si hay autoservicio, de la web.
4. `CP_STRIPE_TAX_POLICY`, `CP_STRIPE_FISCAL_SCENARIOS` y las versiones legales, con autorización expresa.
5. Correo transaccional: SPF con Brevo, clave de Brevo en live y `MAIL_MODE` real (autorización).
6. `CP_STRIPE_CHECKOUT_ENABLED=1` y autorización del primer cobro.
