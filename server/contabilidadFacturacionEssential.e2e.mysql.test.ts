/**
 * Contabilidad y facturación de una empresa Essential con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL). Empresas sintéticas nuevas; ningún cobro real.
 *  - Contabilidad › Resumen: vacío con guía, y con datos reales (ventas, cobros, facturas, gastos, categorías);
 *    lo que no está contratado no se consulta.
 *  - Facturas de presupuestos (pago por enlace, cuotas, confirmación de pago y de transferencia) con el NIF,
 *    el nombre fiscal y la dirección del cliente vinculado.
 *  - Revisión de facturación: una venta de caja con ticket no es una incidencia.
 *  - Caja con descuento global e IVA mixto: el descuento se reparte por tipo antes de desglosar.
 *  - Factura libre: precios con IVA incluido o sin IVA y motivo de exención obligatorio con IVA al 0 %.
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:root@127.0.0.1:33441/registro_test \
 *     pnpm vitest run server/contabilidadFacturacionEssential.e2e.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";
import { startEssentialApp, data, isLicenseDenied, type EssentialApp, type Res } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 60_000 });
const KEY_A = crypto.randomBytes(24).toString("base64");

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

const json = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
const r2 = (n: number) => Math.round(n * 100) / 100;

describe.skipIf(!URL_)("contabilidad y facturación Essential (aplicación real)", () => {
  let ess: EssentialApp;
  let admA = "";
  let agA = "";
  let productId = 0;
  let product10Id = 0;
  let registerId = 0;

  const ok = (r: Res, what: string) => {
    if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status} ${r.text.slice(0, 500)}`);
    return data(r);
  };
  const item = (o: Record<string, unknown> = {}) => ({ productType: "experience", productId, productName: "Asesoría fiscal", quantity: 1, unitPrice: 121, ...o });
  const openSession = async () => ok(await ess.m("a", "tpv.openSession", { registerId, openingAmount: 0 }, agA), "abrir caja").id as number;

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "contab");
    admA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    await ess.markPaid("a");
    ok(await ess.m("a", "products.createCategory", { slug: "asesoria", name: "Asesoría" }, admA), "categoría");
    ok(await ess.m("a", "products.createCategory", { slug: "formacion", name: "Formación" }, admA), "categoría 2");
    ok(await ess.m("a", "products.createLocation", { slug: "oficina", name: "Oficina" }, admA), "lugar");
    const [c] = await ess.sql("a", "SELECT id FROM categories WHERE slug = 'asesoria'");
    const [c2] = await ess.sql("a", "SELECT id FROM categories WHERE slug = 'formacion'");
    const [l] = await ess.sql("a", "SELECT id FROM locations LIMIT 1");
    ok(await ess.m("a", "products.create", { slug: "asesoria-fiscal", title: "Asesoría fiscal", categoryId: c.id, locationId: l.id, basePrice: "121.00", taxRate: "21" }, admA), "producto");
    ok(await ess.m("a", "products.create", { slug: "curso", title: "Curso", categoryId: c2.id, locationId: l.id, basePrice: "110.00", taxRate: "10" }, admA), "producto 10");
    productId = (await ess.sql("a", "SELECT id FROM experiences WHERE slug = 'asesoria-fiscal'"))[0].id;
    product10Id = (await ess.sql("a", "SELECT id FROM experiences WHERE slug = 'curso'"))[0].id;
    await ess.sql("a", "UPDATE experiences SET isPresentialSale = 1");
    registerId = ok(await ess.m("a", "tpv.createRegister", { name: "Mostrador" }, admA), "caja").id;
    ok(await ess.m("a", "integrations.save", { provider: "redsys", values: { environment: "test", merchantCode: "999008881", merchantTerminal: "1", merchantKey: KEY_A } }, admA), "pasarela");
  }, 300_000);

  afterAll(async () => {
    await ess?.close();
  });

  describe("Contabilidad › Resumen", () => {
    it("empresa vacía: sin datos (la pantalla guía) y sin consultar lo no contratado", async () => {
      const s = ok(await ess.q("a", "accounting.getSummary", { withQuotes: true }, admA), "resumen");
      expect(s.hasData).toBe(false);
      expect(s.months).toHaveLength(6);
      expect(s.categories).toEqual([]);
      expect(s.pendingQuotes).toBe(0);
      expect(ok(await ess.q("a", "accounting.getTransactions", { limit: 20, offset: 0 }, admA), "cobros")).toEqual([]);
      // Lo que la pantalla ya no pide en Essential: sin el módulo, el servidor lo rechaza
      expect(isLicenseDenied(await ess.q("a", "gestoria.executiveSummary", { year: 2026 }, admA), "tax-filings")).toBe(true);
      expect(isLicenseDenied(await ess.q("a", "bankMovements.getCashflowForecast", undefined, admA), "bank-import-pos")).toBe(true);
      expect(isLicenseDenied(await ess.q("a", "cardTerminalBatches.getReconciliationStats", undefined, admA), "bank-import-pos")).toBe(true);
    });

    it("con datos: ventas y cobros de caja, factura y gasto del mes, y ventas por la categoría real del producto", async () => {
      const sid = await openSession();
      // 121 € de asesoría + 110 € de curso, 23,10 € de descuento → 207,90 € en efectivo
      ok(await ess.m("a", "tpv.createSale", { sessionId: sid, discountAmount: 23.1, items: [item(), item({ productId: product10Id, productName: "Curso", quantity: 2, unitPrice: 55 })], payments: [{ method: "cash", amount: 207.9 }] }, agA), "venta");
      await ess.m("a", "tpv.closeSession", { sessionId: sid, countedCash: 207.9 }, agA);
      ok(await ess.m("a", "crm.invoices.createDirect", { client: { name: "Cliente factura" }, pricesIncludeTax: false, lines: [{ description: "Informe", quantity: 1, unitPrice: 100, taxRate: 21 }] }, agA), "factura libre");
      const today = new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date());
      const [cc] = await ess.sql("a", "SELECT id FROM cost_centers LIMIT 1").catch(() => [{ id: 1 }]);
      await ess.sql("a", "INSERT INTO expenses (date, concept, amount, categoryId, costCenterId) VALUES (?, 'Alquiler', 40, 1, ?)", [today, cc?.id ?? 1]);

      const s = ok(await ess.q("a", "accounting.getSummary", {}, admA), "resumen");
      expect(s.hasData).toBe(true);
      const cur = s.months[s.months.length - 1];
      expect(cur.sales).toBe(207.9);
      expect(cur.payments).toBe(207.9);
      expect(cur.invoiced).toBe(121);
      expect(cur.expenses).toBe(40);
      expect(s.hasExpenses).toBe(true);
      expect(s.totals).toMatchObject({ sales: 207.9, salesCount: 1, invoiced: 121, invoiceCount: 1 });
      // Ventas por categoría con el descuento del ticket repartido: 121 × 0,9 y 110 × 0,9
      expect(s.categories).toEqual([
        { name: "Asesoría", amount: 108.9, percent: 52.4 },
        { name: "Formación", amount: 99, percent: 47.6 },
      ]);
      expect(r2(s.categories.reduce((a: number, c: any) => a + c.amount, 0))).toBe(207.9);
      expect(s.pendingQuotes).toBeNull();
    });
  });

  describe("facturas de presupuestos con los datos fiscales del cliente", () => {
    let n = 0;
    /** Cliente con datos fiscales y un presupuesto suyo de 121 € al 21 %. */
    const quoteFor = async (extra: Record<string, unknown> = {}) => {
      n += 1;
      const k = n;
      const email = `fiscal${k}@cliente-a.example`;
      ok(await ess.m("a", "crm.clients.create", { name: `Contacto ${k}`, email, company: `Empresa Fiscal ${k} SL`, nif: "B12345674", address: `Calle Mayor ${k}` }, agA), "cliente");
      await ess.sql("a", "UPDATE clients SET postalCode = '28001', city = 'Madrid' WHERE email = ?", [email]);
      const r = ok(await ess.m("a", "crm.quotes.createDirect", { clientName: `Contacto ${k}`, clientEmail: email, title: `Presupuesto fiscal ${k}`, items: [{ description: "Servicio", quantity: 1, unitPrice: 121, total: 121, taxRate: 21 }], subtotal: 0, discount: 0, total: 121, sendNow: false, ...extra }, agA), "presupuesto");
      return { id: Number(r.quoteId), email, n: k };
    };
    const send = async (quoteId: number) => {
      const sent = ok(await ess.m("a", "crm.quotes.send", { id: quoteId, origin: `https://${ess.host("a")}` }, agA), "envío");
      return String(sent.token ?? String(sent.acceptUrl).split("/").pop());
    };
    const payOrder = async (token: string) => {
      const p = ok(await ess.m("a", "crm.quotes.payWithToken", { token, origin: `https://${ess.host("a")}` }), "pagar");
      const params = JSON.parse(Buffer.from(p.redsysForm?.Ds_MerchantParameters ?? p.redsysForm?.params?.Ds_MerchantParameters, "base64").toString());
      return { order: String(params.DS_MERCHANT_ORDER ?? params.Ds_Merchant_Order), amount: Number(params.DS_MERCHANT_AMOUNT ?? params.Ds_Merchant_Amount) };
    };
    const notify = async (order: string, amount: number) => {
      const r = await ess.call("a", "POST", "/api/redsys/notification", {
        raw: signed(KEY_A, { Ds_Order: order, Ds_Response: "0000", Ds_Amount: String(amount), Ds_AuthorisationCode: "123456" }),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      expect(r.text).toBe("OK");
    };
    const invoiceOf = async (quoteId: number) => {
      const rows = await waitFor(() => ess.sql("a", "SELECT invoiceNumber, clientName, clientNif, clientAddress, total FROM invoices WHERE quoteId = ? AND invoiceType = 'factura'", [quoteId]), (r) => r.length > 0);
      expect(rows).toHaveLength(1);
      return rows[0];
    };
    const expectFiscal = (inv: any, k: number) => {
      expect(inv.clientName).toBe(`Empresa Fiscal ${k} SL`);
      expect(inv.clientNif).toBe("B12345674");
      expect(inv.clientAddress).toBe(`Calle Mayor ${k}, 28001, Madrid`);
    };

    it("pago por enlace con tarjeta: la factura lleva NIF, nombre fiscal y dirección (también en el documento)", async () => {
      const q = await quoteFor();
      const p = await payOrder(await send(q.id));
      await notify(p.order, p.amount);
      const inv = await invoiceOf(q.id);
      expectFiscal(inv, q.n);
      const prev = await ess.call("a", "GET", `/api/invoices/preview?n=${encodeURIComponent(inv.invoiceNumber)}`, { cookie: agA });
      expect(prev.status).toBe(200);
      for (const t of ["B12345674", `Empresa Fiscal ${q.n} SL`, `Calle Mayor ${q.n}`]) expect(prev.text).toContain(t);
    });

    it("cuotas: la factura final lleva los datos fiscales del cliente", async () => {
      const q = await quoteFor();
      const today = new Date();
      const due = (m: number) => new Date(today.getFullYear(), today.getMonth() + m, 15).toISOString().slice(0, 10);
      const amounts = [6000, 6100];
      ok(await ess.m("a", "crm.paymentPlans.upsert", { quoteId: q.id, installments: amounts.map((amountCents, i) => ({ installmentNumber: i + 1, amountCents, dueDate: due(i), isRequiredForConfirmation: i === 0 })) }, agA), "plan");
      const token = await send(q.id);
      for (let i = 0; i < amounts.length; i++) {
        const p = await payOrder(token);
        await notify(p.order, p.amount);
        await waitFor(() => ess.sql("a", "SELECT COUNT(*) AS n FROM payment_installments WHERE quote_id = ? AND status = 'paid'", [q.id]), (r) => Number(r[0].n) >= i + 1);
      }
      expectFiscal(await invoiceOf(q.id), q.n);
    });

    it("confirmación manual de pago y de transferencia: con los datos fiscales; las facturas ya emitidas no cambian", async () => {
      const q1 = await quoteFor();
      ok(await ess.m("a", "crm.quotes.confirmPayment", { quoteId: q1.id, paymentMethod: "efectivo", paymentNote: "Pago en mano" }, agA), "confirmar pago");
      const inv1 = await invoiceOf(q1.id);
      expectFiscal(inv1, q1.n);
      const q2 = await quoteFor();
      await ess.sql("a", "UPDATE quotes SET transfer_proof_url = 'https://almacen.example/justificante.pdf' WHERE id = ?", [q2.id]);
      ok(await ess.m("a", "crm.quotes.confirmTransfer", { quoteId: q2.id }, agA), "confirmar transferencia");
      expectFiscal(await invoiceOf(q2.id), q2.n);
      // Cambiar después los datos del cliente no toca la factura emitida
      await ess.sql("a", "UPDATE clients SET nif = 'B76543214' WHERE email = ?", [q1.email]);
      expect((await invoiceOf(q1.id)).clientNif).toBe("B12345674");
    });
  });

  describe("revisión de facturación de los pedidos cobrados", () => {
    it("una venta de caja en efectivo con ticket no es una incidencia; un pedido cobrado sin factura ni ticket sí", async () => {
      const sid = await openSession();
      const sale = ok(await ess.m("a", "tpv.createSale", { sessionId: sid, customerName: "Cliente mostrador", items: [item()], payments: [{ method: "cash", amount: 121 }] }, agA), "venta en efectivo");
      await ess.m("a", "tpv.closeSession", { sessionId: sid, countedCash: 121 }, agA);
      const resId = sale.sale.reservationId as number;
      expect(resId).toBeGreaterThan(0);
      // Sin factura (efectivo), pero con ticket
      expect((await ess.sql("a", "SELECT invoiceId FROM reservations WHERE id = ?", [resId]))[0].invoiceId).toBeNull();
      expect(String(sale.sale.ticketNumber)).not.toBe("");
      const audit = ok(await ess.q("a", "crm.reservations.auditOrphans", undefined, agA), "revisión");
      expect(audit.sinFactura.map((r: any) => r.id)).not.toContain(resId);
      // Un pedido cobrado sin ningún documento sí se señala
      const [r] = await ess.sql("a", "SELECT reservation_number FROM reservations WHERE id = ?", [resId]);
      await ess.sql("a", "INSERT INTO reservations (product_id, product_name, booking_date, people, amount_total, amount_paid, status, customer_name, merchant_order, reservation_number, channel, created_at, updated_at, paymentMethod) VALUES (?, 'Asesoría fiscal', '2026-11-01', 1, 5000, 5000, 'paid', 'Cliente sin factura', 'ORD-SINFACT', 'RES-SINFACT', 'MANUAL', ?, ?, 'efectivo')", [productId, Date.now(), Date.now()]);
      const audit2 = ok(await ess.q("a", "crm.reservations.auditOrphans", undefined, agA), "revisión 2");
      expect(audit2.sinFactura.map((x: any) => x.reservationNumber)).toEqual(["RES-SINFACT"]);
      expect(audit2.sinFactura.map((x: any) => x.reservationNumber)).not.toContain(r.reservation_number);
    });
  });

  describe("caja con descuento global e IVA mixto", () => {
    it("venta con tarjeta: venta, asiento y factura con el IVA ya descontado y su desglose; el informe de caja cuadra", async () => {
      const sid = await openSession();
      // 121 € al 21 % + 2 × 55 € al 10 %, 23,10 € de descuento → 207,90 €
      const r = ok(await ess.m("a", "tpv.createSale", { sessionId: sid, discountAmount: 23.1, discountReason: "Cliente habitual", items: [item(), item({ productId: product10Id, productName: "Curso", quantity: 2, unitPrice: 55 })], payments: [{ method: "card", amount: 207.9 }] }, agA), "venta con tarjeta");
      await ess.m("a", "tpv.closeSession", { sessionId: sid, countedCash: 0 }, agA);
      const saleId = r.sale.id as number;
      const [sale] = await ess.sql("a", "SELECT total, taxBase, taxAmount, taxRate, invoiceId FROM tpv_sales WHERE id = ?", [saleId]);
      expect([Number(sale.total), Number(sale.taxBase), Number(sale.taxAmount), Number(sale.taxRate)]).toEqual([207.9, 180, 27.9, 15.5]);
      // El ticket recibe el desglose por tipo
      expect(r.sale.taxBreakdown).toEqual([{ rate: 21, base: 90, amount: 18.9 }, { rate: 10, base: 90, amount: 9 }]);
      expect(ok(await ess.q("a", "tpv.getSale", { saleId }, agA), "ticket").sale.taxBreakdown).toEqual(r.sale.taxBreakdown);
      // Asiento del libro de cobros
      const [tx] = await ess.sql("a", "SELECT amount, taxBase, taxAmount FROM transactions WHERE tpvSaleId = ?", [saleId]);
      expect([Number(tx.amount), Number(tx.taxBase), Number(tx.taxAmount)]).toEqual([207.9, 180, 27.9]);
      // Factura: lo cobrado, base + IVA cuadran y desglose guardado
      const [inv] = await ess.sql("a", "SELECT subtotal, discount, taxAmount, taxBreakdown, total FROM invoices WHERE id = ?", [sale.invoiceId]);
      expect([Number(inv.subtotal), Number(inv.discount), Number(inv.taxAmount), Number(inv.total)]).toEqual([180, 23.1, 27.9, 207.9]);
      expect(json(inv.taxBreakdown)).toEqual([{ rate: 21, base: 90, amount: 18.9 }, { rate: 10, base: 90, amount: 9 }]);
      // Las líneas conservan su fiscalidad sin descontar y el informe de caja reparte el descuento una sola vez
      const today = new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date());
      const rep = ok(await ess.q("a", "tpv.reports.summary", { dateFrom: today, dateTo: today }, admA), "informe de caja");
      const byRate = Object.fromEntries(rep.byTaxRate.map((t: any) => [t.label, [t.taxBase, t.taxAmount]]));
      // Ventas del día: la de efectivo del resumen y esta (207,90 € cada una, con descuento) y la de 121 € sin descuento
      expect(byRate["IVA 21 %"]).toEqual([280, 58.8]);
      expect(byRate["IVA 10 %"]).toEqual([180, 18]);
    });
  });

  describe("factura libre: precios con IVA incluido o sin IVA y motivo de exención", () => {
    it("con IVA incluido e IVA mixto: el total es lo escrito, con su desglose; el 0 % guarda y muestra su motivo", async () => {
      const reason = "Operación exenta de IVA (art. 20 de la Ley 37/1992 del IVA)";
      const r = ok(await ess.m("a", "crm.invoices.createDirect", {
        client: { name: "Academia Ejemplo SL", nif: "B12345674" },
        pricesIncludeTax: true,
        lines: [
          { description: "Consultoría", quantity: 1, unitPrice: 121, taxRate: 21 },
          { description: "Material", quantity: 2, unitPrice: 55, taxRate: 10 },
          { description: "Curso reglado", quantity: 1, unitPrice: 80, taxRate: 0, exemptionReason: reason },
        ],
      }, agA), "factura con IVA incluido");
      expect(r.total).toBe(311);
      const [inv] = await ess.sql("a", "SELECT subtotal, taxAmount, taxBreakdown, total, itemsJson FROM invoices WHERE id = ?", [r.invoiceId]);
      expect([Number(inv.subtotal), Number(inv.taxAmount), Number(inv.total)]).toEqual([280, 31, 311]);
      expect(json(inv.taxBreakdown)).toEqual([{ rate: 21, base: 100, amount: 21 }, { rate: 10, base: 100, amount: 10 }, { rate: 0, base: 80, amount: 0 }]);
      const items = json(inv.itemsJson) as any[];
      expect(items.map((i) => i.total)).toEqual([121, 110, 80]);
      expect(items[2].exemptionReason).toBe(reason);
      const prev = await ess.call("a", "GET", `/api/invoices/preview?n=${encodeURIComponent(r.invoiceNumber)}`, { cookie: agA });
      expect(prev.status).toBe(200);
      expect(prev.text).toContain(`IVA 0 %: ${reason}`);
    });

    it("sin indicar el modo, los precios son sin IVA (como hasta ahora)", async () => {
      const r = ok(await ess.m("a", "crm.invoices.createDirect", { client: { name: "Cliente sin IVA" }, lines: [{ description: "Servicio", quantity: 1, unitPrice: 100, taxRate: 21 }] }, agA), "factura sin IVA");
      expect(r.total).toBe(121);
    });

    it("IVA al 0 % sin motivo: se rechaza y no consume número de la serie", async () => {
      const before = await ess.sql("a", "SELECT COUNT(*) AS n, MAX(invoiceNumber) AS last FROM invoices");
      const bad = await ess.m("a", "crm.invoices.createDirect", { client: { name: "Cliente exento" }, pricesIncludeTax: true, lines: [{ description: "Curso", quantity: 1, unitPrice: 80, taxRate: 0 }] }, agA);
      expect(bad.status).toBe(400);
      expect(bad.text).toContain("motivo de la exención");
      const after = await ess.sql("a", "SELECT COUNT(*) AS n, MAX(invoiceNumber) AS last FROM invoices");
      expect(after).toEqual(before);
    });
  });

  // Al final: añade una venta del día que los informes anteriores no cuentan
  describe("canje de un ticket de caja por factura", () => {
    it("ticket en efectivo canjeado por factura: cada línea conserva su IVA y el desglose es el del ticket", async () => {
      const sid = await openSession();
      // 121 € al 21 % + 2 × 55 € al 10 %, 23,10 € de descuento → 207,90 € en efectivo (sin factura automática)
      const r = ok(await ess.m("a", "tpv.createSale", { sessionId: sid, customerName: "Cliente canje", discountAmount: 23.1, discountReason: "Cliente habitual", items: [item(), item({ productId: product10Id, productName: "Curso", quantity: 2, unitPrice: 55 })], payments: [{ method: "cash", amount: 207.9 }] }, agA), "venta en efectivo");
      await ess.m("a", "tpv.closeSession", { sessionId: sid, countedCash: 207.9 }, agA);
      const resId = r.sale.reservationId as number;
      expect((await ess.sql("a", "SELECT invoiceId FROM reservations WHERE id = ?", [resId]))[0].invoiceId).toBeNull();
      const done = ok(await ess.m("a", "crm.reservations.generateInvoice", { reservationId: resId }, agA), "canje por factura");
      const [inv] = await ess.sql("a", "SELECT i.itemsJson, i.subtotal, i.taxAmount, i.taxBreakdown, i.total, i.discount FROM invoices i JOIN reservations r ON r.invoiceId = i.id WHERE r.id = ?", [resId]);
      expect(done).toBeTruthy();
      expect(json(inv.itemsJson).map((l: any) => [l.description, l.taxRate])).toEqual([["Asesoría fiscal", 21], ["Curso", 10]]);
      expect(json(inv.taxBreakdown)).toEqual(r.sale.taxBreakdown);
      expect(json(inv.taxBreakdown)).toEqual([{ rate: 21, base: 90, amount: 18.9 }, { rate: 10, base: 90, amount: 9 }]);
      expect([Number(inv.subtotal), Number(inv.taxAmount), Number(inv.total), Number(inv.discount)]).toEqual([180, 27.9, 207.9, 23.1]);
    });
  });
});
