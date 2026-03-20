import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar, Users, Baby } from "lucide-react";

export interface HotelSearchParams {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  childrenAges: number[];
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function nightCount(ci: string, co: string) {
  const diff = new Date(co).getTime() - new Date(ci).getTime();
  return Math.max(1, Math.round(diff / 86400000));
}

interface Props {
  params: HotelSearchParams;
  onChange: (p: HotelSearchParams) => void;
  onSearch: () => void;
  buttonLabel?: string;
}

export default function HotelSearchBar({ params, onChange, onSearch, buttonLabel = "Buscar disponibilidad" }: Props) {
  const n = nightCount(params.checkIn, params.checkOut);

  function handleChildrenCount(newCount: number) {
    const clamped = Math.max(0, Math.min(10, newCount));
    const ages = [...params.childrenAges];
    if (clamped > ages.length) {
      while (ages.length < clamped) ages.push(5);
    } else {
      ages.splice(clamped);
    }
    onChange({ ...params, children: clamped, childrenAges: ages });
  }

  function handleChildAge(idx: number, age: number) {
    const ages = [...params.childrenAges];
    ages[idx] = age;
    onChange({ ...params, childrenAges: ages });
  }

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
              onChange={e => handleChildrenCount(parseInt(e.target.value) || 0)}
              className="pl-9 bg-white/10 border-white/20 text-white focus:border-amber-400"
            />
          </div>
        </div>
        <div className="flex flex-col justify-end">
          <Button
            onClick={onSearch}
            className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold h-10 w-full"
          >
            {buttonLabel}
          </Button>
        </div>
      </div>

      {/* Edades de los niños */}
      {params.children > 0 && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <p className="text-white/60 text-xs uppercase tracking-wide font-medium mb-3 flex items-center gap-1.5">
            <Baby className="h-3.5 w-3.5 text-amber-400" />
            Edad de los niños
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {params.childrenAges.map((age, idx) => (
              <div key={idx} className="flex flex-col gap-1.5">
                <span className="text-white/50 text-xs">Niño {idx + 1}</span>
                <div className="flex items-center gap-1.5 bg-white/10 border border-white/20 rounded-lg px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => handleChildAge(idx, Math.max(0, age - 1))}
                    className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center text-white flex-shrink-0"
                  >
                    <span className="text-xs font-bold leading-none">-</span>
                  </button>
                  <span className="text-white text-sm font-semibold flex-1 text-center whitespace-nowrap">
                    {age === 0 ? "< 1 año" : `${age} año${age !== 1 ? "s" : ""}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleChildAge(idx, Math.min(17, age + 1))}
                    className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center text-white flex-shrink-0"
                  >
                    <span className="text-xs font-bold leading-none">+</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {params.checkIn && params.checkOut && (
        <p className="text-white/60 text-sm mt-3 text-center">
          {n} noche{n !== 1 ? "s" : ""} · {params.adults} adulto{params.adults !== 1 ? "s" : ""}
          {params.children > 0 ? ` · ${params.children} niño${params.children !== 1 ? "s" : ""} (${params.childrenAges.join(", ")} años)` : ""}
        </p>
      )}
    </div>
  );
}
