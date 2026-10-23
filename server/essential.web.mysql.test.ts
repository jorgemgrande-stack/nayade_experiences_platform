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

  it("ubicaciones: cada web muestra solo sus lugares de servicio y su texto de presentación", async () => {
    expect((await ess.m("a", "products.createLocation", { slug: "sede-a", name: "Sede de A", address: "Calle de A 1" }, admA)).status).toBe(200);
    expect((await ess.m("b", "products.createLocation", { slug: "sede-b", name: "Sede de B", address: "Calle de B 2" }, admB)).status).toBe(200);
    expect(data(await ess.q("a", "public.getLocations")).map((l: any) => l.name)).toEqual(["Sede de A"]);
    expect(data(await ess.q("b", "public.getLocations")).map((l: any) => l.name)).toEqual(["Sede de B"]);

    expect((await ess.m("a", "cms.savePageContent", { slug: "ubicaciones", title: "Ubicaciones", content: "<p>Cómo llegar a A</p>", isPublished: true }, admA)).status).toBe(200);
    expect(data(await ess.q("a", "public.getTenantPage", { slug: "ubicaciones" })).html).toContain("Cómo llegar a A");
    expect(data(await ess.q("b", "public.getTenantPage", { slug: "ubicaciones" })) ?? null).toBeNull();
  });

  it("cms-content: portada y páginas propias; la web de cada empresa solo sirve su contenido; legales en borrador fuera del menú", async () => {
    // A edita su portada y publica una página nueva
    expect((await ess.m("a", "cms.savePageContent", { slug: "inicio", title: "Inicio", content: "<h1>Portada de A</h1><script>x()</script>", isPublished: true }, admA)).status).toBe(200);
    expect((await ess.m("a", "cms.savePageContent", { slug: "novedades", title: "Novedades", content: "<p>Solo de A</p>", isPublished: true }, admA)).status).toBe(200);
    const home = data(await ess.q("a", "public.getTenantPage", { slug: "inicio" }));
    expect(home.html).toContain("Portada de A");
    expect(home.html).not.toContain("<script");
    expect(data(await ess.q("a", "public.getTenantPage", { slug: "novedades" })).html).toContain("Solo de A");

    // B no ve nada de A
    expect(data(await ess.q("b", "public.getTenantPage", { slug: "inicio" })) ?? null).toBeNull();
    expect(data(await ess.q("b", "public.getTenantPage", { slug: "novedades" })) ?? null).toBeNull();
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM static_pages WHERE content LIKE '%de A%'"))[0].n).toBe(0);

    // B edita su propia portada: cada web, la suya
    expect((await ess.m("b", "cms.savePageContent", { slug: "inicio", title: "Inicio", content: "<h1>Portada de B</h1>", isPublished: true }, admB)).status).toBe(200);
    expect(data(await ess.q("b", "public.getTenantPage", { slug: "inicio" })).html).toContain("Portada de B");
    expect(data(await ess.q("a", "public.getTenantPage", { slug: "inicio" })).html).toContain("Portada de A");

    // Texto legal en borrador: ni se sirve ni aparece en el menú de pie; al publicarlo, sí
    expect((await ess.m("a", "cms.savePageContent", { slug: "aviso-legal", title: "Aviso legal", content: "<p>Pendiente de revisar</p>", isPublished: false }, admA)).status).toBe(200);
    expect((await ess.m("a", "cms.createMenuItem", { label: "Aviso legal", url: "/aviso-legal", menuZone: "footer" }, admA)).status).toBe(200);
    expect(data(await ess.q("a", "public.getTenantPage", { slug: "aviso-legal" })) ?? null).toBeNull();
    expect(data(await ess.q("a", "public.getMenuItems", { zone: "footer" })).map((m: any) => m.url)).not.toContain("/aviso-legal");
    expect((await ess.m("a", "cms.savePageContent", { slug: "aviso-legal", title: "Aviso legal", content: "<p>Titular: A</p>", isPublished: true }, admA)).status).toBe(200);
    expect(data(await ess.q("a", "public.getMenuItems", { zone: "footer" })).map((m: any) => m.url)).toContain("/aviso-legal");
    expect(data(await ess.q("b", "public.getMenuItems", { zone: "footer" })).map((m: any) => m.url)).not.toContain("/aviso-legal");

    // Solo administradores
    expect(errCode(await ess.m("a", "cms.savePageContent", { slug: "x", title: "X", content: "", isPublished: true }, agA))).toBe("FORBIDDEN");
  });

  it("grupos: la solicitud de un grupo llega solo al CRM de su empresa, como solicitud «Grupos»", async () => {
    const r = await ess.m("a", "public.submitColegiosLead", {
      name: "Laura Coordinadora", email: "laura@colegio-a.example", phone: "600000000", organizationName: "Colegio de prueba",
      groupType: "Colegio o instituto", childrenCount: 40, monitorsCount: 4, comments: "Excursión de fin de curso",
    });
    expect(r.status).toBe(200);
    const [lead] = await ess.sql("a", "SELECT company, selectedCategory, numberOfPersons FROM leads WHERE email = 'laura@colegio-a.example'");
    expect(lead).toEqual({ company: "Colegio de prueba", selectedCategory: "Grupos", numberOfPersons: 44 });
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM leads WHERE email = 'laura@colegio-a.example'"))[0].n).toBe(0);
    expect(errCode(await ess.m("a", "public.submitColegiosLead", { name: "X", email: "mal", phone: "1", organizationName: "" }))).toBe("BAD_REQUEST");
  });

  it("portada: el carrusel y los destacados de cada web son solo los de su empresa", async () => {
    expect((await ess.m("a", "cms.createSlideshowItem", { imageUrl: "https://cdn.example/a-portada.jpg", title: "Bienvenidos a A" }, admA)).status).toBe(200);
    expect(data(await ess.q("a", "public.getSlideshowItems")).map((x: any) => x.title)).toEqual(["Bienvenidos a A"]);
    expect(data(await ess.q("b", "public.getSlideshowItems"))).toEqual([]);
    expect(data(await ess.q("b", "public.getFeaturedExperiences"))).toEqual([]);
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

  it("cms-blog: crear, publicar y programar; lo público solo ve lo publicado; sitemap; permisos; licencia; aislamiento A/B", async () => {
    // La tabla llega a las empresas nuevas con la baseline + db/migrations
    expect((await ess.sql("a", "SHOW TABLES LIKE 'blog_posts'")).length).toBe(1);

    // Validación
    expect(errCode(await ess.m("a", "blog.create", { title: " ", slug: "Mal Slug", status: "draft" }, admA))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "blog.create", { title: "X", slug: "x", status: "draft", featuredImageUrl: "javascript:alert(1)" }, admA))).toBe("BAD_REQUEST");

    // Borrador, publicada (con HTML a sanear) y programada
    const draft = await ess.m("a", "blog.create", { title: "Borrador secreto", slug: "borrador-secreto", content: "<p>Aún no</p>", status: "draft" }, admA);
    expect(draft.status).toBe(200);
    expect(data(draft).visibleStatus).toBe("draft");
    const pub = await ess.m("a", "blog.create", {
      title: "Abrimos temporada", slug: "abrimos-temporada", excerpt: "Novedades de A", category: "Noticias", status: "published",
      content: '<h2>Hola</h2><script>alert(1)</script><p onclick="robar()">Texto</p>', metaDescription: "Descripción SEO de A",
      featuredImageUrl: "https://cdn.example/a.jpg", featuredImageAlt: "Foto de A",
    }, admA);
    expect(pub.status).toBe(200);
    expect(data(pub).visibleStatus).toBe("published");
    const fut = await ess.m("a", "blog.create", { title: "Futura", slug: "futura", status: "published", publishedAt: Date.now() + 86_400_000 }, admA);
    expect(data(fut).visibleStatus).toBe("scheduled");
    // Slug único
    expect(errCode(await ess.m("a", "blog.create", { title: "Otra", slug: "abrimos-temporada", status: "draft" }, admA))).toBe("CONFLICT");
    const [row] = await ess.sql("a", "SELECT author_name, author_user_id, status, published_at FROM blog_posts WHERE slug = 'abrimos-temporada'");
    expect(row.status).toBe("published");
    expect(Number(row.author_user_id)).toBe(await ess.userId("a", "admin"));
    expect(Number(row.published_at)).toBeGreaterThan(0);

    // Público (sin sesión): solo la publicada con fecha alcanzada
    const list = data(await ess.q("a", "blog.publicList", { page: 1 }));
    expect(list.items.map((i: any) => i.slug)).toEqual(["abrimos-temporada"]);
    expect(list.total).toBe(1);
    expect(list.categories).toEqual(["Noticias"]);
    expect(data(await ess.q("a", "blog.publicList", { page: 1, category: "Otra" })).items).toEqual([]);
    const detail = data(await ess.q("a", "blog.publicGet", { slug: "abrimos-temporada" }));
    expect(detail.title).toBe("Abrimos temporada");
    expect(detail.html).toContain("<h2>Hola</h2>");
    expect(detail.html).not.toMatch(/<script|onclick/i);
    expect(data(await ess.q("a", "blog.publicGet", { slug: "borrador-secreto" })) ?? null).toBeNull();
    expect(data(await ess.q("a", "blog.publicGet", { slug: "futura" })) ?? null).toBeNull();

    // Panel: las tres con su estado; publicar el borrador lo hace visible y despublicarlo lo oculta
    const adminList = data(await ess.q("a", "blog.list", undefined, admA));
    expect(Object.fromEntries(adminList.map((p: any) => [p.slug, p.visibleStatus]))).toEqual({ "borrador-secreto": "draft", "abrimos-temporada": "published", futura: "scheduled" });
    const draftId = data(draft).id;
    const base = { title: "Borrador secreto", slug: "borrador-secreto", content: "<p>Ya sí</p>" };
    expect((await ess.m("a", "blog.update", { id: draftId, ...base, status: "published" }, admA)).status).toBe(200);
    expect(data(await ess.q("a", "blog.publicGet", { slug: "borrador-secreto" }))?.html).toBe("<p>Ya sí</p>");
    expect((await ess.m("a", "blog.update", { id: draftId, ...base, status: "draft" }, admA)).status).toBe(200);
    expect(data(await ess.q("a", "blog.publicGet", { slug: "borrador-secreto" })) ?? null).toBeNull();
    // Vista previa: saneada y sin guardar nada
    expect(data(await ess.m("a", "blog.preview", { content: "<p>Previa</p><script>x</script>" }, admA)).html).toBe("<p>Previa</p>");

    // Sitemap de A: /blog y la publicada; nunca borradores ni programadas
    const sm = await ess.call("a", "GET", "/sitemap.xml");
    expect(sm.status).toBe(200);
    // URL pública de A (su dominio principal: el propio, si la prueba de cms-domain ya lo activó)
    const baseA = /<loc>(https:\/\/[^<]+?)\/<\/loc>/.exec(sm.text)![1];
    expect(baseA).toContain(ess.ids.a);
    expect(sm.text).toContain(`<loc>${baseA}/blog</loc>`);
    expect(sm.text).toContain(`<loc>${baseA}/blog/abrimos-temporada</loc>`);
    expect(sm.text).not.toContain("borrador-secreto");
    expect(sm.text).not.toContain("/blog/futura");

    // Permisos: el blog lo gestiona administración (como las páginas); sin sesión, 401
    expect(errCode(await ess.m("a", "blog.create", { title: "X", slug: "x", status: "draft" }, agA))).toBe("FORBIDDEN");
    expect(errCode(await ess.q("a", "blog.list", undefined, agA))).toBe("FORBIDDEN");
    expect((await ess.q("a", "blog.list")).status).toBe(401);

    // Aislamiento: B no ve ni toca nada de A
    expect(data(await ess.q("b", "blog.publicList", { page: 1 })).items).toEqual([]);
    expect(data(await ess.q("b", "blog.publicGet", { slug: "abrimos-temporada" })) ?? null).toBeNull();
    expect(data(await ess.q("b", "blog.list", undefined, admB))).toEqual([]);
    expect(errCode(await ess.m("b", "blog.update", { id: draftId, ...base, status: "published" }, admB))).toBe("NOT_FOUND");
    expect(errCode(await ess.m("b", "blog.remove", { id: draftId }, admB))).toBe("NOT_FOUND");
    const smB = await ess.call("b", "GET", "/sitemap.xml");
    expect(smB.text).not.toContain("abrimos-temporada");
    expect(smB.text).not.toContain(ess.ids.a);
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM blog_posts"))[0].n).toBe(0);

    // Licencia: en solo lectura se lee (también la web) y no se modifica; sin contratar, ni lo uno ni lo otro
    const lic = await licenseMatrix(ess, "cms-blog", {
      query: () => ess.q("a", "blog.publicList", { page: 1 }),
      mutation: () => ess.m("a", "blog.create", { title: "Bloqueada", slug: "bloqueada", status: "draft" }, admA),
    });
    expect(lic.readOnlyQuery?.status).toBe(200);
    expect(isLicenseDenied(lic.readOnlyMutation, "cms-blog")).toBe(true);
    expect(isLicenseDenied(lic.noneQuery, "cms-blog")).toBe(true);
    expect(isLicenseDenied(lic.noneMutation, "cms-blog")).toBe(true);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM blog_posts WHERE slug = 'bloqueada'"))[0].n).toBe(0);
    try {
      await ess.setCapability("a", "cms-blog", null);
      const smNone = await ess.call("a", "GET", "/sitemap.xml");
      expect(smNone.status).toBe(200);
      expect(smNone.text).not.toContain("/blog");
    } finally {
      await ess.setCapability("a", "cms-blog", "active");
    }

    // Eliminar
    expect((await ess.m("a", "blog.remove", { id: draftId }, admA)).status).toBe(200);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM blog_posts"))[0].n).toBe(2);
  });

  it("legales de relleno publicados (altas anteriores): no se sirven, ni en el menú ni en el sitemap, hasta redactarlos", async () => {
    const relleno = "<h1>Política de privacidad</h1><p>A trata los datos personales. Complete este texto con su política.</p>";
    expect((await ess.m("a", "cms.savePageContent", { slug: "politica-de-privacidad", title: "Privacidad", content: relleno, isPublished: true }, admA)).status).toBe(200);
    expect((await ess.m("a", "cms.createMenuItem", { label: "Privacidad", url: "/privacidad", menuZone: "footer" }, admA)).status).toBe(200);
    expect(data(await ess.q("a", "public.getTenantPage", { slug: "politica-de-privacidad" })) ?? null).toBeNull();
    expect(data(await ess.q("a", "public.getMenuItems", { zone: "footer" })).map((m: any) => m.url)).not.toContain("/privacidad");
    expect((await ess.call("a", "GET", "/sitemap.xml")).text).not.toContain("/politica-de-privacidad");
    // Redactado por la empresa: se publica
    expect((await ess.m("a", "cms.savePageContent", { slug: "politica-de-privacidad", title: "Privacidad", content: "<p>Responsable: A, S.L.</p>", isPublished: true }, admA)).status).toBe(200);
    expect(data(await ess.q("a", "public.getTenantPage", { slug: "politica-de-privacidad" })).html).toContain("Responsable: A");
    expect(data(await ess.q("a", "public.getMenuItems", { zone: "footer" })).map((m: any) => m.url)).toContain("/privacidad");
    expect((await ess.call("a", "GET", "/sitemap.xml")).text).toContain("/politica-de-privacidad");
  });
});
