import { useState, useMemo } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import {
  ChevronLeft, ChevronRight, Loader2, CreditCard, CheckCircle,
  Phone, Users, UtensilsCrossed, Clock, Filter, Ban,
} from "lucide-react";

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MONTHS = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

const STATUS_COLORS: Record<string, string> = {
  pending:         "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  pending_payment: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  confirmed:       "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  cancelled:       "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  no_show:         "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const STATUS_LABELS: Record<string, string> = {
  pending:         "Pendiente",
  pending_payment: "Pago pendiente",
  confirmed:       "Confirmada",
  cancelled:       "Cancelada",
  no_show:         "No show",
};

// Paleta de colores por restaurante (hasta 8)
const RESTAURANT_COLORS = [
  "bg-blue-500",
  "bg-purple-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-cyan-500",
  "bg-indigo-500",
  "bg-pink-500",
];

function formatYearMonth(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Booking = {
  id: number;
  locator: string;
  restaurantId: number;
  restaurantName: string;
  date: string;
  time: string;
  guests: number;
  guestName: string;
  guestLastName: string | null;
  guestPhone: string | null;
  status: string;
  paymentStatus: string | null;
  depositAmount: string | null;
};

export default function GlobalCalendar() {
  const [calMonth, setCalMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [filterRestaurantId, setFilterRestaurantId] = useState<number | null>(null);

  const yearMonth = formatYearMonth(calMonth);

  const { data, isLoading } = trpc.restaurants.adminGetGlobalCalendar.useQuery({
    yearMonth,
    restaurantId: filterRestaurantId ?? undefined,
  });

  // Mapa de restaurante → color
  const restaurantColorMap = useMemo(() => {
    const map: Record<number, string> = {};
    if (!data) return map;
    data.restaurants.forEach((r, i) => {
      map[r.id] = RESTAURANT_COLORS[i % RESTAURANT_COLORS.length];
    });
    return map;
  }, [data]);

  // Días del mes
  function calDays() {
    const year = calMonth.getFullYear(), month = calMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const cells: (number | null)[] = Array(firstDay).fill(null);
    for (let i = 1; i <= totalDays; i++) cells.push(i);
    return cells;
  }

  function dateKey(day: number) {
    return `${calMonth.getFullYear()}-${String(calMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // Reservas del día seleccionado
  const dayBookings: Booking[] = selectedDate && data?.byDate?.[selectedDate]
    ? (data.byDate[selectedDate] as Booking[])
    : [];

  return (
    <AdminLayout>
      <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-heading font-bold text-foreground">Calendario Global</h1>
            <p className="text-sm text-muted-foreground font-display">Todas las reservas de restaurantes en una vista unificada</p>
          </div>

          {/* Filtro por restaurante */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <select
              value={filterRestaurantId ?? ""}
              onChange={e => {
                setFilterRestaurantId(e.target.value ? Number(e.target.value) : null);
                setSelectedDate(null);
              }}
              className="text-sm font-display border border-border/60 rounded-xl px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50"
            >
              <option value="">Todos los restaurantes</option>
              {data?.restaurants.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Leyenda de restaurantes */}
        {data && data.restaurants.length > 0 && (
          <div className="flex flex-wrap gap-3 mb-6">
            {data.restaurants.map(r => (
              <button
                key={r.id}
                onClick={() => {
                  setFilterRestaurantId(filterRestaurantId === r.id ? null : r.id);
                  setSelectedDate(null);
                }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-display font-semibold transition-all border-2 ${
                  filterRestaurantId === r.id
                    ? "border-accent bg-accent/10 text-accent"
                    : filterRestaurantId === null
                    ? "border-border/40 bg-card text-foreground hover:border-accent/50"
                    : "border-border/20 bg-muted/50 text-muted-foreground"
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full ${restaurantColorMap[r.id]}`} />
                {r.name}
              </button>
            ))}
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Calendario mensual */}
          <div className="lg:col-span-2">
            <div className="bg-card rounded-2xl border border-border/40 p-5">
              {/* Navegación de mes */}
              <div className="flex items-center justify-between mb-5">
                <button
                  onClick={() => { setCalMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1)); setSelectedDate(null); }}
                  className="p-2 rounded-xl hover:bg-muted transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <h2 className="font-heading font-bold text-lg text-foreground">
                  {MONTHS[calMonth.getMonth()]} {calMonth.getFullYear()}
                </h2>
                <button
                  onClick={() => { setCalMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1)); setSelectedDate(null); }}
                  className="p-2 rounded-xl hover:bg-muted transition-colors"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              {/* Cabecera días */}
              <div className="grid grid-cols-7 gap-1 mb-2">
                {DAYS.map(d => (
                  <div key={d} className="text-center text-xs text-muted-foreground font-display py-1 font-semibold">
                    {d}
                  </div>
                ))}
              </div>

              {/* Celdas del calendario */}
              {isLoading ? (
                <div className="flex items-center justify-center h-48">
                  <Loader2 className="w-6 h-6 animate-spin text-accent" />
                </div>
              ) : (
                <div className="grid grid-cols-7 gap-1">
                  {calDays().map((day, i) => {
                    if (day === null) return <div key={`empty-${i}`} />;
                    const dk = dateKey(day);
                    const dayBks: Booking[] = (data?.byDate?.[dk] as Booking[] | undefined) ?? [];
                    const isSelected = selectedDate === dk;
                    const isToday = dk === formatDate(new Date());
                    // Agrupar por restaurante para los puntos de color
                    const restIds = Array.from(new Set(dayBks.map(b => b.restaurantId)));

                    return (
                      <button
                        key={dk}
                        onClick={() => setSelectedDate(isSelected ? null : dk)}
                        className={`relative flex flex-col items-center rounded-xl p-1 min-h-[60px] transition-all border-2 ${
                          isSelected
                            ? "border-accent bg-accent/10"
                            : isToday
                            ? "border-accent/40 bg-accent/5"
                            : "border-transparent hover:border-border/60 hover:bg-muted/50"
                        }`}
                      >
                        <span className={`text-xs font-display font-semibold mb-1 ${
                          isSelected ? "text-accent" : isToday ? "text-accent" : "text-foreground"
                        }`}>
                          {day}
                        </span>
                        {/* Puntos de color por restaurante */}
                        {restIds.length > 0 && (
                          <div className="flex flex-wrap justify-center gap-0.5">
                            {restIds.slice(0, 4).map(rid => (
                              <span
                                key={rid}
                                className={`w-2 h-2 rounded-full ${restaurantColorMap[rid] ?? "bg-gray-400"}`}
                              />
                            ))}
                          </div>
                        )}
                        {/* Contador de reservas */}
                        {dayBks.length > 0 && (
                          <span className={`text-[10px] font-display font-bold mt-0.5 ${
                            isSelected ? "text-accent" : "text-muted-foreground"
                          }`}>
                            {dayBks.length}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Resumen del mes */}
            {data && (
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-card rounded-xl border border-border/40 p-3 text-center">
                  <div className="text-2xl font-heading font-bold text-accent">{data.bookings.length}</div>
                  <div className="text-xs text-muted-foreground font-display">Total reservas</div>
                </div>
                <div className="bg-card rounded-xl border border-border/40 p-3 text-center">
                  <div className="text-2xl font-heading font-bold text-green-600">
                    {data.bookings.filter(b => b.status === "confirmed").length}
                  </div>
                  <div className="text-xs text-muted-foreground font-display">Confirmadas</div>
                </div>
                <div className="bg-card rounded-xl border border-border/40 p-3 text-center">
                  <div className="text-2xl font-heading font-bold text-amber-600">
                    {data.bookings.filter(b => b.status === "pending" || b.status === "pending_payment").length}
                  </div>
                  <div className="text-xs text-muted-foreground font-display">Pendientes</div>
                </div>
                <div className="bg-card rounded-xl border border-border/40 p-3 text-center">
                  <div className="text-2xl font-heading font-bold text-foreground">
                    {data.bookings.reduce((s, b) => s + b.guests, 0)}
                  </div>
                  <div className="text-xs text-muted-foreground font-display">Comensales</div>
                </div>
              </div>
            )}
          </div>

          {/* Panel lateral: timing del día */}
          <div className="bg-card rounded-2xl border border-border/40 p-5 h-fit sticky top-6">
            {selectedDate ? (
              <>
                <div className="flex items-center gap-2 mb-4">
                  <Clock className="w-4 h-4 text-accent" />
                  <h3 className="font-heading font-bold text-foreground">
                    {selectedDate.split("-").reverse().join("/")}
                  </h3>
                  <span className="ml-auto text-xs text-muted-foreground font-display">
                    {dayBookings.length} reserva{dayBookings.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {dayBookings.length === 0 ? (
                  <p className="text-sm text-muted-foreground font-display text-center py-8">
                    No hay reservas este día.
                  </p>
                ) : (
                  <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                    {dayBookings.map(b => (
                      <div
                        key={b.id}
                        className="rounded-xl border border-border/40 bg-background p-3 hover:shadow-sm transition-shadow"
                      >
                        {/* Hora y restaurante */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-heading font-bold text-accent">{b.time}</span>
                            <span className={`w-2 h-2 rounded-full ${restaurantColorMap[b.restaurantId] ?? "bg-gray-400"}`} />
                            <span className="text-xs font-display text-muted-foreground truncate max-w-[100px]">{b.restaurantName}</span>
                          </div>
                          {/* Icono de pago:
                               - pending → naranja (pago pendiente)
                               - paid + depositAmount > 0 → verde (pagado de verdad)
                               - paid + depositAmount = 0 → gris (sin depósito requerido)
                          */}
                          {b.paymentStatus === "pending" ? (
                            <span title="Pago pendiente">
                              <CreditCard className="w-4 h-4 text-orange-500" />
                            </span>
                          ) : b.paymentStatus === "paid" && Number(b.depositAmount) > 0 ? (
                            <span title="Pagado">
                              <CheckCircle className="w-4 h-4 text-green-500" />
                            </span>
                          ) : b.paymentStatus === "paid" && Number(b.depositAmount) === 0 ? (
                            <span title="Sin depósito">
                              <Ban className="w-4 h-4 text-muted-foreground" />
                            </span>
                          ) : null}
                        </div>

                        {/* Nombre del comensal */}
                        <div className="font-display font-semibold text-sm text-foreground">
                          {b.guestName} {b.guestLastName ?? ""}
                        </div>

                        {/* Teléfono y comensales */}
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground font-display">
                          {b.guestPhone && (
                            <a
                              href={`tel:${b.guestPhone}`}
                              className="flex items-center gap-1 hover:text-accent hover:underline transition-colors"
                              title="Llamar al cliente"
                            >
                              <Phone className="w-3 h-3" /> {b.guestPhone}
                            </a>
                          )}
                          <span className="flex items-center gap-1">
                            <Users className="w-3 h-3" /> {b.guests}p.
                          </span>
                        </div>

                        {/* Estado */}
                        <div className="mt-2">
                          <span className={`text-[10px] font-display font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[b.status] ?? STATUS_COLORS.pending}`}>
                            {STATUS_LABELS[b.status] ?? b.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <UtensilsCrossed className="w-10 h-10 text-muted-foreground/40 mb-3" />
                <p className="text-sm font-display text-muted-foreground">
                  Pincha en un día del calendario para ver el timing de reservas.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
