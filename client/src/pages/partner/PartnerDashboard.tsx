import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import PartnerLayout from "./PartnerLayout";
import { Button } from "@/components/ui/button";
import { Plus, Users, Calendar, TrendingUp, Loader2, CalendarCheck, Euro } from "lucide-react";

function statusLabel(status: string) {
  const map: Record<string, { label: string; cls: string }> = {
    nuevo:       { label: "Nuevo",       cls: "bg-blue-50 text-blue-600" },
    contactado:  { label: "Contactado",  cls: "bg-yellow-50 text-yellow-700" },
    presupuesto: { label: "Presupuesto", cls: "bg-purple-50 text-purple-600" },
    confirmado:  { label: "Confirmado",  cls: "bg-green-50 text-green-600" },
    cerrado:     { label: "Cerrado",     cls: "bg-gray-100 text-gray-500" },
    perdido:     { label: "Perdido",     cls: "bg-red-50 text-red-500" },
  };
  return map[status] ?? { label: status, cls: "bg-gray-100 text-gray-500" };
}

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
    const diff = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
    return diff < 7;
  }) ?? [];

  return (
    <PartnerLayout>
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800">
            Hola, {(user as any)?.name?.split(" ")[0] ?? "colaborador"} 👋
          </h1>
          <p className="text-gray-500 mt-1">
            {partner?.name ?? "Portal de colaboradores"} · Gestión de leads
          </p>
        </div>
        <Link href="/partner/leads/nuevo">
          <Button className="bg-orange-500 hover:bg-orange-600 text-white gap-2">
            <Plus className="w-4 h-4" />
            Nuevo lead
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex items-center gap-2 text-gray-400 text-xs mb-2">
            <TrendingUp className="w-3.5 h-3.5" /> Este mes
          </div>
          <p className="text-3xl font-bold text-gray-800">{thisMonth.length}</p>
          <p className="text-xs text-gray-400 mt-1">leads enviados</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex items-center gap-2 text-gray-400 text-xs mb-2">
            <Calendar className="w-3.5 h-3.5" /> Esta semana
          </div>
          <p className="text-3xl font-bold text-gray-800">{thisWeek.length}</p>
          <p className="text-xs text-gray-400 mt-1">leads enviados</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex items-center gap-2 text-gray-400 text-xs mb-2">
            <Users className="w-3.5 h-3.5" /> Total
          </div>
          <p className="text-3xl font-bold text-gray-800">{myLeads?.length ?? 0}</p>
          <p className="text-xs text-gray-400 mt-1">leads histórico</p>
        </div>
      </div>

      {/* Recent leads */}
      <div className="bg-white rounded-xl border border-gray-100">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
          <h2 className="font-medium text-gray-700 text-sm">Últimos leads enviados</h2>
        </div>

        {leadsLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-gray-300" />
          </div>
        ) : !myLeads || myLeads.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-8 h-8 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">Todavía no has enviado ningún lead.</p>
            <Link href="/partner/leads/nuevo">
              <Button variant="outline" className="mt-4 text-sm gap-2">
                <Plus className="w-4 h-4" /> Crear el primero
              </Button>
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {myLeads.slice(0, 20).map((lead) => {
              const s = statusLabel(lead.status ?? "nuevo");
              return (
                <div key={lead.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50/50 transition-colors">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-800 text-sm truncate">{lead.name}</p>
                    <p className="text-xs text-gray-400 truncate">{lead.email}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                    {lead.preferredDate && (
                      <span className="text-xs text-gray-400 hidden sm:block">
                        {new Date(lead.preferredDate).toLocaleDateString("es-ES")}
                      </span>
                    )}
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>
                      {s.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reservas directas */}
      {partner?.canCreateReservations && (
        <div className="bg-white rounded-xl border border-gray-100 mt-6">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
            <h2 className="font-medium text-gray-700 text-sm">Reservas directas</h2>
            <Link href="/partner/reservas/nueva">
              <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white gap-1.5 text-xs h-8 px-3">
                <Plus className="w-3.5 h-3.5" /> Nueva reserva
              </Button>
            </Link>
          </div>

          {resLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-gray-300" />
            </div>
          ) : !myReservations || myReservations.length === 0 ? (
            <div className="text-center py-10">
              <CalendarCheck className="w-8 h-8 text-gray-200 mx-auto mb-3" />
              <p className="text-gray-400 text-sm">Todavía no hay reservas directas.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {myReservations.slice(0, 20).map((res: any) => (
                <div key={res.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50/50 transition-colors">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-800 text-sm truncate">{res.customerName}</p>
                    <p className="text-xs text-gray-400 truncate">{res.productName}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                    {res.bookingDate && (
                      <span className="text-xs text-gray-400 hidden sm:block">
                        {new Date(res.bookingDate).toLocaleDateString("es-ES")}
                      </span>
                    )}
                    <span className="text-xs font-medium text-gray-600 flex items-center gap-0.5">
                      <Euro className="w-3 h-3" />
                      {((res.amountTotal ?? 0) / 100).toFixed(2)}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-600">
                      {res.statusReservation ?? "CONFIRMADA"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </PartnerLayout>
  );
}
