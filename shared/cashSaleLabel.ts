/**
 * Cómo se nombra en pantalla un pedido que sale de una venta en caja sin cliente: el nombre provisional
 * «Cliente TPV» no se enseña. Si la venta tiene factura con destinatario, su nombre; si no, «Venta en caja».
 * Solo presentación: no cambia ningún dato guardado ni ningún documento.
 */
import { ANONYMOUS_TICKET_NAME } from "./ticketInvoice";

export const CASH_SALE_LABEL = "Venta en caja";

const isPlaceholder = (name: string | null | undefined) => {
  const n = (name ?? "").trim();
  return n === "" || n === ANONYMOUS_TICKET_NAME;
};

export interface OrderNameInput {
  customerName: string | null | undefined;
  /** Destinatario de la factura de la venta, si la tiene. */
  invoiceClientName?: string | null;
}

/** Nombre del cliente del pedido para listados: el real, el de la factura o «Venta en caja». */
export function orderCustomerLabel(o: OrderNameInput): string {
  if (!isPlaceholder(o.customerName)) return (o.customerName ?? "").trim();
  if (!isPlaceholder(o.invoiceClientName)) return (o.invoiceClientName ?? "").trim();
  return CASH_SALE_LABEL;
}

/** Título del pedido en la actividad reciente del Inicio. */
export function orderActivityTitle(o: OrderNameInput): string {
  if (!isPlaceholder(o.customerName)) return `Pedido de ${(o.customerName ?? "").trim()}`;
  if (!isPlaceholder(o.invoiceClientName)) return `${CASH_SALE_LABEL} · ${(o.invoiceClientName ?? "").trim()}`;
  return CASH_SALE_LABEL;
}

export interface SaleInvoiceRef {
  invoiceNumber: string;
  clientName?: string | null;
  pdfUrl?: string | null;
}

/**
 * Aviso del diálogo de cobro cuando la venta lleva factura completa (cliente identificado): el número y el
 * destinatario, y dónde verla (el documento si existe; si no, el listado de facturas).
 */
export function saleInvoiceNotice(inv: SaleInvoiceRef | null | undefined): { text: string; href: string } | null {
  if (!inv?.invoiceNumber) return null;
  const to = isPlaceholder(inv.clientName) ? "" : ` a ${(inv.clientName ?? "").trim()}`;
  return {
    text: `Factura ${inv.invoiceNumber} emitida${to}`,
    href: inv.pdfUrl || "/admin/crm?tab=invoices",
  };
}
