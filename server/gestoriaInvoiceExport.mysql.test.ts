/**
 * Exportar para la gestoría con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL). Dos
 * empresas sintéticas nuevas; ningún documento fiscal real.
 *  - El ZIP de cada empresa lleva solo sus facturas y abonos (PDF y libro), aunque los números coincidan.
 *  - Guarda de rol (informes contables: administración), de sesión y de licencia (bill-invoices).
 * El PDF se sustituye por el HTML del documento (no hay navegador en la CI): así se comprueba además que
 * cada PDF sale de la factura guardada de su empresa.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import JSZip from "jszip";
import { startEssentialApp, data, errCode, licenseMatrix, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";
import { madridDayKey } from "../shared/gestoriaExportPeriod";

vi.mock("./pdfGenerator", async (orig) => ({
  ...(await orig<typeof import("./pdfGenerator")>()),
  htmlToPdf: async (html: string) => Buffer.from(`%PDF-prueba\n${html}`, "utf8"),
}));

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const today = madridDayKey(new Date());
const MONTH = { kind: "month" as const, year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };

describe.skipIf(!URL_)("Exportar para la gestoría (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let admA: string;
  let admB: string;
  let agA: string;

  const lines = [
    { description: "Mantenimiento mensual", quantity: 2, unitPrice: 50, taxRate: 21 },
    { description: "Formación", quantity: 1, unitPrice: 50, taxRate: 10 },
  ];

  async function unzip(r: { status: number; text: string; json: any }) {
    expect(r.status, r.text.slice(0, 300)).toBe(200);
    const out = data(r);
    const zip = await JSZip.loadAsync(Buffer.from(out.contentBase64, "base64"));
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
    const csvName = names.find((n) => n.endsWith(".csv"))!;
    return { out, zip, names, csv: await zip.file(csvName)!.async("string") };
  }

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "gex");
    admA = await ess.login("a", "admin");
    admB = await ess.login("b", "admin");
    agA = await ess.login("a", "agente");
    const agB = await ess.login("b", "agente");

    const a1 = await ess.m("a", "crm.invoices.createDirect", { client: { name: "Cliente Alfa SL", nif: "B00000033", email: "alfa@cliente.example" }, lines }, agA);
    expect(a1.status, a1.text).toBe(200);
    const cn = await ess.m("a", "crm.invoices.createCreditNote", { invoiceId: data(a1).invoiceId, reason: "Descuento posterior", partialAmount: 55 }, agA);
    expect(cn.status, cn.text).toBe(200);
    const b1 = await ess.m("b", "crm.invoices.createDirect", { client: { name: "Cliente Beta SA", nif: "A00000044", email: "beta@cliente.example" }, lines: [lines[0]] }, agB);
    expect(b1.status, b1.text).toBe(200);
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("empresa A: sus facturas y abonos, con el libro cuadrado; nada de la empresa B", async () => {
    const { out, zip, names, csv } = await unzip(await ess.q("a", "crm.invoices.exportForGestoria", MONTH, admA));
    expect(out).toMatchObject({ invoices: 1, creditNotes: 1, missingPdfs: [] });
    const fac = names.filter((n) => n.startsWith("Facturas/"));
    const abo = names.filter((n) => n.startsWith("Abonos/"));
    expect(fac).toHaveLength(1);
    expect(abo).toHaveLength(1);
    expect(names).toContain("LEEME.txt");

    const facPdf = await zip.file(fac[0])!.async("string");
    expect(facPdf.startsWith("%PDF")).toBe(true);
    expect(facPdf).toContain("Cliente Alfa SL");
    expect(facPdf).toContain("Mantenimiento mensual");
    expect(facPdf).not.toContain("Cliente Beta SA");

    expect(csv).toContain("Cliente Alfa SL;B00000033");
    expect(csv).toContain("Base 21 %;Cuota IVA 21 %;Base 10 %;Cuota IVA 10 %");
    expect(csv).not.toContain("Cliente Beta SA");
    expect(csv).not.toContain("A00000044");
    const facNumber = fac[0].replace(/^Facturas\/|\.pdf$/g, "");
    // Factura 100+21 / 50+5; el abono de 55 € reparte el desglose y figura en negativo con su factura rectificada
    expect(csv).toMatch(new RegExp(`;Abono;${facNumber};Cliente Alfa SL;B00000033;`));
    const totals = csv.trimEnd().split("\r\n").at(-1)!.split(";");
    expect(totals[0]).toBe("TOTAL");
    expect(totals.at(-2)).toBe("121,00"); // 176 − 55
  });

  it("empresa B: solo lo suyo, aunque el número de factura coincida con el de A", async () => {
    const { out, zip, names, csv } = await unzip(await ess.q("b", "crm.invoices.exportForGestoria", MONTH, admB));
    expect(out).toMatchObject({ invoices: 1, creditNotes: 0 });
    expect(names.filter((n) => n.startsWith("Abonos/"))).toHaveLength(0);
    const fac = names.filter((n) => n.startsWith("Facturas/"));
    const pdf = await zip.file(fac[0])!.async("string");
    expect(pdf).toContain("Cliente Beta SA");
    expect(pdf).not.toContain("Cliente Alfa SL");
    expect(csv).toContain("Cliente Beta SA;A00000044");
    expect(csv).not.toContain("Alfa");
  });

  it("la sesión de una empresa no sirve en la otra", async () => {
    const r = await ess.q("b", "crm.invoices.exportForGestoria", MONTH, admA);
    expect(r.status).not.toBe(200);
    expect(data(r)).toBeUndefined();
  });

  it("guarda de rol y de sesión: el equipo comercial y quien no ha entrado no exportan", async () => {
    const ag = await ess.q("a", "crm.invoices.exportForGestoria", MONTH, agA);
    expect(errCode(ag)).toBe("FORBIDDEN");
    const anon = await ess.q("a", "crm.invoices.exportForGestoria", MONTH);
    expect(errCode(anon)).toBe("UNAUTHORIZED");
  });

  it("periodo no válido: error claro, sin fichero", async () => {
    const r = await ess.q("a", "crm.invoices.exportForGestoria", { kind: "range", from: "2026-10-15", to: "2026-10-01" }, admA);
    expect(errCode(r)).toBe("BAD_REQUEST");
  });

  it("licencia: en solo lectura se sigue exportando; sin facturación contratada, no", async () => {
    const lic = await licenseMatrix(ess, "bill-invoices", { query: () => ess.q("a", "crm.invoices.exportForGestoria", MONTH, admA) });
    expect(lic.readOnlyQuery?.status).toBe(200);
    expect(isLicenseDenied(lic.noneQuery, "bill-invoices")).toBe(true);
  });
});
