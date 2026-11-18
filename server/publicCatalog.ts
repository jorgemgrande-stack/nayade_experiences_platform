/**
 * Catálogo público de la tienda (`/tienda` y `/<idioma>/tienda`): a cada producto se le añade, si se pide, su precio
 * «desde» (la opción vigente más barata, como en su ficha) y sus textos en el idioma de la página.
 *
 * Solo los productos que enseñan precio (precio fijo o «precio visible, por solicitud») llevan `fromPrice`; los «bajo
 * petición» y «próximamente», nunca. Con `hasOptions`, la tarjeta dice «Desde».
 */
import { showsPrice } from "../shared/offerMode";
import { fromPrice } from "../shared/storefront";

type Row = { id: number; slug: string; title: string; shortDescription?: string | null; basePrice?: string | number | null; offerMode?: string | null };

export async function catalogRows<T extends Row>(rows: T[], opts: { withFromPrice: boolean; locale?: string }): Promise<Array<T & { fromPrice?: number | null; hasOptions?: boolean }>> {
  let out: Array<T & { fromPrice?: number | null; hasOptions?: boolean }> = rows;
  if (opts.withFromPrice) {
    const { getVariantsByExperience } = await import("./db");
    out = await Promise.all(rows.map(async (p) => {
      if (!showsPrice(p)) return { ...p, fromPrice: null, hasOptions: false };
      const base = Number(p.basePrice ?? 0) || 0;
      const variants = await getVariantsByExperience(p.id);
      const price = fromPrice(base, variants as never);
      return { ...p, fromPrice: price > 0 ? price : null, hasOptions: variants.length > 1 };
    }));
  }
  if (opts.locale) {
    const [{ localizeProducts }, { sqlI18nRepo }] = await Promise.all([import("./i18nProducts"), import("./i18nSqlRepo")]);
    out = await localizeProducts(sqlI18nRepo(), out, opts.locale);
  }
  return out;
}
