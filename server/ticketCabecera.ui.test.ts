/**
 * Cabecera de los tickets impresos (TPV y reserva): datos fiscales de la empresa desde `config.ticketHeader`
 * (misma fuente que la factura) y nunca un domicilio fijo ajeno.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ticketHeaderLines } from "../shared/ticketHeaderLines";

(globalThis as { React?: unknown }).React = React;

const state = vi.hoisted(() => ({ header: undefined as unknown }));
vi.mock("../client/src/lib/trpc", () => ({
  trpc: {
    config: { ticketHeader: { useQuery: () => ({ data: state.header }) } },
    tpv: { sendTicketEmail: { useMutation: () => ({ mutate: () => undefined, isPending: false }) } },
  },
}));
vi.mock("@/components/ui/dialog", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children);
  return { Dialog: Pass, DialogContent: Pass, DialogHeader: Pass, DialogTitle: Pass };
});

import TpvTicket from "../client/src/pages/admin/tpv/TpvTicket";
import ReservationTicket from "../client/src/pages/admin/crm/ReservationTicket";

const sale = {
  sale: {
    ticketNumber: "TPV-0001", createdAt: "2026-11-01T10:00:00Z", subtotal: 24.2, discountAmount: 0, total: 24.2,
    items: [{ productName: "Camiseta", quantity: 1, unitPrice: 24.2, discountPercent: 0, subtotal: 24.2 }],
    payments: [{ method: "cash", amount: 24.2 }],
  },
};
const reservation = { reservationNumber: "RES-1", createdAt: "2026-11-01T10:00:00Z", amountTotal: 2420, productName: "Servicio", people: 1 };

const renderBoth = () => [
  renderToStaticMarkup(React.createElement(TpvTicket, { open: true, sale: sale as never, onClose: () => undefined })),
  renderToStaticMarkup(React.createElement(ReservationTicket, { open: true, reservation: reservation as never, onClose: () => undefined })),
];

beforeEach(() => { state.header = undefined; });

describe("cabecera del ticket", () => {
  it("sin datos fiscales no imprime ningún domicilio ni NIF inventado", () => {
    state.header = { name: "Asesoría Norte", legalName: null, taxId: null, address: null, city: null, fiscalAddress: null };
    for (const html of renderBoth()) {
      expect(html).toContain("ASESORÍA NORTE");
      expect(html).not.toMatch(/Corazón de María|28002|NIF:|CIF:/);
    }
  });

  it("con datos: razón social, NIF y domicilio fiscal de la empresa", () => {
    state.header = { name: "Asesoría Norte", legalName: "Asesoría Norte, S.L.", taxId: "B12345678", address: null, city: null, fiscalAddress: "Calle Mayor, 1, 39001 Santander" };
    for (const html of renderBoth()) {
      expect(html).toContain("Asesoría Norte, S.L. · NIF: B12345678");
      expect(html).toContain("Calle Mayor, 1, 39001 Santander");
      expect(html).not.toContain("Corazón de María");
    }
  });

  it("no repite el domicilio fiscal si coincide con la dirección comercial", () => {
    expect(ticketHeaderLines({ address: "Calle Mayor, 1", city: "Santander", fiscalAddress: "Calle Mayor 1 · Santander" }).fiscalAddress).toBeNull();
    expect(ticketHeaderLines({ fiscalAddress: "  " })).toEqual({ commercial: null, fiscal: null, fiscalAddress: null });
  });
});
