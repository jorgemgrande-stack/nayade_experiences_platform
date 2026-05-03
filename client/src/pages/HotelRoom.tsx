import { useState } from "react";
import { useRoute, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import PublicLayout from "@/components/PublicLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ChevronLeft, ChevronRight, Users, Baby, Maximize2,
  BedDouble, Star, CheckCircle2, Calendar, CreditCard,
  Moon, Minus, Plus, Phone, Mail, User, X,
} from "lucide-react";
import { ReviewSection } from "@/components/ReviewSection";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().split("T")[0];
}
function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}
function calcNights(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut) return 0;
  const diff = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Math.max(0, Math.round(diff / (1000 * 60 * 60 * 24)));
}

// ─── Price Calendar ───────────────────────────────────────────────────────────
function PriceCalendar({
  roomTypeId,
  checkIn,
  checkOut,
  onSelectDate,
}: {
  roomTypeId: number;
  checkIn: string;
  checkOut: string;
  onSelectDate?: (date: string) => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { data: days, isLoading } = trpc.hotel.getRoomCalendar.useQuery({ roomTypeId, year, month });

  const monthName = new Date(year, month - 1, 1).toLocaleString("es-ES", { month: "long", year: "numeric" });

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  const firstDow = new Date(year, month - 1, 1).getDay();
  const blanks = Array(firstDow).fill(null);
  const DAYS_HEADER = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-white/10 text-white/70 hover:text-white">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h3 className="text-white font-semibold capitalize">{monthName}</h3>
        <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-white/10 text-white/70 hover:text-white">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-2">
        {DAYS_HEADER.map(d => (
          <div key={d} className="text-center text-xs text-white/40 font-medium py-1">{d}</div>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-7 gap-1">
          {Array(35).fill(0).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg bg-white/10" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {blanks.map((_, i) => <div key={`b${i}`} />)}
          {(days ?? []).map(day => {
            const isPast = day.date < todayStr();
            const isCheckIn = day.date === checkIn;
            const isCheckOut = day.date === checkOut;
            const isInRange = checkIn && checkOut && day.date > checkIn && day.date < checkOut;

            const bgClass = isPast
              ? "bg-white/5 opacity-40 cursor-not-allowed"
              : isCheckIn || isCheckOut
                ? "bg-amber-500 border border-amber-400 cursor-pointer"
                : isInRange
                  ? "bg-amber-500/20 border border-amber-400/30 cursor-pointer"
                  : day.status === "completo"
                    ? "bg-red-500/20 border border-red-500/30 cursor-not-allowed"
                    : day.status === "pocas_unidades"
                      ? "bg-amber-500/20 border border-amber-500/30 hover:border-amber-400/50 cursor-pointer"
                      : "bg-emerald-500/10 border border-emerald-500/20 hover:border-emerald-400/50 cursor-pointer";

            return (
              <div
                key={day.date}
                onClick={() => !isPast && day.status !== "completo" && onSelectDate?.(day.date)}
                className={`rounded-lg p-1.5 text-center transition-colors ${bgClass}`}
              >
                <div className={`text-xs ${isCheckIn || isCheckOut ? "text-slate-900 font-bold" : "text-white/60"}`}>
                  {parseInt(day.date.split("-")[2])}
                </div>
                <div className={`text-xs font-bold mt-0.5 ${
                  isCheckIn || isCheckOut ? "text-slate-900" :
                  day.status === "completo" ? "text-red-300" :
                  day.status === "pocas_unidades" ? "text-amber-300" :
                  "text-emerald-300"
                }`}>
                  {isPast ? "" : `${day.price.toFixed(0)}€`}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex gap-4 mt-4 justify-center text-xs text-white/50">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500/30 inline-block" /> Disponible</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-500/30 inline-block" /> Pocas plazas</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500/30 inline-block" /> Completo</span>
      </div>
    </div>
  );
}

// ─── Booking Modal ────────────────────────────────────────────────────────────
function BookingModal({
  room,
  checkIn,
  checkOut,
  adults,
  children,
  childrenAges,
  nights,
  pricePerNight,
  onClose,
}: {
  room: { id: number; name: string; basePrice: string | null };
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  childrenAges: number[];
  nights: number;
  pricePerNight: number;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const bookMutation = trpc.hotel.createHotelBooking.useMutation({
    onSuccess: (data) => {
      // Construir y enviar el formulario Redsys dinámicamente
      const form = document.createElement("form");
      form.method = "POST";
      form.action = data.redsysForm.url;
      form.style.display = "none";
      const fields = {
        Ds_SignatureVersion: data.redsysForm.Ds_SignatureVersion,
        Ds_MerchantParameters: data.redsysForm.Ds_MerchantParameters,
        Ds_Signature: data.redsysForm.Ds_Signature,
      };
      for (const [key, value] of Object.entries(fields)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = key;
        input.value = value;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    },
    onError: (err) => {
      toast.error(err.message || "Error al procesar la reserva");
    },
  });

  const totalEuros = pricePerNight * nights;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      toast.error("Por favor completa nombre y email");
      return;
    }
    bookMutation.mutate({
      roomTypeId: room.id,
      checkIn,
      checkOut,
      adults,
      children,
      childrenAges: childrenAges.length > 0 ? childrenAges : undefined,
      customerName: name.trim(),
      customerEmail: email.trim(),
      customerPhone: phone.trim() || undefined,
      notes: notes.trim() || undefined,
      origin: window.location.origin,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div>
            <h2 className="text-white font-bold text-xl">Confirmar reserva</h2>
            <p className="text-white/50 text-sm mt-0.5">{room.name}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Summary */}
        <div className="p-6 border-b border-white/10 bg-white/5">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-white/50 text-xs uppercase tracking-wide mb-1">Check-in</p>
              <p className="text-white font-semibold">{new Date(checkIn + "T12:00:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}</p>
            </div>
            <div>
              <p className="text-white/50 text-xs uppercase tracking-wide mb-1">Check-out</p>
              <p className="text-white font-semibold">{new Date(checkOut + "T12:00:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}</p>
            </div>
            <div>
              <p className="text-white/50 text-xs uppercase tracking-wide mb-1">Duración</p>
              <p className="text-white font-semibold">{nights} noche{nights > 1 ? "s" : ""}</p>
            </div>
            <div>
              <p className="text-white/50 text-xs uppercase tracking-wide mb-1">Personas</p>
              <p className="text-white font-semibold">{adults} adulto{adults > 1 ? "s" : ""}{children > 0 ? ` + ${children} niño${children > 1 ? "s" : ""}` : ""}</p>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between">
            <div className="text-white/60 text-sm">{pricePerNight.toFixed(0)} € × {nights} noche{nights > 1 ? "s" : ""}</div>
            <div className="text-amber-400 font-bold text-2xl">{totalEuros.toFixed(2)} €</div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <Label className="text-white/70 text-sm mb-1.5 flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" /> Nombre completo *
            </Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Tu nombre y apellidos"
              className="bg-white/5 border-white/20 text-white placeholder:text-white/30"
              required
            />
          </div>
          <div>
            <Label className="text-white/70 text-sm mb-1.5 flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" /> Email *
            </Label>
            <Input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="tu@email.com"
              className="bg-white/5 border-white/20 text-white placeholder:text-white/30"
              required
            />
          </div>
          <div>
            <Label className="text-white/70 text-sm mb-1.5 flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5" /> Teléfono (opcional)
            </Label>
            <Input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+34 600 000 000"
              className="bg-white/5 border-white/20 text-white placeholder:text-white/30"
            />
          </div>
          <div>
            <Label className="text-white/70 text-sm mb-1.5">Peticiones especiales (opcional)</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Cama extra, llegada tardía, alergias..."
              className="bg-white/5 border-white/20 text-white placeholder:text-white/30 resize-none"
              rows={3}
            />
          </div>

          <p className="text-white/40 text-xs">
            Al confirmar serás redirigido al sistema de pago seguro Redsys. La reserva se confirmará una vez completado el pago.
          </p>

          <Button
            type="submit"
            disabled={bookMutation.isPending}
            className="w-full bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold h-12 text-base"
          >
            {bookMutation.isPending ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin h-4 w-4 border-2 border-slate-900/30 border-t-slate-900 rounded-full" />
                Procesando...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Pagar {totalEuros.toFixed(2)} € — Reservar ahora
              </span>
            )}
          </Button>

          <p className="text-white/30 text-xs text-center flex items-center justify-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
            Cancela gratis hasta 48h antes del check-in
          </p>
        </form>

      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function HotelRoom() {
  const [, params] = useRoute("/hotel/:slug");
  const slug = params?.slug ?? "";

  // Read query params for pre-filled dates
  const searchParams = new URLSearchParams(window.location.search);
  const qCheckIn = searchParams.get("checkin") || searchParams.get("checkIn") || todayStr();
  const qCheckOut = searchParams.get("checkout") || searchParams.get("checkOut") || tomorrowStr();
  const qAdults = parseInt(searchParams.get("adults") || "2");
  const qChildren = parseInt(searchParams.get("children") || "0");

  const { data: room, isLoading, error } = trpc.hotel.getRoomTypeBySlug.useQuery(
    { slug },
    { enabled: !!slug }
  );

  const [activeImg, setActiveImg] = useState(0);
  const [checkIn, setCheckIn] = useState(qCheckIn);
  const [checkOut, setCheckOut] = useState(qCheckOut);
  const qChildrenAgesRaw = searchParams.get("childrenAges") || "";
  const qChildrenAges = qChildrenAgesRaw
    ? qChildrenAgesRaw.split(",").map(a => parseInt(a) || 5).slice(0, Math.max(0, qChildren))
    : Array.from({ length: Math.max(0, qChildren) }, () => 5);

  const [adults, setAdults] = useState(Math.max(1, qAdults));
  const [children, setChildren] = useState(Math.max(0, qChildren));
  const [childrenAges, setChildrenAges] = useState<number[]>(qChildrenAges);
  const [showModal, setShowModal] = useState(false);
  const [calendarSelectMode, setCalendarSelectMode] = useState<"checkin" | "checkout">("checkin");

  const nights = calcNights(checkIn, checkOut);

  // Get price for the selected check-in date from calendar
  const { data: calendarDays } = trpc.hotel.getRoomCalendar.useQuery(
    {
      roomTypeId: room?.id ?? 0,
      year: new Date(checkIn).getFullYear(),
      month: new Date(checkIn).getMonth() + 1,
    },
    { enabled: !!room?.id }
  );
  const checkInDay = calendarDays?.find(d => d.date === checkIn);
  const pricePerNight = checkInDay?.price ?? parseFloat(String(room?.basePrice ?? "0"));
  const totalPrice = pricePerNight * nights;

  function handleCalendarDate(date: string) {
    if (calendarSelectMode === "checkin") {
      setCheckIn(date);
      // Auto-advance checkout if needed
      if (date >= checkOut) {
        const next = new Date(date);
        next.setDate(next.getDate() + 1);
        setCheckOut(next.toISOString().split("T")[0]);
      }
      setCalendarSelectMode("checkout");
    } else {
      if (date <= checkIn) {
        toast.error("La fecha de salida debe ser posterior a la de entrada");
        return;
      }
      setCheckOut(date);
      setCalendarSelectMode("checkin");
    }
  }

  if (isLoading) {
    return (
      <PublicLayout fullWidthHero darkContent>
        <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 pt-32 px-4">
          <div className="max-w-6xl mx-auto">
            <Skeleton className="h-96 w-full rounded-2xl bg-white/10 mb-6" />
            <Skeleton className="h-8 w-1/3 bg-white/10 mb-3" />
            <Skeleton className="h-4 w-2/3 bg-white/10" />
          </div>
        </div>
      </PublicLayout>
    );
  }

  if (error || !room) {
    return (
      <PublicLayout fullWidthHero darkContent>
        <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex items-center justify-center pt-20">
          <div className="text-center text-white/60">
            <BedDouble className="h-16 w-16 mx-auto mb-4 opacity-30" />
            <p className="text-xl mb-4">Habitación no encontrada</p>
            <Link href="/hotel"><Button variant="outline" className="border-white/20 text-white">Volver al hotel</Button></Link>
          </div>
        </div>
      </PublicLayout>
    );
  }

  const gallery = [
    room.coverImageUrl,
    room.image1,
    room.image2,
    room.image3,
    room.image4,
    ...(Array.isArray(room.gallery) ? room.gallery : []),
  ].filter(Boolean) as string[];

  const amenities = Array.isArray(room.amenities) ? room.amenities : [];

  return (
    <PublicLayout fullWidthHero darkContent>
      <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
        {/* Spacer for fixed header */}
        <div className="h-28 md:h-32" />

        {/* Back */}
        <div className="max-w-6xl mx-auto px-4 pb-4">
          <Link href="/hotel">
            <Button variant="ghost" className="text-white/60 hover:text-white -ml-2">
              <ChevronLeft className="h-4 w-4 mr-1" /> Volver al hotel
            </Button>
          </Link>
        </div>

        <div className="max-w-6xl mx-auto px-4 pb-16 grid grid-cols-1 lg:grid-cols-3 gap-10">
          {/* Left: images + info */}
          <div className="lg:col-span-2 space-y-6">
            {/* Gallery */}
            {gallery.length > 0 ? (
              <div>
                <div className="relative rounded-2xl overflow-hidden h-80 md:h-[420px]">
                  <img
                    src={gallery[activeImg]}
                    alt={room.name}
                    className="w-full h-full object-cover"
                  />
                  {room.isFeatured && (
                    <Badge className="absolute top-4 left-4 bg-amber-500 text-slate-900 font-bold">
                      <Star className="h-3 w-3 mr-1" /> Destacado
                    </Badge>
                  )}
                  {gallery.length > 1 && (
                    <>
                      <button
                        onClick={() => setActiveImg(i => (i - 1 + gallery.length) % gallery.length)}
                        className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => setActiveImg(i => (i + 1) % gallery.length)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    </>
                  )}
                </div>
                {gallery.length > 1 && (
                  <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
                    {gallery.map((img, i) => (
                      <button
                        key={i}
                        onClick={() => setActiveImg(i)}
                        className={`flex-shrink-0 w-20 h-16 rounded-lg overflow-hidden border-2 transition-colors ${
                          i === activeImg ? "border-amber-400" : "border-transparent"
                        }`}
                      >
                        <img src={img} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl bg-slate-700/50 h-80 flex items-center justify-center">
                <BedDouble className="h-20 w-20 text-slate-500" />
              </div>
            )}

            {/* Info */}
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">{room.name}</h1>
              {room.shortDescription && (
                <p className="text-white/70 text-lg mb-4">{room.shortDescription}</p>
              )}

              {/* Specs */}
              <div className="flex flex-wrap gap-4 text-sm text-white/70 mb-6">
                <span className="flex items-center gap-1.5 bg-white/5 rounded-lg px-3 py-2">
                  <Users className="h-4 w-4 text-amber-400" />
                  Hasta {room.maxAdults} adultos
                </span>
                {room.maxChildren > 0 && (
                  <span className="flex items-center gap-1.5 bg-white/5 rounded-lg px-3 py-2">
                    <Baby className="h-4 w-4 text-amber-400" />
                    {room.maxChildren} niños
                  </span>
                )}
                {room.surfaceM2 && (
                  <span className="flex items-center gap-1.5 bg-white/5 rounded-lg px-3 py-2">
                    <Maximize2 className="h-4 w-4 text-amber-400" />
                    {room.surfaceM2} m²
                  </span>
                )}
              </div>

              {room.description && (
                <div className="mb-6">
                  <p className="text-white/70 leading-relaxed whitespace-pre-wrap">{room.description}</p>
                </div>
              )}

              {/* Amenities */}
              {amenities.length > 0 && (
                <div>
                  <h3 className="text-white font-semibold mb-3">Servicios incluidos</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {amenities.map((a: string, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-white/70 text-sm">
                        <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                        {a}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Calendar */}
            <div>
              <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-amber-400" />
                Calendario de precios
                <span className="text-white/40 text-sm font-normal ml-2">
                  {calendarSelectMode === "checkin" ? "— Selecciona fecha de entrada" : "— Selecciona fecha de salida"}
                </span>
              </h3>
              <PriceCalendar
                roomTypeId={room.id}
                checkIn={checkIn}
                checkOut={checkOut}
                onSelectDate={handleCalendarDate}
              />
            </div>
          </div>

          {/* Right: booking card */}
          <div className="space-y-4">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 sticky top-32">
              {/* Price */}
              <div className="text-3xl font-bold text-amber-400 mb-1">
                {pricePerNight.toFixed(2)} €
                <span className="text-base font-normal text-white/50"> / noche</span>
              </div>
              <p className="text-white/40 text-xs mb-5">Precio para las fechas seleccionadas</p>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div>
                  <label className="text-white/50 text-xs uppercase tracking-wide mb-1 block">Check-in</label>
                  <input
                    type="date"
                    value={checkIn}
                    min={todayStr()}
                    onChange={e => {
                      setCheckIn(e.target.value);
                      if (e.target.value >= checkOut) {
                        const next = new Date(e.target.value);
                        next.setDate(next.getDate() + 1);
                        setCheckOut(next.toISOString().split("T")[0]);
                      }
                    }}
                    className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-400"
                  />
                </div>
                <div>
                  <label className="text-white/50 text-xs uppercase tracking-wide mb-1 block">Check-out</label>
                  <input
                    type="date"
                    value={checkOut}
                    min={checkIn || todayStr()}
                    onChange={e => setCheckOut(e.target.value)}
                    className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              {/* Nights indicator */}
              {nights > 0 && (
                <div className="flex items-center gap-2 text-white/60 text-sm mb-4 bg-white/5 rounded-lg px-3 py-2">
                  <Moon className="h-4 w-4 text-amber-400" />
                  <span>{nights} noche{nights > 1 ? "s" : ""}</span>
                </div>
              )}

              {/* Persons */}
              <div className="space-y-3 mb-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-white/70 text-sm">
                    <Users className="h-4 w-4 text-amber-400" />
                    Adultos
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setAdults(a => Math.max(1, a - 1))}
                      className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="text-white font-semibold w-6 text-center">{adults}</span>
                    <button
                      onClick={() => setAdults(a => Math.min(room.maxAdults, a + 1))}
                      className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {room.maxChildren > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-white/70 text-sm">
                        <Baby className="h-4 w-4 text-amber-400" />
                        Niños
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            const newCount = Math.max(0, children - 1);
                            setChildren(newCount);
                            setChildrenAges(prev => prev.slice(0, newCount));
                          }}
                          className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="text-white font-semibold w-6 text-center">{children}</span>
                        <button
                          onClick={() => {
                            const newCount = Math.min(room.maxChildren, children + 1);
                            setChildren(newCount);
                            setChildrenAges(prev => [...prev, 5].slice(0, newCount));
                          }}
                          className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    </div>

                    {/* Edades de los niños */}
                    {children > 0 && (
                      <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                        <p className="text-white/50 text-xs uppercase tracking-wide font-medium mb-2.5">Edad de los niños</p>
                        <div className="space-y-2">
                          {childrenAges.map((age, idx) => (
                            <div key={idx} className="flex items-center justify-between">
                              <span className="text-white/60 text-sm">Niño {idx + 1}</span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updated = [...childrenAges];
                                    updated[idx] = Math.max(0, age - 1);
                                    setChildrenAges(updated);
                                  }}
                                  className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
                                >
                                  <Minus className="h-3 w-3" />
                                </button>
                                <span className="text-white font-semibold text-sm w-16 text-center">
                                  {age === 0 ? "< 1 año" : `${age} año${age !== 1 ? "s" : ""}`}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updated = [...childrenAges];
                                    updated[idx] = Math.min(17, age + 1);
                                    setChildrenAges(updated);
                                  }}
                                  className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
                                >
                                  <Plus className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Total */}
              {nights > 0 && (
                <div className="border-t border-white/10 pt-4 mb-5">
                  <div className="flex justify-between text-white/60 text-sm mb-1">
                    <span>{pricePerNight.toFixed(0)} € × {nights} noche{nights > 1 ? "s" : ""}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-white font-semibold">Total</span>
                    <span className="text-amber-400 font-bold text-2xl">{totalPrice.toFixed(2)} €</span>
                  </div>
                </div>
              )}

              {/* CTA */}
              <Button
                onClick={() => {
                  if (nights < 1) {
                    toast.error("Selecciona fechas de entrada y salida válidas");
                    return;
                  }
                  setShowModal(true);
                }}
                className="w-full bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold h-12 text-base"
              >
                <CreditCard className="h-5 w-5 mr-2" />
                Reservar ahora
              </Button>

              <p className="text-white/30 text-xs text-center mt-3 flex items-center justify-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                Cancela gratis hasta 48h antes
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Sección de reseñas */}
      <div className="bg-muted border-t border-border">
        <div className="max-w-6xl mx-auto px-4 py-16">
          <ReviewSection entityType="hotel" entityId={room.id} theme="auto" />
        </div>
      </div>

      {/* Booking Modal */}
      {showModal && room && (
        <BookingModal
          room={{ id: room.id, name: room.name, basePrice: room.basePrice ?? null }}
          checkIn={checkIn}
          checkOut={checkOut}
          adults={adults}
          children={children}
          childrenAges={childrenAges}
          nights={nights}
          pricePerNight={pricePerNight}
          onClose={() => setShowModal(false)}
        />
      )}
    </PublicLayout>
  );
}
