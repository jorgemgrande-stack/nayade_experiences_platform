/**
 * Elephant Net · rutas públicas con la aplicación REAL sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): dos empresas
 * nuevas desde la baseline y las migraciones de empresa (incluida la 0046), licencias del registro y peticiones sin
 * sesión a las páginas públicas.
 *  - Carta QR: carta de la mesa, pedido pendiente que NO entra en la comanda ni cobra hasta que el camarero lo confirma,
 *    envío repetido = un pedido, límites, pedidos pendientes por mesa, rotación y revocación, límite por enlace (429).
 *  - Check-in online: validación del registro de viajeros, corrección con el mismo enlace, recepción lo aplica a las
 *    fichas (los datos enviados se vacían) y el enlace deja de valer; caducado no vale.
 *  - Firma remota: firma con el servicio del mostrador (IP, navegador, huella) y un solo uso; revocado y caducado no valen.
 *  - Baja de comunicaciones: GET no da de baja, POST sí, idempotente y sin llamar a Brevo sin la clave de la empresa.
 *  - Comunes: un token de una empresa no vale en otra; sin la capacidad la página no está disponible; respuesta igual
 *    para un token inexistente. Datos sintéticos (dominios .example). Ningún cobro.
 */
import crypto from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type Co, type EssentialApp } from "./essentialApp.testkit";
import { addDaysIso, todayInTimeZone } from "./hotelPms";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const OP = { type: "operator" as const, id: "prueba-net-publico" };
const INVALID = "Este enlace no es válido o ha caducado";
const UNAVAILABLE = "Este servicio no está disponible";

describe.skipIf(!URL_)("Elephant Net · rutas públicas (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let adB: string;
  const d = (n: number) => addDaysIso(todayInTimeZone(), n);
  const tokenOf = (url: string) => url.split("/").pop()!;
  const get = (co: Co, p: string) => ess.call(co, "GET", p);
  const post = (co: Co, p: string, form: Record<string, string>) =>
    ess.call(co, "POST", p, { raw: new URLSearchParams(form).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });
  const ok = (r: { status: number; text: string }) => {
    if (r.status !== 200) throw new Error(`${r.status}: ${r.text.slice(0, 300)}`);
    return data(r as never);
  };
  const key = () => crypto.randomBytes(16).toString("hex");

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "netpub");
    const { EntitlementAdmin } = await import("./_core/modules/mysqlEntitlements");
    const ent = new EntitlementAdmin((ess.registry.store as any).q);
    for (const co of ["a", "b"] as const) {
      for (const m of ["restaurants", "hotel"]) await ent.grant(ess.ids[co], m, OP);
      await ess.sql(co, "INSERT INTO feature_flags (`key`, name, enabled) VALUES ('hotel_module_enabled', 'Hotel', 1) ON DUPLICATE KEY UPDATE enabled = 1");
      for (const cap of ["restaurant-net", "hotel-net", "email-campaigns", "ski-rental"]) await ess.setCapability(co, cap, "active");
    }
    const { getModuleAccess } = await import("./_core/modules/runtime");
    getModuleAccess().invalidate();
    // Sedes de Elephant Control (Ski Net es por sede)
    const { MysqlOrganizationStore } = await import("./organization/service");
    const { configureSiteDirectory, siteDirectoryFrom } = await import("./sdk");
    const org = new MysqlOrganizationStore((ess.registry.store as any).q);
    for (const co of ["a", "b"] as const) await org.insertSite({ tenantId: ess.ids[co], siteId: "pista-norte", name: "Pista norte", fiscalEntityId: null, status: "active", createdAt: 1, createdBy: "prueba", updatedAt: 1 });
    configureSiteDirectory(siteDirectoryFrom(org));
    adA = await ess.login("a", "admin");
    adB = await ess.login("b", "admin");
  }, 300_000);
  afterAll(async () => {
    const { configureSiteDirectory } = await import("./sdk");
    configureSiteDirectory(null);
    await ess?.close();
  });

  it("la migración 0046 crea sus tres tablas", async () => {
    const t = await ess.sql("a", "SHOW TABLES LIKE '%_%'");
    const names = t.map((r) => Object.values(r)[0]);
    expect(names).toEqual(expect.arrayContaining(["net_public_links", "restaurant_table_requests", "hotel_online_checkins"]));
  });

  describe("Restaurant Net · carta QR", () => {
    let tableId = 0;
    let menuA = 0;
    let menuB = 0;
    let url = "";

    beforeAll(async () => {
      await ess.sql("a", "INSERT INTO restaurants (slug, name) VALUES ('casa-prueba', 'Casa Prueba')");
      const [r] = await ess.sql("a", "SELECT id FROM restaurants WHERE slug = 'casa-prueba'");
      const room = ok(await ess.m("a", "restaurantNet.createRoom", { restaurantId: r.id, name: "Salón", kind: "salon" }, adA)).id;
      tableId = ok(await ess.m("a", "restaurantNet.createTable", { roomId: room, code: "7", shape: "square", capacity: 4 }, adA)).id;
      menuA = ok(await ess.m("a", "restaurantNet.upsertMenuItem", { restaurantId: r.id, name: "Croquetas caseras", category: "Entrantes", price: 8, taxRate: 10, allergens: ["gluten"] }, adA)).id;
      menuB = ok(await ess.m("a", "restaurantNet.upsertMenuItem", { restaurantId: r.id, name: "Arroz del día", category: "Principales", price: 15.5, taxRate: 10 }, adA)).id;
      url = ok(await ess.m("a", "restaurantNet.issueTableLink", { tableId }, adA)).url;
    });

    it("el panel emite el enlace; la carta se ve sin sesión solo en su empresa", async () => {
      expect(url).toMatch(/\/mesa\/[A-Za-z0-9_-]{43}$/);
      const [row] = await ess.sql("a", "SELECT token_hash, status FROM net_public_links WHERE kind = 'restaurant_table' AND target_id = ?", [tableId]);
      expect(row.status).toBe("active");
      expect(row.token_hash).not.toContain(tokenOf(url));
      const page = await get("a", `/mesa/${tokenOf(url)}`);
      expect(page.status).toBe(200);
      expect(page.text).toContain("Croquetas caseras");
      expect(page.text).toContain("Alérgenos: Gluten");
      expect(page.text).toContain("Mesa 7");
      // Otra empresa, un token inventado: la misma respuesta
      const other = await get("b", `/mesa/${tokenOf(url)}`);
      const fake = await get("a", `/mesa/${"Z".repeat(43)}`);
      expect([other.status, fake.status]).toEqual([404, 404]);
      expect(other.text).toContain(INVALID);
      expect(fake.text).toContain(INVALID);
      // El panel de otra empresa no puede emitir enlaces de esta mesa
      expect(errCode(await ess.m("b", "restaurantNet.issueTableLink", { tableId }, adB))).toBe("NOT_FOUND");
    });

    it("el pedido queda pendiente: ni comanda ni cobro; repetir el envío es el mismo pedido", async () => {
      const k = key();
      const sent = await post("a", `/mesa/${tokenOf(url)}`, { [`q${menuA}`]: "2", [`q${menuB}`]: "1", n: "Sin cebolla", k });
      expect(sent.status).toBe(200);
      expect(sent.text).toContain("Pedido enviado");
      expect(sent.text).toContain("No se cobra nada ahora");
      expect((await post("a", `/mesa/${tokenOf(url)}`, { [`q${menuA}`]: "2", [`q${menuB}`]: "1", n: "Sin cebolla", k })).status).toBe(200);
      // El mismo formulario enviado dos veces a la vez: los dos responden bien y es un solo pedido (sin 500)
      const k2 = key();
      const twin = await Promise.all([1, 2].map(() => post("a", `/mesa/${tokenOf(url)}`, { [`q${menuA}`]: "1", k: k2 })));
      expect(twin.map((r) => r.status)).toEqual([200, 200]);
      expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM restaurant_table_requests WHERE submit_key = ?", [k2]))[0].n).toBe(1);
      await ess.sql("a", "UPDATE restaurant_table_requests SET status = 'rejected' WHERE submit_key = ?", [k2]);
      const reqs = await ess.sql("a", "SELECT status, item_count, estimated_total FROM restaurant_table_requests WHERE table_id = ? AND status = 'pending'", [tableId]);
      expect(reqs).toHaveLength(1);
      expect(reqs[0]).toMatchObject({ status: "pending", item_count: 3, estimated_total: "31.50" });
      expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM hospo_orders"))[0].n).toBe(0);
      expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM tpv_sales"))[0].n).toBe(0);
      // Límites y platos de otra carta
      expect((await post("a", `/mesa/${tokenOf(url)}`, { [`q${menuA}`]: "21", k: key() })).status).toBe(400);
      expect((await post("a", `/mesa/${tokenOf(url)}`, { q999999: "1", k: key() })).status).toBe(400);
      expect((await post("a", `/mesa/${tokenOf(url)}`, { [`q${menuA}`]: "1", k: "no-hex" })).status).toBe(400);
    });

    it("el camarero lo confirma: pasa a la comanda de la mesa, sin venta en el TPV", async () => {
      const list = ok(await ess.q("a", "restaurantNet.tableRequests", { restaurantId: (await ess.sql("a", "SELECT id FROM restaurants"))[0].id }, adA));
      expect(list.pending).toHaveLength(1);
      expect(list.pending[0].lines.map((l: any) => [l.name, l.quantity])).toEqual([["Croquetas caseras", 2], ["Arroz del día", 1]]);
      const r = ok(await ess.m("a", "restaurantNet.acceptTableRequest", { requestId: list.pending[0].id }, adA));
      expect(r).toMatchObject({ added: 2, skipped: [] });
      const items = await ess.sql("a", "SELECT name, quantity, status, notes FROM hospo_order_items WHERE order_id = ? ORDER BY id", [r.orderId]);
      expect(items.map((i) => [i.name, i.quantity, i.status])).toEqual([["Croquetas caseras", 2, "pending"], ["Arroz del día", 1, "pending"]]);
      expect(items[0].notes).toBe("Desde la mesa: Sin cebolla");
      expect((await ess.sql("a", "SELECT status, hospo_order_id FROM restaurant_table_requests ORDER BY id"))[0]).toMatchObject({ status: "accepted", hospo_order_id: r.orderId });
      expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM tpv_sales"))[0].n).toBe(0);
      expect(errCode(await ess.m("a", "restaurantNet.acceptTableRequest", { requestId: list.pending[0].id }, adA))).toBe("CONFLICT");
    });

    it("rotar invalida el QR anterior; revocar invalida el actual", async () => {
      const old = tokenOf(url);
      url = ok(await ess.m("a", "restaurantNet.issueTableLink", { tableId }, adA)).url;
      expect((await get("a", `/mesa/${old}`)).status).toBe(404);
      expect((await get("a", `/mesa/${tokenOf(url)}`)).status).toBe(200);
      expect(ok(await ess.q("a", "restaurantNet.tableLinks", { restaurantId: (await ess.sql("a", "SELECT id FROM restaurants"))[0].id }, adA))[0]).toMatchObject({ tableId, active: true });
      expect(ok(await ess.m("a", "restaurantNet.revokeTableLink", { tableId }, adA))).toEqual({ revoked: true });
      expect((await get("a", `/mesa/${tokenOf(url)}`)).text).toContain(INVALID);
    });

    it("pedidos pendientes por mesa y límite de envíos por enlace (429)", async () => {
      const t = tokenOf(ok(await ess.m("a", "restaurantNet.issueTableLink", { tableId }, adA)).url);
      for (let i = 0; i < 3; i++) expect((await post("a", `/mesa/${t}`, { [`q${menuA}`]: "1", k: key() })).status).toBe(200);
      const fourth = await post("a", `/mesa/${t}`, { [`q${menuA}`]: "1", k: key() });
      expect(fourth.status).toBe(409);
      expect(fourth.text).toContain("esperando al camarero");
      const codes: number[] = [];
      for (let i = 0; i < 7; i++) codes.push((await post("a", `/mesa/${t}`, { [`q${menuA}`]: "1", k: key() })).status);
      expect(codes.slice(0, 6).every((c) => c === 409)).toBe(true);
      expect(codes[6]).toBe(429);
      // Rechazar un pedido no crea nada
      const pending = ok(await ess.q("a", "restaurantNet.tableRequests", { restaurantId: (await ess.sql("a", "SELECT id FROM restaurants"))[0].id }, adA)).pending;
      expect(ok(await ess.m("a", "restaurantNet.rejectTableRequest", { requestId: pending[0].id, reason: "Cocina cerrada" }, adA))).toEqual({ ok: true });
    });

    it("sin la capacidad restaurant-net la carta no está disponible", async () => {
      const t = tokenOf(ok(await ess.m("a", "restaurantNet.issueTableLink", { tableId }, adA)).url);
      await ess.setCapability("a", "restaurant-net", null);
      try {
        const r = await get("a", `/mesa/${t}`);
        expect(r.status).toBe(404);
        expect(r.text).toContain(UNAVAILABLE);
        await ess.setCapability("a", "restaurant-net", "read_only");
        expect((await get("a", `/mesa/${t}`)).text).toContain(UNAVAILABLE);
      } finally {
        await ess.setCapability("a", "restaurant-net", "active");
      }
      expect((await get("a", `/mesa/${t}`)).status).toBe(200);
    });
  });

  describe("Hotel Net · check-in online", () => {
    let resId = 0;
    let url = "";
    const g0 = {
      g0_firstName: "Ana", g0_lastName: "Prueba", g0_sex: "M", g0_birthDate: "1990-05-10", g0_nationality: "España", g0_docType: "DNI", g0_docNumber: "12345678Z",
      g0_docSupportNumber: "ABC123456", g0_address: "Calle Ejemplo 1", g0_country: "España", g0_email: "titular@cliente-a.example",
    };

    beforeAll(async () => {
      const typeId = ok(await ess.m("a", "hotel.adminCreateRoomType", { slug: "doble", name: "Doble", basePrice: "100", totalUnits: 3, maxAdults: 2 }, adA)).id;
      resId = ok(await ess.m("a", "hotel.adminCreateReservation", { roomTypeId: typeId, checkIn: d(3), checkOut: d(5), adults: 2, customerName: "Ana Prueba", customerEmail: "titular@cliente-a.example" }, adA)).id;
      url = ok(await ess.m("a", "hotel.adminIssueCheckinLink", { reservationId: resId }, adA)).url;
    });

    it("el huésped ve su reserva y el formulario del registro de viajeros, sin datos de pago", async () => {
      expect(url).toMatch(/\/check-in\/[A-Za-z0-9_-]{43}$/);
      const page = await get("a", `/check-in/${tokenOf(url)}`);
      expect(page.status).toBe(200);
      expect(page.text).toContain("Check-in online");
      expect(page.text).toContain("Acompañante 1");
      expect(page.text).not.toMatch(/tarjeta|IBAN|importe/i);
      expect((await get("b", `/check-in/${tokenOf(url)}`)).text).toContain(INVALID);
    });

    it("valida como recepción; guarda sin tocar las fichas; se puede corregir con el mismo enlace", async () => {
      const bad = await post("a", `/check-in/${tokenOf(url)}`, { ...g0, g0_docNumber: "12345678A" });
      expect(bad.status).toBe(400);
      expect(bad.text).toContain("DNI no es válido");
      // Al corregir, el documento y el soporte nunca se devuelven en la página
      expect(bad.text).not.toContain("12345678A");
      expect(bad.text).not.toContain("ABC123456");
      expect(bad.text).toContain('value="Calle Ejemplo 1"');
      expect((await post("a", `/check-in/${tokenOf(url)}`, g0)).status).toBe(200);
      expect((await post("a", `/check-in/${tokenOf(url)}`, { ...g0, g0_city: "Ejemplo de Abajo" })).status).toBe(200);
      const rows = await ess.sql("a", "SELECT status, guest_count, guests_json FROM hotel_online_checkins WHERE reservation_id = ?", [resId]);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("pending");
      expect(JSON.parse(rows[0].guests_json)[0]).toMatchObject({ firstName: "Ana", city: "Ejemplo de Abajo" });
      expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM hotel_guests"))[0].n).toBe(0);
      // Lo ya enviado no se vuelve a mostrar: solo un resumen (quien tenga el enlace no ve documentos ni direcciones)
      const again = await get("a", `/check-in/${tokenOf(url)}`);
      expect(again.text).toContain("Datos recibidos de 1 persona, pendientes de revisión en recepción");
      for (const secret of ["12345678Z", "ABC123456", "1990-05-10", "Calle Ejemplo 1", "Ejemplo de Abajo", "titular@cliente-a.example"]) expect(again.text).not.toContain(secret);
    });

    it("recepción lo aplica a las fichas; los datos enviados se vacían y el enlace deja de valer", async () => {
      const st = ok(await ess.q("a", "hotel.adminOnlineCheckin", { reservationId: resId }, adA));
      expect(st.submission).toMatchObject({ status: "pending", guestCount: 1 });
      expect(st.submission.guests[0]).toMatchObject({ displayName: "Ana Prueba", missing: [] });
      expect(ok(await ess.m("a", "hotel.adminApplyOnlineCheckin", { reservationId: resId }, adA))).toEqual({ applied: 1, incomplete: 0 });
      const guests = ok(await ess.q("a", "hotel.adminGetStayGuests", { reservationId: resId }, adA));
      expect(guests.map((g: any) => [g.displayName, g.isLead, g.missing.length])).toEqual([["Ana Prueba", true, 0]]);
      expect((await ess.sql("a", "SELECT status, guests_json FROM hotel_online_checkins WHERE reservation_id = ?", [resId]))[0]).toMatchObject({ status: "applied", guests_json: null });
      expect((await get("a", `/check-in/${tokenOf(url)}`)).text).toContain(INVALID);
      expect(errCode(await ess.m("a", "hotel.adminApplyOnlineCheckin", { reservationId: resId }, adA))).toBe("CONFLICT");
      // Otra empresa no ve la reserva de esta
      expect(errCode(await ess.q("b", "hotel.adminOnlineCheckin", { reservationId: resId }, adB))).toBe("NOT_FOUND");
    });

    it("caducado o sin la capacidad hotel-net: no vale", async () => {
      const u = ok(await ess.m("a", "hotel.adminIssueCheckinLink", { reservationId: resId }, adA)).url;
      await ess.sql("a", "UPDATE net_public_links SET expires_at = ? WHERE kind = 'hotel_checkin' AND status = 'active'", [Date.now() - 1000]);
      expect((await get("a", `/check-in/${tokenOf(u)}`)).text).toContain(INVALID);
      const u2 = ok(await ess.m("a", "hotel.adminIssueCheckinLink", { reservationId: resId }, adA)).url;
      await ess.setCapability("a", "hotel-net", null);
      try {
        expect((await get("a", `/check-in/${tokenOf(u2)}`)).text).toContain(UNAVAILABLE);
        expect(errCode(await ess.m("a", "hotel.adminIssueCheckinLink", { reservationId: resId }, adA))).toBe("FORBIDDEN");
      } finally {
        await ess.setCapability("a", "hotel-net", "active");
      }
    });
  });

  describe("Ski Net · firma remota", () => {
    const S = { siteId: "pista-norte" };
    let deliveryId = 0;
    let url = "";
    let storeId = 0;
    let modelId = 0;
    const newDelivery = async (code: string) =>
      ok(await ess.m("a", "skiRental.createDelivery", { ...S, storeId, customerName: "Cliente Ficticio", startDate: d(1), expectedReturnDate: d(3), lines: [{ code, requestedType: "ski" }] }, adA)).id as number;

    beforeAll(async () => {
      ok(await ess.m("a", "skiRental.activateSite", S, adA));
      storeId = ok(await ess.m("a", "skiRental.createStore", { ...S, name: "Tienda pie de pistas", openingTime: "08:30", closingTime: "18:00", overdueReturnTime: "17:30" }, adA)).id;
      modelId = ok(await ess.m("a", "skiRental.createModel", { ...S, assetType: "ski", name: "Allround", size: "160", replacementValueCents: 30000 }, adA)).id;
      ok(await ess.m("a", "skiRental.createUnits", { ...S, modelId, storeId, count: 5 }, adA));
      deliveryId = await newDelivery("SKI-00001");
      url = ok(await ess.m("a", "skiRental.issueSignLink", { ...S, deliveryId }, adA)).url;
    });

    it("muestra el contrato exacto con su huella; sin aceptar no firma", async () => {
      expect(url).toMatch(/\/firma\/[A-Za-z0-9_-]{43}$/);
      const [c] = await ess.sql("a", "SELECT content_hash FROM ski_rental_contracts WHERE delivery_id = ?", [deliveryId]);
      const page = await get("a", `/firma/${tokenOf(url)}`);
      expect(page.status).toBe(200);
      expect(page.text).toContain(c.content_hash);
      expect(page.text).toContain("Allround");
      expect((await get("b", `/firma/${tokenOf(url)}`)).text).toContain(INVALID);
      const no = await post("a", `/firma/${tokenOf(url)}`, { signerName: "Cliente Ficticio" });
      expect(no.status).toBe(400);
      expect(no.text).toContain("aceptar las condiciones");
    });

    it("firma con el servicio del mostrador (IP, navegador, huella) y es de un solo uso", async () => {
      const r = await ess.call("a", "POST", `/firma/${tokenOf(url)}`, {
        raw: new URLSearchParams({ signerName: "Cliente Ficticio", accepted: "1" }).toString(),
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "NavegadorDePrueba/1.0" },
      });
      expect(r.status).toBe(200);
      expect(r.text).toContain("Contrato firmado");
      const [c] = await ess.sql("a", "SELECT status, signer_name, signed_by, signed_ip, signed_user_agent FROM ski_rental_contracts WHERE delivery_id = ?", [deliveryId]);
      expect(c).toMatchObject({ status: "signed", signer_name: "Cliente Ficticio", signed_user_agent: "NavegadorDePrueba/1.0" });
      expect(c.signed_by).toMatch(/^public:link:\d+$/);
      expect(c.signed_ip).toBeTruthy();
      expect((await ess.sql("a", "SELECT status FROM net_public_links WHERE kind = 'ski_contract' AND target_id = ?", [deliveryId]))[0].status).toBe("used");
      expect((await post("a", `/firma/${tokenOf(url)}`, { signerName: "Otra Persona", accepted: "1" })).text).toContain(INVALID);
      expect((await get("a", `/firma/${tokenOf(url)}`)).text).toContain(INVALID);
      expect((await ess.sql("a", "SELECT signer_name FROM ski_rental_contracts WHERE delivery_id = ?", [deliveryId]))[0].signer_name).toBe("Cliente Ficticio");
      expect(errCode(await ess.m("a", "skiRental.issueSignLink", { ...S, deliveryId }, adA))).toBe("CONFLICT");
    });

    it("revocado o caducado no vale; otra empresa no emite enlaces de esta entrega", async () => {
      const d2 = await newDelivery("SKI-00002");
      const u = ok(await ess.m("a", "skiRental.issueSignLink", { ...S, deliveryId: d2, hours: 2 }, adA)).url;
      expect(ok(await ess.m("a", "skiRental.revokeSignLink", { ...S, deliveryId: d2 }, adA))).toEqual({ revoked: true });
      expect((await get("a", `/firma/${tokenOf(u)}`)).text).toContain(INVALID);
      const u2 = ok(await ess.m("a", "skiRental.issueSignLink", { ...S, deliveryId: d2 }, adA)).url;
      await ess.sql("a", "UPDATE net_public_links SET expires_at = ? WHERE kind = 'ski_contract' AND target_id = ? AND status = 'active'", [Date.now() - 1000, d2]);
      expect((await get("a", `/firma/${tokenOf(u2)}`)).text).toContain(INVALID);
      expect(errCode(await ess.m("b", "skiRental.issueSignLink", { ...S, deliveryId: d2 }, adB))).not.toBeUndefined();
      expect((await ess.sql("a", "SELECT status FROM ski_rental_contracts WHERE delivery_id = ?", [d2]))[0].status).toBe("pending");
    });

    it("dos firmas a la vez con el mismo enlace: solo firma la que consume el enlace", async () => {
      const dx = await newDelivery("SKI-00004");
      const u = ok(await ess.m("a", "skiRental.issueSignLink", { ...S, deliveryId: dx }, adA)).url;
      const both = await Promise.all(["Primera Persona", "Segunda Persona"].map((signerName) => post("a", `/firma/${tokenOf(u)}`, { signerName, accepted: "1" })));
      expect(both.filter((r) => r.status === 200 && r.text.includes("Contrato firmado"))).toHaveLength(1);
      expect(both.filter((r) => r.text.includes(INVALID))).toHaveLength(1);
      const winner = both.find((r) => r.status === 200)!.text.includes("Primera Persona") ? "Primera Persona" : "Segunda Persona";
      expect((await ess.sql("a", "SELECT status, signer_name FROM ski_rental_contracts WHERE delivery_id = ?", [dx]))[0]).toMatchObject({ status: "signed", signer_name: winner });
    });

    it("sin la licencia ski-rental la firma remota no está disponible", async () => {
      const d3 = await newDelivery("SKI-00003");
      const u = ok(await ess.m("a", "skiRental.issueSignLink", { ...S, deliveryId: d3 }, adA)).url;
      await ess.setCapability("a", "ski-rental", "read_only");
      try {
        expect((await get("a", `/firma/${tokenOf(u)}`)).text).toContain(UNAVAILABLE);
        expect((await post("a", `/firma/${tokenOf(u)}`, { signerName: "Cliente Ficticio", accepted: "1" })).text).toContain(UNAVAILABLE);
      } finally {
        await ess.setCapability("a", "ski-rental", "active");
      }
      expect((await ess.sql("a", "SELECT status FROM ski_rental_contracts WHERE delivery_id = ?", [d3]))[0].status).toBe("pending");
    });
  });

  describe("Connect Brevo · baja pública", () => {
    let clientId = 0;
    let url = "";
    beforeAll(async () => {
      await ess.sql("a", "INSERT INTO clients (source, name, email, createdAt, updatedAt) VALUES ('manual', 'Cliente Boletín', 'boletin@cliente-a.example', NOW(), NOW())");
      clientId = Number((await ess.sql("a", "SELECT id FROM clients WHERE email = 'boletin@cliente-a.example'"))[0].id);
      ok(await ess.m("a", "brevoMarketing.grantConsent", { clientId, source: "form", evidence: "Casilla del formulario web" }, adA));
      url = ok(await ess.q("a", "brevoMarketing.unsubscribeLink", { clientId }, adA)).url;
    });

    it("GET solo pide confirmar; POST da de baja con su historial; repetir no cambia nada", async () => {
      expect(url).toMatch(new RegExp(`/baja/${clientId}\\.[A-Za-z0-9_-]{32}$`));
      const mailsBefore = ess.mails.length;
      const page = await get("a", `/baja/${tokenOf(url)}`);
      expect(page.status).toBe(200);
      expect(page.text).toContain("Confirmar la baja");
      expect((await ess.sql("a", "SELECT status FROM customer_marketing_consents WHERE client_id = ?", [clientId]))[0].status).toBe("granted");
      for (let i = 0; i < 2; i++) {
        const r = await post("a", `/baja/${tokenOf(url)}`, { "List-Unsubscribe": "One-Click" });
        expect(r.status).toBe(200);
        expect(r.text).toContain("Baja registrada");
      }
      expect((await ess.sql("a", "SELECT status, source FROM customer_marketing_consents WHERE client_id = ?", [clientId]))[0]).toMatchObject({ status: "withdrawn", source: "public_unsubscribe" });
      const log = await ess.sql("a", "SELECT new_status, actor FROM customer_marketing_consent_log WHERE client_id = ? ORDER BY id", [clientId]);
      expect(log.map((l) => [l.new_status, l.actor])).toEqual([["granted", expect.stringMatching(/^user:/)], ["withdrawn", "public:unsubscribe"]]);
      // Sin clave de Brevo de la empresa: ninguna llamada a Brevo
      expect(ess.mails.slice(mailsBefore).filter((m: any) => "emails" in m)).toEqual([]);
    });

    it("el enlace de una empresa no vale en otra ni manipulado; sin la capacidad no está disponible", async () => {
      expect((await post("b", `/baja/${tokenOf(url)}`, {})).text).toContain(INVALID);
      expect((await get("a", `/baja/${clientId + 1}.${tokenOf(url).split(".")[1]}`)).text).toContain(INVALID);
      await ess.setCapability("a", "email-campaigns", null);
      try {
        expect((await get("a", `/baja/${tokenOf(url)}`)).text).toContain(UNAVAILABLE);
      } finally {
        await ess.setCapability("a", "email-campaigns", "active");
      }
    });
  });
});
