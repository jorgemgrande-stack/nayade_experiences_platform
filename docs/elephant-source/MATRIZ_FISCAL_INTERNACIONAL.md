# Matriz fiscal y elegibilidad de cobro: lanzamiento B2B y B2C internacional

**Estado (20/10/2026):** el control de elegibilidad está implementado (`server/stripe/eligibility.ts`). **Ninguna celda de la matriz está aprobada en producción.** Cada escenario se abre solo con configuración expresa, después de que el asesor fiscal y, en B2C, el jurídico validen su fila.

> Esta matriz es una **propuesta técnica para revisión**, no asesoramiento fiscal. Las obligaciones (registros, umbrales, declaraciones y menciones en factura) cambian y **las tiene que confirmar el asesor**. Stripe Tax calcula el impuesto con los registros que haya en la cuenta, pero **no da de alta registros ni presenta declaraciones**. Hoy la cuenta live no tiene ningún registro.

## 1. Objetivo del propietario y cómo se abre

El lanzamiento objetivo incluye B2B y B2C en la Península y Baleares, en Canarias, Ceuta y Melilla, en la UE, en el Reino Unido y en otros países. Cada combinación de **tipo de cliente × territorio** es un **escenario**, y solo se cobra si:

1. el escenario está aprobado (`CP_STRIPE_FISCAL_SCENARIOS`);
2. tiene el tratamiento del impuesto declarado (`CP_STRIPE_TAX_EXPECTATIONS`), que el sistema contrasta con cada factura de Stripe;
3. el país está habilitado (`CP_STRIPE_SCENARIO_COUNTRIES`). Fuera de la UE y en los territorios especiales de la UE, **sin lista no se cobra a ningún país**;
4. el identificador fiscal tiene una forma válida (obligatorio para empresas);
5. en particulares: la decisión sobre el desistimiento, la información precontractual publicada y un **tipo decidido** para mostrar el precio final (`CP_STRIPE_CONSUMER_RATES`);
6. en live, el domicilio de facturación está completo. Se fija en Stripe y el cliente no lo puede cambiar en Checkout.

Lo que no cumple **queda bloqueado antes de crear nada**: ni empresa, ni pedido, ni Customer de Stripe. La web puede consultarlo antes en `POST /cp/v1/public/checkout/eligibility`, que devuelve los motivos y el precio final.

## 2. Matriz por jurisdicción

Leyenda del **estado propuesto**:
- 🟢 se puede abrir cuando el asesor confirme la fila;
- 🟡 requiere un registro, umbral o decisión antes de abrir;
- 🔴 bloqueado hasta un análisis propio.

| # | Escenario | País o territorio | Impuesto y tratamiento | Expectativa | Obligaciones y requisitos | Estado propuesto |
|---|---|---|---|---|---|---|
| 1 | `business:es_mainland` | Península y Baleares | IVA español 21 % | `taxed` | Modelo 303; NIF del cliente en la factura | 🟢 Registro de España en Stripe Tax |
| 2 | `consumer:es_mainland` | Península y Baleares | IVA español 21 % | `taxed` | Modelo 303; **precio final con IVA** (29 € → 35,09 €); información precontractual; desistimiento | 🟡 Decisión legal B2C (§3) |
| 3 | `business:es_special` | Canarias, Ceuta y Melilla | **No sujeto a IVA** (fuera del territorio de aplicación del impuesto). En Canarias, el IGIC lo autoliquida la empresa destinataria (inversión) | `not_subject` | Mención «operación no sujeta a IVA» y el motivo; posible obligación informativa | 🟡 Confirmar menciones y el IGIC con el asesor |
| 4 | `consumer:es_special` | Canarias, Ceuta y Melilla | No sujeto a IVA. **Canarias: el IGIC grava los servicios electrónicos a consumidores canarios y puede exigir alta en el IGIC.** Ceuta y Melilla: IPSI | `not_subject` (IVA) | Posible registro en el IGIC o el IPSI | 🔴 Análisis propio |
| 5 | `business:eu` | Estados de la UE | Sin IVA español: **inversión del sujeto pasivo** (lo declara el cliente) | `reverse_charge` | **NIF-IVA válido en VIES** al facturar; mención «Inversión del sujeto pasivo»; **modelo 349** | 🟢 Comprobación VIES (§4) |
| 6 | `consumer:eu` | Estados de la UE | **Hasta 10.000 €/año** de ventas a distancia a consumidores de toda la UE: IVA español 21 %. **Por encima, o por opción:** IVA del país del cliente mediante **OSS**, régimen de la Unión, modelo 369 | `taxed` | Dos pruebas no contradictorias del país del cliente; vigilar el umbral; con OSS, registro OSS en Stripe Tax y tipo de cada país | 🟡 Decidir: IVA español hasta el umbral u OSS desde el inicio |
| 7 | `business:eu_special` y `consumer:eu_special` | Territorios de Estados de la UE excluidos del IVA (ultramar francés, Åland, Monte Athos…) | Caso a caso | — | — | 🔴 Bloqueado; sin lista de países no se cobra |
| 8 | `business:non_eu` | Reino Unido, Suiza, EE. UU. y otros | **No sujeto** al IVA español (art. 69 LIVA); el cliente autoliquida si su país lo exige | `not_subject` | Prueba de que es empresa (identificador fiscal); mención «operación no sujeta»; casilla de no sujetas del 303. **Algunos países exigen registro también en B2B o retenciones** | 🟢 Por lista de países: proponer GB, CH, US, CA, AU, NO y AD tras validarlos |
| 9 | `consumer:non_eu` (Reino Unido) | Reino Unido | **IVA británico 20 %** a cargo del vendedor no establecido, **desde la primera venta (sin umbral)** | `taxed` | **Registro en HMRC** y declaraciones trimestrales | 🔴 Hasta registrarse en HMRC |
| 10 | `consumer:non_eu` (Suiza y Noruega) | Suiza y Noruega | IVA local con umbral (CHF 100.000 de volumen mundial; NOK 50.000 en el VOEC) | `not_subject` bajo el umbral | Vigilar el umbral y registrarse al superarlo | 🟡 Por país, tras validar el umbral |
| 11 | `consumer:non_eu` (EE. UU.) | Estados Unidos | Impuesto sobre ventas **por estado**, con nexo económico por umbral; el SaaS tributa en unos estados y no en otros | Variable | Vigilar los umbrales por estado y registrarse | 🔴 Análisis propio |
| 12 | `consumer:non_eu` (resto) | Canadá, Australia, Japón, India, etc. | Régimen de servicios digitales de cada país (GST, HST, JCT…), con o sin umbral | Variable | Registro según el país | 🔴 Bloqueado salvo validación por país |

**Configuración propuesta para abrir lo que es claro** (después del visto bueno del asesor):

```
CP_STRIPE_FISCAL_SCENARIOS=business:es_mainland,business:es_special,business:eu,business:non_eu
CP_STRIPE_TAX_EXPECTATIONS=business:es_mainland=taxed,business:es_special=not_subject,business:eu=reverse_charge,business:non_eu=not_subject
CP_STRIPE_SCENARIO_COUNTRIES=business:non_eu=GB|CH|US|CA|AU|NO|AD
```

**B2C, cuando se cierre el §3:**

```
CP_STRIPE_FISCAL_SCENARIOS=…,consumer:es_mainland,consumer:eu
CP_STRIPE_TAX_EXPECTATIONS=…,consumer:es_mainland=taxed,consumer:eu=taxed
CP_STRIPE_SCENARIO_COUNTRIES=…,consumer:eu=<países validados>
CP_STRIPE_CONSUMER_RATES=ES=2100,<un tipo por país de la UE habilitado: con IVA español hasta el umbral, 2100; con OSS, el tipo del país>
CP_CONSUMER_WITHDRAWAL=immediate_execution_ack
CP_PRECONTRACT_VERSION=<versión publicada>
```

**Comprobación:**
- el registro de arranque (`ctx: Stripe`) muestra `eligibility`: los escenarios aprobados, sus países y si están abiertos;
- la consulta pública devuelve, para cada tipo de cliente y país, los motivos de bloqueo;
- un valor mal escrito impide arrancar.

## 3. Cumplimiento B2C (requiere aprobación jurídica)

| Requisito | Qué hace el sistema | Qué falta |
|---|---|---|
| **Precio final con impuestos** (TRLGDCU art. 20 y 60) | La consulta de elegibilidad devuelve el precio con impuestos del país del particular con el tipo decidido. Sin tipo, **no se cobra** | La web debe mostrar el precio final (repositorio de la web) |
| **Información precontractual** (art. 97) | Exige `CP_PRECONTRACT_VERSION` y que el particular confirme esa versión | Redactar el texto: identidad, características, precio total, renovación automática, duración, cancelación, desistimiento y reclamaciones |
| **Desistimiento** (14 días, art. 102-108) | Con `immediate_execution_ack`, casilla **propia** en la que el particular pide empezar ya y reconoce que, si desiste, paga la parte prestada. Queda registrada con fecha y huella | **Decisión jurídica.** Además, la **Directiva (UE) 2023/2673** exige desde el **19/06/2026** una **función de desistimiento** (botón) en los contratos a distancia. **No existe todavía:** hay que añadirla antes de abrir B2C |
| **Renovación automática** | La suscripción se renueva y se puede cancelar desde el Customer Portal a fin de periodo | Avisarlo con claridad en la información precontractual y en la confirmación |
| **Cancelación sencilla** | Customer Portal (a fin de periodo) | Confirmar que basta |
| **Factura a particulares** | Stripe genera la factura de la suscripción | Factura simplificada o completa según el asesor (DF-2) |
| **País del particular** (OSS: dos pruebas) | Domicilio declarado y comprobado, fijado en Stripe; Stripe registra además el país de la tarjeta | Confirmar que basta como prueba |

## 4. Identificación del comprador e identificadores fiscales

- **Tipo:** empresa o profesional (razón social y NIF obligatorios) o particular (nombre y apellidos; NIF opcional).
- **Territorio:**
  - se deduce del país y del código postal;
  - en España, el código postal de 5 cifras decide Canarias (35 y 38), Ceuta (51) y Melilla (52);
  - en la UE, el código postal detecta los territorios especiales.
- **Forma del identificador** (`server/stripe/taxIds.ts`):
  - España: NIF, NIE y CIF con su carácter de control;
  - UE: NIF-IVA con el prefijo de su Estado (Grecia, EL). El de otro Estado se rechaza;
  - Reino Unido: GB y 9 o 12 cifras;
  - resto: formato básico.
- **Validez real (no implementada, requiere decisión):**
  - **VIES** para la inversión del sujeto pasivo en la UE;
  - HMRC para el Reino Unido.

  Checkout recoge el NIF-IVA y Stripe Tax aplica la inversión con un NIF-IVA de la UE. El sistema contrasta después el impuesto facturado con el esperado y avisa (`invoice_tax_mismatch`), pero **no consulta VIES**. **Propuesta:** comprobar VIES antes del cobro en `business:eu`, como mejora siguiente.

## 5. Facturas y rectificativas: documentos de Stripe frente a facturas fiscales

| Documento | Lo genera | ¿Es factura fiscal? |
|---|---|---|
| Factura de la suscripción (`in_…`) | Stripe Billing | **Solo si el asesor lo valida** (DF-2): numeración, series, menciones por escenario («inversión del sujeto pasivo», «no sujeta»), VERI\*FACTU y OSS |
| Recibo de pago | Stripe | No |
| Nota de crédito (`cn_…`) | Stripe, si se emite al reembolsar | Rectificativa solo si se valida DF-2 |
| `fiscal_documents` (factura y rectificativa) | Elephant, en cola `pending` | **No se emite nada.** Queda pendiente del sistema legal que se decida (`pendingSink`) |

**No se activa ninguna emisión fiscal** hasta resolver DF-2, DF-4 y VERI\*FACTU. Con varios escenarios, las **menciones obligatorias cambian por escenario**: hay que configurarlas en Stripe (pie o campos personalizados) o en el emisor certificado.

## 6. Qué requiere aprobación

| Quién | Qué |
|---|---|
| **Asesor fiscal** | Cada fila de la matriz §2: tratamiento, menciones y registros. Escoger IVA español con umbral u OSS para B2C de la UE. Registro en HMRC para B2C del Reino Unido. Canarias y el IGIC. Lista de países fuera de la UE. DF-2 (emisor), DF-4 (series) y VERI\*FACTU |
| **Jurídico** | Desistimiento y ejecución inmediata, información precontractual, función de desistimiento (Directiva 2023/2673), condiciones B2C, contrato de encargo B2B, ley aplicable y jurisdicción en las ventas internacionales |
| **Propietario** | Activar escenarios y países con la configuración anterior. Registrar España (y OSS si procede) en Stripe Tax |
