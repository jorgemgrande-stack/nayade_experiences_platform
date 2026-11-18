/**
 * Sesiones de convocatoria (migración 0077) con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL).
 * Dos empresas sintéticas nuevas; ningún cobro ni pedido.
 *  - Serie semanal, alta, edición, estado y borrado de sesiones; validación y duplicados en el servidor.
 *  - Las fechas de la convocatoria salen de la primera y la última sesión.
 *  - La web enseña las fechas (y «hora por confirmar») sin la nota interna.
 *  - Solo administración; aislamiento entre empresas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";
import { localToUtcMs } from "../shared/editions";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

const form = (over: Record<string, unknown> = {}) => ({
  label: "RECONNECT LIVE",
  startsLocal: "2036-11-01T10:00",
  endsLocal: null,
  timezone: "Europe/Madrid",
  scheduleNote: "",
  mode: "online",
  locationNote: "",
  capacity: 20,
  showAvailability: false,
  status: "open",
  priceOverride: null,
  ...over,
});
const session = (over: Record<string, unknown> = {}) => ({ startsOn: "2036-12-28", startTime: null, durationMinutes: 90, timezone: "Europe/Madrid", title: "", status: "scheduled", privateNote: "", ...over });

describe.skipIf(!URL_)("Sesiones de convocatoria (aplicación real)", () => {
  let ess: EssentialApp;
  let admA = "";
  let admB = "";
  let agA = "";
  let prod = 0;
  let edition = 0;

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "sesion");
    admA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    admB = await ess.login("b", "admin");
    expect((await ess.m("a", "products.createCategory", { slug: "formacion", name: "Formación" }, admA)).status).toBe(200);
    expect((await ess.m("a", "products.createLocation", { slug: "online", name: "Online" }, admA)).status).toBe(200);
    const cat = (await ess.sql("a", "SELECT id FROM categories LIMIT 1"))[0].id;
    const loc = (await ess.sql("a", "SELECT id FROM locations LIMIT 1"))[0].id;
    expect((await ess.m("a", "products.create", { productType: "own", slug: "reconnect-live", title: "Reconnect Live", categoryId: cat, locationId: loc, offerMode: "on_request" }, admA)).status).toBe(200);
    prod = (await ess.sql("a", "SELECT id FROM experiences WHERE slug = 'reconnect-live'"))[0].id;
    const r = await ess.m("a", "products.editions.create", { experienceId: prod, form: form() }, admA);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    edition = data(r).id;
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("serie semanal de 4 sesiones con la hora por confirmar: fechas de la convocatoria derivadas", async () => {
    const r = await ess.m("a", "products.editions.sessions.weekly", { editionId: edition, firstDate: "2036-11-30", count: 4, startTime: null, durationMinutes: 90 }, admA);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const list = data(r) as any[];
    expect(list.map((s) => [s.position, s.startsOn, s.startTime])).toEqual([[1, "2036-11-30", null], [2, "2036-12-07", null], [3, "2036-12-14", null], [4, "2036-12-21", null]]);
    const [row] = await ess.sql("a", "SELECT starts_at, ends_at FROM product_editions WHERE id = ?", [edition]);
    expect(Number(row.starts_at)).toBe(localToUtcMs("2036-11-30T00:00", "Europe/Madrid"));
    expect(Number(row.ends_at)).toBe(localToUtcMs("2036-12-21T23:59", "Europe/Madrid"));
    const eds = data(await ess.q("a", "products.editions.list", { experienceId: prod }, admA)) as any[];
    expect(eds[0].sessionCount).toBe(4);
  });

  it("alta y edición con hora y nota interna; duplicados y validación rechazados", async () => {
    const c = await ess.m("a", "products.editions.sessions.create", { editionId: edition, form: session({ privateNote: "https://zoom.example/j/1" }) }, admA);
    expect(c.status, JSON.stringify(c.json)).toBe(200);
    const id = data(c).id;
    expect(errCode(await ess.m("a", "products.editions.sessions.create", { editionId: edition, form: session() }, admA))).toBe("CONFLICT");
    expect(errCode(await ess.m("a", "products.editions.sessions.create", { editionId: edition, form: session({ startsOn: "2036-02-30" }) }, admA))).toBe("BAD_REQUEST");
    const u = await ess.m("a", "products.editions.sessions.update", { id, form: session({ startTime: "18:00", privateNote: "https://zoom.example/j/1" }) }, admA);
    expect(u.status, JSON.stringify(u.json)).toBe(200);
    expect(data(u)).toMatchObject({ startTime: "18:00", privateNote: "https://zoom.example/j/1", position: 5 });
    const [row] = await ess.sql("a", "SELECT ends_at FROM product_editions WHERE id = ?", [edition]);
    expect(Number(row.ends_at)).toBe(localToUtcMs("2036-12-28T19:30", "Europe/Madrid"));
  });

  it("la web enseña las sesiones sin nota interna ni canceladas", async () => {
    const list = data(await ess.q("a", "products.editions.sessions.list", { editionId: edition }, admA)) as any[];
    expect((await ess.m("a", "products.editions.sessions.setStatus", { id: list[1].id, status: "cancelled" }, admA)).status).toBe(200);
    const pub = await ess.q("a", "public.getExperiences", { limit: 12, offset: 0, editions: { experienceId: prod } });
    expect(pub.status).toBe(200);
    expect(pub.text).not.toMatch(/zoom|privateNote|private_note/);
    const ed = (data(pub) as any[]).find((e) => e.id === edition);
    expect(ed.sessions.map((s: any) => [s.startsOn, s.startTime])).toEqual([["2036-11-30", null], ["2036-12-14", null], ["2036-12-21", null], ["2036-12-28", "18:00"]]);
  });

  it("borrar una sesión renumera; orden manual solo con el conjunto exacto", async () => {
    const list = data(await ess.q("a", "products.editions.sessions.list", { editionId: edition }, admA)) as any[];
    expect((await ess.m("a", "products.editions.sessions.delete", { id: list[0].id }, admA)).status).toBe(200);
    const after = data(await ess.q("a", "products.editions.sessions.list", { editionId: edition }, admA)) as any[];
    expect(after.map((s) => s.position)).toEqual([1, 2, 3, 4]);
    expect(errCode(await ess.m("a", "products.editions.sessions.reorder", { editionId: edition, ids: [after[0].id] }, admA))).toBe("BAD_REQUEST");
    const rev = after.map((s) => s.id).reverse();
    expect(data(await ess.m("a", "products.editions.sessions.reorder", { editionId: edition, ids: rev }, admA)).map((s: any) => s.id)).toEqual(rev);
  });

  it("solo administración y sin cruzar empresas", async () => {
    expect((await ess.m("a", "products.editions.sessions.create", { editionId: edition, form: session({ startsOn: "2037-01-04" }) }, agA)).status).not.toBe(200);
    expect(errCode(await ess.m("b", "products.editions.sessions.create", { editionId: edition, form: session({ startsOn: "2037-01-04" }) }, admB))).toBe("NOT_FOUND");
    expect(data(await ess.q("b", "products.editions.sessions.list", { editionId: edition }, admB))).toEqual([]);
  });
});
