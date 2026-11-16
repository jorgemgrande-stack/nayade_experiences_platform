import { useEffect } from "react";

const SELECTOR = "main[data-finish='editorial'] article, main[data-finish='editorial'] figure, main[data-finish='editorial'] h2";

/**
 * Entrada gradual del contenido en el acabado editorial: tarjetas, imágenes con pie y titulares de sección suben unos
 * píxeles y aparecen al llegar a pantalla (una sola vez, escalonadas). Solo se ocultan los elementos que ya están por
 * debajo de la primera pantalla, así que sin JavaScript, con «menos movimiento» o en una portada nunca queda nada oculto.
 */
export function useEditorialReveal(enabled: boolean, key: string) {
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const seen = new WeakSet<Element>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          io.unobserve(el);
          el.dataset.rv = "1";
          window.setTimeout(() => {
            delete el.dataset.rv;
            el.style.removeProperty("--rv-d");
          }, 1400);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    const scan = () => {
      const fresh = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR)).filter((el) => !seen.has(el));
      const rows = new Map<Element | null, number>();
      for (const el of fresh) {
        seen.add(el);
        if (el.closest(".hero-full, [data-animate], [data-no-reveal]")) continue;
        if (el.getBoundingClientRect().top < window.innerHeight * 0.92) continue;
        const n = rows.get(el.parentElement) ?? 0;
        rows.set(el.parentElement, n + 1);
        el.style.setProperty("--rv-d", `${Math.min(n, 4) * 90}ms`);
        el.dataset.rv = "0";
        io.observe(el);
      }
    };
    scan();
    const main = document.querySelector("main");
    const mo = main ? new MutationObserver(() => scan()) : null;
    if (main && mo) mo.observe(main, { childList: true, subtree: true });
    return () => {
      mo?.disconnect();
      io.disconnect();
      document.querySelectorAll<HTMLElement>("[data-rv]").forEach((el) => {
        delete el.dataset.rv;
        el.style.removeProperty("--rv-d");
      });
    };
  }, [enabled, key]);
}
