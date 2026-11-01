/**
 * Facturas de presupuestos: NIF, nombre fiscal y dirección del cliente vinculado (como la factura libre).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../drizzle/schema", () => ({ clients: { leadId: "leadId", email: "email" } }));
vi.mock("drizzle-orm", () => ({ eq: (col: string, v: unknown) => ({ col, v }) }));

import { clientFiscalAddress, invoiceClientForQuote, invoiceClientFrom } from "./invoiceClient";

const empresa = { name: "Ana López", email: "ana@cliente.example", phone: "600111222", company: "Talleres López SL", nif: "B12345674", address: "Calle Mayor 1", postalCode: "28001", city: "Madrid" };

describe("datos del cliente en la factura de un presupuesto", () => {
  it("cliente vinculado: nombre fiscal de la empresa, NIF y dirección completa", () => {
    expect(invoiceClientFrom(empresa, { name: "Ana", email: "ana@cliente.example", phone: null })).toEqual({
      clientName: "Talleres López SL",
      clientEmail: "ana@cliente.example",
      clientPhone: "600111222",
      clientNif: "B12345674",
      clientAddress: "Calle Mayor 1, 28001, Madrid",
    });
  });

  it("particular sin empresa: su nombre; campos vacíos quedan sin rellenar", () => {
    const d = invoiceClientFrom({ ...empresa, company: "", nif: "", address: null, postalCode: "", city: "" }, { name: "Ana (oportunidad)", email: "ana@cliente.example" });
    expect(d).toMatchObject({ clientName: "Ana López", clientNif: null, clientAddress: null });
    expect(clientFiscalAddress({ address: " ", postalCode: "28001", city: null })).toBe("28001");
  });

  it("sin cliente vinculado: los datos de la oportunidad, sin NIF ni dirección inventados", () => {
    expect(invoiceClientFrom(null, { name: "Pedro", email: "pedro@x.example", phone: "611" })).toEqual({ clientName: "Pedro", clientEmail: "pedro@x.example", clientPhone: "611", clientNif: null, clientAddress: null });
  });

  it("busca el cliente por la oportunidad del presupuesto y, si no, por el correo", async () => {
    const calls: unknown[] = [];
    const dbx = {
      select: () => ({ from: () => ({ where: (w: { col: string }) => ({ limit: async () => { calls.push(w.col); return w.col === "email" ? [empresa] : []; } }) }) }),
    };
    const d = await invoiceClientForQuote(dbx, { leadId: 7 }, { name: "Ana", email: "ana@cliente.example" });
    expect(calls).toEqual(["leadId", "email"]);
    expect(d.clientNif).toBe("B12345674");
  });
});
