/**
 * Carrusel de la web de la empresa (imágenes, tarjetas, opiniones, productos). Sin dependencias: desplazamiento
 * nativo con ajuste por elemento (funciona con el dedo, el ratón y el trackpad), flechas, indicadores, teclado y
 * avance automático opcional que se detiene al pasar el ratón, al tocar o al enfocar, y que nunca se activa si la
 * persona prefiere menos movimiento.
 */
import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Elementos a la vista por tamaño de pantalla (móvil, tableta, ordenador). */
export type PerView = { mobile: number; tablet: number; desktop: number };

const ITEM_WIDTH: Record<number, string> = { 1: "basis-full", 2: "basis-1/2", 3: "basis-1/3", 4: "basis-1/4" };
const ITEM_WIDTH_MD: Record<number, string> = { 1: "md:basis-full", 2: "md:basis-1/2", 3: "md:basis-1/3", 4: "md:basis-1/4" };
const ITEM_WIDTH_LG: Record<number, string> = { 1: "lg:basis-full", 2: "lg:basis-1/2", 3: "lg:basis-1/3", 4: "lg:basis-1/4" };

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function Carousel({ children, perView, label, autoplay = false, intervalMs = 5000, className }: { children: ReactNode; perView: PerView; label: string; autoplay?: boolean; intervalMs?: number; className?: string }) {
  const items = Children.toArray(children);
  const track = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [paused, setPaused] = useState(false);

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const n = Math.max(1, Math.ceil(el.scrollWidth / Math.max(1, el.clientWidth) - 0.01));
    setPages(n);
    setPage(Math.min(n - 1, Math.round(el.scrollLeft / Math.max(1, el.clientWidth))));
  }, []);

  useEffect(() => {
    measure();
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, items.length]);

  const go = useCallback((p: number) => {
    const el = track.current;
    if (!el) return;
    const target = ((p % pages) + pages) % pages;
    el.scrollTo({ left: target * el.clientWidth, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [pages]);

  useEffect(() => {
    if (!autoplay || paused || pages < 2 || prefersReducedMotion()) return;
    const t = setInterval(() => go(page + 1), intervalMs);
    return () => clearInterval(t);
  }, [autoplay, paused, pages, page, intervalMs, go]);

  const many = pages > 1;
  return (
    <div
      className={cn("relative", className)}
      role="region"
      aria-roledescription="carrusel"
      aria-label={label}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          go(page + 1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(page - 1);
        }
      }}
    >
      <div
        ref={track}
        tabIndex={0}
        onScroll={measure}
        className="-mx-2 flex snap-x snap-mandatory overflow-x-auto scroll-smooth pb-1 outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-primary/50 motion-reduce:scroll-auto [&::-webkit-scrollbar]:hidden"
      >
        {items.map((child, i) => (
          <div
            key={i}
            className={cn("shrink-0 snap-start px-2", ITEM_WIDTH[perView.mobile], ITEM_WIDTH_MD[perView.tablet], ITEM_WIDTH_LG[perView.desktop])}
            role="group"
            aria-roledescription="elemento"
            aria-label={`${i + 1} de ${items.length}`}
          >
            {child}
          </div>
        ))}
      </div>
      {many && (
        <>
          <button
            type="button"
            onClick={() => go(page - 1)}
            aria-label="Anterior"
            className="absolute left-0 top-1/2 z-10 hidden h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/95 text-foreground shadow-md transition hover:bg-background sm:flex"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => go(page + 1)}
            aria-label="Siguiente"
            className="absolute right-0 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full border border-border bg-background/95 text-foreground shadow-md transition hover:bg-background sm:flex"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <div className="mt-4 flex justify-center gap-2" role="tablist" aria-label="Páginas del carrusel">
            {Array.from({ length: pages }, (_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === page}
                aria-label={`Ir a la página ${i + 1}`}
                onClick={() => go(i)}
                className={cn("h-2 rounded-full transition-all", i === page ? "w-6 bg-primary" : "w-2 bg-foreground/25 hover:bg-foreground/40")}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
