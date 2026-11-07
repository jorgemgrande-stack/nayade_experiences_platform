/**
 * Travel Net con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): dos empresas nuevas desde la
 * baseline y las migraciones de empresa (incluida la 0040).
 *  - Sin la capacidad travel-net no se llega; con ella, proveedores del Core (`suppliers`) con perfil turístico.
 *  - Márgenes proveedor → global aplicados a los servicios (neto, comisión y propio).
 *  - Presupuesto del Core (lead + quote con líneas REAV, sin coste ni margen) que se rehace mientras no se acepta.
 *  - Conversión en reserva del Core (dos peticiones a la vez: una reserva) con una operación por servicio de proveedor.
 *  - Operaciones con el adaptador manual, consolidación con localizador, bono en PDF y aislamiento entre empresas.
 * Datos sintéticos (dominios .example).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "travel-net";

describe.skipIf(!URL_)("Travel Net (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let agA: string;
  let adB: string;
  let hotelSupplier = 0;
  let activitySupplier = 0;
  let fileId = 0;

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "travelnet");
    adA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    adB = await ess.login("b", "admin");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("sin Travel Net no se llega a los expedientes", async () => {
    expect(isLicenseDenied(await ess.q("a", "travel.listFiles", undefined, agA), CAP)).toBe(true);
  });

  it("proveedores del Core con perfil turístico y márgenes (solo administración)", async () => {
    await ess.setCapability("a", CAP, "active");
    await ess.setCapability("b", CAP, "active");
    hotelSupplier = data(await ess.m("a", "travel.createSupplier", { fiscalName: "Hoteles Ejemplo SL", commercialName: "Hoteles Ejemplo", email: "reservas@hoteles.example", serviceKinds: ["alojamiento"] }, adA)).id;
    activitySupplier = data(await ess.m("a", "travel.createSupplier", { fiscalName: "Aventura Ejemplo SL", serviceKinds: ["actividad"] }, adA)).id;
    expect(errCode(await ess.m("a", "travel.createSupplier", { fiscalName: "No puede SL" }, agA))).toBe("FORBIDDEN");
    // Son proveedores del Core: la misma tabla `suppliers`
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM suppliers"))[0].n).toBe(2);
    await ess.m("a", "travel.addSupplierContact", { supplierId: hotelSupplier, name: "Recepción Reservas", phone: "+34 600 000 000", isPrimary: true }, adA);
    const list = data(await ess.q("a", "travel.listSuppliers", undefined, agA));
    expect(list.find((s: any) => s.id === hotelSupplier)).toMatchObject({ name: "Hoteles Ejemplo", isTravel: true, connectionMode: "manual", serviceKinds: ["alojamiento"], contacts: 1 });

    expect((await ess.m("a", "travel.saveMarginRule", { scope: "global", markupBp: 1500, commissionBp: 1000 }, adA)).status).toBe(200);
    expect((await ess.m("a", "travel.saveMarginRule", { scope: "proveedor", scopeKey: String(hotelSupplier), markupBp: 3000, commissionBp: 0 }, adA)).status).toBe(200);
    expect(errCode(await ess.m("a", "travel.saveMarginRule", { scope: "global", markupBp: 99999, commissionBp: 0 }, adA))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "travel.saveMarginRule", { scope: "global", markupBp: 1000, commissionBp: 0 }, agA))).toBe("FORBIDDEN");
    // La otra empresa no ve nada de A
    expect(data(await ess.q("b", "travel.listSuppliers", undefined, adB))).toEqual([]);
  });

  it("expediente con servicios de varios proveedores y presupuesto del Core", async () => {
    fileId = data(await ess.m("a", "travel.createFile", {
      title: "Escapada a la montaña", clientName: "Cliente Viajero", clientEmail: "viajero@cliente-a.example", startDate: "2026-12-10", endDate: "2026-12-13", adults: 2, children: 1,
    }, agA)).id;
    const add = (service: Record<string, unknown>) => ess.m("a", "travel.addService", { fileId, service: { quantity: 1, ...service } }, agA);
    expect((await add({ kind: "alojamiento", source: "proveedor", supplierId: hotelSupplier, title: "Hotel 3 noches", serviceDate: "2026-12-10", endDate: "2026-12-13", pricingMode: "neto", amountCents: 30000 })).status).toBe(200);
    expect((await add({ kind: "actividad", source: "proveedor", supplierId: activitySupplier, title: "Ruta guiada", serviceDate: "2026-12-11", pricingMode: "comision", amountCents: 12000, quantity: 3 })).status).toBe(200);
    expect((await add({ kind: "traslado", source: "propio", supplierId: null, title: "Traslado propio", pricingMode: "manual", amountCents: 5000, netCents: 2000 })).status).toBe(200);
    expect(errCode(await add({ kind: "otro", source: "proveedor", supplierId: null, title: "Sin proveedor", pricingMode: "neto", amountCents: 100 }))).toBe("BAD_REQUEST");

    const f = data(await ess.q("a", "travel.getFile", { id: fileId }, agA));
    expect(f.file.fileNumber).toMatch(/^EXP-\d{4}-\d{6}$/);
    expect(f.services.map((s: any) => [s.title, s.netCents, s.sellingCents, s.ruleSource])).toEqual([
      ["Hotel 3 noches", 30000, 39000, "proveedor"],
      ["Ruta guiada", 10800, 12000, "global"],
      ["Traslado propio", 2000, 5000, "manual"],
    ]);
    expect(f.totals).toMatchObject({ netCents: 42800, sellingCents: 56000, marginCents: 13200 });

    const q = data(await ess.m("a", "travel.generateQuote", { id: fileId }, agA));
    expect(q.updated).toBe(false);
    const [quote] = await ess.sql("a", "SELECT quoteNumber, status, total, items, leadId FROM quotes WHERE id = ?", [q.quoteId]);
    expect(quote).toMatchObject({ status: "borrador", total: "560.00" });
    const items = typeof quote.items === "string" ? JSON.parse(quote.items) : quote.items;
    expect(items.map((i: any) => [i.description, i.total, i.fiscalRegime])).toEqual([
      ["Alojamiento: Hotel 3 noches", 390, "reav"],
      ["Actividad: Ruta guiada", 120, "reav"],
      ["Traslado: Traslado propio", 50, "reav"],
    ]);
    expect(JSON.stringify(items)).not.toMatch(/108|428|netCents/);
    const [lead] = await ess.sql("a", "SELECT email, source FROM leads WHERE id = ?", [quote.leadId]);
    expect(lead).toMatchObject({ email: "viajero@cliente-a.example", source: "travel_net" });

    // Sin enviar no se convierte; enviado, se rehace con los cambios
    expect(errCode(await ess.m("a", "travel.convertToReservation", { id: fileId }, agA))).toBe("BAD_REQUEST");
    await ess.sql("a", "UPDATE quotes SET status = 'enviado' WHERE id = ?", [q.quoteId]);
    const traslado = f.services.find((s: any) => s.title === "Traslado propio");
    await ess.m("a", "travel.updateService", { fileId, serviceId: traslado.id, service: { kind: "traslado", source: "propio", supplierId: null, title: "Traslado propio", pricingMode: "manual", amountCents: 6000, netCents: 2000, quantity: 1 } }, agA);
    expect(data(await ess.m("a", "travel.generateQuote", { id: fileId }, agA))).toMatchObject({ quoteId: q.quoteId, updated: true });
    expect((await ess.sql("a", "SELECT total FROM quotes WHERE id = ?", [q.quoteId]))[0].total).toBe("570.00");
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM quotes"))[0].n).toBe(1);
  });

  it("conversión en reserva del Core: una sola aunque se pida dos veces, con operaciones por proveedor", async () => {
    const both = await Promise.all([1, 2].map(() => ess.m("a", "travel.convertToReservation", { id: fileId }, agA)));
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    const reservations = await ess.sql("a", "SELECT id, quote_id, amount_total FROM reservations");
    expect(reservations).toHaveLength(1);
    expect(reservations[0].amount_total).toBe(57000);
    const f = data(await ess.q("a", "travel.getFile", { id: fileId }, agA));
    expect(f.file).toMatchObject({ status: "reservado", reservationId: reservations[0].id });
    expect(f.services.filter((s: any) => s.operation).map((s: any) => [s.title, s.operation.status])).toEqual([
      ["Hotel 3 noches", "pending_submission"],
      ["Ruta guiada", "pending_submission"],
    ]);
    // Reservado: los servicios ya no cambian
    expect(errCode(await ess.m("a", "travel.removeService", { fileId, serviceId: f.services[0].id }, agA))).toBe("BAD_REQUEST");
  });

  it("operaciones con el adaptador manual, consolidación, bono y aislamiento", async () => {
    const f = data(await ess.q("a", "travel.getFile", { id: fileId }, agA));
    const hotel = f.services.find((s: any) => s.title === "Hotel 3 noches");
    const ruta = f.services.find((s: any) => s.title === "Ruta guiada");
    const op = hotel.operation.id;
    expect(data(await ess.m("a", "travel.submitOperation", { id: op }, agA))).toMatchObject({ status: "submitted" });
    expect(errCode(await ess.m("a", "travel.submitOperation", { id: op }, agA))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "travel.voucher", { fileId, serviceId: hotel.id }, agA))).toBe("BAD_REQUEST");
    expect((await ess.m("a", "travel.transitionOperation", { id: op, to: "provider_confirmed", reason: "Confirmado por teléfono" }, agA)).status).toBe(200);
    const pdf = data(await ess.m("a", "travel.voucher", { fileId, serviceId: hotel.id }, agA));
    expect(Buffer.from(pdf.base64, "base64").subarray(0, 4).toString()).toBe("%PDF");
    expect(errCode(await ess.m("a", "travel.transitionOperation", { id: op, to: "consolidated" }, agA))).toBe("BAD_REQUEST");
    expect((await ess.m("a", "travel.transitionOperation", { id: op, to: "consolidated", locator: "LOC-123" }, agA)).status).toBe(200);
    const detail = data(await ess.q("a", "travel.getOperation", { id: op }, agA));
    expect(detail.operation).toMatchObject({ status: "consolidated", providerLocator: "LOC-123" });
    expect(detail.operation.slaDeadlineAt).toBeGreaterThan(Date.now());
    expect(detail.history.map((h: any) => h.toStatus)).toEqual(["consolidated", "provider_confirmed", "submitted"]);
    expect(errCode(await ess.m("a", "travel.voucher", { fileId, serviceId: ruta.id }, agA))).toBe("BAD_REQUEST");
    // Servicio propio: bono sin operación
    const own = f.services.find((s: any) => s.source === "propio");
    expect((await ess.m("a", "travel.voucher", { fileId, serviceId: own.id }, agA)).status).toBe(200);
    expect(data(await ess.q("a", "travel.listOperations", { bucket: "consolidadas" }, agA)).map((o: any) => o.id)).toEqual([op]);
    // La otra empresa no ve el expediente
    expect(errCode(await ess.q("b", "travel.getFile", { id: fileId }, adB))).toBe("NOT_FOUND");
    expect(data(await ess.q("b", "travel.listFiles", undefined, adB))).toEqual([]);
  });
});
