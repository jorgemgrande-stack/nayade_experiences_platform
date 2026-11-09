/**
 * Regresión del Core SIN la contabilidad general (opt-in, REGISTRY_TEST_DATABASE_URL): una empresa sin la capacidad
 * accounting-general usa Gastos, Gestoría y la caja del TPV exactamente como en `integration/elephant-source`.
 *  - Gastos: el desglose que guarda `financial.expenses.create` (con retención y sin tipo de IVA), el Modelo 111, el 303
 *    y el CSV de gastos para la gestoría.
 *  - TPV: venta en efectivo, salidas (gasto y traspaso) y entradas (con y sin tipo), el gasto que crea la retirada y el
 *    cierre de caja.
 * Los valores esperados son los de las reglas del Core sin cambios. La prueba no depende de las tablas de la
 * contabilidad (acc_*): pasa igual con y sin la migración 0060, en esta rama y en integration/elephant-source.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, isLicenseDenied, type EssentialApp, type Res } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const today = () => new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date());
const quarterKey = () => `${today().slice(0, 4)}-T${Math.floor((Number(today().slice(5, 7)) - 1) / 3) + 1}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!URL_)("Core sin contabilidad general: Gastos, Gestoría y caja del TPV como siempre", () => {
  let ess: EssentialApp;
  let adA = "";
  let agA = "";
  let catId = 0;
  let ccId = 0;
  const ok = (r: Res, what: string) => {
    if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status} ${r.text.slice(0, 500)}`);
    return data(r);
  };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "coresinlic");
    adA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    await ess.markPaid("a");
    await ess.setCapability("a", "tax-filings", "active"); // Gestoría e impuestos (no la contabilidad general)
    await ess.sql("a", "INSERT INTO expense_categories (name) VALUES ('Salidas de caja')");
    await ess.sql("a", "INSERT INTO cost_centers (name) VALUES ('General')");
    catId = (await ess.sql("a", "SELECT id FROM expense_categories WHERE name = 'Salidas de caja'"))[0].id;
    ccId = (await ess.sql("a", "SELECT id FROM cost_centers WHERE name = 'General'"))[0].id;
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("la empresa no tiene la contabilidad general", async () => {
    expect(isLicenseDenied(await ess.q("a", "accountingGeneral.overview", undefined, adA), "accounting-general")).toBe(true);
  });

  it("Gastos: el desglose guardado de un gasto con retención y de uno sin tipo de IVA (21 % por defecto), como siempre", async () => {
    const base = { date: today(), categoryId: catId, costCenterId: ccId, paymentMethod: "transfer" };
    ok(await ess.m("a", "financial.expenses.create", { ...base, concept: "Asesoría con retención", amount: "121.00", taxRate: "21", retentionPercent: "15", invoiceType: "ordinaria", supplierName: "Gestoría QA" }, adA), "gasto con retención");
    ok(await ess.m("a", "financial.expenses.create", { ...base, concept: "Material sin desglose", amount: "100.00" }, adA), "gasto sin tipo");
    const rows = await ess.sql("a", "SELECT concept, taxRate, taxBase, taxAmount, retentionAmount, fiscalReviewStatus FROM expenses ORDER BY id");
    expect(rows.map((r: any) => [r.concept, Number(r.taxRate), Number(r.taxBase), Number(r.taxAmount), r.retentionAmount == null ? null : Number(r.retentionAmount), r.fiscalReviewStatus])).toEqual([
      ["Asesoría con retención", 21, 100, 21, 15, "revisado"],
      ["Material sin desglose", 21, 82.64, 17.36, null, "revisado"],
    ]);
  });

  it("Modelo 111 y 303 del trimestre: los mismos importes", async () => {
    const m111 = ok(await ess.q("a", "gestoria.labor.preview111", { periodKey: quarterKey() }, adA), "111");
    expect([m111.professionalBase, m111.professionalRetention, m111.professionalCount]).toEqual([100, 15, 1]);
    const m303 = ok(await ess.q("a", "gestoria.iva.preview303", { periodKey: quarterKey() }, adA), "303");
    expect([m303.inputBase, m303.inputAmount]).toEqual([182.64, 38.36]);
  });

  it("CSV de gastos para la gestoría: las mismas columnas fiscales", async () => {
    const r = ok(await ess.q("a", "gestoria.expenses.exportCsv", { year: Number(today().slice(0, 4)) }, adA), "CSV");
    const lines = Buffer.from(r.contentBase64, "base64").toString("utf8").split("\r\n").map((l) => l.split(";").map((c) => c.replace(/^"|"$/g, "")));
    const header = lines[0].map((h) => h.replace(/^﻿/, ""));
    const col = (name: string) => header.indexOf(name);
    const row = (concept: string) => lines.find((l) => l.includes(concept))!;
    const pick = (l: string[]) => ["Importe total (€)", "Base imponible (€)", "Tipo IVA (%)", "Cuota IVA (€)", "% Retención IRPF", "Retención (€)"].map((h) => (col(h) >= 0 ? l[col(h)] : `sin columna ${h}`));
    expect(pick(row("Asesoría con retención"))).toEqual(["121,00", "100,00", "21.00", "21,00", "15.00", "15,00"]);
    expect(pick(row("Material sin desglose"))).toEqual(["100,00", "82,64", "21.00", "17,36", "", ""]);
  });

  it("caja del TPV: venta, salidas, entradas, el gasto de la retirada y el cierre, como siempre", async () => {
    ok(await ess.m("a", "products.createCategory", { slug: "general", name: "General" }, adA), "categoría");
    ok(await ess.m("a", "products.createLocation", { slug: "local", name: "Local" }, adA), "lugar");
    const [c] = await ess.sql("a", "SELECT id FROM categories LIMIT 1");
    const [l] = await ess.sql("a", "SELECT id FROM locations LIMIT 1");
    ok(await ess.m("a", "products.create", { slug: "escobillas", title: "Escobillas", categoryId: c.id, locationId: l.id, basePrice: "24.20", taxRate: "21", productType: "own" }, adA), "producto");
    const productId = (await ess.sql("a", "SELECT id FROM experiences WHERE slug = 'escobillas'"))[0].id;
    await ess.sql("a", "UPDATE experiences SET isPresentialSale = 1");
    const registerId = ok(await ess.m("a", "tpv.createRegister", { name: "Mostrador" }, adA), "caja").id;
    const sessionId = ok(await ess.m("a", "tpv.openSession", { registerId, openingAmount: 100 }, agA), "abrir caja").id;
    ok(await ess.m("a", "tpv.createSale", { sessionId, items: [{ productType: "experience", productId, productName: "Escobillas", quantity: 1, unitPrice: 24.2 }], payments: [{ method: "cash", amount: 24.2 }] }, agA), "venta");
    const move = async (input: Record<string, unknown>) => ok(await ess.m("a", "tpv.addCashMovement", { sessionId, ...input }, agA), "movimiento");
    await move({ type: "out", amount: 10, reason: "Compra de hielo", outKind: "gasto" });
    await move({ type: "out", amount: 7, reason: "Reembolso de gasolina" }); // sin tipo: gasto, como siempre
    await move({ type: "out", amount: 20, reason: "Cambio de caja", outKind: "traspaso" });
    await move({ type: "in", amount: 5, reason: "Fondo adicional" });
    // Las retiradas de tipo gasto (también la que no lo indica) crean su gasto en segundo plano; el traspaso, no
    let tpvExpenses: any[] = [];
    for (let i = 0; i < 40 && tpvExpenses.length < 2; i++) {
      await sleep(150);
      tpvExpenses = await ess.sql("a", "SELECT concept, amount, paymentMethod, status FROM expenses WHERE source = 'tpv' ORDER BY id");
    }
    await sleep(300);
    tpvExpenses = await ess.sql("a", "SELECT concept, amount, paymentMethod, status FROM expenses WHERE source = 'tpv' ORDER BY id");
    expect(tpvExpenses.map((e: any) => [e.concept, Number(e.amount), e.paymentMethod, e.status])).toEqual([
      ["Retirada de caja TPV — Compra de hielo", 10, "cash", "conciliado"],
      ["Retirada de caja TPV — Reembolso de gasolina", 7, "cash", "conciliado"],
    ]);
    const sum = ok(await ess.q("a", "tpv.getSessionSummary", { sessionId }, agA), "resumen de caja");
    expect(sum.totalCash).toBe(24.2);
    const closed = ok(await ess.m("a", "tpv.closeSession", { sessionId, countedCash: 92.2 }, agA), "cerrar caja");
    const s = closed;
    expect([Number(s.closingAmount), Number(s.cashDifference), Number(s.totalManualOut), Number(s.totalManualIn), Number(s.totalCash)]).toEqual([92.2, 0, 37, 5, 24.2]);
  });
});
