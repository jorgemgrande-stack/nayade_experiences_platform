/**
 * Importes y fechas con formato de España en el TPV, los tickets, el CRM (presupuestos y facturas) y la página de
 * pago: «24,20 €» y «01/11/2026», nunca «24.20€» ni «2026-11-01».
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { formatDayEs } from "../shared/formatDay";

(globalThis as { React?: unknown }).React = React;

vi.mock("../client/src/lib/trpc", () => ({
  trpc: {
    config: { ticketHeader: { useQuery: () => ({ data: { name: "Empresa" } }) } },
    tpv: { sendTicketEmail: { useMutation: () => ({ mutate: () => undefined, isPending: false }) } },
  },
}));
vi.mock("@/components/ui/dialog", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children);
  return { Dialog: Pass, DialogContent: Pass, DialogHeader: Pass, DialogTitle: Pass };
});

import TpvTicket from "../client/src/pages/admin/tpv/TpvTicket";
import ReservationTicket from "../client/src/pages/admin/crm/ReservationTicket";

const FILES = [
  "client/src/pages/admin/tpv/TpvScreen.tsx",
  "client/src/pages/admin/tpv/TpvBackoffice.tsx",
  "client/src/pages/admin/tpv/TpvCloseSession.tsx",
  "client/src/pages/admin/tpv/TpvSplitPayment.tsx",
  "client/src/pages/admin/tpv/TpvTicket.tsx",
  "client/src/pages/admin/crm/ReservationTicket.tsx",
  "client/src/pages/admin/crm/CRMDashboard.tsx",
  "client/src/pages/ReservaOk.tsx",
  "client/src/pages/RestauranteReservaOk.tsx",
];

describe("formato de España", () => {
  it("fechas AAAA-MM-DD como dd/mm/aaaa", () => {
    expect(formatDayEs("2026-11-01")).toBe("01/11/2026");
    expect(formatDayEs("mañana")).toBe("mañana");
    expect(formatDayEs(null)).toBe("");
  });

  it("ticket del TPV y de reserva: importes con coma decimal y fecha española", () => {
    const sale = { sale: { ticketNumber: "T-1", createdAt: "2026-11-01T10:00:00Z", subtotal: 24.2, discountAmount: 0, total: 24.2, items: [{ productName: "Camiseta", quantity: 1, unitPrice: 24.2, discountPercent: 0, subtotal: 24.2 }], payments: [{ method: "cash", amount: 24.2 }] } };
    const tpv = renderToStaticMarkup(React.createElement(TpvTicket, { open: true, sale: sale as never, onClose: () => undefined }));
    expect(tpv).toMatch(/24,20\s€/);
    expect(tpv).not.toMatch(/24\.20/);
    const res = renderToStaticMarkup(React.createElement(ReservationTicket, { open: true, reservation: { reservationNumber: "R-1", createdAt: "2026-11-01T10:00:00Z", bookingDate: "2026-11-01", amountTotal: 24200, people: 1, productName: "Servicio" } as never, onClose: () => undefined }));
    expect(res).toMatch(/242,00\s€/);
    expect(res).toContain("01/11/2026");
    expect(res).not.toContain("2026-11-01");
  });

  it("ninguna pantalla del TPV, del CRM ni de pago pinta importes con toFixed seguido de €", () => {
    for (const f of FILES) {
      const src = fs.readFileSync(path.resolve(__dirname, "..", f), "utf8");
      expect(src, f).not.toMatch(/toFixed\(2\)\}[\s\u00a0]?€/);
      expect(src, f).not.toMatch(/\{(amountEuros|depositEuros)\}[\s\u00a0]?€/);
    }
  });
});
