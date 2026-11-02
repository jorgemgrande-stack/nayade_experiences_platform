/**
 * Presentación de diapositivas (portada) de la web de la empresa. Sin dependencias:
 *   - transición de deslizamiento o fundido; avance automático opcional con su intervalo;
 *   - flechas, indicadores, gesto táctil (deslizar) y teclado (flechas izquierda y derecha);
 *   - el avance automático se pausa al pasar el ratón, al enfocar o al tocar, y no existe si la persona prefiere
 *     menos movimiento; en el editor tampoco avanza solo (`editing`);
 *   - imagen específica para móvil opcional; la primera imagen se carga al momento y el resto, sin bloquear.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SlideItem } from "@shared/pageBlocks";
import { prefersReducedMotion } from "./Carousel";

const HEIGHT: Record<string, string> = {
  s: "min-h-[340px] md:min-h-[420px]",
  m: "min-h-[440px] md:min-h-[540px]",
  l: "min-h-[520px] md:min-h-[660px]",
  full: "min-h-[560px] md:min-h-[calc(100svh-5rem)]",
};
const OVERLAY: Record<string, string> = { none: "", light: "bg-black/25", medium: "bg-black/45", strong: "bg-black/65" };
const H_ALIGN: Record<string, string> = { left: "items-start text-left", center: "items-center text-center mx-auto", right: "items-end text-right ml-auto" };
const V_ALIGN: Record<string, string> = { top: "justify-start", center: "justify-center", bottom: "justify-end" };

export interface SlideshowProps {
  slides: SlideItem[];
  height: string;
  transition: "slide" | "fade";
  autoplay: boolean;
  intervalMs: number;
  arrows: boolean;
  dots: boolean;
  overlay: string;
  editing?: boolean;
  /** Contenido de cada diapositiva (títulos y botones), lo pinta quien la usa */
  renderContent: (slide: SlideItem, index: number) => ReactNode;
}

export function Slideshow({ slides, height, transition, autoplay, intervalMs, arrows, dots, overlay, editing, renderContent }: SlideshowProps) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const n = slides.length;
  const go = useCallback((i: number) => setIndex(((i % n) + n) % n), [n]);

  useEffect(() => {
    if (index >= n) setIndex(0);
  }, [n, index]);

  useEffect(() => {
    if (!autoplay || editing || paused || n < 2 || prefersReducedMotion()) return;
    const t = setTimeout(() => go(index + 1), intervalMs);
    return () => clearTimeout(t);
  }, [autoplay, editing, paused, n, index, intervalMs, go]);

  if (!n) return null;
  const fade = transition === "fade";
  return (
    <section
      className={cn("relative overflow-hidden bg-slate-900 text-white", HEIGHT[height] ?? HEIGHT.l)}
      role="region"
      aria-roledescription="presentación"
      aria-label="Presentación de diapositivas"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(index + 1);
        else if (e.key === "ArrowLeft") go(index - 1);
      }}
      onTouchStart={(e) => {
        setPaused(true);
        touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }}
      onTouchEnd={(e) => {
        const t0 = touch.current;
        touch.current = null;
        if (!t0) return;
        const dx = e.changedTouches[0].clientX - t0.x;
        const dy = e.changedTouches[0].clientY - t0.y;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(index + (dx < 0 ? 1 : -1));
      }}
    >
      <div
        className={cn("absolute inset-0", !fade && "flex transition-transform duration-700 ease-out motion-reduce:transition-none")}
        style={fade ? undefined : { transform: `translateX(-${index * 100}%)` }}
      >
        {slides.map((s, i) => {
          const active = i === index;
          return (
            <div
              key={i}
              role="group"
              aria-roledescription="diapositiva"
              aria-label={`${i + 1} de ${n}`}
              aria-hidden={!active}
              inert={!active || undefined}
              className={cn(
                "relative h-full w-full shrink-0",
                fade && "absolute inset-0 transition-opacity duration-700 motion-reduce:transition-none",
                fade && (active ? "opacity-100" : "pointer-events-none opacity-0"),
              )}
            >
              {s.imageUrl ? (
                <picture>
                  {s.mobileImageUrl && <source media="(max-width: 767px)" srcSet={s.mobileImageUrl} />}
                  <img src={s.imageUrl} alt={s.imageAlt} className="absolute inset-0 h-full w-full object-cover" loading={i === 0 ? "eager" : "lazy"} decoding="async" />
                </picture>
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary/80 to-slate-900" aria-hidden />
              )}
              {s.imageUrl && OVERLAY[overlay] && <div className={cn("absolute inset-0", OVERLAY[overlay])} aria-hidden />}
              <div className={cn("container relative flex h-full flex-col py-16 md:py-20", V_ALIGN[s.valign] ?? V_ALIGN.center)}>
                <div className={cn("flex max-w-2xl flex-col gap-4", H_ALIGN[s.align] ?? H_ALIGN.left)}>{renderContent(s, i)}</div>
              </div>
            </div>
          );
        })}
      </div>
      {n > 1 && arrows && (
        <>
          <button
            type="button"
            aria-label="Diapositiva anterior"
            onClick={() => go(index - 1)}
            className="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur transition hover:bg-black/55 md:left-6"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            type="button"
            aria-label="Diapositiva siguiente"
            onClick={() => go(index + 1)}
            className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur transition hover:bg-black/55 md:right-6"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}
      {n > 1 && dots && (
        <div className="absolute inset-x-0 bottom-5 z-10 flex justify-center gap-2" role="tablist" aria-label="Diapositivas">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Ir a la diapositiva ${i + 1}`}
              onClick={() => go(i)}
              className={cn("h-2.5 rounded-full transition-all", i === index ? "w-8 bg-white" : "w-2.5 bg-white/50 hover:bg-white/80")}
            />
          ))}
        </div>
      )}
    </section>
  );
}
