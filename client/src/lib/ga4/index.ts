export { initGA4, updateGA4Consent, trackPageView, trackEvent } from './client';

import { trackEvent } from './client';

export function trackCTAClick(cta: string, location: string): void {
  trackEvent('cta_click', { cta, location });
}

export function trackPhoneClick(phone: string): void {
  trackEvent('phone_click', { phone });
}

export function trackWhatsAppClick(phone: string): void {
  trackEvent('whatsapp_click', { phone });
}

export function trackLeadFormSubmit(formType: string, value?: number): void {
  trackEvent('generate_lead', { form_type: formType, value });
}
