/**
 * TPV con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL), migración 0018:
 *  - cobro idempotente: dos intentos simultáneos (o un reintento) con la misma clave dejan UNA venta y un solo número;
 *  - cliente enlazado: el cliente elegido por el cajero queda en la venta y en su historial del CRM, aunque se cobre
 *    con otro correo; un cliente de otra empresa no se puede enlazar.
 * Solo empresas sintéticas nuevas; ningún cobro real.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("TPV — cobro sin duplicados y cliente enlazado (aplicación real, dos empresas)", () => {
  let ess: EssentialApp;
  let admA: string;
  let agA: string;
  let agB: string;
  let productId = 0;
  let sessionId = 0;
  let registerId = 0;

  const sale = (o: Record<string, unknown> = {}) => ({
    sessionId,
    items: [{ productType: "experience", productId, productName: "Revisión", quantity: 1, unitPrice: 50 }],
    payments: [{ method: "card", amount: 50 }],
    ...o,
  });
  const count = async (q: string, p: unknown[] = []) => Number((await ess.sql("a", q, p))[0].n);

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "tpvidem");
    admA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    agB = await ess.login("b", "agente");
    await ess.m("a", "products.createCategory", { slug: "taller", name: "Taller" }, admA);
    await ess.m("a", "products.createLocation", { slug: "local", name: "Local" }, admA);
    const [c] = await ess.sql("a", "SELECT id FROM categories WHERE slug = 'taller'");
    const [l] = await ess.sql("a", "SELECT id FROM locations LIMIT 1");
    await ess.m("a", "products.create", { slug: "revision", title: "Revisión", categoryId: c.id, locationId: l.id, basePrice: "50.00", taxRate: "21" }, admA);
    productId = (await ess.sql("a", "SELECT id FROM experiences WHERE slug = 'revision'"))[0].id;
    await ess.sql("a", "UPDATE experiences SET isPresentialSale = 1 WHERE id = ?", [productId]);
    registerId = data(await ess.m("a", "tpv.createRegister", { name: "Mostrador" }, admA)).id;
    sessionId = data(await ess.m("a", "tpv.openSession", { registerId, openingAmount: 0 }, agA)).id;
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("dos cobros simultáneos con la misma clave graban UNA venta (un ticket, un cobro, una reserva, un asiento)", async () => {
    const intento = "doble-clic-0001";
    const before = await count("SELECT COUNT(*) AS n FROM tpv_sales");
    const counterBefore = await count("SELECT COALESCE(MAX(current_number), 0) AS n FROM document_counters WHERE document_type = 'tpv'");
    const [r1, r2] = await Promise.all([
      ess.m("a", "tpv.createSale", sale({ idempotencyKey: intento }), agA),
      ess.m("a", "tpv.createSale", sale({ idempotencyKey: intento }), agA),
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(data(r1).sale.id).toBe(data(r2).sale.id);
    expect([data(r1).replayed, data(r2).replayed].sort()).toEqual([false, true]);
    expect(data(r2).sale.ticketNumber).toBe(data(r1).sale.ticketNumber);
    expect(data(r2).items).toHaveLength(1);
    expect(data(r2).payments).toHaveLength(1);
    const saleId = data(r1).sale.id;
    expect(await count("SELECT COUNT(*) AS n FROM tpv_sales")).toBe(before + 1);
    expect(await count("SELECT COUNT(*) AS n FROM tpv_sale_payments WHERE saleId = ?", [saleId])).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM transactions WHERE tpvSaleId = ?", [saleId])).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM reservations WHERE notes LIKE ?", [`%${data(r1).sale.ticketNumber}%`])).toBe(1);
    // El intento repetido no consume número de ticket: la serie avanza exactamente uno
    expect(await count("SELECT COALESCE(MAX(current_number), 0) AS n FROM document_counters WHERE document_type = 'tpv'")).toBe(counterBefore + 1);

    // Reintento posterior (respuesta perdida): misma venta; con otra clave, venta nueva
    const again = await ess.m("a", "tpv.createSale", sale({ idempotencyKey: intento }), agA);
    expect([data(again).sale.id, data(again).replayed]).toEqual([saleId, true]);
    const other = await ess.m("a", "tpv.createSale", sale({ idempotencyKey: "otro-carrito-0002" }), agA);
    expect(data(other).sale.id).not.toBe(saleId);
    expect(await count("SELECT COUNT(*) AS n FROM tpv_sales")).toBe(before + 2);
    // Sin clave (otros canales, clientes antiguos): como siempre
    expect((await ess.m("a", "tpv.createSale", sale(), agA)).status).toBe(200);
    // Clave con caracteres no admitidos: rechazada
    expect(errCode(await ess.m("a", "tpv.createSale", sale({ idempotencyKey: "x' OR 1=1 --" }), agA))).toBe("BAD_REQUEST");
  });

  it("la clave es de su caja y de su empresa: B no recibe la venta de A con la misma clave", async () => {
    const intento = "intento-compartido-03";
    const a1 = data(await ess.m("a", "tpv.createSale", sale({ idempotencyKey: intento }), agA));
    // Otra caja de la misma empresa con la misma clave: error claro, sin venta nueva
    const reg2 = data(await ess.m("a", "tpv.createRegister", { name: "Terraza" }, admA)).id;
    const s2 = data(await ess.m("a", "tpv.openSession", { registerId: reg2, openingAmount: 0 }, agA)).id;
    const n = await count("SELECT COUNT(*) AS n FROM tpv_sales");
    expect(errCode(await ess.m("a", "tpv.createSale", sale({ sessionId: s2, idempotencyKey: intento }), agA))).toBe("CONFLICT");
    expect(await count("SELECT COUNT(*) AS n FROM tpv_sales")).toBe(n);
    // Empresa B: su propia BD; la clave de A no le devuelve nada de A
    const admB = await ess.login("b", "admin");
    const regB = data(await ess.m("b", "tpv.createRegister", { name: "Caja B" }, admB)).id;
    const sB = data(await ess.m("b", "tpv.openSession", { registerId: regB, openingAmount: 0 }, agB)).id;
    const rB = await ess.m("b", "tpv.createSale", { sessionId: sB, idempotencyKey: intento, items: [{ productType: "extra", productId: 0, productName: "Concepto", quantity: 1, unitPrice: 10, isManual: true, conceptText: "Concepto" }], payments: [{ method: "cash", amount: 10 }] }, admB);
    expect(rB.status).toBe(200);
    expect(data(rB).replayed).toBe(false);
    expect(Number(data(rB).sale.total)).toBe(10);
    expect(Number((await ess.sql("a", "SELECT total FROM tpv_sales WHERE id = ?", [a1.sale.id]))[0].total)).toBe(50);
  });

  it("si el cobro falla al grabarse, la clave se libera y el reintento graba la venta", async () => {
    const intento = "falla-y-reintenta-04";
    const bad = await ess.m("a", "tpv.createSale", sale({ idempotencyKey: intento, items: [{ productType: "experience", productId, productName: "Revisión", quantity: 1, unitPrice: 50, eventTime: "x".repeat(40) }] }), agA);
    expect(errCode(bad)).toBe("INTERNAL_SERVER_ERROR");
    const [failed] = await ess.sql("a", "SELECT status_ts AS status, idempotencyKey FROM tpv_sales ORDER BY id DESC LIMIT 1");
    expect([failed.status, failed.idempotencyKey]).toEqual(["cancelled", null]);
    const ok = await ess.m("a", "tpv.createSale", sale({ idempotencyKey: intento }), agA);
    expect(ok.status).toBe(200);
    expect([data(ok).sale.status, data(ok).replayed]).toEqual(["paid", false]);
  });

  it("cliente elegido por el cajero: queda en la venta y en su historial del CRM aunque se cobre con otro correo", async () => {
    await ess.sql("a", "INSERT INTO clients (source, name, email, phone, company, tags) VALUES ('manual', 'Marta Ruiz', 'marta@cliente-a.example', '600111222', '', '[]')");
    const [marta] = await ess.sql("a", "SELECT id FROM clients WHERE email = 'marta@cliente-a.example'");
    const found = data(await ess.q("a", "tpv.searchClients", { q: "marta" }, agA));
    expect(found.map((c: any) => c.id)).toEqual([marta.id]);
    // Cobra con el correo del trabajo: sin enlace no saldría en su historial
    const r = data(await ess.m("a", "tpv.createSale", sale({ clientId: marta.id, customerName: "Marta Ruiz", customerEmail: "marta.trabajo@empresa.example", idempotencyKey: "cliente-marta-05" }), agA));
    expect(r.sale.clientId).toBe(marta.id);
    const [res] = await ess.sql("a", "SELECT client_id AS clientId FROM reservations WHERE id = ?", [r.reservationId]);
    expect(res.clientId).toBe(marta.id);
    const hist = data(await ess.q("a", "crm.clients.getHistory", { id: marta.id }, admA));
    expect(hist.reservations.map((x: any) => x.id)).toContain(r.reservationId);
  });

  it("sin cliente elegido, el del CRM con ese correo queda enlazado; un cliente de otra empresa no se puede enlazar", async () => {
    const r = data(await ess.m("a", "tpv.createSale", sale({ customerName: "Pablo Gil", customerEmail: "pablo@cliente-a.example" }), agA));
    const [pablo] = await ess.sql("a", "SELECT id FROM clients WHERE email = 'pablo@cliente-a.example'");
    expect(pablo).toBeTruthy();
    const [row] = await ess.sql("a", "SELECT clientId FROM tpv_sales WHERE id = ?", [r.sale.id]);
    expect(row.clientId).toBe(pablo.id);
    // Un id de cliente que no existe en esta empresa (p. ej., de otra): rechazado, sin venta
    const n = await count("SELECT COUNT(*) AS n FROM tpv_sales");
    expect(errCode(await ess.m("a", "tpv.createSale", sale({ clientId: 999_999 }), agA))).toBe("NOT_FOUND");
    expect(await count("SELECT COUNT(*) AS n FROM tpv_sales")).toBe(n);
  });
});
