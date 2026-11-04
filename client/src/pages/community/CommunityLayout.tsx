/**
 * Área de miembros de las comunidades (/comunidad): con la cuenta del Core de cada persona (cuenta de cliente o
 * usuario del panel). Sin sesión, al inicio de sesión normal con vuelta aquí. Identidad de la empresa que sirve el
 * dominio (como el portal del empleado); nunca la de otra empresa.
 */
import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Loader2, LogOut, Users } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePortalLook } from "../employee/usePortalLook";

export default function CommunityLayout({ children, accent }: { children: React.ReactNode; accent?: string | null }) {
  const { user, loading, logout } = useAuth();
  const [location, navigate] = useLocation();
  const look = usePortalLook();

  useEffect(() => {
    if (!loading && !user) navigate(`/login?returnTo=${encodeURIComponent(location)}`);
  }, [user, loading, navigate, location]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-slate-500" aria-label="Cargando" />
      </div>
    );
  }

  const style = accent ? { ...look.style, ["--portal-accent" as string]: accent } : look.style;
  const name = (user as { name?: string | null; email?: string | null }).name || (user as { email?: string | null }).email || "";

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-50 text-slate-900" style={style}>
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="h-1 bg-[var(--portal-accent)]" aria-hidden="true" />
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-3 px-4">
          <Link href="/comunidad" className="flex min-w-0 items-center gap-2.5">
            {look.logoUrl ? (
              <img src={look.logoUrl} alt={look.name || "Inicio"} className="h-8 w-auto max-w-[160px] object-contain" />
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--portal-accent)] text-[var(--portal-accent-fg)]" aria-hidden="true">
                <Users className="h-4 w-4" />
              </span>
            )}
            <span className="text-sm font-semibold text-slate-900">Comunidades</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-slate-500 sm:inline">{name}</span>
            <button type="button" onClick={() => logout().then(() => navigate("/login"))} className="p-1.5 text-slate-500 transition-colors hover:text-slate-900" title="Cerrar sesión" aria-label="Cerrar sesión">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
    </div>
  );
}

/** Mensaje claro cuando la empresa no tiene la extensión o la persona no tiene acceso. */
export function CommunityNotice({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
      <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
      <p className="mt-1 text-sm text-slate-600">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** ¿El error es la licencia de la empresa (extensión no contratada)? */
export function isUnlicensed(err: unknown): boolean {
  const d = (err as { data?: { capability?: string; code?: string } } | null)?.data;
  return d?.capability === "social-token-net" || (d?.code === "FORBIDDEN" && /no están incluidas en tu plan/.test(String((err as { message?: string }).message ?? "")));
}
