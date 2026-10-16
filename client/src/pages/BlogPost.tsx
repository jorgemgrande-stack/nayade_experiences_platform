/**
 * /blog/:slug — entrada PUBLICADA del blog de la empresa. Un borrador o una entrada programada no se
 * sirve (el servidor devuelve null → 404).
 */
import { Link, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import PublicLayout from "@/components/PublicLayout";
import NotFound from "@/pages/NotFound";
import { useTenantTheme } from "@/components/TenantTheme";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { formatPostDate } from "./Blog";
import { ArrowLeft } from "lucide-react";

export default function BlogPost() {
  const { slug = "" } = useParams<{ slug: string }>();
  const valid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
  const { theme } = useTenantTheme();
  const q = trpc.blog.publicGet.useQuery({ slug }, { enabled: valid, retry: false });
  const post = q.data;
  const brand = theme?.brandName ?? "";

  useDocumentMeta(
    post
      ? {
          title: `${post.metaTitle || post.title}${brand ? ` | ${brand}` : ""}`,
          description: post.metaDescription || post.excerpt || post.title,
          image: post.featuredImageUrl && /^https?:\/\//i.test(post.featuredImageUrl) ? post.featuredImageUrl : null,
        }
      : null,
  );

  if (!valid) return <NotFound />;
  if (q.isLoading) {
    return (
      <PublicLayout>
        <div role="status" className="min-h-[60vh] flex items-center justify-center text-muted-foreground">Cargando entrada…</div>
      </PublicLayout>
    );
  }
  if (q.error && q.error.data?.code !== "FORBIDDEN") {
    return (
      <PublicLayout>
        <div role="alert" className="container py-16 text-center text-muted-foreground">No se pudo cargar la entrada. Inténtalo de nuevo más tarde.</div>
      </PublicLayout>
    );
  }
  if (!post) return <NotFound />;

  return (
    <PublicLayout>
      <article className="container py-12 md:py-16 max-w-3xl">
        <p className="mb-6">
          <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
            <ArrowLeft size={16} aria-hidden="true" />Volver al blog
          </Link>
        </p>
        <header className="mb-8">
          {post.category && (
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              <Link href={`/blog?categoria=${encodeURIComponent(post.category)}`} className="hover:underline underline-offset-4">{post.category}</Link>
            </p>
          )}
          <h1 className="mt-2 text-3xl md:text-4xl font-heading font-bold text-foreground">{post.title}</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            <time dateTime={post.publishedAt ? new Date(post.publishedAt).toISOString() : undefined}>{formatPostDate(post.publishedAt)}</time>
            {post.authorName && <span> · {post.authorName}</span>}
          </p>
          {post.excerpt && <p className="mt-4 text-lg text-muted-foreground">{post.excerpt}</p>}
        </header>
        {post.featuredImageUrl && (
          <img src={post.featuredImageUrl} alt={post.featuredImageAlt ?? ""} className="w-full rounded-2xl object-cover aspect-[16/9] mb-8" />
        )}
        {/* HTML saneado en servidor con lista blanca (server/_core/htmlSanitize.ts) */}
        <div className="prose max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: post.html }} />
      </article>
    </PublicLayout>
  );
}
