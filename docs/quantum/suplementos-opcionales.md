# Suplementos opcionales (alimentación ayurvédica de los retiros)

Estado: 24/11/2026. Rama `feat/suplementos-opcionales`, migración 0090 (aditiva). **No cambia precios, modos de oferta ni cobros**; no se ha creado ningún suplemento en ningún entorno.

## Hallazgos del modelo anterior

- Una persona solo podía elegir **una** variante (`variantId`), y esa variante **sustituye** al precio del programa (importe fijo / por persona = precio directo; porcentaje = sobre el base). No había noción de «complemento»: `isRequired=false` solo significa que se puede comprar sin elegir opción.
- El total se calcula en servidor (`cartCheckout`, `createAndPay`, `server/shopCheckoutRules.ts`) y los límites por tramo ya existían (`minQty`/`maxQty`, migración 0086).
- La solicitud `priced_request` (`server/productRequests.ts`) anota la modalidad y el precio publicado en el lead; no hay cobro.
- Por tanto no se podía expresar «programa + suplemento opcional» sin tocar el modelo: marcar la alimentación como variante la habría convertido en **modalidad** del programa (sustituyendo su precio), la habría mezclado en el «desde» y no se podía combinar con la modalidad.

## Diseño (mínimo)

Una columna nueva: `experience_variants.supplementGroup VARCHAR(64) NULL` (0090). Si está informada, la fila es un **suplemento** y deja de ser opción del programa en todas partes.

- Las filas con el mismo grupo son los **tramos** del mismo suplemento; el tramo lo decide el servidor por número de participantes (`minQty`/`maxQty`). Quien viaja solo no puede acogerse a la tarifa de grupo aunque envíe el id de ese tramo.
- `priceType = per_person`: importe × participantes. `fixed`: importe único por pedido. `percentage`: no admitido.
- El cliente solo envía los **ids de los suplementos que marca** (`supplementIds`); nunca importes. Sin ids no hay suplemento: nada está preseleccionado ni se añade solo.
- Un suplemento no sale en `public.getVariantsByExperience`, no entra en el «desde» del catálogo, no se puede elegir como `variantId`, ni aparece en el TPV ni en los selectores del CRM.
- Ficha pública: `public.getSupplementsByExperience` devuelve los suplementos agrupados por tramos (solo si el producto muestra precio). La solicitud los presenta aparte, desmarcados («Opcional: …»), con el importe por persona del tramo que corresponde a los participantes indicados, y aclara que no está incluido en el programa ni se cobra ahora.
- Solicitud (`priced_request`): el lead lleva una línea «Suplementos opcionales elegidos (NO incluidos en el precio del programa; sin cobro …) · Participantes: N · Alimentación … × N = importe». No hay cobro.
- Pedido (`cartCheckout`, `createAndPay`): si el producto es de precio fijo, el importe del suplemento se suma a la línea solo si se marca; el nombre de la línea lo indica «+ … (suplemento opcional)». La huella del carrito solo cambia si hay suplemento.

## Cómo configurar el suplemento en un tenant

Para cada suplemento (p. ej. alimentación), dos filas en `experience_variants` del producto (Viaje del Alma, Naturaleza & Outdoor, Año Nuevo), mismo `supplementGroup`:

| Campo | Tramo individual | Tramo desde 2 |
|---|---|---|
| `name` | Alimentación ayurvédica | Alimentación ayurvédica (desde 2) |
| `supplementGroup` | `alimentacion` | `alimentacion` |
| `priceType` | `per_person` | `per_person` |
| `priceModifier` | `120.00` | `90.00` |
| `minQty` / `maxQty` | 1 / 1 | 2 / (máximo del producto, p. ej. 5) |
| `isRequired` | false | false |
| `validUntil` | vacío | vacío |
| `description` | (opcional) texto común | — |

Se pueden crear con el procedimiento de administración `products.createVariant` (acepta `supplementGroup`; el panel de variantes aún no lo muestra, ni `minQty`/`maxQty`). El nombre del primer tramo (menor `minQty`) es la etiqueta del suplemento. El alojamiento NO se configura así: sigue siendo información/presupuesto.

## No incluido / pendiente

- Selector de suplementos en el carrito de la tienda (ficha de producto de precio fijo): el servidor ya admite `supplementIds`, falta la interfaz del carrito. Quantum vende por solicitud, así que no le afecta.
- Campo `supplementGroup` en el panel de administración de variantes.
- Traducciones de los textos nuevos: español, alemán e inglés.
- Presupuestos del CRM (conversión de lead a presupuesto): el suplemento queda en el mensaje del lead; no se genera línea automática de presupuesto.
