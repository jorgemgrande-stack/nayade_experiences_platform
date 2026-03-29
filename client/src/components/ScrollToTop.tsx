import { useEffect, useRef } from "react";
import { useLocation } from "wouter";

/**
 * ScrollToTop — Solución global para el bug de scroll en SPA con wouter.
 *
 * CAUSA RAÍZ:
 * - wouter no implementa scroll restoration automático
 * - El navegador mantiene la posición de scroll de la página anterior
 * - history.scrollRestoration="auto" intenta restaurar posiciones del historial
 *
 * SOLUCIÓN:
 * 1. Deshabilitar el scroll restoration automático del navegador (manual control)
 * 2. En cada cambio de ruta: scroll al top SALVO que la URL tenga ancla explícita (#id)
 * 3. Si hay ancla, hacer scroll suave al elemento correspondiente
 */
export default function ScrollToTop() {
  const [location] = useLocation();
  const prevLocation = useRef<string>("");

  // Deshabilitar scroll restoration automático del navegador una sola vez
  useEffect(() => {
    if ("scrollRestoration" in history) {
      history.scrollRestoration = "manual";
    }
  }, []);

  useEffect(() => {
    // Solo actuar si la ruta cambió (evitar doble disparo en mount)
    if (prevLocation.current === location) return;
    prevLocation.current = location;

    // Obtener el hash de la URL actual (window.location.hash, no wouter location)
    const hash = window.location.hash;

    if (hash && hash.length > 1) {
      // Hay ancla explícita: scroll suave al elemento si existe
      const elementId = hash.slice(1); // quitar el #
      // Pequeño delay para que el DOM se haya renderizado
      const timer = setTimeout(() => {
        const el = document.getElementById(elementId);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        } else {
          // El elemento no existe: scroll al top como fallback
          window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
        }
      }, 50);
      return () => clearTimeout(timer);
    } else {
      // Sin ancla: scroll instantáneo al top (no smooth para evitar sensación de salto)
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    }
  }, [location]);

  return null;
}
