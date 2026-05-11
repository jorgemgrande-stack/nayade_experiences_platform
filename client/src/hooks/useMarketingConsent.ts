import { useState, useEffect } from 'react';

const CONSENT_KEY = 'nayade_cookie_consent';

/**
 * Lee el consentimiento de marketing del sistema CookieBanner.
 * Shape real: { accepted, necessary, analytics, marketing, preferences, timestamp }
 * Se actualiza cuando el usuario acepta/rechaza (evento cookieConsentChanged),
 * o cuando otra pestaña cambia localStorage (evento storage).
 */
export function useMarketingConsent(): boolean {
  const [hasConsent, setHasConsent] = useState(false);

  useEffect(() => {
    const read = () => {
      try {
        const raw = localStorage.getItem(CONSENT_KEY);
        if (!raw) { setHasConsent(false); return; }
        const parsed = JSON.parse(raw);
        setHasConsent(parsed?.marketing === true);
      } catch {
        setHasConsent(false);
      }
    };

    read();
    window.addEventListener('storage', read);
    window.addEventListener('cookieConsentChanged', read);
    return () => {
      window.removeEventListener('storage', read);
      window.removeEventListener('cookieConsentChanged', read);
    };
  }, []);

  return hasConsent;
}
