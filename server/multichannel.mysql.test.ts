/**
 * Venta multicanal con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): dos empresas nuevas desde
 * la baseline y las migraciones de empresa (incluida la 0059). Licencia multichannel (sin ella y en solo lectura), solo
 * administración, canales, publicaciones y cupo; ventas por el enlace de entrada de cada canal en paralelo sobre el
 * último cupo (experiencia), la última plaza de spa y la última habitación: nunca se sobrevende; idempotencia por la
 * referencia del canal; cancelación (devuelve cupo y plaza una sola vez); informe CSV; conciliación y liquidación; y
 * aislamiento entre empresas (el enlace de una no sirve en la otra). Datos sintéticos (.example); sin red.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "multichannel";
const day = (n: number) => {
  const d = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date())}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe.skipIf(!URL_)("Venta multicanal · canales, cupo, ventas sin sobreventa, conciliación (aplicación real, dos empresas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let agA: string;
  let adB: string;
  let channelId = 0;
  let token = "";
  let expId = 0;
  let expSlotId = 0;
  let spaId = 0;
  let spaSlotId = 0;
  let roomId = 0;
  const D = day(10);

  const m = (proc: string, input: unknown, cookie = adA, co: "a" | "b" = "a") => ess.m(co, `multichannel.${proc}`, input, cookie);
  const q = (proc: string, input?: unknown, cookie = adA, co: "a" | "b" = "a") => ess.q(co, `multichannel.${proc}`, input, cookie);
  const ok = async (p: Promise<{ status: number; json: any; text: string }>) => {
    const r = await p;
    if (r.status !== 200) throw new Error(`${r.status}: ${r.text.slice(0, 400)}`);
    return data(r);
  };
  const post = (body: unknown, co: "a" | "b" = "a", t = token) => ess.call(co, "POST", `/canal/${t}/ventas`, { body });
  const sale = (ref: string, code: string, extra: Record<string, unknown> = {}) => ({ ref, code, date: D, units: 1, amount: 50, customer: { name: "QA Cliente", email: `qa+${ref.toLowerCase()}@cliente.example` }, ...extra });
  const statuses = (rs: Array<{ json: any }>) => rs.map((r) => r.json?.results?.[0]?.status).sort();

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "multicanal");
    adA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    adB = await ess.login("b", "admin");
    // Catálogo sintético de la empresa A: experiencia con franja de 50 plazas, spa con franja de 2 y 1 habitación
    expId = (await ess.sql("a", "INSERT INTO experiences (slug, title, categoryId, locationId, basePrice, isActive) VALUES ('qa-mc-kayak', 'QA Kayak', 1, 1, 25.00, 1)") as any).insertId;
    expSlotId = (await ess.sql("a", "INSERT INTO product_time_slots (product_id, label, start_time, capacity, active) VALUES (?, 'Mañana', '10:00', 50, 1)", [expId]) as any).insertId;
    spaId = (await ess.sql("a", "INSERT INTO spa_treatments (slug, name, price, isActive) VALUES ('qa-mc-masaje', 'QA Masaje', 40.00, 1)") as any).insertId;
    spaSlotId = (await ess.sql("a", "INSERT INTO spa_slots (treatmentId, date, startTime, endTime, capacity, bookedCount, status) VALUES (?, ?, '11:00', '12:00', 2, 0, 'disponible')", [spaId, D]) as any).insertId;
    roomId = (await ess.sql("a", "INSERT INTO room_types (slug, name, totalUnits, basePrice, isActive) VALUES ('qa-mc-suite', 'QA Suite', 1, 90.00, 1)") as any).insertId;
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("sin la capacidad multichannel no responde (403 de licencia) y el enlace no está disponible", async () => {
    expect(isLicenseDenied(await q("channels"), CAP)).toBe(true);
    expect(isLicenseDenied(await m("upsertChannel", { name: "QA", kind: "ota", provider: "generic", commissionPct: 10, commissionFixedCents: 0 }), CAP)).toBe(true);
    expect((await post({ ref: "x" }, "a", "a".repeat(43))).status).toBe(503);
    await ess.setCapability("a", CAP, "active");
    await ess.setCapability("b", CAP, "active");
  });

  it("solo la administración", async () => {
    expect(errCode(await q("channels", undefined, agA))).toBe("FORBIDDEN");
  });

  it("canal, publicaciones y cupo", async () => {
    const c = await ok(m("upsertChannel", { name: "QA GetYourGuide", kind: "ota", provider: "getyourguide", commissionPct: 20, commissionFixedCents: 50 }));
    channelId = c.id;
    expect(errCode(await m("upsertChannel", { name: "QA GetYourGuide", kind: "ota", provider: "generic", commissionPct: 5, commissionFixedCents: 0 }))).toBe("CONFLICT");
    const link = await ok(m("rotateInboundToken", { id: channelId }));
    token = link.token;
    expect(link.path).toBe(`/canal/${token}/ventas`);
    // El token no se guarda en claro
    const [row] = await ess.sql("a", "SELECT inbound_token_hash FROM mc_channels WHERE id = ?", [channelId]);
    expect(row.inbound_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.inbound_token_hash).not.toContain(token);

    const kayak = await ok(m("upsertListing", { channelId, externalCode: "KAYAK", targetKind: "experience", targetId: expId, timeSlotId: expSlotId, unitPriceCents: 3000 }));
    const masaje = await ok(m("upsertListing", { channelId, externalCode: "MASAJE", targetKind: "spa", targetId: spaId }));
    const suite = await ok(m("upsertListing", { channelId, externalCode: "SUITE", targetKind: "hotel", targetId: roomId }));
    expect(errCode(await m("upsertListing", { channelId, externalCode: "KAYAK", targetKind: "experience", targetId: expId }))).toBe("CONFLICT");
    expect(errCode(await m("upsertListing", { channelId, externalCode: "OTRO", targetKind: "experience", targetId: 999999 }))).toBe("BAD_REQUEST");
    expect(await ok(m("setAllocations", { listingId: kayak.id, from: D, to: D, quota: 3 }))).toEqual({ updated: 1, skipped: [] });
    await ok(m("setAllocations", { listingId: masaje.id, from: D, to: D, quota: 5 }));
    await ok(m("setAllocations", { listingId: suite.id, from: D, to: day(11), quota: 2 }));
    const allocs = await ok(q("allocations", { channelId, from: D, to: day(11) }));
    expect(allocs.find((a: any) => a.listingId === kayak.id)).toMatchObject({ quota: 3, sold: 0, coreFree: 50, sellable: 3 });
    expect(allocs.find((a: any) => a.listingId === masaje.id)).toMatchObject({ quota: 5, coreFree: 2, sellable: 2 });
  });

  it("experiencia: seis ventas a la vez sobre un cupo de 3 → exactamente 3 reservas, ninguna sobreventa", async () => {
    const rs = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => post(sale(`K-${i}`, "KAYAK"))));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(statuses(rs)).toEqual(["registrada", "registrada", "registrada", "sin_cupo", "sin_cupo", "sin_cupo"]);
    const [a] = await ess.sql("a", "SELECT sold_units FROM mc_allocations a JOIN mc_listings l ON l.id = a.listing_id WHERE l.external_code = 'KAYAK'");
    expect(Number(a.sold_units)).toBe(3);
    const res = await ess.sql("a", "SELECT status, channel, origin_source, platform_name, amount_total, selected_time_slot_id FROM reservations WHERE product_id = ? AND origin_source = 'multicanal'", [expId]);
    expect(res).toHaveLength(3);
    expect(res[0]).toMatchObject({ status: "paid", channel: "API", origin_source: "multicanal", platform_name: "QA GetYourGuide", amount_total: 5000, selected_time_slot_id: expSlotId });
    // Comisión 20 % + 0,50 €
    const [s] = await ess.sql("a", "SELECT gross_cents, commission_cents, net_cents FROM mc_sales WHERE external_ref = (SELECT MIN(external_ref) FROM mc_sales WHERE status = 'registrada')");
    expect(s).toMatchObject({ gross_cents: 5000, commission_cents: 1050, net_cents: 3950 });
  });

  it("idempotencia: repetir una venta registrada no crea otra reserva", async () => {
    const [first] = await ess.sql("a", "SELECT external_ref FROM mc_sales WHERE status = 'registrada' ORDER BY id LIMIT 1");
    const again = await post({ sales: [sale(first.external_ref, "KAYAK"), sale(first.external_ref, "KAYAK")] });
    expect(again.json.results.map((r: any) => [r.status, r.duplicate])).toEqual([["registrada", true], ["registrada", true]]);
    expect((await ess.sql("a", "SELECT id FROM reservations WHERE product_id = ? AND origin_source = 'multicanal'", [expId])).length).toBe(3);
  });

  it("spa: cuatro ventas a la vez sobre 2 plazas → 2 reservas con la plaza retenida y confirmada", async () => {
    const rs = await Promise.all([1, 2, 3, 4].map((i) => post(sale(`S-${i}`, "MASAJE", { time: "11:00" }))));
    expect(statuses(rs)).toEqual(["registrada", "registrada", "sin_plaza", "sin_plaza"]);
    const [slot] = await ess.sql("a", "SELECT bookedCount FROM spa_slots WHERE id = ?", [spaSlotId]);
    expect(Number(slot.bookedCount)).toBe(2);
    const held = await ess.sql("a", "SELECT hold_status, inventory_kind FROM reservations WHERE inventory_ref_id = ? AND inventory_kind = 'spa_slot'", [spaSlotId]);
    expect(held.map((h: any) => h.hold_status)).toEqual(["confirmada", "confirmada"]);
  });

  it("hotel: dos ventas a la vez de la única habitación (2 noches) → 1 reserva", async () => {
    const rs = await Promise.all([1, 2].map((i) => post(sale(`H-${i}`, "SUITE", { endDate: day(12) }))));
    expect(statuses(rs)).toEqual(["registrada", "sin_plaza"]);
    const nights = await ess.sql("a", "SELECT a.day, a.sold_units FROM mc_allocations a JOIN mc_listings l ON l.id = a.listing_id WHERE l.external_code = 'SUITE' ORDER BY a.day");
    expect(nights.map((n: any) => Number(n.sold_units))).toEqual([1, 1]);
  });

  it("cancelación: devuelve el cupo y la plaza una sola vez; una venta posterior con la misma referencia no reserva", async () => {
    const r1 = await post({ ref: "S-1", event: "cancelacion" });
    const r2 = await post({ ref: "S-2", event: "cancelacion" });
    const regs = [r1, r2].map((r) => r.json.results[0]);
    // Una de S-1/S-2 estaba registrada y la otra no (según el orden de llegada): ambas quedan canceladas
    expect(regs.every((x: any) => x.status === "cancelada")).toBe(true);
    let [slot] = await ess.sql("a", "SELECT bookedCount FROM spa_slots WHERE id = ?", [spaSlotId]);
    const registeredLeft = (await ess.sql("a", "SELECT id FROM mc_sales WHERE external_ref LIKE 'S-%' AND status = 'registrada'")).length;
    expect(Number(slot.bookedCount)).toBe(registeredLeft);
    // Repetir la cancelación no mueve nada
    expect((await post({ ref: "S-1", event: "cancelacion" })).json.results[0]).toMatchObject({ status: "cancelada", duplicate: true });
    [slot] = await ess.sql("a", "SELECT bookedCount FROM spa_slots WHERE id = ?", [spaSlotId]);
    expect(Number(slot.bookedCount)).toBe(registeredLeft);
    const [res] = await ess.sql("a", "SELECT r.status, r.status_reservation FROM reservations r JOIN mc_sales s ON s.reservation_id = r.id WHERE s.external_ref = 'S-1'");
    if (res) expect(res).toMatchObject({ status: "cancelled", status_reservation: "ANULADA" });
    // Una venta tardía con la referencia cancelada no reserva
    expect((await post(sale("S-1", "MASAJE", { time: "11:00" }))).json.results[0]).toMatchObject({ status: "cancelada", duplicate: true });
    // Cancelación antes de la venta
    expect((await post({ ref: "NUEVA-1", event: "cancelacion" })).json.results[0]).toMatchObject({ status: "cancelada", duplicate: false });
    expect((await post(sale("NUEVA-1", "KAYAK"))).json.results[0]).toMatchObject({ status: "cancelada", duplicate: true });
  });

  it("reintento: una venta sin cupo entra tras ampliar el cupo", async () => {
    const [listing] = await ess.sql("a", "SELECT id FROM mc_listings WHERE external_code = 'KAYAK'");
    await ok(m("setAllocations", { listingId: listing.id, from: D, to: D, quota: 4 }));
    // Bajar por debajo de lo vendido no se aplica
    expect((await ok(m("setAllocations", { listingId: listing.id, from: D, to: D, quota: 1 }))).skipped).toEqual([{ day: D, sold: 3 }]);
    const [pending] = await ess.sql("a", "SELECT id FROM mc_sales WHERE status = 'sin_cupo' ORDER BY id LIMIT 1");
    expect(await ok(m("retrySale", { id: pending.id }))).toMatchObject({ status: "registrada", duplicate: false });
    // Ya registrada: no se reintenta
    expect(errCode(await m("retrySale", { id: pending.id }))).toBe("BAD_REQUEST");
  });

  it("informe CSV: registra, ignora lo repetido y explica las filas que no encajan", async () => {
    await ok(m("setAllocations", { listingId: (await ess.sql("a", "SELECT id FROM mc_listings WHERE external_code = 'KAYAK'"))[0].id, from: day(20), to: day(20), quota: 10 }));
    const csv = `Booking reference,Product code,Travel date,Quantity,Total price,Lead traveler\nCSV-1,KAYAK,${day(20)},2,"60,00",Ana QA\nCSV-2,DESCONOCIDO,${day(20)},1,30,Luis QA\nCSV-3,KAYAK,no-es-fecha,1,30,Eva QA\n`;
    const r = await ok(m("importCsv", { channelId, fileName: "gyg.csv", text: csv }));
    expect(r).toMatchObject({ rows: 3, registered: 1, duplicates: 0, rejected: 2 });
    expect(r.problems.map((p: any) => p.line)).toEqual([3, 4]);
    expect(await ok(m("importCsv", { channelId, fileName: "gyg.csv", text: csv }))).toMatchObject({ registered: 0, duplicates: 1 });
    const list = await ok(q("sales", { channelId, status: "pendientes" }));
    expect(list.items.some((s: any) => s.externalRef === "CSV-2" && s.status === "rechazada")).toBe(true);
  });

  it("conciliación y liquidación del canal", async () => {
    const rec = await ok(q("reconciliation", { channelId, from: D, to: day(30) }));
    const t = rec.totals.find((x: any) => x.channelId === channelId);
    const registered = await ess.sql("a", "SELECT net_cents FROM mc_sales WHERE channel_id = ? AND status = 'registrada'", [channelId]);
    expect(t.registered).toBe(registered.length);
    expect(t.netCents).toBe(registered.reduce((a: number, s: any) => a + Number(s.net_cents), 0));
    // Una reserva anulada en el Core aparece como desajuste
    const [one] = await ess.sql("a", "SELECT reservation_id FROM mc_sales WHERE channel_id = ? AND status = 'registrada' ORDER BY id LIMIT 1", [channelId]);
    await ess.sql("a", "UPDATE reservations SET status = 'cancelled', status_reservation = 'ANULADA' WHERE id = ?", [one.reservation_id]);
    expect((await ok(q("reconciliation", { channelId, from: D, to: day(30) }))).mismatches.some((s: any) => s.reservationId === Number(one.reservation_id))).toBe(true);
    const st = await ok(m("createSettlement", { channelId, from: D, to: day(30), reference: "QA-PAGO-1", receivedCents: t.netCents - 100 }));
    expect(st).toMatchObject({ salesCount: registered.length, expectedNetCents: t.netCents, differenceCents: -100 });
    expect(errCode(await m("createSettlement", { channelId, from: D, to: day(30) }))).toBe("BAD_REQUEST");
    const exported = await ok(q("exportSales", { channelId }));
    expect(exported.csv.split("\r\n")[0]).toMatch(/^Canal;Referencia;Producto;Fecha/);
  });

  it("reintento con los datos originales: noches, importe, comisión, cliente y producto", async () => {
    const loftId = (await ess.sql("a", "INSERT INTO room_types (slug, name, totalUnits, basePrice, isActive) VALUES ('qa-mc-loft', 'QA Loft', 1, 70.00, 1)") as any).insertId;
    const loft = await ok(m("upsertListing", { channelId, externalCode: "LOFT", targetKind: "hotel", targetId: loftId }));
    await ok(m("setListingActive", { id: loft.id, active: false }));
    const [d0, d3] = [day(40), day(43)];
    const body = { ref: "L-1", code: "LOFT", date: d0, endDate: d3, units: 1, amount: 450, commission: 60, customer: { name: "QA Huésped", email: "qa+loft@cliente.example", phone: "+34600000000" } };
    // Rechazada sin publicación (sin listing_id): el código del producto queda guardado
    expect((await post(body)).json.results[0]).toMatchObject({ status: "rechazada" });
    const [rej] = await ess.sql("a", "SELECT id, listing_id FROM mc_sales WHERE external_ref = 'L-1'");
    expect(rej.listing_id).toBeNull();
    await ok(m("setListingActive", { id: loft.id, active: true }));
    // Falta la tercera noche: sin cupo del canal (las 3 noches, no 1)
    await ok(m("setAllocations", { listingId: loft.id, from: d0, to: day(41), quota: 1 }));
    expect(await ok(m("retrySale", { id: rej.id }))).toMatchObject({ status: "sin_cupo" });
    await ok(m("setAllocations", { listingId: loft.id, from: d0, to: day(42), quota: 1 }));
    expect(await ok(m("retrySale", { id: rej.id }))).toMatchObject({ status: "registrada", duplicate: false });
    const [s] = await ess.sql("a", "SELECT * FROM mc_sales WHERE id = ?", [rej.id]);
    expect(s).toMatchObject({ listing_id: loft.id, service_day: d0, service_end_day: d3, gross_cents: 45000, commission_cents: 6000, net_cents: 39000, customer_name: "QA Huésped", customer_email: "qa+loft@cliente.example", customer_phone: "+34600000000" });
    const nights = await ess.sql("a", "SELECT a.day, a.sold_units FROM mc_allocations a WHERE a.listing_id = ? ORDER BY a.day", [loft.id]);
    expect(nights.map((n: any) => [n.day, Number(n.sold_units)])).toEqual([[d0, 1], [day(41), 1], [day(42), 1]]);
    const [r] = await ess.sql("a", "SELECT product_id, product_name, amount_total, amount_paid, customer_name, customer_email, status FROM reservations WHERE id = ?", [s.reservation_id]);
    expect(r).toMatchObject({ product_id: loftId, amount_total: 45000, amount_paid: 45000, customer_name: "QA Huésped", customer_email: "qa+loft@cliente.example", status: "paid" });
    expect(r.product_name).toContain("3 noches");
    // postConfirmOperation real con los datos originales: ingreso por el bruto y booking por el neto, con el cliente
    expect(await ess.sql("a", "SELECT amount, clientName, clientEmail, status, operationStatus FROM transactions WHERE reservationId_tx = ?", [s.reservation_id])).toEqual([{ amount: "450.00", clientName: "QA Huésped", clientEmail: "qa+loft@cliente.example", status: "completado", operationStatus: "confirmada" }]);
    expect(await ess.sql("a", "SELECT totalAmount, clientName, clientEmail, status FROM bookings WHERE reservationId = ?", [s.reservation_id])).toEqual([{ totalAmount: "390.00", clientName: "QA Huésped", clientEmail: "qa+loft@cliente.example", status: "confirmado" }]);
    expect(s.ops_status).toBe("hecho");
    // Idempotente: ni otro reintento ni el reenvío del canal crean otra reserva u otro ingreso
    expect(errCode(await m("retrySale", { id: rej.id }))).toBe("BAD_REQUEST");
    expect((await post(body)).json.results[0]).toMatchObject({ status: "registrada", duplicate: true });
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations WHERE product_id = ?", [loftId]))[0].n).toBe(1);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM transactions WHERE reservationId_tx = ?", [s.reservation_id]))[0].n).toBe(1);
    expect(nights.length).toBe(3);
  });

  it("cancelar desde el canal deshace lo que dejó postConfirmOperation (ingreso, operativa y booking)", async () => {
    const [listing] = await ess.sql("a", "SELECT id FROM mc_listings WHERE external_code = 'KAYAK'");
    await ok(m("setAllocations", { listingId: listing.id, from: day(25), to: day(25), quota: 10 }));
    expect((await post(sale("PC-1", "KAYAK", { date: day(25) }))).json.results[0]).toMatchObject({ status: "registrada" });
    const [s] = await ess.sql("a", "SELECT reservation_id, ops_status FROM mc_sales WHERE external_ref = 'PC-1'");
    expect(s.ops_status).toBe("hecho");
    const rid = s.reservation_id;
    // Lo que deja el postConfirmOperation real
    expect(await ess.sql("a", "SELECT type, status, operationStatus, amount FROM transactions WHERE reservationId_tx = ?", [rid])).toMatchObject([{ type: "ingreso", status: "completado", operationStatus: "confirmada", amount: "50.00" }]);
    expect(await ess.sql("a", "SELECT op_status FROM reservation_operational WHERE reservation_id = ?", [rid])).toEqual([{ op_status: "confirmado" }]);
    // Importes: ingreso por el bruto (50 €) y booking por el neto (50 − 20 % − 0,50 = 39,50 €), como en Redsys
    expect(await ess.sql("a", "SELECT status, totalAmount FROM bookings WHERE reservationId = ?", [rid])).toEqual([{ status: "confirmado", totalAmount: "39.50" }]);
    expect(await ess.sql("a", "SELECT gross_cents, commission_cents, net_cents FROM mc_sales WHERE external_ref = 'PC-1'")).toEqual([{ gross_cents: 5000, commission_cents: 1050, net_cents: 3950 }]);
    expect((await post({ ref: "PC-1", event: "cancelacion" })).json.results[0]).toMatchObject({ status: "cancelada", duplicate: false });
    expect(await ess.sql("a", "SELECT status, operationStatus FROM transactions WHERE reservationId_tx = ?", [rid])).toEqual([{ status: "reembolsado", operationStatus: "reembolsada" }]);
    expect(await ess.sql("a", "SELECT op_status FROM reservation_operational WHERE reservation_id = ?", [rid])).toEqual([{ op_status: "anulado" }]);
    expect(await ess.sql("a", "SELECT status FROM bookings WHERE reservationId = ?", [rid])).toEqual([{ status: "cancelado" }]);
    // Conciliación: sin ingresos huérfanos de ventas canceladas; repetir la cancelación no cambia nada
    expect((await ok(q("reconciliation", { channelId, from: day(20), to: day(30) }))).cancelledLeftovers).toEqual([]);
    expect((await post({ ref: "PC-1", event: "cancelacion" })).json.results[0]).toMatchObject({ status: "cancelada", duplicate: true });
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM transactions WHERE reservationId_tx = ?", [rid]))[0].n).toBe(1);
  });

  it("si postConfirmOperation falla tras registrar la venta, queda marcada, se ve en la conciliación y se reintenta una sola vez", async () => {
    const txCount = async (ref: string) => (await ess.sql("a", "SELECT COUNT(*) AS n FROM transactions t JOIN mc_sales s ON s.reservation_id = t.reservationId_tx WHERE s.external_ref = ?", [ref]))[0].n;
    await ess.sql("a", "RENAME TABLE transactions TO transactions_qa_off");
    try {
      expect((await post(sale("OPS-1", "KAYAK", { date: day(25) }))).json.results[0]).toMatchObject({ status: "registrada" });
      expect((await post(sale("OPS-2", "KAYAK", { date: day(25) }))).json.results[0]).toMatchObject({ status: "registrada" });
    } finally {
      await ess.sql("a", "RENAME TABLE transactions_qa_off TO transactions");
    }
    const failed = await ess.sql("a", "SELECT id, external_ref, ops_status, ops_error FROM mc_sales WHERE external_ref IN ('OPS-1', 'OPS-2') ORDER BY external_ref");
    expect(failed.map((f: any) => f.ops_status)).toEqual(["error", "error"]);
    expect(failed[0].ops_error).toBeTruthy();
    const rec = await ok(q("reconciliation", { channelId, from: day(20), to: day(30) }));
    expect(rec.opsFailed.map((s: any) => s.externalRef).sort()).toEqual(["OPS-1", "OPS-2"]);
    const listed = await ok(q("sales", { channelId, search: "OPS-1" }));
    expect(listed.items[0]).toMatchObject({ opsStatus: "error" });
    // El canal la reenvía: sigue siendo la misma venta (duplicada) y se completa el paso pendiente
    expect((await post(sale("OPS-1", "KAYAK", { date: day(25) }))).json.results[0]).toMatchObject({ status: "registrada", duplicate: true });
    expect(await txCount("OPS-1")).toBe(1);
    // Reintento desde el panel: idempotente
    expect(await ok(m("retryOperation", { id: failed[1].id }))).toMatchObject({ opsStatus: "hecho" });
    expect(errCode(await m("retryOperation", { id: failed[1].id }))).toBe("BAD_REQUEST");
    expect(await txCount("OPS-2")).toBe(1);
    expect(await ess.sql("a", "SELECT ops_status FROM mc_sales WHERE external_ref IN ('OPS-1', 'OPS-2')")).toEqual([{ ops_status: "hecho" }, { ops_status: "hecho" }]);
    expect((await ok(q("reconciliation", { channelId, from: day(20), to: day(30) }))).opsFailed).toEqual([]);
    // Un nuevo reenvío no crea otra transacción
    await post(sale("OPS-1", "KAYAK", { date: day(25) }));
    expect(await txCount("OPS-1")).toBe(1);
  });

  it("el token del canal también se acepta en una cabecera (la URL con token sigue valiendo)", async () => {
    const r = await ess.call("a", "POST", "/canal/ventas", { body: sale("HDR-1", "KAYAK", { date: day(25) }), headers: { "x-canal-token": token } });
    expect(r.status).toBe(200);
    expect(r.json.results[0]).toMatchObject({ status: "registrada" });
    const bearer = await ess.call("a", "POST", "/canal/ventas", { body: sale("HDR-1", "KAYAK", { date: day(25) }), headers: { authorization: `Bearer ${token}` } });
    expect(bearer.json.results[0]).toMatchObject({ status: "registrada", duplicate: true });
    expect((await ess.call("a", "GET", "/canal/disponibilidad", { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await ess.call("a", "POST", "/canal/ventas", { body: sale("HDR-2", "KAYAK"), headers: { "x-canal-token": "b".repeat(43) } })).status).toBe(404);
    expect((await ess.call("a", "POST", "/canal/ventas", { body: sale("HDR-3", "KAYAK") })).status).toBe(404);
  });

  // Llamadas directas a multichannelDb en la empresa A (mismo proceso que la aplicación) para intercalar pasos
  const direct = async () => {
    const mc = await import("./multichannelDb");
    const { withTenantDb } = await import("./_core/dbRegistry");
    const { parseInboundSale } = await import("../shared/multichannel");
    const actor = { userId: await ess.userId("a", "admin"), role: "admin" };
    const inA = <T,>(fn: () => Promise<T>) => withTenantDb(ess.ids.a, fn);
    const input = (ref: string) => {
      const p = parseInboundSale(sale(ref, "KAYAK", { date: day(25) }));
      if (!p.ok) throw new Error(p.problem);
      return p.sale;
    };
    const ops = async (ref: string) => (await ess.sql("a", "SELECT id, status, reservation_id, ops_status, ops_error, ops_claim FROM mc_sales WHERE external_ref = ?", [ref]))[0];
    const txOf = (rid: number) => ess.sql("a", "SELECT status, operationStatus FROM transactions WHERE reservationId_tx = ?", [rid]);
    return { mc, actor, inA, input, ops, txOf };
  };

  it("si el canal cancela mientras el paso está pendiente y el paso falla, se deshace lo creado: ningún huérfano", async () => {
    const { mc, actor, inA, input, ops, txOf } = await direct();
    const out = await inA(() => mc.recordSale(channelId, input("CXL-1"), actor, async (p) => {
      // El canal cancela con el paso en curso; luego el paso crea booking, ingreso y ficha y falla
      expect((await post({ ref: "CXL-1", event: "cancelacion" })).json.results[0]).toMatchObject({ status: "cancelada", duplicate: false });
      await mc.defaultAfterRegister(p);
      throw new Error("fallo simulado tras crear booking, ingreso y ficha");
    }));
    expect(out.status).toBe("registrada");
    const s = await ops("CXL-1");
    expect(s).toMatchObject({ status: "cancelada", ops_status: "anulada", ops_claim: null });
    expect(await txOf(s.reservation_id)).toEqual([{ status: "reembolsado", operationStatus: "reembolsada" }]);
    expect(await ess.sql("a", "SELECT op_status FROM reservation_operational WHERE reservation_id = ?", [s.reservation_id])).toEqual([{ op_status: "anulado" }]);
    expect(await ess.sql("a", "SELECT status FROM bookings WHERE reservationId = ?", [s.reservation_id])).toEqual([{ status: "cancelado" }]);
    const rec = await ok(q("reconciliation", { channelId, from: day(20), to: day(30) }));
    expect(rec.cancelledLeftovers).toEqual([]);
    expect(rec.opsFailed).toEqual([]);
  });

  it("un reintento que tarda más que su reclamo no pisa el resultado del que lo retomó", async () => {
    const { mc, actor, inA, input, ops, txOf } = await direct();
    const first = await inA(() => mc.recordSale(channelId, input("STALE-1"), actor, async () => { throw new Error("fallo inicial"); }));
    expect((await ops("STALE-1")).ops_status).toBe("error");
    let second: any = null;
    const slow = await inA(() => mc.retryOperation(first.saleId, actor, async () => {
      // Pasan más de 10 minutos: otro reintento retoma el paso y lo completa
      await ess.sql("a", "UPDATE mc_sales SET ops_at = CURRENT_TIMESTAMP(3) - INTERVAL 11 MINUTE WHERE id = ?", [first.saleId]);
      second = await inA(() => mc.retryOperation(first.saleId, actor));
      throw new Error("el primer reintento falla tarde");
    }));
    expect(second).toMatchObject({ opsStatus: "hecho" });
    expect(slow.opsStatus).toBe("hecho");
    const s = await ops("STALE-1");
    expect(s).toMatchObject({ ops_status: "hecho", ops_error: null, ops_claim: null });
    expect(await txOf(s.reservation_id)).toEqual([{ status: "completado", operationStatus: "confirmada" }]);
  });

  it("concurrencia: dos reintentos a la vez del paso fallido → uno lo hace, el otro no hace nada; un solo ingreso", async () => {
    const { mc, actor, inA, input, ops, txOf } = await direct();
    await inA(() => mc.recordSale(channelId, input("R2-1"), actor, async () => { throw new Error("fallo inicial"); }));
    const { id, reservation_id } = await ops("R2-1");
    const rs = await Promise.all([m("retryOperation", { id }), m("retryOperation", { id })]);
    expect(rs.map((r) => (r.status === 200 ? data(r).opsStatus : errCode(r))).sort()).toEqual(["BAD_REQUEST", "hecho"]);
    expect(await txOf(reservation_id)).toHaveLength(1);
    expect(await ess.sql("a", "SELECT COUNT(*) AS n FROM bookings WHERE reservationId = ?", [reservation_id])).toEqual([{ n: 1 }]);
    expect(await ess.sql("a", "SELECT COUNT(*) AS n FROM reservation_operational WHERE reservation_id = ?", [reservation_id])).toEqual([{ n: 1 }]);
    expect((await ops("R2-1")).ops_status).toBe("hecho");
  });

  it("concurrencia: un reintento a la vez que el reenvío del canal → un solo ingreso y el paso hecho", async () => {
    const { mc, actor, inA, input, ops, txOf } = await direct();
    await inA(() => mc.recordSale(channelId, input("R3-1"), actor, async () => { throw new Error("fallo inicial"); }));
    const { id, reservation_id } = await ops("R3-1");
    const [retried, resent] = await Promise.all([m("retryOperation", { id }), post(sale("R3-1", "KAYAK", { date: day(25) }))]);
    expect(retried.status === 200 ? data(retried).opsStatus : errCode(retried)).toMatch(/^(hecho|BAD_REQUEST)$/);
    expect(resent.json.results[0]).toMatchObject({ status: "registrada", duplicate: true });
    expect(await txOf(reservation_id)).toHaveLength(1);
    expect((await ops("R3-1")).ops_status).toBe("hecho");
  });

  it("sin ficha en Operaciones (0 filas, con la tabla presente) el paso no queda hecho: se marca y se completa al reintentar", async () => {
    // La ficha no llega a crearse: un disparador rechaza su alta (la tabla existe y queda sin filas para la reserva)
    await ess.sql("a", "CREATE TRIGGER qa_mc_sin_ficha BEFORE INSERT ON reservation_operational FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'qa: sin ficha'");
    try {
      expect((await post(sale("FICHA-1", "KAYAK", { date: day(25) }))).json.results[0]).toMatchObject({ status: "registrada" });
    } finally {
      await ess.sql("a", "DROP TRIGGER IF EXISTS qa_mc_sin_ficha");
    }
    const [s] = await ess.sql("a", "SELECT id, reservation_id, ops_status, ops_error FROM mc_sales WHERE external_ref = 'FICHA-1'");
    expect(await ess.sql("a", "SELECT id FROM reservation_operational WHERE reservation_id = ?", [s.reservation_id])).toEqual([]);
    expect(s).toMatchObject({ ops_status: "error", ops_error: "Contabilidad y Operaciones sin completar: No se ha creado la ficha de la reserva en Operaciones." });
    expect(await ok(m("retryOperation", { id: s.id }))).toMatchObject({ opsStatus: "hecho", problem: null });
    expect(await ess.sql("a", "SELECT reservation_type, op_status FROM reservation_operational WHERE reservation_id = ?", [s.reservation_id])).toEqual([{ reservation_type: "activity", op_status: "confirmado" }]);
  });

  it("una ficha de otro tipo (restaurant) con el mismo id de reserva no cuenta: el paso no queda hecho", async () => {
    const { mc, actor, inA, input, ops } = await direct();
    await inA(() => mc.recordSale(channelId, input("FICHA-2"), actor, async (p) => {
      // Antes del paso ya hay una ficha de restaurante con ese id: la de actividad no se puede crear (id único)
      await ess.sql("a", "INSERT INTO reservation_operational (reservation_id, reservation_type, op_status) VALUES (?, 'restaurant', 'confirmado')", [p.reservationId]);
      await mc.defaultAfterRegister(p);
    }));
    const s = await ops("FICHA-2");
    expect(s).toMatchObject({ status: "registrada", ops_status: "error", ops_error: "Contabilidad y Operaciones sin completar: No se ha creado la ficha de la reserva en Operaciones." });
    expect(await ess.sql("a", "SELECT reservation_type FROM reservation_operational WHERE reservation_id = ?", [s.reservation_id])).toEqual([{ reservation_type: "restaurant" }]);
    expect((await ok(q("reconciliation", { channelId, from: day(20), to: day(30) }))).opsFailed.map((x: any) => x.externalRef)).toContain("FICHA-2");
  });

  it("si falla el cierre de una venta cancelada, se ve en la conciliación y retryOperation solo deshace lo creado, una vez", async () => {
    const { mc, actor, inA, input, ops, txOf } = await direct();
    await inA(() => mc.recordSale(channelId, input("CXL-2"), actor, async (p) => {
      // El canal cancela; después el paso crea booking, ingreso y ficha, y el cierre no puede anular el booking
      expect((await post({ ref: "CXL-2", event: "cancelacion" })).json.results[0]).toMatchObject({ status: "cancelada" });
      await mc.defaultAfterRegister(p);
      await ess.sql("a", "CREATE TRIGGER qa_mc_sin_anular BEFORE UPDATE ON bookings FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'qa: booking bloqueado'");
    }));
    await ess.sql("a", "DROP TRIGGER IF EXISTS qa_mc_sin_anular");
    const s = await ops("CXL-2");
    expect(s).toMatchObject({ status: "cancelada", ops_status: "error", ops_claim: null });
    expect(s.ops_error).toBe("No se ha podido cerrar el paso de contabilidad y Operaciones: qa: booking bloqueado");
    // Todo lo creado sigue vigente (el cierre se deshizo entero) y la conciliación lo muestra
    expect(await txOf(s.reservation_id)).toEqual([{ status: "completado", operationStatus: "confirmada" }]);
    let rec = await ok(q("reconciliation", { channelId, from: day(20), to: day(30) }));
    expect(rec.opsFailed.map((x: any) => x.externalRef)).toContain("CXL-2");
    expect(rec.cancelledLeftovers.find((x: any) => x.externalRef === "CXL-2")).toMatchObject({ leftovers: ["ingreso", "booking", "ficha de Operaciones"] });
    // Reparación: solo se deshace (no se crea nada nuevo) y queda «anulada»
    expect(await ok(m("retryOperation", { id: s.id }))).toMatchObject({ opsStatus: "anulada", problem: null });
    expect(await txOf(s.reservation_id)).toEqual([{ status: "reembolsado", operationStatus: "reembolsada" }]);
    expect(await ess.sql("a", "SELECT status FROM bookings WHERE reservationId = ?", [s.reservation_id])).toEqual([{ status: "cancelado" }]);
    expect(await ess.sql("a", "SELECT op_status FROM reservation_operational WHERE reservation_id = ?", [s.reservation_id])).toEqual([{ op_status: "anulado" }]);
    rec = await ok(q("reconciliation", { channelId, from: day(20), to: day(30) }));
    expect(rec.opsFailed.map((x: any) => x.externalRef)).not.toContain("CXL-2");
    expect(rec.cancelledLeftovers).toEqual([]);
    // Idempotente: no hay nada más que reparar
    expect(errCode(await m("retryOperation", { id: s.id }))).toBe("BAD_REQUEST");
    expect(await txOf(s.reservation_id)).toHaveLength(1);
  });

  it("aislamiento: la empresa B no ve los canales de A y el enlace de A no sirve en B", async () => {
    expect(await ok(q("channels", undefined, adB, "b"))).toEqual([]);
    expect((await post(sale("B-1", "KAYAK"), "b")).status).toBe(404);
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM mc_sales"))[0].n).toBe(0);
    // Un token mal formado o revocado: 404 sin detalles
    expect((await post(sale("X-1", "KAYAK"), "a", "corto")).status).toBe(404);
    await ok(m("revokeInboundToken", { id: channelId }));
    expect((await post(sale("X-2", "KAYAK"))).status).toBe(404);
  });

  it("en solo lectura: consultas sí, operaciones no", async () => {
    await ess.setCapability("a", CAP, "read_only");
    expect((await q("channels")).status).toBe(200);
    expect(isLicenseDenied(await m("setChannelActive", { id: channelId, active: false }), CAP)).toBe(true);
  });
});
