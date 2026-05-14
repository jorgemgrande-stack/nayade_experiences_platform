/**
 * GET /sitemap.xml
 *
 * Sitemap dinámico generado desde la base de datos.
 * Cache de 1 hora (Cache-Control + ETag implícito de Express).
 */

import { Router } from "express";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { and, eq, sql } from "drizzle-orm";
import {
  experiences,
  legoPacks,
  restaurants,
  roomTypes,
  spaTreatments,
  locations,
  staticPages,
} from "../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const db = drizzle(_pool);

const BASE_URL = "https://nayadeexperiences.es";

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

function urlEntry(loc: string, lastmod?: string, changefreq = "monthly", priority = "0.6"): string {
  const lastmodTag = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : "";
  return `  <url>
    <loc>${escapeXml(BASE_URL + loc)}</loc>${lastmodTag}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

export const sitemapRouter = Router();

sitemapRouter.get("/sitemap.xml", async (_req, res) => {
  try {
    const [
      expRows,
      legoRows,
      legoCategories,
      restaurantRows,
      roomRows,
      spaRows,
      locationRows,
      pageRows,
    ] = await Promise.all([
      db
        .select({ slug: experiences.slug, updatedAt: experiences.updatedAt })
        .from(experiences)
        .where(and(eq(experiences.isActive, true), eq(experiences.isPublished, true))),

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

      db
        .select({ slug: staticPages.slug, updatedAt: staticPages.updatedAt })
        .from(staticPages)
        .where(eq(staticPages.isPublished, true)),
    ]);

    const entries: string[] = [];

    // Rutas estáticas
    for (const u of STATIC_URLS) {
      entries.push(urlEntry(u.path, undefined, u.changefreq, u.priority));
    }

    // /experiencias/:slug
    for (const r of expRows) {
      entries.push(urlEntry(`/experiencias/${r.slug}`, formatDate(r.updatedAt)));
    }

    // /lego-packs/:category (DISTINCT)
    for (const r of legoCategories) {
      entries.push(urlEntry(`/lego-packs/${r.category}`));
    }

    // /lego-packs/detalle/:slug
    for (const r of legoRows) {
      entries.push(urlEntry(`/lego-packs/detalle/${r.slug}`, formatDate(r.updatedAt)));
    }

    // /restaurantes/:slug  +  /restaurantes/:slug/reservar
    for (const r of restaurantRows) {
      entries.push(urlEntry(`/restaurantes/${r.slug}`, formatDate(r.updatedAt)));
      entries.push(urlEntry(`/restaurantes/${r.slug}/reservar`, formatDate(r.updatedAt)));
    }

    // /hotel/:slug
    for (const r of roomRows) {
      entries.push(urlEntry(`/hotel/${r.slug}`, formatDate(r.updatedAt)));
    }

    // /spa/:slug
    for (const r of spaRows) {
      entries.push(urlEntry(`/spa/${r.slug}`, formatDate(r.updatedAt)));
    }

    // /ubicaciones/:slug
    for (const r of locationRows) {
      entries.push(urlEntry(`/ubicaciones/${r.slug}`, formatDate(r.updatedAt)));
    }

    // /pagina/:slug
    for (const r of pageRows) {
      entries.push(urlEntry(`/pagina/${r.slug}`, formatDate(r.updatedAt)));
    }

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
