/**
 * /blog — listado paginado de las entradas PUBLICADAS de la empresa (capacidad `cms-blog`).
 * Parámetros: ?pagina=N y ?categoria=Nombre. Sin la capacidad contratada no se sirve.
 */
import { Link, useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import PublicLayout from "@/components/PublicLayout";
import NotFound from "@/pages/NotFound";
import { TenantPage, useTenantTheme } from "@/components/TenantTheme";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

export function formatPostDate(ms: number | null | undefined): string {
  if (!ms) return "";
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", year: "numeric" }).format(new Date(ms));
}

function blogHref(page: number, category: string | null) {
  const qs = new URLSearchParams();
  if (category) qs.set("categoria", category);
  if (page > 1) qs.set("pagina", String(page));
  const s = qs.toString();
  return s ? `/blog?${s}` : "/blog";
}

export default function Blog() {
  const params = new URLSearchParams(useSearch());
  const page = Math.max(1, Number.parseInt(params.get("pagina") ?? "1", 10) || 1);
  const category = params.get("categoria")?.trim() || null;
  const { theme } = useTenantTheme();
  const q = trpc.blog.publicList.useQuery({ page, category }, { retry: false });
  const brand = theme?.brandName ?? "";

  useDocumentMeta({
    title: brand ? `Blog | ${brand}` : "Blog",
    description: brand ? `Noticias y artículos de ${brand}.` : "Noticias y artículos.",
    canonical: `${window.location.origin}${blogHref(page, category)}`,
  });

  if (q.error) {
    // Sin el blog contratado: lo de siempre en esa ruta (página propia «blog» de la empresa o 404)
    if (q.error.data?.code === "FORBIDDEN" && theme?.neutralSite) return <TenantPage slug="blog" />;
    if (q.error.data?.code === "FORBIDDEN") return <NotFound />;
  }

  const d = q.data;
  return (
    <PublicLayout>
      <div className="container py-12 md:py-16">
        <header className="max-w-3xl mb-10">
          <h1 className="text-3xl md:text-4xl font-heading font-bold text-foreground">Blog</h1>
          <p className="mt-3 text-muted-foreground">
            {category ? <>Entradas de la categoría «{category}».</> : <>Noticias y artículos{brand ? ` de ${brand}` : ""}.</>}
          </p>
        </header>

        {d && d.categories.length > 0 && (
          <nav aria-label="Categorías del blog" className="mb-8">
            <ul className="flex flex-wrap gap-2">
              <li>
                <Link
                  href="/blog"
                  aria-current={!category ? "page" : undefined}
                  className={`inline-block rounded-full border px-4 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${!category ? "bg-primary text-primary-foreground border-primary" : "border-border text-foreground hover:bg-muted"}`}
                >
                  Todas
                </Link>
              </li>
              {d.categories.map((c) => (
                <li key={c}>
                  <Link
                    href={blogHref(1, c)}
                    aria-current={category === c ? "page" : undefined}
                    className={`inline-block rounded-full border px-4 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${category === c ? "bg-primary text-primary-foreground border-primary" : "border-border text-foreground hover:bg-muted"}`}
                  >
                    {c}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {q.isLoading ? (
          <div role="status" className="py-16 text-center text-muted-foreground">Cargando entradas…</div>
        ) : q.error ? (
          <div role="alert" className="py-16 text-center text-muted-foreground">No se pudieron cargar las entradas. Inténtalo de nuevo más tarde.</div>
        ) : !d || d.items.length === 0 ? (
          <div className="py-16 text-center border border-dashed border-border rounded-2xl">
            <p className="text-lg font-medium text-foreground">Aún no hay entradas publicadas.</p>
            {category && (
              <p className="mt-2 text-sm">
                <Link href="/blog" className="text-primary underline underline-offset-4">Ver todas las entradas</Link>
              </p>
            )}
          </div>
        ) : (
          <>
            <ul className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {d.items.map((p) => (
                <li key={p.slug}>
                  <article className="group h-full flex flex-col rounded-2xl border border-border bg-card overflow-hidden shadow-sm focus-within:ring-2 focus-within:ring-ring">
                    {p.featuredImageUrl && (
                      <img src={p.featuredImageUrl} alt={p.featuredImageAlt ?? ""} loading="lazy" className="w-full aspect-[16/9] object-cover" />
                    )}
                    <div className="flex flex-col flex-1 p-5">
                      {p.category && <p className="text-xs font-semibold uppercase tracking-wide text-primary">{p.category}</p>}
                      <h2 className="mt-1 text-xl font-heading font-bold text-foreground">
                        <Link href={`/blog/${p.slug}`} className="hover:underline underline-offset-4 focus-visible:outline-none">
                          {p.title}
                        </Link>
                      </h2>
                      {p.excerpt && <p className="mt-2 text-sm text-muted-foreground line-clamp-3">{p.excerpt}</p>}
                      <p className="mt-auto pt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CalendarDays size={14} aria-hidden="true" />
                        <time dateTime={p.publishedAt ? new Date(p.publishedAt).toISOString() : undefined}>{formatPostDate(p.publishedAt)}</time>
                        {p.authorName && <span>· {p.authorName}</span>}
                      </p>
                    </div>
                  </article>
                </li>
              ))}
            </ul>

            {d.pages > 1 && (
              <nav aria-label="Paginación del blog" className="mt-12 flex items-center justify-center gap-2">
                {d.page > 1 ? (
                  <Link href={blogHref(d.page - 1, category)} className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <ChevronLeft size={16} aria-hidden="true" />Anteriores
                  </Link>
                ) : null}
                <span className="px-3 py-2 text-sm text-muted-foreground" aria-current="page">
                  Página {d.page} de {d.pages}
                </span>
                {d.page < d.pages ? (
                  <Link href={blogHref(d.page + 1, category)} className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    Siguientes<ChevronRight size={16} aria-hidden="true" />
                  </Link>
                ) : null}
              </nav>
            )}
          </>
        )}
      </div>
    </PublicLayout>
  );
}
