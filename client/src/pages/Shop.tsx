/**
 * Catálogo de una pyme (`/tienda` y, en una web multidioma, `/<idioma>/tienda`): sus productos y servicios
 * publicados, con buscador y categorías propias. Cada tarjeta lleva a su ficha en el idioma de la página.
 *  - Los que se contratan por solicitud salen con su insignia («Por solicitud», «Bajo petición», «Próximamente»).
 *  - Precio «desde» (la opción más barata, como en la ficha) solo si el producto enseña precio.
 *  - Título: la etiqueta del menú que enlaza aquí («Angebote», «Programas y servicios»…) o «Tienda» en su idioma.
 *  - `?categoria=<slug>` abre el catálogo filtrado (botones de las páginas de la empresa).
 * Nada de otra empresa ni textos sectoriales.
 */
import { useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { Search } from "lucide-react";
import PublicLayout from "@/components/PublicLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { usePublicContact } from "@/hooks/usePublicPhone";
import { useSiteLocale } from "@/hooks/useSiteLocale";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { formatEuros, productPath, SHOP_PATH } from "@shared/storefront";
import { isPurchasable } from "@shared/shopOrders";
import { onlinePayable } from "@shared/purchaseState";
import { useStorefront } from "@/components/StorefrontRoute";
import { offerModeOf, showsPrice } from "@shared/offerMode";
import { offerBadgeText, siteUiText } from "@shared/siteUiText";
import { shopTitleFromMenu } from "@shared/tenantNav";

type Item = { id: number; slug: string; title: string; categoryId?: number | null; shortDescription?: string | null; image1?: string | null; coverImageUrl?: string | null; basePrice?: string | null; isActive?: boolean | null; isPublished?: boolean | null; offerMode?: string | null; fromPrice?: number | null; hasOptions?: boolean };

/** Productos por página (el máximo que sirve la consulta pública). */
const PAGE = 50;

/** Texto sin acentos ni mayúsculas, para buscar «cafe» y encontrar «Café». */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function Shop() {
  const { brandName } = usePublicContact();
  const site = useSiteLocale();
  const t = siteUiText(site.locale);
  const localeArg = site.prefix ? { locale: site.prefix } : {};
  const params = new URLSearchParams(useSearch());
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  const [pages, setPages] = useState(1);
  const queries = trpc.useQueries((q) => Array.from({ length: pages }, (_, i) => q.public.getExperiences({ limit: PAGE, offset: i * PAGE, includeSoldOut: true, withFromPrice: true, ...localeArg })));
  const { data: categories = [] } = trpc.public.getCategories.useQuery(site.prefix ? { locale: site.prefix } : undefined);
  const { data: menu } = trpc.public.getMenuItems.useQuery({ zone: "header", ...localeArg }, { staleTime: 5 * 60 * 1000 });
  const shopHref = site.prefix ? `/${site.prefix}${SHOP_PATH}` : SHOP_PATH;
  // Sin pasarela de cobro activa, lo comprable se anuncia «Pronto disponible online» (la ficha y el pago lo repiten)
  const { storefront } = useStorefront();
  const payable = onlinePayable(storefront?.payments);
  const title = shopTitleFromMenu(menu as Array<{ label?: string | null; url?: string | null; isActive?: boolean | null }> | undefined, shopHref) ?? t.shop;
  useDocumentMeta({ title: brandName ? `${title} · ${brandName}` : title });

  const isLoading = queries[0]?.isLoading ?? true;
  const loadingMore = pages > 1 && !!queries[pages - 1]?.isLoading;
  const last = queries[pages - 1]?.data as Item[] | undefined;
  const hasMore = !!last && last.length === PAGE;
  const dataKey = queries.map((q) => q.dataUpdatedAt).join(",");
  const items = useMemo(() => {
    const seen = new Set<number>();
    return queries.flatMap((q) => (q.data ?? []) as Item[]).filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);
  const used = new Set(items.map((i) => i.categoryId));
  const cats = (categories as Array<{ id: number; name: string; slug?: string }>).filter((c) => used.has(c.id));
  // Categoría de la URL hasta que la persona elige otra
  const fromUrl = cats.find((c) => c.slug && c.slug === params.get("categoria"))?.id ?? null;
  const active = touched ? category : fromUrl;
  const choose = (id: number | null) => { setTouched(true); setCategory(id); };
  const q = fold(search.trim());
  const shown = items.filter((i) => (!q || fold(`${i.title} ${i.shortDescription ?? ""}`).includes(q)) && (!active || i.categoryId === active));
  const href = (slug: string) => (site.prefix ? `/${site.prefix}${productPath(slug)}` : productPath(slug));

  return (
    <PublicLayout>
      <section className="container pt-10 pb-6">
        <h1 className="text-3xl md:text-4xl font-heading font-bold text-foreground">{title}</h1>
        {items.length > 0 && (
          <div className="mt-6 space-y-3">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input aria-label={t.searchShop} placeholder={t.searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            {cats.length > 1 && (
              <div className="flex flex-wrap gap-2" role="group" aria-label={t.categoriesLabel}>
                <button type="button" aria-pressed={!active} onClick={() => choose(null)} className={cn("px-3 py-1.5 rounded-full text-sm", !active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
                  {t.allCategories}
                </button>
                {cats.map((c) => (
                  <button key={c.id} type="button" aria-pressed={active === c.id} onClick={() => choose(c.id)} className={cn("px-3 py-1.5 rounded-full text-sm", active === c.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="container pb-16 text-foreground">
        {isLoading ? (
          <div className="py-16 flex justify-center" role="status" aria-label={t.loading}>
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : shown.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground space-y-3">
            <p>{items.length === 0 ? t.noProducts : t.noMatches}</p>
            {items.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => { setSearch(""); choose(null); }}>{t.viewAll}</Button>
            )}
          </div>
        ) : (
          <>
            <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              {shown.map((p) => {
                const img = p.image1 || p.coverImageUrl;
                const mode = offerModeOf(p);
                const amount = p.fromPrice != null ? p.fromPrice : Number(p.basePrice) > 0 ? Number(p.basePrice) : null;
                const price = amount != null && amount > 0 ? formatEuros(amount) : null;
                // E-6: «Por solicitud» / «Bajo petición» / «Próximamente» (nunca «Agotado»)
                const offerBadge = mode === "fixed" ? null : offerBadgeText(t, mode);
                const soldOut = !offerBadge && !isPurchasable(p);
                const soonOnline = !offerBadge && !soldOut && !payable;
                return (
                  <Link key={p.id} href={href(p.slug)} className="group block rounded-2xl border border-border/50 overflow-hidden bg-card shadow-sm hover:shadow-md transition-shadow">
                    <div className="relative">
                      {img ? <img src={img} alt={p.title} className={cn("w-full h-44 object-cover", soldOut && "opacity-60")} loading="lazy" /> : <div className="w-full h-44 bg-muted" aria-hidden="true" />}
                      {soldOut && <span className="absolute left-3 top-3 rounded-full bg-foreground/80 px-2.5 py-1 text-xs font-semibold text-background">{t.soldOut}</span>}
                      {soonOnline && <span data-testid="insignia-pronto-online" className="absolute left-3 top-3 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">{t.soonOnline}</span>}
                      {offerBadge && <span data-testid="insignia-oferta" className="absolute left-3 top-3 rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">{offerBadge}</span>}
                    </div>
                    <div className="p-4 space-y-1">
                      <h2 className="font-heading font-semibold group-hover:text-primary break-words">{p.title}</h2>
                      {p.shortDescription && <p className="text-sm text-muted-foreground line-clamp-2">{p.shortDescription}</p>}
                      {price && (!offerBadge || showsPrice(p)) && <p className={cn("text-sm font-semibold", soldOut && "text-muted-foreground")}>{p.hasOptions ? `${t.from} ${price}` : price}</p>}
                    </div>
                  </Link>
                );
              })}
            </div>
            {hasMore && (
              <div className="mt-8 flex justify-center">
                <Button variant="outline" onClick={() => setPages((n) => n + 1)} disabled={loadingMore}>{loadingMore ? t.loadingMore : t.loadMore}</Button>
              </div>
            )}
          </>
        )}
      </section>
    </PublicLayout>
  );
}
