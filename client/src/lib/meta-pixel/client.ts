import { getFbp, getFbc } from './cookies';

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
  }
}

export interface UserData {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  postalCode?: string;
  country?: string;
}

export function generateEventId(): string {
  return `${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Dispara un evento en Pixel (cliente) Y en CAPI (servidor) con el mismo event_id.
 * Pasa options.eventId cuando necesites un event_id determinístico (ej: Purchase con merchantOrder).
 */
export async function trackEvent(
  eventName: string,
  customData: Record<string, unknown> = {},
  userData: UserData = {},
  options: { eventId?: string } = {}
): Promise<string> {
  const eventId = options.eventId ?? generateEventId();
  const eventSourceUrl = typeof window !== 'undefined' ? window.location.href : '';

  // 1. Pixel cliente
  if (typeof window !== 'undefined' && typeof window.fbq === 'function') {
    window.fbq('track', eventName, customData, { eventID: eventId });
  }

  // 2. CAPI servidor — mismo event_id para deduplicación
  try {
    await fetch('/api/meta-capi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_name: eventName,
        event_id: eventId,
        event_source_url: eventSourceUrl,
        custom_data: customData,
        user_data: {
          ...userData,
          fbp: getFbp(),
          fbc: getFbc(),
        },
      }),
    });
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error('[Meta CAPI] Send failed:', error);
    }
  }

  return eventId;
}
