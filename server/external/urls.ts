/**
 * Dominio público del CRM (sirve `/cp/v1`) donde viven la página de aceptación y las vueltas de Stripe de los servicios
 * externos. Va en los correos a los clientes, así que tiene que abrirse sin credenciales:
 *  1. el primer origen https de `CP_ALLOWED_ORIGINS` con dominio PROPIO (no `*.up.railway.app`, que en production está
 *     detrás de la autenticación básica de la pasarela);
 *  2. si no hay ninguno, el dominio conocido del CRM del entorno de Railway;
 *  3. si tampoco, el primer origen https de la lista.
 * Admite barra final, rutas y espacios.
 */
const KNOWN_CRM_ORIGINS: Record<string, string> = {
  production: "https://admin.bigelephant.es",
  live: "https://elephant-source-crm-live.up.railway.app",
};
const RAILWAY_DOMAIN = /\.up\.railway\.app$/i;

export function crmPublicOrigin(env: NodeJS.ProcessEnv): string | null {
  const https: URL[] = [];
  for (const raw of (env.CP_ALLOWED_ORIGINS ?? "").split(/[,\s]+/)) {
    try {
      const u = new URL(raw.trim());
      if (u.protocol === "https:" && !u.username && !u.password) https.push(u);
    } catch {
      // No es una URL: se ignora
    }
  }
  const own = https.find((u) => !RAILWAY_DOMAIN.test(u.hostname));
  if (own) return own.origin;
  return KNOWN_CRM_ORIGINS[(env.RAILWAY_ENVIRONMENT_NAME ?? "").trim().toLowerCase()] ?? https[0]?.origin ?? null;
}
