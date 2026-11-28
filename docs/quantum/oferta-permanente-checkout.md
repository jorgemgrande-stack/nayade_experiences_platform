# Quantum Soulrise: oferta permanente de compra directa con la pasarela apagada

Estado: 28/11/2026, código y pruebas de la PR `feat/oferta-permanente-checkout`. **No cambia ningún dato de ningún tenant y no activa cobros reales.** Los pasos de datos del apartado 5 son acciones humanas posteriores, por separado.

Decisión de Indira (27/11/2026): RECONNECT (producto 1) y MORNING IMPULSE (producto 24) pasan a ser **oferta permanente** de compra directa: sin fechas ni convocatorias, se compran cuando se quiera. Mientras la empresa no tenga pasarela de cobro disponible, la web debe decirlo con honestidad («Pronto disponible online») en vez de dejar que el visitante rellene todo y falle al pagar.

## 1. Campos nuevos (migración `0098_variante_activa_fecha_servicio`)

| Campo | Valores | Qué hace |
|---|---|---|
| `experience_variants.is_active` (`isActive`) | `1` (por defecto) / `0` | Variante retirada sin borrarla ni caducarla. Inactiva: no sale en la web ni en el precio «desde», no se puede comprar (carrito ni pago directo) y no cuenta en la preparación para venta. El panel la ve con la insignia «Inactiva» y la puede reactivar. |
| `experiences.service_date_mode` (`serviceDateMode`) | `auto` (por defecto) / `none` / `required` | Fecha de servicio del producto. `auto` = comportamiento de siempre (ficha sectorial: siempre; tienda de pyme: solo actividades con reservas contratadas). `none` = oferta permanente: la web no pide fecha y el servidor la limpia aunque llegue. `required` = la fecha es obligatoria; sin ella el pedido se rechaza. |

Reversión (`.down.sql`): quita las dos columnas (se pierde qué variantes estaban retiradas y qué productos eran oferta permanente; retirar antes el código). La migración es aditiva (columnas con valor por defecto; INSTANT en MySQL 8) y no toca filas.

> Numeración: el worktree hermano `feat/morning-impulse-recurrente` ya usa `0097`. Esta migración va como `0098`; mientras `0097` no esté fusionada, `verify` del carril marca «hueco de numeración» (CI). Si esta PR se fusiona antes, hay que renumerarla a `0097` al fusionar (README del carril: «el número se asigna al fusionar»). El carril completo (aplicar → revertir → aplicar) se ha probado en local con la migración numerada sin hueco.

## 2. Reglas puras (compartidas por web, panel y servidor)

- `shared/storefront.ts`
  - `serviceDateModeOf(product)`: `auto` para todo valor desconocido (productos anteriores).
  - `serviceDateRequirement(product, { storefront })` → `"none" | "required"`. El modo explícito manda; en `auto` decide la web.
  - `needsServiceDate(product, storefront)` ahora respeta el modo (la ficha y `buildGenericCartLine` lo usan sin cambios).
  - `serviceDateForOrder(product, bookingDate, { storefront })`: lo que guarda el pedido. `none` → `""`; `required` sin fecha AAAA-MM-DD → `date_required`; `auto` → como antes.
- `shared/purchaseState.ts`
  - `onlinePayable(payments)`: `storefront.payments.redsys || stripe`. **Sin dato** (web anterior) se mantiene el comportamiento de siempre (se asume pasarela).
  - `purchaseState(product, variants, payments, { todayISO })` → `purchasable | coming_soon_online | on_request | sold_out | no_variants`.
  - `liveVariants(variants, todayISO)`: activas y no caducadas.
- `shared/saleReadiness.ts`: las variantes inactivas no cuentan; todas inactivas → bloqueo `variants_all_inactive`; todas caducadas → `variants_all_expired`. Una oferta `none` con convocatorias → aviso comercial `permanent_offer_has_editions` y no exige fechas (`dates_not_applicable`). Textos en `shared/i18n/locales/{es,de}/saleReadiness.ts`.

## 3. Circuito «precio fijo con la pasarela apagada»

`public.getTheme` ya publica `storefront.payments = { redsys, stripe }` (Redsys configurado / cuenta Stripe Connect verificada con cobros en línea activados). Con los dos en `false`:

| Pantalla | Antes | Ahora |
|---|---|---|
| Catálogo `/tienda` (`Shop.tsx`) | Tarjeta normal con precio | Insignia «Pronto disponible online» (`data-testid="insignia-pronto-online"`); el precio sigue visible |
| Ficha `/tienda/:slug` (`ProductDetail.tsx`) | «Añadir al carrito» | Botón desactivado «Pronto disponible online» + texto de ayuda + botón «Solicitar información» que abre `ProductRequestDialog` (la solicitud entra en el CRM como las de «por solicitud») |
| Ficha sectorial `/experiencias/:slug` (`ExperienceDetail.tsx`) | «Añadir al carrito» | Igual que la ficha de tienda (textos en español, la ficha sectorial no es multidioma) |
| Pago (`Checkout.tsx`) | Asumía Redsys y el servidor fallaba con `PRECONDITION_FAILED` | Aviso previo (`coPayNotYetAvailable`) y botón «Pagar» desactivado con el texto «Pronto disponible online»; `handlePay` corta con `coErrPayUnavailable` |

Si `payments` no llega (web anterior o consulta en curso), todo se comporta como antes. «Agotado» (publicado y desactivado) y «por solicitud» tienen prioridad sobre «pronto disponible». El servidor sigue rechazando el pago sin pasarela (`createAndPay` y `cartCheckout`), así que el aviso es presentación honesta, no un control de seguridad nuevo.

## 4. Servidor

- `getVariantsByExperience(id, { includeExpired, includeInactive, includeSupplements })`: por defecto solo activas y vigentes (web, pedidos, aula). El panel (`products.getVariants`) y la preparación para venta piden todas. `variantsByProduct` (precio «desde» del catálogo) filtra `is_active = 1`.
- `products.createVariant` / `updateVariant`: aceptan `isActive`. `products.create` / `update`: aceptan `serviceDateMode`.
- `reservations.createAndPay` y `reservations.cartCheckout`: una variante inactiva o caducada no se encuentra y se rechaza con el mensaje existente «La opción elegida de «X» ya no está disponible»; la fecha pasa por `serviceDateForOrder` (`none` → se guarda `""`; `required` vacía → «Indica la fecha del servicio de «X»»). Con convocatoria, la fecha sigue siendo la de la convocatoria.
- `learningExtensions.loadExtensionCatalog`: ignora variantes inactivas (además del filtro de la consulta).

## 5. Pasos de datos pendientes para Quantum (acción humana, fuera de esta PR)

Ninguno se ha ejecutado. Orden propuesto, con el panel o con SQL revisado y copia previa:

1. **Variantes a retirar** (`is_active = 0`): 10 y 14 (Einführungspreise caducados, hoy ya fuera por `validUntil`), 43 (Lifetime, descartada). Alternativa: borrarlas; retirar conserva el histórico de pedidos y permite reactivar.
2. **Variantes autorizadas de RECONNECT** (producto 1): 8 LIVE 111 €, 13 +MODUL 1 199 €, 9 ONLINE KOMPLETT 555 €, 11 INTENSIV 777 € activas, sin `validUntil`. Comprobar que ninguna otra queda activa.
3. **Fecha de servicio**: productos 1 y 24 a `service_date_mode = 'none'`. Si el 24 tiene convocatorias publicadas (fechas 30/11–21/12), la preparación para venta avisará `permanent_offer_has_editions`: decidir si se cierran o si MORNING IMPULSE sigue por convocatoria.
4. **Modalidad**: 1 y 24 de `priced_request` a `fixed` desde el panel (pasa por la guarda de preparación: con la cuenta Connect sin verificar en live habrá bloqueo `connect_not_connected`; es lo esperado hasta que Dirección autorice cobros). Mientras sigan en `priced_request`, la web los enseña «Por solicitud» como hoy.
5. **Cobros reales**: siguen desactivados. Con 1 y 24 en `fixed` y la pasarela apagada, la web enseña «Pronto disponible online» y recoge solicitudes; nadie puede pagar. Activar Stripe Connect en modo Real es decisión de Dirección (ver `venta-directa-catalogo-y-prueba-stripe-test.md`).

## 6. Qué sigue siendo acción humana

- Fusionar la PR y, si procede, renumerar la migración (apartado 1).
- Aplicar `0098` en live y production por el carril (`migrate.ts up`, con backup verificado), **nunca** en el arranque.
- Los cambios de datos del apartado 5 (requieren OK expreso; esta PR no los hace).
- Revisar los textos públicos nuevos en alemán con Indira: «Bald online verfügbar» y el aviso del pago (`shared/siteUiText.ts`, claves `soonOnline`, `soonOnlineHelp`, `coPayNotYetAvailable`).
- Comprobación visual en live con sesión real: ficha 1 y 24, catálogo y pago con `payments` ambos en `false`.

## 7. Pruebas

- Puras: `server/purchaseState.test.ts`, `server/fechaServicio.test.ts`, ampliaciones cubiertas por `server/saleReadiness.test.ts` (paridad es/de de las claves nuevas), `server/fichaProductoMultidioma.test.ts` (paridad es/de/en de los textos públicos).
- MySQL (opt-in `REGISTRY_TEST_DATABASE_URL`): `server/ofertaPermanente.mysql.test.ts` (variante retirada y caducada rechazadas en carrito y pago directo; reactivación; `none` limpia la fecha; `required` exige fecha), más regresión de `ofertaBajoPeticion.mysql.test.ts` y `tiendaStripe.e2e.mysql.test.ts`.
- Carril de migraciones: `server/migrateCli.mysql.test.ts` (aplicar, revertir y volver a aplicar todo el carril) pasa con la migración numerada sin hueco.
