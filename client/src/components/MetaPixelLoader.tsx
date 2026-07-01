import { useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { useMarketingConsent } from '@/hooks/useMarketingConsent';

function writeFbcCookie(fbclid: string): void {
  if (document.cookie.includes('_fbc=')) return; // preservar primer toque
  const value = `fb.1.${Date.now()}.${fbclid}`;
  const expires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `_fbc=${value}; path=/; expires=${expires}; domain=.skicenter.es; SameSite=Lax`;
}

const PIXEL_ID = (import.meta.env.VITE_META_PIXEL_ID as string | undefined) || '1542400900841433';

/**
 * Carga fbevents.js y gestiona el tracking de Meta Pixel.
 * Dos efectos separados:
 *  1. init — carga el script y registra el pixel UNA sola vez.
 *     NO dispara PageView aquí para evitar doble-fire en versiones de
 *     fbevents.js que auto-registran PageView al procesar la cola de init.
 *  2. PageView — se dispara en cada cambio de ruta (SPA) y en la carga inicial,
 *     deduplicado por URL para evitar que un re-render lo duplique.
 * Montar UNA sola vez en el árbol React (App.tsx).
 */
export function MetaPixelLoader() {
  const hasConsent = useMarketingConsent();
  const [location] = useLocation();
  const lastTrackedUrl = useRef<string | null>(null);
  const fbclidRef = useRef<string | null>(null);

  // ── Efecto 0: capturar fbclid de la URL al montar (antes del consent) ────
  // Almacena el valor en memoria para escribir la cookie cuando llegue el consent.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fbclid = params.get('fbclid');
    if (fbclid) fbclidRef.current = fbclid;
  }, []);

  // ── Efecto 0b: escribir _fbc cuando se concede el consent ────────────────
  // Solo escribe si hay fbclid en memoria y _fbc no existe aún (primer toque).
  useEffect(() => {
    if (!hasConsent) return;
    if (fbclidRef.current) writeFbcCookie(fbclidRef.current);
  }, [hasConsent]);

  // ── Efecto 1: inicializar fbq una sola vez ────────────────────────────────
  useEffect(() => {
    if (!hasConsent) return;
    if (typeof window === 'undefined') return;
    if (window.fbq) return; // ya inicializado

    const n: ((...args: unknown[]) => void) & {
      callMethod?: (...args: unknown[]) => void;
      queue: unknown[];
      loaded: boolean;
      version: string;
      push: ((...args: unknown[]) => void) & { queue: unknown[] };
    } = Object.assign(
      (...args: unknown[]) => {
        if (n.callMethod) n.callMethod(...args);
        else n.queue.push(args);
      },
      { queue: [] as unknown[], loaded: true, version: '2.0' } as const
    ) as typeof n;

    n.push = n;
    if (!window._fbq) window._fbq = n;
    window.fbq = n;

    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(script);

    window.fbq('init', PIXEL_ID);
    // PageView lo dispara el Efecto 2 para evitar doble-fire
  }, [hasConsent]);

  // ── Efecto 2: PageView en cada navegación (incluye carga inicial) ─────────
  useEffect(() => {
    if (!hasConsent) return;
    if (typeof window === 'undefined' || typeof window.fbq !== 'function') return;
    // Deduplicar por URL: evita doble-fire si el efecto re-corre sin cambio real
    if (lastTrackedUrl.current === location) return;
    lastTrackedUrl.current = location;
    window.fbq('track', 'PageView');
  }, [hasConsent, location]);

  return null;
}
