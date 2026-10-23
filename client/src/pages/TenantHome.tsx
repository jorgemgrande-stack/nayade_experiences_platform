/**
 * Portada de la web de cada empresa, con SUS datos: la primera diapositiva activa de su carrusel como cabecera (CMS →
 * Slideshow), el texto de su página «inicio» y sus productos destacados (Productos → «Destacado»). Lo que la empresa
 * no haya configurado no se muestra; nunca contenido de otra empresa.
 */
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import PublicLayout from "@/components/PublicLayout";
import { Button } from "@/components/ui/button";
import { HOME_PAGE_SLUG } from "@/lib/homeRoute";

type Slide = { id: number; imageUrl: string; badge?: string | null; title?: string | null; subtitle?: string | null; ctaText?: string | null; ctaUrl?: string | null };
type Product = { id: number; slug: string; title: string; shortDescription?: string | null; image1?: string | null; basePrice?: string | null };

const isSafeUrl = (u?: string | null): u is string => !!u && (/^\/(?!\/)/.test(u) || /^https:\/\//.test(u));

function formatPrice(p?: string | null): string | null {
  const n = Number(p);
  if (!p || !Number.isFinite(n) || n <= 0) return null;
  return n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

export default function TenantHome() {
  const page = trpc.public.getTenantPage.useQuery({ slug: HOME_PAGE_SLUG }, { retry: false });
  const slides = trpc.public.getSlideshowItems.useQuery(undefined, { retry: false });
  const featured = trpc.public.getFeaturedExperiences.useQuery(undefined, { retry: false });

  const hero = ((slides.data ?? []) as Slide[]).find((s) => s.imageUrl);
  const products = (featured.data ?? []) as Product[];

  return (
    <PublicLayout>
      {hero && (
        <section className="relative h-[60vh] min-h-[380px] overflow-hidden">
          <img src={hero.imageUrl} alt={hero.title ?? ""} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/30 to-black/60" />
          <div className="absolute inset-0 flex items-center">
            <div className="container text-white max-w-3xl space-y-4">
              {hero.badge && <span className="inline-block bg-primary text-primary-foreground text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full">{hero.badge}</span>}
              {hero.title && <h1 className="text-4xl md:text-6xl font-heading font-bold leading-tight">{hero.title}</h1>}
              {hero.subtitle && <p className="text-lg md:text-xl text-white/85">{hero.subtitle}</p>}
              {hero.ctaText && isSafeUrl(hero.ctaUrl) && (
                <Button asChild size="lg">
                  <a href={hero.ctaUrl}>{hero.ctaText}</a>
                </Button>
              )}
            </div>
          </div>
        </section>
      )}

      {page.data && (
        <article className="container py-12 max-w-3xl prose">
          {/* HTML saneado en servidor con lista blanca (server/_core/htmlSanitize.ts) */}
          <div dangerouslySetInnerHTML={{ __html: page.data.html }} />
        </article>
      )}

      {products.length > 0 && (
        <section className="container pb-16" aria-labelledby="destacados">
          <h2 id="destacados" className="text-2xl font-heading font-bold mb-6">
            Destacados
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {products.map((p) => (
              <Link key={p.id} href={`/experiencias/${p.slug}`} className="group block rounded-2xl border border-border/50 overflow-hidden bg-card shadow-sm hover:shadow-md transition-shadow">
                {p.image1 && <img src={p.image1} alt={p.title} className="w-full h-40 object-cover" loading="lazy" />}
                <div className="p-4 space-y-1">
                  <h3 className="font-heading font-semibold group-hover:text-primary">{p.title}</h3>
                  {p.shortDescription && <p className="text-sm text-muted-foreground line-clamp-2">{p.shortDescription}</p>}
                  {formatPrice(p.basePrice) && <p className="text-sm font-semibold">Desde {formatPrice(p.basePrice)}</p>}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </PublicLayout>
  );
}
