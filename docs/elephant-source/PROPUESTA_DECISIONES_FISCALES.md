# Propuesta de decisiones fiscales 1 a 8 (para aprobar o enviar al asesor)

**Estado (21/10/2026): PROPUESTA. Nada de esto está aprobado ni activado.** Es la recomendación técnica y operativa de Elephant Source sobre las decisiones 1 a 8 de `DECISIONES_PROPIETARIO.md`. No es asesoramiento fiscal: cada decisión termina con la validación concreta que necesitamos del asesor. Base: `MATRIZ_FISCAL_INTERNACIONAL.md`.

## Hechos comprobados hoy

| Hecho | Comprobación |
|---|---|
| Emisor | IRON ELEPHANT CONSULTING, S.L., NIF B26987875, Calle Corazón de María 57, 1.º D, 28002 Madrid (sede configurada en Stripe Tax) |
| Stripe Tax | Activo, código por defecto `txcd_10103001` (SaaS, uso empresarial) y **0 registros** |
| **NIF-IVA en VIES** | **`ESB26987875` no es válido en VIES** (consulta pública del 21/10/2026, 07:32 UTC). La empresa no figura en el **Registro de Operadores Intracomunitarios (ROI)** |
| Precios | 4 precios live **sin IVA** (`tax_behavior: exclusive`): Essential 29 €/mes y 279 €/año; Business 79 €/mes y 759 €/año |
| VERI\*FACTU | Vigente: **1/1/2027** para contribuyentes del Impuesto sobre Sociedades (RDL 15/2025). El aplazamiento a octubre de 2028 está **anunciado (nota del 5/10/2026) pero no publicado en el BOE** |

**Consecuencia del ROI:** sin alta en el ROI, una empresa de otro Estado de la UE no puede comprobar nuestro NIF-IVA y nosotros no podemos facturarle con inversión del sujeto pasivo. Por eso las empresas de la UE quedan fuera de la primera ola.

## Resumen de la propuesta

| Ola | Escenarios | Requisitos |
|---|---|---|
| **1. Primera venta** | Empresas y profesionales de la Península y Baleares (`business:es_mainland`) | Decisiones 2, 6 y 7 aprobadas; condiciones B2B publicadas |
| **2. Ampliación B2B** | Empresas de Canarias, Ceuta y Melilla (`business:es_special`); empresas de Reino Unido, Suiza, Noruega, Andorra y EE. UU. (`business:non_eu`); empresas de la UE (`business:eu`) **tras el alta en el ROI** | Decisiones 4 y 5; alta en el ROI (modelo 036) |
| **3. Particulares en España** | `consumer:es_mainland` | Textos B2C aprobados (decisiones 9 y 10); precio final con IVA |
| **4. Particulares en la UE** | `consumer:eu` | Alta en OSS (decisión 3) |
| Fuera de alcance | Particulares de Canarias, Ceuta, Melilla y fuera de la UE; territorios especiales de la UE | Análisis propio por territorio |

---

## Decisión 1. Territorios y tipos de cliente que se abren

**Recomendación:** abrir por olas. La **primera venta, solo con empresas y profesionales de la Península y Baleares**.

**Justificación:**
- Es el único escenario que no depende de ningún registro adicional: IVA español al 21 %, factura completa y modelo 303. El circuito se valida de principio a fin con el menor riesgo.
- La UE B2B exige el alta en el ROI, que hoy no existe (hecho comprobado).
- B2C exige textos de consumo aprobados, precio con IVA visible y la política de desistimiento.
- El sistema ya bloquea cada escenario por separado: abrir uno no abre los demás.

**Qué cambia en Stripe Tax:** nada más que la decisión 2.

**Qué cambia en la facturación:** facturas completas con IVA del 21 % y NIF del cliente obligatorio (el sistema ya lo exige y lo fija en el cliente de Stripe).

**Configuración de la ola 1:**
```
CP_STRIPE_FISCAL_SCENARIOS=business:es_mainland
CP_STRIPE_TAX_EXPECTATIONS=business:es_mainland=taxed
```

**Validación del asesor:** que las ventas de suscripciones SaaS a empresas y profesionales de la Península y Baleares tributan al 21 % (servicio prestado por vía electrónica, localizado en el TAI) y que no hay ninguna obligación adicional al modelo 303.

## Decisión 2. IVA español en Stripe Tax

**Recomendación:** registrar **España, régimen nacional (`standard`)** en Stripe Tax, con efecto inmediato, y fijar `CP_STRIPE_TAX_POLICY=stripe_tax_exclusive`.

**Justificación:**
- Sin registro, Stripe Tax no calcula IVA: hoy cobraría sin impuesto. El sistema lo impide en `live` (`tax_policy_pending`), pero la causa se corrige así.
- Los precios ya están definidos **sin IVA** (`exclusive`), coherentes con la venta B2B.
- El sistema contrasta cada factura de Stripe con el tratamiento esperado del escenario (`invoice_tax_mismatch`), así que un cálculo inesperado genera una alerta.

**Qué cambia en Stripe Tax:**
- Un registro `ES` de tipo `standard` (Dashboard → Tax → Registrations, o `POST /v1/tax/registrations` con `country=ES`, `country_options[es][type]=standard`, `active_from=now`).
- Se mantiene el código de producto por defecto `txcd_10103001` (SaaS, uso empresarial). Para B2C (ola 3) se usará `txcd_10103000` (SaaS, uso personal) en el cliente o en la línea, si el asesor lo considera necesario: en España ambos tributan al 21 %.

**Qué cambia en la facturación:** las facturas de clientes de España llevan IVA del 21 % desglosado (base, tipo y cuota).

**Comprobación técnica antes de abrir:** una vista previa de factura (sin cobro) para un cliente ficticio con NIF español, y verificar 21 %. Lo hace el equipo técnico con la clave del sistema.

**Validación del asesor:** confirmar que procede el registro nacional en Stripe Tax y la fecha de efecto. No hace falta ningún trámite ante la AEAT para esto: la empresa ya está dada de alta en el IVA.

## Decisión 3. Particulares de la UE

**Recomendación:** no abrir particulares de la UE hasta que la empresa se dé de alta en la **OSS, régimen de la Unión** (modelo 035), y entonces aplicar **desde el primer euro el IVA del país del cliente**, sin usar el umbral de 10.000 €.

**Justificación:**
- Con el umbral, hay que vigilar las ventas a distancia acumuladas en toda la UE y cambiar de régimen a mitad de año al superarlo. Es propenso a errores y obliga a rehacer precios finales.
- Con OSS desde el inicio, Stripe Tax aplica el tipo de cada país automáticamente y se presenta una sola declaración trimestral (modelo 369).
- La opción de no aplicar el umbral vincula al menos dos años naturales: es una decisión consciente, que confirma el asesor.

**Qué cambia en Stripe Tax:** un segundo registro `ES` de tipo `oss_union`. Stripe Tax pasa a calcular el IVA del país del consumidor.

**Qué cambia en la facturación:** las facturas a particulares de la UE llevan el tipo del país del cliente. Hay que conservar dos pruebas de su ubicación (dirección de facturación y país de la tarjeta, que Stripe ya registra).

**Configuración (ola 4):**
```
CP_STRIPE_FISCAL_SCENARIOS=…,consumer:eu
CP_STRIPE_TAX_EXPECTATIONS=…,consumer:eu=taxed
CP_STRIPE_SCENARIO_COUNTRIES=consumer:eu=<países validados>
CP_STRIPE_CONSUMER_RATES=<un tipo por país, del momento de la apertura>
```

**Validación del asesor:** alta en la OSS y renuncia al umbral (o, si lo prefiere, aplicar el umbral). Lista inicial de países y tipos.

## Decisión 4. Canarias, Ceuta y Melilla

**Recomendación:**
- **Empresas: abrir (ola 2) como operación no sujeta al IVA español**, con la mención correspondiente en la factura.
- **Particulares: mantener bloqueados.**

**Justificación:**
- Un servicio a una empresa se localiza donde está establecida (art. 69.Uno.1.º LIVA). Canarias, Ceuta y Melilla están fuera del territorio de aplicación del IVA, así que no hay IVA español.
- En Canarias, la empresa destinataria autoliquida el IGIC por inversión del sujeto pasivo. Eso no exige ningún registro nuestro.
- Los servicios electrónicos a **consumidores** canarios están sujetos al IGIC, y el prestador no establecido puede tener que darse de alta. Ceuta y Melilla tienen el IPSI. No compensa abrirlo sin un análisis propio.

**Qué cambia en Stripe Tax:** nada. **Comprobación técnica antes de abrir:** vista previa de factura para un código postal 35/38, 51 y 52, y verificar que Stripe no aplica el 21 %. Si lo aplica, se abre con `CP_STRIPE_TAX_EXPECTATIONS=business:es_special=not_subject` y el sistema rechaza la factura por discrepancia, de modo que no se cobraría mal.

**Qué cambia en la facturación:** mención propuesta: «Operación no sujeta al IVA (art. 69.Uno.1.º de la Ley 37/1992). Destinatario establecido fuera del territorio de aplicación del impuesto».

**Configuración (ola 2):**
```
CP_STRIPE_FISCAL_SCENARIOS=…,business:es_special
CP_STRIPE_TAX_EXPECTATIONS=…,business:es_special=not_subject
```

**Validación del asesor:** el texto de la mención, y si hay alguna obligación formal del IGIC o del IPSI para nosotros como prestadores B2B.

## Decisión 5. Reino Unido y terceros países

**Recomendación:**
- **Empresas: abrir (ola 2)** para una lista cerrada: Reino Unido, Suiza, Noruega, Andorra y Estados Unidos (`GB|CH|NO|AD|US`), como operación no sujeta al IVA español.
- **Particulares de fuera de la UE: no abrir.**

**Justificación:**
- B2B fuera de la UE: no sujeto (art. 69.Uno.1.º LIVA). El cliente autoliquida si su país lo exige y no se necesita ningún registro nuestro. El sistema exige su identificador fiscal.
- Particulares: el Reino Unido exige registrarse en HMRC desde la primera venta. Suiza y Noruega tienen umbrales. Estados Unidos grava el SaaS de forma distinta en cada estado. Ninguno compensa en esta fase.

**Qué cambia en Stripe Tax:** nada (Stripe trata estas ventas como fuera del ámbito del registro español). La misma comprobación de vista previa que en la decisión 4.

**Qué cambia en la facturación:** mención propuesta: «Operación no sujeta al IVA (art. 69.Uno.1.º de la Ley 37/1992)».

**Configuración (ola 2):**
```
CP_STRIPE_FISCAL_SCENARIOS=…,business:non_eu
CP_STRIPE_TAX_EXPECTATIONS=…,business:non_eu=not_subject
CP_STRIPE_SCENARIO_COUNTRIES=business:non_eu=GB|CH|NO|AD|US
```

**Validación del asesor:** la lista de países, la mención y la prueba de la condición de empresa (el identificador fiscal que pedimos).

**Empresas de la UE (`business:eu`) en la ola 2:** requiere primero el **alta en el ROI** (modelo 036). Después, inversión del sujeto pasivo con el NIF-IVA del cliente verificado en VIES (ya implementado), la mención «Inversión del sujeto pasivo» y la declaración en el **modelo 349**.

## Decisión 6. Factura legal (DF-2)

**Recomendación:** que **Stripe Invoicing sea el sistema de emisión de facturas hasta la fecha de obligación de VERI\*FACTU**, con el contenido completo del Reglamento de facturación (RD 1619/2012). **Antes de esa fecha**, conectar un software de facturación que cumpla VERI\*FACTU, o confirmar por escrito que Stripe lo cumple para obligados españoles.

**Justificación:**
- Hoy no hay obligación VERI\*FACTU vigente. Stripe ya genera una factura numerada por cada cobro, con base, tipo y cuota, y el sistema guarda su referencia (`fiscal_documents`).
- Emitir con un segundo sistema desde el primer día duplica el trabajo sin beneficio hasta 2027.
- El PDF de Stripe **no** se presenta como factura válida hasta que el asesor confirme su contenido (regla ya fijada).

**Qué cambia en Stripe:** ajustes de facturación (Dashboard → Settings → Invoices):
- nombre fiscal del emisor;
- NIF `B26987875` visible en la factura;
- domicilio fiscal;
- prefijo de numeración (decisión 7);
- pie con los datos registrales (decisión 12).

**Qué cambia en la facturación:** las facturas de Stripe pasan a ser las facturas legales. Contenido mínimo a comprobar en la primera factura de prueba:
- número y serie;
- fecha de expedición;
- emisor y destinatario, con NIF y domicilio;
- descripción del servicio y periodo;
- base imponible, tipo, cuota y total;
- mención de no sujeción o de inversión cuando proceda.

**Validación del asesor:** que la factura de Stripe con ese contenido cumple el RD 1619/2012, y la fecha límite para tener el software VERI\*FACTU.

## Decisión 7. Series y rectificativas (DF-4)

**Recomendación:**
- **Serie ordinaria única** con numeración **secuencial a nivel de cuenta** en Stripe y prefijo `ES` (por ejemplo, `ES-0001`). Opcionalmente, un prefijo con el año.
- **Rectificativas: notas de crédito de Stripe** (abono total o parcial) vinculadas a la factura original, cuyo número deriva de ella (`ES-0001-CN-01`).

**Justificación:**
- La numeración por cuenta garantiza una sola secuencia correlativa sin huecos.
- La nota de crédito queda enlazada a la factura que rectifica, con importe y motivo, que es lo que exige el art. 15 del RD 1619/2012. El sistema ya registra la rectificativa como `pending` en `fiscal_documents` al reembolsar.

**Qué cambia en Stripe:** Settings → Invoices → numeración «Account level» y prefijo. Notas de crédito activadas, con el motivo en la nota.

**Qué cambia en la facturación:** cada reembolso o corrección se documenta con una nota de crédito con la mención «Factura rectificativa de la factura n.º X (art. 80 de la Ley 37/1992)».

**Validación del asesor:** si la numeración derivada de las notas de crédito cumple el requisito de **serie separada** para las rectificativas. Si no lo cumple, las rectificativas se emiten fuera de Stripe con su propia serie (`R-`).

## Decisión 8. VERI\*FACTU

**Recomendación:** **planificar como fecha obligatoria el 1/1/2027** (RDL 15/2025) y elegir el software antes del **30/11/2026**. Solo se moverá si el aplazamiento a octubre de 2028 se publica en el BOE.

**Justificación:**
- El aplazamiento solo está anunciado.
- Si no se publica, tener el software listo evita emitir en 2027 con un sistema no conforme.
- La integración técnica es acotada: el sistema ya emite un evento por cada cobro y cada reembolso, que se enviaría al software.

**Qué cambia en Stripe Tax:** nada.

**Qué cambia en la facturación:** desde la fecha de obligación, la factura legal la emite el software conforme (con su registro y código QR) y Stripe queda como pasarela de pago.

**Validación del asesor:** confirmar la fecha aplicable a IRON ELEPHANT CONSULTING, S.L., que no está acogida al SII y qué software recomienda.

---

## Qué falta para la primera venta (ola 1)

1. **Aprobación** de las decisiones 1, 2, 6 y 7 (asesor y propietario).
2. **Registro de España en Stripe Tax** (decisión 2) y ajustes de facturación de Stripe (decisiones 6 y 7).
3. **Condiciones B2B publicadas** (`PROPUESTA_TEXTOS_LEGALES.md`, parte A) y sus variables `CP_TERMS_*`.
4. **Configuración técnica** que aplicará el equipo una vez aprobado todo:
   ```
   CP_STRIPE_TAX_POLICY=stripe_tax_exclusive
   CP_STRIPE_FISCAL_SCENARIOS=business:es_mainland
   CP_STRIPE_TAX_EXPECTATIONS=business:es_mainland=taxed
   ```
5. **Primera compra controlada** con autorización expresa (`APERTURA_COMERCIAL.md` §3).
