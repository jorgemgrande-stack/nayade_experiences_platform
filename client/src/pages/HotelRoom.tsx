import { useState } from "react";
import { useRoute, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronLeft, ChevronRight, Users, Baby, Maximize2,
  BedDouble, Star, CheckCircle2, Calendar,
} from "lucide-react";

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

// ─── Price Calendar ───────────────────────────────────────────────────────────
function PriceCalendar({ roomTypeId }: { roomTypeId: number }) {
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

  // First day of week offset
  const firstDow = new Date(year, month - 1, 1).getDay(); // 0=Sun
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
            const bgClass = isPast
              ? "bg-white/5 opacity-40"
              : day.status === "completo"
                ? "bg-red-500/20 border border-red-500/30"
                : day.status === "pocas_unidades"
                  ? "bg-amber-500/20 border border-amber-500/30"
                  : "bg-emerald-500/10 border border-emerald-500/20 hover:border-emerald-400/50";

            return (
              <div
                key={day.date}
                className={`rounded-lg p-1.5 text-center cursor-default transition-colors ${bgClass}`}
              >
                <div className="text-xs text-white/60">{parseInt(day.date.split("-")[2])}</div>
                <div className={`text-xs font-bold mt-0.5 ${
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

      {/* Legend */}
      <div className="flex gap-4 mt-4 justify-center text-xs text-white/50">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500/30 inline-block" /> Disponible</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-500/30 inline-block" /> Pocas plazas</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500/30 inline-block" /> Completo</span>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function HotelRoom() {
  const [, params] = useRoute("/hotel/:slug");
  const slug = params?.slug ?? "";

  const { data: room, isLoading, error } = trpc.hotel.getRoomTypeBySlug.useQuery(
    { slug },
    { enabled: !!slug }
  );

  const [activeImg, setActiveImg] = useState(0);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 p-8">
        <Skeleton className="h-96 w-full rounded-2xl bg-white/10 mb-6" />
        <Skeleton className="h-8 w-1/3 bg-white/10 mb-3" />
        <Skeleton className="h-4 w-2/3 bg-white/10" />
      </div>
    );
  }

  if (error || !room) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex items-center justify-center">
        <div className="text-center text-white/60">
          <BedDouble className="h-16 w-16 mx-auto mb-4 opacity-30" />
          <p className="text-xl mb-4">Habitación no encontrada</p>
          <Link href="/hotel"><Button variant="outline" className="border-white/20 text-white">Volver al hotel</Button></Link>
        </div>
      </div>
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
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      {/* Back */}
      <div className="max-w-6xl mx-auto px-4 pt-8">
        <Link href="/hotel">
          <Button variant="ghost" className="text-white/60 hover:text-white -ml-2">
            <ChevronLeft className="h-4 w-4 mr-1" /> Volver al hotel
          </Button>
        </Link>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-10">
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
              <div className="prose prose-invert max-w-none mb-6">
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
        </div>

        {/* Right: price + calendar */}
        <div className="space-y-6">
          {/* Price card */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 sticky top-6">
            <div className="text-3xl font-bold text-amber-400 mb-1">
              {parseFloat(room.basePrice || "0").toFixed(2)} €
              <span className="text-base font-normal text-white/50"> / noche</span>
            </div>
            <p className="text-white/50 text-sm mb-5">Precio desde. Varía según temporada.</p>
            <Link href={`/hotel?checkIn=${todayStr()}`}>
              <Button className="w-full bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold">
                <Calendar className="h-4 w-4 mr-2" />
                Comprobar disponibilidad
              </Button>
            </Link>
            <p className="text-white/40 text-xs text-center mt-3">Cancela gratis hasta 48h antes</p>
          </div>

          {/* Calendar */}
          <div>
            <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-amber-400" />
              Calendario de precios
            </h3>
            <PriceCalendar roomTypeId={room.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
