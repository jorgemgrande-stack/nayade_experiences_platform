/**
 * Pago fraccionado por el enlace del presupuesto, con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL). Dos empresas Essential sintéticas (A y B), pasarela en entorno de PRUEBAS y
 * notificaciones firmadas aquí: ningún cobro real.
 *
 * Fallo que cubre: al pagarse las cuotas obligatorias, la confirmación del plan borraba el token del enlace
 * del presupuesto y las cuotas siguientes ya no se podían pagar (ni ver) desde el correo. Se comprueba:
 *  - la primera cuota, las intermedias y la última se pagan con el mismo enlace, cada una por su importe;
 *  - una cuota pagada no se vuelve a cobrar: abrir el pago dos veces reutiliza el mismo pedido de la pasarela
 *    y, con el plan cobrado, el enlace ya no inicia pagos (solo muestra el presupuesto pagado con su factura);
 *  - la factura se emite una sola vez, al cobrar la última cuota;
 *  - el enlace de A no existe en B (ni para verlo ni para pagar).
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:root@127.0.0.1:33342/registro_test \
 *     pnpm vitest run server/cuotasEnlacePago.e2e.mysql.test.ts
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

describe.skipIf(!URL_)("pago fraccionado por el enlace del presupuesto (aplicación real)", () => {
  let ess: EssentialApp;
  let admA = "";
  let agA = "";
  let quoteId = 0;
  let token = "";
  const AMOUNTS = [5000, 5000, 4520]; // 145,20 € en tres cuotas; solo la primera confirma

  const ok = (r: Res, what: string) => {
    if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status} ${r.text.slice(0, 500)}`);
    return data(r);
  };
  const pay = () => ess.m("a", "crm.quotes.payWithToken", { token, origin: `https://${ess.host("a")}` });
  const orderOf = (p: any) => {
    const params = JSON.parse(Buffer.from(p.redsysForm?.Ds_MerchantParameters ?? p.redsysForm?.params?.Ds_MerchantParameters, "base64").toString());
    return { order: String(params.DS_MERCHANT_ORDER ?? params.Ds_Merchant_Order), amount: Number(params.DS_MERCHANT_AMOUNT ?? params.Ds_Merchant_Amount) };
  };
  const notify = (order: string, amount: number) =>
    ess.call("a", "POST", "/api/redsys/notification", {
      raw: signed(KEY_A, { Ds_Order: order, Ds_Response: "0000", Ds_Amount: String(amount), Ds_AuthorisationCode: "123456" }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
  const installments = () => ess.sql("a", "SELECT installment_number AS n, status FROM payment_installments WHERE quote_id = ? ORDER BY installment_number", [quoteId]);

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "cuo");
    admA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    await ess.markPaid("a");
    ok(await ess.m("a", "integrations.save", { provider: "redsys", values: { environment: "test", merchantCode: "999008881", merchantTerminal: "1", merchantKey: KEY_A } }, admA), "pasarela");
    const r = ok(
      await ess.m("a", "crm.quotes.createDirect", { clientName: "Lucía Plazos", clientEmail: "lucia@cliente-a.example", title: "Proyecto en tres pagos", items: [{ description: "Proyecto", quantity: 1, unitPrice: 145.2, total: 145.2, taxRate: 21 }], subtotal: 120, taxRate: 21, total: 145.2, sendNow: false }, agA),
      "presupuesto",
    );
    quoteId = Number(r.quoteId);
    const today = new Date();
    const due = (m: number) => new Date(today.getFullYear(), today.getMonth() + m, 15).toISOString().slice(0, 10);
    ok(
      await ess.m("a", "crm.paymentPlans.upsert", { quoteId, installments: AMOUNTS.map((amountCents, i) => ({ installmentNumber: i + 1, amountCents, dueDate: due(i), isRequiredForConfirmation: i === 0 })) }, agA),
      "plan de pagos",
    );
    const sent = ok(await ess.m("a", "crm.quotes.send", { id: quoteId, origin: `https://${ess.host("a")}` }, agA), "envío");
    token = sent.token ?? String(sent.acceptUrl).split("/").pop();
    expect(token.length).toBeGreaterThan(10);
  }, 300_000);

  afterAll(async () => {
    await ess?.close();
  });

  it("primera cuota: confirma el presupuesto y el enlace sigue vivo para las siguientes", async () => {
    const p1 = orderOf(ok(await pay(), "pagar cuota 1"));
    expect(p1.amount).toBe(AMOUNTS[0]);
    expect((await notify(p1.order, p1.amount)).text).toBe("OK");
    const [q] = await waitFor(() => ess.sql("a", "SELECT status, paymentLinkToken AS t, paidAt FROM quotes WHERE id = ?", [quoteId]), (rows) => rows[0]?.status === "aceptado");
    expect(q.status).toBe("aceptado");
    expect(q.t).toBe(token);
    expect(q.paidAt).toBeNull();
    // El cliente vuelve al enlace del correo: ve la cuota pagada y el importe de la siguiente
    const view = ok(await ess.q("a", "crm.quotes.getByToken", { token }), "ver tras la 1ª cuota");
    expect(view.installmentPlan.installments.map((i: any) => i.status)).toEqual(["paid", "pending", "pending"]);
    expect(view.installmentPlan.nextInstallment).toMatchObject({ installmentNumber: 2, amountCents: AMOUNTS[1] });
    expect(view.isPaid).toBe(false);
    // Confirmado con una cuota cobrada: desde el enlace ya no se puede rechazar
    expect(errCode(await ess.m("a", "crm.quotes.rejectByToken", { token }))).toBe("BAD_REQUEST");
    expect((await ess.sql("a", "SELECT status FROM quotes WHERE id = ?", [quoteId]))[0].status).toBe("aceptado");
    // No hay factura todavía: se emite al cobrar la última cuota
    expect(Number((await ess.sql("a", "SELECT COUNT(*) AS n FROM invoices WHERE quoteId = ?", [quoteId]))[0].n)).toBe(0);
  });

  it("cuota intermedia: se cobra por su importe; abrir el pago dos veces no crea un segundo cobro", async () => {
    const a = orderOf(ok(await pay(), "pagar cuota 2"));
    const b = orderOf(ok(await pay(), "pagar cuota 2 otra vez"));
    expect(a.amount).toBe(AMOUNTS[1]);
    expect(b).toEqual(a); // mismo pedido de la pasarela: no puede cobrarse dos veces
    expect((await notify(a.order, a.amount)).text).toBe("OK");
    await waitFor(installments, (rows) => rows[1]?.status === "paid");
    expect((await installments()).map((r) => r.status)).toEqual(["paid", "paid", "pending"]);
    // La notificación repetida de una cuota ya pagada no cambia nada
    await notify(a.order, a.amount);
    expect((await installments()).map((r) => r.status)).toEqual(["paid", "paid", "pending"]);
  });

  it("última cuota: cierra el plan con una sola factura y el enlace deja de cobrar", async () => {
    const p3 = orderOf(ok(await pay(), "pagar cuota 3"));
    expect(p3.amount).toBe(AMOUNTS[2]);
    expect((await notify(p3.order, p3.amount)).text).toBe("OK");
    const [q] = await waitFor(() => ess.sql("a", "SELECT paidAt, invoiceNumber FROM quotes WHERE id = ?", [quoteId]), (rows) => !!rows[0]?.invoiceNumber);
    expect(q.paidAt).not.toBeNull();
    expect((await installments()).map((r) => r.status)).toEqual(["paid", "paid", "paid"]);
    const inv = await ess.sql("a", "SELECT subtotal, taxAmount, total, taxBreakdown FROM invoices WHERE quoteId = ?", [quoteId]);
    expect(inv.length).toBe(1);
    // Lo facturado es lo cobrado en las tres cuotas, con base + IVA cuadrando y el desglose guardado
    expect([Number(inv[0].subtotal), Number(inv[0].taxAmount), Number(inv[0].total)]).toEqual([120, 25.2, 145.2]);
    const bd = typeof inv[0].taxBreakdown === "string" ? JSON.parse(inv[0].taxBreakdown) : inv[0].taxBreakdown;
    expect(bd).toEqual([{ rate: 21, base: 120, amount: 25.2 }]);
    // Todo cobrado: el enlace no inicia más pagos, pero sigue mostrando el presupuesto pagado
    expect(errCode(await pay())).toBe("BAD_REQUEST");
    const view = ok(await ess.q("a", "crm.quotes.getByToken", { token }), "ver pagado");
    expect(view).toMatchObject({ id: quoteId, isPaid: true, invoiceNumber: q.invoiceNumber });
    await notify(p3.order, p3.amount);
    expect(Number((await ess.sql("a", "SELECT COUNT(*) AS n FROM invoices WHERE quoteId = ?", [quoteId]))[0].n)).toBe(1);
  });

  it("el enlace de una empresa no sirve en otra", async () => {
    expect(errCode(await ess.q("b", "crm.quotes.getByToken", { token }))).toBe("NOT_FOUND");
    expect(errCode(await ess.m("b", "crm.quotes.payWithToken", { token, origin: `https://${ess.host("b")}` }))).toBe("NOT_FOUND");
    expect(errCode(await ess.m("b", "crm.quotes.rejectByToken", { token }))).toBe("NOT_FOUND");
  });
});
