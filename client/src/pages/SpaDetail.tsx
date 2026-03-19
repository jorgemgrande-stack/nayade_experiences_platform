import { useState, useMemo, useRef } from "react";
import { useParams, useLocation, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import PublicLayout from "@/components/PublicLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Clock, Users, ChevronLeft, ChevronRight, ChevronLeft as ArrowLeft,
  Star, Sparkles, CheckCircle2, Calendar, AlertCircle, X,
} from "lucide-react";
import { ReviewSection } from "@/components/ReviewSection";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().split("T")[0];
}
function addDays(dateStr: string, n: number) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}
function formatDate(dateStr: string) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("es-ES", {
    weekday: "long", day: "numeric", month: "long",
  });
}
function getMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return { firstDay, daysInMonth };
}

// ─── Image Gallery ────────────────────────────────────────────────────────────
function Gallery({ images, name }: { images: string[]; name: string }) {
  const [active, setActive] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);

  if (images.length === 0) {
    return (
      <div className="w-full aspect-video bg-gradient-to-br from-teal-900/50 to-slate-800 rounded-2xl flex items-center justify-center">
        <Sparkles className="h-20 w-20 text-teal-500/30" />
      </div>
    );
  }

  return (
    <>
      {/* Main image */}
      <div
        className="relative w-full aspect-video rounded-2xl overflow-hidden cursor-zoom-in group"
        onClick={() => setLightbox(active)}
      >
        <img
          src={images[active]}
          alt={`${name} — imagen ${active + 1}`}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
        {images.length > 1 && (
          <>
            <button
              onClick={e => { e.stopPropagation(); setActive(i => Math.max(0, i - 1)); }}
              className="absolute left-3 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-opacity opacity-0 group-hover:opacity-100"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={e => { e.stopPropagation(); setActive(i => Math.min(images.length - 1, i + 1)); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-opacity opacity-0 group-hover:opacity-100"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}
        <div className="absolute bottom-3 right-3 bg-black/50 text-white text-xs px-2 py-1 rounded-full">
          {active + 1} / {images.length}
        </div>
      </div>

      {/* Thumbnails */}
      {images.length > 1 && (
        <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
          {images.map((img, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              className={`flex-shrink-0 w-20 h-14 rounded-lg overflow-hidden border-2 transition-all ${
                i === active ? "border-teal-400 opacity-100" : "border-transparent opacity-60 hover:opacity-90"
              }`}
            >
              <img src={img} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox !== null && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white"
            onClick={() => setLightbox(null)}
          >
            <X className="h-8 w-8" />
          </button>
          {lightbox > 0 && (
            <button
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white"
              onClick={e => { e.stopPropagation(); setLightbox(i => Math.max(0, (i ?? 0) - 1)); }}
            >
              <ChevronLeft className="h-10 w-10" />
            </button>
          )}
          <img
            src={images[lightbox]}
            alt=""
            className="max-w-full max-h-full rounded-xl object-contain"
            onClick={e => e.stopPropagation()}
          />
          {lightbox < images.length - 1 && (
            <button
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white"
              onClick={e => { e.stopPropagation(); setLightbox(i => Math.min(images.length - 1, (i ?? 0) + 1)); }}
            >
              <ChevronRight className="h-10 w-10" />
            </button>
          )}
        </div>
      )}
    </>
  );
}

// ─── Availability Calendar ────────────────────────────────────────────────────
function AvailabilityCalendar({
  treatmentId,
  selectedDate,
  onSelectDate,
}: {
  treatmentId: number;
  selectedDate: string;
  onSelectDate: (d: string) => void;
}) {
  const today = todayStr();
  const [viewDate, setViewDate] = useState(() => {
    const d = new Date(selectedDate + "T12:00:00");
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const startOfMonth = `${viewDate.year}-${String(viewDate.month + 1).padStart(2, "0")}-01`;
  const endOfMonth = new Date(viewDate.year, viewDate.month + 1, 0)
    .toISOString().split("T")[0];

  const rangeQuery = trpc.spa.getSlotsByMonth.useQuery(
    { treatmentId, startDate: startOfMonth, endDate: endOfMonth },
    { staleTime: 60_000 }
  );

  const slotsByDate = useMemo(() => {
    const map: Record<string, number> = {};
    (rangeQuery.data ?? []).forEach((s: any) => {
      map[s.date] = (map[s.date] ?? 0) + (s.capacity - s.bookedCount);
    });
    return map;
  }, [rangeQuery.data]);

  const { firstDay, daysInMonth } = getMonthDays(viewDate.year, viewDate.month);
  const blanks = firstDay === 0 ? 6 : firstDay - 1; // Mon-first grid

  const monthName = new Date(viewDate.year, viewDate.month, 1).toLocaleDateString("es-ES", {
    month: "long", year: "numeric",
  });

  function prevMonth() {
    setViewDate(v => {
      const d = new Date(v.year, v.month - 1, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }
  function nextMonth() {
    setViewDate(v => {
      const d = new Date(v.year, v.month + 1, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  return (
    <div className="bg-white/5 rounded-2xl border border-white/10 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="text-white font-semibold capitalize">{monthName}</span>
        <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition-colors">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Day names */}
      <div className="grid grid-cols-7 mb-2">
        {["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"].map(d => (
          <div key={d} className="text-center text-xs text-white/40 font-medium py-1">{d}</div>
        ))}
      </div>

      {/* Days */}
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: blanks }).map((_, i) => <div key={`b${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
          const dateStr = `${viewDate.year}-${String(viewDate.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const isPast = dateStr < today;
          const available = slotsByDate[dateStr] ?? 0;
          const isSelected = dateStr === selectedDate;
          const isToday = dateStr === today;

          let cellClass = "relative flex flex-col items-center justify-center h-10 rounded-lg text-sm transition-all ";
          if (isPast) {
            cellClass += "text-white/20 cursor-not-allowed";
          } else if (isSelected) {
            cellClass += "bg-teal-500 text-slate-900 font-bold cursor-pointer";
          } else if (available === 0) {
            cellClass += "text-white/30 cursor-not-allowed";
          } else if (available <= 2) {
            cellClass += "text-amber-300 hover:bg-amber-500/20 cursor-pointer font-medium";
          } else {
            cellClass += "text-white hover:bg-teal-500/20 cursor-pointer";
          }

          return (
            <button
              key={day}
              disabled={isPast || available === 0}
              onClick={() => onSelectDate(dateStr)}
              className={cellClass}
            >
              {isToday && !isSelected && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-teal-400" />
              )}
              {day}
              {!isPast && available > 0 && !isSelected && (
                <span className={`text-[9px] leading-none mt-0.5 ${available <= 2 ? "text-amber-400" : "text-teal-400/70"}`}>
                  {available <= 2 ? `${available}` : "●"}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-4 mt-4 text-xs text-white/50 justify-center">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-teal-400 inline-block" /> Disponible</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Últimas plazas</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-white/20 inline-block" /> Sin horarios</span>
      </div>
    </div>
  );
}

// ─── Time Slot Picker ─────────────────────────────────────────────────────────
function TimeSlotPicker({
  treatmentId,
  date,
  selected,
  onSelect,
}: {
  treatmentId: number;
  date: string;
  selected: number | null;
  onSelect: (slotId: number, time: string) => void;
}) {
  const slotsQuery = trpc.spa.getAvailableSlots.useQuery(
    { treatmentId, date },
    { enabled: !!date }
  );

  if (!date) return null;

  if (slotsQuery.isLoading) {
    return (
      <div className="flex flex-wrap gap-2 mt-3">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-9 w-20 bg-white/10 rounded-lg" />)}
      </div>
    );
  }

  const slots = slotsQuery.data ?? [];

  if (slots.length === 0) {
    return (
      <div className="flex items-center gap-2 mt-3 text-white/50 text-sm">
        <AlertCircle className="h-4 w-4 text-amber-400" />
        No hay horarios disponibles para este día. Selecciona otra fecha.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {slots.map((slot: any) => {
        const isSelected = slot.id === selected;
        const isLast = (slot.capacity - slot.bookedCount) <= 1;
        return (
          <button
            key={slot.id}
            onClick={() => onSelect(slot.id, slot.startTime)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all border ${
              isSelected
                ? "bg-teal-500 text-slate-900 border-teal-500 font-bold"
                : isLast
                  ? "bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20"
                  : "bg-white/5 text-white border-white/10 hover:bg-teal-500/20 hover:border-teal-500/40"
            }`}
          >
            {slot.startTime}
            {isLast && <span className="ml-1 text-[10px] opacity-70">última</span>}
          </button>
        );
      })}
    </div>
  );
}

// ─── Booking Panel ────────────────────────────────────────────────────────────
function BookingPanel({ treatment }: { treatment: any }) {
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [selectedSlot, setSelectedSlot] = useState<{ id: number; time: string } | null>(null);
  const [persons, setPersons] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", notes: "" });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const redsysFormRef = useRef<HTMLFormElement | null>(null);

  const price = parseFloat(treatment.price || "0");
  const total = price * persons;

  const bookMutation = trpc.spa.createSpaBooking.useMutation({
    onSuccess: (data) => {
      // Auto-submit the Redsys form
      const { redsysForm } = data;
      const f = document.createElement("form");
      f.method = "POST";
      f.action = redsysForm.url;
      f.style.display = "none";
      const fields: Record<string, string> = {
        Ds_MerchantParameters: redsysForm.Ds_MerchantParameters,
        Ds_Signature: redsysForm.Ds_Signature,
        Ds_SignatureVersion: redsysForm.Ds_SignatureVersion,
      };
      Object.entries(fields).forEach(([k, v]) => {
        const inp = document.createElement("input");
        inp.type = "hidden";
        inp.name = k;
        inp.value = v;
        f.appendChild(inp);
      });
      document.body.appendChild(f);
      f.submit();
    },
    onError: (err) => {
      alert("Error al procesar la reserva: " + err.message);
    },
  });

  function validateForm() {
    const errors: Record<string, string> = {};
    if (!form.name.trim() || form.name.trim().length < 2) errors.name = "Nombre requerido (mín. 2 caracteres)";
    if (!form.email.trim() || !/^[^@]+@[^@]+\.[^@]+$/.test(form.email)) errors.email = "Email válido requerido";
    return errors;
  }

  function handleOpenModal() {
    if (!selectedSlot) return;
    setFormErrors({});
    setShowModal(true);
  }

  function handleConfirmBooking() {
    const errors = validateForm();
    if (Object.keys(errors).length > 0) { setFormErrors(errors); return; }
    bookMutation.mutate({
      treatmentId: treatment.id,
      slotId: selectedSlot!.id,
      date: selectedDate,
      time: selectedSlot!.time,
      persons,
      customerName: form.name.trim(),
      customerEmail: form.email.trim(),
      customerPhone: form.phone.trim() || undefined,
      notes: form.notes.trim() || undefined,
      origin: window.location.origin,
    });
  }

  return (
    <>
      <div className="bg-white/5 border border-white/10 rounded-2xl p-6 sticky top-24">
        {/* Price */}
        <div className="mb-5">
          <div className="text-3xl font-bold text-teal-400">
            {price.toFixed(2)} €
            <span className="text-base font-normal text-white/50"> / persona</span>
          </div>
          <p className="text-white/50 text-sm mt-1">Duración: {treatment.durationMinutes} min</p>
        </div>

        {/* Persons */}
        <div className="mb-5">
          <label className="text-xs text-white/60 font-medium uppercase tracking-wide block mb-2">Personas</label>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPersons(p => Math.max(1, p - 1))}
              className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white font-bold transition-colors"
            >−</button>
            <span className="text-white font-bold text-lg w-8 text-center">{persons}</span>
            <button
              onClick={() => setPersons(p => Math.min(treatment.maxPersons, p + 1))}
              className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white font-bold transition-colors"
            >+</button>
            <span className="text-white/40 text-sm">máx. {treatment.maxPersons}</span>
          </div>
        </div>

        {/* Date */}
        <div className="mb-4">
          <label className="text-xs text-white/60 font-medium uppercase tracking-wide block mb-2">
            <Calendar className="h-3.5 w-3.5 inline mr-1" />Fecha
          </label>
          <input
            type="date"
            value={selectedDate}
            min={todayStr()}
            onChange={e => { setSelectedDate(e.target.value); setSelectedSlot(null); }}
            className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm [color-scheme:dark] focus:outline-none focus:border-teal-400"
          />
        </div>

        {/* Time slots */}
        <div className="mb-5">
          <label className="text-xs text-white/60 font-medium uppercase tracking-wide block mb-1">
            <Clock className="h-3.5 w-3.5 inline mr-1" />Horario
          </label>
          <TimeSlotPicker
            treatmentId={treatment.id}
            date={selectedDate}
            selected={selectedSlot?.id ?? null}
            onSelect={(id, time) => setSelectedSlot({ id, time })}
          />
        </div>

        {/* Total */}
        {selectedSlot && (
          <div className="bg-teal-500/10 border border-teal-500/20 rounded-xl p-3 mb-4 text-sm">
            <div className="flex justify-between text-white/70 mb-1">
              <span>{price.toFixed(2)} € × {persons} persona{persons !== 1 ? "s" : ""}</span>
              <span className="text-white font-bold">{total.toFixed(2)} €</span>
            </div>
            <div className="text-white/50 text-xs">
              {formatDate(selectedDate)} · {selectedSlot.time}
            </div>
          </div>
        )}

        <Button
          onClick={handleOpenModal}
          disabled={!selectedSlot}
          className="w-full bg-teal-500 hover:bg-teal-400 text-slate-900 font-bold py-3 text-base disabled:opacity-40"
        >
          {selectedSlot ? "Reservar ahora" : "Selecciona fecha y hora"}
        </Button>
        <p className="text-white/40 text-xs text-center mt-3">Cancelación gratuita hasta 24h antes</p>
      </div>

      {/* ── Booking Modal ─────────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <div>
                <h2 className="text-lg font-bold text-white">Confirmar reserva</h2>
                <p className="text-white/50 text-sm mt-0.5">{treatment.name}</p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-white/40 hover:text-white transition-colors p-1"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Summary */}
            <div className="px-6 pt-5 pb-2">
              <div className="bg-teal-500/10 border border-teal-500/20 rounded-xl p-4 text-sm space-y-1.5">
                <div className="flex justify-between text-white/70">
                  <span>Tratamiento</span>
                  <span className="text-white font-medium">{treatment.name}</span>
                </div>
                <div className="flex justify-between text-white/70">
                  <span>Fecha y hora</span>
                  <span className="text-white font-medium">{formatDate(selectedDate)} · {selectedSlot?.time}</span>
                </div>
                <div className="flex justify-between text-white/70">
                  <span>Personas</span>
                  <span className="text-white font-medium">{persons}</span>
                </div>
                <div className="flex justify-between text-white/80 font-bold border-t border-white/10 pt-2 mt-2">
                  <span>Total</span>
                  <span className="text-teal-400 text-base">{total.toFixed(2)} €</span>
                </div>
              </div>
            </div>

            {/* Form */}
            <div className="px-6 pb-6 space-y-4 mt-4">
              <div>
                <label className="text-xs text-white/60 font-medium uppercase tracking-wide block mb-1.5">Nombre completo *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Tu nombre"
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2.5 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-teal-400"
                />
                {formErrors.name && <p className="text-red-400 text-xs mt-1">{formErrors.name}</p>}
              </div>
              <div>
                <label className="text-xs text-white/60 font-medium uppercase tracking-wide block mb-1.5">Email *</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="tu@email.com"
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2.5 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-teal-400"
                />
                {formErrors.email && <p className="text-red-400 text-xs mt-1">{formErrors.email}</p>}
              </div>
              <div>
                <label className="text-xs text-white/60 font-medium uppercase tracking-wide block mb-1.5">Teléfono (opcional)</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="+34 600 000 000"
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2.5 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-teal-400"
                />
              </div>
              <div>
                <label className="text-xs text-white/60 font-medium uppercase tracking-wide block mb-1.5">Notas (opcional)</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Alergias, preferencias, peticiones especiales..."
                  rows={2}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2.5 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-teal-400 resize-none"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setShowModal(false)}
                  className="flex-1 border-white/20 text-white/70 hover:text-white hover:bg-white/10"
                  disabled={bookMutation.isPending}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleConfirmBooking}
                  disabled={bookMutation.isPending}
                  className="flex-1 bg-teal-500 hover:bg-teal-400 text-slate-900 font-bold"
                >
                  {bookMutation.isPending ? "Procesando..." : `Pagar ${total.toFixed(2)} €`}
                </Button>
              </div>
              <p className="text-white/30 text-xs text-center">Pago seguro vía Redsys · Cancela gratis hasta 24h antes</p>
            </div>
          </div>
        </div>
      )}

      {/* Hidden Redsys form ref */}
      <form ref={redsysFormRef} method="POST" style={{ display: "none" }} />
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SpaDetail() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug ?? "";

  const treatmentQuery = trpc.spa.getTreatmentBySlug.useQuery(
    { slug },
    { enabled: !!slug }
  );

  const treatment = treatmentQuery.data;

  // Build gallery from available image fields
  const images = useMemo(() => {
    if (!treatment) return [];
    const imgs: string[] = [];
    if (treatment.coverImageUrl) imgs.push(treatment.coverImageUrl);
    if ((treatment as any).image1) imgs.push((treatment as any).image1);
    if ((treatment as any).image2) imgs.push((treatment as any).image2);
    const gallery = (treatment as any).gallery;
    if (Array.isArray(gallery)) imgs.push(...gallery);
    return imgs.filter(Boolean);
  }, [treatment]);

  const benefits: string[] = useMemo(() => {
    if (!treatment) return [];
    const b = (treatment as any).benefits;
    if (Array.isArray(b)) return b;
    if (typeof b === "string") {
      try { return JSON.parse(b); } catch { return []; }
    }
    return [];
  }, [treatment]);

  if (treatmentQuery.isLoading) {
    return (
      <PublicLayout darkContent>
        <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 pt-28 pb-20">
          <div className="max-w-6xl mx-auto px-4">
            <Skeleton className="h-8 w-48 bg-white/10 mb-8 rounded-lg" />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
              <div className="lg:col-span-2 space-y-4">
                <Skeleton className="aspect-video w-full bg-white/10 rounded-2xl" />
                <Skeleton className="h-6 w-2/3 bg-white/10 rounded" />
                <Skeleton className="h-4 w-full bg-white/10 rounded" />
                <Skeleton className="h-4 w-5/6 bg-white/10 rounded" />
              </div>
              <Skeleton className="h-96 bg-white/10 rounded-2xl" />
            </div>
          </div>
        </div>
      </PublicLayout>
    );
  }

  if (treatmentQuery.error || !treatment) {
    return (
      <PublicLayout darkContent>
        <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 pt-28 pb-20 flex items-center justify-center">
          <div className="text-center">
            <Sparkles className="h-16 w-16 text-teal-500/30 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-white mb-2">Tratamiento no encontrado</h1>
            <p className="text-white/50 mb-6">El tratamiento que buscas no existe o no está disponible.</p>
            <Link href="/spa">
              <Button className="bg-teal-500 hover:bg-teal-400 text-slate-900 font-bold">
                <ArrowLeft className="h-4 w-4 mr-2" /> Ver todos los tratamientos
              </Button>
            </Link>
          </div>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout darkContent>
      <div className="min-h-screen bg-gradient-to-b from-slate-900 via-teal-950/20 to-slate-900 pt-28 pb-20">
        <div className="max-w-6xl mx-auto px-4">

          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-sm text-white/50 mb-8">
            <Link href="/spa" className="hover:text-teal-400 transition-colors flex items-center gap-1">
              <ArrowLeft className="h-4 w-4" /> SPA & Wellness
            </Link>
            <span>/</span>
            <span className="text-white/80">{treatment.name}</span>
          </nav>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">

            {/* ── Left column ─────────────────────────────────────────────── */}
            <div className="lg:col-span-2 space-y-8">

              {/* Gallery */}
              <Gallery images={images} name={treatment.name} />

              {/* Title & meta */}
              <div>
                <div className="flex flex-wrap gap-2 mb-3">
                  {treatment.isFeatured && (
                    <Badge className="bg-teal-500/20 text-teal-300 border-teal-500/30">
                      <Star className="h-3 w-3 mr-1" /> Destacado
                    </Badge>
                  )}
                  {(treatment as any).categoryName && (
                    <Badge className="bg-white/10 text-white/70 border-white/10">
                      {(treatment as any).categoryName}
                    </Badge>
                  )}
                </div>
                <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">{treatment.name}</h1>
                <div className="flex flex-wrap gap-5 text-white/60 text-sm mb-4">
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4 text-teal-400" />
                    {treatment.durationMinutes} minutos
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-teal-400" />
                    Hasta {treatment.maxPersons} persona{treatment.maxPersons !== 1 ? "s" : ""}
                  </span>
                </div>
                {treatment.shortDescription && (
                  <p className="text-white/70 text-lg leading-relaxed">{treatment.shortDescription}</p>
                )}
              </div>

              {/* Description */}
              {treatment.description && (
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">Descripción</h2>
                  <div className="text-white/65 leading-relaxed whitespace-pre-line">
                    {treatment.description}
                  </div>
                </div>
              )}

              {/* Benefits */}
              {benefits.length > 0 && (
                <div>
                  <h2 className="text-xl font-bold text-white mb-4">Beneficios</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {benefits.map((b: string, i: number) => (
                      <div key={i} className="flex items-start gap-3 bg-white/5 rounded-xl p-3 border border-white/10">
                        <CheckCircle2 className="h-5 w-5 text-teal-400 flex-shrink-0 mt-0.5" />
                        <span className="text-white/80 text-sm">{b}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Availability Calendar — full width on mobile */}
              <div className="lg:hidden">
                <h2 className="text-xl font-bold text-white mb-4">Disponibilidad</h2>
                <AvailabilityCalendar
                  treatmentId={treatment.id}
                  selectedDate={todayStr()}
                  onSelectDate={() => {}}
                />
              </div>

              {/* Calendar — full width desktop */}
              <div className="hidden lg:block">
                <h2 className="text-xl font-bold text-white mb-4">Calendario de disponibilidad</h2>
                <AvailabilityCalendar
                  treatmentId={treatment.id}
                  selectedDate={todayStr()}
                  onSelectDate={() => {}}
                />
              </div>

            </div>

            {/* ── Right column: Booking panel ─────────────────────────────── */}
            <div>
              <BookingPanel treatment={treatment} />
            </div>

          </div>

          {/* Reseñas */}
          <ReviewSection entityType="spa" entityId={treatment.id} theme="dark" />

          {/* Back link */}
          <div className="mt-16 text-center">
            <Link href="/spa">
              <Button variant="outline" className="border-white/20 text-white/70 hover:text-white hover:bg-white/10">
                <ArrowLeft className="h-4 w-4 mr-2" /> Ver todos los tratamientos
              </Button>
            </Link>
          </div>

        </div>
      </div>
    </PublicLayout>
  );
}
