/**
 * Ocultar la web de una empresa a los buscadores (`site_noindex` = "1").
 *
 * Para empresas de demostración o internas (Elephant Demo) y para una web aún en preparación: robots.txt con
 * `Disallow: /`, sitemap vacío y `noindex` en todas las páginas públicas. Lo decide el administrador de la empresa
 * desde Configuración → Negocio; sin la fila, la web se indexa como siempre. Solo en multiempresa.
 */
import { eq } from "drizzle-orm";
import { configChangeLogs, systemSettings } from "../drizzle/schema";
import { getSystemSetting, invalidateConfigCache } from "./config";
import { getDb } from "./db";
import { isMultiTenant } from "./_core/tenant";

export const SEARCH_NOINDEX_KEY = "site_noindex";

export async function searchIndexingOff(): Promise<boolean> {
  if (!isMultiTenant()) return false;
  return (await getSystemSetting(SEARCH_NOINDEX_KEY, "")).trim() === "1";
}

/** robots.txt de la empresa (con la web oculta, nada se rastrea). */
export function robotsTxt(base: string, off: boolean): string {
  if (off) return "User-agent: *\nDisallow: /\n";
  return `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`;
}

export const EMPTY_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n`;

/** Añade `<meta name="robots" content="noindex, nofollow">` al HTML si aún no lo lleva. */
export function withNoindexMeta(html: string): string {
  if (/<meta name="robots"/.test(html)) return html.replace(/<meta name="robots" content="[^"]*" \/>/, '<meta name="robots" content="noindex, nofollow" />');
  return html.replace(/<meta charset="UTF-8" \/>/, '<meta charset="UTF-8" />\n    <meta name="robots" content="noindex, nofollow" />');
}

/** Guarda la preferencia (crea la fila si la empresa no la tenía) y deja constancia en el registro de cambios. */
export async function setSearchIndexingOff(off: boolean, by: { id: number; name: string }): Promise<{ off: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("Base de datos no disponible");
  const value = off ? "1" : "0";
  const [row] = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, SEARCH_NOINDEX_KEY)).limit(1);
  if (row) {
    if ((row.value ?? "") === value) return { off };
    await db.update(systemSettings).set({ value }).where(eq(systemSettings.key, SEARCH_NOINDEX_KEY));
  } else {
    await db.insert(systemSettings).values({
      key: SEARCH_NOINDEX_KEY,
      value,
      valueType: "boolean",
      category: "seo",
      label: "Ocultar la web en los buscadores",
      description: "robots.txt sin rastreo, sitemap vacío y noindex en las páginas públicas",
      isPublic: false,
      isSensitive: false,
    });
  }
  await db.insert(configChangeLogs).values({ entityType: "system_setting", key: SEARCH_NOINDEX_KEY, oldValue: row?.value ?? null, newValue: value, changedById: by.id, changedByName: by.name });
  invalidateConfigCache();
  return { off };
}
