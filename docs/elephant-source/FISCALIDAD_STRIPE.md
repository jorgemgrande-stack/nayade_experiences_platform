# Fiscalidad de las suscripciones de Elephant Source (18/10/2026)

**Estado:** preparado, **no aplicado**.
- Stripe Tax sigue apagado y no se emiten facturas fiscales.
- No hay cobros live.
- Nada de este documento se ha configurado todavía en Stripe.

Es un análisis técnico para decidir, **no asesoramiento fiscal**. Las decisiones de §5 deben validarse con el asesor de la sociedad antes de aplicarse.

## 1. Entidad emisora (decisión DF-1, resuelta)

| Dato | Valor |
|---|---|
| Razón social | **IRON ELEPHANT CONSULTING, S.L.** |
| NIF | **B26987875** (sociedad limitada; el carácter de control es correcto) |
| Domicilio fiscal | Calle Corazón de María, 57, 1.º D, 28002 Madrid, España |
| Nombre comercial | Big Elephant / Elephant Source |
| Moneda | EUR |

- **La marca no es la entidad.** En facturas, recibos y avisos de cobro aparecen la razón social y el NIF, nunca «Big Elephant» ni «Elephant Source» en su lugar. La marca puede figurar como nombre comercial.
- **En el código:** `server/stripe/issuer.ts`.
  - Los datos son públicos y se versionan.
  - Se valida el NIF.
  - El aviso de la página de pago dice: «Emisor: IRON ELEPHANT CONSULTING, S.L. (NIF B26987875)».
  - `GET /cp/v1/stripe/status` devuelve `issuer`.
- **Cuenta de Stripe:** el sandbox visible por el MCP se llama «Entorno de prueba de Iron Elephant Consulting», coherente con la entidad. Que sea independiente de la cuenta real **sigue sin poder demostrarse por API** (`PREPARACION_DESPLIEGUE_STRIPE.md` §3).

## 2. Configuración de Stripe preparada (primero en el sandbox; la hace una persona)

| Dónde | Ajuste | Valor |
|---|---|---|
| Settings → Business → Account details | Nombre legal de la empresa | IRON ELEPHANT CONSULTING, S.L. |
| ídem | Nombre comercial público (el que ve el cliente en Checkout y en el Portal) | Big Elephant (o «Elephant Source»: a elegir) |
| ídem | Dirección | Calle Corazón de María, 57, 1.º D, 28002 Madrid, ES |
| Settings → Business → Tax details → identificadores | Tipo `es_cif`, valor `B26987875` | Aparece como NIF del emisor en las facturas de Stripe |
| Settings → Billing → Invoices | Prefijo de numeración | De pruebas en el sandbox (p. ej. `ESTEST`). Uno definitivo y propio en live (decisión DF-4) |
| ídem | Pie de factura | Razón social, NIF y domicilio, más las menciones de §4 según el caso |
| Settings → Billing → Customer portal | Datos del negocio, condiciones y privacidad | Las URL públicas (bloqueo legal: hoy son borradores) |
| Settings → Tax | **Stripe Tax** | **Apagado** (se registra España solo cuando se decida §5) |

**Ya está en el código y no cambia:**
- Checkout pide la dirección de facturación y el NIF del cliente (`tax_id_collection`) y guarda ambos en el Customer.
- Los Prices son `tax_behavior: exclusive` (IVA no incluido).
- Hasta resolver §5, el único tratamiento es el de pruebas `test_net_no_tax`: neto, sin IVA y **sin factura fiscal**.

## 3. Quién emite la factura legal (decisión DF-2, crítica)

Hay dos opciones:
- **Stripe Invoicing** emite el documento.
- **Un sistema de facturación propio** emite la factura legal, y Stripe solo cobra.

**Antes de elegir Stripe como emisor de la factura legal hay que confirmar con el asesor:**
- **Requisitos del reglamento de facturación** (RD 1619/2012, art. 6):
  - numeración correlativa y por series;
  - datos de emisor y destinatario;
  - base, tipo y cuota;
  - menciones obligatorias.
  Las facturas de Stripe admiten la mayoría, pero hay que comprobar las menciones y la factura rectificativa (las notas de crédito de Stripe).
- **Sistemas informáticos de facturación (SIF / VERI*FACTU, RD 1007/2023):** la obligación alcanzará a la sociedad cuando entre en vigor para el Impuesto sobre Sociedades (el plazo vigente debe confirmarse con el asesor, porque ha cambiado). Hay que confirmar si facturar con Stripe es compatible o si hace falta un software certificado que reciba los cobros de Stripe.
- **Factura electrónica B2B** (Ley 18/2022, «Crea y Crece»), cuando su desarrollo reglamentario entre en vigor.

Mientras no se decida, **las facturas del sandbox no son facturas fiscales**, y el modo pruebas lo hace visible.

## 4. Escenarios de IVA (servicio prestado por vía electrónica: SaaS)

La localización de un servicio electrónico depende de si el cliente es empresa o consumidor y de dónde está (LIVA art. 69 y 70; Directiva 2006/112/CE art. 44 y 58).

| # | Cliente | IVA en la factura | Mención en la factura | Declaraciones | Comprobación |
|---|---|---|---|---|---|
| 1 | **Empresa o profesional en la península o Baleares** | **IVA español, 21 %** | — | Modelo 303 | NIF español del cliente |
| 2 | **Consumidor en la península o Baleares** | **IVA español, 21 %** | — (precio con IVA incluido al ofertar) | Modelo 303 | Dirección en España |
| 3 | **Empresa de otro Estado de la UE**, con NIF-IVA válido en VIES | **Sin IVA** (inversión del sujeto pasivo: lo declara el cliente) | «Inversión del sujeto pasivo» (art. 196 de la Directiva) y NIF-IVA del cliente | Modelo 303 y **349** | **VIES en el momento de facturar**; si no es válido, se trata como consumidor |
| 4 | **Consumidor de otro Estado de la UE** | Por debajo de **10.000 €/año** de ventas a distancia y servicios electrónicos a consumidores de toda la UE: **IVA español**. Por encima: **IVA del país del cliente**, por la ventanilla única **OSS** (régimen de la Unión, modelo **369**) | — | 303 y/o 369 | **Dos pruebas** no contradictorias del país del cliente (dirección, IP, país del banco o tarjeta). Por debajo del umbral, basta una |
| 5 | **Empresa fuera de la UE** | **No sujeto** al IVA español | «Operación no sujeta (art. 69 LIVA)» | 303 (casilla de no sujetas) | Prueba de que es empresa (identificador fiscal o registro). El país del cliente puede exigir impuesto propio (inversión, registro) |
| 6 | **Consumidor fuera de la UE** | **No sujeto** al IVA español | «Operación no sujeta» | 303 | El país del cliente puede exigir registro (p. ej. Reino Unido, Suiza o Noruega, con umbrales propios) |
| 7 | **Canarias, Ceuta o Melilla** | **Sin IVA** (fuera del territorio del IVA): empresa como el caso 5; consumidor, posible IGIC o IPSI local | Según el caso | Según el caso | Dirección o NIF canario. Requiere análisis propio |

**Notas:**
- **Empresa y consumidor:** con NIF válido es empresa (en la UE, el NIF-IVA comprobado en VIES). Sin NIF, se presume consumidor. Checkout ya recoge NIF y dirección; la comprobación en VIES está por hacer (Stripe Tax la puede hacer).
- **Precios a consumidores en España:** la normativa de consumo exige mostrar el **precio final con impuestos** (RDL 1/2007, art. 20 y 60). El catálogo y la web muestran precios **sin IVA**. Si se vende a consumidores, hay que mostrar también el precio con IVA. Si no, limitar la contratación a empresas (decisión DF-5).
- **Hoy, el presupuesto interno incluye el 21 % y Stripe cobra el neto.** Hasta resolver §5 lo controla el tratamiento de pruebas: el neto del presupuesto debe ser el precio de Stripe, o no se abre el pago.

## 5. Decisiones fiscales pendientes (antes de aplicar nada)

| Código | Decisión | Opciones | Consecuencia técnica |
|---|---|---|---|
| **DF-2** | Quién emite la factura legal | Stripe Invoicing / software propio o certificado | Plantilla y numeración en Stripe, o integración con el sistema de facturación |
| **DF-3** | Cálculo del IVA | **Stripe Tax** (registro de España y, si procede, OSS) / tipos fijos por jurisdicción / cálculo propio | Con Stripe Tax: `automatic_tax` en Checkout y facturas, y comprobación de NIF. Con tipos fijos: `tax_rates` por cliente |
| DF-4 | Series de numeración | Una serie / una por canal / una para rectificativas | Prefijo y secuencia en Stripe o en el sistema emisor |
| **DF-5** | ¿Se vende a consumidores? | Solo empresas (NIF obligatorio) / también consumidores | Si solo empresas: NIF obligatorio en Checkout y en la web. Si también consumidores: precios con IVA visibles y pruebas de país |
| DF-6 | Mercados | Solo España / UE / todo el mundo | Restringir los países de facturación en Checkout. OSS si hay consumidores de la UE |
| DF-7 | Canarias, Ceuta y Melilla | Admitir / excluir hasta analizarlo | Excluir esos códigos postales o tratarlos como fuera del territorio del IVA |
| DF-8 | Precio que se publica | Sin IVA (B2B) / con IVA (B2C) | `tax_behavior` de los Prices: un Price no cambia de comportamiento, así que se crearían otros |

**Recomendación técnica, a validar con el asesor:**
- para la beta, **solo empresas en España (casos 1 y 3)**;
- NIF obligatorio;
- Stripe Tax con el registro de España cuando se apruebe;
- Stripe Invoicing solo si el asesor confirma su encaje con VERI*FACTU; si no, un emisor certificado que reciba los cobros de Stripe.

Es el camino con menos obligaciones nuevas (sin OSS ni registros extranjeros) y el que encaja con los precios sin IVA ya aprobados.

## 6. Qué NO se ha hecho

- No se ha escrito nada en Stripe: ni datos del negocio, ni NIF del emisor, ni Stripe Tax. El MCP no está conectado en esta sesión y la independencia del sandbox no está demostrada.
- No se ha emitido ninguna factura fiscal ni se ha cambiado ningún precio.
- Las páginas legales de la web (aviso legal y privacidad) siguen con huecos `[PENDIENTE: razón social, NIF, domicilio, registro mercantil]`. Rellenar los tres primeros con estos datos es inmediato, pero queda fuera del perímetro de esta tarea y no se ha hecho. Los datos registrales siguen sin conocerse.
