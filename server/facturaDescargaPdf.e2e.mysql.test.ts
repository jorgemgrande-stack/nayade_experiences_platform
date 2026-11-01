/**
 * «Descargar» del listado de facturas con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL),
 * dos empresas sintéticas nuevas; ningún documento fiscal real.
 *  - Factura y abono se descargan como PDF de verdad (el fichero empieza por %PDF), no la vista web.
 *  - Es el mismo documento del ZIP de la gestoría, de la empresa en curso; la sesión de otra empresa no sirve.
 *  - Guarda de sesión y de licencia (en solo lectura se sigue descargando).
 * Con Chrome instalado el PDF lo genera el navegador; sin él (CI) se sustituye por el HTML del documento con la
 * cabecera %PDF, para comprobar además que sale del documento guardado.
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:root@127.0.0.1:33621/registro_test \
 *     pnpm vitest run server/facturaDescargaPdf.e2e.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startEssentialApp, data, errCode, licenseMatrix, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";

const env = await vi.hoisted(async () => {
  const fs = await import("node:fs");
  const paths = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "/usr/bin/chromium-browser", "/usr/bin/chromium", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];
  return { chrome: process.env.TEST_PDF_STUB !== "1" && paths.some((p) => fs.existsSync(p)) };
});
vi.mock("./pdfGenerator", async (orig) => {
  const m = await orig<typeof import("./pdfGenerator")>();
  return env.chrome ? m : { ...m, htmlToPdf: async (html: string) => Buffer.from(`%PDF-prueba\n${html}`, "utf8") };
});

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 120_000 });

describe.skipIf(!URL_)("Descargar factura y abono en PDF (aplicación real)", () => {
  let ess: EssentialApp;
  let admA = "";
  let agA = "";
  let admB = "";
  let invoiceId = 0;
  let invoiceNumber = "";
  let creditId = 0;
  let creditNumber = "";

  const pdfOf = (r: { status: number; text: string }) => {
    expect(r.status, r.text.slice(0, 300)).toBe(200);
    const out = data(r);
    return { out, buf: Buffer.from(out.contentBase64, "base64") };
  };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "descargapdf");
    admA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    admB = await ess.login("b", "admin");
    const inv = await ess.m("a", "crm.invoices.createDirect", { client: { name: "Cliente Descarga SL", nif: "B00000033", email: "descarga@cliente.example" }, lines: [{ description: "Mantenimiento mensual", quantity: 1, unitPrice: 100, taxRate: 21 }] }, agA);
    expect(inv.status, inv.text).toBe(200);
    ({ invoiceId, invoiceNumber } = data(inv));
    const cn = await ess.m("a", "crm.invoices.createCreditNote", { invoiceId, reason: "Descuento posterior", partialAmount: 20 }, agA);
    expect(cn.status, cn.text).toBe(200);
    creditNumber = data(cn).creditNoteNumber;
    const [row] = await ess.sql("a", "SELECT id FROM invoices WHERE invoiceNumber = ?", [creditNumber]);
    creditId = Number(row.id);
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("factura: descarga un PDF de verdad con su número como nombre", async () => {
    const { out, buf } = pdfOf(await ess.q("a", "crm.invoices.downloadPdf", { invoiceId }, agA));
    expect(out.fileName).toBe(`${invoiceNumber}.pdf`);
    expect(out.mimeType).toBe("application/pdf");
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    if (!env.chrome) {
      const text = buf.toString("utf8");
      expect(text).toContain("Cliente Descarga SL");
      expect(text).toContain(invoiceNumber);
      expect(text).not.toContain("<span class=\"doc-label\">Factura rectificativa</span>");
    }
  });

  it("abono: descarga la factura rectificativa en PDF", async () => {
    const { out, buf } = pdfOf(await ess.q("a", "crm.invoices.downloadPdf", { invoiceId: creditId }, agA));
    expect(out.fileName).toBe(`${creditNumber}.pdf`);
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    if (!env.chrome) {
      const text = buf.toString("utf8");
      expect(text).toContain('<span class="doc-label">Factura rectificativa</span>');
      expect(text).toContain(`Rectifica la factura <strong>${invoiceNumber}</strong>`);
    }
  });

  it("la sesión de una empresa no descarga documentos de la otra; sin sesión, tampoco", async () => {
    const cross = await ess.q("b", "crm.invoices.downloadPdf", { invoiceId }, admA);
    expect(cross.status).not.toBe(200);
    expect(data(cross)).toBeUndefined();
    // En la empresa B ese identificador no existe
    expect(errCode(await ess.q("b", "crm.invoices.downloadPdf", { invoiceId: creditId + 1000 }, admB))).toBe("NOT_FOUND");
    expect(errCode(await ess.q("a", "crm.invoices.downloadPdf", { invoiceId }))).toBe("UNAUTHORIZED");
  });

  it("licencia: en solo lectura se sigue descargando; sin facturación contratada, no", async () => {
    const lic = await licenseMatrix(ess, "bill-invoices", { query: () => ess.q("a", "crm.invoices.downloadPdf", { invoiceId }, admA) });
    expect(lic.readOnlyQuery?.status).toBe(200);
    expect(isLicenseDenied(lic.noneQuery, "bill-invoices")).toBe(true);
  });
});
