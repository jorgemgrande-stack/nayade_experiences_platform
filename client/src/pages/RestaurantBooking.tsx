import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import PublicLayout from "@/components/PublicLayout";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  Calendar, Clock, Users, ChevronLeft, ChevronRight,
  User, Mail, Phone, Baby, AlertCircle, Cake, Accessibility,
  CheckCircle, Loader2, ArrowLeft,
} from "lucide-react";

// ── Helpers ──────────────────────────────────────────────────────────────────
const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function formatDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function parseDate(s: string) {
  const [y,m,d] = s.split("-").map(Number);
  return new Date(y, m-1, d);
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function RestaurantBooking() {
  const { slug } = useParams<{ slug: string }>();
  const [, navigate] = useLocation();

  // Datos del restaurante
  const { data: restaurant, isLoading: loadingRest } = trpc.restaurants.getBySlug.useQuery(
    { slug: slug ?? "" },
    { enabled: !!slug }
  );

  // Estado del wizard
  const [step, setStep] = useState<1|2|3>(1);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedShift, setSelectedShift] = useState<number|null>(null);
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [guests, setGuests] = useState(2);
  const [calMonth, setCalMonth] = useState(() => { const n=new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });

  // Formulario de datos
  const [form, setForm] = useState({
    guestName: "", guestLastName: "", guestEmail: "", guestPhone: "",
    highchair: false, allergies: "", birthday: false, specialRequests: "", accessibility: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [locator, setLocator] = useState<string>("");
  const [depositAmount, setDepositAmount] = useState<string>("0");

  // Disponibilidad
  const { data: availability, isLoading: loadingAvail } = trpc.restaurants.getAvailability.useQuery(
    { restaurantId: restaurant?.id ?? 0, date: selectedDate },
    { enabled: !!restaurant?.id && !!selectedDate }
  );

  const createBookingMutation = trpc.restaurants.createBooking.useMutation({
    onSuccess: (data) => {
      setLocator(data.locator);
      setDepositAmount(data.depositAmount);
      setStep(3);
    },
    onError: (err) => {
      setErrors({ submit: err.message });
    },
  });

  // Calendario
  const today = new Date(); today.setHours(0,0,0,0);
  const maxDate = new Date(today); maxDate.setMonth(maxDate.getMonth()+3);

  function calDays() {
    const year = calMonth.getFullYear(), month = calMonth.getMonth();
    const first = new Date(year, month, 1).getDay();
    const total = new Date(year, month+1, 0).getDate();
    const cells: (number|null)[] = Array(first).fill(null);
    for (let i=1; i<=total; i++) cells.push(i);
    return cells;
  }

  function selectDay(day: number) {
    const d = new Date(calMonth.getFullYear(), calMonth.getMonth(), day);
    if (d < today || d > maxDate) return;
    setSelectedDate(formatDate(d));
    setSelectedShift(null);
    setSelectedTime("");
  }

  function isDayDisabled(day: number) {
    const d = new Date(calMonth.getFullYear(), calMonth.getMonth(), day);
    return d < today || d > maxDate;
  }

  function isDaySelected(day: number) {
    if (!selectedDate) return false;
    const d = new Date(calMonth.getFullYear(), calMonth.getMonth(), day);
    return formatDate(d) === selectedDate;
  }

  // Validación del formulario
  function validate() {
    const e: Record<string, string> = {};
    if (!form.guestName.trim()) e.guestName = "El nombre es obligatorio";
    if (!form.guestEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.guestEmail)) {
      e.guestEmail = "Email inválido";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    if (!restaurant || !selectedShift || !selectedDate || !selectedTime) return;
    createBookingMutation.mutate({
      restaurantId: restaurant.id,
      shiftId: selectedShift,
      date: selectedDate,
      time: selectedTime,
      guests,
      ...form,
    });
  }

  if (loadingRest) return (
    <PublicLayout>
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    </PublicLayout>
  );

  if (!restaurant) return (
    <PublicLayout>
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Restaurante no encontrado.
      </div>
    </PublicLayout>
  );

  if (!restaurant.acceptsOnlineBooking) return (
    <PublicLayout>
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center px-4">
        <AlertCircle className="w-12 h-12 text-amber-500" />
        <h2 className="text-2xl font-heading font-bold">Reservas no disponibles online</h2>
        <p className="text-muted-foreground max-w-md">
          Este restaurante no acepta reservas online. Por favor, llámanos al{" "}
          <a href="tel:+34930347791" className="text-accent font-semibold">+34 930 34 77 91</a>.
        </p>
        <Button variant="outline" onClick={() => navigate(`/restaurantes/${slug}`)}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Volver al restaurante
        </Button>
      </div>
    </PublicLayout>
  );

  // ── STEP 3: Confirmación ──────────────────────────────────────────────────
  if (step === 3) return (
    <PublicLayout>
      <div className="min-h-screen bg-background flex items-center justify-center px-4 py-16">
        <div className="max-w-md w-full bg-card rounded-3xl shadow-xl border border-border/40 p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-2xl font-heading font-bold text-foreground mb-2">¡Reserva recibida!</h2>
          <p className="text-muted-foreground font-display mb-6">
            Hemos recibido tu solicitud. Te confirmaremos por email en breve.
          </p>
          <div className="bg-muted/50 rounded-2xl p-4 mb-6 text-left space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Localizador</span>
              <span className="font-mono font-bold text-accent">{locator}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Restaurante</span>
              <span className="font-semibold">{restaurant.name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Fecha</span>
              <span className="font-semibold">{selectedDate}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Hora</span>
              <span className="font-semibold">{selectedTime}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Comensales</span>
              <span className="font-semibold">{guests}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Depósito</span>
              <span className="font-semibold text-accent">{depositAmount} €</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mb-6">
            Guarda el localizador <strong>{locator}</strong> para gestionar tu reserva.
            El depósito se descontará de tu consumición el día de la visita.
          </p>
          <Button className="w-full bg-accent hover:bg-accent/90 text-white rounded-full" onClick={() => navigate("/restaurantes")}>
            Volver a restaurantes
          </Button>
        </div>
      </div>
    </PublicLayout>
  );

  return (
    <PublicLayout>
      <div className="min-h-screen bg-background">
        {/* Hero mini */}
        <div className="relative h-40 overflow-hidden">
          {restaurant.heroImage && (
            <img src={restaurant.heroImage} alt={restaurant.name} className="w-full h-full object-cover" />
          )}
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <div className="text-center text-white">
              <p className="text-sm font-display text-white/70 mb-1">Reservar mesa en</p>
              <h1 className="text-2xl font-heading font-bold">{restaurant.name}</h1>
            </div>
          </div>
        </div>

        {/* Progress */}
        <div className="bg-card border-b border-border/40 py-3">
          <div className="max-w-3xl mx-auto px-4 flex items-center gap-3">
            {[
              { n: 1, label: "Fecha y turno" },
              { n: 2, label: "Tus datos" },
              { n: 3, label: "Confirmación" },
            ].map(({ n, label }) => (
              <div key={n} className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  step >= n ? "bg-accent text-white" : "bg-muted text-muted-foreground"
                }`}>{n}</div>
                <span className={`text-sm font-display hidden sm:block ${step >= n ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
                {n < 3 && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
              </div>
            ))}
          </div>
        </div>

        <div className="max-w-3xl mx-auto px-4 py-8">

          {/* ── STEP 1: Fecha y turno ── */}
          {step === 1 && (
            <div className="space-y-6">
              {/* Selector de comensales */}
              <div className="bg-card rounded-2xl border border-border/40 p-5">
                <h3 className="font-heading font-bold text-foreground mb-4 flex items-center gap-2">
                  <Users className="w-5 h-5 text-accent" /> Número de comensales
                </h3>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setGuests(g => Math.max(1, g-1))}
                    className="w-10 h-10 rounded-full border border-border/60 flex items-center justify-center hover:bg-muted transition-colors text-lg font-bold"
                  >−</button>
                  <span className="text-2xl font-heading font-bold w-8 text-center">{guests}</span>
                  <button
                    onClick={() => setGuests(g => Math.min(restaurant.maxGroupSize ?? 20, g+1))}
                    className="w-10 h-10 rounded-full border border-border/60 flex items-center justify-center hover:bg-muted transition-colors text-lg font-bold"
                  >+</button>
                  <span className="text-sm text-muted-foreground font-display ml-2">
                    Máx. {restaurant.maxGroupSize ?? 20} personas
                  </span>
                </div>
              </div>

              {/* Calendario */}
              <div className="bg-card rounded-2xl border border-border/40 p-5">
                <h3 className="font-heading font-bold text-foreground mb-4 flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-accent" /> Selecciona la fecha
                </h3>
                <div className="flex items-center justify-between mb-4">
                  <button
                    onClick={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth()-1, 1))}
                    className="p-1 rounded-lg hover:bg-muted transition-colors"
                    disabled={calMonth <= new Date(today.getFullYear(), today.getMonth(), 1)}
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <span className="font-heading font-bold">
                    {MONTHS[calMonth.getMonth()]} {calMonth.getFullYear()}
                  </span>
                  <button
                    onClick={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth()+1, 1))}
                    className="p-1 rounded-lg hover:bg-muted transition-colors"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-1 mb-2">
                  {DAYS.map(d => (
                    <div key={d} className="text-center text-xs text-muted-foreground font-display py-1">{d}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {calDays().map((day, i) => (
                    <div key={i}>
                      {day === null ? <div /> : (
                        <button
                          onClick={() => selectDay(day)}
                          disabled={isDayDisabled(day)}
                          className={`w-full aspect-square rounded-xl text-sm font-display transition-colors ${
                            isDaySelected(day)
                              ? "bg-accent text-white font-bold"
                              : isDayDisabled(day)
                              ? "text-muted-foreground/40 cursor-not-allowed"
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

              {/* Turnos disponibles */}
              {selectedDate && (
                <div className="bg-card rounded-2xl border border-border/40 p-5">
                  <h3 className="font-heading font-bold text-foreground mb-4 flex items-center gap-2">
                    <Clock className="w-5 h-5 text-accent" /> Turnos disponibles — {selectedDate}
                  </h3>
                  {loadingAvail ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" /> Comprobando disponibilidad...
                    </div>
                  ) : !availability || availability.length === 0 ? (
                    <p className="text-muted-foreground font-display text-sm">
                      No hay turnos disponibles para esta fecha.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {availability.map(shift => {
                        const available = shift.available >= guests;
                        const isSelected = selectedShift === shift.shiftId;
                        return (
                          <button
                            key={shift.shiftId}
                            disabled={!available}
                            onClick={() => {
                              setSelectedShift(shift.shiftId);
                              setSelectedTime(shift.startTime);
                            }}
                            className={`p-4 rounded-xl border text-left transition-all ${
                              isSelected
                                ? "border-accent bg-accent/10"
                                : available
                                ? "border-border/60 hover:border-accent/50 hover:bg-muted/50"
                                : "border-border/30 opacity-50 cursor-not-allowed"
                            }`}
                          >
                            <div className="font-heading font-bold text-foreground">{shift.shiftName}</div>
                            <div className="text-sm text-muted-foreground font-display mt-1">
                              {shift.startTime} – {shift.endTime}
                            </div>
                            <div className={`text-xs mt-2 font-display font-semibold ${
                              available ? "text-green-600" : "text-red-500"
                            }`}>
                              {available ? `${shift.available} plazas disponibles` : "Sin plazas suficientes"}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Depósito info */}
              {restaurant.depositPerGuest && Number(restaurant.depositPerGuest) > 0 && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-2xl p-4 flex gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-sm font-display">
                    <p className="font-semibold text-amber-800 dark:text-amber-300">Depósito de reserva</p>
                    <p className="text-amber-700 dark:text-amber-400 mt-0.5">
                      Se requiere un depósito de <strong>{restaurant.depositPerGuest} €/comensal</strong> para confirmar la reserva.
                      El importe se descuenta de tu consumición el día de la visita.
                    </p>
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  onClick={() => setStep(2)}
                  disabled={!selectedDate || !selectedShift}
                  className="bg-accent hover:bg-accent/90 text-white rounded-full px-8 py-3 font-display font-semibold"
                >
                  Continuar <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* ── STEP 2: Datos del cliente ── */}
          {step === 2 && (
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Resumen */}
              <div className="bg-accent/10 border border-accent/30 rounded-2xl p-4 flex flex-wrap gap-4 text-sm font-display">
                <span className="flex items-center gap-1.5"><Calendar className="w-4 h-4 text-accent" />{selectedDate}</span>
                <span className="flex items-center gap-1.5"><Clock className="w-4 h-4 text-accent" />{selectedTime}</span>
                <span className="flex items-center gap-1.5"><Users className="w-4 h-4 text-accent" />{guests} comensales</span>
                {restaurant.depositPerGuest && Number(restaurant.depositPerGuest) > 0 && (
                  <span className="flex items-center gap-1.5 font-semibold text-accent">
                    Depósito: {(Number(restaurant.depositPerGuest) * guests).toFixed(2)} €
                  </span>
                )}
              </div>

              {/* Datos personales */}
              <div className="bg-card rounded-2xl border border-border/40 p-5 space-y-4">
                <h3 className="font-heading font-bold text-foreground flex items-center gap-2">
                  <User className="w-5 h-5 text-accent" /> Tus datos
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-display text-muted-foreground mb-1 block">Nombre *</label>
                    <input
                      type="text"
                      value={form.guestName}
                      onChange={e => setForm(f => ({ ...f, guestName: e.target.value }))}
                      className={`w-full px-4 py-2.5 rounded-xl border bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50 ${errors.guestName ? "border-red-500" : "border-border/60"}`}
                      placeholder="Tu nombre"
                    />
                    {errors.guestName && <p className="text-red-500 text-xs mt-1">{errors.guestName}</p>}
                  </div>
                  <div>
                    <label className="text-sm font-display text-muted-foreground mb-1 block">Apellidos</label>
                    <input
                      type="text"
                      value={form.guestLastName}
                      onChange={e => setForm(f => ({ ...f, guestLastName: e.target.value }))}
                      className="w-full px-4 py-2.5 rounded-xl border border-border/60 bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50"
                      placeholder="Tus apellidos"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-display text-muted-foreground mb-1 block">Email *</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        type="email"
                        value={form.guestEmail}
                        onChange={e => setForm(f => ({ ...f, guestEmail: e.target.value }))}
                        className={`w-full pl-9 pr-4 py-2.5 rounded-xl border bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50 ${errors.guestEmail ? "border-red-500" : "border-border/60"}`}
                        placeholder="tu@email.com"
                      />
                    </div>
                    {errors.guestEmail && <p className="text-red-500 text-xs mt-1">{errors.guestEmail}</p>}
                  </div>
                  <div>
                    <label className="text-sm font-display text-muted-foreground mb-1 block">Teléfono</label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        type="tel"
                        value={form.guestPhone}
                        onChange={e => setForm(f => ({ ...f, guestPhone: e.target.value }))}
                        className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-border/60 bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50"
                        placeholder="+34 600 000 000"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Preferencias */}
              <div className="bg-card rounded-2xl border border-border/40 p-5 space-y-4">
                <h3 className="font-heading font-bold text-foreground">Preferencias y necesidades</h3>
                <div>
                  <label className="text-sm font-display text-muted-foreground mb-1 block">
                    <AlertCircle className="w-4 h-4 inline mr-1 text-amber-500" />
                    Alergias o intolerancias
                  </label>
                  <textarea
                    value={form.allergies}
                    onChange={e => setForm(f => ({ ...f, allergies: e.target.value }))}
                    rows={2}
                    className="w-full px-4 py-2.5 rounded-xl border border-border/60 bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none"
                    placeholder="Gluten, lactosa, frutos secos..."
                  />
                </div>
                <div>
                  <label className="text-sm font-display text-muted-foreground mb-1 block">Peticiones especiales</label>
                  <textarea
                    value={form.specialRequests}
                    onChange={e => setForm(f => ({ ...f, specialRequests: e.target.value }))}
                    rows={2}
                    className="w-full px-4 py-2.5 rounded-xl border border-border/60 bg-background text-foreground text-sm font-display focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none"
                    placeholder="Mesa junto a la ventana, decoración especial..."
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { key: "highchair", icon: Baby, label: "Necesito trona" },
                    { key: "birthday", icon: Cake, label: "Celebración de cumpleaños" },
                    { key: "accessibility", icon: Accessibility, label: "Necesito accesibilidad" },
                  ].map(({ key, icon: Icon, label }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, [key]: !f[key as keyof typeof f] }))}
                      className={`flex items-center gap-2 p-3 rounded-xl border text-sm font-display transition-all ${
                        form[key as keyof typeof form]
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-border/60 text-muted-foreground hover:border-accent/40"
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Política de cancelación */}
              {restaurant.cancellationPolicy && (
                <div className="bg-muted/50 rounded-2xl p-4 text-sm text-muted-foreground font-display">
                  <p className="font-semibold text-foreground mb-1">Política de cancelación</p>
                  <p>{restaurant.cancellationPolicy}</p>
                </div>
              )}

              {errors.submit && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-xl p-3 text-sm text-red-600 font-display flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" /> {errors.submit}
                </div>
              )}

              <div className="flex gap-3 justify-between">
                <Button type="button" variant="outline" onClick={() => setStep(1)} className="rounded-full px-6">
                  <ArrowLeft className="w-4 h-4 mr-1" /> Volver
                </Button>
                <Button
                  type="submit"
                  disabled={createBookingMutation.isPending}
                  className="bg-accent hover:bg-accent/90 text-white rounded-full px-8 font-display font-semibold"
                >
                  {createBookingMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Enviando...</>
                  ) : (
                    <>Confirmar reserva <CheckCircle className="w-4 h-4 ml-2" /></>
                  )}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}
