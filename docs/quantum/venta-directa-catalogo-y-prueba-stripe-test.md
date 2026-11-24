# Quantum Soulrise: venta directa del catálogo y prueba integral en Stripe TEST

Estado: 24/11/2026. **No activa cobros LIVE ni cambia ninguna modalidad comercial.** El bloqueo técnico de Checkout (`connect_not_connected`) sigue efectivo y no se elude.

## 1. Rutas de venta (qué recorrido corresponde a cada producto)

| Ruta | Cuándo | Recorrido público | Cobro |
|---|---|---|---|
| **Compra inmediata** | Precio y opciones cerrados y, si hay fechas, convocatoria con plazas | Opción + cantidad + (convocatoria) → carrito → Stripe Connect | Al pagar; el pedido solo se da por pagado con el webhook firmado |
| **Fecha pendiente de confirmar** | Experiencia con fecha a convenir | Calendario (fecha de inicio deseada) + opción + participantes → «Solicitud pendiente de confirmación» → CRM → Quantum acepta o propone otra fecha → presupuesto con enlace de pago → Stripe Connect | Solo tras confirmar fecha y condiciones; nunca se cobra una reserva sin confirmar |
| **Precio no validado / solo solicitud** | Sin precio válido o importe aún no confirmado por Quantum | Solicitud comercial | Ninguno hasta que Quantum valide el importe |

La modalidad que decide la ruta es el dato `offerMode` del producto (más el periodo de peticiones `request_dates_until` para pedir fecha). Pasar un producto a compra inmediata exige que el comprobador de preparación no tenga bloqueos técnicos; hoy el único es la cuenta de Stripe.

## 2. Clasificación de los 12 productos con precio

| Id | Producto | Ruta prevista | Motivo |
|---|---|---|---|
| 1 | RECONNECT | inmediata | Precio y opciones definidos; sin fechas |
| 2, 3 | Healer Activation / Mastery | inmediata si Quantum confirma sin fecha; si tienen fecha, convocatoria | Sin convocatorias hoy |
| 4 | Healer Initiation | fecha pendiente | «Oktober 2027», sin convocatoria |
| 24 | Morning Impulse | inmediata | Precio único |
| 26 | Seelenreise | fecha pendiente (activa) | Fechas a convenir, periodo hasta 30/06/2027; precios confirmados |
| 27 | Natur & Outdoor | fecha pendiente (activa) | Precio sin confirmar: **no se activa compra directa** |
| 28 | Neujahr Retreat | inmediata con convocatoria (30/12/2026–5/1/2027) | Faltan plazas; precio sin confirmar: **no se activa compra directa** |
| 29–32 | Berchtesgaden | fecha pendiente | Ver apartado 3 |

## 3. Auditoría de los productos 29–32 (¿necesitan fecha?)

Todos publican «Termine: individuell auf Anfrage buchbar» (fechas individuales bajo petición) y ninguno tiene convocatoria ni periodo anunciado. Además, parte de sus opciones son precios «desde» («ab»): 30 (tres de cuatro) y 31 (las dos de retiro). **Necesitan fecha acordada** y, en las opciones «desde», confirmar el importe final: ruta de **fecha pendiente de confirmar** (solicitud con calendario → presupuesto → enlace de pago). Para activar el calendario falta el dato «periodo de peticiones» de cada producto, que Quantum no ha publicado.

## 4. Caducidad de opciones (producto 1)

Las opciones con `validUntil` se retiran solas: `getVariantsByExperience` (ficha pública, solicitud, carrito y pago) solo devuelve las vigentes (`validUntil` nulo o ≥ hoy en horario de Madrid) y el comprobador de preparación usa la misma regla. Las cuatro opciones de RECONNECT con fecha 2026-11-29 (111, 199, 333 y 555 €) se ofrecen hasta el 29/11/2026 inclusive y desde el 30/11 dejan de listarse y de aceptarse («La opción elegida ya no está disponible»). No se modifica ninguna condición comercial.

## 5. Prueba integral en Stripe TEST (preparada, no ejecutada)

**Condición previa humana (no se simula):** Jorge o Dirección conectan la cuenta de **prueba** de Quantum en Ajustes → Cobros → bloque Prueba («Conectar mi cuenta de Stripe», con datos de prueba de Stripe) y marcan «Cobrar en línea (Prueba)». Hasta entonces no existe cuenta conectada y no se declara ningún pago realizado.

Con la cuenta de prueba conectada, para cada ruta se ejecuta (tarjeta de prueba `4242 4242 4242 4242`, correo de dominio reservado, sin avisos reales):

1. **Inmediata:** producto de prueba no público con opción y cantidad → carrito → Checkout de Stripe → pago → comprobar: pedido pagado solo tras el webhook firmado, importe = suma recalculada en servidor, factura y reserva/matrícula, un segundo envío del mismo evento no duplica nada.
2. **Fecha pendiente:** solicitud con calendario (modo de pruebas de administración) → oportunidad en el CRM → presupuesto con la fecha confirmada → enlace → pago de prueba → comprobar reserva única e idempotencia.
3. **Controles:** doble clic (un solo pedido), sesión caducada (libera plazas), reembolso y disputa de prueba (marcan el pedido, no tocan factura ni plazas), aislamiento entre empresas.

Los mismos controles ya se ejecutan en el CI con Stripe simulado y MySQL real (`server/circuitoVentaOnline*.test.ts`); esta prueba los repite contra Stripe TEST real.

## 6. Pendiente exclusivamente de intervención humana

- **Indira:** completar en su enlace de Stripe los datos del titular de la cuenta Real (hoy «Restringida»).
- **Jorge/Dirección:** conectar la cuenta de prueba (apartado 5).
- **Quantum:** precios de 27 y 28; plazas del 28; periodo de peticiones y precios finales de 29–32; cancelación y direcciones legales; IVA; datos de viajeros; anticipo o pago íntegro; qué productos 2, 3 y 4 tendrán fechas.
- **Dirección:** autorización expresa para cada paso a compra inmediata y para encender el cobro Real.
