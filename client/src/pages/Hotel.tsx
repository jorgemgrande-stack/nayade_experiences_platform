import { useState, useMemo } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Calendar, Users, ChevronRight, Star, BedDouble,
  Maximize2, Baby, Wifi, Coffee, Car, Waves, Utensils, Dumbbell,
} from "lucide-react";

// ─── Date helpers ─────────────────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().split("T")[0];
}
function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}
function nightCount(ci: string, co: string) {
  const diff = new Date(co).getTime() - new Date(ci).getTime();
  return Math.max(1, Math.round(diff / 86400000));
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface SearchParams {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
}

// ─── SearchBar ────────────────────────────────────────────────────────────────
function SearchBar({ params, onChange, onSearch }: {
  params: SearchParams;
  onChange: (p: SearchParams) => void;
  onSearch: () => void;
}) {
  const n = nightCount(params.checkIn, params.checkOut);
  return (
    <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 md:p-6 border border-white/20 shadow-xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-white/70 font-medium uppercase tracking-wide">Entrada</label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/60 pointer-events-none" />
            <Input
              type="date"
              value={params.checkIn}
              min={todayStr()}
              onChange={e => onChange({ ...params, checkIn: e.target.value })}
              className="pl-9 bg-white/10 border-white/20 text-white [color-scheme:dark] focus:border-amber-400"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-white/70 font-medium uppercase tracking-wide">Salida</label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/60 pointer-events-none" />
            <Input
              type="date"
              value={params.checkOut}
              min={params.checkIn}
              onChange={e => onChange({ ...params, checkOut: e.target.value })}
              className="pl-9 bg-white/10 border-white/20 text-white [color-scheme:dark] focus:border-amber-400"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-white/70 font-medium uppercase tracking-wide">Adultos</label>
          <div className="relative">
            <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/60 pointer-events-none" />
            <Input
              type="number"
              min={1}
              max={10}
              value={params.adults}
              onChange={e => onChange({ ...params, adults: Math.max(1, parseInt(e.target.value) || 1) })}
              className="pl-9 bg-white/10 border-white/20 text-white focus:border-amber-400"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-white/70 font-medium uppercase tracking-wide">Niños</label>
          <div className="relative">
            <Baby className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/60 pointer-events-none" />
            <Input
              type="number"
              min={0}
              max={10}
              value={params.children}
              onChange={e => onChange({ ...params, children: Math.max(0, parseInt(e.target.value) || 0) })}
              className="pl-9 bg-white/10 border-white/20 text-white focus:border-amber-400"
            />
          </div>
        </div>
        <div className="flex flex-col justify-end">
          <Button
            onClick={onSearch}
            className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold h-10 w-full"
          >
            Buscar disponibilidad
          </Button>
        </div>
      </div>
      {params.checkIn && params.checkOut && (
        <p className="text-white/60 text-sm mt-3 text-center">
          {n} noche{n !== 1 ? "s" : ""} · {params.adults} adulto{params.adults !== 1 ? "s" : ""}
          {params.children > 0 ? ` · ${params.children} niño${params.children !== 1 ? "s" : ""}` : ""}
        </p>
      )}
    </div>
  );
}

// ─── RoomCard ─────────────────────────────────────────────────────────────────
function RoomCard({ room, searchParams, searched }: { room: any; searchParams: SearchParams; searched: boolean }) {
  const n = nightCount(searchParams.checkIn, searchParams.checkOut);
  const pricePerNight = searched && room.pricePerNight != null
    ? room.pricePerNight
    : parseFloat(room.basePrice || "0");
  const totalPrice = pricePerNight * n;

  const isUnavailable = searched && room.isAvailable === false;
  const isLow = searched && room.isAvailable !== false && room.availableUnits <= 2;

  const statusBadge = isUnavailable
    ? <Badge className="absolute top-3 right-3 bg-red-500/20 text-red-300 border border-red-500/30 text-xs">No disponible</Badge>
    : isLow
      ? <Badge className="absolute top-3 right-3 bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs">Últimas {room.availableUnits}</Badge>
      : searched
        ? <Badge className="absolute top-3 right-3 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs">Disponible</Badge>
        : null;

  const detailUrl = `/hotel/${room.slug}?checkIn=${searchParams.checkIn}&checkOut=${searchParams.checkOut}&adults=${searchParams.adults}&children=${searchParams.children}`;

  return (
    <Card className="overflow-hidden bg-white/5 border-white/10 hover:border-amber-400/40 transition-all group">
      <div className="relative h-56 overflow-hidden">
        {room.coverImageUrl ? (
          <img
            src={room.coverImageUrl}
            alt={room.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center">
            <BedDouble className="h-16 w-16 text-slate-500" />
          </div>
        )}
        {room.isFeatured && (
          <Badge className="absolute top-3 left-3 bg-amber-500 text-slate-900 font-bold text-xs">
            <Star className="h-3 w-3 mr-1" /> Destacado
          </Badge>
        )}
        {statusBadge}
      </div>
      <CardContent className="p-5">
        <h3 className="text-lg font-bold text-white mb-1">{room.name}</h3>
        {room.shortDescription && (
          <p className="text-white/60 text-sm mb-3 line-clamp-2">{room.shortDescription}</p>
        )}
        <div className="flex flex-wrap gap-3 text-sm text-white/70 mb-4">
          <span className="flex items-center gap-1">
            <Users className="h-4 w-4" />
            Hasta {room.maxAdults} adultos
          </span>
          {room.maxChildren > 0 && (
            <span className="flex items-center gap-1">
              <Baby className="h-4 w-4" />
              {room.maxChildren} niños
            </span>
          )}
          {room.surfaceM2 && (
            <span className="flex items-center gap-1">
              <Maximize2 className="h-4 w-4" />
              {room.surfaceM2} m²
            </span>
          )}
        </div>
        <div className="flex items-end justify-between">
          <div>
            <div className="text-2xl font-bold text-amber-400">
              {pricePerNight.toFixed(2)} €
              <span className="text-sm font-normal text-white/50"> / noche</span>
            </div>
            {searched && n > 1 && (
              <div className="text-sm text-white/50">{totalPrice.toFixed(2)} € total ({n} noches)</div>
            )}
          </div>
          <Link href={detailUrl}>
            <Button
              size="sm"
              disabled={isUnavailable}
              className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold disabled:opacity-50"
            >
              Ver disponibilidad <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Services strip ───────────────────────────────────────────────────────────
const SERVICIOS = [
  { icon: <Wifi className="w-5 h-5" />, label: "WiFi gratuito" },
  { icon: <Coffee className="w-5 h-5" />, label: "Desayuno incluido" },
  { icon: <Car className="w-5 h-5" />, label: "Parking gratuito" },
  { icon: <Waves className="w-5 h-5" />, label: "Acceso al lago" },
  { icon: <Utensils className="w-5 h-5" />, label: "Restaurantes" },
  { icon: <Dumbbell className="w-5 h-5" />, label: "Acceso al SPA" },
];

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Hotel() {
  const [searchParams, setSearchParams] = useState<SearchParams>({
    checkIn: todayStr(),
    checkOut: tomorrowStr(),
    adults: 2,
    children: 0,
  });
  const [activeSearch, setActiveSearch] = useState<SearchParams>(searchParams);
  const [hasSearched, setHasSearched] = useState(false);

  // Always load all rooms for the catalog view
  const allRoomsQuery = trpc.hotel.getRoomTypes.useQuery();

  // Only run availability search when user clicks "Buscar"
  const availabilityQuery = trpc.hotel.searchAvailability.useQuery(activeSearch, {
    enabled: hasSearched,
  });

  const displayRooms = hasSearched ? availabilityQuery.data : allRoomsQuery.data;
  const isLoading = hasSearched ? availabilityQuery.isLoading : allRoomsQuery.isLoading;

  function handleSearch() {
    setActiveSearch({ ...searchParams });
    setHasSearched(true);
  }

  const availableCount = useMemo(() => {
    if (!hasSearched || !displayRooms) return null;
    return (displayRooms as any[]).filter((r: any) => r.isAvailable !== false).length;
  }, [displayRooms, hasSearched]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      {/* Hero */}
      <div className="relative py-28 px-4 text-center overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-20"
          style={{ backgroundImage: "url('https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1600')" }}
        />
        <div className="relative z-10 max-w-4xl mx-auto">
          <div className="flex items-center justify-center gap-1 mb-4">
            {[1,2,3,4,5].map(i => <Star key={i} className="w-5 h-5 fill-amber-400 text-amber-400" />)}
            <span className="ml-2 text-sm text-white/70">Hotel Boutique</span>
          </div>
          <h1 className="text-4xl md:text-6xl font-bold text-white mb-4">Hotel Náyade</h1>
          <p className="text-xl text-white/70 mb-10 max-w-2xl mx-auto">
            Alójate frente al embalse de Los Ángeles de San Rafael. Elige tu tipología y comprueba disponibilidad en tiempo real.
          </p>
          <SearchBar params={searchParams} onChange={setSearchParams} onSearch={handleSearch} />
        </div>
      </div>

      {/* Services strip */}
      <div className="bg-slate-800/60 border-y border-white/10 py-6 px-4">
        <div className="max-w-4xl mx-auto grid grid-cols-3 md:grid-cols-6 gap-4">
          {SERVICIOS.map((s, i) => (
            <div key={i} className="flex flex-col items-center gap-2 text-center">
              <div className="text-amber-400">{s.icon}</div>
              <span className="text-xs text-white/70">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Room grid */}
      <div className="max-w-6xl mx-auto px-4 py-14">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-white text-2xl font-bold">
            {hasSearched
              ? `${availableCount ?? "..."} habitación${availableCount !== 1 ? "es" : ""} disponible${availableCount !== 1 ? "s" : ""}`
              : "Nuestras tipologías de habitación"}
          </h2>
          {hasSearched && (
            <Button
              variant="ghost"
              className="text-white/60 hover:text-white text-sm"
              onClick={() => setHasSearched(false)}
            >
              Ver todas
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => (
              <Card key={i} className="overflow-hidden bg-white/5 border-white/10">
                <Skeleton className="h-56 w-full bg-white/10" />
                <CardContent className="p-5 space-y-3">
                  <Skeleton className="h-5 w-2/3 bg-white/10" />
                  <Skeleton className="h-4 w-full bg-white/10" />
                  <Skeleton className="h-8 w-1/3 bg-white/10" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : displayRooms && (displayRooms as any[]).length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {(displayRooms as any[]).map((room: any) => (
              <RoomCard
                key={room.id}
                room={room}
                searchParams={hasSearched ? activeSearch : searchParams}
                searched={hasSearched}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-20 text-white/50">
            <BedDouble className="h-16 w-16 mx-auto mb-4 opacity-30" />
            <p className="text-xl">
              {hasSearched
                ? "No hay habitaciones disponibles para las fechas seleccionadas."
                : "Las tipologías de habitación estarán disponibles próximamente."}
            </p>
            {hasSearched && (
              <Button
                variant="outline"
                className="mt-4 border-white/20 text-white hover:bg-white/10"
                onClick={() => setHasSearched(false)}
              >
                Ver todas las tipologías
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
