/**
 * Datos fiscales que corrige la empresa y factura rectificativa, con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL), dos empresas Essential sintéticas con entidad fiscal en el registro.
 *
 * G1 — La empresa corrige su razón social y su NIF en «Datos de la empresa»:
 *  - la factura nueva lleva los datos nuevos; la emitida antes (con copia y sin copia del emisor) tiene EXACTAMENTE el
 *    mismo HTML antes y después del cambio;
 *  - el aviso legal y la cabecera del ticket muestran los nuevos; la pantalla dice cuáles y desde cuándo;
 *  - NIF/CIF e IBAN se validan en el servidor; sin permiso de configuración no se cambian;
 *  - la otra empresa no se ve afectada.
 * G2 — El abono nuevo es una factura rectificativa: título, factura rectificada (número y fecha), motivo, base y cuota
 *  por tipo y total en negativo, mención legal, numeración ABO correlativa, PDF y forma de pago en el listado.
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:root@127.0.0.1:33531/registro_test \
 *     pnpm vitest run server/fiscalEmisorRectificativa.e2e.mysql.test.ts
 */
import fs from "node:fs";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startEssentialApp, data, type EssentialApp, type Res } from "./essentialApp.testkit";
import { madridMonth, madridYear } from "./utils/timezone";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 90_000 });
const ABO = `ABO-${madridYear()}-${String(madridMonth()).padStart(2, "0")}-`;
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "/usr/bin/chromium-browser", "/usr/bin/chromium", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"].some((p) => fs.existsSync(p));

describe.skipIf(!URL_)("datos del emisor y factura rectificativa (aplicación real)", () => {
  let ess: EssentialApp;
  let admA = "";
  let agA = "";
  let admB = "";
  let agB = "";
  // Documentos emitidos antes del cambio de datos y su HTML de entonces
  let antiguaSinCopia = "";
  let antiguaConCopia = "";
  const before: Record<string, string> = {};

  const ok = (r: Res, what: string) => {
    if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status} ${r.text.slice(0, 500)}`);
    return data(r);
  };
  const preview = async (co: "a" | "b", n: string, cookie: string) => {
    const r = await ess.call(co, "GET", `/api/invoices/preview?n=${encodeURIComponent(n)}`, { cookie });
    expect(r.status, n).toBe(200);
    return r.text;
  };
  const direct = async (co: "a" | "b", cookie: string, lines = [{ description: "Servicio general", quantity: 2, unitPrice: 50, taxRate: 21 }, { description: "Formación", quantity: 1, unitPrice: 50, taxRate: 10 }]) =>
    ok(await ess.m(co, "crm.invoices.createDirect", { client: { name: "Cliente Prueba", email: "cliente@prueba.example" }, lines }, cookie), "factura");
  const company = (o: Record<string, string> = {}) => ({ tradeName: "Talleres Prueba", legalName: "Talleres Prueba SL", taxId: "B12345674", address: "Calle Nueva 1", postalCode: "28001", city: "Madrid", province: "Madrid", country: "ES", currency: "EUR", timezone: "Europe/Madrid", ...o });

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "fiscalemisor");
    admA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    admB = await ess.login("b", "admin");
    agB = await ess.login("b", "agente");
    await ess.markPaid("a");
    await ess.markPaid("b");

    // Factura emitida antes de la copia del emisor (0020): sin copia y anterior a la fila congelada
    antiguaSinCopia = "FAC-ANTIGUA-0001";
    await ess.sql("a", "INSERT INTO invoices (invoiceNumber, clientName, clientEmail, itemsJson, subtotal, taxRate, taxAmount, total, status, issuedAt) VALUES (?, 'Cliente', 'cliente@prueba.example', ?, 100, 21, 21, 121, 'generada', '2026-10-15 10:00:00')", [antiguaSinCopia, JSON.stringify([{ description: "Servicio", quantity: 1, unitPrice: 100, total: 100, taxRate: 21 }])]);
    // Factura emitida por la aplicación con los datos del alta: lleva su copia
    antiguaConCopia = (await direct("a", agA)).invoiceNumber;
    before.sinCopia = await preview("a", antiguaSinCopia, agA);
    before.conCopia = await preview("a", antiguaConCopia, agA);
  }, 300_000);

  afterAll(async () => {
    await ess?.close();
  });

  it("la copia del emisor se guarda al emitir; las emitidas antes la dejan vacía", async () => {
    const [nueva] = await ess.sql("a", "SELECT issuerSnapshot FROM invoices WHERE invoiceNumber = ?", [antiguaConCopia]);
    const snap = typeof nueva.issuerSnapshot === "string" ? JSON.parse(nueva.issuerSnapshot) : nueva.issuerSnapshot;
    expect(snap).toMatchObject({ v: 1, name: "Empresa A Ejemplo SL", cif: "B00000011" });
    const [vieja] = await ess.sql("a", "SELECT issuerSnapshot FROM invoices WHERE invoiceNumber = ?", [antiguaSinCopia]);
    expect(vieja.issuerSnapshot).toBeNull();
    expect(before.sinCopia).toContain("Empresa A Ejemplo SL");
    expect(before.conCopia).toContain("CIF: B00000011");
  });

  it("NIF/CIF e IBAN se validan en el servidor; sin permiso de configuración no se cambian", async () => {
    expect((await ess.m("a", "setupWizard.saveCompany", company({ taxId: "B12345678" }), admA)).status).toBe(400);
    expect((await ess.m("a", "setupWizard.saveCompany", company(), agA)).status).toBe(403);
    await ess.sql("a", "INSERT IGNORE INTO system_settings (`key`, value, category, label) VALUES ('site_legal_iban', '', 'fiscal', 'IBAN')");
    const bad = await ess.m("a", "config.updateSystemSetting", { key: "brand_nif", value: "B12345678" }, admA);
    expect(bad.status).toBe(400);
    expect(bad.text).toMatch(/NIF|CIF/);
    expect((await ess.m("a", "config.updateSystemSetting", { key: "site_legal_iban", value: "ES00 1234" }, admA)).status).toBe(400);
    expect((await ess.m("a", "config.updateSystemSetting", { key: "site_legal_iban", value: "ES91 2100 0418 4502 0005 1332" }, agA)).status).toBe(403);
    // Nada ha cambiado
    const [nif] = await ess.sql("a", "SELECT value FROM system_settings WHERE `key` = 'brand_nif'");
    expect(nif?.value ?? "").not.toBe("B12345678");
  });

  it("cambio de datos: factura nueva con los nuevos; las emitidas antes, idénticas", async () => {
    expect((await ess.m("a", "setupWizard.saveCompany", company(), admA)).status).toBe(200);
    expect((await ess.m("a", "config.updateSystemSetting", { key: "site_legal_iban", value: "ES91 2100 0418 4502 0005 1332" }, admA)).status).toBe(200);

    const nueva = (await direct("a", agA)).invoiceNumber;
    const html = await preview("a", nueva, agA);
    expect(html).toContain("Talleres Prueba SL");
    expect(html).toContain("CIF: B12345674");
    expect(html).toContain("Calle Nueva 1, 28001 Madrid (Madrid)");
    expect(html).toContain("ES91 2100 0418 4502 0005 1332");
    expect(html).not.toMatch(/Empresa A Ejemplo SL|B00000011/);

    // Las emitidas antes no cambian ni un carácter (con copia del emisor y sin ella)
    expect(await preview("a", antiguaSinCopia, agA)).toBe(before.sinCopia);
    expect(await preview("a", antiguaConCopia, agA)).toBe(before.conCopia);
  });

  it("aviso legal, cabecera del ticket y pantalla «Datos de la empresa» con los nuevos datos", async () => {
    const legal = data(await ess.q("a", "public.getTenantPage", { slug: "aviso-legal" }));
    expect(legal.html).toContain("<li>Titular: Talleres Prueba SL</li>");
    expect(legal.html).toContain("<li>NIF: B12345674</li>");
    expect(legal.html).not.toContain("B00000011");
    const ticket = ok(await ess.q("a", "config.ticketHeader", undefined, agA), "ticket");
    expect(ticket).toMatchObject({ legalName: "Talleres Prueba SL", taxId: "B12345674" });
    const st = ok(await ess.q("a", "setupWizard.status", undefined, admA), "estado");
    expect(st.issuer).toMatchObject({ name: "Talleres Prueba SL", taxId: "B12345674", fromSignup: false });
    expect(Date.parse(st.issuer.since)).toBeGreaterThan(Date.now() - 10 * 60_000);
  });

  it("la otra empresa no se ve afectada", async () => {
    const st = ok(await ess.q("b", "setupWizard.status", undefined, admB), "estado B");
    expect(st.issuer).toMatchObject({ name: "Empresa B Ejemplo SL", taxId: "B00000022", fromSignup: true });
    const n = (await direct("b", agB)).invoiceNumber;
    const html = await preview("b", n, agB);
    expect(html).toContain("Empresa B Ejemplo SL");
    expect(html).not.toMatch(/Talleres Prueba|B12345674|Empresa A Ejemplo/);
    expect((await ess.call("b", "GET", `/api/invoices/preview?n=${encodeURIComponent(antiguaSinCopia)}`, { cookie: agB })).status).toBe(404);
  });

  describe("factura rectificativa", () => {
    let original: { invoiceId: number; invoiceNumber: string };
    let issuedDate = "";
    const numbers: string[] = [];

    beforeAll(async () => {
      // Colores de la marca de la empresa
      await ess.sql("a", "INSERT IGNORE INTO system_settings (`key`, value, category, label) VALUES ('theme_primary_color', '', 'marca', 'Color principal')");
      ok(await ess.m("a", "config.updateSystemSetting", { key: "theme_primary_color", value: "#0b5d3b" }, admA), "color");
      original = await direct("a", agA);
      // Forma de pago de la factura original «Otro» (para el listado)
      await ess.sql("a", "UPDATE invoices SET paymentMethod = 'otro' WHERE id = ?", [original.invoiceId]);
      const [r] = await ess.sql("a", "SELECT issuedAt FROM invoices WHERE id = ?", [original.invoiceId]);
      issuedDate = new Date(r.issuedAt).toLocaleDateString("es-ES");
    });

    it("parcial con IVA mixto: título, referencia, motivo, negativos por tipo, mención legal y colores de la marca", async () => {
      const done = ok(await ess.m("a", "crm.invoices.createCreditNote", { invoiceId: original.invoiceId, reason: "Devolución parcial", lines: [{ itemIndex: 0, quantity: 1 }, { itemIndex: 1, amount: 22 }] }, agA), "abono parcial");
      numbers.push(done.creditNoteNumber);
      const html = await preview("a", done.creditNoteNumber, agA);
      expect(html).toContain('<span class="doc-label">Factura rectificativa</span>');
      expect(html).toContain(done.creditNoteNumber);
      expect(html).toContain(`Rectifica la factura <strong>${original.invoiceNumber}</strong> de fecha ${issuedDate}.`);
      expect(html).toContain("Motivo de la rectificación: Devolución parcial");
      expect(html).toContain("Base imponible IVA 21%</td><td>−50,00 €");
      expect(html).toContain("IVA 21%</td><td>−10,50 €");
      expect(html).toContain("Base imponible IVA 10%</td><td>−20,00 €");
      expect(html).toContain("IVA 10%</td><td>−2,00 €");
      expect(html).toContain("<td>TOTAL</td><td>−82,50 €</td>");
      expect(html).toContain("Real Decreto 1619/2012");
      expect(html).toContain("Talleres Prueba SL");
      expect(html).toContain("background: #0b5d3b");
      expect(html).not.toMatch(/#1a3a6b|#f97316/);
      // La factura emitida antes de la copia del emisor sigue con su presentación de siempre
      expect(await preview("a", antiguaSinCopia, agA)).toBe(before.sinCopia);
      // Y la rectificativa ya emitida no cambia si la empresa cambia después su color
      ok(await ess.m("a", "config.updateSystemSetting", { key: "theme_primary_color", value: "#5b21b6" }, admA), "otro color");
      expect(await preview("a", done.creditNoteNumber, agA)).toBe(html);
    });

    it("total (lo pendiente): rectificativa por el resto y numeración ABO correlativa", async () => {
      const done = ok(await ess.m("a", "crm.invoices.createCreditNote", { invoiceId: original.invoiceId, reason: "Anulación del resto" }, agA), "abono del resto");
      numbers.push(done.creditNoteNumber);
      const html = await preview("a", done.creditNoteNumber, agA);
      expect(html).toContain("Factura rectificativa");
      expect(html).toContain("Motivo de la rectificación: Anulación del resto");
      expect(html).toContain("<td>TOTAL</td><td>−93,50 €</td>");
      const seq = numbers.map((n) => {
        expect(n.startsWith(ABO)).toBe(true);
        return Number(n.slice(ABO.length));
      });
      expect(seq[1]).toBe(seq[0] + 1);
    });

    it("listado: el abono muestra la forma de pago de la factura que rectifica", async () => {
      const list = ok(await ess.q("a", "crm.invoices.listAll", {}, agA), "listado");
      const abonos = list.items.filter((i: any) => numbers.includes(i.invoiceNumber));
      expect(abonos).toHaveLength(2);
      for (const a of abonos) {
        expect(a.paymentMethodShown).toBe("otro");
        expect(a.originalInvoiceNumber).toBe(original.invoiceNumber);
      }
    });

    it.skipIf(!CHROME)("PDF de la rectificativa", async () => {
      const { htmlToPdf } = await import("./pdfGenerator");
      const pdfParse = (await import("pdf-parse")).default as (b: Buffer) => Promise<{ text: string }>;
      const html = await preview("a", numbers[0], agA);
      const pdf = await htmlToPdf(html);
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
      const { text } = await pdfParse(pdf);
      expect(text).toContain("FACTURA RECTIFICATIVA");
      expect(text).toContain(original.invoiceNumber);
      expect(text).toContain("−82,50 €");
      expect(text).not.toMatch(/\d\.\d\d €/);
      expect(text).toMatch(/Real Decreto 1619\/2012/);
      const S = process.env.FISCAL_CAPTURAS_DIR;
      if (S) fs.writeFileSync(`${S}/rectificativa-${numbers[0]}.pdf`, pdf);
    });
  });
});
