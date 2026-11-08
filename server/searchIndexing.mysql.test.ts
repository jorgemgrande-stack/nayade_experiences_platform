/**
 * Ocultar la web a los buscadores con la aplicación real (dos empresas): solo la que lo activa deja de indexarse.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("web oculta a los buscadores (aplicación real, dos empresas)", () => {
  let ess: EssentialApp;
  let admA: string;
  let agA: string;
  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "noindex");
    admA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("por defecto se indexa; al ocultarla, robots, sitemap y páginas lo indican solo en esa empresa; se puede revertir", async () => {
    expect(data(await ess.q("a", "config.getSearchIndexing", undefined, admA))).toEqual({ off: false, available: true });
    expect((await ess.call("a", "GET", "/robots.txt")).text).toContain("Allow: /");

    // Solo el administrador decide
    expect(errCode(await ess.m("a", "config.setSearchIndexing", { off: true }, agA))).toBe("FORBIDDEN");
    expect(data(await ess.m("a", "config.setSearchIndexing", { off: true }, admA))).toEqual({ off: true });

    const robots = await ess.call("a", "GET", "/robots.txt");
    expect(robots.text).toBe("User-agent: *\nDisallow: /\n");
    const sm = await ess.call("a", "GET", "/sitemap.xml");
    expect(sm.status).toBe(200);
    expect(sm.text).not.toContain("<url>");
    // La otra empresa sigue igual
    expect((await ess.call("b", "GET", "/robots.txt")).text).toContain(`Sitemap: https://${ess.host("b")}/sitemap.xml`);
    expect((await ess.call("b", "GET", "/sitemap.xml")).text).toContain("<url>");
    // Registro de cambios
    const log = await ess.sql("a", "SELECT new_value AS v FROM config_change_logs WHERE `key` = 'site_noindex' ORDER BY id DESC LIMIT 1");
    expect(log[0].v).toBe("1");

    expect(data(await ess.m("a", "config.setSearchIndexing", { off: false }, admA))).toEqual({ off: false });
    expect((await ess.call("a", "GET", "/robots.txt")).text).toContain("Allow: /");
  });
});
