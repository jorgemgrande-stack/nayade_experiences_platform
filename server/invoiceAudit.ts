/**
 * Revisión de facturación de los pedidos cobrados (Ventas): qué pedidos pagados se han quedado sin documento.
 *
 * Un pedido está documentado si tiene factura (por la reserva, por su presupuesto o enlazada en la reserva) o si
 * es una venta de caja cobrada con su ticket, que es una factura simplificada. Solo lo demás es una incidencia.
 */

export interface PaidOrderForAudit {
  id: number;
  quoteId: number | null;
  invoiceId: number | null;
}

export function ordersWithoutInvoice<T extends PaidOrderForAudit>(
  paid: T[],
  linkedInvoices: Array<{ reservationId: number | null; quoteId: number | null }>,
  ticketedReservationIds: Iterable<number>,
): T[] {
  const covered = new Set<number>(ticketedReservationIds);
  const quotesInvoiced = new Set<number>();
  for (const inv of linkedInvoices) {
    if (inv.reservationId) covered.add(inv.reservationId);
    if (inv.quoteId) quotesInvoiced.add(inv.quoteId);
  }
  return paid.filter((r) => !covered.has(r.id) && !r.invoiceId && !(r.quoteId && quotesInvoiced.has(r.quoteId)));
}
