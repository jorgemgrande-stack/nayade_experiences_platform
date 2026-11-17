/**
 * Cambio del idioma principal con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL), dos empresas nuevas:
 * el plan bloquea mientras falte una traducción validada; el intercambio es transaccional (páginas, menús, idiomas),
 * crea los 301 de las direcciones antiguas, deja el SEO coherente y se deshace sin pérdida; la otra empresa no cambia.
 * Diseño: docs/elephant-source/DISENO_IDIOMA_PRINCIPAL.md.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startEssentialApp, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const unwrap = (r: { json: any }) => r.json?.result?.data?.json;

describe.skipIf(!URL_)("Idioma principal configurable (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let adm: string;
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), "idioma-principal-mysql-"));
  const m = (p: string, input?: unknown) => ess.m("a", p, input, adm);
  const q = (p: string, input?: unknown) => ess.q("a", p, input, adm);
  const GERMAN: Record<string, string> = { servicios: "dienstleistungen", equipo: "team" };

  beforeAll(async () => {
    fs.copyFileSync(path.join(__dirname, "..", "client", "index.html"), path.join(dist, "index.html"));
    ess = await startEssentialApp(URL_!, "idioma", { webDist: dist });
    adm = await ess.login("a", "admin");
    for (const [slug, title, template] of [["servicios", "Servicios", "services"], ["equipo", "Equipo", "about"]] as const) {
      expect((await m("cms.createSitePage", { title, slug, template, addToMenu: slug === "servicios" })).status).toBe(200);
      expect((await m("cms.publishPage", { slug })).status).toBe(200);
    }
    expect((await m("cms.createSitePage", { title: "Solo borrador", slug: "solo-borrador", template: "blank", addToMenu: false })).status).toBe(200);
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
    fs.rmSync(dist, { recursive: true, force: true });
  });

  const pages = async () => (unwrap(await q("cms.sitePages")) as { slug: string; title: string; isPublished: boolean }[]).map((p) => ({ slug: p.slug, title: p.title, isPublished: p.isPublished }));
  const menuOf = async (zone: "header" | "footer") => (unwrap(await q("cms.getMenuItems", { zone })) as { id: number; label: string; url: string | null }[]).map((i) => ({ id: i.id, label: i.label, url: i.url }));

  /** Traducción alemana validada de una página (o solo en borrador) con dirección y título propios. */
  async function translate(slug: string, title: string, validate: boolean) {
    expect((await m("cms.copyPageFromPrincipal", { slug, locale: "de" })).status, `copiar ${slug}`).toBe(200);
    expect((await m("cms.savePageTranslation", { slug, locale: "de", translatedSlug: GERMAN[slug] ?? `de-${slug}`, title })).status, `guardar ${slug}`).toBe(200);
    if (validate) expect((await m("cms.validatePageTranslation", { slug, locale: "de", validated: true })).status, `validar ${slug}`).toBe(200);
  }

  it("sin traducción validada el plan bloquea y aplicar no cambia nada", async () => {
    expect((await m("cms.i18nAddLocale", { locale: "de" })).status).toBe(200);
    expect((await m("cms.i18nSetLocaleValidated", { locale: "de", validated: true })).status).toBe(200);
    const plan0 = unwrap(await q("cms.i18nPlanDefaultLocale", { locale: "de" }));
    expect(plan0.canApply).toBe(false);
    const before = await pages();
    const res = await m("cms.i18nSetDefaultLocale", { locale: "de", confirm: true });
    expect(res.status).toBe(400);
    expect(await pages()).toEqual(before);
    expect((await ess.call("a", "GET", "/servicios")).status).toBe(200);
    expect(unwrap(await q("cms.i18nConfig")).defaultLocale).toBe("es");
  });

  it("intercambio: páginas, menú, idiomas, 301, SEO y aislamiento; la vuelta atrás restaura sin pérdida", async () => {
    // Todas las páginas publicadas (las de la plantilla incluidas) y el menú, traducidos y validados al alemán
    for (const p of await pages()) {
      if (p.slug === "solo-borrador") continue;
      await translate(p.slug, GERMAN[p.slug] ? p.title === "Servicios" ? "Dienstleistungen" : "Team" : `DE ${p.title}`, p.isPublished);
    }
    for (const zone of ["header", "footer"] as const) {
      for (const it of (unwrap(await q("cms.getMenuItems", { zone })) as { id: number; label: string; url: string | null }[])) {
        const slug = /^\/([^/?#]+)$/.exec(it.url ?? "")?.[1];
        const fields: Record<string, string> = { label: `DE ${it.label}` };
        if (slug) fields.url = `/${GERMAN[slug] ?? `de-${slug}`}`;
        expect((await m("cms.saveContentTranslation", { entityType: "menu_item", entityKey: String(it.id), locale: "de", fields })).status).toBe(200);
        expect((await m("cms.validateContentTranslation", { entityType: "menu_item", entityKey: String(it.id), locale: "de" })).status).toBe(200);
      }
    }
    const plan = unwrap(await q("cms.i18nPlanDefaultLocale", { locale: "de" }));
    expect(plan.issues.filter((i: any) => i.severity === "blocker"), JSON.stringify(plan.issues)).toEqual([]);
    expect(plan.canApply).toBe(true);

    const before = { pages: await pages(), editor: unwrap(await q("cms.pageEditor", { slug: "servicios" })), menu: await menuOf("header") };
    const homeBefore = unwrap(await q("public.getTenantPage", { slug: "servicios" }));
    expect(homeBefore.title).toBe("Servicios");

    // Aplicar
    const res = await m("cms.i18nSetDefaultLocale", { locale: "de", confirm: true });
    expect(res.status, res.text).toBe(200);
    const out = unwrap(res);
    expect(out.pages.swapped).toBeGreaterThanOrEqual(2);
    expect(out.pages.skipped).toContain("solo-borrador");
    expect(out.checks.length).toBeGreaterThanOrEqual(3);

    // Idioma principal y secundarios
    const cfg = unwrap(await q("cms.i18nConfig"));
    expect(cfg.defaultLocale).toBe("de");
    // El contenido base es ahora el alemán: dirección, título y menú
    const now = await pages();
    expect(now.find((p) => p.slug === "dienstleistungen")?.title).toBe("Dienstleistungen");
    expect(now.find((p) => p.slug === "team")?.title).toBe("Team");
    expect(now.find((p) => p.slug === "servicios")).toBeUndefined();
    const svc = await ess.call("a", "GET", "/dienstleistungen");
    expect(svc.status).toBe(200);
    expect(svc.text).toContain('<html lang="de"');
    expect(svc.text).toContain(`<link rel="canonical" href="https://${ess.host("a")}/dienstleistungen"`);
    expect(svc.text).toMatch(/hreflang="es"[^>]*href="https:\/\/[^"]+\/es\/servicios"/);
    // El español sigue disponible con su dirección bajo /es
    const es = await ess.call("a", "GET", "/es/servicios");
    expect(es.status).toBe(200);
    expect(unwrap(await q("public.getTenantPage", { slug: "servicios", locale: "es" })).title).toBe("Servicios");
    // 301: la dirección antigua sin prefijo lleva al mismo contenido en español, y /de/... al principal sin prefijo
    const old = await ess.call("a", "GET", "/servicios");
    expect([old.status, old.location]).toEqual([301, "/es/servicios"]);
    const dePrefixed = await ess.call("a", "GET", "/de/dienstleistungen");
    expect([dePrefixed.status, dePrefixed.location]).toEqual([301, "/dienstleistungen"]);
    // Sitemap con el principal sin prefijo y el español como alternativa
    const sm = await ess.call("a", "GET", "/sitemap.xml");
    expect(sm.text).toContain(`https://${ess.host("a")}/dienstleistungen`);
    expect(sm.text).toMatch(/\/es\/servicios/);
    // Menú
    const menuNow = unwrap(await q("cms.getMenuItems", { zone: "header" })) as { label: string; url: string | null }[];
    expect(menuNow.every((i) => i.label.startsWith("DE "))).toBe(true);
    expect(menuNow.some((i) => i.url === "/dienstleistungen")).toBe(true);
    // Auditoría
    const log = unwrap(await q("cms.i18nDefaultChanges")) as any[];
    expect(log[0]).toMatchObject({ from: "es", to: "de", status: "applied" });

    // Aislamiento: la otra empresa sigue monolingüe y sin cambios
    expect((await ess.call("b", "GET", "/servicios")).status).toBe(404);
    expect((await ess.call("b", "GET", "/dienstleistungen")).status).toBe(404);
    expect(unwrap(await ess.q("b", "cms.i18nConfig", undefined, await ess.login("b", "admin"))).locales ?? []).toHaveLength(0);

    // Vuelta atrás: todo como estaba
    const rb = await m("cms.i18nRollbackDefaultLocale", { changeId: log[0].id, confirm: true });
    expect(rb.status, rb.text).toBe(200);
    expect(unwrap(await q("cms.i18nConfig")).defaultLocale).toBe("es");
    expect(await pages()).toEqual(before.pages);
    expect(unwrap(await q("cms.pageEditor", { slug: "servicios" }))).toEqual(before.editor);
    expect(await menuOf("header")).toEqual(before.menu);
    expect((await ess.call("a", "GET", "/servicios")).status).toBe(200);
    expect((await ess.call("a", "GET", "/dienstleistungen")).status).toBe(404);
    // Una vez deshecho no se puede deshacer de nuevo, y el plan vuelve a poder aplicarse
    expect((await m("cms.i18nRollbackDefaultLocale", { changeId: log[0].id, confirm: true })).status).toBe(400);
    expect(unwrap(await q("cms.i18nPlanDefaultLocale", { locale: "de" })).canApply).toBe(true);
    // El alemán sigue validado como traducción tras la vuelta atrás
    expect(unwrap(await q("public.getTenantPage", { slug: "dienstleistungen", locale: "de" })).title).toBe("Dienstleistungen");
  }, 300_000);
});
