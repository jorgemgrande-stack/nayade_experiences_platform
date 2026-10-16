/**
 * Essential — Web y CMS (cms-editor, cms-domain, cms-pages-forms, cms-blog, cms-seo) con la aplicación
 * real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL). Empresas nuevas desde la baseline. El DNS de
 * la verificación de dominio es un resolvedor FALSO (ninguna consulta real).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, licenseMatrix, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const OP = { type: "operator" as const, id: "prueba" };

describe.skipIf(!URL_)("Essential — Web y CMS (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let admA: string;
  let admB: string;
  let agA: string;
  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "web");
    admA = await ess.login("a", "admin");
    admB = await ess.login("b", "admin");
    agA = await ess.login("a", "agente");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("cms-editor: bloques de página, menú y ajustes del sitio; publicación; aislamiento; permisos; licencia", async () => {
    const blocks = [
      { blockType: "hero", sortOrder: 0, data: { title: "Bienvenidos a A" } },
      { blockType: "text", sortOrder: 1, data: { html: "<p>Quiénes somos</p>" } },
    ];
    expect((await ess.m("a", "cms.upsertPage", { slug: "quienes-somos", title: "Quiénes somos", isPublished: true }, admA)).status).toBe(200);
    expect((await ess.m("a", "cms.savePageBlocks", { pageSlug: "quienes-somos", blocks }, admA)).status).toBe(200);
    expect((await ess.m("a", "cms.createMenuItem", { label: "Quiénes somos", url: "/quienes-somos" }, admA)).status).toBe(200);
    expect((await ess.m("a", "cms.updateSiteSettings", { settings: { brand_primary_color: "#123456" } }, admA)).status).toBe(200);
    // Antes del arreglo (sin la fila sembrada) se respondía bien pero no se guardaba nada
    expect((await ess.sql("a", "SELECT value FROM system_settings WHERE `key` = 'brand_primary_color'"))[0].value).toBe("#123456");
    expect((await ess.sql("b", "SELECT value FROM system_settings WHERE `key` = 'brand_primary_color'"))[0].value).toBe("");

    const pubBlocks = data(await ess.q("a", "public.getPublicPageBlocks", { slug: "quienes-somos" }));
    expect(pubBlocks.map((b: any) => b.blockType)).toEqual(["hero", "text"]);
    expect(data(await ess.q("a", "public.getMenuItems", { zone: "header" })).map((m: any) => m.label)).toContain("Quiénes somos");
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM page_blocks WHERE pageSlug = 'quienes-somos'"))[0].n).toBe(2);

    // B: ni bloques, ni menú, ni página
    expect(data(await ess.q("b", "public.getPublicPageBlocks", { slug: "quienes-somos" }))).toEqual([]);
    expect(data(await ess.q("b", "public.getMenuItems", { zone: "header" }))).toEqual([]);
    expect(data(await ess.q("b", "cms.getPages", undefined, admB))).toEqual([]);
    expect(errCode(await ess.m("a", "cms.createMenuItem", { label: "x" }, agA))).toBe("FORBIDDEN");

    const lic = await licenseMatrix(ess, "cms-editor", {
      query: () => ess.q("a", "cms.getPages", undefined, admA),
      mutation: () => ess.m("a", "cms.createMenuItem", { label: "Bloqueado" }, admA),
    });
    expect(lic.readOnlyQuery?.status).toBe(200);
    expect(isLicenseDenied(lic.readOnlyMutation, "cms-editor")).toBe(true);
    expect(isLicenseDenied(lic.noneQuery, "cms-editor")).toBe(true);
    // La web pública sigue sirviéndose aunque el editor esté en solo lectura (no hay guardián en public.*)
  });

  it("cms-pages-forms: formulario de contacto público → lead de la empresa correcta; páginas no publicadas no se sirven", async () => {
    const r = await ess.m("a", "public.submitLead", { name: "Visitante Web", email: "visitante@web-a.example", message: "Hola" });
    expect(r.status).toBe(200);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM leads WHERE email = 'visitante@web-a.example'"))[0].n).toBe(1);
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM leads"))[0].n).toBe(0);
    expect(errCode(await ess.m("a", "public.submitLead", { name: "X", email: "mal" }))).toBe("BAD_REQUEST");

    expect((await ess.m("a", "cms.upsertPage", { slug: "borrador", title: "Borrador", isPublished: false }, admA)).status).toBe(200);
    const draft = data(await ess.q("a", "public.getPublicPage", { slug: "borrador" }));
    expect(draft ?? null).toBeNull();
    const pub = data(await ess.q("a", "public.getPublicPage", { slug: "quienes-somos" }));
    expect(pub?.title).toBe("Quiénes somos");
  });

  it("cms-seo: título y descripción por página; sitemap y robots con la URL de la empresa y sin rutas de otra instalación", async () => {
    expect((await ess.m("a", "cms.upsertPage", { slug: "servicios", title: "Servicios", isPublished: true, metaTitle: "Servicios | A", metaDescription: "Lo que hacemos" }, admA)).status).toBe(200);
    expect((await ess.sql("a", "SELECT metaTitle, metaDescription FROM static_pages WHERE slug = 'servicios'"))[0]).toEqual({ metaTitle: "Servicios | A", metaDescription: "Lo que hacemos" });

    const sm = await ess.call("a", "GET", "/sitemap.xml");
    expect(sm.status).toBe(200);
    expect(sm.text).toContain(`<loc>https://${ess.host("a")}/</loc>`);
    expect(sm.text).toContain(`https://${ess.host("a")}/servicios`);
    expect(sm.text).not.toContain("/borrador");
    expect(sm.text).not.toMatch(/skicenter|nayade|\/hotel|\/spa|\/restaurantes|lego-packs/i);
    const smB = await ess.call("b", "GET", "/sitemap.xml");
    expect(smB.text).not.toContain(ess.host("a"));
    expect(smB.text).not.toContain("/servicios");

    const robots = await ess.call("a", "GET", "/robots.txt");
    expect(robots.status).toBe(200);
    expect(robots.text).toContain(`Sitemap: https://${ess.host("a")}/sitemap.xml`);
    expect(robots.text).not.toMatch(/nayade/i);
  });

  it("cms-domain: dominio propio verificado (operador) → la web y el sitemap de la empresa se sirven en él", async () => {
    const custom = `www.${ess.ids.a}.example`;
    const { verifyAndRecordDomain, expectedTxtValue, VERIFY_LABEL } = await import("./_core/tenantRegistry/domainVerification");
    await ess.registry.service.addDomain(ess.ids.a, custom, "custom", OP);
    // Pendiente: no se sirve
    expect((await ess.callHost(custom, "GET", "/sitemap.xml")).status).toBe(404);
    const token = (await ess.registry.store.resolveDomain(custom))!.domain.verificationToken!;
    const target = "edge.elephantsource.example";
    const dns = {
      resolveCname: async (h: string) => (h === custom ? [target] : Promise.reject(new Error("ENODATA"))),
      resolveTxt: async (h: string) => (h === `${VERIFY_LABEL}.${custom}` ? [[expectedTxtValue(token)]] : Promise.reject(new Error("ENODATA"))),
    };
    const v = await verifyAndRecordDomain({ reader: ess.registry.store, service: ess.registry.service }, { domain: custom, platformTarget: target }, OP, dns);
    expect(v?.ok).toBe(true);
    await ess.registry.service.activateDomain(custom, OP);
    await ess.registry.service.setPrimaryDomain(ess.ids.a, custom, OP);
    ess.refreshTenant("a", [custom]);
    const sm = await ess.callHost(custom, "GET", "/sitemap.xml");
    expect(sm.status).toBe(200);
    expect(sm.text).toContain(`<loc>https://${custom}/</loc>`);
    // No hay autoservicio desde el panel de la empresa: ningún procedimiento tRPC de dominios
    const { appRouter } = await import("./routers");
    expect(Object.keys((appRouter as any)._def.procedures).filter((p) => /domain/i.test(p))).toEqual([]);
  });

  it("cms-blog: no existe ningún procedimiento ni tabla de blog (NO IMPLEMENTADA)", async () => {
    const { appRouter } = await import("./routers");
    expect(Object.keys((appRouter as any)._def.procedures).filter((p) => /blog|[.](list|create|update|get)Posts?$/i.test(p))).toEqual([]);
    expect(await ess.sql("a", "SHOW TABLES LIKE '%blog%'")).toEqual([]);
  });
});
