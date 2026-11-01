/**
 * EmployeeLayout — Layout del Portal del Empleado (Fase 3 RRHH).
 *
 * Clonado del patrón PartnerLayout. Guard de rol exclusivo:
 *   - 'employee' (rol nuevo creado en Fase 3)
 *   - 'monitor'  (rol legacy — compatibilidad con accesos previos)
 *
 * Cualquier otro rol es redirigido a /admin. Si no hay sesión, a /login.
 *
 * Identidad: nombre, logotipo, teléfono y color de la empresa que sirve el dominio (`usePortalLook`), sobre fondo
 * claro. Sin marca configurada, aspecto neutro; nunca la de otra empresa.
 */
import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  LayoutDashboard, User, FileText, LogOut, Loader2, Phone, Clock, Banknote, CalendarOff,
} from "lucide-react";
import { usePortalLook } from "./usePortalLook";

export default function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate("/login?returnTo=" + encodeURIComponent(location)); return; }
    const role = (user as any).role as string;
    if (!["employee", "monitor"].includes(role)) navigate("/admin");
  }, [user, loading, navigate, location]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
      </div>
    );
  }

  const role = (user as any).role as string;
  if (!["employee", "monitor"].includes(role)) return null;

  return <EmployeeLayoutInner user={user} location={location} navigate={navigate} logout={logout}>{children}</EmployeeLayoutInner>;
}

function EmployeeLayoutInner({ user, location, navigate, logout, children }: {
  user: any; location: string; navigate: any; logout: any; children: React.ReactNode;
}) {
  const look = usePortalLook();
  const { data: me, error: meError } = trpc.hr.portal.me.useQuery(undefined, { retry: false });
  // Sin la extensión Personal activa (o con el usuario sin ficha): aviso claro en lugar de pantallas con errores
  const meErrorData = meError?.data as { code?: string; capability?: string } | undefined;
  const portalUnavailable = meErrorData?.capability === "people-hr";
  const notLinked = !portalUnavailable && meErrorData?.code === "FORBIDDEN";

  const employeeName = me?.fullName ?? (user as any).name ?? (user as any).email ?? "Empleado";

  // Los diálogos se pintan fuera de este bloque: el color de la empresa también en <html> mientras el portal esté abierto
  useEffect(() => {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(look.vars)) root.style.setProperty(k, v);
    return () => { for (const k of Object.keys(look.vars)) root.style.removeProperty(k); };
  }, [look.accent, look.accentFg]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 overflow-x-hidden" style={look.style}>
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/95 border-b border-slate-200 backdrop-blur-md">
        {look.branded && <div className="h-1 bg-[var(--portal-accent)]" aria-hidden="true" />}
        <div className="max-w-5xl mx-auto px-4">
          {/* Fila superior: marca + empleado + acciones */}
          <div className="flex items-center justify-between gap-3 h-14">
            <Link href="/empleado" className="flex items-center gap-2.5 min-w-0">
              {look.logoUrl ? (
                <img src={look.logoUrl} alt={look.name || "Inicio"} className="h-8 w-auto max-w-[160px] object-contain" />
              ) : look.initial ? (
                <span className="w-8 h-8 shrink-0 rounded-lg bg-[var(--portal-accent)] text-[var(--portal-accent-fg)] flex items-center justify-center text-sm font-bold" aria-hidden="true">
                  {look.initial}
                </span>
              ) : null}
              {(!look.logoUrl && look.name) && <span className="font-semibold text-slate-900 text-sm truncate">{look.name}</span>}
              {(!look.logoUrl && !look.name) && <span className="font-semibold text-slate-900 text-sm">Portal del empleado</span>}
            </Link>

            <div className="hidden sm:flex flex-col items-center min-w-0">
              <span className="text-xs font-bold text-[var(--portal-accent)] uppercase tracking-wider">Portal del empleado</span>
              <span className="text-[11px] text-slate-500 truncate max-w-[220px]">{employeeName}</span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {look.phoneTel && (
                <a href={look.phoneTel}
                  className="hidden sm:flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 transition-colors border border-slate-200 hover:border-slate-300 rounded-lg px-2.5 py-1.5"
                  title={look.name ? `Llamar a ${look.name}` : "Llamar"}
                >
                  <Phone className="w-3.5 h-3.5" />
                  {look.phone}
                </a>
              )}
              <button
                onClick={() => logout().then(() => navigate("/login"))}
                className="text-slate-500 hover:text-slate-900 transition-colors p-1.5"
                title="Cerrar sesión"
                aria-label="Cerrar sesión"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Barra de nav */}
          <nav className="flex items-center gap-1 pb-0 -mb-px overflow-x-auto">
            <NavTab href="/empleado" active={location === "/empleado"} icon={<LayoutDashboard className="w-3.5 h-3.5" />}>
              Inicio
            </NavTab>
            <NavTab href="/empleado/fichar" active={location.startsWith("/empleado/fichar")} icon={<Clock className="w-3.5 h-3.5" />}>
              Fichar
            </NavTab>
            <NavTab href="/empleado/perfil" active={location.startsWith("/empleado/perfil")} icon={<User className="w-3.5 h-3.5" />}>
              Mi perfil
            </NavTab>
            <NavTab href="/empleado/nominas" active={location.startsWith("/empleado/nominas")} icon={<Banknote className="w-3.5 h-3.5" />}>
              Mis nóminas
            </NavTab>
            <NavTab href="/empleado/vacaciones" active={location.startsWith("/empleado/vacaciones")} icon={<CalendarOff className="w-3.5 h-3.5" />}>
              Vacaciones
            </NavTab>
            <NavTab href="/empleado/documentos" active={location.startsWith("/empleado/documentos")} icon={<FileText className="w-3.5 h-3.5" />}>
              Mis documentos
            </NavTab>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {portalUnavailable ? (
          <PortalNotice title="El portal del empleado no está disponible">
            Tu empresa no tiene activo el portal en este momento. Tus datos se conservan; si lo necesitas, consúltalo con la persona responsable de personal.
          </PortalNotice>
        ) : notLinked ? (
          <PortalNotice title="Tu acceso aún no está vinculado">
            Tu usuario no está asociado a ninguna ficha de empleado. Pide a tu empresa que revise tu acceso al portal.
          </PortalNotice>
        ) : (
          children
        )}
      </main>

      <footer className="border-t border-slate-200 py-4 mt-8">
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-slate-500">
          <span>Portal del empleado{look.name && ` · ${look.name}`}</span>
          {look.phoneTel && (
            <a href={look.phoneTel} className="hover:text-slate-900 transition-colors flex items-center gap-1">
              <Phone className="w-3 h-3" /> {look.phone}
            </a>
          )}
        </div>
      </footer>
    </div>
  );
}

function PortalNotice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div role="status" className="max-w-lg mx-auto text-center rounded-xl border border-slate-200 bg-white px-6 py-10">
      <h1 className="text-lg font-semibold text-slate-900 mb-2">{title}</h1>
      <p className="text-sm text-slate-600">{children}</p>
    </div>
  );
}

function NavTab({ href, active, icon, children }: {
  href: string; active: boolean; icon: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <Link href={href}>
      <button className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
        active
          ? "border-[var(--portal-accent)] text-[var(--portal-accent)]"
          : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
      }`}>
        {icon}
        {children}
      </button>
    </Link>
  );
}
