/**
 * Hotel Net · canales iCal con la aplicación REAL sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): dos empresas nuevas
 * desde la baseline y las migraciones de empresa (incluida la 0050).
 *  - Sin Hotel Net no se llega al panel; la ruta pública responde «no disponible».
 *  - Exportación: enlace por tipología y canal, VCALENDAR con las noches sin unidades libres (reservas propias), sin
 *    datos del huésped; rotar y revocar; un token de una empresa no vale en otra.
 *  - Importación: URL no https rechazada; URL sin servidor deja el error a la vista y enciende la sincronización
 *    automática; los bloqueos importados descuentan disponibilidad pública y se reexportan a los OTROS canales, no al
 *    suyo; en pausa dejan de contar; archivada, se cancelan. Nunca tocan reservas ni `room_blocks`.
 * Datos sintéticos (dominios .example y .invalid). Ninguna descarga real.
 */
import crypto from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";
import { addDaysIso, todayInTimeZone } from "./hotelPms";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "hotel-net";
const compact = (iso: string) => iso.replace(/-/g, "");

describe.skipIf(!URL_)("Hotel Net · canales iCal (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let adB: string;
  const today = todayInTimeZone();
  const d = (n: number) => addDaysIso(today, n);
  let typeId = 0;
  const pathOf = (url: string) => new URL(url).pathname;
  const panel = async () => data(await ess.q("a", "hotel.adminIcalPanel", undefined, adA));
  const exportOf = async (channel: string) => (await panel()).exports.find((e: any) => e.targetKind === "room_type" && e.targetId === typeId && e.channel === channel);

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "hotelical");
    for (const co of ["a", "b"] as const) {
      await ess.sql(co, "INSERT INTO feature_flags (`key`, name, enabled) VALUES ('hotel_module_enabled', 'Hotel', 1) ON DUPLICATE KEY UPDATE enabled = 1");
      await ess.grantModule(co, "hotel");
    }
    adA = await ess.login("a", "admin");
    adB = await ess.login("b", "admin");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("la migración 0050 crea sus tablas; sin Hotel Net no hay panel", async () => {
    const names = (await ess.sql("a", "SHOW TABLES LIKE 'hotel_ical_%'")).map((r) => Object.values(r)[0]);
    expect(names.sort()).toEqual(["hotel_ical_blocks", "hotel_ical_exports", "hotel_ical_feeds", "hotel_ical_settings"]);
    expect(isLicenseDenied(await ess.q("a", "hotel.adminIcalPanel", undefined, adA), CAP)).toBe(true);
    await ess.setCapability("a", CAP, "active");
    await ess.setCapability("b", CAP, "active");
    typeId = data(await ess.m("a", "hotel.adminCreateRoomType", { slug: "suite-ical", name: "Suite iCal", basePrice: "100", totalUnits: 1, maxAdults: 2 }, adA)).id;
    const p = await panel();
    expect(p).toMatchObject({ autoSync: false, exports: [], feeds: [], blocks: [] });
    expect(p.types.map((t: any) => t.id)).toContain(typeId);
  });

  it("exportación: enlace por canal con las noches vendidas, sin datos del huésped; otra empresa no lo abre", async () => {
    const issued = data(await ess.m("a", "hotel.adminIcalIssueExport", { targetKind: "room_type", targetId: typeId, channel: "booking" }, adA));
    expect(issued.url).toMatch(/\/ical\/[A-Za-z0-9_-]{43}\.ics$/);
    const empty = await ess.call("a", "GET", pathOf(issued.url));
    expect(empty.status).toBe(200);
    expect(empty.text).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(empty.text).not.toContain("BEGIN:VEVENT");

    const res = await ess.m("a", "hotel.adminCreateReservation", { roomTypeId: typeId, checkIn: d(10), checkOut: d(12), adults: 2, customerName: "Huésped Secreto", customerEmail: "secreto@cliente-a.example" }, adA);
    expect(res.status).toBe(200);
    const cal = await ess.call("a", "GET", pathOf(issued.url));
    expect(cal.text).toContain(`DTSTART;VALUE=DATE:${compact(d(10))}\r\nDTEND;VALUE=DATE:${compact(d(12))}`);
    expect(cal.text).toContain("SUMMARY:No disponible");
    expect(cal.text).not.toMatch(/Secreto|cliente-a\.example/);
    expect((await exportOf("booking")).fetchCount).toBe(2);

    // El token de la empresa a no vale en la b (misma respuesta que uno inexistente)
    const other = await ess.call("b", "GET", pathOf(issued.url));
    const fake = await ess.call("a", "GET", `/ical/${crypto.randomBytes(32).toString("base64url")}.ics`);
    expect(other.status).toBe(404);
    expect(fake.status).toBe(404);
    expect(other.text.replace(/<footer>.*<\/footer>/, "")).toBe(fake.text.replace(/<footer>.*<\/footer>/, ""));
    expect(data(await ess.q("b", "hotel.adminIcalPanel", undefined, adB)).exports).toEqual([]);

    // Rotar: el anterior deja de valer; revocar: ninguno vale
    const rotated = data(await ess.m("a", "hotel.adminIcalIssueExport", { targetKind: "room_type", targetId: typeId, channel: "booking" }, adA));
    expect(rotated.url).not.toBe(issued.url);
    expect((await ess.call("a", "GET", pathOf(issued.url))).status).toBe(404);
    expect((await ess.call("a", "GET", pathOf(rotated.url))).status).toBe(200);
    expect((await exportOf("booking")).url).toBe(rotated.url);
    data(await ess.m("a", "hotel.adminIcalRevokeExport", { id: (await exportOf("booking")).id }, adA));
    expect((await ess.call("a", "GET", pathOf(rotated.url))).status).toBe(404);
    expect(await exportOf("booking")).toBeUndefined();
  });

  it("importación: solo https; un fallo queda a la vista y la primera URL enciende la sincronización automática", async () => {
    expect(errCode(await ess.m("a", "hotel.adminIcalAddFeed", { targetKind: "room_type", targetId: typeId, channel: "airbnb", url: "http://calendario.example/x.ics" }, adA))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "hotel.adminIcalAddFeed", { targetKind: "room_type", targetId: typeId, channel: "airbnb", url: "https://127.0.0.1/x.ics" }, adA))).toBe("BAD_REQUEST");
    const added = data(await ess.m("a", "hotel.adminIcalAddFeed", { targetKind: "room_type", targetId: typeId, channel: "airbnb", url: "https://calendario.invalid/ical/abc.ics?s=no-real", label: "Anuncio suite" }, adA));
    expect(added.sync).toMatchObject({ ok: false, error: expect.stringMatching(/No se encuentra el servidor/) });
    const p = await panel();
    expect(p.autoSync).toBe(true);
    expect(p.feeds).toEqual([expect.objectContaining({ id: added.id, channel: "airbnb", label: "Anuncio suite", status: "active", lastStatus: "error", consecutiveFailures: 1 })]);
    expect(p.feeds[0].url).not.toContain("no-real");
    // Apagar y encender el interruptor
    data(await ess.m("a", "hotel.adminIcalSetAutoSync", { enabled: false }, adA));
    expect((await panel()).autoSync).toBe(false);
  });

  it("bloqueos importados: descuentan disponibilidad y se exportan a los otros canales, no al suyo; pausa y archivo", async () => {
    const feedId = (await panel()).feeds[0].id;
    // Simula una sincronización correcta de Airbnb (sin red): un evento en d(20)–d(22)
    await ess.sql("a", "INSERT INTO hotel_ical_blocks (feed_id, uid_hash, uid, room_type_id, hotel_room_id, start_date, end_date, status, first_seen_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, 'active', 1, 1)",
      [feedId, crypto.createHash("sha256").update("evento@airbnb.example").digest("hex"), "evento@airbnb.example", typeId, d(20), d(22)]);
    const search = async () => data(await ess.q("a", "hotel.searchAvailability", { checkIn: d(20), checkOut: d(21), adults: 2, children: 0 })).find((t: any) => t.id === typeId);
    expect(await search()).toMatchObject({ isAvailable: false, availableUnits: 0 });
    // Recepción no puede vender esa noche sin forzar
    expect(errCode(await ess.m("a", "hotel.adminCreateReservation", { roomTypeId: typeId, checkIn: d(20), checkOut: d(21), adults: 2, customerName: "Otro", customerEmail: "otro@cliente-a.example" }, adA))).toBe("BAD_REQUEST");

    const booking = data(await ess.m("a", "hotel.adminIcalIssueExport", { targetKind: "room_type", targetId: typeId, channel: "booking" }, adA));
    const airbnb = data(await ess.m("a", "hotel.adminIcalIssueExport", { targetKind: "room_type", targetId: typeId, channel: "airbnb" }, adA));
    const toBooking = (await ess.call("a", "GET", pathOf(booking.url))).text;
    const toAirbnb = (await ess.call("a", "GET", pathOf(airbnb.url))).text;
    expect(toBooking).toContain(`DTSTART;VALUE=DATE:${compact(d(20))}`);
    expect(toAirbnb).not.toContain(`DTSTART;VALUE=DATE:${compact(d(20))}`);
    // La reserva propia sale en los dos
    expect(toAirbnb).toContain(`DTSTART;VALUE=DATE:${compact(d(10))}`);
    expect((await panel()).blocks).toEqual([expect.objectContaining({ feedId, start: d(20), end: d(22) })]);

    // En pausa deja de contar; reanudada vuelve (la sincronización falla sin red, pero sus bloqueos se conservan)
    data(await ess.m("a", "hotel.adminIcalSetFeedStatus", { id: feedId, status: "paused" }, adA));
    expect(await search()).toMatchObject({ isAvailable: true, availableUnits: 1 });
    const resumed = data(await ess.m("a", "hotel.adminIcalSetFeedStatus", { id: feedId, status: "active" }, adA));
    expect(resumed.sync).toMatchObject({ ok: false });
    expect(await search()).toMatchObject({ isAvailable: false, availableUnits: 0 });
    // Archivada: sus bloqueos se cancelan (no se borran) y desaparece del panel
    data(await ess.m("a", "hotel.adminIcalSetFeedStatus", { id: feedId, status: "archived" }, adA));
    expect(await search()).toMatchObject({ isAvailable: true, availableUnits: 1 });
    expect(await ess.sql("a", "SELECT status FROM hotel_ical_blocks WHERE feed_id = ?", [feedId])).toEqual([{ status: "cancelled" }]);
    expect((await panel()).feeds).toEqual([]);
    // Nada de esto toca el inventario por día ni la otra empresa
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM room_blocks WHERE roomTypeId = ?", [typeId]))[0].n).toBe(0);
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM hotel_ical_feeds"))[0].n).toBe(0);
  });

  it("sincronización: altas, cambios y bajas por UID; un fallo conserva los bloqueos; el trabajo respeta el interruptor", async () => {
    const { runWithTenant } = await import("./_core/tenant");
    const { withTenantDb } = await import("./_core/dbRegistry");
    const inA = <T>(fn: () => Promise<T>) => runWithTenant(ess.ids.a, () => withTenantDb(ess.ids.a, fn));
    const { syncFeedNow, syncDueFeeds } = await import("./hotelIcalDb");
    const feedId = data(await ess.m("a", "hotel.adminIcalAddFeed", { targetKind: "room_type", targetId: typeId, channel: "vrbo", url: "https://vrbo-calendario.invalid/ical.ics" }, adA)).id;
    const vevent = (uid: string, from: string, to: string) => `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART;VALUE=DATE:${compact(from)}\r\nDTEND;VALUE=DATE:${compact(to)}\r\nSUMMARY:Reserved - Nombre Inventado\r\nEND:VEVENT\r\n`;
    const cal = (...events: string[]) => async () => ({ ok: true as const, body: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join("")}END:VCALENDAR\r\n` });
    const active = async () => (await ess.sql("a", "SELECT uid, start_date, end_date FROM hotel_ical_blocks WHERE feed_id = ? AND status = 'active' ORDER BY start_date", [feedId]));
    const reservations = (await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations"))[0].n;

    expect(await inA(() => syncFeedNow(feedId, { fetcher: cal(vevent("v1@vrbo.example", d(30), d(32)), vevent("v2@vrbo.example", d(40), d(41))) }))).toMatchObject({ ok: true, events: 2, added: 2, updated: 0, cancelled: 0 });
    expect(await active()).toEqual([{ uid: "v1@vrbo.example", start_date: d(30), end_date: d(32) }, { uid: "v2@vrbo.example", start_date: d(40), end_date: d(41) }]);
    // Repetir no cambia nada; mover uno y quitar otro
    expect(await inA(() => syncFeedNow(feedId, { fetcher: cal(vevent("v1@vrbo.example", d(30), d(32)), vevent("v2@vrbo.example", d(40), d(41))) }))).toMatchObject({ added: 0, updated: 0, cancelled: 0 });
    expect(await inA(() => syncFeedNow(feedId, { fetcher: cal(vevent("v1@vrbo.example", d(31), d(33))) }))).toMatchObject({ ok: true, added: 0, updated: 1, cancelled: 1 });
    expect(await active()).toEqual([{ uid: "v1@vrbo.example", start_date: d(31), end_date: d(33) }]);
    // Un fallo (descarga o contenido) no toca los bloqueos y queda a la vista
    expect(await inA(() => syncFeedNow(feedId, { fetcher: async () => ({ ok: true as const, body: "<html>mantenimiento</html>" }) }))).toMatchObject({ ok: false, error: expect.stringMatching(/no es un calendario/) });
    expect(await active()).toHaveLength(1);
    expect((await panel()).feeds.find((f: any) => f.id === feedId)).toMatchObject({ lastStatus: "error", upcoming: 1 });
    // Sin datos del huésped guardados y sin tocar reservas
    expect(JSON.stringify(await ess.sql("a", "SELECT * FROM hotel_ical_blocks WHERE feed_id = ?", [feedId]))).not.toMatch(/Nombre Inventado/);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations"))[0].n).toBe(reservations);

    // El trabajo: apagado no hace nada; encendido sincroniza las pendientes
    data(await ess.m("a", "hotel.adminIcalSetAutoSync", { enabled: false }, adA));
    expect(await inA(() => syncDueFeeds({ fetcher: cal() }))).toEqual({ skipped: "apagada", results: [] });
    data(await ess.m("a", "hotel.adminIcalSetAutoSync", { enabled: true }, adA));
    const later = Date.now() + 20 * 60_000;
    const run = await inA(() => syncDueFeeds({ now: later, fetcher: cal() }));
    expect(run.results).toEqual([expect.objectContaining({ feedId, ok: true, cancelled: 1 })]);
    expect(await active()).toEqual([]);
    // Recién intentada: la siguiente pasada no la repite
    expect((await inA(() => syncDueFeeds({ now: later + 60_000, fetcher: cal() }))).results).toEqual([]);
  });

  it("sin Hotel Net la ruta pública no está disponible", async () => {
    const live = data(await ess.m("a", "hotel.adminIcalIssueExport", { targetKind: "room_type", targetId: typeId, channel: "google" }, adA));
    expect((await ess.call("a", "GET", pathOf(live.url))).status).toBe(200);
    await ess.setCapability("a", CAP, null);
    const r = await ess.call("a", "GET", pathOf(live.url));
    expect(r.status).toBe(404);
    expect(r.text).toMatch(/no está disponible/);
    await ess.setCapability("a", CAP, "active");
  });
});
