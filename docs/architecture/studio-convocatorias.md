# Elephant Studio: «bajo petición / próximamente» (E-6) y convocatorias con plazas (E-4)

Todo es reutilizable por cualquier empresa y **no cambia nada para las que ya existen**: los productos actuales siguen siendo de precio fijo y se compran igual. Se edita desde el panel de la empresa, sin código.

## E-6. Oferta «bajo petición» / «próximamente» (migración 0069)

### Qué hace
Cada producto (`experiences`) tiene ahora «**Cómo se ofrece**» (`offer_mode`):

| Valor | En el panel | En la web |
|---|---|---|
| `fixed` (por defecto) | Precio fijo | Como siempre: precio, carrito, pago |
| `on_request` | Bajo petición | Insignia «Bajo petición», **sin precio**, sin carrito ni compra, botón de petición |
| `coming_soon` | Próximamente | Insignia «Próximamente», igual que el anterior |

- `request_cta_label`: texto del botón (vacío = «Solicitar información»). Se escribe en el formulario de producto.
- Con «Bajo petición» o «Próximamente» el **precio deja de ser obligatorio** y el servidor guarda `0` (y quita el descuento). Volver a precio fijo exige un precio válido; no se puede dejar un producto a la venta con 0 €.
- La web nunca pone «Agotado» en estos productos (el «Agotado» sigue siendo solo de un producto de precio fijo que no está «a la venta»).
- Dónde se ve: tienda (`/tienda`), ficha de producto, bloque Studio «Productos de tu tienda» (mismo componente, mismas reglas) y, en el panel, la lista de productos.

### Defensa en servidor (no depende de la web)
El servidor rechaza cualquier compra de un producto que no sea `fixed`, aunque la petición esté manipulada o el carrito guardado sea antiguo:
- `reservations.cartCheckout` y `reservations.createAndPay`: `BAD_REQUEST` con el aviso «… se ofrece bajo petición…» / «… todavía no está a la venta…», antes de crear ninguna reserva.
- TPV (caja): el catálogo no lo ofrece y `tpv.createSale` lo rechaza.
- `isPurchasable()` (`shared/shopOrders.ts`) incluye el modo, así que cualquier pantalla que ya lo usara deja de ofrecerlo.
- Las opciones de precio (`public.getVariantsByExperience`) se devuelven vacías para estos productos.
Los presupuestos y pedidos manuales del CRM siguen siendo acción del administrador (es el flujo previsto después de una solicitud).

### Solicitud de información → CRM
`public.submitLead` con `productRequest` (`server/productRequests.ts`; va por esa consulta, ya pública, para no ampliar la lista de rutas sin sesión) es la única vía: crea una **oportunidad** (`createLead`, origen `web_solicitud_producto`, con `experienceId` y el producto en el mensaje). Protecciones, las mismas ideas que E-7: misma web de origen (CSRF), límite por visitante (5 / 10 min por empresa + IP), campo trampa y tiempo mínimo, consentimiento RGPD **obligatorio** y guardado en el mensaje del lead (texto y versión), textos sin etiquetas, un envío repetido (mismo correo y producto en 10 min) se anota en la oportunidad existente en vez de duplicarla. Aviso por correo al propietario con el mecanismo de E-7 (`internalNoticeEmail`; sin correo no se envía). Nada se comparte entre empresas.

### Migración 0069
`ALTER TABLE experiences ADD COLUMN offer_mode ENUM(...) NOT NULL DEFAULT 'fixed', ADD COLUMN request_cta_label VARCHAR(80) NULL`. Reversión: `DROP COLUMN` de ambas. Como el esquema de Drizzle (`experiences`) ya incluye las columnas, **la migración debe aplicarse antes (o a la vez) que el código** (mismo criterio que 0063–0065 del TPV).

## Límites conocidos
- El modo se decide por producto; no hay un interruptor global por empresa ni por plan (no hace falta: sin usarlo, todo es de precio fijo).
- El aviso por correo al propietario depende de que la empresa tenga configurado su correo de avisos.
- Textos traducibles (E-1): el texto del botón y las insignias son literales por ahora; quedan preparados como campos separados.
