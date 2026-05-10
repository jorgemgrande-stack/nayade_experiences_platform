import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import PartnerLayout from "./PartnerLayout";
import { Button } from "@/components/ui/button";
import { Plus, Users, Calendar, TrendingUp, Loader2, CalendarCheck, Euro, ArrowRight } from "lucide-react";

const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  nuevo:       { label: "Nuevo",       cls: "bg-blue-500/15 text-blue-400 border border-blue-500/25" },
  contactado:  { label: "Contactado",  cls: "bg-amber-500/15 text-amber-400 border border-amber-500/25" },
  en_proceso:  { label: "En proceso",  cls: "bg-violet-500/15 text-violet-400 border border-violet-500/25" },
  convertido:  { label: "Convertido",  cls: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25" },
  perdido:     { label: "Perdido",     cls: "bg-red-500/15 text-red-400 border border-red-500/25" },
};

const RES_STATUS: Record<string, { label: string; cls: string }> = {
  CONFIRMADA:             { label: "Confirmada", cls: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25" },
  PENDIENTE_CONFIRMACION: { label: "Pendiente",  cls: "bg-amber-500/15 text-amber-400 border border-amber-500/25" },
  EN_CURSO:               { label: "En curso",   cls: "bg-blue-500/15 text-blue-400 border border-blue-500/25" },
  FINALIZADA:             { label: "Finalizada", cls: "bg-gray-500/15 text-gray-400 border border-gray-500/25" },
  ANULADA:                { label: "Anulada",    cls: "bg-red-500/15 text-red-400 border border-red-500/25" },
};

export default function PartnerDashboard() {
  const { user } = useAuth();
  const { data: partner } = trpc.partners.getMyPartner.useQuery();
  const { data: myLeads, isLoading: leadsLoading } = trpc.partners.listMyLeads.useQuery();
  const { data: myReservations, isLoading: resLoading } = trpc.partners.listMyReservations.useQuery();

  const now = new Date();
  const thisMonth = myLeads?.filter(l => {
    const d = new Date(l.createdAt ?? "");
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }) ?? [];
  const thisWeek = myLeads?.filter(l => {
    const d = new Date(l.createdAt ?? "");
    return (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24) < 7;
  }) ?? [];

  const firstName = (user as any)?.name?.split(" ")[0] ?? "colaborador";

  return (
    <PartnerLayout bgImage="/images/partner/bg-dashboard_1.png">
      {/* Hero */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <p className="text-white/40 text-sm mb-1 uppercase tracking-widest font-medium">
            {partner?.name ?? "Portal de Colaboradores"}
          </p>
          <h1 className="text-3xl font-bold text-white">
            Hola, {firstName}
          </h1>
          <p className="text-white/40 text-sm mt-1.5">
            Gestiona tus oportunidades y reservas desde aquí
          </p>
        </div>
        <Link href="/partner/leads/nuevo">
          <Button className="bg-orange-500 hover:bg-orange-600 text-white gap-2 h-10 px-5 font-medium">
            <Plus className="w-4 h-4" />
            Nuevo lead
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        <StatCard icon={<TrendingUp className="w-4 h-4" />} value={thisMonth.length} label="Este mes" sublabel="leads" color="orange" />
        <StatCard icon={<Calendar className="w-4 h-4" />} value={thisWeek.length} label="Esta semana" sublabel="leads" color="blue" />
        <StatCard icon={<Users className="w-4 h-4" />} value={myLeads?.length ?? 0} label="Total" sublabel="histórico" color="violet" />
      </div>

      {/* Leads recientes */}
      <div className="bg-white/[0.08] border border-white/[0.10] rounded-2xl overflow-hidden mb-6">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <h2 className="font-semibold text-white/80 text-sm">Últimos leads enviados</h2>
          <Link href="/partner/leads/nuevo">
            <button className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1 transition-colors">
              Nuevo <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </Link>
        </div>
        {leadsLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-white/20" /></div>
        ) : !myLeads || myLeads.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-8 h-8 text-white/10 mx-auto mb-3" />
            <p className="text-white/30 text-sm">Todavía no has enviado ningún lead.</p>
            <Link href="/partner/leads/nuevo">
              <button className="mt-4 text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1.5 mx-auto transition-colors border border-orange-500/30 rounded-lg px-4 py-2">
                <Plus className="w-3.5 h-3.5" /> Crear el primero
              </button>
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {myLeads.slice(0, 20).map((lead) => {
              const s = STATUS_STYLES[lead.status ?? "nuevo"] ?? { label: lead.status, cls: "bg-gray-500/15 text-gray-400 border border-gray-500/25" };
              return (
                <div key={lead.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-white/[0.02] transition-colors">
                  <div className="min-w-0">
                    <p className="font-medium text-white/85 text-sm truncate">{lead.name}</p>
                    <p className="text-xs text-white/35 truncate">{lead.email}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                    {lead.preferredDate && (
                      <span className="text-xs text-white/30 hidden sm:block">
                        {new Date(lead.preferredDate).toLocaleDateString("es-ES")}
                      </span>
                    )}
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${s.cls}`}>{s.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reservas directas */}
      {partner?.canCreateReservations && (
        <div className="bg-white/[0.08] border border-white/[0.10] rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
            <h2 className="font-semibold text-white/80 text-sm">Reservas directas</h2>
            <Link href="/partner/reservas/nueva">
              <button className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1 transition-colors">
                Nueva <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </Link>
          </div>
          {resLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-white/20" /></div>
          ) : !myReservations || myReservations.length === 0 ? (
            <div className="text-center py-10">
              <CalendarCheck className="w-8 h-8 text-white/10 mx-auto mb-3" />
              <p className="text-white/30 text-sm">Todavía no hay reservas directas.</p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {myReservations.slice(0, 20).map((res: any) => {
                const s = RES_STATUS[res.statusReservation ?? "CONFIRMADA"] ?? { label: "Confirmada", cls: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25" };
                return (
                  <div key={res.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-white/[0.02] transition-colors">
                    <div className="min-w-0">
                      <p className="font-medium text-white/85 text-sm truncate">{res.customerName}</p>
                      <p className="text-xs text-white/35 truncate">{res.productName}</p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                      {res.bookingDate && (
                        <span className="text-xs text-white/30 hidden sm:block">{res.bookingDate}</span>
                      )}
                      <span className="text-xs font-semibold text-violet-400 flex items-center gap-0.5">
                        <Euro className="w-3 h-3" />{((res.amountTotal ?? 0) / 100).toFixed(2)}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${s.cls}`}>{s.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </PartnerLayout>
  );
}

function StatCard({ icon, value, label, sublabel, color }: {
  icon: React.ReactNode; value: number; label: string; sublabel: string;
  color: "orange" | "blue" | "violet";
}) {
  const colors = {
    orange: "bg-orange-500/10 border-orange-500/20 text-orange-400",
    blue:   "bg-blue-500/10 border-blue-500/20 text-blue-400",
    violet: "bg-violet-500/10 border-violet-500/20 text-violet-400",
  };
  return (
    <div className={`border rounded-2xl p-4 sm:p-5 ${colors[color]}`}>
      <div className="flex items-center gap-1.5 text-xs opacity-70 mb-2">{icon} {label}</div>
      <p className="text-3xl font-bold">{value}</p>
      <p className="text-xs opacity-60 mt-0.5">{sublabel}</p>
    </div>
  );
}
