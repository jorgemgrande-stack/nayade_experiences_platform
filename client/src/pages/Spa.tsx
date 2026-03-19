import { useState, useMemo } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import PublicLayout from "@/components/PublicLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Calendar, Users, ChevronRight, Star, Clock, Search,
  Sparkles, Leaf, Waves,
} from "lucide-react";

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

interface SpaSearch {
  date: string;
  persons: number;
  query: string;
}

function SpaSearchBar({ params, onChange, onSearch }: {
  params: SpaSearch;
  onChange: (p: SpaSearch) => void;
  onSearch: () => void;
}) {
  return (
    <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 md:p-6 border border-white/20 shadow-xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="flex flex-col gap-1 lg:col-span-2">
          <label className="text-xs text-white/70 font-medium uppercase tracking-wide">Tratamiento</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/60 pointer-events-none" />
            <Input
              placeholder="Masaje, circuito, facial..."
              value={params.query}
              onChange={e => onChange({ ...params, query: e.target.value })}
              className="pl-9 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-teal-400"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-white/70 font-medium uppercase tracking-wide">Fecha</label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/60 pointer-events-none" />
            <Input
              type="date"
              value={params.date}
              min={todayStr()}
              onChange={e => onChange({ ...params, date: e.target.value })}
              className="pl-9 bg-white/10 border-white/20 text-white [color-scheme:dark] focus:border-teal-400"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-white/70 font-medium uppercase tracking-wide">Personas</label>
          <div className="relative">
            <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/60 pointer-events-none" />
            <Input
              type="number"
              min={1}
              max={6}
              value={params.persons}
              onChange={e => onChange({ ...params, persons: Math.max(1, parseInt(e.target.value) || 1) })}
              className="pl-9 bg-white/10 border-white/20 text-white focus:border-teal-400"
            />
          </div>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button
          onClick={onSearch}
          className="bg-teal-500 hover:bg-teal-400 text-slate-900 font-bold px-8"
        >
          Ver horarios disponibles
        </Button>
      </div>
    </div>
  );
}

function TreatmentCard({ treatment, date, persons }: { treatment: any; date: string; persons: number }) {
  const slotsQuery = trpc.spa.getAvailableSlots.useQuery(
    { treatmentId: treatment.id, date },
    { enabled: !!date }
  );

  const availableSlots = slotsQuery.data ?? [];
  const hasSlots = availableSlots.length > 0;
  const isLastSlot = hasSlots && availableSlots.length === 1;

  const detailUrl = `/contacto?servicio=spa&tratamiento=${encodeURIComponent(treatment.name)}&fecha=${date}&personas=${persons}`;

  return (
    <Card className="overflow-hidden bg-white/5 border-white/10 hover:border-teal-400/40 transition-all group">
      <div className="relative h-52 overflow-hidden">
        {treatment.coverImageUrl ? (
          <img
            src={treatment.coverImageUrl}
            alt={treatment.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-teal-900/50 to-slate-800 flex items-center justify-center">
            <Sparkles className="h-16 w-16 text-teal-500/40" />
          </div>
        )}
        {treatment.isFeatured && (
          <Badge className="absolute top-3 left-3 bg-teal-500 text-slate-900 font-bold text-xs">
            <Star className="h-3 w-3 mr-1" /> Destacado
          </Badge>
        )}
        {date && (
          <Badge className={`absolute top-3 right-3 text-xs border ${
            !hasSlots
              ? "bg-red-500/20 text-red-300 border-red-500/30"
              : isLastSlot
                ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                : "bg-teal-500/20 text-teal-300 border-teal-500/30"
          }`}>
            {slotsQuery.isLoading
              ? "..."
              : !hasSlots
                ? "Sin horarios"
                : isLastSlot
                  ? "Última plaza"
                  : `${availableSlots.length} horarios`}
          </Badge>
        )}
      </div>
      <CardContent className="p-5">
        <h3 className="text-lg font-bold text-white mb-1">{treatment.name}</h3>
        {treatment.shortDescription && (
          <p className="text-white/60 text-sm mb-3 line-clamp-2">{treatment.shortDescription}</p>
        )}
        <div className="flex flex-wrap gap-3 text-sm text-white/70 mb-4">
          <span className="flex items-center gap-1">
            <Clock className="h-4 w-4 text-teal-400" />
            {treatment.durationMinutes} min
          </span>
          <span className="flex items-center gap-1">
            <Users className="h-4 w-4 text-teal-400" />
            Hasta {treatment.maxPersons} persona{treatment.maxPersons !== 1 ? "s" : ""}
          </span>
        </div>
        {date && hasSlots && (
          <div className="flex flex-wrap gap-2 mb-4">
            {availableSlots.slice(0, 3).map((slot: any) => (
              <Badge key={slot.id} className="bg-teal-500/20 text-teal-300 border border-teal-500/30 text-xs">
                {slot.startTime}
              </Badge>
            ))}
            {availableSlots.length > 3 && (
              <Badge className="bg-white/10 text-white/50 text-xs">+{availableSlots.length - 3} más</Badge>
            )}
          </div>
        )}
        <div className="flex items-end justify-between">
          <div className="text-2xl font-bold text-teal-400">
            {parseFloat(treatment.price || "0").toFixed(2)} €
            <span className="text-sm font-normal text-white/50"> / persona</span>
          </div>
          <Link href={detailUrl}>
            <Button size="sm" className="bg-teal-500 hover:bg-teal-400 text-slate-900 font-bold">
              Reservar <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function CategoryChips({ categories, selected, onSelect }: {
  categories: any[];
  selected: number | null;
  onSelect: (id: number | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => onSelect(null)}
        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
          selected === null ? "bg-teal-500 text-slate-900" : "bg-white/10 text-white/70 hover:bg-white/20"
        }`}
      >
        Todos
      </button>
      {categories.map(cat => (
        <button
          key={cat.id}
          onClick={() => onSelect(cat.id)}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            selected === cat.id ? "bg-teal-500 text-slate-900" : "bg-white/10 text-white/70 hover:bg-white/20"
          }`}
        >
          {cat.name}
        </button>
      ))}
    </div>
  );
}

export default function Spa() {
  const [searchParams, setSearchParams] = useState<SpaSearch>({
    date: todayStr(),
    persons: 1,
    query: "",
  });
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);

  const categoriesQuery = trpc.spa.getCategories.useQuery();
  const treatmentsQuery = trpc.spa.getTreatments.useQuery({ categoryId: selectedCategory ?? undefined });

  const filteredTreatments = useMemo(() => {
    const list = treatmentsQuery.data ?? [];
    if (!searchParams.query) return list;
    const q = searchParams.query.toLowerCase();
    return list.filter((t: any) =>
      t.name.toLowerCase().includes(q) ||
      (t.shortDescription ?? "").toLowerCase().includes(q)
    );
  }, [treatmentsQuery.data, searchParams.query]);

  return (
    <PublicLayout fullWidthHero>
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-teal-950/30 to-slate-900">
      {/* Hero */}
      <div className="relative pt-40 pb-20 px-4 text-center overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-15"
          style={{ backgroundImage: "url('https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=1600')" }}
        />
        <div className="relative z-10 max-w-4xl mx-auto">
          <Badge className="bg-teal-500/20 text-teal-300 border-teal-500/30 mb-4">Spa & Wellness</Badge>
          <h1 className="text-4xl md:text-6xl font-bold text-white mb-4">Bienestar en plena naturaleza</h1>
          <p className="text-xl text-white/70 mb-10 max-w-2xl mx-auto">
            Circuitos, masajes y tratamientos exclusivos. Elige tu experiencia y reserva tu horario en tiempo real.
          </p>
          <SpaSearchBar params={searchParams} onChange={setSearchParams} onSearch={() => setHasSearched(true)} />
        </div>
      </div>

      {/* Highlights strip */}
      <div className="bg-slate-800/60 border-y border-white/10 py-6 px-4">
        <div className="max-w-4xl mx-auto grid grid-cols-3 gap-4">
          {[
            { icon: <Sparkles className="w-5 h-5" />, label: "Tratamientos exclusivos" },
            { icon: <Leaf className="w-5 h-5" />, label: "Productos naturales" },
            { icon: <Waves className="w-5 h-5" />, label: "Circuito de aguas" },
          ].map((s, i) => (
            <div key={i} className="flex flex-col items-center gap-2 text-center">
              <div className="text-teal-400">{s.icon}</div>
              <span className="text-xs text-white/70">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Treatments grid */}
      <div className="max-w-6xl mx-auto px-4 py-14">
        {categoriesQuery.data && categoriesQuery.data.length > 0 && (
          <div className="mb-8">
            <CategoryChips
              categories={categoriesQuery.data}
              selected={selectedCategory}
              onSelect={setSelectedCategory}
            />
          </div>
        )}

        <div className="flex items-center justify-between mb-6">
          <h2 className="text-white text-2xl font-bold">
            {hasSearched
              ? `Horarios disponibles para ${searchParams.date}`
              : "Nuestros tratamientos y circuitos"}
          </h2>
          {hasSearched && (
            <Button
              variant="ghost"
              className="text-white/60 hover:text-white text-sm"
              onClick={() => setHasSearched(false)}
            >
              Ver todos
            </Button>
          )}
        </div>

        {treatmentsQuery.isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => (
              <Card key={i} className="overflow-hidden bg-white/5 border-white/10">
                <Skeleton className="h-52 w-full bg-white/10" />
                <CardContent className="p-5 space-y-3">
                  <Skeleton className="h-5 w-2/3 bg-white/10" />
                  <Skeleton className="h-4 w-full bg-white/10" />
                  <Skeleton className="h-8 w-1/3 bg-white/10" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredTreatments.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredTreatments.map((treatment: any) => (
              <TreatmentCard
                key={treatment.id}
                treatment={treatment}
                date={hasSearched ? searchParams.date : ""}
                persons={searchParams.persons}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-20 text-white/50">
            <Sparkles className="h-16 w-16 mx-auto mb-4 opacity-30" />
            <p className="text-xl">
              {hasSearched
                ? "No hay tratamientos disponibles para los criterios seleccionados."
                : "Los tratamientos estarán disponibles próximamente."}
            </p>
          </div>
        )}
      </div>
    </div>
    </PublicLayout>
  );
}
