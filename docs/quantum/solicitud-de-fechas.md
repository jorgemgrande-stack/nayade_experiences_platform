# Solicitud de fecha de inicio en productos «bajo petición» (Quantum: Viaje del Alma y Retiro Naturaleza)

Estado: 24/11/2026. **No cambia la modalidad comercial** (siguen «solo por solicitud») **ni activa cobros reales.**

## Circuito (todo reutilizado; no hay segundo motor)

1. **Solicitud con calendario** — la ficha del producto ofrece, solo si el producto tiene fijado un periodo de peticiones (`request_dates_until`), la fecha de inicio deseada, la opción y los participantes. Reutiliza el formulario de solicitudes de producto (`ProductRequestDialog`, `server/productRequests.ts`) y el selector de fecha nativo de la web.
2. **Oportunidad en el CRM** — la misma que ya crean las solicitudes (`createLead`): producto, opción, nº de participantes (`numberOfPersons`), fecha deseada (`preferredDate`), idioma, precio mostrado y consentimiento RGPD tal como lo vio la persona. Aviso al propietario como siempre.
3. **Quantum decide** — acepta la fecha o propone otras (notas/correo del CRM, como hoy). Una fecha pedida **no** es disponibilidad ni reserva: así consta en el texto de la oportunidad.
4. **Presupuesto y enlace de pago** — desde el CRM (presupuesto con su enlace `/presupuesto/<token>`), cuando la fecha y las condiciones están confirmadas.
5. **Stripe Connect** — `startQuoteCheckout` cobra el presupuesto en la cuenta conectada de la empresa; el pago solo se da por hecho con el webhook firmado.
6. **Confirmación idempotente** — `confirmPayment` (factura, reserva, cliente) por `quotePort.markPaid`; un segundo aviso del mismo cobro no factura de nuevo.

## Qué añade este cambio (único)

- Migración aditiva **0088**: `experiences.duration_days`, `request_dates_from`, `request_dates_until` (todo `NULL`; sin datos). Los productos existentes no cambian.
- `shared/requestDates.ts` (regla pura) y la validación en el servidor: fecha real, futura y dentro del periodo del producto; participantes y opción con los mismos límites del pago online (`minQty/maxQty` de la opción y `minPersons/maxPersons` del producto).
- La duración es un **dato**: si consta, se añade un fin *previsto*; si no, no se calcula ni se promete ningún fin. Nunca se lee de un texto como «6 Tage».
- El periodo (hasta junio de 2027 para Quantum) es un **dato editable por producto**, no una regla del código ni texto editorial: lo fija la administración al activar el calendario y se actualiza cuando cambie el periodo anunciado.

## Qué no cambia

- Producto 28 (Neujahr Retreat): convocatoria de fecha fija y disponibilidad limitada, sin tocar.
- Precios, variantes de 27/28, IVA y condiciones comerciales.
- Cobro Real de Quantum: apagado.

## Qué falta para dejar el circuito preparado (decisiones de Quantum)

Precio de 27/28, plazas del 28, pago íntegro o anticipo, datos de cada viajero, política de cancelación (y direcciones de condiciones), IVA, y cuenta Stripe Real verificada.
