/**
 * Abonos parciales con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL), dos empresas
 * Essential sintéticas. Sobre una factura con IVA 21 % y 10 %:
 *  - la vista previa da exactamente lo que después se emite (y no consume numeración);
 *  - por líneas (unidades o importe), por importe y el resto: la suma de abonos nunca supera lo facturado,
 *    ni por línea, tampoco con dos abonos a la vez;
 *  - motivo obligatorio; numeración correlativa; la factura original no cambia (solo su estado al final);
 *  - otra empresa no ve la factura y un usuario sin permisos no emite abonos.
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:root@127.0.0.1:33342/registro_test \
 *     pnpm vitest run server/abonosParciales.e2e.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp, type Res } from "./essentialApp.testkit";
import { madridMonth, madridYear } from "./utils/timezone";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 60_000 });
const ABO = `ABO-${madridYear()}-${String(madridMonth()).padStart(2, "0")}-`;

describe.skipIf(!URL_)("abonos parciales (aplicación real)", () => {
  let ess: EssentialApp;
  let agA = "";
  let userA = "";
  let invoiceId = 0;
  let original: any;
  const numbers: string[] = [];

  const ok = (r: Res, what: string) => {
    if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status} ${r.text.slice(0, 500)}`);
    return data(r);
  };
  const preview = (input: Record<string, unknown> = {}) => ess.q("a", "crm.invoices.creditNotePreview", { invoiceId, ...input }, agA);
  const credit = (input: Record<string, unknown>) => ess.m("a", "crm.invoices.createCreditNote", { invoiceId, reason: "Devolución parcial", ...input }, agA);
  const row = async () => (await ess.sql("a", "SELECT invoiceNumber, total, subtotal, taxAmount, itemsJson, taxBreakdown, issuedAt, status FROM invoices WHERE id = ?", [invoiceId]))[0];
  const creditedSum = async () => Number((await ess.sql("a", "SELECT COALESCE(SUM(ABS(total)), 0) AS s FROM invoices WHERE creditNoteForId = ? AND invoiceType = 'abono'", [invoiceId]))[0].s);

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "abo");
    agA = await ess.login("a", "agente");
    userA = await ess.login("a", "user");
    await ess.markPaid("a");
    const r = ok(
      await ess.m("a", "crm.invoices.createDirect", { client: { name: "Cliente Abonos" }, lines: [{ description: "Servicio general", quantity: 2, unitPrice: 50, taxRate: 21 }, { description: "Formación", quantity: 1, unitPrice: 50, taxRate: 10 }] }, agA),
      "factura",
    );
    invoiceId = Number(r.invoiceId);
    expect(r.total).toBe(176);
    original = await row();
  }, 300_000);

  afterAll(async () => {
    await ess?.close();
  });

  it("vista previa por líneas = abono emitido, con IVA por tipo; no consume número", async () => {
    const sel = { lines: [{ itemIndex: 0, quantity: 1 }, { itemIndex: 1, amount: 22 }] };
    const pv = ok(await preview(sel), "vista previa");
    expect(pv.error).toBeNull();
    expect(pv.invoice).toMatchObject({ total: 176, credited: 0, remaining: 176 });
    expect(pv.lines.map((l: any) => [l.description, l.taxRate, l.remaining])).toEqual([["Servicio general", 21, 121], ["Formación", 10, 55]]);
    expect(pv.preview).toMatchObject({ subtotal: -70, taxAmount: -12.5, total: -82.5, closesInvoice: false, remainingAfter: 93.5 });
    expect(pv.preview.taxBreakdown).toEqual([{ rate: 21, base: -50, amount: -10.5 }, { rate: 10, base: -20, amount: -2 }]);
    expect(Number((await ess.sql("a", "SELECT COUNT(*) AS n FROM invoices WHERE invoiceType = 'abono'"))[0].n)).toBe(0);

    // Sin motivo no se emite
    expect((await credit({ ...sel, reason: "  " })).status).toBe(400);
    const done = ok(await credit(sel), "abono por líneas");
    numbers.push(done.creditNoteNumber);
    const [abono] = await ess.sql("a", "SELECT subtotal, taxAmount, total, taxBreakdown, creditNoteReason AS reason FROM invoices WHERE id = ?", [done.creditNoteId]);
    expect([Number(abono.subtotal), Number(abono.taxAmount), Number(abono.total), abono.reason]).toEqual([-70, -12.5, -82.5, "Devolución parcial"]);
    const bd = typeof abono.taxBreakdown === "string" ? JSON.parse(abono.taxBreakdown) : abono.taxBreakdown;
    expect(bd).toEqual(pv.preview.taxBreakdown);
    // La factura original no cambia: un abono parcial no la cierra
    expect(await row()).toEqual(original);
  });

  it("límite por línea: lo ya abonado de una línea cuenta para el siguiente abono", async () => {
    const pv = ok(await preview({ lines: [{ itemIndex: 0, quantity: 2 }] }), "vista previa de más");
    expect(pv.preview).toBeNull();
    expect(pv.error).toMatch(/solo quedan 60,50 €/);
    expect(pv.lines.map((l: any) => l.remaining)).toEqual([60.5, 33]);
    expect((await credit({ lines: [{ itemIndex: 0, quantity: 2 }] })).status).toBe(400);
    expect((await credit({ lines: [{ itemIndex: 1, amount: 33.01 }] })).status).toBe(400);
    expect(await creditedSum()).toBe(82.5);
  });

  it("límite total con dos abonos a la vez: solo uno cabe", async () => {
    const both = await Promise.all([credit({ partialAmount: 60 }), credit({ partialAmount: 60 })]);
    const passed = both.filter((r) => r.status === 200);
    expect(passed).toHaveLength(1);
    numbers.push(data(passed[0]).creditNoteNumber);
    expect(both.find((r) => r.status !== 200)!.text).toContain("supera lo pendiente de abonar");
    expect(await creditedSum()).toBe(142.5);
  });

  it("el resto cierra la factura; después ya no se puede abonar", async () => {
    // Por líneas tampoco se pasa de lo pendiente total (33,50 €), aunque a la línea le queden 33 €
    const pv = ok(await preview({ lines: [{ itemIndex: 1 }] }), "vista previa de la línea");
    expect(pv.preview.total).toBe(-33);
    numbers.push(ok(await credit({ lines: [{ itemIndex: 1 }] }), "línea").creditNoteNumber);
    expect((await credit({ partialAmount: 0.51 })).status).toBe(400);
    const rest = ok(await preview(), "vista previa del resto");
    expect(rest.preview).toMatchObject({ total: -0.5, closesInvoice: true });
    numbers.push(ok(await credit({}), "resto").creditNoteNumber);
    expect(await creditedSum()).toBe(176);
    expect((await row()).status).toBe("abonada");
    const { status: _s, ...unchanged } = await row();
    const { status: _o, ...before } = original;
    expect(unchanged).toEqual(before);
    expect((await credit({ partialAmount: 0.01 })).status).toBe(400);
    expect(ok(await preview(), "cerrada").error).toBe("Esta factura ya está abonada por completo");
  });

  it("numeración correlativa sin huecos ni duplicados", () => {
    expect(numbers).toHaveLength(4);
    const seq = numbers.map((n) => {
      expect(n.startsWith(ABO)).toBe(true);
      return Number(n.slice(ABO.length));
    });
    expect(seq).toEqual([seq[0], seq[0] + 1, seq[0] + 2, seq[0] + 3]);
  });

  it("otra empresa no ve la factura y un usuario sin permisos no abona", async () => {
    const agB = await ess.login("b", "agente");
    expect(errCode(await ess.q("b", "crm.invoices.creditNotePreview", { invoiceId }, agB))).toBe("NOT_FOUND");
    expect((await ess.q("a", "crm.invoices.creditNotePreview", { invoiceId }, userA)).status).toBe(403);
    expect((await ess.m("a", "crm.invoices.createCreditNote", { invoiceId, reason: "x" }, userA)).status).toBe(403);
  });
});
