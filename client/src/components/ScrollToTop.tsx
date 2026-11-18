import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { scrollToHash } from "@/lib/scrollToHash";

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
      // Hay ancla explícita: se espera a que la sección exista (la página se pinta tras cargar sus bloques) y se
      // desplaza hasta ella; si no aparece, arriba
      return scrollToHash(hash, { onMissing: () => window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }) });
    } else {
      // Sin ancla: scroll instantáneo al top (no smooth para evitar sensación de salto)
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    }
  }, [location]);

  useEffect(() => {
    let cancel: (() => void) | null = null;
    const onHash = () => {
      cancel?.();
      cancel = scrollToHash(window.location.hash);
    };
    window.addEventListener("hashchange", onHash);
    return () => {
      cancel?.();
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  return null;
}
