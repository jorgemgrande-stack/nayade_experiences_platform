/**
 * Dominios de plataforma: bajo ellos las empresas reciben `<etiqueta>.<dominio>`, que el registro da por verificado
 * (lo controla Big Elephant). Por eso solo se acepta un `platform_subdomain` que cuelgue EXACTAMENTE de uno de
 * ellos: una sola etiqueta válida, no reservada, sin comodines.
 *
 *   CP_PLATFORM_DOMAINS=app.bigelephant.es,up.railway.app   (el primero, para las altas nuevas; el resto, transición)
 *   CP_PLATFORM_DOMAIN=up.railway.app                         (alternativa de un solo dominio si no hay lista)
 *
 * Sin ninguna de las dos, no hay comprobación (comportamiento anterior; el arranque lo indica).
 */
import { RegistryError } from "./contract";
import { isPlatformSubdomain, normalizeHost } from "./host";

/** Etiquetas que nunca pueden ser de una empresa. Misma lista que scripts/railway/dominios-app.cjs (lo prueba un test). */
export const RESERVED_PLATFORM_LABELS: ReadonlySet<string> = new Set([
  "www", "admin", "app", "api", "mail", "crm", "cp", "smtp", "imap", "pop", "ftp", "status", "help", "soporte", "static", "cdn",
]);
/** Prefijos de los servicios propios en Railway (p. ej. elephant-source-crm-live.up.railway.app). Igual en dominios-app.cjs. */
export const RESERVED_PLATFORM_PREFIXES: readonly string[] = ["elephant-source-"];
/** ¿Etiqueta reservada para Big Elephant (exacta o por prefijo de servicio propio)? */
export const isReservedPlatformLabel = (label: string) => RESERVED_PLATFORM_LABELS.has(label) || RESERVED_PLATFORM_PREFIXES.some((p) => label.startsWith(p));
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Lista ordenada (sin duplicados) de dominios de plataforma; el primero es el de las altas nuevas. */
export function platformDomainsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.CP_PLATFORM_DOMAINS?.trim() ? env.CP_PLATFORM_DOMAINS : (env.CP_PLATFORM_DOMAIN ?? "");
  const out: string[] = [];
  for (const part of raw.split(",")) {
    if (!part.trim()) continue;
    const d = normalizeHost(part);
    if (!d || d.includes("*") || !d.includes(".")) throw new Error(`Dominio de plataforma no válido: «${part.trim()}»`);
    if (!out.includes(d)) out.push(d);
  }
  return out;
}

/** Dominio de las altas nuevas (`<empresa>.<dominio>`), o `undefined` si no hay ninguno configurado. */
export const primaryPlatformDomain = (env: NodeJS.ProcessEnv = process.env) => platformDomainsFromEnv(env)[0];

/**
 * Comprueba que `domain` (ya normalizado) es `<etiqueta>.<uno de los dominios>`. Lanza `invalid_domain` si no.
 * Con la lista vacía no comprueba nada.
 */
export function assertPlatformSubdomain(domain: string, platformDomains: readonly string[]): void {
  if (!platformDomains.length) return;
  const base = platformDomains.find((p) => isPlatformSubdomain(domain, p));
  if (!base) throw new RegistryError("invalid_domain", `Un subdominio de plataforma debe ser <empresa>.${platformDomains[0]}`);
  const label = domain.slice(0, -(base.length + 1));
  if (!LABEL.test(label)) throw new RegistryError("invalid_domain", "La etiqueta del subdominio no es válida (minúsculas, cifras y guiones; máx. 63)");
  if (isReservedPlatformLabel(label)) throw new RegistryError("invalid_domain", "Etiqueta reservada para Big Elephant");
}
