/**
 * ¿Es la web de una empresa en la plataforma multiempresa? El servidor lo marca en el HTML
 * (`<meta name="elephant-tenant-site">`, ver server/_core/vite.ts) para que se sepa antes de cargar nada.
 * En esa web no se carga la analítica ni el pixel de la instalación original.
 */
export function isTenantSite(): boolean {
  return typeof document !== "undefined" && !!document.querySelector('meta[name="elephant-tenant-site"]');
}
