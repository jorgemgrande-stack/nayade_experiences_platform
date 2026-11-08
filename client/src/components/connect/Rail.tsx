/**
 * Carril horizontal del marketplace: desplazamiento nativo con scroll-snap (táctil y rueda), flechas discretas que
 * solo aparecen cuando hay hacia dónde ir, indicadores de página y teclado (← → Inicio Fin con el carril enfocado).
 * Con «reducir movimiento» el desplazamiento es instantáneo (ver `.cx-rail` y la regla global de connectStage.css).
 */
import { Children, isValidElement, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { railOffset, railPage, railPages } from "@shared/marketplaceVisual";

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function Rail({ label, children, itemClassName }: { label: string; children: ReactNode; itemClassName?: string }) {
  const ref = useRef<HTMLUListElement | null>(null);
  const [m, setM] = useState({ page: 0, pages: 1, atStart: true, atEnd: true });
  const items = Children.toArray(children);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const next = { page: railPage(scrollLeft, scrollWidth, clientWidth), pages: railPages(scrollWidth, clientWidth), atStart: scrollLeft <= 6, atEnd: scrollLeft + clientWidth >= scrollWidth - 6 };
    setM((prev) => (prev.page === next.page && prev.pages === next.pages && prev.atStart === next.atStart && prev.atEnd === next.atEnd ? prev : next));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro?.disconnect();
    };
  }, [measure, items.length]);

  const toPage = (p: number) => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ left: railOffset(p, el.scrollWidth, el.clientWidth), behavior: reducedMotion() ? "auto" : "smooth" });
  };
  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    // Solo cuando el foco está en el propio carril (dentro de una tarjeta, las flechas son del navegador)
    if (e.target !== e.currentTarget) return;
    if (e.key === "ArrowRight") toPage(m.page + 1);
    else if (e.key === "ArrowLeft") toPage(m.page - 1);
    else if (e.key === "Home") toPage(0);
    else if (e.key === "End") toPage(m.pages - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div className="relative">
      <ul
        ref={ref}
        tabIndex={0}
        aria-label={label}
        onKeyDown={onKey}
        className="cx-rail -mx-1 -my-4 flex scroll-px-1 snap-x snap-mandatory gap-4 overflow-x-auto px-1 py-4 sm:gap-5"
      >
        {items.map((child, i) => (
          <li key={isValidElement(child) && child.key != null ? child.key : i} className={cn("w-[84%] shrink-0 snap-start sm:w-[calc((100%-1.25rem)/2)] lg:w-[calc((100%-2.5rem)/3)] 2xl:w-[calc((100%-3.75rem)/4)]", itemClassName)}>
            {child}
          </li>
        ))}
      </ul>
      {m.pages > 1 && (
        <>
          <button
            type="button"
            onClick={() => toPage(m.page - 1)}
            aria-label={`Anteriores de ${label}`}
            disabled={m.atStart}
            className={cn("cx-rail-arrow absolute -left-3 top-[38%] z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full shadow-lg transition-opacity md:inline-flex", m.atStart && "pointer-events-none opacity-0")}
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => toPage(m.page + 1)}
            aria-label={`Siguientes de ${label}`}
            disabled={m.atEnd}
            className={cn("cx-rail-arrow absolute -right-3 top-[38%] z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full shadow-lg transition-opacity md:inline-flex", m.atEnd && "pointer-events-none opacity-0")}
          >
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
          {/* Con muchas páginas (móvil), un contador en vez de una fila de puntos */}
          <p className={cn("mt-1 text-center text-xs font-semibold tabular-nums text-muted-foreground", m.pages > 8 ? "sm:hidden" : "hidden")} aria-hidden="true">
            {m.page + 1} / {m.pages}
          </p>
          <div className={cn("mt-1 justify-center gap-1", m.pages > 8 ? "hidden sm:flex" : "flex")} role="group" aria-label={`Páginas de ${label}`}>
            {Array.from({ length: m.pages }, (_, p) => (
              <button key={p} type="button" onClick={() => toPage(p)} aria-label={`Página ${p + 1} de ${m.pages}`} aria-current={p === m.page ? "true" : undefined} className="inline-flex h-6 w-6 items-center justify-center rounded-full">
                <span aria-hidden="true" className={cn("block h-1.5 rounded-full transition-all", p === m.page ? "w-5 bg-primary" : "w-1.5 bg-foreground/30")} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
