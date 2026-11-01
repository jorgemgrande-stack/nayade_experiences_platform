/**
 * Documento fiscal de una venta de caja (RD 1619/2012): sin destinatario identificado, solo ticket (factura
 * simplificada, art. 4); con nombre o razón social, NIF y domicilio, factura completa (art. 6); por encima de
 * 400 € IVA incluido no basta con el ticket. Lógica pura y comprobaciones del fuente de la caja.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { cashSaleDocument, exceedsSimplifiedInvoiceLimit, SIMPLIFIED_INVOICE_LIMIT_EUR } from "../shared/ticketInvoice";
import { diagnoseAnonymousInvoice, formatAnonymousDiagnosis } from "./tpvAnonymousInvoiceDiagnosis";

const full = { name: "Transportes Ruiz SL", nif: "b12345674", address: "Polígono Sur 4", postalCode: "28901", city: "Getafe" };
const client = { name: "Lucía Martín", company: "Transportes Ruiz SL", nif: "B12345674", address: "Polígono Sur 4", postalCode: "28901", city: "Getafe" };

describe("límite de la factura simplificada", () => {
  it("400 € IVA incluido: hasta 400,00 cabe ticket; desde 400,01 no", () => {
    expect(SIMPLIFIED_INVOICE_LIMIT_EUR).toBe(400);
    expect(exceedsSimplifiedInvoiceLimit(400)).toBe(false);
    expect(exceedsSimplifiedInvoiceLimit(399.999)).toBe(false);
    expect(exceedsSimplifiedInvoiceLimit(400.01)).toBe(true);
    expect(exceedsSimplifiedInvoiceLimit(0.1 + 399.9)).toBe(false);
  });
});

describe("cashSaleDocument", () => {
  it("venta sin cliente (efectivo o tarjeta): solo ticket", () => {
    expect(cashSaleDocument({ total: 24.2 })).toEqual({ kind: "ticket" });
    expect(cashSaleDocument({ total: 400, client: null, requested: null })).toEqual({ kind: "ticket" });
  });

  it("cliente vinculado con razón social, NIF y domicilio: factura completa a su nombre", () => {
    expect(cashSaleDocument({ total: 24.2, client })).toEqual({
      kind: "factura", source: "cliente",
      recipient: { name: "Transportes Ruiz SL", nif: "B12345674", address: "Polígono Sur 4", postalCode: "28901", city: "Getafe" },
    });
    // Sin razón social, a nombre de la persona
    const r = cashSaleDocument({ total: 24.2, client: { ...client, company: "", nif: "12345678Z" } });
    expect(r.kind === "factura" && r.recipient.name).toBe("Lucía Martín");
  });

  it("cliente vinculado sin NIF (o con NIF no válido, o sin domicilio): solo ticket", () => {
    expect(cashSaleDocument({ total: 24.2, client: { ...client, nif: "" } })).toEqual({ kind: "ticket" });
    expect(cashSaleDocument({ total: 24.2, client: { ...client, nif: "B12345670" } })).toEqual({ kind: "ticket" });
    expect(cashSaleDocument({ total: 24.2, client: { ...client, address: null, city: "" } })).toEqual({ kind: "ticket" });
  });

  it("nunca una factura a nombre de «Cliente TPV»", () => {
    expect(cashSaleDocument({ total: 24.2, client: { ...client, company: "", name: "Cliente TPV" } })).toEqual({ kind: "ticket" });
    const r = cashSaleDocument({ total: 24.2, requested: { ...full, name: "Cliente TPV" } });
    expect(r.kind).toBe("rechazo");
  });

  it("datos escritos en la caja: factura completa con NIF en mayúsculas; incompletos, se rechaza el cobro", () => {
    expect(cashSaleDocument({ total: 24.2, requested: full })).toEqual({
      kind: "factura", source: "caja",
      recipient: { ...full, nif: "B12345674" },
    });
    const bad = cashSaleDocument({ total: 24.2, requested: { ...full, nif: "", city: "" } });
    expect(bad.kind).toBe("rechazo");
    expect(bad.kind === "rechazo" && bad.message).toContain("Indica el NIF del destinatario de la factura.");
    expect(bad.kind === "rechazo" && bad.message).toContain("Indica la población.");
    // Los datos de la caja mandan sobre los del cliente vinculado
    expect(cashSaleDocument({ total: 24.2, requested: { ...full, name: "Otra SL" }, client })).toMatchObject({ kind: "factura", source: "caja", recipient: { name: "Otra SL" } });
  });

  it("por encima de 400 €: sin destinatario se rechaza; con él, factura completa", () => {
    const r = cashSaleDocument({ total: 484 });
    expect(r.kind).toBe("rechazo");
    expect(r.kind === "rechazo" && r.message).toBe("Esta venta supera 400 € (IVA incluido) y no se puede cobrar solo con ticket: hace falta factura completa. Indica los datos del destinatario (nombre o razón social, NIF y dirección).");
    expect(cashSaleDocument({ total: 484, client: { ...client, nif: "" } }).kind).toBe("rechazo");
    expect(cashSaleDocument({ total: 484, client }).kind).toBe("factura");
    expect(cashSaleDocument({ total: 484, requested: full }).kind).toBe("factura");
  });
});

describe("la caja aplica la regla", () => {
  const tpv = fs.readFileSync(path.resolve(__dirname, "routers/tpv.ts"), "utf8");
  const screen = fs.readFileSync(path.resolve(__dirname, "../client/src/pages/admin/tpv/TpvScreen.tsx"), "utf8");

  it("el servidor decide antes de numerar y solo emite factura con destinatario", () => {
    const decide = tpv.indexOf("const saleDocument = cashSaleDocument(");
    expect(decide).toBeGreaterThan(0);
    expect(decide).toBeLessThan(tpv.indexOf("const ticketNumber = await generateTicketNumber("));
    expect(tpv).toContain('if (saleDocument.kind === "factura") {');
    expect(tpv).not.toContain('if (primaryPaymentMethod !== "cash") {');
    expect(tpv).not.toMatch(/clientName:\s+input\.customerName \|\| "Cliente TPV"/);
    expect(tpv).toContain("clientName:     recipient.name,");
  });

  it("la pantalla pide los datos por encima del límite y antes de cada forma de cobro", () => {
    expect(screen).toContain("exceedsSimplifiedInvoiceLimit(cartTotal)");
    expect(screen.split("checkSaleDocument()").length - 1).toBe(3);
    expect(screen).toContain("invoiceRecipient: saleInvoiceRecipient,");
  });
});

describe("diagnóstico de las facturas de caja ya emitidas (solo lectura)", () => {
  const row = { invoiceNumber: "FAC-2026-0007", status: "cobrada", issuedAt: "2026-10-15T10:00:00Z", total: "24.20", clientName: "Cliente TPV", clientNif: null, ticketNumber: "TPV-2026-0003", creditNotes: 0 };
  it("señala el nombre genérico y la falta de NIF; una factura con destinatario no tiene señales", () => {
    expect(diagnoseAnonymousInvoice(row)).toEqual({ invoiceNumber: "FAC-2026-0007", issuedOn: "2026-10-15", total: 24.2, status: "cobrada", ticketNumber: "TPV-2026-0003", hasCreditNote: false, issues: ["nombre_generico", "sin_nif"] });
    expect(diagnoseAnonymousInvoice({ ...row, clientName: "Lucía Martín" }).issues).toEqual(["sin_nif"]);
    expect(diagnoseAnonymousInvoice({ ...row, clientName: "Transportes Ruiz SL", clientNif: "B12345674" }).issues).toEqual([]);
    expect(diagnoseAnonymousInvoice({ ...row, creditNotes: "1" }).hasCreditNote).toBe(true);
  });
  it("el texto no lleva datos de clientes y recuerda que no se ha modificado nada", () => {
    const f = diagnoseAnonymousInvoice({ ...row, clientName: "Lucía Martín" });
    const text = formatAnonymousDiagnosis({ checked: 3, findings: [f], total: 24.2 });
    expect(text).toContain("Facturas de caja revisadas: 3. Sin destinatario identificado: 1 (24,20 €).");
    expect(text).toContain("FAC-2026-0007 · 2026-10-15 · 24,20 € · cobrada · ticket TPV-2026-0003 · sin NIF del destinatario");
    expect(text).toContain("No se ha modificado ningún documento.");
    expect(text).not.toContain("Lucía");
    expect(formatAnonymousDiagnosis({ checked: 2, findings: [], total: 0 })).toBe("Facturas de caja revisadas: 2. Ninguna sin destinatario identificado.");
  });
  it("el script solo lee", () => {
    const script = fs.readFileSync(path.resolve(__dirname, "../scripts/diagnostico/facturas-cliente-tpv.ts"), "utf8");
    const lib = fs.readFileSync(path.resolve(__dirname, "tpvAnonymousInvoiceDiagnosis.ts"), "utf8");
    expect(script).toContain('await conn.query("SET SESSION TRANSACTION READ ONLY");');
    for (const src of [script, lib]) expect(src).not.toMatch(/\b(UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE|REPLACE)\s/);
  });
});
