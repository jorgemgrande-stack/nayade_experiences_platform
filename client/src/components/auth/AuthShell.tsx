/**
 * Armazón común de las pantallas de acceso (iniciar sesión, recuperar y restablecer contraseña): panel de marca a la
 * izquierda y formulario a la derecha, con la identidad de la empresa que sirve el dominio (`shared/loginBrand.ts`).
 *
 * Usa consultas de CONTENEDOR (no de pantalla): la misma pieza se ve igual en la página real y en la vista previa
 * del administrador a tamaño de escritorio o de móvil. Los colores llegan ya saneados y comprobados (hex); las
 * imágenes van en <img>, nunca en CSS.
 */
import type { CSSProperties, ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { loginLook, type LoginLook, type LoginThemeInput } from "@shared/loginBrand";

/** Aspecto del acceso para el dominio actual. Mientras carga, `look` es null (no se muestra otra marca). */
export function useLoginLook(): { look: LoginLook | null; isLoading: boolean } {
  const q = trpc.public.getTheme.useQuery(undefined, { staleTime: 5 * 60_000, retry: 1, refetchOnWindowFocus: false });
  if (q.isLoading) return { look: null, isLoading: true };
  // Sin tema (error de red): marca neutra, sin datos de nadie
  return { look: loginLook((q.data ?? { neutralSite: true, brandName: null, logoUrl: null }) as LoginThemeInput), isLoading: false };
}

/** Variables CSS del formulario (foco y enlaces) a partir del aspecto. */
export const authVars = (look: LoginLook) => ({ "--auth-link": look.link, "--auth-button": look.button, "--auth-button-fg": look.buttonFg }) as CSSProperties;

/** Pantalla de carga neutra (sin la marca de nadie) mientras llega la de la empresa. */
export function AuthLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white" role="status" aria-live="polite">
      <span className="h-8 w-8 rounded-full border-2 border-slate-200 border-t-slate-500 animate-spin" aria-hidden="true" />
      <span className="sr-only">Cargando…</span>
    </div>
  );
}

export function AuthBrandLogo({ look, onPanel }: { look: LoginLook; onPanel: boolean }) {
  const { brand } = look;
  if (brand.logoUrl) {
    return (
      <span className={onPanel ? "inline-flex max-w-[260px] rounded-xl bg-white/95 px-3 py-2 shadow-sm" : "inline-flex max-w-[220px]"}>
        <img src={brand.logoUrl} alt={brand.logoAlt || brand.fullName || "Logotipo"} className="h-10 w-auto max-w-full object-contain" />
      </span>
    );
  }
  if (!brand.name) return null;
  return (
    <span className="inline-flex items-center gap-3">
      <span
        className="flex h-10 w-10 items-center justify-center rounded-xl text-lg font-bold"
        style={onPanel ? { background: "rgba(255,255,255,0.16)", color: look.panelFg } : { background: look.button, color: look.buttonFg }}
        aria-hidden="true"
      >
        {brand.initial}
      </span>
      <span className="text-lg font-bold leading-tight" style={{ color: onPanel ? look.panelFg : "#171d28" }}>
        {brand.name}
      </span>
    </span>
  );
}

function Title({ look, title, highlight }: { look: LoginLook; title: string; highlight: string }) {
  const i = highlight ? title.lastIndexOf(highlight) : -1;
  if (i < 0) return <>{title}</>;
  return (
    <>
      {title.slice(0, i)}
      <span style={{ color: look.highlight }}>{highlight}</span>
      {title.slice(i + highlight.length)}
    </>
  );
}

export function AuthShell({
  look,
  title,
  titleHighlight,
  message,
  preview = false,
  children,
}: {
  look: LoginLook;
  /** Titular del panel (por defecto, el de la marca). */
  title?: string;
  titleHighlight?: string;
  message?: string;
  /** Vista previa: alto del marco en lugar de la pantalla. */
  preview?: boolean;
  children: ReactNode;
}) {
  const t = title ?? look.title;
  const h = title ? (titleHighlight ?? "") : look.titleHighlight;
  const m = message ?? look.message;
  return (
    <div className={`@container ${preview ? "h-full" : "min-h-screen"} bg-white`} style={authVars(look)}>
      <div className={`flex flex-col @4xl:flex-row ${preview ? "h-full" : "min-h-screen"}`}>
        {/* Panel de marca */}
        <section
          className="relative overflow-hidden flex flex-col justify-between gap-8 px-6 py-8 @4xl:w-1/2 @4xl:p-12"
          style={{ background: look.panelBg, color: look.panelFg }}
          aria-label={look.brand.fullName ? `Marca de ${look.brand.fullName}` : "Marca"}
        >
          {look.backgroundUrl && (
            <>
              <img src={look.backgroundUrl} alt="" className="absolute inset-0 h-full w-full object-cover" aria-hidden="true" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/55 to-black/40" aria-hidden="true" />
            </>
          )}
          <div className="relative">
            <AuthBrandLogo look={look} onPanel />
          </div>
          <div className="relative hidden @4xl:block max-w-lg">
            <h1 className="text-4xl font-bold leading-tight tracking-tight mb-4" style={{ color: look.panelFg }}>
              <Title look={look} title={t} highlight={h} />
            </h1>
            <p className="text-lg leading-relaxed" style={{ color: look.panelMuted }}>{m}</p>
          </div>
          <div className="relative hidden @4xl:flex items-end justify-between gap-4 text-sm" style={{ color: look.panelMuted }}>
            <span>{look.brand.location}</span>
            {look.poweredBy && <span className="text-xs opacity-80">{look.poweredBy.label}</span>}
          </div>
        </section>

        {/* Formulario */}
        <main className="flex flex-1 items-center justify-center px-6 py-10 @4xl:w-1/2 @4xl:p-12">
          <div className="w-full max-w-md">
            {children}
            {look.poweredBy && <p className="mt-10 text-center text-xs text-slate-500 @4xl:hidden">{look.poweredBy.label}</p>}
          </div>
        </main>
      </div>
    </div>
  );
}

/** Clases de los campos del formulario (claro, con foco del color de enlace de la marca). */
export const authInputClass =
  "h-12 bg-slate-50 border-slate-300 text-slate-900 placeholder:text-slate-400 focus-visible:border-[var(--auth-link)] focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_srgb,var(--auth-link)_25%,transparent)] aria-[invalid=true]:border-red-600";

export const authLinkClass =
  "text-sm font-medium text-[var(--auth-link)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--auth-link)] rounded";

export function AuthSubmit({ loading, loadingLabel, children, disabled }: { loading: boolean; loadingLabel: string; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      aria-busy={loading}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[var(--auth-button)] text-base font-semibold text-[var(--auth-button-fg)] transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-offset-2 focus-visible:ring-[var(--auth-button)]"
    >
      {loading ? (
        <>
          <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden="true" />
          {loadingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function AuthAlert({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <div id={id} role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <span aria-hidden="true" className="mt-0.5 font-bold">!</span>
      <span>{children}</span>
    </div>
  );
}
