import { useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { useMarketingConsent } from '@/hooks/useMarketingConsent';
import { initGA4, updateGA4Consent, trackPageView } from '@/lib/ga4/client';

/**
 * Gestiona el ciclo de vida de GA4 con Consent Mode v2 (EEA/RGPD).
 *
 * Tres efectos separados:
 *  1. init — carga gtag.js SIEMPRE al montar (con consent denied por defecto).
 *     Consent Mode v2 requiere que el stub esté registrado antes de cualquier
 *     evento para poder procesar el consent('update') posterior.
 *  2. consent update — cuando el usuario acepta cookies llama consent('update',
 *     {all: granted}) que desbloquea los hits retenidos.
 *  3. page_view — se dispara en cada cambio de ruta SOLO con consent,
 *     deduplicado por URL para evitar doble-fire en re-renders.
 *
 * Montar UNA sola vez en el árbol React (App.tsx).
 */
export function GA4Loader() {
  const hasConsent = useMarketingConsent();
  const [location] = useLocation();
  const lastTrackedUrl = useRef<string | null>(null);

  // ── Efecto 1: cargar gtag.js siempre al montar ────────────────────────────
  // NO detrás de consent: Consent Mode v2 necesita el stub cargado para
  // poder procesar consent('update') cuando el usuario acepte.
  useEffect(() => {
    initGA4();
  }, []);

  // ── Efecto 2: actualizar consent cuando el usuario acepta ─────────────────
  useEffect(() => {
    updateGA4Consent(hasConsent === true);
  }, [hasConsent]);

  // ── Efecto 3: page_view en cada navegación (incluye carga inicial) ─────────
  useEffect(() => {
    if (!hasConsent) return;
    if (location.startsWith('/admin')) return;
    if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
    if (lastTrackedUrl.current === location) return;
    lastTrackedUrl.current = location;
    trackPageView(location, document.title);
  }, [hasConsent, location]);

  return null;
}
