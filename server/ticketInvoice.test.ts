/**
 * Canje de un ticket de caja por factura completa (art. 6 RD 1619/2012): destinatario obligatorio,
 * datos propuestos del cliente vinculado y forma de pago del ticket.
 */
import { describe, it, expect } from "vitest";
import {
  formatRecipientAddress,
  invoicePaymentMethodFromTicket,
  proposeTicketInvoiceRecipient,
  validateTicketInvoiceRecipient,
} from "../shared/ticketInvoice";

const full = { name: "Transportes Ruiz SL", nif: "B12345674", address: "Polígono Sur 4", postalCode: "28901", city: "Getafe" };

describe("validateTicketInvoiceRecipient", () => {
  it("con nombre, NIF y dirección completa se puede emitir", () => {
    expect(validateTicketInvoiceRecipient(full)).toEqual({});
  });

  it("sin nombre ni NIF se rechaza con mensajes en español", () => {
    const e = validateTicketInvoiceRecipient({ ...full, name: " ", nif: "" });
    expect(e.name).toBe("Indica el nombre o la razón social del destinatario de la factura.");
    expect(e.nif).toBe("Indica el NIF del destinatario de la factura.");
  });

  it("el nombre genérico de la caja («Cliente TPV») no identifica al destinatario", () => {
    expect(validateTicketInvoiceRecipient({ ...full, name: "Cliente TPV" }).name).toBeTruthy();
    expect(validateTicketInvoiceRecipient({ ...full, name: "cliente tpv" }).name).toBeTruthy();
  });

  it("NIF con la letra de control mal: error con ejemplo", () => {
    expect(validateTicketInvoiceRecipient({ ...full, nif: "B12345670" }).nif).toMatch(/no es válido.*B12345674/);
  });

  it("acepta NIF de persona física y número de IVA intracomunitario", () => {
    expect(validateTicketInvoiceRecipient({ ...full, nif: "12345678Z" }).nif).toBeUndefined();
    expect(validateTicketInvoiceRecipient({ ...full, nif: "FR12345678901" }).nif).toBeUndefined();
  });

  it("la dirección, el código postal y la población son obligatorios", () => {
    const e = validateTicketInvoiceRecipient({ ...full, address: "", postalCode: "", city: "" });
    expect(Object.keys(e).sort()).toEqual(["address", "city", "postalCode"]);
  });
});

describe("formatRecipientAddress", () => {
  it("una línea con dirección, código postal y población", () => {
    expect(formatRecipientAddress(full)).toBe("Polígono Sur 4, 28901 Getafe");
  });
});

describe("proposeTicketInvoiceRecipient", () => {
  it("con cliente vinculado propone su razón social y sus datos fiscales", () => {
    const p = proposeTicketInvoiceRecipient({ name: "Pedro Ruiz", company: "Transportes Ruiz SL", nif: "B12345674", address: "Polígono Sur 4", postalCode: "28901", city: "Getafe" }, "Pedro");
    expect(p).toEqual({ ...full, fromClient: true });
  });

  it("cliente particular: su nombre", () => {
    expect(proposeTicketInvoiceRecipient({ name: "Lucía Martín", company: "", nif: "12345678Z" }, null).name).toBe("Lucía Martín");
  });

  it("ticket anónimo: no propone «Cliente TPV» como nombre", () => {
    expect(proposeTicketInvoiceRecipient(null, "Cliente TPV")).toEqual({ name: "", nif: "", address: "", postalCode: "", city: "", fromClient: false });
    expect(proposeTicketInvoiceRecipient(null, "Ana García").name).toBe("Ana García");
  });
});

describe("invoicePaymentMethodFromTicket", () => {
  it("efectivo y tarjeta del ticket", () => {
    expect(invoicePaymentMethodFromTicket([{ method: "cash", amount: "22.00" }])).toBe("efectivo");
    expect(invoicePaymentMethodFromTicket([{ method: "card", amount: 10 }])).toBe("tarjeta_fisica");
    expect(invoicePaymentMethodFromTicket([{ method: "bizum", amount: 10 }])).toBe("otro");
  });

  it("pago dividido: la forma del cobro de mayor importe", () => {
    expect(invoicePaymentMethodFromTicket([{ method: "cash", amount: 5 }, { method: "card", amount: 17 }])).toBe("tarjeta_fisica");
  });

  it("sin cobros del ticket, la forma de pago del pedido", () => {
    expect(invoicePaymentMethodFromTicket([], "transferencia")).toBe("transferencia");
    expect(invoicePaymentMethodFromTicket([], null)).toBe("otro");
  });
});
