/**
 * EmployeeLayout — Layout del Portal del Empleado (Fase 3 RRHH).
 *
 * Clonado del patrón PartnerLayout. Guard de rol exclusivo:
 *   - 'employee' (rol nuevo creado en Fase 3)
 *   - 'monitor'  (rol legacy — compatibilidad con accesos previos)
 *
 * Cualquier otro rol es redirigido a /admin. Si no hay sesión, a /login.
 */
import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  LayoutDashboard, User, FileText, LogOut, Loader2, Phone,
} from "lucide-react";

const LOGO_FALLBACK = "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade_blue_e9563f49.png";
const NAYADE_PHONE = "+34 911 67 51 89";

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
      <div className="min-h-screen flex items-center justify-center bg-[#080e1c]">
        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
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
  const { data: publicSettings } = trpc.config.getPublicSettings.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const { data: me } = trpc.hr.portal.me.useQuery();

  const brandLogo = (publicSettings as any)?.brand_logo_url || LOGO_FALLBACK;
  const employeeName = me?.fullName ?? (user as any).name ?? (user as any).email ?? "Empleado";

  return (
    <div className="min-h-screen text-white" style={{ backgroundColor: "#080e1c" }}>
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0a1628]/95 border-b border-white/[0.07] backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4">
          {/* Fila superior: logo + empleado + acciones */}
          <div className="flex items-center justify-between h-14">
            <Link href="/empleado" className="flex items-center gap-2.5">
              <img src={brandLogo} alt="Náyade Experiences" className="h-7 w-auto object-contain" />
            </Link>

            <div className="hidden sm:flex flex-col items-center">
              <span className="text-xs font-bold text-orange-400 uppercase tracking-wider">Portal del Empleado</span>
              <span className="text-[11px] text-white/40">{employeeName}</span>
            </div>

            <div className="flex items-center gap-2">
              <a
                href={`tel:${NAYADE_PHONE}`}
                className="hidden sm:flex items-center gap-1.5 text-xs text-white/50 hover:text-orange-400 transition-colors border border-white/10 hover:border-orange-500/30 rounded-lg px-2.5 py-1.5"
                title="Llamar a Náyade"
              >
                <Phone className="w-3.5 h-3.5" />
                {NAYADE_PHONE}
              </a>
              <button
                onClick={() => logout().then(() => navigate("/login"))}
                className="text-white/30 hover:text-white/70 transition-colors p-1.5"
                title="Cerrar sesión"
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
            <NavTab href="/empleado/perfil" active={location.startsWith("/empleado/perfil")} icon={<User className="w-3.5 h-3.5" />}>
              Mi perfil
            </NavTab>
            <NavTab href="/empleado/documentos" active={location.startsWith("/empleado/documentos")} icon={<FileText className="w-3.5 h-3.5" />}>
              Mis documentos
            </NavTab>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">{children}</main>

      <footer className="border-t border-white/[0.06] py-4 mt-8">
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-white/25">
          <span>Portal del Empleado · Náyade Experiences</span>
          <a href={`tel:${NAYADE_PHONE}`} className="hover:text-white/50 transition-colors flex items-center gap-1">
            <Phone className="w-3 h-3" /> {NAYADE_PHONE}
          </a>
        </div>
      </footer>
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
          ? "border-orange-500 text-orange-400"
          : "border-transparent text-white/40 hover:text-white/70 hover:border-white/20"
      }`}>
        {icon}
        {children}
      </button>
    </Link>
  );
}
