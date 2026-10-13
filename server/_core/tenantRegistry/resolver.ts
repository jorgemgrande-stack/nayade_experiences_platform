/**
 * Resolución de tenant por dominio, con cachés aisladas y continuidad acotada.
 *
 * Reglas (aprobadas):
 *  - Un dominio desconocido NUNCA se resuelve a una base de datos por defecto.
 *  - Solo sirven dominios en estado `active` de tenants no eliminados.
 *  - Si el registro cae, se sirve la última resolución válida hasta `maxStaleMs` (10 min);
 *    pasado ese tiempo, o para dominios nunca vistos, se falla CERRADO.
 *  - Los estados críticos (suspendido, archivado, eliminado) se invalidan de forma activa:
 *    `revoke()` inmediato y sondeo periódico de versiones (`refreshVersions()`).
 */
import { accessPolicy, type AccessPolicy } from "./lifecycle";
import type { Tenant, TenantDomain, TenantStatus } from "./contract";
import { normalizeHost, type HostOptions } from "./host";
import type { DomainResolution, TenantRegistryReader } from "./store";

export interface ResolvedTenant {
  tenantId: string;
  status: TenantStatus;
  registryVersion: number;
  policy: AccessPolicy;
  domain: string;
  domainKind: TenantDomain["kind"];
}

export type ResolveOutcome =
  | { kind: "resolved"; tenant: ResolvedTenant; source: "cache" | "registry" | "stale" }
  /** Dominio no registrado, no activo o host no válido. Respuesta genérica (404). */
  | { kind: "unknown_domain" }
  /** Tenant conocido pero no servible (archivado, eliminado, en alta…). */
  | { kind: "blocked"; status: 410 | 503; tenantId: string }
  /** Registro inaccesible y sin resolución válida en caché: fallo cerrado (503). */
  | { kind: "unavailable" };

export interface ResolverOptions {
  ttlMs?: number;
  negativeTtlMs?: number;
  /** Máxima antigüedad servible si el registro no responde. */
  maxStaleMs?: number;
  maxEntries?: number;
  now?: () => number;
  host?: HostOptions;
}

type Entry =
  | { positive: true; value: Resolved; at: number }
  | { positive: false; at: number };

type Resolved = { tenant: ResolvedTenant } | { blocked: { status: 410 | 503; tenantId: string } } | { unknown: true };

export class TenantResolver {
  private cache = new Map<string, Entry>();
  private byTenant = new Map<string, Set<string>>();
  private revoked = new Set<string>();
  private readonly ttl: number;
  private readonly negTtl: number;
  private readonly maxStale: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly hostOpts: HostOptions;
  private stats_ = { hits: 0, misses: 0, stale: 0, unavailable: 0, revocations: 0 };

  constructor(
    private reader: TenantRegistryReader,
    opts: ResolverOptions = {},
  ) {
    this.ttl = opts.ttlMs ?? 30_000;
    this.negTtl = opts.negativeTtlMs ?? 5_000;
    this.maxStale = opts.maxStaleMs ?? 10 * 60_000;
    this.maxEntries = opts.maxEntries ?? 10_000;
    this.now = opts.now ?? Date.now;
    this.hostOpts = opts.host ?? {};
  }

  async resolveHost(rawHost: unknown): Promise<ResolveOutcome> {
    const host = normalizeHost(rawHost, this.hostOpts);
    if (!host) return { kind: "unknown_domain" };

    const entry = this.cache.get(host);
    const t = this.now();

    // 1. Caché fresca
    if (entry) {
      const age = t - entry.at;
      if (!entry.positive && age < this.negTtl) {
        this.stats_.hits++;
        return { kind: "unknown_domain" };
      }
      if (entry.positive && age < this.ttl) {
        this.stats_.hits++;
        return this.toOutcome(entry.value, "cache");
      }
    }

    // 2. Registro
    this.stats_.misses++;
    let res: DomainResolution | null;
    try {
      res = await this.reader.resolveDomain(host);
    } catch {
      // 3. Registro caído: continuidad acotada solo para lo ya conocido y no revocado
      if (entry?.positive && t - entry.at <= this.maxStale) {
        const tid = this.tenantIdOf(entry.value);
        if (!tid || !this.revoked.has(tid)) {
          this.stats_.stale++;
          return this.toOutcome(entry.value, "stale");
        }
      }
      this.stats_.unavailable++;
      return { kind: "unavailable" };
    }

    const value = this.classify(res);
    this.store(host, value);
    return this.toOutcome(value, "registry");
  }

  /** Revocación inmediata (estado crítico): los dominios del tenant dejan de servirse ya. */
  revoke(tenantId: string): void {
    this.revoked.add(tenantId);
    this.stats_.revocations++;
    this.invalidateTenant(tenantId);
  }

  invalidateTenant(tenantId: string): void {
    for (const d of Array.from(this.byTenant.get(tenantId) ?? [])) this.cache.delete(d);
    this.byTenant.delete(tenantId);
  }

  invalidateDomain(host: string): void {
    const h = normalizeHost(host, this.hostOpts);
    if (h) this.cache.delete(h);
  }

  invalidateAll(): void {
    this.cache.clear();
    this.byTenant.clear();
  }

  /**
   * Sondeo de versiones: invalida los tenants cuya versión cambió y revoca de inmediato los
   * que han pasado a un estado no servible. Devuelve los tenants invalidados.
   */
  async refreshVersions(): Promise<string[]> {
    const versions = await this.reader.listVersions();
    const changed: string[] = [];
    const known = new Map<string, { version: number; status: TenantStatus }>();
    for (const e of Array.from(this.cache.values())) {
      if (e.positive && "tenant" in e.value) {
        known.set(e.value.tenant.tenantId, { version: e.value.tenant.registryVersion, status: e.value.tenant.status });
      }
    }
    for (const v of versions) {
      const k = known.get(v.tenantId);
      if (k && k.version !== v.registryVersion) {
        this.invalidateTenant(v.tenantId);
        changed.push(v.tenantId);
      }
      const p = accessPolicy(v.status);
      if (!p.publicWeb && !p.admin) {
        // No servible: revocar aunque el tenant no esté en caché (otra instancia pudo servirlo)
        if (!this.revoked.has(v.tenantId)) this.revoked.add(v.tenantId);
        this.invalidateTenant(v.tenantId);
      } else {
        this.revoked.delete(v.tenantId);
      }
    }
    return changed;
  }

  stats() {
    return { ...this.stats_, entries: this.cache.size, revoked: this.revoked.size };
  }

  // ── Internos ───────────────────────────────────────────────────────────────

  private classify(res: DomainResolution | null): Resolved {
    if (!res) return { unknown: true };
    const { domain, tenant } = res;
    if (domain.status !== "active") return { unknown: true }; // no revelar que existe
    return this.classifyTenant(tenant, domain);
  }

  private classifyTenant(tenant: Tenant, domain: TenantDomain): Resolved {
    const policy = accessPolicy(tenant.status);
    if (!policy.publicWeb && !policy.admin) {
      return { blocked: { status: (policy.blockedStatus ?? 503) as 410 | 503, tenantId: tenant.id } };
    }
    return {
      tenant: {
        tenantId: tenant.id,
        status: tenant.status,
        registryVersion: tenant.registryVersion,
        policy,
        domain: domain.domain,
        domainKind: domain.kind,
      },
    };
  }

  private tenantIdOf(v: Resolved): string | null {
    if ("tenant" in v) return v.tenant.tenantId;
    if ("blocked" in v) return v.blocked.tenantId;
    return null;
  }

  private toOutcome(v: Resolved, source: "cache" | "registry" | "stale"): ResolveOutcome {
    if ("unknown" in v) return { kind: "unknown_domain" };
    if ("blocked" in v) return { kind: "blocked", status: v.blocked.status, tenantId: v.blocked.tenantId };
    if (this.revoked.has(v.tenant.tenantId) && source !== "registry") {
      return { kind: "blocked", status: 503, tenantId: v.tenant.tenantId };
    }
    return { kind: "resolved", tenant: v.tenant, source };
  }

  private store(host: string, value: Resolved): void {
    if (this.cache.size >= this.maxEntries) {
      // Expulsión simple: el más antiguo (Map conserva el orden de inserción)
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.delete(host);
    this.cache.set(host, "unknown" in value ? { positive: false, at: this.now() } : { positive: true, value, at: this.now() });
    const tid = this.tenantIdOf(value);
    if (tid) {
      let set = this.byTenant.get(tid);
      if (!set) this.byTenant.set(tid, (set = new Set()));
      set.add(host);
      // Una lectura fresca del registro confirma el estado: la revocación local queda superada
      if ("tenant" in value) this.revoked.delete(tid);
    }
  }
}
