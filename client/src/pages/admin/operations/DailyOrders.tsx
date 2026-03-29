import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  ClipboardList, User, Users, Phone, Clock, CheckCircle2,
  AlertTriangle, ChevronLeft, ChevronRight, RefreshCw,
  Calendar, MessageSquare, Edit3, Save, X, CalendarDays,
} from "lucide-react";


function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
// CRITICAL: use LOCAL date parts — toISOString() shifts day by -1 in UTC+2 Spain
function formatDateStr(d: Date) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}
function formatTime(sd: any) {
  if (!sd) return "—";
  if (typeof sd === "number") return new Date(sd).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  // MySQL DATE string "YYYY-MM-DD" — parse as local time to avoid UTC offset shifting the day
  const s = String(sd);
  const d = s.length === 10 ? new Date(s + "T09:00:00") : new Date(s);
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

export default function DailyOrders() {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editArrival, setEditArrival] = useState("");


  const dateStr = formatDateStr(currentDate);

  const { data, isLoading, refetch } = trpc.operations.dailyOrders.getForDate.useQuery(
    { date: dateStr },
    { refetchOnWindowFocus: false }
  );

  const updateMutation = trpc.operations.dailyOrders.updateOperational.useMutation({
    onSuccess: () => {
      toast.success("Actualizado correctamente");
      setEditingId(null);
      refetch();
    },
    onError: () => toast.error("Error al actualizar"),
  });

  const allData = data as { activities: any[]; restaurants: any[]; date: string } | undefined;
  const orders = [...(allData?.activities || []), ...(allData?.restaurants || [])];
  const confirmed = orders.filter((o) => o.clientConfirmed);
  const pending = orders.filter((o) => !o.clientConfirmed);

  function startEdit(order: any) {
    setEditingId(order.id);
    setEditNotes(order.opNotes || "");
    setEditArrival(order.arrivalTime || "");
  }

  function saveEdit(order: any) {
    updateMutation.mutate({
      reservationId: order.id,
      reservationType: (order.eventType === 'restaurant' ? 'restaurant' : 'activity') as any,
      opNotes: editNotes,
      arrivalTime: editArrival || undefined,
    });
  }

  function toggleConfirm(order: any) {
    updateMutation.mutate({
      reservationId: order.id,
      reservationType: (order.eventType === 'restaurant' ? 'restaurant' : 'activity') as any,
      clientConfirmed: !order.clientConfirmed,
    });
  }

  return (
    <AdminLayout title="Órdenes del Día">
      <div className="min-h-screen bg-[#0a0f1a] text-white p-6 -m-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <ClipboardList className="w-6 h-6 text-purple-400" />
              Órdenes del Día
            </h1>
            <p className="text-slate-400 text-sm mt-1">Confirmaciones, hora de llegada y notas operativas</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="border-slate-700 text-slate-300 hover:bg-slate-800">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        {/* Date Navigation */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <Button variant="outline" size="icon" onClick={() => setCurrentDate(d => addDays(d, -1))} className="border-slate-700 text-slate-300 hover:bg-slate-800 w-8 h-8">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())} className="border-slate-700 text-slate-300 hover:bg-slate-800 text-xs">
            Hoy
          </Button>
          <Button variant="outline" size="icon" onClick={() => setCurrentDate(d => addDays(d, 1))} className="border-slate-700 text-slate-300 hover:bg-slate-800 w-8 h-8">
            <ChevronRight className="w-4 h-4" />
          </Button>
          {/* Date Picker nativo */}
          <label className="flex items-center gap-2 cursor-pointer border border-slate-700 rounded-md px-3 h-8 bg-transparent hover:bg-slate-800 transition-colors">
            <CalendarDays className="w-4 h-4 text-blue-400 shrink-0" />
            <span className="text-slate-300 text-sm">Ir a fecha</span>
            <input
              type="date"
              value={formatDateStr(currentDate)}
              onChange={(e) => {
                if (e.target.value) {
                  const [y, m, d] = e.target.value.split("-").map(Number);
                  setCurrentDate(new Date(y, m - 1, d));
                }
              }}
              className="opacity-0 absolute w-0 h-0"
            />
          </label>
          <h2 className="text-lg font-semibold text-white capitalize">
            {currentDate.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </h2>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <div className="text-3xl font-bold text-white">{orders.length}</div>
            <div className="text-slate-400 text-sm mt-1">Total órdenes</div>
          </div>
          <div className="bg-emerald-500/10 rounded-xl border border-emerald-500/30 p-4">
            <div className="text-3xl font-bold text-emerald-300">{confirmed.length}</div>
            <div className="text-slate-400 text-sm mt-1">Confirmadas</div>
          </div>
          <div className="bg-amber-500/10 rounded-xl border border-amber-500/30 p-4">
            <div className="text-3xl font-bold text-amber-300">{pending.length}</div>
            <div className="text-slate-400 text-sm mt-1">Pendientes confirmación</div>
          </div>
        </div>

        {pending.length > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-6 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <p className="text-amber-300 font-medium">
              {pending.length} cliente{pending.length > 1 ? "s" : ""} pendiente{pending.length > 1 ? "s" : ""} de confirmar asistencia
            </p>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-slate-400">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />Cargando órdenes...
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No hay órdenes para este día</p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order: any) => {
              const isEditing = editingId === order.id;
              return (
                <div key={order.id} className={`bg-[#111827] border rounded-xl p-5 transition-colors ${
                  order.clientConfirmed ? "border-emerald-500/30" : "border-amber-500/30"
                }`}>
                  <div className="flex items-start gap-4">
                    <button
                      onClick={() => toggleConfirm(order)}
                      className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                        order.clientConfirmed
                          ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                          : "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
                      }`}
                    >
                      {order.clientConfirmed ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-white text-base">{order.activityTitle || order.productName || "Reserva"}</h3>
                        <Badge className={order.clientConfirmed
                          ? "bg-emerald-500/20 text-emerald-300 border-emerald-500 text-xs"
                          : "bg-amber-500/20 text-amber-300 border-amber-500 text-xs"}>
                          {order.clientConfirmed ? "Confirmado" : "Sin confirmar"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-sm text-slate-400 flex-wrap">
                        <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{order.scheduledDate ? formatTime(order.scheduledDate) : "—"}</span>
                        <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" />{order.clientName}</span>
                        {order.clientPhone && (
                          <a href={`tel:${order.clientPhone}`} className="flex items-center gap-1 text-blue-400 hover:text-blue-300">
                            <Phone className="w-3.5 h-3.5" />{order.clientPhone}
                          </a>
                        )}
                        <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{order.numberOfPersons} pax</span>
                        {order.arrivalTime && !isEditing && (
                          <span className="flex items-center gap-1 text-purple-400"><Clock className="w-3.5 h-3.5" />Llegada: {order.arrivalTime}</span>
                        )}
                      </div>
                      {isEditing ? (
                        <div className="mt-3 space-y-3">
                          <div>
                            <label className="text-xs text-slate-400 block mb-1">Hora de llegada</label>
                            <Input type="time" value={editArrival} onChange={(e) => setEditArrival(e.target.value)} className="bg-slate-800 border-slate-600 text-white w-40" />
                          </div>
                          <div>
                            <label className="text-xs text-slate-400 block mb-1">Notas operativas</label>
                            <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Notas internas del equipo..." className="bg-slate-800 border-slate-600 text-white text-sm resize-none" rows={2} />
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => saveEdit(order)} disabled={updateMutation.isPending} className="bg-blue-600 hover:bg-blue-700 text-white">
                              <Save className="w-3.5 h-3.5 mr-1" />Guardar
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setEditingId(null)} className="border-slate-600 text-slate-300">
                              <X className="w-3.5 h-3.5 mr-1" />Cancelar
                            </Button>
                          </div>
                        </div>
                      ) : (
                        order.opNotes && (
                          <div className="mt-2 flex items-start gap-2 text-sm text-slate-400">
                            <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span>{order.opNotes}</span>
                          </div>
                        )
                      )}
                    </div>
                    {!isEditing && (
                      <div className="flex items-center gap-2 shrink-0">
                        {order.clientPhone && (
                          <a href={`tel:${order.clientPhone}`}>
                            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs">
                              <Phone className="w-3.5 h-3.5 mr-1" />Llamar
                            </Button>
                          </a>
                        )}
                        <Button size="sm" variant="outline" onClick={() => startEdit(order)} className="border-slate-600 text-slate-300 hover:bg-slate-700 text-xs">
                          <Edit3 className="w-3.5 h-3.5 mr-1" />Editar
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
