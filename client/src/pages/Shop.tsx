/**
 * Tienda online de una pyme (`/tienda`): sus productos y servicios publicados, con buscador y categorías propias.
 * Cada tarjeta lleva a la ficha genérica (`/tienda/:slug`). Los publicados que no están a la venta salen como
 * «Agotado». Nada de otra empresa ni textos sectoriales.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Search } from "lucide-react";
import PublicLayout from "@/components/PublicLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { usePublicContact } from "@/hooks/usePublicPhone";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { formatEuros, productPath } from "@shared/storefront";
import { isPurchasable } from "@shared/shopOrders";

type Item = { id: number; slug: string; title: string; categoryId?: number | null; shortDescription?: string | null; image1?: string | null; coverImageUrl?: string | null; basePrice?: string | null; isActive?: boolean | null; isPublished?: boolean | null };

/** Productos por página (el máximo que sirve la consulta pública). */
const PAGE = 50;

/** Texto sin acentos ni mayúsculas, para buscar «cafe» y encontrar «Café». */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function Shop() {
  const { brandName } = usePublicContact();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<number | null>(null);
  const [pages, setPages] = useState(1);
  const queries = trpc.useQueries((t) => Array.from({ length: pages }, (_, i) => t.public.getExperiences({ limit: PAGE, offset: i * PAGE, includeSoldOut: true })));
  const { data: categories = [] } = trpc.public.getCategories.useQuery();
  useDocumentMeta({ title: brandName ? `Tienda · ${brandName}` : "Tienda" });

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
  const cats = (categories as Array<{ id: number; name: string }>).filter((c) => used.has(c.id));
  const q = fold(search.trim());
  const shown = items.filter((i) => (!q || fold(`${i.title} ${i.shortDescription ?? ""}`).includes(q)) && (!category || i.categoryId === category));

  return (
    <PublicLayout>
      <section className="container pt-10 pb-6">
        <h1 className="text-3xl md:text-4xl font-heading font-bold text-foreground">Tienda</h1>
        {items.length > 0 && (
          <div className="mt-6 space-y-3">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input aria-label="Buscar en la tienda" placeholder="Buscar productos..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            {cats.length > 1 && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Categorías">
                <button type="button" aria-pressed={!category} onClick={() => setCategory(null)} className={cn("px-3 py-1.5 rounded-full text-sm", !category ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
                  Todo
                </button>
                {cats.map((c) => (
                  <button key={c.id} type="button" aria-pressed={category === c.id} onClick={() => setCategory(c.id)} className={cn("px-3 py-1.5 rounded-full text-sm", category === c.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
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
          <div className="py-16 flex justify-center" role="status" aria-label="Cargando">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : shown.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground space-y-3">
            <p>{items.length === 0 ? "Todavía no hay productos publicados. Vuelve pronto." : "No hay productos que coincidan con la búsqueda."}</p>
            {items.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => { setSearch(""); setCategory(null); }}>Ver todos los productos</Button>
            )}
          </div>
        ) : (
          <>
            <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              {shown.map((p) => {
                const img = p.image1 || p.coverImageUrl;
                const price = Number(p.basePrice) > 0 ? formatEuros(p.basePrice) : null;
                const soldOut = !isPurchasable(p);
                return (
                  <Link key={p.id} href={productPath(p.slug)} className="group block rounded-2xl border border-border/50 overflow-hidden bg-card shadow-sm hover:shadow-md transition-shadow">
                    <div className="relative">
                      {img ? <img src={img} alt={p.title} className={cn("w-full h-44 object-cover", soldOut && "opacity-60")} loading="lazy" /> : <div className="w-full h-44 bg-muted" aria-hidden="true" />}
                      {soldOut && <span className="absolute left-3 top-3 rounded-full bg-foreground/80 px-2.5 py-1 text-xs font-semibold text-background">Agotado</span>}
                    </div>
                    <div className="p-4 space-y-1">
                      <h2 className="font-heading font-semibold group-hover:text-primary break-words">{p.title}</h2>
                      {p.shortDescription && <p className="text-sm text-muted-foreground line-clamp-2">{p.shortDescription}</p>}
                      {price && <p className={cn("text-sm font-semibold", soldOut && "text-muted-foreground")}>{price}</p>}
                    </div>
                  </Link>
                );
              })}
            </div>
            {hasMore && (
              <div className="mt-8 flex justify-center">
                <Button variant="outline" onClick={() => setPages((n) => n + 1)} disabled={loadingMore}>{loadingMore ? "Cargando..." : "Ver más productos"}</Button>
              </div>
            )}
          </>
        )}
      </section>
    </PublicLayout>
  );
}
