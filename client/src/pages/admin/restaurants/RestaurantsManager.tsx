import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Calendar, List, Settings, Users, ChevronLeft, ChevronRight,
  CheckCircle, XCircle, Clock, Loader2, Phone, Mail, RefreshCw,
  AlertCircle, Edit, Trash2, MessageSquare,
} from "lucide-react";

type ViewMode = "list" | "calendar" | "config";
type StatusFilter = "all" | "pending" | "confirmed" | "cancelled" | "no_show";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:   { label: "Pendiente",  color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
  confirmed: { label: "Confirmada", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
  cancelled: { label: "Cancelada",  color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
  no_show:   { label: "No show",    color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
};

const DAYS = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function formatDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export default function RestaurantsManager() {
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [calMonth, setCalMonth] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const [selectedDate, setSelectedDate] = useState<string>(formatDate(new Date()));
  const [editingBooking, setEditingBooking] = useState<number | null>(null);
  const [noteText, setNoteText] = useState("");
  const [showNoteModal, setShowNoteModal] = useState(false);

  // Data
  const { data: restaurants, isLoading: loadingRest } = trpc.restaurants.adminGetAll.useQuery();
  const selectedRestaurant = restaurants?.find(r => r.id === selectedRestaurantId);

  const { data: bookings, isLoading: loadingBookings, refetch: refetchBookings } = trpc.restaurants.adminGetBookings.useQuery(
    { restaurantId: selectedRestaurantId ?? 0, status: statusFilter === "all" ? undefined : statusFilter },
    { enabled: !!selectedRestaurantId }
  );

  const { data: calendarData } = trpc.restaurants.adminGetCalendar.useQuery(
    { restaurantId: selectedRestaurantId ?? 0, date: selectedDate },
    { enabled: !!selectedRestaurantId && viewMode === "calendar" }
  );

  const utils = trpc.useUtils();

  const updateStatusMutation = trpc.restaurants.adminUpdateBookingStatus.useMutation({
    onSuccess: () => { utils.restaurants.adminGetBookings.invalidate(); utils.restaurants.adminGetCalendar.invalidate(); },
  });

  const addNoteMutation = trpc.restaurants.adminAddNote.useMutation({
    onSuccess: () => { utils.restaurants.adminGetBookings.invalidate(); setShowNoteModal(false); setNoteText(""); },
  });

  const deleteBookingMutation = trpc.restaurants.adminDeleteBooking.useMutation({
    onSuccess: () => utils.restaurants.adminGetBookings.invalidate(),
  });

  type BookingItem = NonNullable<typeof bookings>[number];
  type CalItem = NonNullable<typeof calendarData>[number];

  // Calendar helpers
  function calDays() {
    const year = calMonth.getFullYear(), month = calMonth.getMonth();
    const first = new Date(year, month, 1).getDay();
    const total = new Date(year, month+1, 0).getDate();
    const cells: (number|null)[] = Array(first).fill(null);
    for (let i=1; i<=total; i++) cells.push(i);
    return cells;
  }

  if (loadingRest) return (
    <AdminLayout>
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    </AdminLayout>
  );

  // ── Selector de restaurante ──────────────────────────────────────────────
  if (!selectedRestaurantId) return (
    <AdminLayout>
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-heading font-bold text-foreground mb-2">Gestión de Restaurantes</h1>
        <p className="text-muted-foreground font-display mb-8">Selecciona un restaurante para gestionar sus reservas.</p>
        {!restaurants || restaurants.length === 0 ? (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-2xl p-6 flex gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-800 dark:text-amber-300">No hay restaurantes configurados</p>
              <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
                Ejecuta <code className="bg-amber-100 dark:bg-amber-800 px-1 rounded">node scripts/seed-restaurants.mjs</code> para cargar los 4 restaurantes de Náyade.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {restaurants.map(r => (
              <button
                key={r.id}
                onClick={() => setSelectedRestaurantId(r.id)}
                className="bg-card border border-border/40 rounded-2xl p-5 text-left hover:border-accent/50 hover:shadow-md transition-all group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-heading font-bold text-foreground group-hover:text-accent transition-colors">{r.name}</h3>
                    <p className="text-sm text-muted-foreground font-display">{r.cuisine}</p>
                  </div>
                  <span className={`text-xs font-display font-semibold px-2 py-1 rounded-full ${r.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {r.isActive ? "Activo" : "Inactivo"}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground font-display">
                  <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> Máx. {r.maxGroupSize} personas</span>
                  {r.depositPerGuest && Number(r.depositPerGuest) > 0 && (
                    <span className="flex items-center gap-1 text-accent">Depósito: {r.depositPerGuest}€/p.</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );

  return (
    <AdminLayout>
      <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setSelectedRestaurantId(null)} className="p-2 rounded-xl hover:bg-muted transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-xl font-heading font-bold text-foreground">{selectedRestaurant?.name}</h1>
              <p className="text-sm text-muted-foreground font-display">{selectedRestaurant?.cuisine}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Selector de restaurante rápido */}
            <select
              value={selectedRestaurantId}
              onChange={e => setSelectedRestaurantId(Number(e.target.value))}
              className="text-sm font-display border border-border/60 rounded-xl px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50"
            >
              {restaurants?.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            {/* Tabs de vista */}
            <div className="flex bg-muted rounded-xl p-1 gap-1">
              {([
                { mode: "list" as ViewMode, icon: List, label: "Lista" },
                { mode: "calendar" as ViewMode, icon: Calendar, label: "Calendario" },
                { mode: "config" as ViewMode, icon: Settings, label: "Config." },
              ]).map(({ mode, icon: Icon, label }) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-display transition-all ${
                    viewMode === mode ? "bg-background shadow-sm text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="w-4 h-4" /> {label}
                </button>
              ))}
            </div>
            <button onClick={() => refetchBookings()} className="p-2 rounded-xl hover:bg-muted transition-colors" title="Actualizar">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── VISTA LISTA ── */}
        {viewMode === "list" && (
          <div>
            {/* Filtros */}
            <div className="flex gap-2 mb-5 flex-wrap">
              {(["all","pending","confirmed","cancelled","no_show"] as StatusFilter[]).map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-4 py-1.5 rounded-full text-sm font-display font-semibold transition-all ${
                    statusFilter === s ? "bg-accent text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {s === "all" ? "Todas" : STATUS_LABELS[s]?.label}
                </button>
              ))}
            </div>

            {loadingBookings ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="w-6 h-6 animate-spin text-accent" />
              </div>
            ) : !bookings || bookings.length === 0 ? (
              <div className="bg-muted/50 rounded-2xl p-12 text-center">
                <Calendar className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground font-display">No hay reservas con este filtro.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {bookings.map(b => (
                  <div key={b.id} className="bg-card border border-border/40 rounded-2xl p-4 hover:shadow-sm transition-shadow">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                          <span className="font-heading font-bold text-foreground">{b.guestName} {b.guestLastName ?? ""}</span>
                          <span className={`text-xs font-display font-semibold px-2.5 py-0.5 rounded-full ${STATUS_LABELS[b.status]?.color}`}>
                            {STATUS_LABELS[b.status]?.label}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">#{b.locator}</span>
                        </div>
                        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground font-display">
                          <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{b.date} · {b.time}</span>
                          <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{b.guests} comensales</span>
                          {b.guestEmail && <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" />{b.guestEmail}</span>}
                          {b.guestPhone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{b.guestPhone}</span>}
                        </div>
                        {b.allergies && (
                          <p className="text-xs text-amber-600 dark:text-amber-400 font-display mt-2 flex items-center gap-1">
                            <AlertCircle className="w-3.5 h-3.5" /> Alergias: {b.allergies}
                          </p>
                        )}
                        {b.specialRequests && (
                          <p className="text-xs text-muted-foreground font-display mt-1">Petición: {b.specialRequests}</p>
                        )}
                        {b.adminNotes && (
                          <p className="text-xs text-blue-600 dark:text-blue-400 font-display mt-1 flex items-center gap-1">
                            <MessageSquare className="w-3.5 h-3.5" /> {b.adminNotes}
                          </p>
                        )}
                      </div>
                      {/* Acciones */}
                      <div className="flex flex-col gap-2 shrink-0">
                        {(b.status === "pending_payment" || (b.status as string) === "pending") && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => updateStatusMutation.mutate({ id: b.id, status: "confirmed" })}
                              className="flex items-center gap-1 px-3 py-1.5 bg-green-100 hover:bg-green-200 text-green-700 rounded-lg text-xs font-display font-semibold transition-colors"
                            >
                              <CheckCircle className="w-3.5 h-3.5" /> Confirmar
                            </button>
                            <button
                            onClick={() => updateStatusMutation.mutate({ id: b.id, status: "cancelled" })}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-xs font-display font-semibold transition-colors"
                          >
                            <XCircle className="w-3.5 h-3.5" /> Cancelar
                          </button>
                        </div>
                        )}
                        {b.status === "confirmed" && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => updateStatusMutation.mutate({ id: b.id, status: "no_show" })}
                              className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-xs font-display font-semibold transition-colors"
                            >
                              <Clock className="w-3.5 h-3.5" /> No show
                            </button>
                            <button
                            onClick={() => updateStatusMutation.mutate({ id: b.id, status: "cancelled" })}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-xs font-display font-semibold transition-colors"
                          >
                            <XCircle className="w-3.5 h-3.5" /> Cancelar
                          </button>
                        </div>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => { setEditingBooking(b.id); setNoteText(b.adminNotes ?? ""); setShowNoteModal(true); }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg text-xs font-display font-semibold transition-colors"
                          >
                            <Edit className="w-3.5 h-3.5" /> Nota
                          </button>
                          <button
                            onClick={() => { if (confirm("\u00bfEliminar esta reserva?")) deleteBookingMutation.mutate({ bookingId: b.id as number }); }}                        className="flex items-center gap-1 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-500 rounded-lg text-xs font-display font-semibold transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── VISTA CALENDARIO ── */}
        {viewMode === "calendar" && (
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Mini calendario */}
            <div className="bg-card rounded-2xl border border-border/40 p-5">
              <div className="flex items-center justify-between mb-4">
                <button onClick={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth()-1, 1))} className="p-1 rounded-lg hover:bg-muted">
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <span className="font-heading font-bold text-sm">{MONTHS[calMonth.getMonth()]} {calMonth.getFullYear()}</span>
                <button onClick={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth()+1, 1))} className="p-1 rounded-lg hover:bg-muted">
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1 mb-2">
                {DAYS.map(d => <div key={d} className="text-center text-xs text-muted-foreground font-display py-1">{d}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {calDays().map((day, i) => (
                  <div key={i}>
                    {day === null ? <div /> : (
                      <button
                        onClick={() => setSelectedDate(`${calMonth.getFullYear()}-${String(calMonth.getMonth()+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`)}
                        className={`w-full aspect-square rounded-lg text-xs font-display transition-colors ${
                          selectedDate === `${calMonth.getFullYear()}-${String(calMonth.getMonth()+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`
                            ? "bg-accent text-white font-bold"
                            : "hover:bg-muted text-foreground"
                        }`}
                      >
                        {day}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Reservas del día */}
            <div className="lg:col-span-2 bg-card rounded-2xl border border-border/40 p-5">
              <h3 className="font-heading font-bold text-foreground mb-4">
                Reservas del {selectedDate}
              </h3>
              {!calendarData || calendarData.length === 0 ? (
                <p className="text-muted-foreground font-display text-sm">No hay reservas para este día.</p>
              ) : (
                <div className="space-y-3">
                  {calendarData.map((b: CalItem) => (
                    <div key={b.id} className="flex items-center gap-3 p-3 bg-muted/50 rounded-xl">
                      <div className="text-center shrink-0">
                        <div className="text-sm font-heading font-bold text-accent">{b.time}</div>
                        <div className="text-xs text-muted-foreground font-display">{b.guests}p.</div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-display font-semibold text-sm text-foreground truncate">{b.guestName} {b.guestLastName ?? ""}</div>
                        {b.guestPhone && <div className="text-xs text-muted-foreground font-display">{b.guestPhone}</div>}
                      </div>
                      <span className={`text-xs font-display font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_LABELS[b.status]?.color}`}>
                        {STATUS_LABELS[b.status]?.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── VISTA CONFIG ── */}
        {viewMode === "config" && selectedRestaurant && (
          <RestaurantConfig restaurant={selectedRestaurant} />
        )}

        {/* Modal de nota */}
        {showNoteModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-2xl border border-border/40 p-6 w-full max-w-md shadow-2xl">
              <h3 className="font-heading font-bold text-foreground mb-4">Añadir nota interna</h3>
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                rows={4}
                className="w-full px-4 py-3 rounded-xl border border-border/60 bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none mb-4"
                placeholder="Nota interna visible solo para el equipo..."
              />
              <div className="flex gap-3 justify-end">
                <Button variant="outline" onClick={() => setShowNoteModal(false)} className="rounded-full">Cancelar</Button>
                <Button
                  onClick={() => editingBooking && addNoteMutation.mutate({ bookingId: editingBooking, note: noteText })}
                  disabled={addNoteMutation.isPending}
                  className="bg-accent hover:bg-accent/90 text-white rounded-full"
                >
                  {addNoteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar nota"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

// ── Subcomponente de configuración ──────────────────────────────────────────
function RestaurantConfig({ restaurant }: { restaurant: { id: number; name: string; acceptsOnlineBooking: boolean; depositPerGuest: string | null; maxGroupSize: number | null; cancellationPolicy: string | null } }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    acceptsOnlineBooking: restaurant.acceptsOnlineBooking,
    depositPerGuest: restaurant.depositPerGuest ?? "5.00",
    maxGroupSize: restaurant.maxGroupSize ?? 20,
    cancellationPolicy: restaurant.cancellationPolicy ?? "",
  });
  const [saved, setSaved] = useState(false);

  const updateMutation = trpc.restaurants.adminUpdateConfig.useMutation({
    onSuccess: () => { utils.restaurants.adminGetAll.invalidate(); setSaved(true); setTimeout(() => setSaved(false), 2000); },
  });

  return (
    <div className="max-w-xl space-y-6">
      <div className="bg-card rounded-2xl border border-border/40 p-6 space-y-5">
        <h3 className="font-heading font-bold text-foreground">Configuración de {restaurant.name}</h3>

        <div className="flex items-center justify-between">
          <div>
            <p className="font-display font-semibold text-foreground text-sm">Reservas online activas</p>
            <p className="text-xs text-muted-foreground font-display">Los clientes podrán reservar desde la web</p>
          </div>
          <button
            onClick={() => setForm(f => ({ ...f, acceptsOnlineBooking: !f.acceptsOnlineBooking }))}
            className={`w-12 h-6 rounded-full transition-colors ${form.acceptsOnlineBooking ? "bg-accent" : "bg-muted-foreground/30"}`}
          >
            <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform mx-0.5 ${form.acceptsOnlineBooking ? "translate-x-6" : "translate-x-0"}`} />
          </button>
        </div>

        <div>
          <label className="text-sm font-display text-muted-foreground mb-1 block">Depósito por comensal (€)</label>
          <input
            type="number"
            min="0"
            step="0.50"
            value={form.depositPerGuest}
            onChange={e => setForm(f => ({ ...f, depositPerGuest: e.target.value }))}
            className="w-full px-4 py-2.5 rounded-xl border border-border/60 bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
        </div>

        <div>
          <label className="text-sm font-display text-muted-foreground mb-1 block">Tamaño máximo de grupo</label>
          <input
            type="number"
            min="1"
            max="100"
            value={form.maxGroupSize}
            onChange={e => setForm(f => ({ ...f, maxGroupSize: Number(e.target.value) }))}
            className="w-full px-4 py-2.5 rounded-xl border border-border/60 bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
        </div>

        <div>
          <label className="text-sm font-display text-muted-foreground mb-1 block">Política de cancelación</label>
          <textarea
            value={form.cancellationPolicy}
            onChange={e => setForm(f => ({ ...f, cancellationPolicy: e.target.value }))}
            rows={3}
            className="w-full px-4 py-2.5 rounded-xl border border-border/60 bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none"
            placeholder="Cancelación gratuita hasta 24h antes..."
          />
        </div>

        <Button
          onClick={() => updateMutation.mutate({ restaurantId: restaurant.id, ...form })}
          disabled={updateMutation.isPending}
          className="w-full bg-accent hover:bg-accent/90 text-white rounded-full font-display font-semibold"
        >
          {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : saved ? <CheckCircle className="w-4 h-4 mr-2" /> : null}
          {saved ? "¡Guardado!" : "Guardar configuración"}
        </Button>
      </div>
    </div>
  );
}
