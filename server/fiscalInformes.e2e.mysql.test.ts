/**
 * IVA repercutido de los informes, el Modelo 303, el Resumen, el libro de la gestoría y el Inicio con la
 * aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL). Dos empresas sintéticas nuevas; cuenta de
 * comercio FICTICIA (las notificaciones de pago se firman aquí) y ningún cobro real.
 *
 * Escenario mixto de la empresa A, todo hoy, con IVA del 21 %, 10 % y 0 %:
 *  - pedido de la tienda con dos artículos (24,20 € al 21 % + 2 × 11 € al 10 %) pagado con tarjeta;
 *  - presupuesto de 121 € al 21 % cobrado por enlace;
 *  - factura libre de 311 € (21 %, 10 % y 0 % exento) con un abono parcial de 31,10 €;
 *  - dos ventas de caja en efectivo con ticket (34,20 € al 21 % y 0 %; 11 € al 10 %);
 *  - una venta de caja con tarjeta (ticket + factura completa automática) y otra en efectivo cuyo ticket se canjea
 *    por factura: las dos cuentan una sola vez (la factura) y su ticket figura como sustituido.
 * Comprueba que Informes, 303, Resumen, libro CSV del ZIP e Inicio cuadran entre sí y que nada se duplica; la
 * empresa B (con su propio ticket) no ve nada de A ni A de B.
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:root@127.0.0.1:33541/registro_test \
 *     pnpm vitest run server/fiscalInformes.e2e.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";
import JSZip from "jszip";
import { startEssentialApp, data, type EssentialApp, type Res } from "./essentialApp.testkit";
import { madridDayKey } from "../shared/gestoriaExportPeriod";

// Sin navegador en la CI: el PDF de cada factura es su HTML
vi.mock("./pdfGenerator", async (orig) => ({
  ...(await orig<typeof import("./pdfGenerator")>()),
  htmlToPdf: async (html: string) => Buffer.from(`%PDF-prueba\n${html}`, "utf8"),
}));

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 90_000 });
const KEY_A = crypto.randomBytes(24).toString("base64");
const today = madridDayKey(new Date());
const quarterKey = `${today.slice(0, 4)}-T${Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1}`;

/** Notificación de la pasarela firmada como lo haría Redsys (3DES del pedido + HMAC-SHA256), en entorno de pruebas. */
function signed(key: string, d: Record<string, string>) {
  const params = Buffer.from(JSON.stringify(d)).toString("base64");
  const k = Buffer.from(key, "base64").subarray(0, 24);
  const padded = Buffer.alloc(Math.ceil(Buffer.byteLength(d.Ds_Order) / 8) * 8, 0);
  Buffer.from(d.Ds_Order).copy(padded);
  const c = crypto.createCipheriv("des-ede3-cbc", k, Buffer.alloc(8, 0));
  c.setAutoPadding(false);
  const derived = Buffer.concat([c.update(padded), c.final()]);
  const sig = crypto.createHmac("sha256", derived).update(params).digest("base64");
  return new URLSearchParams({ Ds_SignatureVersion: "HMAC_SHA256_V1", Ds_MerchantParameters: params, Ds_Signature: sig }).toString();
}

async function waitFor<T>(fn: () => Promise<T>, okFn: (v: T) => boolean, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!okFn(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 150));
    v = await fn();
  }
  return v;
}

const parseCsv = (csv: string) => csv.replace(/^﻿/, "").trimEnd().split("\r\n").map((l) => l.split(";"));
const eur = (s: string) => Number(s.replace(",", "."));

describe.skipIf(!URL_)("IVA de informes, 303, resumen, libro e Inicio cuadran y no duplican (aplicación real)", () => {
  let ess: EssentialApp;
  let admA = "";
  let agA = "";
  let admB = "";
  const ids = { p21: 0, p10: 0, p0: 0, register: 0 };

  const ok = (r: Res, what: string) => {
    if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status} ${r.text.slice(0, 500)}`);
    return data(r);
  };
  const notify = async (order: string, amount: number) => {
    const r = await ess.call("a", "POST", "/api/redsys/notification", {
      raw: signed(KEY_A, { Ds_Order: order, Ds_Response: "0000", Ds_Amount: String(amount), Ds_AuthorisationCode: "123456" }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(r.text).toBe("OK");
  };
  const line = (productId: number, productName: string, unitPrice: number, quantity = 1) => ({ productType: "experience", productId, productName, quantity, unitPrice });

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "fiscal");
    admA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    admB = await ess.login("b", "admin");
    const agB = await ess.login("b", "agente");
    await ess.markPaid("a");
    ok(await ess.m("a", "products.createCategory", { slug: "general", name: "General" }, admA), "categoría");
    ok(await ess.m("a", "products.createLocation", { slug: "local", name: "Local" }, admA), "lugar");
    const [c] = await ess.sql("a", "SELECT id FROM categories LIMIT 1");
    const [l] = await ess.sql("a", "SELECT id FROM locations LIMIT 1");
    await ess.m("a", "products.create", { slug: "escobillas", title: "Escobillas", categoryId: c.id, locationId: l.id, basePrice: "24.20", taxRate: "21", productType: "own" }, admA).then((r) => ok(r, "p21"));
    await ess.m("a", "products.create", { slug: "ambientador", title: "Ambientador", categoryId: c.id, locationId: l.id, basePrice: "11.00", taxRate: "10", productType: "own" }, admA).then((r) => ok(r, "p10"));
    await ess.m("a", "products.create", { slug: "curso-reglado", title: "Curso reglado", categoryId: c.id, locationId: l.id, basePrice: "10.00", taxRate: "0", productType: "own" }, admA).then((r) => ok(r, "p0"));
    for (const r of await ess.sql("a", "SELECT id, slug FROM experiences")) {
      if (r.slug === "escobillas") ids.p21 = r.id;
      if (r.slug === "ambientador") ids.p10 = r.id;
      if (r.slug === "curso-reglado") ids.p0 = r.id;
    }
    await ess.sql("a", "UPDATE experiences SET isPresentialSale = 1");
    ids.register = ok(await ess.m("a", "tpv.createRegister", { name: "Mostrador" }, admA), "caja").id;
    ok(await ess.m("a", "integrations.save", { provider: "redsys", values: { environment: "test", merchantCode: "999008881", merchantTerminal: "1", merchantKey: KEY_A } }, admA), "pasarela");

    // 1) Pedido de la tienda con dos artículos: 24,20 € (21 %) + 2 × 11 € (10 %) = 46,20 €
    const cart = ok(await ess.m("a", "reservations.cartCheckout", {
      customerName: "Lucía Martín", customerEmail: "lucia@comprador-a.example", origin: `https://${ess.host("a")}`,
      items: [{ productId: ids.p21, bookingDate: "", people: 1 }, { productId: ids.p10, bookingDate: "", people: 2 }],
    }), "pedido web");
    expect(cart.totalAmountCents).toBe(4620);
    await notify(cart.merchantOrder, 4620);
    await waitFor(() => ess.sql("a", "SELECT status FROM invoices"), (x) => x.length === 1 && x[0].status === "cobrada");

    // 2) Presupuesto de 121 € al 21 % cobrado por enlace
    ok(await ess.m("a", "crm.clients.create", { name: "Transportes Ruiz", email: "ruiz@cliente-a.example", company: "Transportes Ruiz SL", nif: "B12345674", address: "Calle Mayor 1" }, agA), "cliente");
    const q = ok(await ess.m("a", "crm.quotes.createDirect", { clientName: "Transportes Ruiz", clientEmail: "ruiz@cliente-a.example", title: "Cambio de escobillas flota", items: [{ description: "Servicio", quantity: 1, unitPrice: 121, total: 121, taxRate: 21 }], subtotal: 0, discount: 0, total: 121, sendNow: false }, agA), "presupuesto");
    const sent = ok(await ess.m("a", "crm.quotes.send", { id: Number(q.quoteId), origin: `https://${ess.host("a")}` }, agA), "envío");
    const token = String(sent.token ?? String(sent.acceptUrl).split("/").pop());
    const pay = ok(await ess.m("a", "crm.quotes.payWithToken", { token, origin: `https://${ess.host("a")}` }), "pagar");
    const params = JSON.parse(Buffer.from(pay.redsysForm?.Ds_MerchantParameters ?? pay.redsysForm?.params?.Ds_MerchantParameters, "base64").toString());
    await notify(String(params.DS_MERCHANT_ORDER ?? params.Ds_Merchant_Order), Number(params.DS_MERCHANT_AMOUNT ?? params.Ds_Merchant_Amount));
    await waitFor(() => ess.sql("a", "SELECT id FROM invoices WHERE quoteId = ? AND invoiceType = 'factura'", [Number(q.quoteId)]), (x) => x.length === 1);

    // 3) Factura libre de 311 € con IVA incluido (21 %, 10 % y 0 % exento) y abono parcial de 31,10 €
    const free = ok(await ess.m("a", "crm.invoices.createDirect", {
      client: { name: "Transportes Ruiz SL", nif: "B12345674" },
      pricesIncludeTax: true,
      lines: [
        { description: "Revisión", quantity: 1, unitPrice: 121, taxRate: 21 },
        { description: "Material", quantity: 2, unitPrice: 55, taxRate: 10 },
        { description: "Curso reglado", quantity: 1, unitPrice: 80, taxRate: 0, exemptionReason: "Operación exenta de IVA (art. 20 de la Ley 37/1992 del IVA)" },
      ],
    }, agA), "factura libre");
    ok(await ess.m("a", "crm.invoices.createCreditNote", { invoiceId: free.invoiceId, reason: "Descuento posterior", partialAmount: 31.1 }, agA), "abono parcial");

    // 4) Caja: dos tickets en efectivo, uno con tarjeta (factura automática) y uno canjeado por factura
    const sid = ok(await ess.m("a", "tpv.openSession", { registerId: ids.register, openingAmount: 0 }, agA), "abrir caja").id;
    const sale = async (items: unknown[], method: "cash" | "card", amount: number) =>
      ok(await ess.m("a", "tpv.createSale", { sessionId: sid, items, payments: [{ method, amount }] }, agA), `venta ${amount}`).sale;
    await sale([line(ids.p21, "Escobillas", 24.2), line(ids.p0, "Curso reglado", 10)], "cash", 34.2);
    await sale([line(ids.p10, "Ambientador", 11)], "cash", 11);
    const cardSale = await sale([line(ids.p21, "Escobillas", 24.2)], "card", 24.2);
    const swapped = await sale([line(ids.p21, "Escobillas", 24.2)], "cash", 24.2);
    ok(await ess.m("a", "tpv.closeSession", { sessionId: sid, countedCash: 69.4 }, agA), "cerrar caja");
    expect((await ess.sql("a", "SELECT invoiceId FROM tpv_sales WHERE id = ?", [cardSale.id]))[0].invoiceId).toBeGreaterThan(0);
    ok(await ess.m("a", "crm.reservations.generateInvoice", { reservationId: swapped.reservationId, clientName: "Cliente canje SL", clientNif: "B12345674", clientAddress: "Calle Mayor 4", clientPostalCode: "28901", clientCity: "Getafe" }, agA), "canje del ticket por factura");

    // Empresa B: un ticket propio de 12,10 € (no debe aparecer en A)
    ok(await ess.m("b", "products.createCategory", { slug: "general", name: "General" }, admB), "categoría B");
    ok(await ess.m("b", "products.createLocation", { slug: "local", name: "Local" }, admB), "lugar B");
    const [cb] = await ess.sql("b", "SELECT id FROM categories LIMIT 1");
    const [lb] = await ess.sql("b", "SELECT id FROM locations LIMIT 1");
    ok(await ess.m("b", "products.create", { slug: "pieza", title: "Pieza", categoryId: cb.id, locationId: lb.id, basePrice: "12.10", taxRate: "21", productType: "own" }, admB), "producto B");
    const pB = (await ess.sql("b", "SELECT id FROM experiences"))[0].id;
    await ess.sql("b", "UPDATE experiences SET isPresentialSale = 1");
    const regB = ok(await ess.m("b", "tpv.createRegister", { name: "Caja B" }, admB), "caja B").id;
    const sidB = ok(await ess.m("b", "tpv.openSession", { registerId: regB, openingAmount: 0 }, agB), "abrir caja B").id;
    ok(await ess.m("b", "tpv.createSale", { sessionId: sidB, items: [line(pB, "Pieza", 12.1)], payments: [{ method: "cash", amount: 12.1 }] }, agB), "venta B");
  }, 400_000);

  afterAll(async () => {
    await ess?.close();
  });

  const EXPECTED_BY_RATE = [
    { rate: 21, base: 270, amount: 56.7 },
    { rate: 10, base: 120, amount: 12 },
    { rate: 0, base: 82, amount: 0 },
  ];

  it("los documentos emitidos son los esperados (ningún documento cambia)", async () => {
    const rows = await ess.sql("a", "SELECT invoiceNumber, invoiceType, status, total FROM invoices ORDER BY id");
    expect(rows.map((r) => [r.invoiceType, Number(r.total)])).toEqual([
      ["factura", 46.2], ["factura", 121], ["factura", 311], ["abono", -31.1], ["factura", 24.2], ["factura", 24.2],
    ]);
    const tickets = await ess.sql("a", "SELECT ticketNumber, total, invoiceId FROM tpv_sales ORDER BY id");
    expect(tickets.map((t) => Number(t.total))).toEqual([34.2, 11, 24.2, 24.2]);
    expect(tickets.map((t) => t.invoiceId != null)).toEqual([false, false, true, true]);
  });

  it("Contabilidad › Informes: IVA y base de los documentos, por tipo, sin duplicar", async () => {
    const rep = ok(await ess.q("a", "accounting.getReports", { from: today, to: today }, admA), "informes");
    expect(rep.fiscal.byRate.map(({ rate, base, amount }: any) => ({ rate, base, amount }))).toEqual(EXPECTED_BY_RATE);
    expect(rep.fiscal).toMatchObject({ base: 472, tax: 68.7, total: 540.7, invoices: 5, creditNotes: 1, tickets: 2, substitutedTickets: 2 });
    expect(rep.totals).toMatchObject({ taxBase: 472, taxAmount: 68.7 });
  });

  it("Modelo 303 del trimestre: el mismo IVA repercutido por tipo", async () => {
    await ess.setCapability("a", "tax-filings", "active");
    const m303 = ok(await ess.q("a", "gestoria.iva.preview303", { periodKey: quarterKey }, admA), "303");
    expect(m303.outputByRate).toEqual(EXPECTED_BY_RATE);
    expect([m303.outputBase, m303.outputAmount]).toEqual([472, 68.7]);
  });

  it("Contabilidad › Resumen: facturado = documentos fiscales; ventas por operación", async () => {
    const s = ok(await ess.q("a", "accounting.getSummary", {}, admA), "resumen");
    const cur = s.months[s.months.length - 1];
    expect(cur.invoiced).toBe(540.7);
    expect(s.totals).toMatchObject({ invoiced: 540.7, invoiceCount: 5, ticketCount: 2, sales: 260.8, salesCount: 6 });
  });

  it("libro de facturas del ZIP: tickets como facturas simplificadas, sustituidos sin importe, TOTAL = 303", async () => {
    const r = ok(await ess.q("a", "crm.invoices.exportForGestoria", { kind: "range", from: today, to: today }, admA), "exportación");
    expect([r.invoices, r.creditNotes, r.tickets]).toEqual([5, 1, 4]);
    const zip = await JSZip.loadAsync(Buffer.from(r.contentBase64, "base64"));
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
    expect(names.filter((n) => n.endsWith(".pdf"))).toHaveLength(6);
    const rows = parseCsv(await zip.file(names.find((n) => n.endsWith(".csv"))!)!.async("string"));
    const head = rows[0];
    const col = (name: string) => head.indexOf(name);
    const body = rows.slice(1, -1);
    const tickets = body.filter((x) => x[col("Tipo")] === "Factura simplificada / ticket");
    expect(tickets).toHaveLength(4);
    const substituted = tickets.filter((x) => x[col("Estado")].startsWith("Sustituido por "));
    expect(substituted).toHaveLength(2);
    for (const t of substituted) expect(eur(t[col("Total")])).toBe(0);
    const total = rows[rows.length - 1];
    expect(total[0]).toBe("TOTAL");
    expect(total[4]).toBe("10 documentos");
    for (const { rate, base, amount } of EXPECTED_BY_RATE) {
      expect(eur(total[col(`Base ${rate} %`)])).toBe(base);
      expect(eur(total[col(`Cuota IVA ${rate} %`)])).toBe(amount);
    }
    expect(eur(total[col("Cuota IVA total")])).toBe(68.7);
    expect(eur(total[col("Total")])).toBe(540.7);
    const readme = await zip.file("LEEME.txt")!.async("string");
    expect(readme).toContain("Tickets de caja (facturas simplificadas): 4 (2 sustituidos por su factura completa)");
  });

  it("Inicio: una venta por operación y lo pendiente después del abono parcial", async () => {
    const ind = ok(await ess.q("a", "coreHome.indicators", undefined, agA), "inicio");
    // Pedido web (2 líneas) + presupuesto + 4 ventas de caja = 6 operaciones
    expect(ind.sales.today).toEqual({ amount: 260.8, count: 6 });
    // Factura libre de 311 € menos el abono de 31,10 €; la del canje es de una venta cobrada
    expect(ind.unpaidInvoices).toEqual({ count: 1, amount: 279.9 });
  });

  it("aislamiento: B solo ve su ticket; A no ve el de B", async () => {
    const repB = ok(await ess.q("b", "accounting.getReports", { from: today, to: today }, admB), "informes B");
    expect(repB.fiscal).toMatchObject({ base: 10, tax: 2.1, total: 12.1, invoices: 0, tickets: 1 });
    const repA = ok(await ess.q("a", "accounting.getReports", { from: today, to: today }, admA), "informes A");
    expect(repA.fiscal.total).toBe(540.7);
    const exB = ok(await ess.q("b", "crm.invoices.exportForGestoria", { kind: "range", from: today, to: today }, admB), "exportación B");
    expect([exB.invoices, exB.creditNotes, exB.tickets]).toEqual([0, 0, 1]);
    const zipB = await JSZip.loadAsync(Buffer.from(exB.contentBase64, "base64"));
    const csvB = await zipB.file(Object.keys(zipB.files).find((n) => n.endsWith(".csv"))!)!.async("string");
    expect(csvB).not.toContain("FAC-");
    expect(parseCsv(csvB)).toHaveLength(3);
  });
});
