/**
 * GET /sitemap.xml
 *
 * Sitemap dinámico generado desde la base de datos.
 * Cache de 1 hora (Cache-Control + ETag implícito de Express).
 *
 * En multiempresa: URL pública de la empresa (subdominio o dominio propio verificado) y solo lo que tiene
 * publicado y contratado: portada, contacto, sus páginas, su blog (cms-blog), su catálogo si lo ha publicado
 * y las secciones sectoriales (hotel, spa, restaurantes) solo con su módulo; y un robots.txt propio que
 * apunta a su sitemap. La tienda online aún no tiene página pública propia, así que no figura.
 */

import { Router } from "express";
import { and, eq, notLike } from "drizzle-orm";
import {
  staticPages,
  experiences,
  legoPacks,
  restaurants,
  roomTypes,
  spaTreatments,
  locations,
} from "../drizzle/schema";
import { legacyDb, legacyPool } from "./_core/legacyDb";
import { isMultiTenant } from "./_core/tenant";
import { isLegalPlaceholder } from "../shared/tenantNav";
import { publicBaseUrl } from "./_core/productIdentity";
import { getCapabilityAccess } from "./_core/capabilities/access";
import { listPublishedForSitemap } from "./blogDb";
import { getModuleAccess } from "./_core/modules/runtime";

/** Módulo sectorial contratado y activo (en una sola empresa, lo instalado). */
async function moduleOn(id: string): Promise<boolean> {
  try {
    return await getModuleAccess().isModuleAvailable(id);
  } catch {
    return false;
  }
}

/** El blog figura en el sitemap si la empresa lo tiene contratado (activo o en solo lectura). */
async function blogLicensed(): Promise<boolean> {
  try {
    return (await getCapabilityAccess().check("cms-blog", { write: false })).allowed;
  } catch {
    return false;
  }
}

const _pool = legacyPool();
const db = legacyDb();

/** Rutas públicas del Core disponibles para cualquier empresa (lo demás depende de lo publicado y contratado). */
const TENANT_STATIC_URLS: Array<{ path: string; changefreq: string; priority: string }> = [
  { path: "/",             changefreq: "weekly",  priority: "1.0" },
  { path: "/contacto",     changefreq: "weekly",  priority: "0.8" },
];

const STATIC_URLS: Array<{ path: string; changefreq: string; priority: string }> = [
  { path: "/",               changefreq: "weekly",  priority: "1.0" },
  { path: "/experiencias",   changefreq: "weekly",  priority: "0.8" },
  { path: "/galeria",        changefreq: "weekly",  priority: "0.8" },
  { path: "/presupuesto",    changefreq: "weekly",  priority: "0.8" },
  { path: "/colegios",       changefreq: "weekly",  priority: "0.8" },
  { path: "/canjear-cupon",  changefreq: "weekly",  priority: "0.8" },
  { path: "/contacto",       changefreq: "weekly",  priority: "0.8" },
  { path: "/ubicaciones",    changefreq: "weekly",  priority: "0.8" },
  { path: "/lego-packs",     changefreq: "weekly",  priority: "0.8" },
  { path: "/hotel",          changefreq: "weekly",  priority: "0.8" },
  { path: "/spa",            changefreq: "weekly",  priority: "0.8" },
  { path: "/restaurantes",   changefreq: "weekly",  priority: "0.8" },
  { path: "/privacidad",     changefreq: "monthly", priority: "0.6" },
  { path: "/terminos",       changefreq: "monthly", priority: "0.6" },
  { path: "/cookies",        changefreq: "monthly", priority: "0.6" },
];

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return new Date().toISOString().slice(0, 10);
  return d instanceof Date ? d.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function urlEntry(base: string, loc: string, lastmod?: string, changefreq = "monthly", priority = "0.6"): string {
  const lastmodTag = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : "";
  return `  <url>
    <loc>${escapeXml(base + loc)}</loc>${lastmodTag}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

export const sitemapRouter = Router();

sitemapRouter.get("/robots.txt", (_req, res, next) => {
  // En una sola empresa se sirve el fichero estático de siempre
  if (!isMultiTenant()) return next();
  const base = publicBaseUrl().replace(/\/+$/, "");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
  res.status(200).send(`User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`);
});

sitemapRouter.get("/sitemap.xml", async (_req, res) => {
  try {
    const multi = isMultiTenant();
    const BASE_URL = publicBaseUrl().replace(/\/+$/, "");
    const url = (loc: string, lastmod?: string, changefreq?: string, priority?: string) => urlEntry(BASE_URL, loc, lastmod, changefreq, priority);
    const pageRows = multi
      ? (await db.select({ slug: staticPages.slug, content: staticPages.content, updatedAt: staticPages.updatedAt }).from(staticPages).where(eq(staticPages.isPublished, true))).filter((r) => !isLegalPlaceholder(r.slug, r.content))
      : [];
    // Blog (solo multi y con la capacidad contratada): /blog y sus entradas publicadas, nunca borradores
    const blogRows = multi && (await blogLicensed()) ? await listPublishedForSitemap(Date.now()) : null;
    const [hotelOn, spaOn, restaurantsOn] = await Promise.all([moduleOn("hotel"), moduleOn("spa"), moduleOn("restaurants")]);
    const [
      expRows,
      legoRows,
      legoCategories,
      restaurantRows,
      roomRows,
      spaRows,
      locationRows,
    ] = await Promise.all([
      db
        .select({ slug: experiences.slug, updatedAt: experiences.updatedAt })
        .from(experiences)
        .where(and(
          eq(experiences.isActive, true),
          eq(experiences.isPublished, true),
          notLike(experiences.slug, "%-copia-%"),
          notLike(experiences.slug, "%-"),
        )),

      db
        .select({ slug: legoPacks.slug, updatedAt: legoPacks.updatedAt })
        .from(legoPacks)
        .where(and(eq(legoPacks.isActive, true), eq(legoPacks.isPublished, true))),

      db
        .selectDistinct({ category: legoPacks.category })
        .from(legoPacks)
        .where(and(eq(legoPacks.isActive, true), eq(legoPacks.isPublished, true))),

      db
        .select({ slug: restaurants.slug, updatedAt: restaurants.updatedAt })
        .from(restaurants)
        .where(eq(restaurants.isActive, true)),

      db
        .select({ slug: roomTypes.slug, updatedAt: roomTypes.updatedAt })
        .from(roomTypes)
        .where(eq(roomTypes.isActive, true)),

      db
        .select({ slug: spaTreatments.slug, updatedAt: spaTreatments.updatedAt })
        .from(spaTreatments)
        .where(eq(spaTreatments.isActive, true)),

      db
        .select({ slug: locations.slug, updatedAt: locations.updatedAt })
        .from(locations)
        .where(eq(locations.isActive, true)),
    ]);

    const entries: string[] = [];
    const seen = new Set<string>();
    const add = (loc: string, lastmod?: string, changefreq?: string, priority?: string) => {
      if (seen.has(loc)) return;
      seen.add(loc);
      entries.push(url(loc, lastmod, changefreq, priority));
    };

    // Rutas estáticas; en multiempresa, las sectoriales solo con su módulo y lo que la empresa ha publicado
    for (const u of multi ? TENANT_STATIC_URLS : STATIC_URLS) {
      if (!multi && ((u.path === "/hotel" && !hotelOn) || (u.path === "/spa" && !spaOn) || (u.path === "/restaurantes" && !restaurantsOn))) continue;
      add(u.path, undefined, u.changefreq, u.priority);
    }
    // Pyme: su tienda y su formulario de presupuesto solo si los tiene contratados; nada de Lego Packs (shared/publicSite.ts)
    const site = await (await import("./publicSite")).readPublicSiteFeatures();
    if (multi) {
      if (expRows.length > 0) {
        if (!site.licensed) add("/experiencias", undefined, "weekly", "0.8");
        else if (site.store) add("/tienda", undefined, "weekly", "0.8");
        if (site.quotes) add("/presupuesto", undefined, "weekly", "0.8");
      }
      if (hotelOn && roomRows.length > 0) add("/hotel", undefined, "weekly", "0.8");
      if (spaOn && spaRows.length > 0) add("/spa", undefined, "weekly", "0.8");
      if (restaurantsOn && restaurantRows.length > 0) add("/restaurantes", undefined, "weekly", "0.8");
      if (legoRows.length > 0 && !site.licensed) add("/lego-packs", undefined, "weekly", "0.8");
      if (locationRows.length > 0) add("/ubicaciones", undefined, "weekly", "0.8");
    }

    // Páginas propias publicadas de la empresa (/:slug); «inicio» es la portada
    for (const r of pageRows) {
      if (/^[a-z0-9-]{1,64}$/.test(r.slug) && r.slug !== "inicio" && !(blogRows && r.slug === "blog")) add(`/${r.slug}`, formatDate(r.updatedAt));
    }

    if (blogRows) {
      add("/blog", blogRows[0] ? formatDate(blogRows[0].updatedAt) : undefined, "weekly", "0.7");
      for (const r of blogRows) add(`/blog/${r.slug}`, formatDate(r.updatedAt));
    }

    // /experiencias/:slug (slugs malformados ya excluidos en la query)
    for (const r of expRows) {
      add(`/experiencias/${r.slug}`, formatDate(r.updatedAt));
    }

    // /lego-packs/:category (DISTINCT)
    for (const r of site.licensed ? [] : legoCategories) {
      add(`/lego-packs/${r.category}`);
    }

    // /lego-packs/detalle/:slug
    for (const r of site.licensed ? [] : legoRows) {
      add(`/lego-packs/detalle/${r.slug}`, formatDate(r.updatedAt));
    }

    // /restaurantes/:slug  (omitimos /reservar — formulario de acción, no indexable)
    for (const r of restaurantsOn ? restaurantRows : []) {
      add(`/restaurantes/${r.slug}`, formatDate(r.updatedAt));
    }

    // /hotel/:slug
    for (const r of hotelOn ? roomRows : []) {
      add(`/hotel/${r.slug}`, formatDate(r.updatedAt));
    }

    // /spa/:slug
    for (const r of spaOn ? spaRows : []) {
      add(`/spa/${r.slug}`, formatDate(r.updatedAt));
    }

    // /ubicaciones/:slug
    for (const r of locationRows) {
      add(`/ubicaciones/${r.slug}`, formatDate(r.updatedAt));
    }

    // /pagina/* excluido — contenido duplicado de rutas canónicas

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
    res.status(200).send(xml);
  } catch (err) {
    console.error("[Sitemap] Error generando sitemap:", err);
    res.status(500).send("Error generando sitemap");
  }
});
