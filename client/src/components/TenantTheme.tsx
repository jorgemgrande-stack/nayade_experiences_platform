/**
 * Identidad corporativa por tenant en la web pública.
 *
 * - `TenantThemeLoader`: aplica colores/fuente/favicon del tenant como variables CSS.
 * - Con `neutralSite` (multiempresa) la web usa el shell neutro del tenant: marca, pie con
 *   sus datos y páginas propias; nunca los textos de otra empresa.
 * - En un solo tenant (producción actual) `neutralSite` es falso y nada cambia.
 */
import { useEffect } from "react";
import type { ComponentType } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import PublicLayout from "@/components/PublicLayout";
import NotFound from "@/pages/NotFound";

export function useTenantTheme() {
  const q = trpc.public.getTheme.useQuery(undefined, { staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false });
  return { theme: q.data ?? null, isLoading: q.isLoading };
}

function contrast(hex: string): string | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.5 ? "#111111" : "#ffffff";
}

export function TenantThemeLoader() {
  const { theme } = useTenantTheme();
  useEffect(() => {
    if (!theme) return;
    const root = document.documentElement;
    if (theme.primaryColor) {
      root.style.setProperty("--primary", theme.primaryColor);
      root.style.setProperty("--ring", theme.primaryColor);
      const fg = contrast(theme.primaryColor);
      if (fg) root.style.setProperty("--primary-foreground", fg);
    }
    if (theme.accentColor) root.style.setProperty("--brand-accent", theme.accentColor);
    if (theme.radius) root.style.setProperty("--radius", theme.radius);
    if (theme.fontFamily) document.body.style.fontFamily = theme.fontFamily;
    if (theme.faviconUrl) {
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = theme.faviconUrl;
    }
    if (theme.neutralSite && theme.brandName) document.title = theme.brandName;
  }, [theme]);
  return null;
}

type Theme = NonNullable<ReturnType<typeof useTenantTheme>["theme"]>;

export function TenantBrand({ theme }: { theme: Theme }) {
  return (
    <>
      {theme.logoUrl && <img src={theme.logoUrl} alt={theme.brandName ?? ""} className="h-14 w-auto object-contain" />}
      {(!theme.logoUrl || theme.brandName) && (
        <span className="font-heading font-bold text-lg leading-none text-primary">{theme.brandName}</span>
      )}
    </>
  );
}

export function PoweredBy({ theme }: { theme: Theme }) {
  if (!theme.poweredBy) return null;
  return (
    <a
      href={theme.poweredBy.url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-white/30 hover:text-white/60 text-[11px] transition-colors"
    >
      {theme.poweredBy.label}
    </a>
  );
}

export function TenantFooter({ theme }: { theme: Theme }) {
  const c = theme.contact;
  return (
    <footer className="bg-lago-dark text-white">
      <div className="container py-10 grid gap-6 md:grid-cols-3">
        <div>
          <p className="font-heading font-bold text-lg">{theme.brandName}</p>
          {c.address && <p className="text-white/60 text-sm mt-2">{c.address}</p>}
        </div>
        <div className="text-sm text-white/70 space-y-1">
          {c.phone && <p>{c.phone}</p>}
          {c.email && <p>{c.email}</p>}
        </div>
        <div className="text-sm text-white/60 space-y-1">
          <Link href="/aviso-legal">
            <span className="cursor-pointer hover:text-white">Aviso legal</span>
          </Link>
          <br />
          <Link href="/politica-de-privacidad">
            <span className="cursor-pointer hover:text-white">Privacidad</span>
          </Link>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="container py-4 flex flex-col md:flex-row items-center justify-between gap-2">
          <p className="text-white/40 text-xs">
            © {new Date().getFullYear()} {theme.brandName}
          </p>
          <PoweredBy theme={theme} />
        </div>
      </div>
    </footer>
  );
}

function Spinner() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export function TenantPage({ slug }: { slug: string }) {
  const q = trpc.public.getTenantPage.useQuery({ slug }, { retry: false });
  if (q.isLoading) {
    return (
      <PublicLayout>
        <Spinner />
      </PublicLayout>
    );
  }
  if (!q.data) return <NotFound />;
  return (
    <PublicLayout>
      <article className="container py-12 max-w-3xl prose">
        {/* HTML saneado en servidor con lista blanca (server/_core/htmlSanitize.ts) */}
        <div dangerouslySetInnerHTML={{ __html: q.data.html }} />
      </article>
    </PublicLayout>
  );
}

/** "/" : en multiempresa, la página «inicio» del tenant; si no, la home actual. */
export function HomeGate({ Fallback }: { Fallback: ComponentType }) {
  const { theme, isLoading } = useTenantTheme();
  if (isLoading) return <Spinner />;
  if (theme?.neutralSite) return <TenantPage slug="inicio" />;
  return <Fallback />;
}

/** "/:slug" tras todas las rutas conocidas: páginas del tenant; en single, 404 como siempre. */
export function SlugGate({ slug }: { slug: string }) {
  const { theme, isLoading } = useTenantTheme();
  if (isLoading) return <Spinner />;
  if (theme?.neutralSite) return <TenantPage slug={slug} />;
  return <NotFound />;
}
