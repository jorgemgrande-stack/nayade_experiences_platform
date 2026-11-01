/**
 * Web pública de cada empresa con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL), dos
 * empresas nuevas: título de la portada con los datos de la empresa, 404 real para lo que no existe (páginas y
 * blog consultados en SU base de datos) y sitemap solo con lo publicado y contratado. Aislamiento A/B.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startEssentialApp, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("Web pública por empresa (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let admA: string;
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), "web-publica-mysql-"));
  beforeAll(async () => {
    fs.copyFileSync(path.join(__dirname, "..", "client", "index.html"), path.join(dist, "index.html"));
    ess = await startEssentialApp(URL_!, "webpub", { webDist: dist });
    admA = await ess.login("a", "admin");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
    fs.rmSync(dist, { recursive: true, force: true });
  });

  it("portada: título y descripción de la empresa en el HTML servido (nunca vacío ni de otra empresa)", async () => {
    expect((await ess.m("a", "cms.updateSiteSettings", { settings: { seo_description: "Servicios de A para pymes" } }, admA)).status).toBe(200);
    // Los ajustes se cachean 60 s por empresa (comportamiento existente): se olvida la caché de A
    (await import("./config")).invalidateConfigCacheForTenant(ess.ids.a);
    const a = await ess.call("a", "GET", "/");
    expect(a.status).toBe(200);
    expect(a.text).toContain("<title>Empresa A Ejemplo SL</title>");
    expect(a.text).toContain('<meta name="description" content="Servicios de A para pymes"');
    expect(a.text).toContain(`<link rel="canonical" href="https://${ess.host("a")}"`);
    const b = await ess.call("b", "GET", "/");
    expect(b.text).toContain("<title>Empresa B Ejemplo SL</title>");
    expect(b.text).not.toContain("Empresa A");
    expect(b.text).not.toContain("Servicios de A");
  });

  it("404 real: lo inexistente y las páginas de otra empresa o en borrador; las propias publicadas, 200 con su título", async () => {
    expect((await ess.m("a", "cms.upsertPage", { slug: "servicios", title: "Servicios", isPublished: true, metaDescription: "Lo que hace A" }, admA)).status).toBe(200);
    expect((await ess.m("a", "cms.upsertPage", { slug: "borrador", title: "Borrador", isPublished: false }, admA)).status).toBe(200);

    const page = await ess.call("a", "GET", "/servicios");
    expect(page.status).toBe(200);
    expect(page.text).toContain("<title>Servicios | Empresa A Ejemplo SL</title>");
    expect(page.text).toContain('<meta name="description" content="Lo que hace A"');
    expect((await ess.call("b", "GET", "/servicios")).status).toBe(404);
    expect((await ess.call("a", "GET", "/borrador")).status).toBe(404);

    const nf = await ess.call("a", "GET", "/no-existe-nada");
    expect(nf.status).toBe(404);
    expect(nf.text).toContain('<meta name="robots" content="noindex" />');
    expect((await ess.call("a", "GET", "/a/b/c")).status).toBe(404);
    // Textos legales de relleno sin redactar: no existen todavía
    expect((await ess.call("a", "GET", "/privacidad")).status).toBe(404);
    // Rutas del cliente y áreas privadas: se sirven
    for (const p of ["/contacto", "/login", "/admin", "/admin/ayuda"]) expect((await ess.call("a", "GET", p)).status, p).toBe(200);
    // Secciones sectoriales sin su módulo: no existen
    expect((await ess.call("a", "GET", "/hotel")).status).toBe(404);
    expect((await ess.call("a", "GET", "/restaurantes/x")).status).toBe(404);
  });

  it("blog: lista con la capacidad contratada; entrada publicada 200, inexistente o de otra empresa 404", async () => {
    expect((await ess.m("a", "blog.create", { title: "Novedades", slug: "novedades", content: "<p>Hola</p>", status: "published" }, admA)).status).toBe(200);
    expect((await ess.call("a", "GET", "/blog")).status).toBe(200);
    expect((await ess.call("a", "GET", "/blog/novedades")).status).toBe(200);
    expect((await ess.call("a", "GET", "/blog/no-existe")).status).toBe(404);
    expect((await ess.call("b", "GET", "/blog/novedades")).status).toBe(404);
    await ess.setCapability("b", "cms-blog", null);
    expect((await ess.call("b", "GET", "/blog")).status).toBe(404);
    await ess.setCapability("b", "cms-blog", "active");
  });

  it("sitemap: portada, contacto, páginas y blog; nada sectorial sin publicarlo o sin módulo; aislamiento", async () => {
    const a = (await ess.call("a", "GET", "/sitemap.xml")).text;
    const base = `https://${ess.host("a")}`;
    for (const p of ["/", "/contacto", "/servicios", "/blog", "/blog/novedades"]) expect(a, p).toContain(`<loc>${base}${p}</loc>`);
    expect(a).not.toMatch(/\/experiencias|\/tienda|\/presupuesto<|\/hotel|\/spa|\/restaurantes|lego-packs|\/borrador/);
    expect(a.match(/<loc>[^<]+\/contacto<\/loc>/g)?.length).toBe(1);
    const b = (await ess.call("b", "GET", "/sitemap.xml")).text;
    expect(b).not.toContain(ess.host("a"));
    expect(b).not.toMatch(/\/servicios|\/blog\/novedades|\/experiencias/);

    // A publica su catálogo: su sitemap lo incluye; el de B sigue sin él
    const [cat] = await ess.sql<{ id: number }>("a", "SELECT id FROM categories LIMIT 1");
    const [loc] = await ess.sql<{ id: number }>("a", "SELECT id FROM locations LIMIT 1");
    await ess.sql("a", "INSERT INTO experiences (slug, title, categoryId, locationId, basePrice, isActive, isPublished) VALUES ('visita-guiada', 'Visita guiada', ?, ?, 10, 1, 1)", [cat?.id ?? 1, loc?.id ?? 1]);
    const a2 = (await ess.call("a", "GET", "/sitemap.xml")).text;
    // Una pyme: en la dirección de su tienda, no en la de la ficha sectorial
    expect(a2).toContain(`<loc>${base}/tienda</loc>`);
    expect(a2).toContain(`<loc>${base}/tienda/visita-guiada</loc>`);
    expect(a2).not.toContain("/experiencias");
    expect((await ess.call("b", "GET", "/sitemap.xml")).text).not.toMatch(/\/experiencias|\/tienda/);
  });
});
