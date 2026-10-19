/**
 * Essential — Facturación (bill-invoices, bill-series, bill-taxes, bill-payments, bill-cash,
 * bill-reports) con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL). Solo empresas
 * sintéticas nuevas aprovisionadas desde la baseline; ningún documento fiscal real.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, licenseMatrix, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const YEAR = new Date().getFullYear();

describe.skipIf(!URL_)("Essential — Facturación (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let admA: string;
  let admB: string;
  let agA: string;
  let agB: string;
  let userA: string;
  let productId = 0;
  let invoiceId = 0;

  /** Reserva manual (venta delegada) de 121 € del producto con IVA reducido. */
  async function reservation(email: string) {
    const r = await ess.m("a", "crm.reservations.createManual", { customerName: "Cliente Factura", customerEmail: email, productId, productName: "Servicio con IVA reducido", bookingDate: "2030-05-01", people: 1, amountTotal: 110, amountPaid: 0, sendConfirmationEmail: false }, agA);
    expect(r.status).toBe(200);
    return (await ess.sql("a", "SELECT id FROM reservations WHERE customer_email = ? ORDER BY id DESC LIMIT 1", [email]))[0].id as number;
  }

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "bill");
    admA = await ess.login("a", "admin");
    admB = await ess.login("b", "admin");
    agA = await ess.login("a", "agente");
    agB = await ess.login("b", "agente");
    userA = await ess.login("a", "user");
    await ess.m("a", "products.createCategory", { slug: "general", name: "General" }, admA);
    await ess.m("a", "products.createLocation", { slug: "sede", name: "Sede" }, admA);
    const [c] = await ess.sql("a", "SELECT id FROM categories LIMIT 1");
    const [l] = await ess.sql("a", "SELECT id FROM locations LIMIT 1");
    await ess.m("a", "products.create", { slug: "servicio-iva-10", title: "Servicio con IVA reducido", categoryId: c.id, locationId: l.id, basePrice: "110.00", taxRate: "10" }, admA);
    productId = (await ess.sql("a", "SELECT id FROM experiences WHERE slug = 'servicio-iva-10'"))[0].id;
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("bill-series: prefijo propio de la serie de facturas; la numeración de B es independiente", async () => {
    expect((await ess.m("a", "documentNumbers.updatePrefix", { documentType: "factura", year: YEAR, newPrefix: "A-FAC" }, admA)).status).toBe(200);
    // Antes del arreglo la serie de propuestas no podía configurarse
    expect((await ess.m("a", "documentNumbers.updatePrefix", { documentType: "propuesta", year: YEAR, newPrefix: "A-PROP" }, admA)).status).toBe(200);
    expect(errCode(await ess.m("a", "documentNumbers.updatePrefix", { documentType: "factura", year: YEAR, newPrefix: "x y" }, admA))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "documentNumbers.updatePrefix", { documentType: "factura", year: YEAR, newPrefix: "NO" }, agA))).toBe("FORBIDDEN");
    const counters = data(await ess.q("a", "documentNumbers.getCounters", undefined, admA));
    expect(JSON.stringify(counters)).toContain("A-FAC");
    expect(JSON.stringify(data(await ess.q("b", "documentNumbers.getCounters", undefined, admB)))).not.toContain("A-FAC");

    const lic = await licenseMatrix(ess, "bill-series", {
      query: () => ess.q("a", "documentNumbers.getCounters", undefined, admA),
      mutation: () => ess.m("a", "documentNumbers.updatePrefix", { documentType: "factura", year: YEAR, newPrefix: "BLOQ" }, admA),
    });
    expect(lic.readOnlyQuery?.status).toBe(200);
    expect(isLicenseDenied(lic.readOnlyMutation, "bill-series")).toBe(true);
    expect(isLicenseDenied(lic.noneQuery, "bill-series")).toBe(true);
  });

  it("bill-invoices + bill-taxes: factura de una reserva con el IVA del producto, emisor de la empresa; abono; aislamiento", async () => {
    // La venta delegada emite su factura al registrarse
    const resId = await reservation("factura@cliente-a.example");
    const [inv] = await ess.sql("a", "SELECT id, invoiceNumber, subtotal, taxAmount, total, status, invoiceType FROM invoices WHERE reservationId = ?", [resId]);
    invoiceId = inv.id;
    expect(inv.invoiceNumber).toBe(`A-FAC-${YEAR}-0001`);
    expect(inv.invoiceType).toBe("factura");
    expect(Number(inv.total)).toBe(110);
    // IVA del producto (10 %), incluido en el precio: 100 + 10
    expect(Number(inv.taxAmount)).toBeCloseTo(10, 2);
    expect(Number(inv.subtotal)).toBeCloseTo(100, 2);
    // Volver a facturar la reserva: no se duplica
    expect(errCode(await ess.m("a", "crm.reservations.generateInvoice", { reservationId: resId }, agA))).toBe("PRECONDITION_FAILED");

    // Vista de la factura con la identidad fiscal de A
    const prev = await ess.call("a", "GET", `/api/invoices/preview?n=${encodeURIComponent(inv.invoiceNumber)}`, { cookie: agA });
    expect(prev.status).toBe(200);
    expect(prev.text).toContain("B00000011");
    expect(prev.text).not.toMatch(/n[aá]yade|skicenter|B26987875/i);
    // Desde la empresa B el mismo número no existe (su agente está autenticado en B: la factura no está en su BD)
    expect((await ess.call("b", "GET", `/api/invoices/preview?n=${encodeURIComponent(inv.invoiceNumber)}`, { cookie: agB })).status).toBe(404);
    // La sesión de A no vale en el host de B, ni la de un usuario de A sin permiso de CRM
    expect((await ess.call("b", "GET", `/api/invoices/preview?n=${encodeURIComponent(inv.invoiceNumber)}`, { cookie: agA })).status).toBe(401);
    expect((await ess.call("a", "GET", `/api/invoices/preview?n=${encodeURIComponent(inv.invoiceNumber)}`, { cookie: userA })).status).toBe(401);
    // Sin sesión, solo con el número (enumerable): denegado
    expect((await ess.call("a", "GET", `/api/invoices/preview?n=${encodeURIComponent(inv.invoiceNumber)}`, {})).status).toBe(401);

    const cn = await ess.m("a", "crm.invoices.createCreditNote", { invoiceId, reason: "Devolución parcial", partialAmount: 22 }, agA);
    expect(cn.status).toBe(200);
    const [abono] = await ess.sql("a", "SELECT invoiceNumber, total, creditNoteForId FROM invoices WHERE invoiceType = 'abono'");
    expect(abono.creditNoteForId).toBe(invoiceId);
    // Los abonos tienen su propia serie fija (ABO-AAAA-MM-NNNN), no configurable desde el panel
    expect(abono.invoiceNumber).toMatch(/^ABO-[0-9]{4}-[0-9]{2}-0001$/);
    expect(Number(abono.total)).toBe(-22);

    expect(data(await ess.q("a", "crm.invoices.listAll", {}, agA)).total).toBe(2);
    expect(data(await ess.q("b", "crm.invoices.listAll", {}, agB)).total).toBe(0);
    expect(errCode(await ess.q("b", "crm.invoices.get", { id: invoiceId }, agB))).toBe("NOT_FOUND");
    expect(errCode(await ess.q("a", "crm.invoices.listAll", {}, userA))).toBe("FORBIDDEN");
    // La factura emitida no se borra
    expect((await ess.m("a", "crm.invoices.delete", { invoiceId }, agA)).status).not.toBe(200);

    const lic = await licenseMatrix(ess, "bill-invoices", {
      query: () => ess.q("a", "crm.invoices.listAll", {}, agA),
      mutation: () => ess.m("a", "crm.invoices.void", { invoiceId }, agA),
    });
    expect(lic.readOnlyQuery?.status).toBe(200);
    expect(isLicenseDenied(lic.readOnlyMutation, "bill-invoices")).toBe(true);
    expect(isLicenseDenied(lic.noneQuery, "bill-invoices")).toBe(true);
    expect((await ess.sql("a", "SELECT status FROM invoices WHERE id = ?", [invoiceId]))[0].status).not.toBe("anulada");
  });

  it("bill-payments: cobro manual de la factura y cobro pendiente confirmado; aislamiento; licencia", async () => {
    const r = await ess.m("a", "crm.invoices.confirmManualPayment", { invoiceId, paymentMethod: "transferencia" }, agA);
    expect(r.status).toBe(200);
    expect((await ess.sql("a", "SELECT status FROM invoices WHERE id = ?", [invoiceId]))[0].status).toBe("cobrada");
    expect(errCode(await ess.m("a", "crm.invoices.confirmManualPayment", { invoiceId, paymentMethod: "efectivo" }, agA))).toBe("BAD_REQUEST");

    const q = await ess.m("a", "crm.quotes.createDirect", { clientName: "Cliente Plazos", clientEmail: "plazos@cliente-a.example", title: "Plazos", items: [{ description: "S", quantity: 1, unitPrice: 50, total: 50 }], subtotal: 50, total: 50 }, agA);
    const pp = await ess.m("a", "crm.pendingPayments.create", { quoteId: data(q).quoteId, clientName: "Cliente Plazos", productName: "Plazos", amountCents: 5000, dueDate: "2030-01-15", reason: "Segundo plazo" }, agA);
    expect(pp.status).toBe(200);
    const [row] = await ess.sql("a", "SELECT id, pp_status AS status FROM pending_payments");
    expect(row.status).toBe("pending");
    expect((await ess.m("a", "crm.pendingPayments.confirm", { id: row.id, paymentMethod: "efectivo" }, agA)).status).toBe(200);
    expect((await ess.sql("a", "SELECT pp_status AS status FROM pending_payments WHERE id = ?", [row.id]))[0].status).toBe("paid");
    expect(errCode(await ess.m("b", "crm.pendingPayments.confirm", { id: row.id, paymentMethod: "efectivo" }, agB))).toBe("NOT_FOUND");

    const lic = await licenseMatrix(ess, "bill-payments", {
      query: () => ess.q("a", "crm.pendingPayments.list", {}, agA),
      mutation: () => ess.m("a", "crm.pendingPayments.cancel", { id: row.id }, agA),
    });
    expect(lic.readOnlyQuery?.status).toBe(200);
    expect(isLicenseDenied(lic.readOnlyMutation, "bill-payments")).toBe(true);
    expect(isLicenseDenied(lic.noneQuery, "bill-payments")).toBe(true);
  });

  it("bill-cash: alta de caja en empresa vacía, apertura, venta, cierre; caja contable con movimientos y cierre; aislamiento; licencia", async () => {
    expect(data(await ess.q("a", "tpv.getRegisters", undefined, agA))).toEqual([]);
    // Antes del arreglo una empresa nueva no podía crear cajas ni, por tanto, abrir sesión
    expect(errCode(await ess.m("a", "tpv.createRegister", { name: "Caja 1" }, agA))).toBe("FORBIDDEN");
    const reg = await ess.m("a", "tpv.createRegister", { name: "Caja 1" }, admA);
    expect(reg.status).toBe(200);
    const registerId = data(reg).id;
    expect(errCode(await ess.m("a", "tpv.openSession", { registerId: 999_999, openingAmount: 0 }, agA))).toBe("NOT_FOUND");
    const open = await ess.m("a", "tpv.openSession", { registerId, openingAmount: 100 }, agA);
    expect(open.status).toBe(200);
    const sessionId = data(open).id;
    const sale = await ess.m("a", "tpv.createSale", { sessionId, items: [{ productType: "experience", productId, productName: "Servicio con IVA reducido", quantity: 1, unitPrice: 110 }], payments: [{ method: "cash", amount: 110 }] }, agA);
    expect(sale.status).toBe(200);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM tpv_sales"))[0].n).toBe(1);
    const close = await ess.m("a", "tpv.closeSession", { sessionId, countedCash: 210 }, agA);
    expect(close.status).toBe(200);
    expect((await ess.sql("a", "SELECT status_cs AS status FROM cash_sessions WHERE id = ?", [sessionId]))[0].status).toBe("closed");
    expect(data(await ess.q("b", "tpv.getRegisters", undefined, agB))).toEqual([]);
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM tpv_sales"))[0].n).toBe(0);

    // Caja contable: requiere el flag sembrado al aprovisionar
    expect((await ess.m("a", "cashRegister.createAccount", { name: "Caja principal", initialBalance: 50 }, admA)).status).toBe(200);
    const [acc] = await ess.sql("a", "SELECT id FROM fin_cash_accounts");
    const today = new Date().toISOString().slice(0, 10);
    expect((await ess.m("a", "cashRegister.createMovement", { accountId: acc.id, date: today, type: "income", amount: 30, concept: "Venta mostrador" }, admA)).status).toBe(200);
    expect((await ess.m("a", "cashRegister.createClosure", { accountId: acc.id, date: today, countedAmount: 80 }, admA)).status).toBe(200);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM fin_cash_closures"))[0].n).toBe(1);
    expect(data(await ess.q("b", "cashRegister.listAccounts", undefined, admB))).toEqual([]);

    const lic = await licenseMatrix(ess, "bill-cash", {
      query: () => ess.q("a", "tpv.getRegisters", undefined, agA),
      mutation: () => ess.m("a", "tpv.openSession", { registerId, openingAmount: 0 }, agA),
    });
    expect(lic.readOnlyQuery?.status).toBe(200);
    expect(isLicenseDenied(lic.readOnlyMutation, "bill-cash")).toBe(true);
    expect(isLicenseDenied(lic.noneQuery, "bill-cash")).toBe(true);
  });

  it("bill-reports: informes de ventas con lo operado en A; B vacío; solo administración; licencia", async () => {
    const rep = await ess.q("a", "accounting.getReports", {}, admA);
    expect(rep.status).toBe(200);
    const tx = data(await ess.q("a", "accounting.getTransactions", {}, admA));
    const txB = data(await ess.q("b", "accounting.getTransactions", {}, admB));
    expect(JSON.stringify(tx).length).toBeGreaterThan(JSON.stringify(txB).length);
    // Las operaciones de A alimentan sus transacciones; B no tiene ninguna
    expect(Number((await ess.sql("a", "SELECT COUNT(*) AS n FROM transactions"))[0].n)).toBeGreaterThan(0);
    expect(Number((await ess.sql("b", "SELECT COUNT(*) AS n FROM transactions"))[0].n)).toBe(0);
    expect(errCode(await ess.q("a", "accounting.getReports", {}, agA))).toBe("FORBIDDEN");
    const ov = await ess.q("a", "accounting.getOverview", undefined, admA);
    expect(ov.status).toBe(200);

    const lic = await licenseMatrix(ess, "bill-reports", { query: () => ess.q("a", "accounting.getReports", {}, admA) });
    expect(lic.readOnlyQuery?.status).toBe(200);
    expect(isLicenseDenied(lic.noneQuery, "bill-reports")).toBe(true);
  });
});
