/**
 * Elephant Connect · Veturis en Travel Net con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL) y
 * Veturis SIMULADO detrás de `fetch` (ninguna llamada sale a Internet). Dos empresas; solo la A conecta su cuenta.
 *  - Sin credenciales no se llama a Veturis; con ellas (bóveda, cifradas), prueba de conexión de solo lectura.
 *  - Búsqueda y alta de la oferta con su NETO vinculante; el margen lo aplica Travel Net.
 *  - Revalidación del precio; reserva apagada por defecto → adaptador manual; encendida → revalida, no reserva si el
 *    precio cambió, una sola reserva aunque se pida dos veces, operación confirmada con localizador; respuesta dudosa.
 *  - Job de inventario por empresa (apagado por defecto) dentro del tope de llamadas.
 * TEST_MIGRATIONS_DIR permite apuntar a una copia del carril sin huecos mientras se fusionan las anteriores.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";
import { FakeVeturis, detailResponse } from "./travelNet/veturis/fixtures";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("Veturis en Travel Net (aplicación real, Veturis simulado)", () => {
  let ess: EssentialApp;
  let adA: string;
  let adB: string;
  let supplier = 0;
  const v = new FakeVeturis();
  const realFetch = globalThis.fetch;
  const ok = async (p: Promise<{ status: number; json: any; text: string }>) => {
    const r = await p;
    if (r.status !== 200) throw new Error(`${r.status}: ${r.text.slice(0, 400)}`);
    return data(r);
  };
  const m = (proc: string, input: unknown, co: "a" | "b" = "a") => ess.m(co, proc, input, co === "a" ? adA : adB);
  const q = (proc: string, input: unknown, co: "a" | "b" = "a") => ess.q(co, proc, input, co === "a" ? adA : adB);
  const rooms = [{ adults: 2, childrenAges: [] as number[] }];
  const stay = { checkIn: "2027-01-10", checkOut: "2027-01-12" };

  /** Expediente con la oferta de Veturis añadida, presupuestado, aceptado y convertido: devuelve su operación. */
  async function reservedFile(title: string) {
    const fileId = (await ok(m("travel.createFile", { title, clientName: "Cliente Viajero", clientEmail: "viajero@cliente-a.example", startDate: stay.checkIn, endDate: stay.checkOut, adults: 2 }))).id;
    const s = await ok(q("travel.veturisSearch", { ...stay, rooms }));
    await ok(m("travel.veturisAddOffer", { fileId, searchObj: s.searchObj, offerToken: "100001H1_TOKEN_REEMB", hotelId: "100001", ...stay, rooms, refundable: "yes" }));
    const quote = await ok(m("travel.generateQuote", { id: fileId }));
    await ess.sql("a", "UPDATE quotes SET status = 'enviado' WHERE id = ?", [quote.quoteId]);
    await ok(m("travel.convertToReservation", { id: fileId }));
    const f = await ok(q("travel.getFile", { id: fileId }));
    return { fileId, op: f.services[0].operation.id as number, serviceId: f.services[0].id as number };
  }
  const bookings = () => v.calls.filter((c) => c === "BookingConfirmation").length;

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "veturis");
    // Después de arrancar: el kit sustituye `fetch` para que nada salga a la red; Veturis simulado por encima
    const appFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init: any) => {
      const url = String(input?.url ?? input);
      return url.includes("veturis.com") ? (v.fetch(url, init) as any) : appFetch(input, init);
    }) as typeof fetch;
    for (const co of ["a", "b"] as const) await ess.setCapability(co, "travel-net", "active");
    adA = await ess.login("a", "admin");
    adB = await ess.login("b", "admin");
  }, 300_000);
  afterAll(async () => {
    globalThis.fetch = realFetch;
    await ess?.close();
  });

  it("sin credenciales de la empresa no se llama a Veturis; con ellas, cifradas en la bóveda y prueba de solo lectura", async () => {
    expect(await ok(q("travel.veturisStatus", undefined))).toMatchObject({ connected: false, bookingEnabled: false, inventoryEnabled: false });
    expect(errCode(await q("travel.veturisSearch", { hotelIds: ["100001"], ...stay, rooms }))).toBe("PRECONDITION_FAILED");
    expect(v.calls).toEqual([]);
    const values = { environment: "test", user: v.validUser, password: ["clave", "ficticia"].join("-"), agencyUser: ["agencia", "ficticia"].join("-"), agencyPassword: ["clave", "agencia", "ficticia"].join("-") };
    await ok(m("integrations.save", { provider: "veturis", values }));
    const [row] = await ess.sql("a", "SELECT is_secret, value FROM integration_credentials WHERE provider = 'veturis' AND field = 'agencyPassword'");
    expect(row.is_secret).toBe(1);
    expect(String(row.value)).not.toContain(values.agencyPassword);
    expect(await ok(m("integrations.test", { provider: "veturis" }))).toMatchObject({ ok: true });
    expect(v.calls).toEqual(["SearchAvailability"]);
    expect(v.urls.every((u) => u.startsWith("http://testxmlservices"))).toBe(true);
    // La otra empresa sigue sin conexión
    expect(errCode(await q("travel.veturisSearch", { hotelIds: ["100001"], ...stay, rooms }, "b"))).toBe("PRECONDITION_FAILED");
  });

  it("búsqueda y alta con el neto vinculante; el margen lo pone Travel Net; revalidación del precio", async () => {
    supplier = (await ok(m("travel.createSupplier", { fiscalName: "Veturis Ficticio SL", commercialName: "Veturis", serviceKinds: ["alojamiento"] }))).id;
    await ok(m("travel.saveMarginRule", { scope: "proveedor", scopeKey: String(supplier), markupBp: 2000, commissionBp: 0 }));
    expect(errCode(await m("travel.veturisSaveSettings", { bookingEnabled: true }))).toBe("BAD_REQUEST");
    await ok(m("travel.veturisSaveSettings", { supplierId: supplier }));
    expect(errCode(await q("travel.veturisSearch", { ...stay, rooms }))).toBe("BAD_REQUEST");
    await ok(m("travel.veturisAddHotel", { hotelId: "100001", name: "Hotel Ficticio Centro" }));
    const s = await ok(q("travel.veturisSearch", { ...stay, rooms }));
    expect(s.hotels[0].offers.map((o: any) => o.netCents)).toEqual([12107, 13452]);
    const fileId = (await ok(m("travel.createFile", { title: "Escapada", clientName: "Cliente Viajero", startDate: stay.checkIn, endDate: stay.checkOut, adults: 2 }))).id;
    const added = await ok(m("travel.veturisAddOffer", { fileId, searchObj: s.searchObj, offerToken: "100001H1_TOKEN_REEMB", hotelId: "100001", ...stay, rooms, refundable: "yes" }));
    expect(added).toMatchObject({ netCents: 13452, priceChanged: false });
    let f = await ok(q("travel.getFile", { id: fileId }));
    expect(f.services.map((x: any) => [x.kind, x.netCents, x.sellingCents, x.ruleSource])).toEqual([["alojamiento", 13452, 16142, "proveedor"]]);
    v.detail = detailResponse({ priceChange: "140.10" });
    expect(await ok(m("travel.veturisRevalidate", { serviceId: f.services[0].id }))).toMatchObject({ changed: true, previousNetCents: 13452, netCents: 14010, serviceUpdated: true });
    f = await ok(q("travel.getFile", { id: fileId }));
    expect([f.services[0].netCents, f.services[0].sellingCents]).toEqual([14010, 16812]);
    v.detail = detailResponse();
  });

  it("reserva apagada (por defecto): la operación sigue el adaptador manual y no se reserva en Veturis", async () => {
    const { op } = await reservedFile("Manual");
    expect(await ok(m("travel.submitOperation", { id: op }))).toMatchObject({ status: "submitted" });
    expect(bookings()).toBe(0);
  });

  it("reserva encendida: revalida (si cambió no reserva), una sola reserva aunque se pida dos veces, confirmada con localizador", async () => {
    const { op, serviceId } = await reservedFile("Con reserva");
    await ok(m("travel.veturisSaveSettings", { bookingEnabled: true }));
    v.detail = detailResponse({ priceChange: "150.00" });
    expect(errCode(await m("travel.submitOperation", { id: op }))).toBe("CONFLICT");
    expect(bookings()).toBe(0);
    expect((await ok(q("travel.getOperation", { id: op }))).operation.status).toBe("pending_submission");
    // El presupuesto ya está aceptado: el precio nuevo queda en la oferta (revisado con el cliente) y ya coincide
    expect((await ok(m("travel.veturisRevalidate", { serviceId }))).changed).toBe(false);
    const both = await Promise.all([m("travel.submitOperation", { id: op }), m("travel.submitOperation", { id: op })]);
    expect(both.filter((r) => r.status === 200)).toHaveLength(1);
    expect(bookings()).toBe(1);
    const d = await ok(q("travel.getOperation", { id: op }));
    expect(d.operation).toMatchObject({ status: "provider_confirmed", providerLocator: "FICT001" });
    const [offer] = await ess.sql("a", "SELECT status, booking_id, environment FROM travel_veturis_offers WHERE service_id = ?", [serviceId]);
    expect(offer).toEqual({ status: "booked", booking_id: "90000001", environment: "test" });
    v.detail = detailResponse();
  });

  it("respuesta de Veturis perdida al confirmar: queda dudosa y no se repite sola", async () => {
    const { op, serviceId } = await reservedFile("Dudosa");
    v.dropBooking = true;
    expect(await ok(m("travel.submitOperation", { id: op }))).toMatchObject({ status: "submitted" });
    v.dropBooking = false;
    expect((await ess.sql("a", "SELECT status FROM travel_veturis_offers WHERE service_id = ?", [serviceId]))[0].status).toBe("doubtful");
    expect(errCode(await m("travel.submitOperation", { id: op }))).toBe("BAD_REQUEST");
  });

  it("job de inventario: apagado no hace nada; encendido comprueba los hoteles dentro del tope", async () => {
    const { runInventoryCheck } = await import("./travelNet/veturis/service");
    const { runWithTenant } = await import("./_core/tenant");
    const { withTenantDb } = await import("./_core/dbRegistry");
    const inA = <T>(fn: () => Promise<T>) => runWithTenant(ess.ids.a, () => withTenantDb(ess.ids.a, fn));
    await ok(m("travel.veturisSaveSettings", { inventoryEnabled: false }));
    expect(await inA(() => runInventoryCheck())).toEqual({ skipped: "inventory_off" });
    await ok(m("travel.veturisSaveSettings", { inventoryEnabled: true }));
    const r = await inA(() => runInventoryCheck());
    expect(r).toMatchObject({ checked: 1, available: 1, calls: 1 });
    expect((await ok(q("travel.veturisHotels", undefined)))[0]).toMatchObject({ lastAvailable: true });
    expect(await ok(q("travel.veturisHotels", undefined, "b"))).toEqual([]);
    // Las credenciales nunca viajan dentro del XML
    expect(v.creds.every((c) => c.user === v.validUser && c.agencyUser === ["agencia", "ficticia"].join("-"))).toBe(true);
  });
});
