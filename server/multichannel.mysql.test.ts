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
