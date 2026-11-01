/**
 * Revisión de facturación de pedidos cobrados: una venta de caja con su ticket (factura simplificada) no es
 * una incidencia; un pedido cobrado sin factura ni ticket sí.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ordersWithoutInvoice } from "./invoiceAudit";

const paid = [
  { id: 1, quoteId: null, invoiceId: null }, // venta de caja en efectivo con ticket
  { id: 2, quoteId: null, invoiceId: null }, // pedido cobrado sin documento
  { id: 3, quoteId: 30, invoiceId: null }, // presupuesto facturado
  { id: 4, quoteId: null, invoiceId: 99 }, // factura enlazada en la reserva
  { id: 5, quoteId: null, invoiceId: null }, // factura por la reserva
];

describe("pedidos cobrados sin factura", () => {
  it("solo es incidencia lo que no tiene factura ni ticket de caja", () => {
    const out = ordersWithoutInvoice(paid, [{ reservationId: null, quoteId: 30 }, { reservationId: 5, quoteId: null }], [1]);
    expect(out.map((r) => r.id)).toEqual([2]);
  });

  it("sin ticket, la venta en efectivo sí figura", () => {
    expect(ordersWithoutInvoice(paid, [], []).map((r) => r.id)).toEqual([1, 2, 3, 5]);
  });

  it("el aviso de Ventas usa un texto genérico, sin «auditoría» ni «requieren factura manual»", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../client/src/pages/admin/crm/CRMDashboard.tsx"), "utf8");
    expect(src).not.toContain("Auditoría — se detectaron incidencias");
    expect(src).not.toContain("requieren factura manual");
    expect(src).toContain("Revisión de facturación");
  });
});
