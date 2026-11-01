/**
 * Páginas iniciales de la web de cada empresa (portada y textos legales genéricos) en SU base de datos.
 *
 * Se crean una sola vez por empresa, la primera vez que se lee su web o su lista de páginas (alta nueva o empresa ya
 * existente sin ellas): solo las que falten, sin pisar nada que la empresa tenga. Un texto legal que siga siendo el de
 * relleno de las plantillas antiguas («Complete este texto…») se sustituye por el genérico y se publica. Después, lo
 * que la empresa borre o despublique se respeta (marca `site_starter_pages`). Solo en multiempresa.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { staticPages, systemSettings } from "../drizzle/schema";
import { getDb } from "./db";
import { getTenantId, isMultiTenant } from "./_core/tenant";
import { isLegalPlaceholder } from "../shared/tenantNav";
import { STARTER_PAGES, STARTER_PAGES_SETTING_KEY, STARTER_PAGE_SLUGS, type SiteTokenData } from "./_core/templates/starterSite";

/** Empresas ya revisadas en este proceso (evita la consulta en cada lectura). */
const ensured = new Set<string>();

export function _resetStarterPagesForTests(): void {
  ensured.clear();
}

/** Crea las páginas iniciales que falten (idempotente). Nunca lanza: la web se sirve igual si algo falla. */
export async function ensureStarterPages(): Promise<void> {
  if (!isMultiTenant()) return;
  let tenantId: string;
  try {
    tenantId = getTenantId();
  } catch {
    return;
  }
  if (ensured.has(tenantId)) return;
  try {
    const db = await getDb();
    if (!db) return;
    const [flag] = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, STARTER_PAGES_SETTING_KEY)).limit(1);
    if (!flag) {
      const rows = await db.select({ slug: staticPages.slug, content: staticPages.content }).from(staticPages).where(inArray(staticPages.slug, STARTER_PAGE_SLUGS as string[]));
      const have = new Map(rows.map((r) => [r.slug, r.content]));
      const now = new Date();
      for (const p of STARTER_PAGES) {
        if (!have.has(p.slug)) {
          // Misma fecha de creación y de cambio: no cuenta como «web revisada» en Primeros pasos
          await db.insert(staticPages).ignore().values({ slug: p.slug, title: p.title, content: p.content, metaDescription: p.metaDescription ?? null, isPublished: true, createdAt: now, updatedAt: now });
        } else if (isLegalPlaceholder(p.slug, have.get(p.slug))) {
          await db.update(staticPages).set({ content: p.content, isPublished: true, updatedAt: sql`${staticPages.createdAt}` }).where(eq(staticPages.slug, p.slug));
        }
      }
      await db
        .insert(systemSettings)
        .values({ key: STARTER_PAGES_SETTING_KEY, value: "1", label: "Páginas iniciales de la web creadas", category: "web" })
        .onDuplicateKeyUpdate({ set: { value: "1" } });
    }
    ensured.add(tenantId);
  } catch (e) {
    console.warn("[starterSite] No se pudieron crear las páginas iniciales:", (e as Error).message);
  }
}

/** Datos de la empresa para sus páginas: contacto público y, para los textos legales, su identidad fiscal. */
export async function readSiteTokenData(): Promise<SiteTokenData> {
  const { getSystemSetting } = await import("./config");
  const get = (k: string) => getSystemSetting(k, "").catch(() => "");
  const [brand, phone, legalPhone, businessEmail, reservationsEmail, legalEmail, location] = await Promise.all([
    get("brand_name"), get("brand_phone"), get("site_legal_phone"), get("site_business_email"), get("email_reservations"), get("site_legal_email"), get("brand_location"),
  ]);
  let legal = { name: "", cif: "", address: "", email: "", phone: "" };
  try {
    // Misma fuente que el emisor de facturas y tickets (entidad fiscal o «Datos de la empresa»)
    const { getLegalCompanySettings } = await import("./invoiceHtml");
    const { formatLegalAddress } = await import("./tenantBrand");
    const l = await getLegalCompanySettings();
    legal = { name: l.name, cif: l.cif, address: formatLegalAddress(l), email: l.email, phone: l.phone };
  } catch {
    /* sin datos fiscales: los textos legales omiten esas líneas */
  }
  return {
    nombre: brand || legal.name,
    razon_social: legal.name,
    nif: legal.cif,
    domicilio: legal.address,
    email: legal.email || legalEmail || businessEmail || reservationsEmail,
    telefono: legal.phone || legalPhone || phone,
    direccion: location,
  };
}

/** Datos fiscales que faltan para completar los textos legales (para el aviso de Primeros pasos). */
export function missingLegalData(d: SiteTokenData): string[] {
  const labels: Array<[keyof SiteTokenData, string]> = [
    ["razon_social", "razón social"],
    ["nif", "NIF"],
    ["domicilio", "domicilio fiscal"],
    ["email", "correo electrónico de contacto"],
  ];
  return labels.filter(([k]) => !(d[k] ?? "").trim()).map(([, l]) => l);
}
