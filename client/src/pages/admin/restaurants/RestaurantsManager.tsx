import { useState, useEffect } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Calendar, List, Settings, Users, ChevronLeft, ChevronRight,
  CheckCircle, XCircle, Clock, Loader2, Phone, Mail, RefreshCw,
  AlertCircle, Edit, Trash2, MessageSquare, Plus, CreditCard, Ban,
} from "lucide-react";

type ViewMode = "list" | "calendar" | "config";
type StatusFilter = "all" | "pending" | "confirmed" | "cancelled" | "no_show";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:         { label: "Pendiente",       color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
  pending_payment: { label: "Pago pendiente",  color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" },
  confirmed:       { label: "Confirmada",      color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
  cancelled:       { label: "Cancelada",       color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
  no_show:         { label: "No show",         color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
};

const DAYS = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function formatDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// ── Modal de nueva reserva ────────────────────────────────────────────────────
function NewBookingModal({
  restaurantId,
  restaurantName,
  depositPerGuest,
  onClose,
  onSuccess,
}: {
  restaurantId: number;
  restaurantName: string;
  depositPerGuest: string | null;
  onClose: () => void;
  onSuccess: (locator: string) => void;
}) {
  const [form, setForm] = useState({
    date: formatDate(new Date()),
    time: "14:00",
    guests: 2,
    guestName: "",
    guestLastName: "",
    guestEmail: "",
    guestPhone: "",
    allergies: "",
    specialRequests: "",
    highchair: false,
    birthday: false,
    accessibility: false,
    isVip: false,
    requiresPayment: false,
  });
  const [shiftId, setShiftId] = useState<number | null>(null);

  const { data: shifts } = trpc.restaurants.adminGetShifts.useQuery({ restaurantId });
  const utils = trpc.useUtils();

  // Calcular depósito estimado
  const depositPerPax = Number(depositPerGuest ?? 0);
  const estimatedDeposit = (depositPerPax * form.guests).toFixed(2);

  const createMutation = trpc.restaurants.adminCreateBooking.useMutation({
    onSuccess: (data) => {
      utils.restaurants.adminGetBookings.invalidate();
      utils.restaurants.adminGetCalendar.invalidate();
      onSuccess(data.locator);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!shiftId) return;
    createMutation.mutate({
      restaurantId,
      shiftId,
      ...form,
      origin: window.location.origin,
    });
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-card rounded-2xl border border-border/40 p-6 w-full max-w-lg shadow-2xl my-4">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-heading font-bold text-foreground text-lg">Nueva reserva</h3>
            <p className="text-sm text-muted-foreground font-display">{restaurantName}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-muted transition-colors">
            <XCircle className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Fecha, hora y turno */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-display text-muted-foreground mb-1 block">Fecha *</label>
              <input
                type="date"
                required
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-border/60 bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>
            <div>
              <label className="text-xs font-display text-muted-foreground mb-1 block">Hora *</label>
              <input
                type="time"
                required
                value={form.time}
                onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-border/60 bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-display text-muted-foreground mb-1 block">Turno *</label>
              <select
                required
                value={shiftId ?? ""}
                onChange={e => setShiftId(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl border border-border/60 bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50"
              >
                <option value="">Seleccionar turno</option>
                {shifts?.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.startTime}–{s.endTime})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-display text-muted-foreground mb-1 block">Comensales *</label>
              <input
                type="number"
                min={1}
                max={100}
                required
                value={form.guests}
                onChange={e => setForm(f => ({ ...f, guests: Number(e.target.value) }))}
                className="w-full px-3 py-2 rounded-xl border border-border/60 bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>
          </div>

          {/* Datos del cliente */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-display text-muted-foreground mb-1 block">Nombre *</label>
              <input
                type="text"
                required
                value={form.guestName}
                onChange={e => setForm(f => ({ ...f, guestName: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-border/60 bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50"
                placeholder="Nombre"
              />
            </div>
            <div>
              <label className="text-xs font-display text-muted-foreground mb-1 block">Apellidos</label>
              <input
                type="text"
                value={form.guestLastName}
                onChange={e => setForm(f => ({ ...f, guestLastName: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-border/60 bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50"
                placeholder="Apellidos"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-display text-muted-foreground mb-1 block">Email *</label>
              <input
                type="email"
                required
                value={form.guestEmail}
                onChange={e => setForm(f => ({ ...f, guestEmail: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-border/60 bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50"
                placeholder="cliente@email.com"
              />
            </div>
            <div>
              <label className="text-xs font-display text-muted-foreground mb-1 block">Teléfono</label>
              <input
                type="tel"
                value={form.guestPhone}
                onChange={e => setForm(f => ({ ...f, guestPhone: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-border/60 bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50"
                placeholder="+34 600 000 000"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-display text-muted-foreground mb-1 block">Alergias / intolerancias</label>
            <input
              type="text"
              value={form.allergies}
              onChange={e => setForm(f => ({ ...f, allergies: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl border border-border/60 bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50"
              placeholder="Gluten, lactosa..."
            />
          </div>

          <div>
            <label className="text-xs font-display text-muted-foreground mb-1 block">Peticiones especiales</label>
            <textarea
              value={form.specialRequests}
              onChange={e => setForm(f => ({ ...f, specialRequests: e.target.value }))}
              rows={2}
              className="w-full px-3 py-2 rounded-xl border border-border/60 bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none"
              placeholder="Mesa junto a la ventana, decoración cumpleaños..."
            />
          </div>

          {/* Opciones extra */}
          <div className="flex flex-wrap gap-3">
            {[
              { key: "highchair", label: "Trona" },
              { key: "birthday", label: "Cumpleaños" },
              { key: "accessibility", label: "Accesibilidad" },
              { key: "isVip", label: "VIP" },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={(form as any)[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))}
                  className="w-4 h-4 rounded accent-accent"
                />
                <span className="text-sm font-display text-foreground">{label}</span>
              </label>
            ))}
          </div>

          {/* Selector de pago */}
          {depositPerPax > 0 && (
            <div className={`rounded-xl border-2 p-4 transition-all ${form.requiresPayment ? "border-orange-400 bg-orange-50 dark:bg-orange-900/20" : "border-border/40 bg-muted/30"}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <CreditCard className={`w-4 h-4 ${form.requiresPayment ? "text-orange-600" : "text-muted-foreground"}`} />
                  <span className={`font-display font-semibold text-sm ${form.requiresPayment ? "text-orange-700 dark:text-orange-300" : "text-foreground"}`}>
                    Cobrar depósito
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, requiresPayment: !f.requiresPayment }))}
                  className={`w-12 h-6 rounded-full transition-colors ${form.requiresPayment ? "bg-orange-500" : "bg-muted-foreground/30"}`}
                >
                  <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform mx-0.5 ${form.requiresPayment ? "translate-x-6" : "translate-x-0"}`} />
                </button>
              </div>
              {form.requiresPayment ? (
                <div className="text-sm font-display text-orange-700 dark:text-orange-300">
                  <p>Se enviará un email a <strong>{form.guestEmail || "el cliente"}</strong> con un enlace de pago seguro (Redsys).</p>
                  <p className="mt-1 font-semibold">Importe: {estimatedDeposit} € ({form.guests} × {depositPerPax} €)</p>
                </div>
              ) : (
                <p className="text-xs font-display text-muted-foreground">
                  La reserva se confirmará directamente sin cobrar depósito. Depósito estándar: {depositPerPax} €/comensal.
                </p>
              )}
            </div>
          )}

          {depositPerPax === 0 && (
            <div className="rounded-xl border border-border/40 bg-muted/30 p-3 flex items-center gap-2">
              <Ban className="w-4 h-4 text-muted-foreground" />
              <p className="text-xs font-display text-muted-foreground">Este restaurante no tiene depósito configurado. La reserva se confirmará directamente.</p>
            </div>
          )}

          {createMutation.isError && (
            <p className="text-sm text-red-600 font-display">{createMutation.error.message}</p>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-full font-display">Cancelar</Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || !shiftId}
              className={`rounded-full font-display font-semibold ${form.requiresPayment ? "bg-orange-500 hover:bg-orange-600 text-white" : "bg-accent hover:bg-accent/90 text-white"}`}
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {form.requiresPayment ? "Crear y enviar link de pago" : "Crear reserva confirmada"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function RestaurantsManager() {
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [calMonth, setCalMonth] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const [selectedDate, setSelectedDate] = useState<string>(formatDate(new Date()));
  const [editingBooking, setEditingBooking] = useState<number | null>(null);
  const [noteText, setNoteText] = useState("");
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showNewBooking, setShowNewBooking] = useState(false);
  const [successLocator, setSuccessLocator] = useState<string | null>(null);

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
          <div className="flex items-center gap-2 flex-wrap">
            {/* Botón nueva reserva */}
            <Button
              onClick={() => setShowNewBooking(true)}
              className="bg-accent hover:bg-accent/90 text-white rounded-full font-display font-semibold flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> Nueva reserva
            </Button>
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

        {/* Banner de éxito tras crear reserva */}
        {successLocator && (
          <div className="mb-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-2xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <div>
                <p className="font-display font-semibold text-green-800 dark:text-green-300">Reserva creada correctamente</p>
                <p className="text-sm text-green-700 dark:text-green-400">Localizador: <strong className="font-mono">{successLocator}</strong></p>
              </div>
            </div>
            <button onClick={() => setSuccessLocator(null)} className="text-green-600 hover:text-green-800 p-1">
              <XCircle className="w-4 h-4" />
            </button>
          </div>
        )}

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
                <Button
                  onClick={() => setShowNewBooking(true)}
                  className="mt-4 bg-accent hover:bg-accent/90 text-white rounded-full font-display font-semibold"
                >
                  <Plus className="w-4 h-4 mr-2" /> Crear primera reserva
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {bookings.map(b => (
                  <div key={b.id} className="bg-card border border-border/40 rounded-2xl p-4 hover:shadow-sm transition-shadow">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                          <span className="font-heading font-bold text-foreground">{b.guestName} {b.guestLastName ?? ""}</span>
                          <span className={`text-xs font-display font-semibold px-2.5 py-0.5 rounded-full ${STATUS_LABELS[b.status]?.color ?? STATUS_LABELS.pending.color}`}>
                            {STATUS_LABELS[b.status]?.label ?? b.status}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">#{b.locator}</span>
                          {/* Icono de pago — badge visual prominente */}
                          {b.paymentStatus === "paid" ? (
                            <span className="inline-flex items-center gap-1 text-xs font-display font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-700">
                              <CheckCircle className="w-3 h-3" /> Pagado
                            </span>
                          ) : Number(b.depositAmount) > 0 ? (
                            <span className="inline-flex items-center gap-1 text-xs font-display font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border border-orange-200 dark:border-orange-700">
                              <CreditCard className="w-3 h-3" /> Sin pagar
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-display font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/40">
                              <Ban className="w-3 h-3" /> Sin depósito
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground font-display">
                          <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{b.date} · {b.time}</span>
                          <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{b.guests} comensales</span>
                          {b.guestEmail && <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" />{b.guestEmail}</span>}
                          {b.guestPhone && (
                            <a
                              href={`tel:${b.guestPhone}`}
                              className="flex items-center gap-1 hover:text-accent hover:underline transition-colors"
                              title="Llamar al cliente"
                            >
                              <Phone className="w-3.5 h-3.5" />{b.guestPhone}
                            </a>
                          )}
                          {b.depositAmount && Number(b.depositAmount) > 0 && (
                            <span className="flex items-center gap-1 text-accent font-semibold">
                              <CreditCard className="w-3.5 h-3.5" /> {b.depositAmount} €
                            </span>
                          )}
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
                        {/* Toggle Show / No-show — check manual prominente */}
                        {(b.status === "confirmed" || b.status === "no_show") && (
                          <button
                            onClick={() => updateStatusMutation.mutate({
                              id: b.id,
                              status: b.status === "no_show" ? "confirmed" : "no_show",
                            })}
                            title={b.status === "no_show" ? "Marcar como Show (asistió)" : "Marcar como No-show (no asistió)"}
                            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-display font-bold transition-all border-2 select-none ${
                              b.status === "no_show"
                                ? "bg-gray-800 dark:bg-gray-700 border-gray-700 text-white"
                                : "bg-white dark:bg-card border-gray-200 dark:border-border/60 text-gray-500 hover:border-gray-400 hover:text-gray-700"
                            }`}
                          >
                            <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border-2 transition-colors ${
                              b.status === "no_show"
                                ? "bg-gray-600 border-gray-500"
                                : "bg-green-500 border-green-400"
                            }`}>
                              {b.status === "no_show"
                                ? <XCircle className="w-2.5 h-2.5 text-white" />
                                : <CheckCircle className="w-2.5 h-2.5 text-white" />}
                            </span>
                            {b.status === "no_show" ? "No-show" : "Show"}
                          </button>
                        )}
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
                          <button
                            onClick={() => updateStatusMutation.mutate({ id: b.id, status: "cancelled" })}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-xs font-display font-semibold transition-colors"
                          >
                            <XCircle className="w-3.5 h-3.5" /> Cancelar
                          </button>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => { setEditingBooking(b.id); setNoteText(b.adminNotes ?? ""); setShowNoteModal(true); }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg text-xs font-display font-semibold transition-colors"
                          >
                            <Edit className="w-3.5 h-3.5" /> Nota
                          </button>
                          <button
                            onClick={() => { if (confirm("¿Eliminar esta reserva?")) deleteBookingMutation.mutate({ bookingId: b.id as number }); }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-500 rounded-lg text-xs font-display font-semibold transition-colors"
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
                      <div className="flex items-center gap-2 shrink-0">
                        {b.paymentStatus === "pending" && <span title="Pago pendiente"><CreditCard className="w-4 h-4 text-orange-500" /></span>}
                        {b.paymentStatus === "paid" && <span title="Pagado"><CheckCircle className="w-4 h-4 text-green-500" /></span>}
                        <span className={`text-xs font-display font-semibold px-2 py-0.5 rounded-full ${STATUS_LABELS[b.status]?.color ?? STATUS_LABELS.pending.color}`}>
                          {STATUS_LABELS[b.status]?.label ?? b.status}
                        </span>
                      </div>
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

        {/* Modal de nueva reserva */}
        {showNewBooking && selectedRestaurant && (
          <NewBookingModal
            restaurantId={selectedRestaurant.id}
            restaurantName={selectedRestaurant.name}
            depositPerGuest={selectedRestaurant.depositPerGuest}
            onClose={() => setShowNewBooking(false)}
            onSuccess={(locator) => {
              setShowNewBooking(false);
              setSuccessLocator(locator);
              setTimeout(() => setSuccessLocator(null), 8000);
            }}
          />
        )}
      </div>
    </AdminLayout>
  );
}

// \u2500\u2500 Subcomponente de configuraci\u00f3n \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const DAYS_ES = ["Dom", "Lun", "Mar", "Mi\u00e9", "Jue", "Vie", "S\u00e1b"];

type ShiftFormState = {
  name: string; startTime: string; endTime: string;
  maxCapacity: number; daysOfWeek: number[]; isActive: boolean;
};
const EMPTY_SHIFT: ShiftFormState = {
  name: "", startTime: "13:00", endTime: "16:00",
  maxCapacity: 60, daysOfWeek: [0,1,2,3,4,5,6], isActive: true,
};

function ShiftFormRow({ initial, onSave, onCancel, isSaving }: {
  initial: ShiftFormState;
  onSave: (data: ShiftFormState) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<ShiftFormState>(initial);
  const toggleDay = (d: number) => setForm(f => ({
    ...f,
    daysOfWeek: f.daysOfWeek.includes(d) ? f.daysOfWeek.filter(x => x !== d) : [...f.daysOfWeek, d].sort(),
  }));
  return (
    <div className="bg-muted/30 rounded-xl p-4 space-y-3 border border-border/40">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-display text-muted-foreground mb-1 block">Nombre del turno *</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Comida, Cena, Brunch..."
            className="w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50" />
        </div>
        <div>
          <label className="text-xs font-display text-muted-foreground mb-1 block">Aforo m\u00e1ximo *</label>
          <input type="number" min="1" max="500" value={form.maxCapacity}
            onChange={e => setForm(f => ({ ...f, maxCapacity: Number(e.target.value) }))}
            className="w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50" />
        </div>
        <div>
          <label className="text-xs font-display text-muted-foreground mb-1 block">Hora inicio</label>
          <input type="time" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50" />
        </div>
        <div>
          <label className="text-xs font-display text-muted-foreground mb-1 block">Hora fin</label>
          <input type="time" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50" />
        </div>
      </div>
      <div>
        <label className="text-xs font-display text-muted-foreground mb-2 block">D\u00edas activos</label>
        <div className="flex gap-1.5 flex-wrap">
          {DAYS_ES.map((d, i) => (
            <button key={i} type="button" onClick={() => toggleDay(i)}
              className={`px-2.5 py-1 rounded-lg text-xs font-display font-semibold transition-colors ${
                form.daysOfWeek.includes(i) ? "bg-accent text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}>{d}</button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setForm(f => ({ ...f, isActive: !f.isActive }))}
          className={`w-10 h-5 rounded-full transition-colors ${form.isActive ? "bg-accent" : "bg-muted-foreground/30"}`}>
          <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform mx-0.5 ${form.isActive ? "translate-x-5" : "translate-x-0"}`} />
        </button>
        <span className="text-xs font-display text-muted-foreground">{form.isActive ? "Turno activo" : "Turno inactivo"}</span>
      </div>
      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={() => onSave(form)} disabled={isSaving || !form.name.trim()}
          className="bg-accent hover:bg-accent/90 text-white rounded-full font-display text-xs">
          {isSaving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <CheckCircle className="w-3 h-3 mr-1" />}
          Guardar
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} className="rounded-full font-display text-xs">Cancelar</Button>
      </div>
    </div>
  );
}

function RestaurantConfig({ restaurant }: { restaurant: { id: number; name: string; acceptsOnlineBooking: boolean; depositPerGuest: string | null; maxGroupSize: number | null; cancellationPolicy: string | null } }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    acceptsOnlineBooking: restaurant.acceptsOnlineBooking,
    depositPerGuest: restaurant.depositPerGuest ?? "5.00",
    maxGroupSize: restaurant.maxGroupSize ?? 20,
    cancellationPolicy: restaurant.cancellationPolicy ?? "",
  });
  const [saved, setSaved] = useState(false);
  const [showNewShift, setShowNewShift] = useState(false);
  const [editingShiftId, setEditingShiftId] = useState<number | null>(null);

  const updateMutation = trpc.restaurants.adminUpdateConfig.useMutation({
    onSuccess: () => { utils.restaurants.adminGetAll.invalidate(); setSaved(true); setTimeout(() => setSaved(false), 2000); },
  });
  const { data: shifts, isLoading: shiftsLoading } = trpc.restaurants.adminGetShifts.useQuery({ restaurantId: restaurant.id });
  const createShiftMutation = trpc.restaurants.adminCreateShift.useMutation({
    onSuccess: () => { utils.restaurants.adminGetShifts.invalidate(); setShowNewShift(false); },
  });
  const updateShiftMutation = trpc.restaurants.adminUpdateShift.useMutation({
    onSuccess: () => { utils.restaurants.adminGetShifts.invalidate(); setEditingShiftId(null); },
  });
  const deleteShiftMutation = trpc.restaurants.adminDeleteShift.useMutation({
    onSuccess: () => utils.restaurants.adminGetShifts.invalidate(),
  });

  return (
    <div className="max-w-2xl space-y-6">
      {/* Configuraci\u00f3n general */}
      <div className="bg-card rounded-2xl border border-border/40 p-6 space-y-5">
        <h3 className="font-heading font-bold text-foreground">Configuraci\u00f3n de {restaurant.name}</h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-display font-semibold text-foreground text-sm">Reservas online activas</p>
            <p className="text-xs text-muted-foreground font-display">Los clientes podr\u00e1n reservar desde la web</p>
          </div>
          <button onClick={() => setForm(f => ({ ...f, acceptsOnlineBooking: !f.acceptsOnlineBooking }))}
            className={`w-12 h-6 rounded-full transition-colors ${form.acceptsOnlineBooking ? "bg-accent" : "bg-muted-foreground/30"}`}>
            <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform mx-0.5 ${form.acceptsOnlineBooking ? "translate-x-6" : "translate-x-0"}`} />
          </button>
        </div>
        <div>
          <label className="text-sm font-display text-muted-foreground mb-1 block">Dep\u00f3sito por comensal (\u20ac)</label>
          <input type="number" min="0" step="0.50" value={form.depositPerGuest}
            onChange={e => setForm(f => ({ ...f, depositPerGuest: e.target.value }))}
            className="w-full px-4 py-2.5 rounded-xl border border-border/60 bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50" />
        </div>
        <div>
          <label className="text-sm font-display text-muted-foreground mb-1 block">Tama\u00f1o m\u00e1ximo de grupo</label>
          <input type="number" min="1" max="100" value={form.maxGroupSize}
            onChange={e => setForm(f => ({ ...f, maxGroupSize: Number(e.target.value) }))}
            className="w-full px-4 py-2.5 rounded-xl border border-border/60 bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50" />
        </div>
        <div>
          <label className="text-sm font-display text-muted-foreground mb-1 block">Pol\u00edtica de cancelaci\u00f3n</label>
          <textarea value={form.cancellationPolicy} onChange={e => setForm(f => ({ ...f, cancellationPolicy: e.target.value }))}
            rows={3} className="w-full px-4 py-2.5 rounded-xl border border-border/60 bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none"
            placeholder="Cancelaci\u00f3n gratuita hasta 24h antes..." />
        </div>
        <Button onClick={() => updateMutation.mutate({ restaurantId: restaurant.id, ...form })} disabled={updateMutation.isPending}
          className="w-full bg-accent hover:bg-accent/90 text-white rounded-full font-display font-semibold">
          {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : saved ? <CheckCircle className="w-4 h-4 mr-2" /> : null}
          {saved ? "\u00a1Guardado!" : "Guardar configuraci\u00f3n"}
        </Button>
      </div>

      {/* Gesti\u00f3n de turnos */}
      <div className="bg-card rounded-2xl border border-border/40 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-heading font-bold text-foreground">Turnos de servicio</h3>
            <p className="text-xs text-muted-foreground font-display mt-0.5">Gestiona los turnos disponibles para reservar</p>
          </div>
          <Button size="sm" onClick={() => { setShowNewShift(true); setEditingShiftId(null); }}
            className="bg-accent hover:bg-accent/90 text-white rounded-full font-display text-xs">
            <Plus className="w-3.5 h-3.5 mr-1" /> Nuevo turno
          </Button>
        </div>

        {showNewShift && (
          <ShiftFormRow initial={EMPTY_SHIFT}
            onSave={(data) => createShiftMutation.mutate({ restaurantId: restaurant.id, ...data })}
            onCancel={() => setShowNewShift(false)}
            isSaving={createShiftMutation.isPending} />
        )}

        {shiftsLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : shifts && shifts.length > 0 ? (
          <div className="space-y-2">
            {shifts.map(shift => (
              <div key={shift.id}>
                {editingShiftId === shift.id ? (
                  <ShiftFormRow
                    initial={{
                      name: shift.name, startTime: shift.startTime, endTime: shift.endTime,
                      maxCapacity: shift.maxCapacity,
                      daysOfWeek: (shift.daysOfWeek as number[]) ?? [0,1,2,3,4,5,6],
                      isActive: shift.isActive,
                    }}
                    onSave={(data) => updateShiftMutation.mutate({ id: shift.id, restaurantId: restaurant.id, ...data })}
                    onCancel={() => setEditingShiftId(null)}
                    isSaving={updateShiftMutation.isPending} />
                ) : (
                  <div className={`flex items-center justify-between p-3 rounded-xl border transition-colors ${
                    shift.isActive ? "border-border/40 bg-muted/20" : "border-border/20 bg-muted/10 opacity-60"
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${shift.isActive ? "bg-green-500" : "bg-gray-400"}`} />
                      <div>
                        <p className="font-display font-semibold text-foreground text-sm">{shift.name}</p>
                        <p className="text-xs text-muted-foreground font-display">
                          {shift.startTime} \u2013 {shift.endTime} \u00b7 {shift.maxCapacity} pax \u00b7{" "}
                          {((shift.daysOfWeek as number[]) ?? []).map((d: number) => DAYS_ES[d]).join(", ")}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => setEditingShiftId(shift.id)}
                        className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => {
                          if (confirm(`\u00bfEliminar el turno "${shift.name}"? Esta acci\u00f3n no se puede deshacer.`)) {
                            deleteShiftMutation.mutate({ id: shift.id, restaurantId: restaurant.id });
                          }
                        }}
                        className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-muted-foreground hover:text-red-600">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm font-display">No hay turnos configurados</p>
            <p className="text-xs font-display mt-1">Crea el primer turno para que los clientes puedan reservar</p>
          </div>
        )}
      </div>
    </div>
  );
}