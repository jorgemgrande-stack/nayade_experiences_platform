/**
 * Restaurant Net · cocina (KDS) y camareros con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL):
 * dos empresas nuevas desde la baseline y las migraciones de empresa (0033 sala y 0035 cocina). Partidas y enrutado
 * por categoría, marchar a cocina (todo o por pase), pantalla de cocina por partida con estados y tiempos, deshacer un
 * paso, la sala ve el estado de cada línea, servir mesa, semáforo, incidencias, métricas, camareros del Core,
 * licencia, aislamiento y respuesta sin la migración de cocina. Ningún cobro real.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { startEssentialApp, data, errCode, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "restaurant-net";
const OP = { type: "operator" as const, id: "prueba-restaurant-kds" };

describe.skipIf(!URL_)("Restaurant Net · cocina (KDS) y camareros (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let adB: string;
  let rest = 0;
  const t: Record<string, number> = {};
  const menu: Record<string, number> = {};
  let order = 0;

  const m = (proc: string, input: unknown, cookie = adA) => ess.m("a", `restaurantNet.${proc}`, input, cookie);
  const q = (proc: string, input: unknown, cookie = adA) => ess.q("a", `restaurantNet.${proc}`, input, cookie);
  const ok = async (p: Promise<{ status: number; json: any; text: string }>) => {
    const r = await p;
    if (r.status !== 200) throw new Error(`${r.status}: ${r.text.slice(0, 400)}`);
    return data(r);
  };
  const lineOf = async (name: string) => (await ok(q("getOrder", { orderId: order }))).items.find((i: any) => i.name === name);

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "restkds");
    const { EntitlementAdmin } = await import("./_core/modules/mysqlEntitlements");
    const ent = new EntitlementAdmin((ess.registry.store as any).q);
    for (const co of ["a", "b"] as const) await ent.grant(ess.ids[co], "restaurants", OP);
    adA = await ess.login("a", "admin");
    adB = await ess.login("b", "admin");
    await ess.sql("a", "INSERT INTO restaurants (slug, name) VALUES ('casa-kds', 'Casa KDS')");
    rest = (await ess.sql("a", "SELECT id FROM restaurants WHERE slug = 'casa-kds'"))[0].id;
    await ess.sql("b", "INSERT INTO restaurants (slug, name) VALUES ('otra-kds', 'Otra KDS')");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("sin la capacidad no hay pantalla de cocina", async () => {
    expect(isLicenseDenied(await q("kdsBoard", { restaurantId: rest }), CAP)).toBe(true);
    await ess.setCapability("a", CAP, "active");
    await ess.setCapability("b", CAP, "active");
  });

  it("partidas, enrutado por categoría y semáforo", async () => {
    await ok(m("upsertStation", { restaurantId: rest, name: "Cocina", tone: "warning", slaMinutes: 15 }));
    const barra = (await ok(m("upsertStation", { restaurantId: rest, name: "Bar", tone: "info", slaMinutes: 3 }))).id;
    expect(errCode(await m("upsertStation", { restaurantId: rest, name: "Cocina" }))).toBe("CONFLICT");
    // Renombrar la partida arrastra el enrutado
    await ok(m("setRouting", { restaurantId: rest, category: "Bebidas", station: "Bar" }));
    await ok(m("upsertStation", { id: barra, restaurantId: rest, name: "Barra", tone: "info", slaMinutes: 3 }));
    expect(await ok(q("listRouting", { restaurantId: rest }))).toEqual([{ category: "Bebidas", station: "Barra" }]);
    expect(errCode(await m("setRouting", { restaurantId: rest, category: "Postres", station: "No existe" }))).toBe("NOT_FOUND");
    await ok(m("setRouting", { restaurantId: rest, category: "Postres", station: "Cocina" }));
    await ok(m("setRouting", { restaurantId: rest, category: "Postres", station: null }));
    expect((await ok(q("listRouting", { restaurantId: rest }))).map((r: any) => r.category)).toEqual(["Bebidas"]);
    expect(await ok(q("getKdsSettings", { restaurantId: rest }))).toEqual({ greenMaxMin: 10, amberMaxMin: 20 });
    expect(errCode(await m("setKdsSettings", { restaurantId: rest, greenMaxMin: 20, amberMaxMin: 10 }))).toBe("BAD_REQUEST");
    await ok(m("setKdsSettings", { restaurantId: rest, greenMaxMin: 8, amberMaxMin: 16 }));
    expect(await ok(q("getKdsSettings", { restaurantId: rest }))).toEqual({ greenMaxMin: 8, amberMaxMin: 16 });
  });

  it("al pedir, la partida sale del enrutado de la categoría o del propio plato", async () => {
    const room = (await ok(m("createRoom", { restaurantId: rest, name: "Salón" }))).id;
    for (const code of ["1", "2"]) t[code] = (await ok(m("createTable", { roomId: room, code }))).id;
    menu.vino = (await ok(m("upsertMenuItem", { restaurantId: rest, name: "Vino", category: "Bebidas", price: 3, taxRate: 21, station: "Cocina" }))).id;
    menu.arroz = (await ok(m("upsertMenuItem", { restaurantId: rest, name: "Arroz", category: "Principales", price: 15, taxRate: 10, station: "Cocina" }))).id;
    menu.tarta = (await ok(m("upsertMenuItem", { restaurantId: rest, name: "Tarta", category: "Postres", price: 6, taxRate: 10 }))).id;
    order = (await ok(m("openOrder", { tableId: t["1"], guests: 2 }))).id;
    await ok(m("addItem", { orderId: order, menuItemId: menu.vino, quantity: 2 }));
    await ok(m("addItem", { orderId: order, menuItemId: menu.arroz, quantity: 2 }));
    await ok(m("addItem", { orderId: order, menuItemId: menu.tarta, quantity: 2, course: 2 }));
    expect((await lineOf("Vino")).station).toBe("Barra");
    expect((await lineOf("Arroz")).station).toBe("Cocina");
    expect((await lineOf("Tarta")).station).toBeNull();
  });

  it("marchar: solo lo pendiente (primero el pase 1), con su hora; nada que marchar es un aviso", async () => {
    expect(await ok(q("kdsBoard", { restaurantId: rest }))).toMatchObject({ lines: [] });
    expect((await ok(m("fireItems", { orderId: order, course: 1 }))).fired).toBe(2);
    expect(errCode(await m("fireItems", { orderId: order, course: 1 }))).toBe("BAD_REQUEST");
    expect((await lineOf("Tarta")).status).toBe("pending");
    const board = await ok(q("kdsBoard", { restaurantId: rest }));
    expect(board.lines.map((l: any) => [l.name, l.status, l.tableCode])).toEqual([["Vino", "sent", "1"], ["Arroz", "sent", "1"]]);
    expect(board.lines.every((l: any) => l.firedAt > 0)).toBe(true);
    expect(board.settings).toEqual({ greenMaxMin: 8, amberMaxMin: 16 });
    expect((await ok(q("kdsBoard", { restaurantId: rest, station: "Barra" }))).lines.map((l: any) => l.name)).toEqual(["Vino"]);
    // Una línea marchada ya no cambia de unidades: se anula con motivo
    expect(errCode(await m("setItemQty", { itemId: (await lineOf("Arroz")).id, quantity: 3 }))).toBe("BAD_REQUEST");
  });

  it("cocina avanza estados con sus tiempos, deshace un paso y la sala lo ve en la comanda", async () => {
    const arroz = (await lineOf("Arroz")).id;
    await ok(m("setKitchenStatus", { itemId: arroz, status: "preparing" }));
    await ok(m("setKitchenStatus", { itemId: arroz, status: "ready" }));
    let [row] = await ess.sql("a", "SELECT status, prep_started_at, ready_at FROM hospo_order_items WHERE id = ?", [arroz]);
    expect(row.status).toBe("ready");
    expect(Number(row.ready_at)).toBeGreaterThanOrEqual(Number(row.prep_started_at));
    await ok(m("setKitchenStatus", { itemId: arroz, status: "preparing" }));
    [row] = await ess.sql("a", "SELECT status, ready_at FROM hospo_order_items WHERE id = ?", [arroz]);
    expect(row).toEqual({ status: "preparing", ready_at: null });
    expect(errCode(await m("setKitchenStatus", { itemId: (await lineOf("Tarta")).id, status: "ready" }))).toBe("BAD_REQUEST");
    // Saltar pasos: lista directamente (sella también la preparación)
    const vino = (await lineOf("Vino")).id;
    await ok(m("setKitchenStatus", { itemId: vino, status: "ready" }));
    [row] = await ess.sql("a", "SELECT prep_started_at, ready_at FROM hospo_order_items WHERE id = ?", [vino]);
    expect(Number(row.prep_started_at)).toBeGreaterThan(0);
    // La sala: estado de cada línea y aviso de platos listos en el plano
    const d = await ok(q("getOrder", { orderId: order }));
    expect(d.items.map((i: any) => [i.name, i.status])).toEqual([["Vino", "ready"], ["Arroz", "preparing"], ["Tarta", "pending"]]);
    const floor = await ok(q("getFloor", { restaurantId: rest }));
    expect(floor.openOrders.find((o: any) => o.id === order)).toMatchObject({ readyItems: 1, liveItems: 3 });
  });

  it("servir mesa: las listas pasan a servidas y salen de la pantalla; prioridad alta va primero", async () => {
    expect((await ok(m("serveReady", { orderId: order }))).served).toBe(1);
    expect((await lineOf("Vino")).status).toBe("served");
    const o2 = (await ok(m("openOrder", { tableId: t["2"], guests: 1 }))).id;
    await ok(m("addItem", { orderId: o2, menuItemId: menu.arroz, quantity: 1 }));
    await ok(m("fireItems", { orderId: o2 }));
    await ok(m("setPriority", { orderId: o2, priority: "high" }));
    const board = await ok(q("kdsBoard", { restaurantId: rest }));
    expect(board.lines.map((l: any) => [l.orderId, l.name])).toEqual([[o2, "Arroz"], [order, "Arroz"]]);
    await ok(m("releaseTable", { orderId: o2, reason: "Prueba de prioridad" }));
    // Una comanda cerrada sale de la pantalla
    expect((await ok(q("kdsBoard", { restaurantId: rest }))).lines.map((l: any) => l.orderId)).toEqual([order]);
  });

  it("incidencias y métricas del día", async () => {
    const arroz = (await lineOf("Arroz")).id;
    await ok(m("createIncident", { orderId: order, itemId: arroz, type: "remake", reason: "Se pasó de punto" }));
    expect(errCode(await m("createIncident", { orderId: order, itemId: 999999, type: "remake" }))).toBe("NOT_FOUND");
    const inc = await ok(q("listIncidents", { restaurantId: rest }));
    expect(inc).toHaveLength(1);
    expect(inc[0]).toMatchObject({ type: "remake", itemName: "Arroz", tableCode: "1", reason: "Se pasó de punto" });
    await ok(m("setKitchenStatus", { itemId: arroz, status: "served" }));
    const met = await ok(q("kitchenMetrics", { restaurantId: rest }));
    expect(met.totals).toMatchObject({ incidents: 1, lateCount: 0 });
    expect(met.totals.lines).toBe(3);
    expect(met.byStation.map((s: any) => s.station).sort()).toEqual(["Barra", "Cocina"]);
  });

  it("camareros: usuarios del Core asignados al restaurante; ningún otro", async () => {
    const email = "camarera@empresa-a.example";
    await ess.sql("a", "INSERT INTO users (openId, name, email, loginMethod, role, isActive, passwordHash, inviteAccepted) VALUES ('local_camarera_a', 'Camarera Ficticia', ?, 'local', 'adminrest', 1, ?, 1)", [email, await bcrypt.hash("clave-camarera-1", 4)]);
    const [u] = await ess.sql("a", "SELECT id FROM users WHERE email = ?", [email]);
    const agente = await ess.userId("a", "agente");
    expect(errCode(await m("assignWaiter", { orderId: order, userId: u.id }))).toBe("BAD_REQUEST");
    await ess.sql("a", "INSERT INTO restaurant_staff (userId, restaurantId) VALUES (?, ?)", [u.id, rest]);
    const waiters = await ok(q("listWaiters", { restaurantId: rest }));
    expect(waiters.map((w: any) => w.id)).toContain(u.id);
    expect(waiters.map((w: any) => w.id)).not.toContain(agente);
    await ok(m("assignWaiter", { orderId: order, userId: u.id }));
    expect((await ok(q("getOrder", { orderId: order }))).waiter).toEqual({ id: u.id, name: "Camarera Ficticia" });
    expect((await ok(q("getFloor", { restaurantId: rest }))).openOrders.find((o: any) => o.id === order).waiterUserId).toBe(u.id);
    expect(errCode(await m("assignWaiter", { orderId: order, userId: agente }))).toBe("BAD_REQUEST");
    // La camarera entra con su cuenta del Core y ve su cocina
    const login = await ess.call("a", "POST", "/api/auth/login", { body: { email, password: "clave-camarera-1" } });
    expect(login.status).toBe(200);
    expect((await q("kdsBoard", { restaurantId: rest }, login.cookie!)).status).toBe(200);
    await ok(m("assignWaiter", { orderId: order, userId: null }));
    expect((await ok(q("getOrder", { orderId: order }))).waiter).toBeNull();
  });

  it("aislamiento: la otra empresa no ve ni toca la cocina de esta", async () => {
    const [rb] = await ess.sql("b", "SELECT id FROM restaurants");
    expect((await ok(ess.q("b", "restaurantNet.kdsBoard", { restaurantId: rb.id }, adB))).lines).toEqual([]);
    expect(errCode(await ess.m("b", "restaurantNet.fireItems", { orderId: order }, adB))).toBe("NOT_FOUND");
    expect(errCode(await ess.m("b", "restaurantNet.setKitchenStatus", { itemId: 1, status: "ready" }, adB))).toBe("NOT_FOUND");
  });

  it("sin la migración de cocina: la pantalla lo dice y pedir platos sigue funcionando", async () => {
    await ess.sql("a", "RENAME TABLE hospo_station_routing TO hospo_station_routing_fuera");
    await ess.sql("a", "RENAME TABLE hospo_kitchen_stations TO hospo_kitchen_stations_fuera");
    try {
      const r = await q("kdsBoard", { restaurantId: rest });
      expect(errCode(r)).toBe("PRECONDITION_FAILED");
      expect(r.json.error.json.message).toMatch(/cocina \(KDS\).*aún no está instalada/);
      await ok(m("addItem", { orderId: order, menuItemId: menu.vino, quantity: 1 }));
      const vinos = (await ok(q("getOrder", { orderId: order }))).items.filter((i: any) => i.name === "Vino");
      expect(vinos.at(-1).station).toBe("Cocina");
    } finally {
      await ess.sql("a", "RENAME TABLE hospo_kitchen_stations_fuera TO hospo_kitchen_stations");
      await ess.sql("a", "RENAME TABLE hospo_station_routing_fuera TO hospo_station_routing");
    }
  });
});
