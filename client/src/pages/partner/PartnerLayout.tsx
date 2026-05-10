import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  LayoutDashboard, Plus, CalendarCheck, LogOut, Loader2,
  Phone, ExternalLink, X, BellRing, BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const LOGO_FALLBACK = "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade_blue_e9563f49.png";
const NAYADE_PHONE = "+34 911 67 51 89";
const CATALOG_URL = "https://www.nayadeexperiences.es/experiencias";

// ─── Modal de anuncios ────────────────────────────────────────────────────────

function AnnouncementsModal({ partnerId }: { partnerId: number }) {
  const [open, setOpen] = useState(false);
  const { data: announcements = [] } = trpc.partners.getAnnouncements.useQuery();

  useEffect(() => {
    if (!announcements || announcements.length === 0) return;
    const seenKey = `partner_seen_${partnerId}`;
    const seen: string[] = JSON.parse(localStorage.getItem(seenKey) ?? "[]");
    const hasUnseen = (announcements as any[]).some((a: any) => !seen.includes(a.id));
    if (hasUnseen) setOpen(true);
  }, [announcements, partnerId]);

  function dismiss() {
    const seenKey = `partner_seen_${partnerId}`;
    const allIds = (announcements as any[]).map((a: any) => a.id);
    localStorage.setItem(seenKey, JSON.stringify(allIds));
    setOpen(false);
  }

  if (!open || !announcements || (announcements as any[]).length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-[#0f1e35] border border-amber-500/30 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-amber-500/20">
          <div className="flex items-center gap-2">
            <BellRing className="w-5 h-5 text-amber-400 animate-pulse" />
            <span className="font-semibold text-white text-sm">Avisos de Nayade Experiences</span>
          </div>
          <button onClick={dismiss} className="text-white/40 hover:text-white/80 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3 max-h-80 overflow-y-auto">
          {(announcements as any[]).map((a: any) => (
            <div key={a.id} className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
              {a.isNew && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-500/15 border border-red-500/30 rounded-full px-2 py-0.5 mb-2">
                  🔴 Nueva Nota
                </span>
              )}
              <p className="text-sm text-white/85 leading-relaxed">{a.text}</p>
              <p className="text-[10px] text-white/30 mt-1.5">
                {new Date(a.createdAt).toLocaleDateString("es-ES", { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          ))}
        </div>
        <div className="px-5 pb-5">
          <button
            onClick={dismiss}
            className="w-full py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-sm font-semibold transition-colors"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Layout principal ─────────────────────────────────────────────────────────

export default function PartnerLayout({ children, bgImage }: { children: React.ReactNode; bgImage?: string }) {
  const { user, loading, logout } = useAuth();
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate("/login?returnTo=" + encodeURIComponent(location)); return; }
    const role = (user as any).role as string;
    if (role !== "partner_admin" && role !== "partner_user") navigate("/admin");
  }, [user, loading, navigate, location]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#080e1c]">
        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
      </div>
    );
  }

  const role = (user as any).role as string;
  if (role !== "partner_admin" && role !== "partner_user") return null;

  return <PartnerLayoutInner user={user} location={location} navigate={navigate} logout={logout} bgImage={bgImage}>{children}</PartnerLayoutInner>;
}

function PartnerLayoutInner({ user, location, navigate, logout, children, bgImage }: {
  user: any; location: string; navigate: any; logout: any; children: React.ReactNode; bgImage?: string;
}) {
  const { data: partner } = trpc.partners.getMyPartner.useQuery();
  const { data: publicSettings } = trpc.config.getPublicSettings.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const { data: announcements = [] } = trpc.partners.getAnnouncements.useQuery(undefined, { staleTime: 2 * 60 * 1000 });
  const canReserve = partner?.canCreateReservations ?? false;

  const brandLogo = (publicSettings as any)?.brand_logo_url || LOGO_FALLBACK;
  const userName = (user as any).name ?? (user as any).email ?? "Colaborador";
  const partnerName = partner?.name ?? "";

  const bgStyle = bgImage
    ? {
        backgroundImage: `linear-gradient(rgba(8,14,28,0.88) 0%, rgba(8,14,28,0.92) 60%, rgba(8,14,28,0.97) 100%), url('${bgImage}')`,
        backgroundSize: "cover",
        backgroundPosition: "center top",
        backgroundRepeat: "no-repeat",
        backgroundAttachment: "scroll",
      }
    : undefined;

  return (
    <div className="min-h-screen bg-[#080e1c] text-white" style={bgStyle}>
      {/* Anuncios */}
      {partner?.id && <AnnouncementsModal partnerId={partner.id} />}

      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0a1628]/95 border-b border-white/[0.07] backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4">
          {/* Fila superior: logo + partner info + acciones */}
          <div className="flex items-center justify-between h-14">
            {/* Logo */}
            <Link href="/partner/dashboard" className="flex items-center gap-2.5">
              <img src={brandLogo} alt="Nayade Experiences" className="h-7 w-auto object-contain" />
            </Link>

            {/* Partner + usuario */}
            <div className="hidden sm:flex flex-col items-center">
              {partnerName && (
                <span className="text-xs font-bold text-orange-400 uppercase tracking-wider">{partnerName}</span>
              )}
              <span className="text-[11px] text-white/40">{userName}</span>
            </div>

            {/* Acciones rápidas */}
            <div className="flex items-center gap-2">
              <a
                href={`https://wa.me/${NAYADE_PHONE.replace(/\s/g, "").replace("+", "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:flex items-center gap-1.5 text-xs text-white/50 hover:text-green-400 transition-colors border border-white/10 hover:border-green-500/30 rounded-lg px-2.5 py-1.5"
                title="WhatsApp Nayade"
              >
                <Phone className="w-3.5 h-3.5" />
                {NAYADE_PHONE}
              </a>
              <a
                href={CATALOG_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:flex items-center gap-1.5 text-xs text-white/50 hover:text-orange-400 transition-colors border border-white/10 hover:border-orange-500/30 rounded-lg px-2.5 py-1.5"
              >
                <BookOpen className="w-3.5 h-3.5" />
                Catálogo
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
            <NavTab href="/partner/dashboard" active={location === "/partner/dashboard"} icon={<LayoutDashboard className="w-3.5 h-3.5" />}>
              Inicio
            </NavTab>
            <NavTab href="/partner/leads/nuevo" active={location.startsWith("/partner/leads")} icon={<Plus className="w-3.5 h-3.5" />}>
              Nuevo lead
            </NavTab>
            {canReserve && (
              <NavTab href="/partner/reservas/nueva" active={location.startsWith("/partner/reservas")} icon={<CalendarCheck className="w-3.5 h-3.5" />}>
                Nueva reserva
              </NavTab>
            )}
            {/* Móvil: catálogo y teléfono */}
            <a href={CATALOG_URL} target="_blank" rel="noopener noreferrer"
              className="sm:hidden flex items-center gap-1.5 px-3 py-2.5 text-xs text-white/40 hover:text-orange-400 transition-colors">
              <ExternalLink className="w-3.5 h-3.5" /> Catálogo
            </a>
          </nav>
        </div>

        {/* Banner de avisos del día (persistente, visible en todos los módulos) */}
        {(announcements as any[]).length > 0 && (
          <div className="border-t border-amber-500/20 bg-amber-500/[0.07]">
            <div className="max-w-5xl mx-auto px-4 py-2 flex items-start gap-2.5">
              <BellRing className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <div className="min-w-0 flex flex-col gap-1">
                {(announcements as any[]).map((a: any) => (
                  <p key={a.id} className="text-[11px] text-amber-200/70 leading-snug">{a.text}</p>
                ))}
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Contenido */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-4 mt-8">
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-white/25">
          <span>Portal de Colaboradores · Nayade Experiences</span>
          <div className="flex items-center gap-4">
            <a href={`tel:${NAYADE_PHONE}`} className="hover:text-white/50 transition-colors flex items-center gap-1">
              <Phone className="w-3 h-3" /> {NAYADE_PHONE}
            </a>
            <a href={CATALOG_URL} target="_blank" rel="noopener noreferrer" className="hover:text-white/50 transition-colors flex items-center gap-1">
              <ExternalLink className="w-3 h-3" /> Ver catálogo
            </a>
          </div>
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
