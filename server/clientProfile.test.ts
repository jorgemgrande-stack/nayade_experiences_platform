/**
 * Ficha de cliente del CRM: tipo, validación del formulario, datos enviados, duplicados e historial
 * (lógica pura de shared/clientProfile.ts) y textos del listado, la ficha y el formulario.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildClientActivity, clientDisplayName, clientFormPayload, clientFormValues, clientKind, duplicateMessage, invoicedTotal,
  validateClientForm, validateClientTaxId, type ClientFormValues,
} from "../shared/clientProfile";

const base: ClientFormValues = {
  kind: "particular", name: "Ana Gómez", company: "", email: "ana@cliente.example", phone: "", nif: "", address: "",
  city: "", postalCode: "", country: "ES", notes: "",
};

describe("tipo de cliente", () => {
  it("empresa si tiene razón social; particular si no", () => {
    expect(clientKind({ company: "Talleres Norte SL" })).toBe("empresa");
    expect(clientKind({ company: "  " })).toBe("particular");
    expect(clientKind({ company: null })).toBe("particular");
  });
  it("se muestra la razón social de una empresa y el nombre de un particular", () => {
    expect(clientDisplayName({ name: "Luis", company: "Talleres Norte SL" })).toBe("Talleres Norte SL");
    expect(clientDisplayName({ name: "Ana Gómez", company: "" })).toBe("Ana Gómez");
  });
  it("los valores iniciales del formulario deducen el tipo", () => {
    expect(clientFormValues({ id: 1, name: "Luis", company: "Talleres Norte SL", email: "a@b.es" }).kind).toBe("empresa");
    expect(clientFormValues(null)).toMatchObject({ kind: "particular", country: "ES", name: "" });
  });
});

describe("validación del formulario", () => {
  it("un particular válido no tiene errores", () => {
    expect(validateClientForm(base)).toEqual({});
  });
  it("pide el nombre del particular y la razón social de la empresa", () => {
    expect(validateClientForm({ ...base, name: "" }).name).toBe("Indica el nombre y los apellidos.");
    const e = validateClientForm({ ...base, kind: "empresa", name: "", company: "" });
    expect(e.company).toBe("Indica la razón social de la empresa.");
    expect(e.name).toBeUndefined();
  });
  it("correo obligatorio y con formato válido, en español", () => {
    expect(validateClientForm({ ...base, email: "" }).email).toBe("Indica un correo electrónico.");
    expect(validateClientForm({ ...base, email: "pedro-mal" }).email).toMatch(/no es válido/);
  });
  it("NIF, NIE y CIF con su letra o dígito de control", () => {
    expect(validateClientForm({ ...base, nif: "12345678Z" }).nif).toBeUndefined();
    expect(validateClientForm({ ...base, nif: "X1234567L" }).nif).toBeUndefined();
    expect(validateClientForm({ ...base, kind: "empresa", company: "Talleres SL", nif: "B12345674" }).nif).toBeUndefined();
    expect(validateClientForm({ ...base, nif: "12345678A" }).nif).toBe(validateClientTaxId("12345678A", "particular"));
    expect(validateClientTaxId("12345678A", "particular")).toMatch(/NIF o NIE no es válido/);
    expect(validateClientTaxId("B12345670", "empresa")).toMatch(/CIF o NIF no es válido/);
  });
  it("fuera de España no se valida el NIF ni el código postal", () => {
    expect(validateClientForm({ ...base, country: "FR", nif: "FR123", postalCode: "75001A" })).toEqual({});
  });
  it("al editar no se revalidan los datos que no cambian", () => {
    const e = validateClientForm({ ...base, nif: "MAL", postalCode: "1" }, (k) => k === "email");
    expect(e).toEqual({});
  });
  it("no pide fecha de nacimiento", () => {
    expect(Object.keys(base)).not.toContain("birthDate");
  });
});

describe("datos enviados", () => {
  it("el particular se envía sin razón social; el NIF normalizado y el correo en minúsculas", () => {
    const p = clientFormPayload({ ...base, company: "Resto", email: " Ana@Cliente.EXAMPLE ", nif: "12.345.678-z" });
    expect(p).toMatchObject({ company: "", email: "ana@cliente.example", nif: "12345678Z", country: "ES" });
  });
  it("una empresa sin persona de contacto usa la razón social como nombre", () => {
    const p = clientFormPayload({ ...base, kind: "empresa", name: "", company: "Talleres Norte SL" });
    expect(p).toMatchObject({ name: "Talleres Norte SL", company: "Talleres Norte SL" });
  });
});

describe("duplicados", () => {
  it("el correo bloquea; el NIF solo avisa", () => {
    expect(duplicateMessage({ id: 1, name: "Ana", company: "", email: "a@b.es", nif: null, by: ["email"] })).toBe("Ya existe un cliente con este correo: Ana.");
    expect(duplicateMessage({ id: 2, name: "Luis", company: "Talleres SL", email: "c@d.es", nif: "B12345674", by: ["nif"] })).toMatch(/^Ya existe un cliente con este NIF: Talleres SL/);
  });
});

describe("historial de actividad", () => {
  const h = {
    quotes: [{ id: 1, quoteNumber: "PRE-2026-0001", title: "Reforma", status: "enviado", total: "121.00", createdAt: "2026-10-01T10:00:00Z" }],
    reservations: [
      { id: 7, reservationNumber: "PED-7", productName: "Camiseta", status: "paid", amountTotal: 2500, amountPaid: 2500, paymentMethod: "efectivo", createdAt: Date.parse("2026-10-05T10:00:00Z"), paidAt: Date.parse("2026-10-05T10:01:00Z") },
    ],
    invoices: [
      { id: 3, invoiceNumber: "FAC-2026-0003", status: "cobrada", total: "50.00", reservationId: null, paymentMethod: "transferencia", createdAt: "2026-10-10T10:00:00Z" },
      { id: 4, invoiceNumber: "FAC-2026-0004", status: "generada", total: "25.00", reservationId: 7, createdAt: "2026-10-06T10:00:00Z" },
      { id: 5, invoiceNumber: "FAC-2026-0005", status: "anulada", total: "80.00", reservationId: null, createdAt: "2026-10-07T10:00:00Z" },
    ],
    tpvTickets: { 7: "T-0001" },
    emails: [{ id: 9, subject: "Tu presupuesto", status: "sent", recipientEmail: "ana@cliente.example", createdAt: "2026-10-02T10:00:00Z" }],
    notes: [{ id: 2, body: "Prefiere llamadas por la tarde", authorName: "Marta", createdAt: "2026-10-11T10:00:00Z" }],
  };

  it("une todo en orden, de lo más reciente a lo más antiguo, con enlaces", () => {
    const a = buildClientActivity(h);
    expect(a.map((x) => x.id)).toEqual([
      "note-2", "invoice-3", "payment-invoice-3", "invoice-5", "invoice-4", "payment-order-7", "order-7", "email-9", "quote-1",
    ]);
    const quote = a.find((x) => x.id === "quote-1")!;
    expect(quote).toMatchObject({ title: "Presupuesto PRE-2026-0001", status: "Enviado", amount: 121, href: "/admin/crm?tab=quotes&search=PRE-2026-0001" });
    const order = a.find((x) => x.id === "order-7")!;
    expect(order).toMatchObject({ title: "Venta en caja · ticket T-0001", amount: 25, status: "Pagado", href: "/admin/crm?tab=reservations&resId=7" });
    const inv = a.find((x) => x.id === "invoice-3")!;
    expect(inv.externalHref).toBe("/api/invoices/preview?n=FAC-2026-0003");
    expect(a.find((x) => x.id === "payment-invoice-3")).toMatchObject({ kind: "payment", amount: 50, detail: "Transferencia" });
    expect(a.find((x) => x.id === "payment-order-7")).toMatchObject({ kind: "payment", amount: 25, detail: "Efectivo" });
  });

  it("una factura de un pedido no duplica el pago y una sin cobrar no genera pago", () => {
    const a = buildClientActivity(h);
    expect(a.filter((x) => x.kind === "payment")).toHaveLength(2);
  });

  it("usa el nombre de pedido de la empresa", () => {
    const a = buildClientActivity({ ...h, tpvTickets: {} }, { order: "Pedido" });
    expect(a.find((x) => x.id === "order-7")!.title).toBe("Pedido PED-7");
  });

  it("el total facturado no cuenta facturas anuladas ni abonadas", () => {
    expect(invoicedTotal(h.invoices)).toBe(75);
  });
});

describe("textos del listado, la ficha y el formulario", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
  const files = [
    "client/src/pages/admin/crm/ClientsManager.tsx",
    "client/src/pages/admin/crm/ClientDetail.tsx",
    "client/src/components/admin/crm/ClientFormDialog.tsx",
  ];
  it("sin «convertir en cliente», «Convertidos», fecha de nacimiento ni futuras reservas", () => {
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/Convertidos|convertir en cliente|Ampliar datos|Fecha de nacimiento|futuras reservas|Llamadas Vapi|WhatsApp/i);
    }
  });
  it("las acciones del listado llevan texto y el nombre abre la ficha", () => {
    const src = read(files[0]);
    expect(src).toMatch(/>Ver ficha</);
    expect(src).toMatch(/\s+Editar\s+/);
    expect(src).toMatch(/\s+Eliminar\s+/);
    expect(src).toMatch(/href=\{fichaHref\(client\)\}/);
  });
  it("la ruta de la ficha está registrada", () => {
    expect(read("client/src/App.tsx")).toMatch(/path="\/admin\/crm\/clientes\/:id"/);
  });
});
