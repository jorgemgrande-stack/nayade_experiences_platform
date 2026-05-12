import { useEffect } from 'react';
import { useMarketingConsent } from '@/hooks/useMarketingConsent';

// El pixel ID es público (visible en el HTML de cualquier web que lo use).
// Usamos la env var como primaria y el valor real como fallback para que
// nunca falle por una variable ausente en el build de Railway.
const PIXEL_ID = (import.meta.env.VITE_META_PIXEL_ID as string | undefined) || '1542400900841433';

/**
 * Carga fbevents.js y dispara PageView solo cuando hay consentimiento de marketing.
 * Si el usuario rechaza cookies, el JS de Meta nunca se descarga (cumplimiento RGPD).
 * Montar UNA sola vez en el árbol React (App.tsx).
 */
export function MetaPixelLoader() {
  const hasConsent = useMarketingConsent();

  useEffect(() => {
    if (!hasConsent) return;
    if (typeof window === 'undefined') return;
    if (window.fbq) return; // ya cargado

    // Boilerplate oficial de Meta Pixel (adaptado a TypeScript)
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
    window.fbq('track', 'PageView');
  }, [hasConsent]);

  return null;
}
