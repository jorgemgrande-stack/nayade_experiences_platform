/**
 * Menú dinámico por manifiesto (`panel.navigation`) con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL): dos empresas nuevas con Essential. Contratar un extra en una empresa hace aparecer
 * SOLO en ella la entrada declarada en el manifiesto; suspender la retira y su API responde 403; el rol cuenta;
 * los datos no se tocan.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("panel.navigation — aportaciones de extensiones por licencia (aplicación real, dos empresas)", () => {
  let ess: EssentialApp;
  let admA: string;
  let admB: string;
  let agA: string;
  let userA: string;
  const nav = async (co: "a" | "b", cookie: string) => data(await ess.q(co, "panel.navigation", undefined, cookie)) as { entries: Array<{ moduleId: string; kind: string; item?: { key: string; href: string } }>; routes: Array<{ path: string; capabilities: string[] }> };
  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "nav");
    admA = await ess.login("a", "admin");
    admB = await ess.login("b", "admin");
    agA = await ess.login("a", "agente");
    userA = await ess.login("a", "user");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("solo Essential: ninguna aportación, pero las rutas de todas las extensiones para bloquearlas", async () => {
    for (const [co, c] of [["a", admA], ["b", admB]] as const) {
      const n = await nav(co, c);
      expect(n.entries).toEqual([]);
      expect(n.routes).toEqual(expect.arrayContaining([{ path: "/admin/personal", capabilities: ["people-hr"] }, { path: "/admin/hotel", capabilities: ["hotel-net"] }]));
    }
    // API de la extensión sin contratar: 403 del guardián de capacidades
    expect(isLicenseDenied(await ess.q("a", "hr.employees.counters", undefined, admA), "people-hr")).toBe(true);
  });

  it("contratar en A → aparece la entrada del manifiesto solo en A; el rol cuenta; suspender la retira sin borrar datos", async () => {
    await ess.setCapability("a", "people-hr", "active");
    const a = await nav("a", admA);
    expect(a.entries.map((e) => [e.moduleId, e.item?.key])).toEqual([["people", "x-people-personal"]]);
    expect((await nav("b", admB)).entries).toEqual([]);
    // Las entradas de Elephant People son de la administración: el equipo no las ve
    expect((await nav("a", agA)).entries).toEqual([]);
    expect(errCode(await ess.q("a", "panel.navigation", undefined, userA))).toBe("FORBIDDEN");
    // Con licencia, la API ya no la rechaza el guardián de capacidades
    expect(isLicenseDenied(await ess.q("a", "hr.employees.counters", undefined, admA), "people-hr")).toBe(false);
    const before = (await ess.sql("a", "SELECT COUNT(*) AS n FROM users"))[0].n;

    await ess.setCapability("a", "people-hr", "suspended");
    expect((await nav("a", admA)).entries).toEqual([]);
    expect(isLicenseDenied(await ess.q("a", "hr.employees.counters", undefined, admA), "people-hr")).toBe(true);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM users"))[0].n).toBe(before);

    // Solo lectura: se ve (marcada en el menú) y la API consulta pero no modifica
    await ess.setCapability("a", "people-hr", "read_only");
    expect((await nav("a", admA)).entries.map((e) => e.moduleId)).toEqual(["people"]);
    await ess.setCapability("a", "people-hr", null);
  });

  it("módulo con licencia propia (Hotel Net): la capacidad sola no basta, falta la licencia de módulo", async () => {
    await ess.setCapability("a", "hotel-net", "active");
    try {
      expect((await nav("a", admA)).entries.map((e) => e.moduleId)).not.toContain("hotel");
      expect((await ess.q("a", "hotel.getRoomTypes", undefined, admA)).status).toBe(403);
    } finally {
      await ess.setCapability("a", "hotel-net", null);
    }
  });
});
