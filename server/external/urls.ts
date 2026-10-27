/**
 * Dominio público del CRM (sirve `/cp/v1`) donde viven la página de aceptación y las vueltas de Stripe de los servicios
 * externos: el primer origen https de `CP_ALLOWED_ORIGINS` (admite barra final, rutas y espacios) o, si no hay ninguno, el
 * dominio conocido del CRM del entorno de Railway.
 */
const KNOWN_CRM_ORIGINS: Record<string, string> = {
  production: "https://admin.bigelephant.es",
  live: "https://elephant-source-crm-live.up.railway.app",
};

export function crmPublicOrigin(env: NodeJS.ProcessEnv): string | null {
  for (const raw of (env.CP_ALLOWED_ORIGINS ?? "").split(/[,\s]+/)) {
    try {
      const u = new URL(raw.trim());
      if (u.protocol === "https:" && !u.username && !u.password) return u.origin;
    } catch {
      // No es una URL: se ignora
    }
  }
  return KNOWN_CRM_ORIGINS[(env.RAILWAY_ENVIRONMENT_NAME ?? "").trim().toLowerCase()] ?? null;
}
