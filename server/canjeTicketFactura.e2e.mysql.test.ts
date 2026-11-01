/**
 * Canje de un ticket de caja anónimo por factura completa con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL). Empresa sintética nueva; ningún cobro real.
 *  - Sin nombre ni NIF del destinatario no se emite (art. 6 RD 1619/2012) y no se consume número de la serie.
 *  - Con nombre, NIF y dirección: la factura sale a su nombre, con el IVA del ticket (10 %), «cobrada» y con
 *    la forma de pago del ticket.
 *  - Venta con cliente vinculado: el diálogo propone sus datos.
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:root@127.0.0.1:33581/registro_test \
 *     pnpm vitest run server/canjeTicketFactura.e2e.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startEssentialApp, data, type EssentialApp, type Res } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 60_000 });

const json = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
const recipient = { clientName: "Transportes Ruiz SL", clientNif: "b12345674", clientAddress: "Polígono Sur 4", clientPostalCode: "28901", clientCity: "Getafe" };

describe.skipIf(!URL_)("canje de ticket anónimo por factura (aplicación real)", () => {
  let ess: EssentialApp;
  let admA = "";
  let agA = "";
  let productId = 0;
  let sessionId = 0;

  const ok = (r: Res, what: string) => {
    if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status} ${r.text.slice(0, 500)}`);
    return data(r);
  };
  const item = { productType: "experience", productId: 0, productName: "Lavado interior", quantity: 1, unitPrice: 22 };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "canje");
    admA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    await ess.markPaid("a");
    ok(await ess.m("a", "products.createCategory", { slug: "lavados", name: "Lavados" }, admA), "categoría");
    ok(await ess.m("a", "products.createLocation", { slug: "taller", name: "Taller" }, admA), "lugar");
    const [c] = await ess.sql("a", "SELECT id FROM categories LIMIT 1");
    const [l] = await ess.sql("a", "SELECT id FROM locations LIMIT 1");
    ok(await ess.m("a", "products.create", { slug: "lavado-interior", title: "Lavado interior", categoryId: c.id, locationId: l.id, basePrice: "22.00", taxRate: "10" }, admA), "producto al 10 %");
    productId = (await ess.sql("a", "SELECT id FROM experiences WHERE slug = 'lavado-interior'"))[0].id;
    item.productId = productId;
    await ess.sql("a", "UPDATE experiences SET isPresentialSale = 1");
    const registerId = ok(await ess.m("a", "tpv.createRegister", { name: "Mostrador" }, admA), "caja").id;
    sessionId = ok(await ess.m("a", "tpv.openSession", { registerId, openingAmount: 0 }, agA), "abrir caja").id;
  }, 300_000);

  afterAll(async () => {
    await ess?.close();
  });

  it("ticket anónimo al 10 %: sin nombre ni NIF se rechaza; con ellos, factura a su nombre, IVA del 10 % y cobrada", async () => {
    const sale = ok(await ess.m("a", "tpv.createSale", { sessionId, items: [item], payments: [{ method: "cash", amount: 22 }] }, agA), "venta anónima");
    const resId = sale.sale.reservationId as number;
    expect((await ess.sql("a", "SELECT customer_name AS n FROM reservations WHERE id = ?", [resId]))[0].n).toBe("Cliente TPV");

    // El diálogo no propone «Cliente TPV»
    const proposal = ok(await ess.q("a", "crm.reservations.invoiceRecipient", { reservationId: resId }, agA), "propuesta");
    expect(proposal).toEqual({ name: "", nif: "", address: "", postalCode: "", city: "", fromClient: false });

    const before = await ess.sql("a", "SELECT COUNT(*) AS n FROM invoices");
    const bad = await ess.m("a", "crm.reservations.generateInvoice", { reservationId: resId }, agA);
    expect(bad.status).toBe(400);
    expect(bad.text).toContain("Indica el nombre o la razón social del destinatario de la factura.");
    expect(bad.text).toContain("Indica el NIF del destinatario de la factura.");
    // Con el nombre genérico de la caja tampoco
    const generic = await ess.m("a", "crm.reservations.generateInvoice", { reservationId: resId, ...recipient, clientName: "Cliente TPV" }, agA);
    expect(generic.status).toBe(400);
    expect(await ess.sql("a", "SELECT COUNT(*) AS n FROM invoices")).toEqual(before);
    expect((await ess.sql("a", "SELECT invoiceId FROM reservations WHERE id = ?", [resId]))[0].invoiceId).toBeNull();

    const done = ok(await ess.m("a", "crm.reservations.generateInvoice", { reservationId: resId, ...recipient }, agA), "canje");
    const [inv] = await ess.sql("a", "SELECT clientName, clientNif, clientAddress, subtotal, taxAmount, total, taxBreakdown, itemsJson, status, paymentMethod, paymentValidatedAt, issuerSnapshot FROM invoices WHERE id = ?", [done.invoiceId]);
    expect(inv.clientName).toBe("Transportes Ruiz SL");
    expect(inv.clientNif).toBe("B12345674");
    expect(inv.clientAddress).toBe("Polígono Sur 4, 28901 Getafe");
    expect([Number(inv.subtotal), Number(inv.taxAmount), Number(inv.total)]).toEqual([20, 2, 22]);
    expect(json(inv.taxBreakdown)).toEqual([{ rate: 10, base: 20, amount: 2 }]);
    expect(json(inv.itemsJson).map((l: any) => l.taxRate)).toEqual([10]);
    expect(inv.status).toBe("cobrada");
    expect(inv.paymentMethod).toBe("efectivo");
    expect(inv.paymentValidatedAt).toBeTruthy();
    expect(inv.issuerSnapshot).toBeTruthy();
    expect((await ess.sql("a", "SELECT invoiceId FROM tpv_sales WHERE id = ?", [sale.sale.id]))[0].invoiceId).toBe(done.invoiceId);

    // La vista de la factura lleva el destinatario, no «Cliente TPV»
    const prev = await ess.call("a", "GET", `/api/invoices/preview?n=${encodeURIComponent(done.invoiceNumber)}`, { cookie: agA });
    expect(prev.status).toBe(200);
    expect(prev.text).toContain("Transportes Ruiz SL");
    expect(prev.text).toContain("NIF: B12345674");
    expect(prev.text).toContain("Polígono Sur 4, 28901 Getafe");
    expect(prev.text).not.toContain("Cliente TPV");
  });

  it("venta con cliente vinculado: se proponen sus datos", async () => {
    const sale = ok(await ess.m("a", "tpv.createSale", { sessionId, customerName: "Lucía Martín", customerEmail: "lucia.martin@cliente.example", items: [item], payments: [{ method: "cash", amount: 22 }] }, agA), "venta con cliente");
    const resId = sale.sale.reservationId as number;
    const [link] = await ess.sql("a", "SELECT COALESCE(r.client_id, s.clientId) AS cid FROM reservations r LEFT JOIN tpv_sales s ON s.reservationId = r.id WHERE r.id = ?", [resId]);
    expect(link.cid).toBeGreaterThan(0);
    await ess.sql("a", "UPDATE clients SET nif = '12345678Z', address = 'Calle Mayor 1', postalCode = '28013', city = 'Madrid' WHERE id = ?", [link.cid]);
    const proposal = ok(await ess.q("a", "crm.reservations.invoiceRecipient", { reservationId: resId }, agA), "propuesta");
    expect(proposal).toEqual({ name: "Lucía Martín", nif: "12345678Z", address: "Calle Mayor 1", postalCode: "28013", city: "Madrid", fromClient: true });
  });
});
