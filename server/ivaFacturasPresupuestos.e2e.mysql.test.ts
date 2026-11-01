/**
 * IVA de las facturas de presupuestos con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL).
 * Una empresa Essential sintética, pasarela en entorno de PRUEBAS y notificaciones firmadas aquí: ningún cobro
 * real. Convenio: las líneas llevan el IVA incluido y el descuento del presupuesto se aplica antes de desglosar.
 *  - cobro único con tarjeta (IVA mixto con descuento): total = lo cobrado, base + IVA cuadran, desglose guardado;
 *  - cuotas (todas y la factura final) con descuento al 21 %;
 *  - confirmación manual de pago (10 %) y de transferencia (mixto);
 *  - modelo 303 del trimestre por tipo, con el desglose de cada factura;
 *  - abono por líneas de una factura con descuento;
 *  - presupuesto recibido con líneas sin IVA e incoherente: rechazo claro; con el indicador, normalizado.
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:root@127.0.0.1:33381/registro_test \
 *     pnpm vitest run server/ivaFacturasPresupuestos.e2e.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";
import { startEssentialApp, data, errCode, type EssentialApp, type Res } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 60_000 });
const KEY_A = crypto.randomBytes(24).toString("base64");

/** Notificación de la pasarela firmada como lo haría Redsys (3DES del pedido + HMAC-SHA256). */
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

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 150));
    v = await fn();
  }
  return v;
}

const json = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
const r2 = (n: number) => Math.round(n * 100) / 100;

describe.skipIf(!URL_)("IVA de las facturas de presupuestos (aplicación real)", () => {
  let ess: EssentialApp;
  let admA = "";
  let agA = "";
  let n = 0;

  const ok = (r: Res, what: string) => {
    if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status} ${r.text.slice(0, 500)}`);
    return data(r);
  };
  const quote = async (items: unknown[], discount: number, total: number, extra: Record<string, unknown> = {}) => {
    n += 1;
    const r = ok(await ess.m("a", "crm.quotes.createDirect", { clientName: `Cliente IVA ${n}`, clientEmail: `iva${n}@cliente-a.example`, title: `Presupuesto IVA ${n}`, items, subtotal: 0, discount, total, sendNow: false, ...extra }, agA), "presupuesto");
    return Number(r.quoteId);
  };
  const send = async (quoteId: number) => {
    const sent = ok(await ess.m("a", "crm.quotes.send", { id: quoteId, origin: `https://${ess.host("a")}` }, agA), "envío");
    return String(sent.token ?? String(sent.acceptUrl).split("/").pop());
  };
  const pay = (token: string) => ess.m("a", "crm.quotes.payWithToken", { token, origin: `https://${ess.host("a")}` });
  const orderOf = (p: any) => {
    const params = JSON.parse(Buffer.from(p.redsysForm?.Ds_MerchantParameters ?? p.redsysForm?.params?.Ds_MerchantParameters, "base64").toString());
    return { order: String(params.DS_MERCHANT_ORDER ?? params.Ds_Merchant_Order), amount: Number(params.DS_MERCHANT_AMOUNT ?? params.Ds_Merchant_Amount) };
  };
  const notify = (order: string, amount: number) =>
    ess.call("a", "POST", "/api/redsys/notification", {
      raw: signed(KEY_A, { Ds_Order: order, Ds_Response: "0000", Ds_Amount: String(amount), Ds_AuthorisationCode: "123456" }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
  const invoiceOf = async (quoteId: number) => {
    const rows = await waitFor(() => ess.sql("a", "SELECT id, invoiceNumber, subtotal, discount, taxRate, taxAmount, taxBreakdown, total, itemsJson FROM invoices WHERE quoteId = ? AND invoiceType = 'factura'", [quoteId]), (r) => r.length > 0);
    expect(rows.length).toBe(1);
    const inv = rows[0];
    return { ...inv, subtotal: Number(inv.subtotal), discount: Number(inv.discount), taxAmount: Number(inv.taxAmount), total: Number(inv.total), taxBreakdown: json(inv.taxBreakdown) };
  };
  /** Base + IVA = total al céntimo y el desglose suma lo mismo. */
  const expectBalanced = (inv: { subtotal: number; taxAmount: number; total: number; taxBreakdown: { base: number; amount: number }[] }, untaxed = 0) => {
    expect(r2(inv.subtotal + inv.taxAmount)).toBe(inv.total);
    expect(r2(inv.taxBreakdown.reduce((s, b) => s + b.base + b.amount, 0) + untaxed)).toBe(inv.total);
    expect(r2(inv.taxBreakdown.reduce((s, b) => s + b.amount, 0))).toBe(inv.taxAmount);
  };
  const expected303 = new Map<number, { base: number; amount: number }>();
  const add303 = (bd: { rate: number; base: number; amount: number }[], sign = 1) => {
    for (const b of bd) {
      const cur = expected303.get(b.rate) ?? { base: 0, amount: 0 };
      expected303.set(b.rate, { base: r2(cur.base + sign * Math.abs(b.base)), amount: r2(cur.amount + sign * Math.abs(b.amount)) });
    }
  };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "iva");
    admA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    await ess.markPaid("a");
    await ess.setCapability("a", "tax-filings", "active");
    ok(await ess.m("a", "integrations.save", { provider: "redsys", values: { environment: "test", merchantCode: "999008881", merchantTerminal: "1", merchantKey: KEY_A } }, admA), "pasarela");
  }, 300_000);

  afterAll(async () => {
    await ess?.close();
  });

  it("presupuesto recibido con líneas sin IVA y total con IVA: se rechaza con un error claro y no se crea nada", async () => {
    const before = Number((await ess.sql("a", "SELECT COUNT(*) AS n FROM quotes"))[0].n);
    const r = await ess.m("a", "crm.quotes.createDirect", { clientName: "Cliente API", clientEmail: "api@cliente-a.example", title: "Desde otra aplicación", items: [{ description: "Proyecto", quantity: 1, unitPrice: 120, total: 120, taxRate: 21 }], subtotal: 120, taxRate: 21, total: 145.2 }, agA);
    expect(errCode(r)).toBe("BAD_REQUEST");
    expect(r.text).toContain("IVA incluido");
    expect(Number((await ess.sql("a", "SELECT COUNT(*) AS n FROM quotes"))[0].n)).toBe(before);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM leads WHERE email = 'api@cliente-a.example'"))[0].n).toBe(0);
  });

  it("con el indicador de bases imponibles, las líneas se guardan con IVA incluido", async () => {
    const id = await quote([{ description: "Proyecto", quantity: 1, unitPrice: 120, total: 120, taxRate: 21 }], 0, 145.2, { pricesIncludeTax: false });
    const [q] = await ess.sql("a", "SELECT items, subtotal, tax, total FROM quotes WHERE id = ?", [id]);
    expect(json(q.items)[0]).toMatchObject({ unitPrice: 145.2, total: 145.2 });
    expect([Number(q.subtotal), Number(q.tax), Number(q.total)]).toEqual([120, 25.2, 145.2]);
  });

  it("al editar, un total que no cuadra con las líneas se rechaza", async () => {
    const id = await quote([{ description: "Servicio", quantity: 1, unitPrice: 121, total: 121, taxRate: 21 }], 0, 121);
    expect(errCode(await ess.m("a", "crm.quotes.update", { id, total: 150 }, agA))).toBe("BAD_REQUEST");
    ok(await ess.m("a", "crm.quotes.update", { id, discount: 12.1, total: 108.9 }, agA), "editar con descuento");
    const [q] = await ess.sql("a", "SELECT subtotal, tax, total FROM quotes WHERE id = ?", [id]);
    expect([Number(q.subtotal), Number(q.tax), Number(q.total)]).toEqual([90, 18.9, 108.9]);
  });

  it("cobro único con tarjeta, IVA mixto con descuento: la factura es lo cobrado con su desglose por tipo", async () => {
    // 121 € al 21 % + 110 € al 10 %, 10 % de descuento → 207,90 €
    const id = await quote([{ description: "Servicio general", quantity: 1, unitPrice: 121, total: 121, taxRate: 21 }, { description: "Servicio reducido", quantity: 2, unitPrice: 55, total: 110, taxRate: 10 }], 23.1, 207.9);
    const token = await send(id);
    const p = orderOf(ok(await pay(token), "pagar"));
    expect(p.amount).toBe(20790);
    expect((await notify(p.order, p.amount)).text).toBe("OK");
    const inv = await invoiceOf(id);
    expect(inv.total).toBe(207.9);
    expect([inv.subtotal, inv.taxAmount, inv.discount]).toEqual([180, 27.9, 23.1]);
    expect(inv.taxBreakdown).toEqual([{ rate: 21, base: 90, amount: 18.9 }, { rate: 10, base: 90, amount: 9 }]);
    expectBalanced(inv);
    add303(inv.taxBreakdown);
    // El documento muestra el descuento y las bases y cuotas ya descontadas
    const prev = await ess.call("a", "GET", `/api/invoices/preview?n=${encodeURIComponent(inv.invoiceNumber)}`, { cookie: agA });
    expect(prev.status).toBe(200);
    for (const s of ["Descuento del presupuesto", "−23,10 €", "90,00 €", "18,90 €", "9,00 €", "207,90 €"]) expect(prev.text).toContain(s);
    expect(prev.text).toContain("231,00 €"); // suma de los conceptos, antes del descuento
    expect(prev.text).not.toMatch(/[^0-9.]31,00 €/); // nunca el IVA de las líneas sin descontar
    // Abono por líneas de la factura con descuento: la línea al 10 % se abona por lo cobrado (99 €)
    const cn = ok(await ess.m("a", "crm.invoices.createCreditNote", { invoiceId: inv.id, reason: "Devolución del servicio reducido", lines: [{ itemIndex: 1 }] }, agA), "abono por líneas");
    const [ab] = await ess.sql("a", "SELECT total, taxBreakdown FROM invoices WHERE id = ?", [cn.creditNoteId]);
    expect(Number(ab.total)).toBe(-99);
    expect(json(ab.taxBreakdown)).toEqual([{ rate: 10, base: -90, amount: -9 }]);
    add303(json(ab.taxBreakdown), -1);
    // Lo que queda (la línea al 21 %) se abona entero y la factura queda abonada al céntimo
    const rest = ok(await ess.m("a", "crm.invoices.createCreditNote", { invoiceId: inv.id, reason: "Resto" }, agA), "abono del resto");
    const [ab2] = await ess.sql("a", "SELECT total, taxBreakdown FROM invoices WHERE id = ?", [rest.creditNoteId]);
    expect(Number(ab2.total)).toBe(-108.9);
    expect(json(ab2.taxBreakdown)).toEqual([{ rate: 21, base: -90, amount: -18.9 }]);
    add303(json(ab2.taxBreakdown), -1);
    expect((await ess.sql("a", "SELECT status FROM invoices WHERE id = ?", [inv.id]))[0].status).toBe("abonada");
  });

  it("cuotas al 21 % con descuento: todas las cuotas y una sola factura final por lo cobrado", async () => {
    // 121 € con 10 % de descuento → 108,90 € en dos cuotas
    const id = await quote([{ description: "Proyecto", quantity: 1, unitPrice: 121, total: 121, taxRate: 21 }], 12.1, 108.9);
    const today = new Date();
    const due = (m: number) => new Date(today.getFullYear(), today.getMonth() + m, 15).toISOString().slice(0, 10);
    const amounts = [5000, 5890];
    ok(await ess.m("a", "crm.paymentPlans.upsert", { quoteId: id, installments: amounts.map((amountCents, i) => ({ installmentNumber: i + 1, amountCents, dueDate: due(i), isRequiredForConfirmation: i === 0 })) }, agA), "plan");
    const token = await send(id);
    for (const cents of amounts) {
      const p = orderOf(ok(await pay(token), "pagar cuota"));
      expect(p.amount).toBe(cents);
      expect((await notify(p.order, p.amount)).text).toBe("OK");
      await waitFor(() => ess.sql("a", "SELECT COUNT(*) AS n FROM payment_installments WHERE quote_id = ? AND status = 'paid'", [id]), (r) => Number(r[0].n) >= amounts.indexOf(cents) + 1);
    }
    const inv = await invoiceOf(id);
    expect(inv.total).toBe(108.9);
    expect([inv.subtotal, inv.taxAmount, inv.discount]).toEqual([90, 18.9, 12.1]);
    expect(inv.taxBreakdown).toEqual([{ rate: 21, base: 90, amount: 18.9 }]);
    expectBalanced(inv);
    add303(inv.taxBreakdown);
  });

  it("confirmación manual de pago al 10 % con descuento: base + IVA del total cobrado", async () => {
    const id = await quote([{ description: "Formación", quantity: 2, unitPrice: 55, total: 110, taxRate: 10 }], 11, 99);
    // Un importe cobrado distinto del total no se factura aquí (para cobrar por partes, plan de pagos)
    const bad = await ess.m("a", "crm.quotes.confirmPayment", { quoteId: id, paidAmount: 50, paymentMethod: "efectivo", paymentNote: "Pago en mano" }, agA);
    expect(errCode(bad)).toBe("BAD_REQUEST");
    expect(bad.text).toContain("plan de pagos");
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM invoices WHERE quoteId = ?", [id]))[0].n).toBe(0);
    ok(await ess.m("a", "crm.quotes.confirmPayment", { quoteId: id, paymentMethod: "efectivo", paymentNote: "Pago en mano" }, agA), "confirmar pago");
    const inv = await invoiceOf(id);
    expect([inv.subtotal, inv.taxAmount, inv.total, inv.discount]).toEqual([90, 9, 99, 11]);
    expect(inv.taxBreakdown).toEqual([{ rate: 10, base: 90, amount: 9 }]);
    expectBalanced(inv);
    add303(inv.taxBreakdown);
  });

  it("confirmación de transferencia con IVA mixto y descuento (antes: base + IVA sin descontar)", async () => {
    // 60,50 € al 21 % + 33 € al 10 % con 5 € de descuento → 88,50 €
    const id = await quote([{ description: "Servicio general", quantity: 1, unitPrice: 60.5, total: 60.5, taxRate: 21 }, { description: "Servicio reducido", quantity: 1, unitPrice: 33, total: 33, taxRate: 10 }], 5, 88.5);
    await ess.sql("a", "UPDATE quotes SET transfer_proof_url = 'https://almacen.example/justificante.pdf' WHERE id = ?", [id]);
    ok(await ess.m("a", "crm.quotes.confirmTransfer", { quoteId: id }, agA), "confirmar transferencia");
    const inv = await invoiceOf(id);
    expect(inv.total).toBe(88.5);
    expect(inv.discount).toBe(5);
    expect(inv.taxBreakdown.map((b: any) => b.rate)).toEqual([21, 10]);
    expectBalanced(inv);
    // Cada tipo conserva su peso: 60,50 × 88,50 / 93,50 = 57,26 y 33 × 88,50 / 93,50 = 31,24
    expect(r2(inv.taxBreakdown[0].base + inv.taxBreakdown[0].amount)).toBe(57.26);
    expect(r2(inv.taxBreakdown[1].base + inv.taxBreakdown[1].amount)).toBe(31.24);
    add303(inv.taxBreakdown);
  });

  it("modelo 303 del trimestre: cada base a su tipo, con el desglose de cada factura y abono", async () => {
    const m = Number(new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date()).slice(5, 7));
    const year = Number(new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date()).slice(0, 4));
    const out = ok(await ess.q("a", "gestoria.iva.preview303", { periodKey: `${year}-T${Math.ceil(m / 3)}` }, admA), "303");
    const expected = Array.from(expected303.entries()).map(([rate, v]) => ({ rate, ...v })).sort((a, b) => b.rate - a.rate);
    expect(out.outputByRate).toEqual(expected);
    expect(out.outputAmount).toBe(r2(expected.reduce((s, l) => s + l.amount, 0)));
  });
});
