import { useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { useMarketingConsent } from '@/hooks/useMarketingConsent';
import { initGA4, trackPageView } from '@/lib/ga4/client';

/**
 * Carga gtag.js y gestiona el tracking de GA4.
 * Dos efectos separados:
 *  1. init — carga el script y registra GA4 UNA sola vez cuando hay consent.
 *  2. page_view — se dispara en cada cambio de ruta (SPA) y en la carga inicial,
 *     deduplicado por URL para evitar doble-fire en re-renders.
 * Montar UNA sola vez en el árbol React (App.tsx).
 */
export function GA4Loader() {
  const hasConsent = useMarketingConsent();
  const [location] = useLocation();
  const lastTrackedUrl = useRef<string | null>(null);

  // ── Efecto 1: inicializar GA4 una sola vez ────────────────────────────────
  useEffect(() => {
    if (!hasConsent) return;
    initGA4();
  }, [hasConsent]);

  // ── Efecto 2: page_view en cada navegación (incluye carga inicial) ─────────
  useEffect(() => {
    if (!hasConsent) return;
    if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
    if (lastTrackedUrl.current === location) return;
    lastTrackedUrl.current = location;
    trackPageView(location, document.title);
  }, [hasConsent, location]);

  return null;
}
