/**
 * Elephant Studio con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): dos empresas nuevas desde
 * la baseline. Módulos nuevos y diseño por bloque guardados en el borrador y publicados; el borrador nunca se publica
 * solo; historial de versiones (incluida la versión anterior a Studio de una página que ya estaba publicada);
 * recuperar una versión como borrador sin tocar la web; las versiones nunca son públicas; cambiar la dirección y
 * eliminar la página arrastran su historial; permisos y aislamiento entre empresas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("Elephant Studio (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let admA: string;
  let admB: string;
  let agA: string;
  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "studio");
    admA = await ess.login("a", "admin");
    admB = await ess.login("b", "admin");
    agA = await ess.login("a", "agente");
    // Las páginas iniciales (portada y textos legales) se crean al abrir la lista
    data(await ess.q("a", "cms.sitePages", undefined, admA));
    data(await ess.q("b", "cms.sitePages", undefined, admB));
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  const studioBlocks = [
    { id: "h1", type: "heading", data: { eyebrow: "Servicios", title: "Lo que hacemos en {{nombre}}", subtitle: "", level: "h1", align: "center" }, style: { background: "soft", padTop: "m", padBottom: "0", hideOn: [], anchor: "inicio-servicios" } },
    { id: "f1", type: "features", data: { title: "Ventajas", intro: "", columns: "3", items: [{ icon: "star", title: "Rápido", text: "En 24 horas" }] } },
    { id: "c1", type: "cta", data: { title: "¿Hablamos?", text: "", buttonLabel: "Escríbenos", buttonUrl: "javascript:alert(1)", secondaryLabel: "", secondaryUrl: "" }, style: { background: "brand", hideOn: ["mobile"] } },
  ];

  it("módulos nuevos y diseño se guardan en el borrador sin publicarse; al publicar llegan a la web con su diseño", async () => {
    expect((await ess.m("a", "cms.createSitePage", { title: "Estudio", slug: "estudio", template: "blank", addToMenu: false }, admA)).status).toBe(200);
    const saved = data(await ess.m("a", "cms.savePageDraft", { slug: "estudio", blocks: studioBlocks }, admA));
    expect(saved.blocks.map((b: any) => b.type)).toEqual(["heading", "features", "cta"]);
    expect(saved.blocks[2].data.buttonUrl).toBe("");
    expect(saved.blocks[0].style).toEqual({ background: "soft", padTop: "m", padBottom: "0", hideOn: [], anchor: "inicio-servicios" });

    const ed = data(await ess.q("a", "cms.pageEditor", { slug: "estudio" }, admA));
    expect(ed.source).toBe("draft");
    expect(ed.blocks[2].style).toMatchObject({ background: "brand", hideOn: ["mobile"] });
    // Sin publicar: la web no la muestra y el historial está vacío
    expect(data(await ess.q("a", "public.getTenantPage", { slug: "estudio" })) ?? null).toBeNull();
    expect(data(await ess.q("a", "cms.pageVersions", { slug: "estudio" }, admA))).toEqual([]);

    expect((await ess.m("a", "cms.publishPage", { slug: "estudio" }, admA)).status).toBe(200);
    const pub = data(await ess.q("a", "public.getTenantPage", { slug: "estudio" }));
    expect(pub.blocks.map((b: any) => b.type)).toEqual(["heading", "features", "cta"]);
    expect(pub.blocks[0].style).toMatchObject({ background: "soft", anchor: "inicio-servicios" });
    expect(pub.blocks[0].data.title).not.toContain("{{");
    expect(pub.html).toContain("Ventajas");

    const versions = data(await ess.q("a", "cms.pageVersions", { slug: "estudio" }, admA));
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ number: 1, isCurrent: true, note: "Publicada", blockCount: 3 });
  });

  it("una página que ya estaba publicada guarda su versión anterior a Studio y se puede recuperar como borrador sin tocar la web", async () => {
    const before = data(await ess.q("a", "public.getTenantPage", { slug: "inicio" }));
    expect(before).toBeTruthy();
    expect((await ess.m("a", "cms.publishPage", { slug: "inicio", blocks: studioBlocks }, admA)).status).toBe(200);

    const versions = data(await ess.q("a", "cms.pageVersions", { slug: "inicio" }, admA));
    expect(versions.map((v: any) => v.number)).toEqual([2, 1]);
    expect(versions[1].note).toBe("Versión publicada antes de Elephant Studio");

    // Ver la versión anterior (con los datos de la empresa) y recuperarla como borrador
    const preview = data(await ess.q("a", "cms.pageVersionPreview", { slug: "inicio", id: versions[1].id }, admA));
    expect(preview.blocks.length).toBeGreaterThan(0);
    const restored = data(await ess.m("a", "cms.restorePageVersion", { slug: "inicio", id: versions[1].id }, admA));
    expect(restored.blocks.map((b: any) => b.type)).not.toContain("features");
    const ed = data(await ess.q("a", "cms.pageEditor", { slug: "inicio" }, admA));
    expect(ed.source).toBe("draft");
    // La web sigue mostrando lo publicado hasta que se vuelva a publicar
    const after = data(await ess.q("a", "public.getTenantPage", { slug: "inicio" }));
    expect(after.blocks.map((b: any) => b.type)).toEqual(["heading", "features", "cta"]);

    expect((await ess.m("a", "cms.publishPage", { slug: "inicio" }, admA)).status).toBe(200);
    const republished = data(await ess.q("a", "public.getTenantPage", { slug: "inicio" }));
    expect(republished.blocks.map((b: any) => b.type)).not.toContain("features");
    expect(data(await ess.q("a", "cms.pageVersions", { slug: "inicio" }, admA)).map((v: any) => v.number)).toEqual([3, 2, 1]);
  });

  it("las versiones nunca se leen por la web pública", async () => {
    expect(data(await ess.q("a", "public.getPublicPageBlocks", { slug: "version:inicio" }))).toEqual([]);
    expect(data(await ess.q("a", "public.getPublicPageBlocks", { slug: "version:estudio" }))).toEqual([]);
  });

  it("cambiar la dirección conserva el historial; eliminar la página lo elimina", async () => {
    expect((await ess.m("a", "cms.updatePageSettings", { slug: "estudio", newSlug: "estudio-2", title: "Estudio" }, admA)).status).toBe(200);
    expect(data(await ess.q("a", "cms.pageVersions", { slug: "estudio-2" }, admA))).toHaveLength(1);
    expect((await ess.m("a", "cms.deleteSitePage", { slug: "estudio-2" }, admA)).status).toBe(200);
    // Una página nueva con la misma dirección empieza sin historial
    expect((await ess.m("a", "cms.createSitePage", { title: "Estudio", slug: "estudio-2", template: "blank", addToMenu: false }, admA)).status).toBe(200);
    expect(data(await ess.q("a", "cms.pageVersions", { slug: "estudio-2" }, admA))).toEqual([]);
  });

  it("permisos: el agente no ve ni recupera versiones; los datos de la empresa para el lienzo son solo del equipo", async () => {
    expect((await ess.q("a", "cms.pageVersions", { slug: "inicio" }, agA)).status).toBe(403);
    expect((await ess.m("a", "cms.restorePageVersion", { slug: "inicio", id: 1 }, agA)).status).toBe(403);
    expect((await ess.q("a", "cms.studioTokens", undefined, agA)).status).toBe(403);
    expect((await ess.q("a", "cms.studioTokens")).status).toBe(401);
    expect(data(await ess.q("a", "cms.studioTokens", undefined, admA))).toBeTruthy();
  });

  it("aislamiento: otra empresa no ve ni recupera las versiones de la primera", async () => {
    const versionsA = data(await ess.q("a", "cms.pageVersions", { slug: "inicio" }, admA));
    // La empresa B tiene su propia portada sin historial
    expect(data(await ess.q("b", "cms.pageVersions", { slug: "inicio" }, admB))).toEqual([]);
    // Un identificador de versión de A no existe en B
    expect(errCode(await ess.m("b", "cms.restorePageVersion", { slug: "inicio", id: versionsA[0].id }, admB))).toBe("BAD_REQUEST");
    expect(errCode(await ess.q("b", "cms.pageVersionPreview", { slug: "inicio", id: versionsA[0].id }, admB))).toBe("BAD_REQUEST");
    // La sesión de A no sirve en B
    expect((await ess.q("b", "cms.pageVersions", { slug: "inicio" }, admA)).status).not.toBe(200);
    // La web de B no ha cambiado
    const homeB = data(await ess.q("b", "public.getTenantPage", { slug: "inicio" }));
    expect(homeB.blocks ?? null).toBeNull();
  });
});
