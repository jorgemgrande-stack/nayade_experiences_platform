/**
 * Tienda online de una pyme (`/tienda`): sus productos y servicios publicados, con buscador y categorías propias.
 * Cada tarjeta lleva a la ficha genérica (`/tienda/:slug`). Nada de otra empresa ni textos sectoriales.
 */
import { useState } from "react";
import { Link } from "wouter";
import { Search } from "lucide-react";
import PublicLayout from "@/components/PublicLayout";
import { Input } from "@/components/ui/input";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { usePublicContact } from "@/hooks/usePublicPhone";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { formatEuros, productPath } from "@shared/storefront";

type Item = { id: number; slug: string; title: string; categoryId?: number | null; shortDescription?: string | null; image1?: string | null; coverImageUrl?: string | null; basePrice?: string | null };

export default function Shop() {
  const { brandName } = usePublicContact();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<number | null>(null);
  const { data, isLoading } = trpc.public.getExperiences.useQuery({ limit: 50, offset: 0 });
  const { data: categories = [] } = trpc.public.getCategories.useQuery();
  useDocumentMeta({ title: brandName ? `Tienda · ${brandName}` : "Tienda" });

  const items = (data ?? []) as Item[];
  const used = new Set(items.map((i) => i.categoryId));
  const cats = (categories as Array<{ id: number; name: string }>).filter((c) => used.has(c.id));
  const q = search.trim().toLowerCase();
  const shown = items.filter((i) => (!q || i.title.toLowerCase().includes(q)) && (!category || i.categoryId === category));

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

      <section className="container pb-16">
        {isLoading ? (
          <div className="py-16 flex justify-center" role="status" aria-label="Cargando">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : shown.length === 0 ? (
          <p className="py-16 text-center text-muted-foreground">{items.length === 0 ? "Todavía no hay productos publicados." : "No hay productos que coincidan con la búsqueda."}</p>
        ) : (
          <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {shown.map((p) => {
              const img = p.image1 || p.coverImageUrl;
              const price = Number(p.basePrice) > 0 ? formatEuros(p.basePrice) : null;
              return (
                <Link key={p.id} href={productPath(p.slug)} className="group block rounded-2xl border border-border/50 overflow-hidden bg-card shadow-sm hover:shadow-md transition-shadow">
                  {img ? <img src={img} alt={p.title} className="w-full h-44 object-cover" loading="lazy" /> : <div className="w-full h-44 bg-muted" aria-hidden="true" />}
                  <div className="p-4 space-y-1">
                    <h2 className="font-heading font-semibold group-hover:text-primary break-words">{p.title}</h2>
                    {p.shortDescription && <p className="text-sm text-muted-foreground line-clamp-2">{p.shortDescription}</p>}
                    {price && <p className="text-sm font-semibold">{price}</p>}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </PublicLayout>
  );
}
