/**
 * Identidad corporativa por tenant en la web pública.
 *
 * - `TenantThemeLoader`: aplica colores/fuente/favicon del tenant como variables CSS.
 * - Con `neutralSite` (multiempresa) la web usa el shell neutro del tenant: marca, pie con
 *   sus datos y páginas propias; nunca los textos de otra empresa.
 * - En un solo tenant (producción actual) `neutralSite` es falso y nada cambia.
 */
import { useEffect } from "react";
import { useSiteLocale } from "@/hooks/useSiteLocale";
import type { ComponentType, ReactNode } from "react";
import { Link, Redirect, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { HOME_PAGE_SLUG, resolveHome } from "@/lib/homeRoute";
import PublicLayout from "@/components/PublicLayout";
import NotFound from "@/pages/NotFound";
import { brandTokens } from "@shared/loginBrand";
import { PANEL_PALETTE_KEYS, panelPalette, panelPaletteCss } from "@shared/panelTheme";
import { composePageTitle, publicRouteAccess } from "@shared/publicSite";
import { pageSlugOfUrl } from "@shared/tenantNav";
import { usePublicSite } from "@/hooks/usePublicSite";
import { PageBlocksView } from "@/components/site/PageBlocksView";
import { RICH_TEXT_CLASS } from "@/components/site/richText";

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
    // Multiempresa: identidad de la empresa en toda su experiencia (Big Elephant hasta que configure la suya), en modo
    // claro y oscuro. En línea sobre <html>, así manda sobre los valores de :root y .dark de index.css.
    const tokens = brandTokens(theme);
    const palette = panelPalette(theme);
    if (tokens) {
      // El color principal va en una hoja de estilos con un valor para el modo claro y otro para el oscuro (contraste
      // AA en los dos); el resto de la identidad, en línea como siempre.
      for (const [k, v] of Object.entries(tokens)) if (!palette || !PANEL_PALETTE_KEYS.includes(k)) root.style.setProperty(k, v);
      if (palette) {
        for (const k of PANEL_PALETTE_KEYS) root.style.removeProperty(k);
        let style = document.getElementById("tenant-panel-palette");
        if (!style) {
          style = document.createElement("style");
          style.id = "tenant-panel-palette";
          document.head.appendChild(style);
        }
        style.textContent = panelPaletteCss(palette);
      }
    } else if (theme.primaryColor) {
      root.style.setProperty("--primary", theme.primaryColor);
      root.style.setProperty("--ring", theme.primaryColor);
      const fg = contrast(theme.primaryColor);
      if (fg) root.style.setProperty("--primary-foreground", fg);
    }
    if (!tokens && theme.accentColor) root.style.setProperty("--brand-accent", theme.accentColor);
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
    // Título de la pestaña: «Página · Empresa» (usePageTitle) o solo la empresa
    if (theme.neutralSite && theme.brandName) document.title = composePageTitle(currentPageTitle, theme.brandName);
  }, [theme]);
  return null;
}

type Theme = NonNullable<ReturnType<typeof useTenantTheme>["theme"]>;

/** Página que se está mostrando (para componer el título cuando el tema llega después que la página). */
let currentPageTitle: string | null = null;

/**
 * Título de la pestaña de una página de la web de la empresa: «Quiénes somos · Empresa». Al salir vuelve a solo la
 * empresa. En la instalación de una sola empresa no cambia nada (sus títulos vienen del servidor).
 */
export function usePageTitle(title: string | null | undefined) {
  const { theme } = useTenantTheme();
  const neutral = !!theme?.neutralSite;
  const brand = theme?.brandName ?? null;
  useEffect(() => {
    if (!neutral) return;
    currentPageTitle = title?.trim() || null;
    const t = composePageTitle(currentPageTitle, brand);
    if (t) document.title = t;
    return () => {
      currentPageTitle = null;
      if (brand) document.title = brand;
    };
  }, [title, neutral, brand]);
}

/** Textos legales que toda web de empresa enlaza en su pie (sus páginas iniciales, editables). */
export const LEGAL_FOOTER_LINKS = [
  { label: "Aviso legal", url: "/aviso-legal" },
  { label: "Privacidad", url: "/privacidad" },
  { label: "Cookies", url: "/cookies" },
] as const;

export { RICH_TEXT_CLASS };

/** El contenido ya empieza por su propio título (h1): no se repite el de la página. */
export const startsWithHeading = (html: string) => /^\s*<h1[\s>]/i.test(html);

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

export function PoweredBy({ theme, className = "text-white/30 hover:text-white/60" }: { theme: Theme; className?: string }) {
  if (!theme.poweredBy) return null;
  return (
    <a
      href={theme.poweredBy.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`${className} text-[11px] transition-colors`}
    >
      {theme.poweredBy.label}
    </a>
  );
}

/** Estilos del pie (Studio › Cabecera y pie): oscuro (de serie), claro o con el color de la marca. */
const FOOTER_STYLE = {
  dark: { root: "bg-lago-dark text-white", soft: "text-white/70", softer: "text-white/60", faint: "text-white/40", hover: "hover:text-white", border: "border-white/10", powered: "text-white/30 hover:text-white/60" },
  light: { root: "bg-muted text-foreground", soft: "text-foreground/80", softer: "text-muted-foreground", faint: "text-muted-foreground", hover: "hover:text-foreground", border: "border-border", powered: "text-muted-foreground hover:text-foreground" },
  brand: { root: "bg-primary text-primary-foreground", soft: "text-primary-foreground/85", softer: "text-primary-foreground/75", faint: "text-primary-foreground/60", hover: "hover:text-primary-foreground", border: "border-primary-foreground/20", powered: "text-primary-foreground/50 hover:text-primary-foreground/80" },
} as const;

export function TenantFooter({ theme }: { theme: Theme }) {
  const c = theme.contact;
  const f = theme.footer ?? { style: "dark" as const, text: null, showContact: true };
  const st = FOOTER_STYLE[f.style] ?? FOOTER_STYLE.dark;
  const showContact = f.showContact && !!(c.phone || c.email);
  // El servidor ya quita los enlaces a páginas en borrador
  const footerLocale = useSiteLocale().prefix;
  const menu = trpc.public.getMenuItems.useQuery({ zone: "footer", ...(footerLocale ? { locale: footerLocale } : {}) }, { staleTime: 5 * 60_000, retry: false });
  const footerLinks = (menu.data ?? [])
    .filter((m) => m.isActive && !m.parentId && m.url)
    .sort((a, b) => a.sortOrder - b.sortOrder) as Array<{ id: number; label: string; url: string; target?: string | null }>;
  // Textos legales siempre en el pie (si la empresa ya los enlaza en su menú de pie, no se repiten)
  const own = new Set(footerLinks.map((l) => pageSlugOfUrl(l.url)).filter(Boolean));
  const legalLinks = LEGAL_FOOTER_LINKS.filter((l) => !own.has(pageSlugOfUrl(l.url)));
  return (
    <footer className={st.root}>
      <div className="container py-10 grid gap-6 md:grid-cols-3">
        <div>
          <p className="font-heading font-bold text-lg">{theme.brandName}</p>
          {f.showContact && c.address && <p className={`${st.softer} text-sm mt-2`}>{c.address}</p>}
          {f.text && <p className={`${st.softer} text-sm mt-2 max-w-sm`}>{f.text}</p>}
        </div>
        <div className={`text-sm ${st.soft} space-y-1`}>
          {showContact && c.phone && <p>{c.phone}</p>}
          {showContact && c.email && <p>{c.email}</p>}
        </div>
        <nav aria-label="Enlaces del pie" className={`text-sm ${st.softer} flex flex-col items-start gap-1`}>
          {footerLinks.map((l) =>
            /^https?:\/\//.test(l.url) ? (
              <a key={l.id} href={l.url} target={l.target ?? "_self"} rel="noopener noreferrer" className={st.hover}>
                {l.label}
              </a>
            ) : (
              <Link key={l.id} href={l.url}>
                <span className={`cursor-pointer ${st.hover}`}>{l.label}</span>
              </Link>
            ),
          )}
          {legalLinks.map((l) => (
            <Link key={l.url} href={l.url}>
              <span className={`cursor-pointer ${st.hover}`}>{l.label}</span>
            </Link>
          ))}
        </nav>
      </div>
      <div className={`border-t ${st.border}`}>
        <div className="container py-4 flex flex-col md:flex-row items-center justify-between gap-2">
          <p className={`${st.faint} text-xs`}>
            © {new Date().getFullYear()} {theme.brandName}
          </p>
          <PoweredBy theme={theme} className={st.powered} />
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

/** Descripción para buscadores de la página que se está viendo (la de la empresa, si la ha escrito). */
export function useMetaDescription(text: string | null | undefined) {
  useEffect(() => {
    const value = text?.trim();
    if (!value) return;
    let tag = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const created = !tag;
    if (!tag) {
      tag = document.createElement("meta");
      tag.name = "description";
      document.head.appendChild(tag);
    }
    const prev = tag.content;
    tag.content = value;
    return () => {
      if (created) tag?.remove();
      else if (tag) tag.content = prev;
    };
  }, [text]);
}

export function TenantPage({ slug, locale }: { slug: string; locale?: string }) {
  const q = trpc.public.getTenantPage.useQuery({ slug, ...(locale ? { locale } : {}) }, { retry: false });
  const redirectTo = q.data && "redirectTo" in q.data ? q.data.redirectTo : undefined;
  const data = q.data && !redirectTo ? q.data : null;
  const i18n = data && "i18n" in data ? data.i18n : null;
  usePageTitle(slug === HOME_PAGE_SLUG ? null : data?.metaTitle || data?.title);
  useMetaDescription(data?.metaDescription);
  // Idioma del documento (accesibilidad y buscadores); sin multidioma no se toca
  useEffect(() => {
    if (!i18n) return;
    const prev = document.documentElement.lang;
    document.documentElement.lang = i18n.htmlLang;
    return () => {
      document.documentElement.lang = prev;
    };
  }, [i18n]);
  if (q.isLoading) {
    return (
      <PublicLayout>
        <Spinner />
      </PublicLayout>
    );
  }
  if (redirectTo) return <Redirect href={redirectTo} replace />;
  if (!data) return <NotFound />;
  // Página hecha con el constructor: sus bloques (el mismo componente que la vista previa del panel)
  if (data.blocks) {
    return (
      <PublicLayout>
        {i18n?.fallback && (
          <p role="note" lang="es" className="container py-2 text-sm text-muted-foreground">
            Esta página todavía no está traducida a este idioma. Se muestra la versión original.
          </p>
        )}
        <PageBlocksView blocks={data.blocks} pageTitle={data.title} />
      </PublicLayout>
    );
  }
  return (
    <PublicLayout>
      <article className={`container py-10 md:py-14 max-w-3xl ${RICH_TEXT_CLASS}`}>
        {!startsWithHeading(data.html) && <h1>{data.title}</h1>}
        {/* HTML saneado en servidor con lista blanca (server/_core/htmlSanitize.ts) */}
        <div dangerouslySetInnerHTML={{ __html: data.html }} />
      </article>
    </PublicLayout>
  );
}

/**
 * "/" : en multiempresa, la página «inicio» del tenant; si aún no la ha publicado (toda empresa recién dada de
 * alta), su inicio de sesión en lugar de un 404. Sin web neutra, la home actual. Lógica en lib/homeRoute.ts. Con `Tenant`,
 * la portada genérica de la empresa (su carrusel, su texto y sus destacados).
 */
export function HomeGate({ Fallback, Tenant }: { Fallback: ComponentType; Tenant?: ComponentType }) {
  const { theme, isLoading } = useTenantTheme();
  const neutralSite = !!theme?.neutralSite;
  const page = trpc.public.getTenantPage.useQuery({ slug: HOME_PAGE_SLUG }, { retry: false, enabled: neutralSite });
  const view = resolveHome({ themeLoading: isLoading, neutralSite, pageLoading: neutralSite && page.isLoading, hasPage: !!page.data });
  if (view.kind === "loading") return <Spinner />;
  if (view.kind === "redirect") return <Redirect to={view.to} replace />;
  if (view.kind === "page") return Tenant ? <Tenant /> : <TenantPage slug={HOME_PAGE_SLUG} />;
  return <Fallback />;
}

/**
 * Páginas propias de la instalación original (textos legales y de marketing escritos a mano). En la web neutra de cada
 * empresa NUNCA se sirven: se muestra la página equivalente de la propia empresa (su CMS, `slug`) o «no encontrada».
 * Así ninguna empresa publica el aviso legal, la privacidad o las condiciones de otra. Con `Tenant`, la versión
 * genérica de la funcionalidad, alimentada solo con los datos de la propia empresa.
 */
export function SingleOnlyPage({ Single, slug, Tenant }: { Single: ComponentType; slug: string; Tenant?: ComponentType }) {
  const { theme, isLoading } = useTenantTheme();
  if (isLoading) return <Spinner />;
  if (theme?.neutralSite) return Tenant ? <Tenant /> : <TenantPage slug={slug} />;
  return <Single />;
}

/**
 * Sección de la web con una versión genérica (p. ej. «/contacto» y su formulario): si la empresa ha publicado su propia
 * página con esa dirección (hecha con el constructor), se muestra la suya; si no, la genérica.
 */
export function PageOrDefault({ slug, Default }: { slug: string; Default: ComponentType }) {
  const { theme, isLoading } = useTenantTheme();
  const neutral = !!theme?.neutralSite;
  const page = trpc.public.getTenantPage.useQuery({ slug }, { retry: false, enabled: neutral });
  if (isLoading || (neutral && page.isLoading)) return <Spinner />;
  if (neutral && page.data) return <TenantPage slug={slug} />;
  return <Default />;
}

/** "/:slug" tras todas las rutas conocidas: páginas del tenant; en single, 404 como siempre. */
export function SlugGate({ slug }: { slug: string }) {
  const { theme, isLoading } = useTenantTheme();
  const site = useSiteLocale();
  if (isLoading || (theme?.neutralSite && site.isLoading)) return <Spinner />;
  // «/de»: portada del idioma (solo un idioma adicional validado de la empresa; si no, es una página más, como siempre)
  if (theme?.neutralSite && site.multilingual && slug !== site.defaultLocale && site.locales.includes(slug)) return <TenantPage slug={HOME_PAGE_SLUG} locale={slug} />;
  if (theme?.neutralSite) return <TenantPage slug={slug} />;
  return <NotFound />;
}

/** "/:locale/:slug": página de un idioma adicional (E-1). Sin ese idioma validado, «no encontrada» como siempre. */
export function LocaleSlugGate({ locale, slug }: { locale: string; slug: string }) {
  const { theme, isLoading } = useTenantTheme();
  const site = useSiteLocale();
  if (isLoading || site.isLoading) return <Spinner />;
  if (theme?.neutralSite && site.multilingual && locale !== site.defaultLocale && site.locales.includes(locale)) return <TenantPage slug={slug} locale={locale} />;
  return <NotFound />;
}

/**
 * Secciones públicas que dependen de lo contratado (tienda, presupuesto, cupones, Lego Packs): sin ellas, «no
 * encontrada» o la sección equivalente (shared/publicSite.ts). En la instalación de una sola empresa, como siempre.
 */
export function SiteRouteGate({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { isLoading } = useTenantTheme();
  const { features, isLoading: siteLoading } = usePublicSite();
  if (isLoading || siteLoading) return <Spinner />;
  // Sin respuesta, se muestra la página: el servidor sigue comprobando cada operación. En la instalación propia,
  // todo existe (y /tienda lleva a su catálogo de siempre).
  if (!features) return <>{children}</>;
  const access = publicRouteAccess(location, features);
  if (access.kind === "notFound") return <NotFound />;
  if (access.kind === "redirect") return <Redirect to={access.to} replace />;
  return <>{children}</>;
}
