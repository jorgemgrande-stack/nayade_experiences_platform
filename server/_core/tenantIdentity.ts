/**
 * Identidad de cada empresa cliente (modo multi) leída del registro: nombre, dominio público y
 * entidad fiscal emisora. La marca editable (logotipo, colores, remitente) vive en los ajustes de
 * la propia empresa (`system_settings`, ver `server/tenantBrand.ts`).
 *
 * Reglas:
 *  - La empresa sale SIEMPRE del contexto de la operación (`runWithTenant`); nunca de un parámetro
 *    que pueda venir del cliente. Cada empresa tiene su propia instantánea (`TenantCache`): la
 *    empresa A no puede leer la de B.
 *  - URL pública: un dominio propio solo si está verificado (registro TXT) y activo; si no, el
 *    subdominio de plataforma. Un dominio pendiente o fallido nunca aparece en enlaces.
 *  - Lecturas síncronas (plantillas, `publicBaseUrl()`): solo de la instantánea precargada por
 *    `warmTenantIdentity()` en el borde (petición o tarea). Sin instantánea devuelven `null` y el
 *    llamador conserva su comportamiento anterior.
 *  - single/shadow: nada de esto se usa (`tenantPublicUrl()` y `peekTenantIdentity()` → `null`).
 */
import type { TenantDomain, TenantEvent } from "./tenantRegistry/contract";
import type { TenantRegistryReader } from "./tenantRegistry/store";
import type { FiscalEntity, OrganizationStore } from "../organization/service";
import { isMultiTenant } from "./tenant";
import { TenantCache, currentTenantOrNull } from "./tenantScope";

/** Estado de verificación de un dominio propio, tal y como se muestra a la empresa. */
export type DomainVerificationState = "pending" | "verified" | "failed" | "disabled";

export interface TenantFiscalIdentity {
  entityId: string;
  legalName: string;
  taxId: string;
  country: string;
  address: string | null;
}

export interface TenantRegistryIdentity {
  tenantId: string;
  displayName: string;
  /** Host público (sin esquema) o `null` si la empresa no tiene ninguno servible. */
  publicHost: string | null;
  publicHostKind: TenantDomain["kind"] | null;
  customDomains: { domain: string; state: DomainVerificationState; isPrimary: boolean }[];
  /** Entidad fiscal por defecto (activa) o `null`. */
  fiscal: TenantFiscalIdentity | null;
}

export interface TenantIdentitySource {
  load(tenantId: string): Promise<TenantRegistryIdentity | null>;
}

// ── Reglas puras ───────────────────────────────────────────────────────────

/**
 * Dominio que se usa en los enlaces públicos:
 *  1. Dominio propio verificado y activo (el primario si hay varios).
 *  2. Subdominio de plataforma activo.
 * Un dominio propio pendiente, fallido o desactivado nunca se elige.
 */
export function choosePublicDomain(domains: readonly TenantDomain[]): TenantDomain | null {
  const servible = (d: TenantDomain) => d.status === "active";
  const byPrimary = (a: TenantDomain, b: TenantDomain) => Number(b.isPrimary) - Number(a.isPrimary) || a.domain.localeCompare(b.domain);
  const custom = domains.filter((d) => d.kind === "custom" && servible(d) && d.verifiedAt !== null).sort(byPrimary);
  if (custom[0]) return custom[0];
  const platform = domains.filter((d) => d.kind === "platform_subdomain" && servible(d)).sort(byPrimary);
  return platform[0] ?? null;
}

/**
 * Estado de verificación de un dominio propio. «Fallido» = sigue pendiente y la última
 * comprobación registrada para ese dominio no encontró los registros DNS.
 */
export function domainVerificationState(d: TenantDomain, events: readonly TenantEvent[]): DomainVerificationState {
  if (d.status === "verified" || d.status === "active") return "verified";
  if (d.status === "disabled" || d.status === "removed") return "disabled";
  const last = events
    .filter((e) => e.details?.domain === d.domain && (e.action === "domain.verification_failed" || e.action === "domain.added"))
    .sort((a, b) => a.id - b.id)
    .pop();
  return last?.action === "domain.verification_failed" ? "failed" : "pending";
}

export function defaultFiscalEntity(entities: readonly FiscalEntity[]): TenantFiscalIdentity | null {
  const active = entities.filter((f) => f.status === "active");
  const f = active.find((x) => x.isDefault) ?? active[0];
  return f ? { entityId: f.entityId, legalName: f.legalName, taxId: f.taxId, country: f.country, address: f.address } : null;
}

/** Fuente del registro (solo lectura): tenant, dominios, eventos de verificación y entidad fiscal. */
export function registryIdentitySource(
  reader: Pick<TenantRegistryReader, "getTenant" | "listDomains" | "listEvents">,
  org: Pick<OrganizationStore, "fiscalEntities">,
): TenantIdentitySource {
  return {
    async load(tenantId) {
      const t = await reader.getTenant(tenantId);
      if (!t) return null;
      const [domains, entities] = await Promise.all([reader.listDomains(tenantId), org.fiscalEntities(tenantId)]);
      const custom = domains.filter((d) => d.kind === "custom" && d.status !== "removed");
      const events = custom.length ? await reader.listEvents(tenantId, 200) : [];
      const chosen = choosePublicDomain(domains);
      return {
        tenantId,
        displayName: t.displayName,
        publicHost: chosen?.domain ?? null,
        publicHostKind: chosen?.kind ?? null,
        customDomains: custom.map((d) => ({ domain: d.domain, state: domainVerificationState(d, events), isPrimary: d.isPrimary })),
        fiscal: defaultFiscalEntity(entities),
      };
    },
  };
}

// ── Instantánea por empresa ────────────────────────────────────────────────

let source: TenantIdentitySource | null = null;
const KEY = "identity";
const cache = new TenantCache<TenantRegistryIdentity | null>(30_000);

/** Lo fija el montaje del registro en modo multi (`installTenantResolution`). */
export function configureTenantIdentity(s: TenantIdentitySource | null): void {
  source = s;
  cache.clearAll();
}

/**
 * Precarga la identidad de la empresa en curso (borde de petición o tarea). Nunca lanza: si el
 * registro no responde, las lecturas síncronas devuelven `null` y nada se inventa.
 */
export async function warmTenantIdentity(): Promise<TenantRegistryIdentity | null> {
  if (!isMultiTenant() || !source) return null;
  const tenantId = currentTenantOrNull();
  if (!tenantId) return null;
  const hit = cache.get(KEY);
  if (hit !== undefined) return hit;
  try {
    const v = await source.load(tenantId);
    // Defensa: la instantánea solo se guarda si es de la empresa en curso
    if (v && v.tenantId !== tenantId) return null;
    cache.set(KEY, v);
    return v;
  } catch {
    console.warn(JSON.stringify({ ctx: "TenantIdentity", event: "load_failed" }));
    return null;
  }
}

/** Identidad precargada de la empresa en curso (multi), o `null`. */
export function peekTenantIdentity(): TenantRegistryIdentity | null {
  if (!isMultiTenant()) return null;
  const v = cache.get(KEY);
  return v && v.tenantId === currentTenantOrNull() ? v : null;
}

/** Cambio en el registro (versión nueva): la próxima petición vuelve a leerlo. */
export function invalidateTenantIdentity(tenantId: string): void {
  cache.clearTenant(tenantId);
}

/** URL pública de la empresa en curso (multi) o `null` si no hay una servible y precargada. */
export function tenantPublicUrl(): string | null {
  const host = peekTenantIdentity()?.publicHost;
  return host ? `https://${host}` : null;
}
