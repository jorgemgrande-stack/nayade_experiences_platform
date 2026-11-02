import { describe, it, expect } from "vitest";
import { CASH_SALE_LABEL, orderActivityTitle, orderCustomerLabel, saleInvoiceNotice } from "../shared/cashSaleLabel";

describe("nombre de los pedidos de una venta en caja", () => {
  it("venta sin cliente ni factura: «Venta en caja», nunca «Cliente TPV»", () => {
    expect(orderCustomerLabel({ customerName: "Cliente TPV" })).toBe(CASH_SALE_LABEL);
    expect(orderCustomerLabel({ customerName: "", invoiceClientName: null })).toBe("Venta en caja");
    expect(orderActivityTitle({ customerName: "Cliente TPV" })).toBe("Venta en caja");
    expect(orderActivityTitle({ customerName: "Cliente TPV" })).not.toContain("Cliente TPV");
  });

  it("venta sin cliente con factura a un destinatario: su nombre", () => {
    expect(orderCustomerLabel({ customerName: "Cliente TPV", invoiceClientName: "Talleres Prueba SL" })).toBe("Talleres Prueba SL");
    expect(orderActivityTitle({ customerName: "Cliente TPV", invoiceClientName: "Talleres Prueba SL" })).toBe("Venta en caja · Talleres Prueba SL");
    // Una factura con el nombre provisional no cuenta como destinatario
    expect(orderCustomerLabel({ customerName: "Cliente TPV", invoiceClientName: "Cliente TPV" })).toBe("Venta en caja");
  });

  it("pedido con cliente: igual que antes", () => {
    expect(orderCustomerLabel({ customerName: "Ana López", invoiceClientName: "Otra SL" })).toBe("Ana López");
    expect(orderActivityTitle({ customerName: "Ana López" })).toBe("Pedido de Ana López");
  });
});

describe("aviso de la factura emitida al cobrar en caja", () => {
  it("con factura: número, destinatario y enlace al documento", () => {
    expect(saleInvoiceNotice({ invoiceNumber: "FAC-2026-0007", clientName: "Talleres Prueba SL", pdfUrl: "/api/invoices/preview?n=FAC-2026-0007" }))
      .toEqual({ text: "Factura FAC-2026-0007 emitida a Talleres Prueba SL", href: "/api/invoices/preview?n=FAC-2026-0007" });
  });
  it("sin documento guardado: enlace al listado de facturas", () => {
    expect(saleInvoiceNotice({ invoiceNumber: "FAC-2026-0008", clientName: "Ana", pdfUrl: null })?.href).toBe("/admin/crm?tab=invoices");
  });
  it("sin factura (solo ticket): sin aviso", () => {
    expect(saleInvoiceNotice(null)).toBeNull();
    expect(saleInvoiceNotice(undefined)).toBeNull();
  });
});
