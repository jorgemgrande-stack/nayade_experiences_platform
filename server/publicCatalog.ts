/**
 * Catálogo público de la tienda (`/tienda` y `/<idioma>/tienda`): a cada producto se le añade, si se pide, su precio
 * «desde» (la opción vigente más barata) y sus textos en el idioma de la página.
 *
 * Mismas reglas que la ficha (ProductDetail): solo con precio visible (precio fijo o «precio visible, por solicitud») y
 * precio base > 0; «Desde» en cuanto tiene alguna opción. Los «bajo petición» y «próximamente», nunca. Las opciones de
 * todos los productos se leen en UNA consulta (la ruta es pública), con el mismo filtro de caducidad que la ficha.
 */
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { experienceVariants } from "../drizzle/schema";
import { showsPrice } from "../shared/offerMode";
import { fromPrice } from "../shared/storefront";

type Row = { id: number; slug: string; title: string; shortDescription?: string | null; basePrice?: string | number | null; offerMode?: string | null };
type VariantRow = { experienceId: number; priceModifier: string | null; priceType: "fixed" | "percentage" | "per_person" };

/** Opciones vigentes y activas (0098) de varios productos (una consulta), agrupadas por producto. */
export async function variantsByProduct(ids: number[]): Promise<Map<number, VariantRow[]>> {
  const out = new Map<number, VariantRow[]>();
  if (!ids.length) return out;
  const { getDb, todayMadridISO } = await import("./db");
  const db = await getDb();
  if (!db) return out;
  const rows = await db.select({ experienceId: experienceVariants.experienceId, priceModifier: experienceVariants.priceModifier, priceType: experienceVariants.priceType })
    .from(experienceVariants)
    .where(and(inArray(experienceVariants.experienceId, ids), isNull(experienceVariants.supplementGroup), eq(experienceVariants.isActive, true), or(isNull(experienceVariants.validUntil), sql`${experienceVariants.validUntil} >= ${todayMadridISO()}`)));
  for (const r of rows as VariantRow[]) out.set(r.experienceId, [...(out.get(r.experienceId) ?? []), r]);
  return out;
}

export function catalogPrice(p: Row, variants: VariantRow[]): { fromPrice: number | null; hasOptions: boolean } {
  const base = Number(p.basePrice ?? 0) || 0;
  if (!showsPrice(p) || base <= 0) return { fromPrice: null, hasOptions: false };
  return { fromPrice: fromPrice(base, variants as never), hasOptions: variants.length > 0 };
}

export async function catalogRows<T extends Row>(rows: T[], opts: { withFromPrice: boolean; locale?: string }, load: (ids: number[]) => Promise<Map<number, VariantRow[]>> = variantsByProduct): Promise<Array<T & { fromPrice?: number | null; hasOptions?: boolean }>> {
  let out: Array<T & { fromPrice?: number | null; hasOptions?: boolean }> = rows;
  if (opts.withFromPrice) {
    const priced = rows.filter((p) => showsPrice(p) && (Number(p.basePrice ?? 0) || 0) > 0).map((p) => p.id);
    const byProduct = await load(priced);
    out = rows.map((p) => ({ ...p, ...catalogPrice(p, byProduct.get(p.id) ?? []) }));
  }
  if (opts.locale) {
    const [{ localizeProducts }, { sqlI18nRepo }] = await Promise.all([import("./i18nProducts"), import("./i18nSqlRepo")]);
    out = await localizeProducts(sqlI18nRepo(), out, opts.locale);
  }
  return out;
}
