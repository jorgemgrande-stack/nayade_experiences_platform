/**
 * Documento fiscal de las ventas de caja con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL).
 * Empresa sintética nueva; ningún cobro real.
 *  - Tarjeta sin cliente: solo ticket (factura simplificada, art. 4 RD 1619/2012), ninguna factura a nombre de
 *    «Cliente TPV»; el cobro queda contabilizado y los informes cuadran.
 *  - Tarjeta con cliente con razón social, NIF y domicilio: factura completa a su nombre, cobrada con tarjeta; el
 *    ticket queda «sustituido».
 *  - Cliente sin NIF: solo ticket.
 *  - Más de 400 € IVA incluido sin destinatario: se rechaza sin consumir número; con él, factura completa.
 *  - Canje posterior del ticket de tarjeta: factura válida, cobrada con tarjeta.
 *  - Lo ya emitido (una factura «Cliente TPV» antigua) no cambia ni un carácter, y el diagnóstico de solo lectura
 *    la lista (solo a ella) sin escribir nada.
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:root@127.0.0.1:33601/registro_test \
 *     pnpm vitest run server/cajaTarjetaFactura.e2e.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startEssentialApp, data, type EssentialApp, type Res } from "./essentialApp.testkit";
import { madridDayKey } from "../shared/gestoriaExportPeriod";
import { diagnoseAnonymousTpvInvoices, formatAnonymousDiagnosis } from "./tpvAnonymousInvoiceDiagnosis";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 60_000 });
const today = madridDayKey(new Date());
const quarterKey = `${today.slice(0, 4)}-T${Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1}`;
// Fuera del trimestre y del mes en curso
const longAgo = new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
const json = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);

describe.skipIf(!URL_)("documento fiscal de las ventas de caja (aplicación real)", () => {
  let ess: EssentialApp;
  let admA = "";
  let agA = "";
  let sessionId = 0;
  let clientNif = 0;
  let clientSinNif = 0;
  const legacy = { number: "FAC-ANTIGUA-TPV-0001", row: null as any, html: "" };
  const item = (unitPrice = 24.2, quantity = 1) => ({ productType: "experience", productId: 0, productName: "Escobillas", quantity, unitPrice });
  let productId = 0;

  const ok = (r: Res, what: string) => {
    if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status} ${r.text.slice(0, 500)}`);
    return data(r);
  };
  const sale = async (extra: Record<string, unknown>, what: string, unitPrice = 24.2, quantity = 1) => {
    const total = Math.round(unitPrice * quantity * 100) / 100;
    return ok(await ess.m("a", "tpv.createSale", { sessionId, items: [{ ...item(unitPrice, quantity), productId }], payments: [{ method: "card", amount: total }], ...extra }, agA), what).sale;
  };
  const preview = async (n: string) => {
    const r = await ess.call("a", "GET", `/api/invoices/preview?n=${encodeURIComponent(n)}`, { cookie: agA });
    expect(r.status).toBe(200);
    return r.text;
  };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "cajatarjeta");
    admA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    await ess.markPaid("a");
    ok(await ess.m("a", "products.createCategory", { slug: "general", name: "General" }, admA), "categoría");
    ok(await ess.m("a", "products.createLocation", { slug: "local", name: "Local" }, admA), "lugar");
    const [c] = await ess.sql("a", "SELECT id FROM categories LIMIT 1");
    const [l] = await ess.sql("a", "SELECT id FROM locations LIMIT 1");
    ok(await ess.m("a", "products.create", { slug: "escobillas", title: "Escobillas", categoryId: c.id, locationId: l.id, basePrice: "24.20", taxRate: "21", productType: "own" }, admA), "producto");
    productId = (await ess.sql("a", "SELECT id FROM experiences WHERE slug = 'escobillas'"))[0].id;
    await ess.sql("a", "UPDATE experiences SET isPresentialSale = 1");
    ok(await ess.m("a", "crm.clients.create", { name: "Lucía Martín", email: "lucia@cliente-a.example", company: "Transportes Ruiz SL", nif: "B12345674", address: "Polígono Sur 4", postalCode: "28901", city: "Getafe" }, agA), "cliente con NIF");
    ok(await ess.m("a", "crm.clients.create", { name: "Pedro Sin Nif", email: "pedro@cliente-a.example" }, agA), "cliente sin NIF");
    clientNif = (await ess.sql("a", "SELECT id FROM clients WHERE email = 'lucia@cliente-a.example'"))[0].id;
    clientSinNif = (await ess.sql("a", "SELECT id FROM clients WHERE email = 'pedro@cliente-a.example'"))[0].id;
    // Factura «Cliente TPV» emitida antes del cambio (como las de production): no se toca
    await ess.sql("a", "INSERT INTO invoices (invoiceNumber, clientName, clientEmail, itemsJson, subtotal, taxRate, taxAmount, total, status, paymentMethod, issuedAt) VALUES (?, 'Cliente TPV', '', ?, 20, 21, 4.2, 24.2, 'cobrada', 'tarjeta_fisica', ?)", [legacy.number, JSON.stringify([{ description: "Escobillas", quantity: 1, unitPrice: 24.2, total: 24.2, taxRate: 21, fiscalRegime: "general" }]), longAgo]);
    [legacy.row] = await ess.sql("a", "SELECT * FROM invoices WHERE invoiceNumber = ?", [legacy.number]);
    legacy.html = await preview(legacy.number);
    const registerId = ok(await ess.m("a", "tpv.createRegister", { name: "Mostrador" }, admA), "caja").id;
    sessionId = ok(await ess.m("a", "tpv.openSession", { registerId, openingAmount: 0 }, agA), "abrir caja").id;
  }, 300_000);

  afterAll(async () => {
    await ess?.close();
  });

  const ids = { anon: 0, withNif: 0, noNif: 0, big: 0 };

  it("tarjeta sin cliente: solo ticket, sin factura; el cobro con tarjeta queda contabilizado", async () => {
    const before = await ess.sql("a", "SELECT COUNT(*) AS n FROM invoices");
    const s = await sale({}, "tarjeta sin cliente");
    ids.anon = s.id;
    expect(s.status).toBe("paid");
    expect((await ess.sql("a", "SELECT invoiceId FROM tpv_sales WHERE id = ?", [s.id]))[0].invoiceId).toBeNull();
    expect(await ess.sql("a", "SELECT COUNT(*) AS n FROM invoices")).toEqual(before);
    expect(await ess.sql("a", "SELECT COUNT(*) AS n FROM invoices WHERE clientName = 'Cliente TPV' AND invoiceNumber <> ?", [legacy.number])).toEqual([{ n: 0 }]);
    const [tx] = await ess.sql("a", "SELECT amount, paymentMethod, status, taxBase, taxAmount FROM transactions WHERE tpvSaleId = ?", [s.id]);
    expect([Number(tx.amount), tx.paymentMethod, tx.status, Number(tx.taxBase), Number(tx.taxAmount)]).toEqual([24.2, "tarjeta_fisica", "completado", 20, 4.2]);
    const sum = ok(await ess.q("a", "tpv.getSessionSummary", { sessionId }, agA), "resumen de caja");
    expect(sum.totalCard).toBe(24.2);
  });

  it("tarjeta con cliente con NIF: factura completa a su nombre, cobrada con tarjeta", async () => {
    const s = await sale({ clientId: clientNif, customerName: "Lucía Martín", customerEmail: "lucia@cliente-a.example" }, "tarjeta con NIF");
    ids.withNif = s.id;
    const [row] = await ess.sql("a", "SELECT invoiceId FROM tpv_sales WHERE id = ?", [s.id]);
    expect(row.invoiceId).toBeGreaterThan(0);
    const [inv] = await ess.sql("a", "SELECT invoiceNumber, clientName, clientNif, clientAddress, status, paymentMethod, paymentValidatedAt, total, taxAmount, taxBreakdown, issuerSnapshot FROM invoices WHERE id = ?", [row.invoiceId]);
    expect([inv.clientName, inv.clientNif, inv.clientAddress]).toEqual(["Transportes Ruiz SL", "B12345674", "Polígono Sur 4, 28901 Getafe"]);
    expect([inv.status, inv.paymentMethod, Number(inv.total), Number(inv.taxAmount)]).toEqual(["cobrada", "tarjeta_fisica", 24.2, 4.2]);
    expect(inv.paymentValidatedAt).toBeTruthy();
    expect(inv.issuerSnapshot).toBeTruthy();
    expect(json(inv.taxBreakdown)).toEqual([{ rate: 21, base: 20, amount: 4.2 }]);
    const html = await preview(inv.invoiceNumber);
    expect(html).toContain("Transportes Ruiz SL");
    expect(html).toContain("B12345674");
    expect(html).not.toContain("Cliente TPV");
  });

  it("cliente sin NIF: solo ticket", async () => {
    const s = await sale({ clientId: clientSinNif, customerName: "Pedro Sin Nif" }, "cliente sin NIF");
    ids.noNif = s.id;
    expect((await ess.sql("a", "SELECT invoiceId FROM tpv_sales WHERE id = ?", [s.id]))[0].invoiceId).toBeNull();
  });

  it("más de 400 €: sin destinatario se rechaza sin numerar; con sus datos, factura completa", async () => {
    const before = await ess.sql("a", "SELECT COUNT(*) AS n FROM tpv_sales");
    for (const extra of [{}, { clientId: clientSinNif }]) {
      const r = await ess.m("a", "tpv.createSale", { sessionId, items: [{ ...item(24.2, 20), productId }], payments: [{ method: "card", amount: 484 }], ...extra }, agA);
      expect(r.status).toBe(400);
      expect(r.text).toContain("Esta venta supera 400 € (IVA incluido) y no se puede cobrar solo con ticket");
    }
    // Datos incompletos tampoco
    const half = await ess.m("a", "tpv.createSale", { sessionId, items: [{ ...item(24.2, 20), productId }], payments: [{ method: "card", amount: 484 }], invoiceRecipient: { name: "Flotas Norte SL", nif: "", address: "", postalCode: "", city: "" } }, agA);
    expect(half.status).toBe(400);
    expect(half.text).toContain("Indica el NIF del destinatario de la factura.");
    expect(await ess.sql("a", "SELECT COUNT(*) AS n FROM tpv_sales")).toEqual(before);

    const s = await sale({ invoiceRecipient: { name: "Flotas Norte SL", nif: "b12345674", address: "Calle Mayor 4", postalCode: "28013", city: "Madrid" } }, "más de 400 € con datos", 24.2, 20);
    ids.big = s.id;
    const [inv] = await ess.sql("a", "SELECT i.clientName, i.clientNif, i.clientAddress, i.total, i.status FROM invoices i JOIN tpv_sales s ON s.invoiceId = i.id WHERE s.id = ?", [s.id]);
    expect([inv.clientName, inv.clientNif, inv.clientAddress, Number(inv.total), inv.status]).toEqual(["Flotas Norte SL", "B12345674", "Calle Mayor 4, 28013 Madrid", 484, "cobrada"]);
  });

  it("canje posterior del ticket de tarjeta: factura válida, cobrada con tarjeta", async () => {
    const [s] = await ess.sql("a", "SELECT reservationId FROM tpv_sales WHERE id = ?", [ids.anon]);
    const done = ok(await ess.m("a", "crm.reservations.generateInvoice", { reservationId: s.reservationId, clientName: "Talleres Canje SL", clientNif: "B12345674", clientAddress: "Polígono Sur 4", clientPostalCode: "28901", clientCity: "Getafe" }, agA), "canje");
    const [inv] = await ess.sql("a", "SELECT clientName, clientNif, status, paymentMethod, total FROM invoices WHERE id = ?", [done.invoiceId]);
    expect([inv.clientName, inv.clientNif, inv.status, inv.paymentMethod, Number(inv.total)]).toEqual(["Talleres Canje SL", "B12345674", "cobrada", "tarjeta_fisica", 24.2]);
    expect((await ess.sql("a", "SELECT invoiceId FROM tpv_sales WHERE id = ?", [ids.anon]))[0].invoiceId).toBe(done.invoiceId);
  });

  it("informes, 303 y resumen cuadran: cada venta cuenta una vez (ticket o su factura)", async () => {
    // Ventas de hoy: 24,20 (canjeada) + 24,20 (factura) + 24,20 (ticket) + 484 (factura) = 556,60; la antigua es de hace 200 días
    const rep = ok(await ess.q("a", "accounting.getReports", { from: today, to: today }, admA), "informes");
    expect(rep.fiscal).toMatchObject({ total: 556.6, base: 460, tax: 96.6, invoices: 3, tickets: 1, substitutedTickets: 3 });
    await ess.setCapability("a", "tax-filings", "active");
    const m303 = ok(await ess.q("a", "gestoria.iva.preview303", { periodKey: quarterKey }, admA), "303");
    expect([m303.outputBase, m303.outputAmount]).toEqual([460, 96.6]);
    const sum = ok(await ess.q("a", "accounting.getSummary", {}, admA), "resumen");
    expect(sum.months[sum.months.length - 1].invoiced).toBe(556.6);
  });

  it("lo ya emitido no cambia: la factura «Cliente TPV» antigua sigue idéntica", async () => {
    const [now] = await ess.sql("a", "SELECT * FROM invoices WHERE invoiceNumber = ?", [legacy.number]);
    expect(now).toEqual(legacy.row);
    expect(await preview(legacy.number)).toBe(legacy.html);
  });

  it("diagnóstico de solo lectura: lista solo la factura «Cliente TPV» antigua y no escribe nada", async () => {
    const checksum = async () => JSON.stringify(await ess.sql("a", "CHECKSUM TABLE invoices, tpv_sales"));
    const before = await checksum();
    const conn = { query: async (q: string, params?: unknown[]) => [await ess.sql("a", q, params ?? [])] } as any;
    const r = await diagnoseAnonymousTpvInvoices(conn);
    expect(await checksum()).toBe(before);
    expect(r.checked).toBe(4);
    expect(r.findings.map((f) => [f.invoiceNumber, f.total, f.issues])).toEqual([[legacy.number, 24.2, ["nombre_generico", "sin_nif"]]]);
    const text = formatAnonymousDiagnosis(r);
    expect(text).toContain("Facturas de caja revisadas: 4. Sin destinatario identificado: 1 (24,20 €).");
    expect(text).not.toMatch(/Transportes Ruiz|Flotas Norte|Talleres Canje/);
  });
});
