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
