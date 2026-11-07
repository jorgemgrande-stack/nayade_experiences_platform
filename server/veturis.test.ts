/**
 * Elephant Connect · Veturis (Travel Net): analizador XML estricto, protocolo (peticiones, búsqueda, detalle vinculante,
 * confirmación, errores, agrupación de ocupaciones), cliente con tope y entorno de pruebas por defecto, y el probador de
 * la integración. Todo contra Veturis SIMULADO: ninguna llamada real.
 */
import { describe, it, expect } from "vitest";
import { getProvider, validateFields } from "./_core/credentials/catalog";
import { testProvider } from "./_core/credentials/testers";
import { VETURIS_URLS, VeturisBudgetExceeded, VeturisClient, VeturisNetworkError } from "./travelNet/veturis/client";
import { AUTH_ERROR, BOOKING_CONFIRMED, BOOKING_FAILED, BOOKING_PENDING, FakeVeturis, GENERAL_ERROR, INVALID_XML, SEARCH_NO_RESULTS, SEARCH_RESPONSE, detailResponse } from "./travelNet/veturis/fixtures";
import { VeturisApiError, buildBookingConfirmationXml, buildSearchXml, checkSearch, generalError, groupOccupancies, mapAdditionalInformation, mapBookingConfirmation, mapSearch } from "./travelNet/veturis/protocol";
import { XmlParseError, asArray, parseXml, textValue } from "./travelNet/veturis/xml";

const creds = (o: Partial<{ user: string; environment: "test" | "live" }> = {}) => ({ user: ["usuario", "ficticio"].join("-"), password: "clave", agencyUser: "agencia", agencyPassword: "clave-agencia", environment: "test" as const, ...o });

describe("XML estricto", () => {
  it("atributos, texto, CDATA, entidades y listas forzadas", () => {
    const p = parseXml(`<?xml version="1.0"?><R a="1"><Errors><Error type="X"><![CDATA[uno & <dos>]]></Error></Errors><T>a &amp; b &#241;</T><Empty/></R>`);
    const r = p.R as Record<string, any>;
    expect(r["@_a"]).toBe("1");
    expect(asArray(r.Errors.Error)).toHaveLength(1);
    expect(r.Errors.Error[0]).toEqual({ "@_type": "X", "#text": "uno & <dos>" });
    expect(textValue(r.T)).toBe("a & b ñ");
    expect(r.Empty).toBe("");
  });
  it("rechaza XML vacío, sin cerrar, mal anidado, con DTD o con contenido tras la raíz", () => {
    for (const bad of ["", INVALID_XML, "<a><b></a></b>", '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><a>&e;</a>', "<a/><b/>", "texto"]) expect(() => parseXml(bad), bad).toThrow(XmlParseError);
  });
});

describe("protocolo", () => {
  it("ocupaciones: un bloque si todas son iguales (todas las edades), uno por habitación si no", () => {
    expect(groupOccupancies([{ adults: 2, childrenAges: [5] }, { adults: 2, childrenAges: [8] }])).toEqual([{ rooms: 2, adults: 2, children: 1, childrenAges: [5, 8] }]);
    expect(groupOccupancies([{ adults: 2, childrenAges: [] }, { adults: 1, childrenAges: [] }]).map((o) => o.rooms)).toEqual([1, 1]);
    const xml = buildSearchXml({ hotelIds: ["1", "2"], checkIn: "2027-01-10", checkOut: "2027-01-12", rooms: [{ adults: 2, childrenAges: [4] }] });
    expect(xml).toContain("<HotelList>1/2</HotelList>");
    expect(xml).toContain("<Ages><Age>4</Age></Ages>");
    expect(checkSearch({ hotelIds: ["x"], checkIn: "2027-01-10", checkOut: "2027-01-12", rooms: [{ adults: 2, childrenAges: [] }] })).toMatch(/hoteles/);
    expect(checkSearch({ hotelIds: ["1"], checkIn: "2027-01-12", checkOut: "2027-01-10", rooms: [{ adults: 2, childrenAges: [] }] })).toMatch(/Fechas/);
  });
  it("búsqueda: neto de agencia (PriceAgency) en céntimos, PVP solo informativo, reembolsable y cancelación", () => {
    const r = mapSearch(parseXml(SEARCH_RESPONSE));
    expect(r).toMatchObject({ searchObj: "1700000000.FICTICIO-OBJ", available: 1 });
    expect(r.hotels[0].offers.map((o) => [o.offerToken, o.netCents, o.listCents, o.priceIsMandatory, o.refundable])).toEqual([
      ["100001H1_TOKEN_NOREEMB", 12107, 14962, true, "no"],
      ["100001H1_TOKEN_REEMB", 13452, 16625, false, "yes"],
    ]);
    expect(mapSearch(parseXml(SEARCH_NO_RESULTS)).hotels).toEqual([]);
  });
  it("detalle vinculante: PriceChange manda sobre PriceAgency; sin precio, error", () => {
    expect(mapAdditionalInformation(parseXml(detailResponse()))).toMatchObject({ netCents: 13452, priceChanged: false, roomName: "Doble estándar", boardName: "Alojamiento y desayuno" });
    expect(mapAdditionalInformation(parseXml(detailResponse({ priceChange: "140.10" })))).toMatchObject({ netCents: 14010, priceChanged: true });
    expect(mapAdditionalInformation(parseXml(detailResponse())).essentialInformation[0]).toMatch(/Tasa turística no incluida &/);
    expect(() => mapAdditionalInformation(parseXml("<AdditionalInformationRS><PriceAgency>0</PriceAgency></AdditionalInformationRS>"))).toThrow(VeturisApiError);
  });
  it("confirmación: solo vale con ConfirmationStatus=1 y BookingID; errores legibles", () => {
    expect(mapBookingConfirmation(parseXml(BOOKING_CONFIRMED))).toMatchObject({ status: "confirmed", bookingId: "90000001", locator: "FICT001" });
    expect(mapBookingConfirmation(parseXml(BOOKING_PENDING))).toMatchObject({ status: "pending", bookingId: "90000002" });
    expect(mapBookingConfirmation(parseXml(BOOKING_FAILED))).toMatchObject({ status: "failed", bookingId: null, errors: ["Sin cupo", "Inténtelo más tarde"] });
    expect(generalError(parseXml(GENERAL_ERROR))?.message).toBe("Error 1824: valor no válido");
    const xml = buildBookingConfirmationXml({ searchObj: "o", offerToken: "t", client: { name: "Ana <x>", surnames: "Cliente", email: null, phone: null }, reference: "EXP-1", priceChangeCents: 14010 });
    expect(xml).toContain("<name>Ana &lt;x&gt;</name>");
    expect(xml).toContain("<PriceChange>140.10</PriceChange>");
    expect(xml).toContain("<Type>SL</Type>");
  });
});

describe("cliente", () => {
  it("entorno de pruebas por defecto, credenciales fuera del XML y tope de llamadas", async () => {
    const v = new FakeVeturis();
    const c = new VeturisClient(creds(), { fetch: v.fetch as never, maxCalls: 2 });
    await c.search({ hotelIds: ["100001"], checkIn: "2027-01-10", checkOut: "2027-01-12", rooms: [{ adults: 2, childrenAges: [] }] });
    await c.detail("o", "t");
    await expect(c.detail("o", "t")).rejects.toBeInstanceOf(VeturisBudgetExceeded);
    expect(v.urls).toEqual([VETURIS_URLS.test, VETURIS_URLS.test]);
    expect(v.calls).toEqual(["SearchAvailability", "AdditionalInformation"]);
    const live = new VeturisClient(creds({ environment: "live" }), { fetch: v.fetch as never, maxCalls: 1 });
    await live.search({ hotelIds: ["100001"], checkIn: "2027-01-10", checkOut: "2027-01-12", rooms: [{ adults: 2, childrenAges: [] }] });
    expect(v.urls.at(-1)).toBe(VETURIS_URLS.live);
  });
  it("errores: HTTP, error general, XML inválido y corte de red", async () => {
    const v = new FakeVeturis();
    const run = (f: unknown) => new VeturisClient(creds(), { fetch: f as never, maxCalls: 5 }).detail("o", "t");
    v.status = 502;
    await expect(run(v.fetch)).rejects.toMatchObject({ status: 502 });
    await expect(run(async () => ({ ok: true, status: 200, text: async () => GENERAL_ERROR }))).rejects.toBeInstanceOf(VeturisApiError);
    await expect(run(async () => ({ ok: true, status: 200, text: async () => INVALID_XML }))).rejects.toThrow(/XML inválido/);
    await expect(run(async () => Promise.reject(new Error("ECONNRESET")))).rejects.toBeInstanceOf(VeturisNetworkError);
  });
});

describe("integración en la bóveda", () => {
  it("proveedor veturis: credenciales secretas, entorno test/live y probador de solo lectura", async () => {
    const p = getProvider("veturis")!;
    expect(p.fields.map((f) => [f.key, f.secret, f.env ?? null])).toEqual([
      ["environment", false, null],
      ["user", true, null],
      ["password", true, null],
      ["agencyUser", true, null],
      ["agencyPassword", true, null],
    ]);
    expect(p.panel).toMatchObject({ group: "suppliers", requires: ["travel-net"] });
    expect(validateFields(p, { environment: "produccion" })).toEqual(["environment: valor no permitido"]);
    const v = new FakeVeturis();
    const ok = await testProvider("veturis", { ...creds(), environment: "test" } as never, v.fetch as never);
    expect(ok).toMatchObject({ ok: true, outcome: "connected" });
    expect(v.calls).toEqual(["SearchAvailability"]);
    const bad = await testProvider("veturis", { ...creds({ user: "otro" }), environment: "test" } as never, v.fetch as never);
    expect(bad).toMatchObject({ ok: false, outcome: "rejected" });
    expect((await testProvider("veturis", { environment: "test" }, v.fetch as never)).ok).toBe(false);
    expect(AUTH_ERROR).toContain("contraseña");
  });
});
