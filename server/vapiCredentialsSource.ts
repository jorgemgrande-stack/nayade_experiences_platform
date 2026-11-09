import { MIN_WEBHOOK_SECRET_LENGTH } from "./_core/webhookSecret";
/**
 * De dónde salen la clave de Vapi y la clave de verificación del webhook (server/vapiWebhookRouter.ts y
 * server/routers/vapiCalls.ts).
 *
 *  - Multiempresa: SOLO la bóveda de la empresa (proveedor `vapi`). Ni `site_settings` ni la clave de GHL: así, al
 *    desconectar en «Llamadas IA › Puesta en marcha» (que vacía la bóveda) el webhook queda inactivo de verdad.
 *  - Instalación única (Náyade): como siempre, variable de entorno, después `site_settings` y, para el webhook, la clave
 *    de GHL como último recurso.
 */
export function configuredVapiWebhookSecret(o: { multi: boolean; vault: string | undefined; legacy: string | undefined; ghl: string | undefined }): string {
  if (o.multi) return o.vault || "";
  return o.vault || o.legacy || o.ghl || "";
}

export function configuredVapiApiKey(o: { multi: boolean; vault: string | undefined; legacy: string | undefined }): string {
  if (o.multi) return o.vault || "";
  return o.vault || o.legacy || "";
}

/**
 * Lo que «Llamadas IA › Configuración» puede ver de las credenciales: nunca un valor en claro. De la clave solo los 4
 * últimos caracteres; de la clave de verificación, los 4 últimos solo si es utilizable (24+): de una corta, nada.
 */
export function maskedVapiCredentials(apiKey: string, webhookSecret: string): { hasApiKey: boolean; apiKeyMasked: string; hasWebhookSecret: boolean; webhookSecret: string } {
  const usable = webhookSecret.trim().length >= MIN_WEBHOOK_SECRET_LENGTH;
  return {
    hasApiKey: !!apiKey,
    apiKeyMasked: apiKey ? `••••${apiKey.slice(-4)}` : "",
    hasWebhookSecret: !!webhookSecret,
    webhookSecret: !webhookSecret ? "" : usable ? `••••${webhookSecret.slice(-4)}` : "••••",
  };
}
