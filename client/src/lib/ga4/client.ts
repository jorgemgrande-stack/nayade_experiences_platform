import { isTenantSite } from '@/lib/tenantSite';

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

const INSTALLATION_MEASUREMENT_ID =
  (import.meta.env.VITE_GA4_MEASUREMENT_ID as string | undefined) || 'G-8E7HXCGN3P';

let ga4Configured = false;

/**
 * Inicia GA4. En la web de una empresa solo con SU identificador (`tenantMeasurementId`, de su configuración):
 * sin él, nada. Nunca la propiedad de la instalación original ni la de otra empresa.
 */
export function initGA4(tenantMeasurementId?: string | null): void {
  if (typeof window === 'undefined') return;
  if (isTenantSite() && !tenantMeasurementId) return;
  const MEASUREMENT_ID = isTenantSite() ? tenantMeasurementId! : INSTALLATION_MEASUREMENT_ID;
  if (ga4Configured) return;
  ga4Configured = true;

  // Si el HTML no inyectó el stub (entorno de desarrollo sin index.html), lo creamos aquí.
  if (!window.gtag) {
    window.dataLayer = window.dataLayer ?? [];
    window.gtag = function (...args: unknown[]) {
      window.dataLayer!.push(args);
    };
    window.gtag('consent', 'default', {
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
  }

  window.gtag('js', new Date());
  window.gtag('config', MEASUREMENT_ID, {
    anonymize_ip: true,
    send_page_view: false,
  });

  // Sólo añade el script si no viene ya del HTML.
  if (!document.querySelector(`script[src*="gtag/js?id=${MEASUREMENT_ID}"]`)) {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
    document.head.appendChild(script);
  }
}

export function updateGA4Consent(granted: boolean): void {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  const state = granted ? 'granted' : 'denied';
  window.gtag('consent', 'update', {
    analytics_storage: state,
    ad_storage: state,
    ad_user_data: state,
    ad_personalization: state,
  });
}

export function trackPageView(path: string, title: string): void {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  window.gtag('event', 'page_view', {
    page_path: path,
    page_title: title,
    page_location: window.location.href,
  });
}

export function trackEvent(name: string, params?: Record<string, unknown>): void {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  window.gtag('event', name, params);
}
