/**
 * Elephant Studio: guía ligera de primeros pasos. Cuatro pasos que se marcan solos al hacerlos (empezar la página,
 * personalizar, ver el móvil y publicar), en una tarjeta plegable de la biblioteca; nunca bloquea el editor ni publica
 * nada. Se puede omitir, desaparece al terminarla y se recupera desde Ayuda. Solo en el navegador de cada persona.
 */
import { useEffect, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type GuideStep = "start" | "customize" | "mobile" | "publish";
type GuideState = { dismissed?: boolean; collapsed?: boolean; done?: Partial<Record<GuideStep, boolean>> };

const KEY = "elephant-studio-guia";
const EVENT = "elephant-studio-guia";

function read(): GuideState {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") ?? {};
  } catch {
    return {};
  }
}
function write(next: GuideState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* sin almacenamiento: la guía vale solo para esta sesión */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Marca un paso como hecho (no hace nada si ya lo estaba). */
export function markGuide(step: GuideStep) {
  const s = read();
  if (s.done?.[step]) return;
  write({ ...s, done: { ...s.done, [step]: true } });
}

/** Vuelve a mostrar la guía (desde Ayuda), conservando lo ya hecho. */
export function reopenGuide() {
  write({ ...read(), dismissed: false, collapsed: false });
}

const STEPS: ReadonlyArray<{ key: GuideStep; title: string; text: string }> = [
  { key: "start", title: "Elige una plantilla o empieza desde cero", text: "Abajo tienes plantillas de página, secciones y elementos. Haz clic o arrástralos a la página." },
  { key: "customize", title: "Personaliza textos, imágenes y colores", text: "Doble clic en un texto para escribir; clic en una imagen para cambiarla. Los colores de tu marca, en «Colores y letra»." },
  { key: "mobile", title: "Comprueba cómo se ve en el móvil", text: "Cambia al móvil con el botón de arriba para revisar la página en pequeño." },
  { key: "publish", title: "Guarda y publica", text: "Tu borrador se guarda solo y tu web no cambia hasta que pulses «Publicar»." },
];

export function GuideCard({ onTemplates, onBlank, onColors, onMobile }: { onTemplates: () => void; onBlank: () => void; onColors: () => void; onMobile: () => void }) {
  const [state, setState] = useState(read);
  useEffect(() => {
    const sync = () => setState(read());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  const done = STEPS.filter((s) => state.done?.[s.key]).length;
  if (state.dismissed || done === STEPS.length) return null;
  const next = STEPS.find((s) => !state.done?.[s.key]);
  const actions: Partial<Record<GuideStep, React.ReactNode>> = {
    start: (
      <>
        <Button size="sm" className="h-7 bg-[#5b5bf6] px-2.5 text-xs text-white hover:bg-[#4a4ae0]" onClick={onTemplates}>
          Ver plantillas
        </Button>
        <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={onBlank}>
          Añadir un bloque
        </Button>
      </>
    ),
    customize: (
      <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={onColors}>
        Colores y letra
      </Button>
    ),
    mobile: (
      <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={onMobile}>
        Ver en el móvil
      </Button>
    ),
  };
  return (
    <section className="mx-3 mt-3 rounded-xl border border-[#5b5bf6]/40 bg-[#5b5bf6]/[0.06]" aria-label="Primeros pasos">
      <div className="flex items-center gap-1 px-3 py-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b5bf6]"
          aria-expanded={!state.collapsed}
          onClick={() => write({ ...state, collapsed: !state.collapsed })}
        >
          <span className="whitespace-nowrap text-sm font-semibold">Primeros pasos</span>
          <span className="whitespace-nowrap rounded-full bg-[#5b5bf6]/15 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-[#7c7cff]">
            {done} de {STEPS.length}
          </span>
          <ChevronDown className={cn("ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform", state.collapsed && "-rotate-90")} aria-hidden />
        </button>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b5bf6]"
          aria-label="Omitir la guía (puedes recuperarla desde Ayuda)"
          title="Omitir la guía (puedes recuperarla desde Ayuda)"
          onClick={() => write({ ...state, dismissed: true })}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {!state.collapsed && (
        <ol className="space-y-1 px-2 pb-2">
          {STEPS.map((s, i) => {
            const ok = !!state.done?.[s.key];
            const current = next?.key === s.key;
            return (
              <li key={s.key} className={cn("rounded-lg px-2 py-1.5", current && "bg-background/70")}>
                <div className="flex items-start gap-2">
                  <span
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                      ok ? "bg-emerald-500 text-white" : current ? "bg-[#5b5bf6] text-white" : "bg-muted text-muted-foreground",
                    )}
                    aria-hidden
                  >
                    {ok ? <Check className="h-3 w-3" /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className={cn("block text-xs font-medium leading-snug", ok && "text-muted-foreground line-through")}>
                      {s.title}
                      <span className="sr-only">{ok ? " (hecho)" : ""}</span>
                    </span>
                    {current && <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{s.text}</span>}
                  </span>
                </div>
                {current && actions[s.key] && <div className="ml-6 mt-1.5 flex flex-wrap gap-1.5">{actions[s.key]}</div>}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
