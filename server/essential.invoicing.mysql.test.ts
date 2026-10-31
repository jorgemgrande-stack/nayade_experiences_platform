/**
 * Essential — Facturación fiable (bill-invoices, bill-series) con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL). Dos empresas sintéticas nuevas; ningún documento fiscal real.
 *  - Factura libre: numerada en la serie oficial, multi-IVA, aislada entre A y B, bloqueada sin licencia.
 *  - Abonos: copian el desglose por tipo de IVA; el parcial cuadra (por importe y por líneas).
 *  - Anular una factura emite un abono total y conserva su número.
 *  - El contador de facturas no retrocede por debajo de lo emitido; salta números ya ocupados.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, licenseMatrix, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";
import { madridYear } from "./utils/timezone";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const YEAR = madridYear();
const ABO_RE = /^ABO-\d{4}-\d{2}-\d{4}$/;
const r2 = (n: number) => Math.round(n * 100) / 100 + 0; // + 0: sin -0

describe.skipIf(!URL_)("Essential — facturación fiable (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let admA: string;
  let admB: string;
  let agA: string;
  let agB: string;
  let userA: string;

  const lines = [
    { description: "Mantenimiento mensual", quantity: 2, unitPrice: 50, taxRate: 21 },
    { description: "Formación", quantity: 1, unitPrice: 50, taxRate: 10 },
  ];

  async function row(id: number) {
    const [r] = await ess.sql("a", "SELECT * FROM invoices WHERE id = ?", [id]);
    const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
    return { ...r, taxBreakdown: parse(r.taxBreakdown) as { rate: number; base: number; amount: number }[] | null, itemsJson: parse(r.itemsJson) as { total: number; taxRate?: number }[] };
  }
  /** Líneas, desglose, base, cuota y total del documento cuadran al céntimo. */
  async function expectBalanced(id: number) {
    const inv = await row(id);
    const total = Number(inv.total);
    expect(r2(inv.itemsJson.reduce((s, i) => s + Number(i.total), 0))).toBe(total);
    expect(r2((inv.taxBreakdown ?? []).reduce((s, b) => s + b.base + b.amount, 0))).toBe(total);
    expect(r2(Number(inv.subtotal) + Number(inv.taxAmount))).toBe(total);
    return inv;
  }
  async function direct(co: "a" | "b", cookie: string, input: unknown = { client: { name: "Cliente Libre SL", nif: "B00000033", email: "libre@cliente.example" }, lines }) {
    return ess.m(co, "crm.invoices.createDirect", input, cookie);
  }

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "inv");
    admA = await ess.login("a", "admin");
    admB = await ess.login("b", "admin");
    agA = await ess.login("a", "agente");
    agB = await ess.login("b", "agente");
    userA = await ess.login("a", "user");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("factura libre: numerada en la serie oficial, multi-IVA, vista con el emisor de A; B independiente", async () => {
    const r = await direct("a", agA);
    expect(r.status).toBe(200);
    const out = data(r);
    expect(out.invoiceNumber).toBe(`FAC-${YEAR}-0001`);
    const inv = await expectBalanced(out.invoiceId);
    expect(inv.invoiceType).toBe("factura");
    expect(inv.status).toBe("generada");
    expect(inv.clientNif).toBe("B00000033");
    expect(Number(inv.subtotal)).toBe(150);
    expect(Number(inv.taxAmount)).toBe(26);
    expect(Number(inv.total)).toBe(176);
    expect(inv.taxBreakdown).toEqual([{ rate: 21, base: 100, amount: 21 }, { rate: 10, base: 50, amount: 5 }]);

    const prev = await ess.call("a", "GET", `/api/invoices/preview?n=${encodeURIComponent(out.invoiceNumber)}`, { cookie: agA });
    expect(prev.status).toBe(200);
    expect(prev.text).toContain("B00000011");
    expect(prev.text).toContain("Mantenimiento mensual");

    // Cliente guardado de la empresa
    await ess.sql("a", "INSERT INTO clients (source, name, email, nif, company) VALUES ('manual', 'Ana Pérez', 'ana@cliente.example', '12345678Z', 'Pérez Consultores SL')");
    const [c] = await ess.sql("a", "SELECT id FROM clients WHERE email = 'ana@cliente.example'");
    const r2_ = await direct("a", agA, { clientId: c.id, lines: [{ description: "Asesoría", quantity: 1, unitPrice: 200, taxRate: 21 }] });
    expect(data(r2_).invoiceNumber).toBe(`FAC-${YEAR}-0002`);
    expect((await row(data(r2_).invoiceId)).clientName).toBe("Pérez Consultores SL");

    // B: su propia serie y sin ver nada de A
    expect(data(await ess.q("b", "crm.invoices.listAll", {}, agB)).total).toBe(0);
    expect(errCode(await ess.q("b", "crm.invoices.get", { id: out.invoiceId }, agB))).toBe("NOT_FOUND");
    expect(errCode(await direct("b", agB, { clientId: c.id, lines }))).toBe("NOT_FOUND");
    const rb = await direct("b", agB);
    expect(data(rb).invoiceNumber).toBe(`FAC-${YEAR}-0001`);
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM invoices"))[0].n).toBe(1);
  });

  it("factura libre: validación, rol y licencia", async () => {
    expect(errCode(await direct("a", agA, { lines }))).toBe("BAD_REQUEST");
    expect(errCode(await direct("a", agA, { client: { name: "X" }, lines: [] }))).toBe("BAD_REQUEST");
    expect(errCode(await direct("a", agA, { client: { name: "X" }, lines: [{ description: "Y", quantity: 1, unitPrice: 10, taxRate: 7 }] }))).toBe("BAD_REQUEST");
    expect(errCode(await direct("a", agA, { client: { name: "X", email: "no-es-correo" }, lines }))).toBe("BAD_REQUEST");
    expect(errCode(await direct("a", agA, { client: { name: "X" }, lines: [{ description: "Gratis", quantity: 1, unitPrice: 0, taxRate: 21 }] }))).toBe("BAD_REQUEST");
    expect(errCode(await direct("a", userA))).toBe("FORBIDDEN");
    const before = (await ess.sql("a", "SELECT COUNT(*) AS n FROM invoices"))[0].n;
    const lic = await licenseMatrix(ess, "bill-invoices", { mutation: () => direct("a", agA) });
    expect(isLicenseDenied(lic.readOnlyMutation, "bill-invoices")).toBe(true);
    expect(isLicenseDenied(lic.noneMutation, "bill-invoices")).toBe(true);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM invoices"))[0].n).toBe(before);
  });

  it("abono parcial multi-IVA por importe y por líneas: desglose prorrateado y documento cuadrado", async () => {
    const inv = data(await direct("a", agA));
    const cn = await ess.m("a", "crm.invoices.createCreditNote", { invoiceId: inv.invoiceId, reason: "Descuento posterior", partialAmount: 50 }, agA);
    expect(cn.status).toBe(200);
    const abono = await expectBalanced(data(cn).creditNoteId);
    expect(Number(abono.total)).toBe(-50);
    expect(abono.creditNoteForId).toBe(inv.invoiceId);
    expect(abono.taxBreakdown!.map((b) => b.rate)).toEqual([21, 10]);
    expect(abono.taxBreakdown!.every((b) => b.base < 0 && b.amount < 0)).toBe(true);
    expect((await row(inv.invoiceId)).status).toBe("generada");

    const byLines = await ess.m("a", "crm.invoices.createCreditNote", { invoiceId: inv.invoiceId, reason: "Una unidad devuelta", lines: [{ itemIndex: 0, quantity: 1 }] }, agA);
    expect(byLines.status).toBe(200);
    const ab2 = await expectBalanced(data(byLines).creditNoteId);
    expect(Number(ab2.total)).toBe(-60.5);
    expect(ab2.taxBreakdown).toEqual([{ rate: 21, base: -50, amount: -10.5 }]);
    expect(errCode(await ess.m("a", "crm.invoices.createCreditNote", { invoiceId: inv.invoiceId, reason: "x", lines: [{ itemIndex: 0, quantity: 5 }] }, agA))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "crm.invoices.createCreditNote", { invoiceId: inv.invoiceId, reason: "x", partialAmount: 1, lines: [{ itemIndex: 1 }] }, agA))).toBe("BAD_REQUEST");

    // El resto cierra la factura: factura + abonos suman cero en cada tipo de IVA
    const rest = await ess.m("a", "crm.invoices.createCreditNote", { invoiceId: inv.invoiceId, reason: "Resto" }, agA);
    expect(rest.status).toBe(200);
    await expectBalanced(data(rest).creditNoteId);
    const all = await ess.sql("a", "SELECT taxBreakdown, total FROM invoices WHERE id = ? OR creditNoteForId = ?", [inv.invoiceId, inv.invoiceId]);
    for (const rate of [21, 10]) {
      const sum = all.reduce((s, r) => {
        const bd = (typeof r.taxBreakdown === "string" ? JSON.parse(r.taxBreakdown) : r.taxBreakdown) as { rate: number; base: number; amount: number }[];
        const b = bd.find((x) => x.rate === rate);
        return { base: s.base + (b?.base ?? 0), amount: s.amount + (b?.amount ?? 0) };
      }, { base: 0, amount: 0 });
      expect(r2(sum.base)).toBe(0);
      expect(r2(sum.amount)).toBe(0);
    }
    expect(r2(all.reduce((s, r) => s + Number(r.total), 0))).toBe(0);
    expect((await row(inv.invoiceId)).status).toBe("abonada");
  });

  it("anular una factura emitida emite un abono total y conserva su número", async () => {
    const inv = data(await direct("a", agA));
    const before = await row(inv.invoiceId);
    const v = await ess.m("a", "crm.invoices.void", { invoiceId: inv.invoiceId, reason: "Emitida por error" }, agA);
    expect(v.status).toBe(200);
    expect(data(v).creditNoteNumber).toMatch(ABO_RE);
    const after = await row(inv.invoiceId);
    expect(after.invoiceNumber).toBe(before.invoiceNumber);
    expect(after.total).toBe(before.total);
    expect(after.status).toBe("abonada");
    const abono = await expectBalanced(data(v).creditNoteId);
    expect(Number(abono.total)).toBe(-176);
    expect(abono.creditNoteReason).toBe("Emitida por error");
    expect(abono.taxBreakdown).toEqual([{ rate: 21, base: -100, amount: -21 }, { rate: 10, base: -50, amount: -5 }]);
    // Trazabilidad
    const [log] = await ess.sql("a", "SELECT action, details FROM crm_activity_log WHERE entityType = 'invoice' AND entityId = ? AND action = 'invoice_voided'", [inv.invoiceId]);
    expect(JSON.stringify(log.details)).toContain(data(v).creditNoteNumber);
    // Ni se anula dos veces ni se anula un abono
    expect(errCode(await ess.m("a", "crm.invoices.void", { invoiceId: inv.invoiceId }, agA))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "crm.invoices.void", { invoiceId: data(v).creditNoteId }, agA))).toBe("BAD_REQUEST");
    // La siguiente factura sigue la serie sin huecos ni repeticiones
    const next = data(await direct("a", agA));
    expect(Number(next.invoiceNumber.slice(-4))).toBe(Number(inv.invoiceNumber.slice(-4)) + 1);
  });

  it("el contador de facturas no retrocede por debajo de lo emitido; las series no fiscales sí se ajustan", async () => {
    const [last] = await ess.sql("a", "SELECT MAX(CAST(SUBSTRING(invoiceNumber, ?) AS UNSIGNED)) AS n FROM invoices WHERE invoiceNumber LIKE ?", [`FAC-${YEAR}-`.length + 1, `FAC-${YEAR}-%`]);
    const n = Number(last.n);
    expect(n).toBeGreaterThan(1);
    const back = await ess.m("a", "documentNumbers.resetCounter", { documentType: "factura", year: YEAR, newValue: 0 }, admA);
    expect(errCode(back)).toBe("BAD_REQUEST");
    expect(back.json.error.json.message).toMatch(/último número emitido/);
    expect(errCode(await ess.m("a", "documentNumbers.resetCounter", { documentType: "factura", year: YEAR, newValue: n - 1 }, admA))).toBe("BAD_REQUEST");
    const [counter] = await ess.sql("a", "SELECT current_number FROM document_counters WHERE document_type = 'factura' AND `year` = ?", [YEAR]);
    expect(Number(counter.current_number)).toBe(n);
    // Igual o hacia delante sí
    expect((await ess.m("a", "documentNumbers.resetCounter", { documentType: "factura", year: YEAR, newValue: n }, admA)).status).toBe(200);
    // Aunque el registro de numeración se hubiera perdido, las facturas guardadas con el prefijo actual mandan
    await ess.sql("a", "DELETE FROM document_number_logs WHERE document_type = 'factura'");
    expect(errCode(await ess.m("a", "documentNumbers.resetCounter", { documentType: "factura", year: YEAR, newValue: 1 }, admA))).toBe("BAD_REQUEST");
    // Serie no fiscal: libre
    expect((await ess.m("a", "crm.quotes.createDirect", { clientName: "C", clientEmail: "c@cliente.example", title: "P", items: [{ description: "S", quantity: 1, unitPrice: 10, total: 10 }], subtotal: 10, total: 10 }, agA)).status).toBe(200);
    expect((await ess.m("a", "documentNumbers.resetCounter", { documentType: "presupuesto", year: YEAR, newValue: 0 }, admA)).status).toBe(200);
    // B no se ve afectada
    const [cb] = await ess.sql("b", "SELECT current_number FROM document_counters WHERE document_type = 'factura' AND `year` = ?", [YEAR]);
    expect(Number(cb.current_number)).toBe(1);
  });

  it("IVA repercutido del trimestre: una factura anulada con su abono suma cero (antes el abono sumaba)", async () => {
    // Empresa B: solo su factura libre del primer caso (176 €) más otra que se anula
    await ess.setCapability("b", "tax-filings", "active");
    const inv = data(await direct("b", agB));
    expect((await ess.m("b", "crm.invoices.void", { invoiceId: inv.invoiceId }, agB)).status).toBe(200);
    const m = Number(new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date()).slice(5, 7));
    const q = await ess.q("b", "gestoria.iva.preview303", { periodKey: `${YEAR}-T${Math.ceil(m / 3)}` }, admB);
    expect(q.status).toBe(200);
    const out = data(q);
    expect(out.outputByRate).toEqual([{ rate: 21, base: 100, amount: 21 }, { rate: 10, base: 50, amount: 5 }]);
    expect(out.outputAmount).toBe(26);
  });

  it("numeración: salta un número ya ocupado por una factura guardada fuera del contador", async () => {
    const [counter] = await ess.sql("a", "SELECT current_number FROM document_counters WHERE document_type = 'factura' AND `year` = ?", [YEAR]);
    const taken = `FAC-${YEAR}-${String(Number(counter.current_number) + 1).padStart(4, "0")}`;
    await ess.sql("a", "INSERT INTO invoices (invoiceNumber, clientName, clientEmail, itemsJson, subtotal, taxRate, taxAmount, total, status, invoiceType, isAutomatic, issuedAt, createdAt, updatedAt) VALUES (?, 'Importada', 'importada@cliente.example', '[]', '10.00', '21', '2.10', '12.10', 'generada', 'factura', 0, NOW(), NOW(), NOW())", [taken]);
    const r = await direct("a", agA);
    expect(r.status).toBe(200);
    expect(data(r).invoiceNumber).not.toBe(taken);
    expect(Number(data(r).invoiceNumber.slice(-4))).toBe(Number(taken.slice(-4)) + 1);
    const [dups] = [await ess.sql("a", "SELECT invoiceNumber FROM invoices GROUP BY invoiceNumber HAVING COUNT(*) > 1")];
    expect(dups).toHaveLength(0);
  });
});
