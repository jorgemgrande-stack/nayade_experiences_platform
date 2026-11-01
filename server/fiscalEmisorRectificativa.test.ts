/**
 * Datos del emisor que la empresa corrige y factura rectificativa (lógica pura y plantilla, sin base de datos).
 *  - Los datos guardados en «Datos de la empresa» mandan sobre la entidad del registro en los documentos nuevos.
 *  - Cada factura nueva guarda una copia del emisor; las anteriores (sin copia) se pintan exactamente como antes.
 *  - El abono nuevo sale como FACTURA RECTIFICATIVA: factura rectificada, motivo, negativos y mención legal.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";

vi.mock("./_core/legacyDb", () => ({
  legacyPool: () => ({}),
  legacyDb: () => ({ select: () => ({ from: () => ({ where: async () => [{ key: "legalCompanyName", value: "Antigua SL" }, { key: "legalCompanyCif", value: "B99999999" }] }) }) }),
}));

const { buildInvoiceHtml, formatInvoiceMoney, parseIssuerSnapshot, toIssuerSnapshot, RECTIFICATIVE_LEGAL_NOTE } = await import("./invoiceHtml");
const { resolveCurrentLegalCompany, readableOnWhiteText, DOCUMENT_NEUTRAL_INK } = await import("./tenantBrand");
const { fiscalSettingError } = await import("./fiscalSettingsValidation");
const { buildInvoiceEmailHtml } = await import("./emailTemplates");

const fiscal = { legalName: "Empresa A Ejemplo SL", taxId: "B00000011", address: "Calle Registro 1", country: "ES" } as any;
const own = { legalCompanyName: "Talleres Prueba SL", legalCompanyCif: "B12345674", legalCompanyAddress: "Calle Nueva 1", legalCompanyZip: "28001", legalCompanyCity: "Madrid", legalCompanyProvince: "Madrid", legalCompanyIban: "ES9121000418450200051332" };

describe("emisor de los documentos nuevos (resolveCurrentLegalCompany)", () => {
  it("lo guardado por la empresa manda sobre la entidad del registro", () => {
    const l = resolveCurrentLegalCompany({ legalCompanyName: "Vieja SL" }, own, { multi: true, fiscal });
    expect(l).toMatchObject({ name: "Talleres Prueba SL", cif: "B12345674", address: "Calle Nueva 1", zip: "28001", city: "Madrid", iban: "ES9121000418450200051332" });
  });
  it("sin nada guardado: la entidad del registro (valor inicial) y, si falta, los ajustes antiguos", () => {
    expect(resolveCurrentLegalCompany({}, {}, { multi: true, fiscal })).toMatchObject({ name: "Empresa A Ejemplo SL", cif: "B00000011", address: "Calle Registro 1", zip: "" });
    expect(resolveCurrentLegalCompany({ legalCompanyName: "Vieja SL", legalCompanyCif: "B1" }, {}, { multi: true, fiscal: null })).toMatchObject({ name: "Vieja SL", cif: "B1" });
  });
  it("campo a campo: un dato vacío cae en el registro; el domicilio nunca mezcla dos fuentes", () => {
    const l = resolveCurrentLegalCompany({}, { legalCompanyName: "Talleres Prueba SL", legalCompanyCif: "  ", legalCompanyZip: "28001" }, { multi: true, fiscal });
    expect(l).toMatchObject({ name: "Talleres Prueba SL", cif: "B00000011", address: "Calle Registro 1", zip: "" });
  });
  it("instalación de una sola empresa: sin cambios", () => {
    expect(resolveCurrentLegalCompany({ legalCompanyName: "Una SL" }, own, { multi: false, fiscal: null }).name).toBe("Una SL");
  });
});

describe("copia del emisor", () => {
  it("se guarda y se lee igual; lo que no es una copia válida se ignora", () => {
    const snap = toIssuerSnapshot({ name: "Talleres Prueba SL", cif: "B12345674", address: "Calle Nueva 1", city: "Madrid", zip: "28001", province: "Madrid", email: "", phone: "", iban: "" }, new Date("2026-11-01T10:00:00Z"));
    expect(snap).toMatchObject({ v: 1, capturedAt: "2026-11-01T10:00:00.000Z", cif: "B12345674" });
    expect(parseIssuerSnapshot(JSON.stringify(snap))).toMatchObject({ name: "Talleres Prueba SL", cif: "B12345674" });
    expect(parseIssuerSnapshot(null)).toBeNull();
    expect(parseIssuerSnapshot({ name: "x" })).toBeNull();
    expect(parseIssuerSnapshot("{roto")).toBeNull();
  });

  it("toda alta de factura guarda la copia del emisor", () => {
    const files = ["redsysRoutes.ts", "shopOrdersDb.ts", "routers/crm.ts", "routers/tpv.ts", "routers/cancellations.ts", "routers/fiscalAuditRouter.ts"];
    for (const f of files) {
      const src = fs.readFileSync(path.resolve(__dirname, f), "utf8");
      const inserts = src.split(/\.insert\(invoices\)\.values\(\{/).slice(1);
      expect(inserts.length, f).toBeGreaterThan(0);
      for (const rest of inserts) expect(rest.slice(0, 200), f).toMatch(/issuerSnapshot(: await issuerSnapshotForNewInvoice\(\))?,/);
      // Si se copia antes (fuera de una transacción), sale de la misma función
      if (!src.includes("issuerSnapshot: await issuerSnapshotForNewInvoice()")) expect(src, f).toContain("= await issuerSnapshotForNewInvoice()");
    }
  });
});

const invoice = {
  invoiceNumber: "FAC-2026-0003",
  clientName: "Cliente Prueba",
  clientEmail: "cliente@prueba.example",
  itemsJson: [{ description: "Servicio", quantity: 2, unitPrice: 50, total: 100, taxRate: 21 }, { description: "Curso", quantity: 1, unitPrice: 50, total: 50, taxRate: 10 }],
  subtotal: "150.00",
  taxRate: "21",
  taxAmount: "26.00",
  total: "176.00",
  taxBreakdown: [{ rate: 21, base: 100, amount: 21 }, { rate: 10, base: 50, amount: 5 }],
  issuedAt: new Date("2026-11-01T10:00:00Z"),
};
const snap = toIssuerSnapshot({ name: "Talleres Prueba SL", cif: "B12345674", address: "Calle Nueva 1", city: "Madrid", zip: "28001", province: "", email: "", phone: "", iban: "" });

describe("plantilla de la factura", () => {
  it("factura sin copia del emisor: exactamente la presentación de antes (colores fijos, «Factura»)", async () => {
    const html = await buildInvoiceHtml({ ...invoice, issuerSnapshot: null, invoiceType: "factura" });
    expect(html).toContain("background: #1a3a6b");
    expect(html).toContain("background: #f97316");
    expect(html).toContain('<span class="doc-label">Factura</span>');
    expect(html).toContain("Antigua SL");
    expect(html).not.toContain("rectifies");
  });

  it("factura nueva: los datos de su copia y los colores de la marca (sin marca, tinta neutra)", async () => {
    const html = await buildInvoiceHtml({ ...invoice, issuerSnapshot: snap, invoiceType: "factura" });
    expect(html).toContain("Talleres Prueba SL");
    expect(html).toContain("CIF: B12345674");
    expect(html).not.toContain("Antigua SL");
    expect(html).not.toMatch(/#1a3a6b|#f97316/);
    expect(html).toContain(`background: ${DOCUMENT_NEUTRAL_INK}`);
    expect(html).toContain('<span class="doc-label">Factura</span>');
  });

  it("abono nuevo parcial con IVA mixto: factura rectificativa con referencia, motivo, negativos y mención legal", async () => {
    const html = await buildInvoiceHtml({
      ...invoice,
      invoiceNumber: "ABO-2026-11-0001",
      itemsJson: [{ description: "Abono parcial de la factura FAC-2026-0003 (IVA 21 %)", quantity: 1, unitPrice: -60.5, total: -60.5, taxRate: 21 }, { description: "Abono parcial de la factura FAC-2026-0003 (IVA 10 %)", quantity: 1, unitPrice: -22, total: -22, taxRate: 10 }],
      subtotal: "-70.00",
      taxAmount: "-12.50",
      total: "-82.50",
      taxBreakdown: [{ rate: 21, base: -50, amount: -10.5 }, { rate: 10, base: -20, amount: -2 }],
      issuerSnapshot: snap,
      invoiceType: "abono",
      creditNoteReason: "Devolución <parcial>",
      rectifies: { invoiceNumber: "FAC-2026-0003", issuedAt: new Date("2026-10-20T10:00:00Z") },
    });
    expect(html).toContain('<span class="doc-label">Factura rectificativa</span>');
    expect(html).toContain("text-transform: uppercase");
    expect(html).toContain("ABO-2026-11-0001");
    expect(html).toContain("Rectifica la factura <strong>FAC-2026-0003</strong> de fecha 20/10/2026.");
    expect(html).toContain("Motivo de la rectificación: Devolución &lt;parcial&gt;");
    expect(html).toContain("Base imponible IVA 21%</td><td>−50,00 €");
    expect(html).toContain("IVA 21%</td><td>−10,50 €");
    expect(html).toContain("Base imponible IVA 10%</td><td>−20,00 €");
    expect(html).toContain("IVA 10%</td><td>−2,00 €");
    expect(html).toContain("<td>TOTAL</td><td>−82,50 €</td>");
    expect(html).toContain("Real Decreto 1619/2012");
    expect(RECTIFICATIVE_LEGAL_NOTE).toMatch(/artículo 15/);
  });

  it("abono total guardado en positivo (documento antiguo copiado): se presenta en negativo", async () => {
    const html = await buildInvoiceHtml({ ...invoice, invoiceNumber: "ABO-2026-11-0002", issuerSnapshot: snap, invoiceType: "abono", creditNoteReason: "Anulación", rectifies: { invoiceNumber: "FAC-2026-0003", issuedAt: "2026-10-20T10:00:00Z" } });
    expect(html).toContain("<td>TOTAL</td><td>−176,00 €</td>");
    expect(html).toContain("−100,00 €");
  });

  it("abono sin copia del emisor (emitido antes): se ve como se emitió", async () => {
    const html = await buildInvoiceHtml({ ...invoice, issuerSnapshot: null, invoiceType: "abono", creditNoteReason: "x", rectifies: null });
    expect(html).toContain('<span class="doc-label">Factura</span>');
    expect(html).not.toContain("rectificativa");
  });

  it("importes con coma decimal solo en los documentos nuevos; los emitidos sin copia conservan «176.00 €»", async () => {
    const nueva = await buildInvoiceHtml({ ...invoice, discount: "10.00", discountReason: "Cliente", issuerSnapshot: snap, invoiceType: "factura" });
    expect(nueva).toContain("<td>TOTAL</td><td>176,00 €</td>");
    expect(nueva).toContain("Base imponible IVA 21%</td><td>100,00 €");
    expect(nueva).toContain(">50,00 €</td>");
    expect(nueva).toContain(">−10,00 €</td>");
    expect(nueva).not.toMatch(/\d\.\d\d €/);
    const antigua = await buildInvoiceHtml({ ...invoice, discount: "10.00", discountReason: "Cliente", issuerSnapshot: null, invoiceType: "factura" });
    expect(antigua).toContain("<td>TOTAL</td><td>176.00 €</td>");
    expect(antigua).toContain(">-10.00 €</td>");
    expect(antigua).not.toMatch(/\d,\d\d €/);
  });

  it("formato de importe de los documentos nuevos", () => {
    expect(formatInvoiceMoney(29.9)).toBe("29,90 €");
    expect(formatInvoiceMoney(-22.5)).toBe("−22,50 €");
    expect(formatInvoiceMoney(12345.6)).toBe("12.345,60 €");
    expect(formatInvoiceMoney(-0.001)).toBe("0,00 €");
  });
});

describe("colores de la marca", () => {
  it("solo colores sobre los que se lee el texto blanco", () => {
    expect(readableOnWhiteText("#1a3a6b")).toBe(true);
    expect(readableOnWhiteText("#ffcc00")).toBe(false);
    expect(readableOnWhiteText("rojo")).toBe(false);
  });
});

describe("datos fiscales en el servidor", () => {
  it("NIF/CIF con su dígito de control, código postal, correo, teléfono e IBAN", async () => {
    expect(await fiscalSettingError("brand_nif", "B12345674", "ES")).toBeNull();
    expect(await fiscalSettingError("brand_nif", "B12345678", "ES")).toMatch(/NIF|CIF/);
    expect(await fiscalSettingError("brand_nif", "FR12345678901", "FR")).toBeNull();
    expect(await fiscalSettingError("site_legal_zip", "99999", "ES")).toMatch(/código postal/);
    expect(await fiscalSettingError("site_legal_iban", "ES00 1234", "ES")).toMatch(/IBAN/);
    expect(await fiscalSettingError("site_legal_iban", "ES91 2100 0418 4502 0005 1332", "ES")).toBeNull();
    expect(await fiscalSettingError("site_legal_email", "no-es-correo", "ES")).toMatch(/correo/);
    expect(await fiscalSettingError("brand_nif", "", "ES")).toBeNull();
    expect(await fiscalSettingError("brand_name", "cualquier cosa", "ES")).toBeNull();
  });
});

describe("correo de la factura rectificativa", () => {
  it("se titula factura rectificativa, cita la factura rectificada y el motivo, y desglosa el IVA por tipo", () => {
    const html = buildInvoiceEmailHtml({
      clientName: "Cliente", invoiceNumber: "ABO-2026-11-0001", isCreditNote: true,
      items: [{ description: "Abono parcial", quantity: 1, unitPrice: -82.5, total: -82.5 }],
      subtotal: -70, taxRate: "21", taxAmount: -12.5, total: -82.5, pdfUrl: "https://empresa.example/api/invoices/preview?n=ABO", attached: false,
      rectifies: { invoiceNumber: "FAC-2026-0003", issuedAt: new Date("2026-10-20T10:00:00Z") }, reason: "Devolución parcial",
      taxBreakdown: [{ rate: 21, base: -50, amount: -10.5 }, { rate: 10, base: -20, amount: -2 }],
    });
    expect(html).toContain("Factura rectificativa");
    expect(html).toContain("Rectifica la factura <strong>FAC-2026-0003</strong> de fecha 20/10/2026. Motivo: Devolución parcial.");
    expect(html).toContain("Base IVA 21&nbsp;% · cuota");
    expect(html).toContain("Base IVA 10&nbsp;% · cuota");
    expect(html).toContain("desde el enlace de abajo");
    expect(html).not.toContain("adjunta a este correo");
    expect(html).not.toMatch(/factura de abono/i);
  });
});
