/**
 * Tienda de la web de cada empresa (pyme con «Tienda online» contratada): sus productos y servicios publicados, con
 * enlace a la ficha de cada uno. Solo sus datos; sin categorías ni textos de otra empresa.
 */
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import PublicLayout from "@/components/PublicLayout";
import { usePageTitle } from "@/components/TenantTheme";

type Product = { id: number; slug: string; title: string; shortDescription?: string | null; image1?: string | null; basePrice?: string | null };

function formatPrice(p?: string | null): string | null {
  const n = Number(p);
  if (!p || !Number.isFinite(n) || n <= 0) return null;
  return n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

export default function TenantShop() {
  usePageTitle("Tienda");
  const q = trpc.public.getExperiences.useQuery({ limit: 50, offset: 0 }, { retry: false });
  const products = (q.data ?? []) as Product[];

  return (
    <PublicLayout>
      <section className="container py-10 md:py-14">
        <h1 className="font-heading text-3xl md:text-4xl font-bold text-primary">Tienda</h1>
        <p className="mt-2 text-foreground/80">Nuestros productos y servicios.</p>

        {q.isLoading && (
          <div className="py-16 flex justify-center">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!q.isLoading && products.length === 0 && (
          <p className="mt-10 text-foreground">
            Todavía no hay productos publicados. Si buscas algo en concreto,{" "}
            <Link href="/contacto" className="underline decoration-primary decoration-2 underline-offset-4">
              escríbenos
            </Link>
            .
          </p>
        )}

        {products.length > 0 && (
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {products.map((p) => (
              <Link key={p.id} href={`/experiencias/${p.slug}`} className="group block rounded-2xl border border-border overflow-hidden bg-card shadow-sm hover:shadow-md transition-shadow">
                {p.image1 && <img src={p.image1} alt={p.title} className="w-full h-44 object-cover" loading="lazy" />}
                <div className="p-4 space-y-1">
                  <h2 className="font-heading font-semibold text-foreground group-hover:text-primary">{p.title}</h2>
                  {p.shortDescription && <p className="text-sm text-muted-foreground line-clamp-2">{p.shortDescription}</p>}
                  {formatPrice(p.basePrice) && <p className="text-sm font-semibold text-foreground">Desde {formatPrice(p.basePrice)}</p>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </PublicLayout>
  );
}
