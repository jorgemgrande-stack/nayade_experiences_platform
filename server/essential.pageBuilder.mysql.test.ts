/**
 * Essential — Constructor de la web (Web › Páginas) con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL): dos empresas nuevas desde la baseline. Página con bloques desde plantilla, borrador que
 * no se publica solo, vista previa, publicación, menú, portada, formulario de contacto que crea la oportunidad y el
 * cliente en el CRM, gestión de páginas (dirección repetida, duplicar, eliminar, textos legales), conversión de las
 * páginas antiguas en HTML y aislamiento entre empresas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

const blocksOf = (types: Array<[string, Record<string, unknown>]>) => types.map(([type, d], i) => ({ id: `b${i}`, type, data: d }));

describe.skipIf(!URL_)("Essential — Constructor de la web (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let admA: string;
  let admB: string;
  let agA: string;
  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "constructor");
    admA = await ess.login("a", "admin");
    admB = await ess.login("b", "admin");
    agA = await ess.login("a", "agente");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("página nueva desde plantilla: en borrador, con su enlace de menú oculto hasta publicar; vista previa y publicación", async () => {
    // La lista crea las páginas iniciales (portada y textos legales) y marca su estado
    const initial = data(await ess.q("a", "cms.sitePages", undefined, admA));
    expect(initial.map((p: any) => p.slug)).toEqual(["inicio", "aviso-legal", "politica-de-privacidad", "politica-de-cookies"]);
    expect(initial.find((p: any) => p.slug === "inicio")).toMatchObject({ isHome: true, isPublished: true, hasDraft: false });
    expect(initial.find((p: any) => p.slug === "aviso-legal")).toMatchObject({ isLegal: true });

    const r = await ess.m("a", "cms.createSitePage", { title: "Servicios", slug: "servicios", template: "services", addToMenu: true, metaDescription: "Lo que hacemos" }, admA);
    expect(r.status).toBe(200);
    const ed = data(await ess.q("a", "cms.pageEditor", { slug: "servicios" }, admA));
    expect(ed.source).toBe("draft");
    expect(ed.blocks.map((b: any) => b.type)).toEqual(["hero", "text", "columns", "columns", "button"]);
    expect(ed.page).toMatchObject({ isPublished: false, hasDraft: true, inHeader: true });

    // Sin publicar: ni la página ni su enlace en el menú se ven en la web
    expect(data(await ess.q("a", "public.getTenantPage", { slug: "servicios" })) ?? null).toBeNull();
    expect(data(await ess.q("a", "public.getMenuItems", { zone: "header" })).map((m: any) => m.url)).not.toContain("/servicios");
    // El borrador nunca sale por la lectura pública de bloques
    expect(data(await ess.q("a", "public.getPublicPageBlocks", { slug: "borrador:servicios" }))).toEqual([]);

    // Edición: cabecera con imagen y botón, columnas con texto e imagen; el saneado quita lo peligroso
    const blocks = blocksOf([
      ["hero", { title: "Asesoría {{nombre}}", subtitle: "Impuestos sin líos", imageUrl: "/uploads/cabecera.jpg", imageAlt: "Oficina", buttonLabel: "Pide cita", buttonUrl: "/contacto" }],
      ["columns", { title: "Fiscal", html: '<p>Declaraciones <b>trimestrales</b><script>alert(1)</script></p>', imageUrl: "javascript:alert(1)", imagePosition: "left" }],
      ["button", { label: "Escríbenos", url: "javascript:alert(1)" }],
    ]);
    const saved = await ess.m("a", "cms.savePageDraft", { slug: "servicios", blocks }, admA);
    expect(saved.status).toBe(200);
    expect(JSON.stringify(data(saved).blocks)).not.toMatch(/script|javascript/);

    // Vista previa: el borrador con los datos de la empresa, igual que se servirá
    const prev = data(await ess.q("a", "cms.pagePreview", { slug: "servicios" }, admA));
    expect(prev.blocks[0].data.title).toBe("Asesoría Empresa A Ejemplo SL");
    expect(prev.blocks[1].data).toMatchObject({ html: "<p>Declaraciones <b>trimestrales</b></p>", imageUrl: "" });

    // Publicar: la web la sirve con sus bloques y el enlace del menú aparece
    expect((await ess.m("a", "cms.publishPage", { slug: "servicios" }, admA)).status).toBe(200);
    const pub = data(await ess.q("a", "public.getTenantPage", { slug: "servicios" }));
    expect(pub.blocks.map((b: any) => b.type)).toEqual(["hero", "columns", "button"]);
    expect(pub.blocks[0].data.title).toBe("Asesoría Empresa A Ejemplo SL");
    expect(pub.blocks[2].data.url).toBe("");
    expect(pub.metaDescription).toBe("Lo que hacemos");
    // Su contenido equivalente (buscadores, mapa del sitio) queda guardado y saneado
    const [row] = await ess.sql<{ content: string; isPublished: number }>("a", "SELECT content, isPublished FROM static_pages WHERE slug = 'servicios'");
    expect(Number(row.isPublished)).toBe(1);
    expect(row.content).toContain("<h1>Asesoría {{nombre}}</h1>");
    expect(row.content).not.toMatch(/script|javascript/);
    expect(data(await ess.q("a", "public.getMenuItems", { zone: "header" })).map((m: any) => m.url)).toContain("/servicios");
    expect(data(await ess.q("a", "cms.pageEditor", { slug: "servicios" }, admA))).toMatchObject({ source: "published", page: { hasDraft: false } });

    // Un cambio posterior queda en borrador: la web sigue mostrando lo publicado hasta volver a publicar
    await ess.m("a", "cms.savePageDraft", { slug: "servicios", blocks: blocksOf([["text", { title: "Cambio", html: "<p>Nuevo</p>" }]]) }, admA);
    expect(data(await ess.q("a", "public.getTenantPage", { slug: "servicios" })).blocks).toHaveLength(3);
    expect(data(await ess.q("a", "cms.sitePages", undefined, admA)).find((p: any) => p.slug === "servicios").hasDraft).toBe(true);
    // Descartar el borrador vuelve a lo publicado
    await ess.m("a", "cms.discardPageDraft", { slug: "servicios" }, admA);
    expect(data(await ess.q("a", "cms.pageEditor", { slug: "servicios" }, admA)).blocks).toHaveLength(3);
  });

  it("validación: dirección repetida o reservada, bloque desconocido; solo administradores y nunca sin sesión", async () => {
    const dup = await ess.m("a", "cms.createSitePage", { title: "Servicios", slug: "servicios", template: "blank", addToMenu: false }, admA);
    expect(errCode(dup)).toBe("BAD_REQUEST");
    expect(dup.json?.error?.json?.message).toMatch(/Ya tienes una página con esa dirección/);
    const reserved = await ess.m("a", "cms.createSitePage", { title: "Tienda", slug: "tienda", template: "blank", addToMenu: false }, admA);
    expect(reserved.json?.error?.json?.message).toMatch(/ya la usa otra parte de tu web/);
    const bad = await ess.m("a", "cms.savePageDraft", { slug: "servicios", blocks: [{ type: "iframe", data: {} }] }, admA);
    expect(bad.json?.error?.json?.message).toMatch(/bloque que no se reconoce/);
    // Un agente comercial no edita la web; sin sesión, nada
    expect((await ess.m("a", "cms.publishPage", { slug: "servicios", blocks: [] }, agA)).status).toBe(403);
    expect([401, 403]).toContain((await ess.m("a", "cms.publishPage", { slug: "servicios", blocks: [] })).status);
    expect(data(await ess.q("a", "public.getTenantPage", { slug: "servicios" })).blocks).toHaveLength(3);
  });

  it("formulario de contacto: página «contacto» publicada; cada envío entra en el CRM como oportunidad y cliente", async () => {
    expect((await ess.m("a", "cms.createSitePage", { title: "Contacto", slug: "contacto", template: "contact", addToMenu: true }, admA)).status).toBe(200);
    expect((await ess.m("a", "cms.publishPage", { slug: "contacto" }, admA)).status).toBe(200);
    const page = data(await ess.q("a", "public.getTenantPage", { slug: "contacto" }));
    expect(page.blocks.map((b: any) => b.type)).toEqual(["text", "contact_form"]);
    // Sin teléfono público en la empresa nueva: esa línea no aparece (ni su marcador)
    expect(page.blocks[0].data.html).not.toContain("{{");

    // Lo que envía el bloque del formulario (PageBlocksView → public.submitLead)
    const sent = await ess.m("a", "public.submitLead", { name: "Lucía Cliente", email: "lucia@cliente.example", phone: "600000001", message: "Página: Contacto\n\nQuiero información", source: "web_contacto" });
    expect(sent.status).toBe(200);
    const [lead] = await ess.sql<{ name: string; source: string; message: string }>("a", "SELECT name, source, message FROM leads WHERE email = 'lucia@cliente.example'");
    expect(lead).toMatchObject({ name: "Lucía Cliente", source: "web_contacto" });
    expect(lead.message).toContain("Quiero información");
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM clients WHERE email = 'lucia@cliente.example'"))[0].n).toBe(1);
    // Nada en la otra empresa
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM leads WHERE email = 'lucia@cliente.example'"))[0].n).toBe(0);
  });

  it("portada configurable: otra página publicada pasa a ser la portada; la anterior no se puede eliminar mientras lo sea", async () => {
    expect(errCode(await ess.m("a", "cms.deleteSitePage", { slug: "inicio" }, admA))).toBe("BAD_REQUEST");
    // Una página sin publicar no llega a servirse como portada
    await ess.m("a", "cms.createSitePage", { title: "Bienvenida", slug: "bienvenida", template: "blank", addToMenu: false }, admA);
    await ess.m("a", "cms.setHomePage", { slug: "bienvenida" }, admA);
    expect(data(await ess.q("a", "public.getTenantPage", { slug: "inicio" })).slug).toBe("inicio");
    // Publicada, «/» la sirve
    await ess.m("a", "cms.publishPage", { slug: "bienvenida" }, admA);
    const home = data(await ess.q("a", "public.getTenantPage", { slug: "inicio" }));
    expect(home.slug).toBe("bienvenida");
    expect(home.blocks[0]).toMatchObject({ type: "text", data: { title: "Bienvenida" } });
    const list = data(await ess.q("a", "cms.sitePages", undefined, admA));
    expect(list.find((p: any) => p.slug === "bienvenida").isHome).toBe(true);
    expect(list.find((p: any) => p.slug === "inicio").isHome).toBe(false);
    // La portada no se retira ni se elimina; la antigua «inicio» ya sí
    expect(errCode(await ess.m("a", "cms.setPagePublished", { slug: "bienvenida", isPublished: false }, admA))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "cms.deleteSitePage", { slug: "bienvenida" }, admA))).toBe("BAD_REQUEST");
    // Volver a «inicio»
    expect((await ess.m("a", "cms.setHomePage", { slug: "inicio" }, admA)).status).toBe(200);
    expect(data(await ess.q("a", "public.getTenantPage", { slug: "inicio" })).slug).toBe("inicio");
  });

  it("página antigua en HTML: se sigue viendo igual; el editor la abre en bloques y al publicar conserva el contenido", async () => {
    const legacy = data(await ess.q("a", "public.getTenantPage", { slug: "aviso-legal" }));
    expect(legacy.blocks).toBeNull();
    expect(legacy.html).toContain("Ley 34/2002");
    const ed = data(await ess.q("a", "cms.pageEditor", { slug: "aviso-legal" }, admA));
    expect(ed.source).toBe("converted");
    expect(ed.blocks[0]).toMatchObject({ type: "text", data: { title: "Datos identificativos" } });
    // Abrir el editor no cambia nada en la web ni guarda nada
    expect(data(await ess.q("a", "cms.sitePages", undefined, admA)).find((p: any) => p.slug === "aviso-legal").hasDraft).toBe(false);
    expect((await ess.m("a", "cms.publishPage", { slug: "aviso-legal", blocks: ed.blocks }, admA)).status).toBe(200);
    const after = data(await ess.q("a", "public.getTenantPage", { slug: "aviso-legal" }));
    const text = (b: any[]) => JSON.stringify(b).replace(/<[^>]+>/g, " ");
    for (const s of ["Ley 34/2002", "Propiedad intelectual", "NIF: B00000011", "legislación española"]) expect(text(after.blocks)).toContain(s);
  });

  it("gestión: duplicar, cambiar la dirección (con su menú), retirar de la web y eliminar; los textos legales piden confirmación", async () => {
    const dup = data(await ess.m("a", "cms.duplicateSitePage", { slug: "servicios" }, admA));
    expect(dup).toMatchObject({ slug: "servicios-copia", title: "Servicios (copia)" });
    expect(data(await ess.q("a", "cms.pageEditor", { slug: "servicios-copia" }, admA))).toMatchObject({ source: "draft", page: { isPublished: false, inHeader: false } });
    expect(data(await ess.m("a", "cms.duplicateSitePage", { slug: "servicios" }, admA)).slug).toBe("servicios-copia-2");

    // Cambiar la dirección: su enlace del menú y sus bloques la siguen
    const mv = await ess.m("a", "cms.updatePageSettings", { slug: "servicios", newSlug: "que-hacemos", title: "Qué hacemos", metaTitle: "Servicios de asesoría", metaDescription: "Fiscal y laboral" }, admA);
    expect(data(mv).slug).toBe("que-hacemos");
    expect(data(await ess.q("a", "public.getTenantPage", { slug: "que-hacemos" }))).toMatchObject({ title: "Qué hacemos", metaTitle: "Servicios de asesoría" });
    expect(data(await ess.q("a", "public.getTenantPage", { slug: "servicios" })) ?? null).toBeNull();
    const urls = data(await ess.q("a", "public.getMenuItems", { zone: "header" })).map((m: any) => m.url);
    expect(urls).toContain("/que-hacemos");
    expect(urls).not.toContain("/servicios");
    expect(errCode(await ess.m("a", "cms.updatePageSettings", { slug: "que-hacemos", newSlug: "contacto", title: "X" }, admA))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "cms.updatePageSettings", { slug: "aviso-legal", newSlug: "legal", title: "Aviso legal" }, admA))).toBe("BAD_REQUEST");

    // Menú de pie: añadir y quitar
    await ess.m("a", "cms.setPageInMenu", { slug: "que-hacemos", zone: "footer", inMenu: true }, admA);
    expect(data(await ess.q("a", "public.getMenuItems", { zone: "footer" })).map((m: any) => m.url)).toContain("/que-hacemos");
    await ess.m("a", "cms.setPageInMenu", { slug: "que-hacemos", zone: "footer", inMenu: false }, admA);
    expect(data(await ess.q("a", "public.getMenuItems", { zone: "footer" })).map((m: any) => m.url)).not.toContain("/que-hacemos");

    // Retirar de la web: deja de servirse y de enlazarse; se conserva
    await ess.m("a", "cms.setPagePublished", { slug: "que-hacemos", isPublished: false }, admA);
    expect(data(await ess.q("a", "public.getTenantPage", { slug: "que-hacemos" })) ?? null).toBeNull();
    expect(data(await ess.q("a", "public.getMenuItems", { zone: "header" })).map((m: any) => m.url)).not.toContain("/que-hacemos");

    // Eliminar: la página, sus bloques, su borrador y su enlace del menú
    expect((await ess.m("a", "cms.deleteSitePage", { slug: "que-hacemos" }, admA)).status).toBe(200);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM page_blocks WHERE pageSlug IN ('que-hacemos', 'borrador:que-hacemos')"))[0].n).toBe(0);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM menu_items WHERE url = '/que-hacemos'"))[0].n).toBe(0);

    // Texto legal: sin confirmación expresa, no
    const legal = await ess.m("a", "cms.deleteSitePage", { slug: "politica-de-cookies" }, admA);
    expect(legal.json?.error?.json?.message).toMatch(/texto legal/);
    expect((await ess.m("a", "cms.deleteSitePage", { slug: "politica-de-cookies", confirmLegal: true }, admA)).status).toBe(200);
    expect(data(await ess.q("a", "cms.sitePages", undefined, admA)).map((p: any) => p.slug)).not.toContain("politica-de-cookies");
  });

  it("aislamiento: la empresa B no ve ni toca las páginas, los borradores, el menú ni la portada de A", async () => {
    const pagesB = data(await ess.q("b", "cms.sitePages", undefined, admB)).map((p: any) => p.slug);
    expect(pagesB).toEqual(["inicio", "aviso-legal", "politica-de-privacidad", "politica-de-cookies"]);
    expect(data(await ess.q("b", "public.getTenantPage", { slug: "contacto" })) ?? null).toBeNull();
    expect(data(await ess.q("b", "cms.pageEditor", { slug: "contacto" }, admB)) ?? null).toBeNull();
    // Mismas direcciones en B, independientes
    expect((await ess.m("b", "cms.createSitePage", { title: "Contacto", slug: "contacto", template: "blank", addToMenu: true }, admB)).status).toBe(200);
    expect(errCode(await ess.m("b", "cms.publishPage", { slug: "servicios-copia" }, admB))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("b", "cms.deleteSitePage", { slug: "servicios-copia" }, admB))).toBe("BAD_REQUEST");
    // La cookie de A no sirve en B
    expect([401, 403]).toContain((await ess.m("b", "cms.createSitePage", { title: "Intrusa", slug: "intrusa", template: "blank", addToMenu: false }, admA)).status);
    expect(data(await ess.q("a", "public.getTenantPage", { slug: "contacto" })).blocks.map((b: any) => b.type)).toEqual(["text", "contact_form"]);
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM menu_items WHERE url = '/servicios'"))[0].n).toBe(0);
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM system_settings WHERE `key` = 'site_home_page'"))[0].n).toBe(0);
  });
});
