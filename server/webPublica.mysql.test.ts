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
    // Textos legales iniciales de la empresa (genéricos, con sus datos): existen desde el primer minuto
    const priv = await ess.call("a", "GET", "/privacidad");
    expect(priv.status).toBe(200);
    expect(priv.text).toContain("<title>Política de privacidad | Empresa A Ejemplo SL</title>");
    for (const p of ["/aviso-legal", "/cookies"]) expect((await ess.call("b", "GET", p)).status, p).toBe(200);
    // Secciones según lo contratado (Essential): la tienda sí; Lego Packs y cupones de plataformas, no
    for (const p of ["/tienda", "/experiencias", "/presupuesto"]) expect((await ess.call("a", "GET", p)).status, p).toBe(200);
    for (const p of ["/lego-packs", "/lego-packs/dia", "/canjear-cupon"]) expect((await ess.call("a", "GET", p)).status, p).toBe(404);
    await ess.setCapability("b", "crm-leads", null);
    expect((await ess.call("b", "GET", "/presupuesto")).status).toBe(404);
    await ess.setCapability("b", "crm-leads", "active");
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

  it("redirecciones 301: administrables por empresa, auditadas, sin bucles ni destinos externos y aisladas entre empresas", async () => {
    const dbA = (p: string, input: any) => ess.m("a", p, input, admA);
    // Alta correcta (la ruta antigua no existe en la web)
    const ok = await dbA("redirects.create", { fromPath: "/Programa-Antiguo/", toPath: "/servicios" });
    expect(ok.status).toBe(200);
    const id = ok.json.result.data.json.id;
    // 301 con la ruta nueva; se conserva la consulta; HEAD también; mayúsculas y barra final no importan
    const r = await ess.call("a", "GET", "/programa-antiguo?utm=x");
    expect([r.status, r.location]).toEqual([301, "/servicios?utm=x"]);
    expect(r.headers?.["cache-control"]).toBe("public, max-age=300");
    expect((await ess.call("a", "GET", "/PROGRAMA-ANTIGUO/")).status).toBe(301);
    // Aislamiento: la empresa B no ve la regla de A (su 404 de siempre)
    expect((await ess.call("b", "GET", "/programa-antiguo")).status).toBe(404);
    // Rechazos: externo, protegido, ruta que ya existe, duplicado, bucle y cadena
    for (const bad of [
      { fromPath: "/otro", toPath: "https://otra.web/x" },
      { fromPath: "/otro", toPath: "//otra.web/x" },
      { fromPath: "/admin/cms", toPath: "/servicios" },
      { fromPath: "/", toPath: "/servicios" },
      { fromPath: "/servicios", toPath: "/otra" },
      { fromPath: "/programa-antiguo", toPath: "/otra" },
      { fromPath: "/servicios", toPath: "/programa-antiguo" },
      { fromPath: "/nuevo-origen", toPath: "/programa-antiguo" },
    ]) {
      const x = await dbA("redirects.create", bad);
      expect(x.status, JSON.stringify(bad)).toBe(400);
    }
    // Apagada: no redirige
    expect((await dbA("redirects.update", { id, fromPath: "/programa-antiguo", toPath: "/servicios", statusCode: 301, isActive: false })).status).toBe(200);
    (await import("./redirectsDb")).clearRedirectCache();
    expect((await ess.call("a", "GET", "/programa-antiguo")).status).toBe(404);
    // Baja y auditoría: quedan alta, cambio y baja con autor
    expect((await dbA("redirects.delete", { id })).status).toBe(200);
    const log = (await ess.q("a", "redirects.log", { limit: 10 }, admA)).json.result.data.json as any[];
    expect(log.map((l) => l.action).sort()).toEqual(["create", "delete", "update"]);
    expect(log.every((l) => l.actorName)).toBe(true);
    // Sin sesión de administrador no se administra
    expect((await ess.m("a", "redirects.create", { fromPath: "/x", toPath: "/servicios" })).status).not.toBe(200);
  });

  it("cambiar la dirección de una página conserva el enlace antiguo con un 301 y no deja cadenas", async () => {
    expect((await ess.m("a", "cms.upsertPage", { slug: "programa-a", title: "Programa A", isPublished: true }, admA)).status).toBe(200);
    expect((await ess.m("a", "cms.updatePageSettings", { slug: "programa-a", newSlug: "programa-b", title: "Programa A" }, admA)).status).toBe(200);
    const old = await ess.call("a", "GET", "/programa-a");
    expect([old.status, old.location]).toEqual([301, "/programa-b"]);
    expect((await ess.call("a", "GET", "/programa-b")).status).toBe(200);
    // Segundo cambio: la regla antigua se reapunta al destino final (sin cadena)
    expect((await ess.m("a", "cms.updatePageSettings", { slug: "programa-b", newSlug: "programa-c", title: "Programa A" }, admA)).status).toBe(200);
    (await import("./redirectsDb")).clearRedirectCache();
    expect((await ess.call("a", "GET", "/programa-a")).location).toBe("/programa-c");
    expect((await ess.call("a", "GET", "/programa-b")).location).toBe("/programa-c");
    expect((await ess.call("a", "GET", "/programa-c")).status).toBe(200);
    // Volver a una dirección antigua: la página manda sobre la regla (se retira para no taparla)
    expect((await ess.m("a", "cms.updatePageSettings", { slug: "programa-c", newSlug: "programa-a", title: "Programa A" }, admA)).status).toBe(200);
    (await import("./redirectsDb")).clearRedirectCache();
    expect((await ess.call("a", "GET", "/programa-a")).status).toBe(200);
    expect((await ess.call("a", "GET", "/programa-c")).location).toBe("/programa-a");
  });

  it("una redirección nunca tapa una página: la que se publica después gana; las pantallas de acceso no se pueden redirigir; las tildes funcionan", async () => {
    const dbA = (p: string, input: any) => ess.m("a", p, input, admA);
    // Acceso y pago protegidos
    for (const from of ["/login", "/checkout", "/reserva/ok", "/recuperar-contrasena"]) expect((await dbA("redirects.create", { fromPath: from, toPath: "/servicios" })).status, from).toBe(400);
    expect((await ess.call("a", "GET", "/login")).status).toBe(200);
    // Tilde: regla guardada decodificada, petición codificada
    expect((await dbA("redirects.create", { fromPath: "/programación", toPath: "/servicios" })).status).toBe(200);
    const t = await ess.call("a", "GET", "/programaci%C3%B3n");
    expect([t.status, t.location]).toEqual([301, "/servicios"]);
    // Regla sobre una ruta libre y página creada y publicada DESPUÉS en esa ruta: la página se ve (la regla no actúa)
    expect((await dbA("redirects.create", { fromPath: "/verano", toPath: "/servicios" })).status).toBe(200);
    expect((await ess.call("a", "GET", "/verano")).status).toBe(301);
    expect((await ess.m("a", "cms.upsertPage", { slug: "verano", title: "Verano", isPublished: true }, admA)).status).toBe(200);
    (await import("./redirectsDb")).clearRedirectCache();
    expect((await ess.call("a", "GET", "/verano")).status).toBe(200);
    // Duplicado: mensaje claro (400), no un 500
    expect((await dbA("redirects.create", { fromPath: "/programación", toPath: "/otra-ruta" })).status).toBe(400);
  });
});

