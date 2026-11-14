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
`public.requestProductInfo` (`server/productRequests.ts`) es la única vía: crea una **oportunidad** (`createLead`, origen `web_solicitud_producto`, con `experienceId` y el producto en el mensaje). Protecciones, las mismas ideas que E-7: misma web de origen (CSRF), límite por visitante (5 / 10 min por empresa + IP), campo trampa y tiempo mínimo, consentimiento RGPD **obligatorio** y guardado en el mensaje del lead (texto y versión), textos sin etiquetas, un envío repetido (mismo correo y producto en 10 min) se anota en la oportunidad existente en vez de duplicarla. Aviso por correo al propietario con el mecanismo de E-7 (`internalNoticeEmail`; sin correo no se envía). Nada se comparte entre empresas.

### Migración 0069
`ALTER TABLE experiences ADD COLUMN offer_mode ENUM(...) NOT NULL DEFAULT 'fixed', ADD COLUMN request_cta_label VARCHAR(80) NULL`. Reversión: `DROP COLUMN` de ambas. Como el esquema de Drizzle (`experiences`) ya incluye las columnas, **la migración debe aplicarse antes (o a la vez) que el código** (mismo criterio que 0063–0065 del TPV).

## Límites conocidos
- El modo se decide por producto; no hay un interruptor global por empresa ni por plan (no hace falta: sin usarlo, todo es de precio fijo).
- El aviso por correo al propietario depende de que la empresa tenga configurado su correo de avisos.
- Textos traducibles (E-1): el texto del botón y las insignias son literales por ahora; quedan preparados como campos separados.

## E-4. Convocatorias: ediciones con fechas y plazas (migración 0070)

### Modelo
- `product_editions`: una **edición** de un producto (`experience_id`): nombre (`label`), `starts_at`/`ends_at` (ms UTC) y `timezone`, horario en texto libre (`schedule_note`), `mode` (online · presencial · mixta), lugar o enlace (`location_note`), `capacity` (NULL = sin límite), `reserved` (plazas **confirmadas**), `show_availability` (enseñar «quedan N plazas»; apagado por defecto), `status` (borrador · abierta · lista de espera · cerrada · cancelada) y `price_override` (informativo).
- `edition_enrollments`: **solicitudes de plaza** (`edition_id`, `lead_id` → oportunidad del CRM, `client_id`, nombre/correo/teléfono, `seats`, `status` solicitada · confirmada · lista_espera · cancelada, `order_id` reservado para el pedido que se cree a mano después, consentimiento RGPD y huella de IP).
- Reglas de fechas en `shared/editions.ts`: el panel escribe la fecha y hora **locales** de la zona de la edición y el servidor las guarda en UTC (horario de verano incluido).

### Sin sobreventa
- Una solicitud **no ocupa plaza**: la confirma el administrador. `reserved` solo cambia al confirmar o al salir de «confirmada».
- Confirmar = transacción con la inscripción y la edición bloqueadas + `UPDATE … SET reserved = reserved + n WHERE capacity IS NULL OR reserved + n <= capacity`. Si no cabe (0 filas), no se confirma y el servidor explica por qué. Liberar usa `GREATEST(reserved - n, 0)`.
- Bajar las plazas por debajo de las confirmadas se rechaza dentro del propio `UPDATE`. La restricción `CHECK (reserved >= 0 AND (capacity IS NULL OR reserved <= capacity))` es la última red. Hay `products.editions.recount` para reparar el contador a partir de las inscripciones.
- Prueba de concurrencia real (`server/convocatorias.mysql.test.ts`): 14 confirmaciones a la vez para 5 plazas → exactamente 5; plazas de tamaño distinto; confirmar y cancelar a la vez.

### No activa cobros
La inscripción es **una solicitud** (oportunidad en el CRM con el producto y la edición en el mensaje, origen `web_solicitud_plaza`, y su inscripción). No crea pedido, reserva, factura ni cobro. El cobro es una acción manual posterior con el flujo existente (presupuesto/pedido desde el CRM).

### Web
- `public.getProductEditions` (producto, categoría o toda la tienda): solo lo visible (ni borradores, ni canceladas, ni terminadas) y **sin el recuento interno**: devuelve el estado (plazas abiertas · lista de espera · completa · inscripción cerrada), las plazas libres solo si la empresa activó «mostrar plazas disponibles» y el precio solo en productos de precio fijo.
- Ficha de producto: sección «Próximas fechas» (nada si no hay). Bloque Studio **«Próximas fechas»** (`upcoming_dates`, familia Comercio, capacidad `shop-catalog`): de un producto, de una categoría o de todos; usa el catálogo real, no copias. Botón «Solicitar plaza» (o «Apuntarme a la lista de espera» si está completa o en lista de espera) que abre el formulario de solicitud con la edición preseleccionada y el número de plazas.
- Una edición completa admite solicitudes: entran en **lista de espera**. Cerrada, cancelada o terminada, no.
- La misma protección que E-6/E-7 (misma web de origen, límite por visitante, trampa, consentimiento obligatorio, sin duplicados: la misma persona en la misma edición se anota en su oportunidad).

### Panel (sin código)
Productos y servicios › «Convocatorias» (menú del producto y botón en su ficha): crear, editar, **«Crear nueva edición a partir de esta»** (copia como borrador, sin inscripciones), cancelar (avisa de a cuántas personas hay que avisar), borrar (solo sin inscripciones), cambiar plazas, y por edición el listado de inscripciones con Confirmar plaza · Lista de espera · Cancelar. Pestaña «Próximas convocatorias» con todas las de la tienda por mes.

### Alta manual y avisos por correo
- **Añadir inscripción** (panel › Inscripciones): se busca a la persona entre clientes y oportunidades del CRM (mínimo 2 letras; sin comodines) o se escriben sus datos; entra «por confirmar» o «en lista de espera». **No ocupa plaza** hasta «Confirmar plaza» (mismas reglas atómicas). Sin duplicados por correo en la misma convocatoria; no se admite en convocatorias canceladas.
- **Avisos por correo** (panel › Convocatorias › Avisos por correo): **apagado por defecto**. Al confirmar o cancelar una plaza (solo si el estado cambia de verdad) se envía un correo **de servicio** (categoría `operational`, nunca marketing) a la persona inscrita, con asunto y texto editables y los huecos {nombre} {producto} {edicion} {fechas} {plazas}. Se guardan por empresa en `system_settings` (`edition_notify_*`). Un fallo del correo no afecta a la plaza.

### Migración 0070
Solo crea `product_editions` y `edition_enrollments` (sin claves foráneas, como el resto del carril). Reversión: `DROP TABLE` de ambas. El código funciona sin ellas (sin convocatorias): las consultas públicas devuelven vacío y el panel avisa de que no están activadas.

### Límites conocidos
- Sin multidioma de `label`/`schedule_note`/`location_note` por ahora (E-1 `content_translations` no está en esta rama): son campos separados, listos para conectarlos.
- Los avisos por correo al confirmar/cancelar son solo esos dos; no hay recordatorios previos a la fecha.
- La ficha «sectorial» (`ExperienceDetail`, instalación heredada) oculta precio y reserva en los productos sin precio fijo y deja «Solicitar presupuesto»; no muestra las fechas de las convocatorias (eso es de la ficha genérica y del bloque Studio).
- Un producto no se borra «en cascada» con sus convocatorias (`hardDelete` deja filas huérfanas, que la web ignora al no encontrar el producto).
