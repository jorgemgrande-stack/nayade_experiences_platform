/**
 * Concesión TEMPORAL de capacidades individuales a empresas de PRUEBA (herramienta administrativa auditada).
 *
 * Reutiliza el registro de licencias por capacidad (`tenant_capabilities` + `tenant_capability_events`): no hay una
 * segunda fuente de verdad. La concesión es una fila con `source = "operator"`, estado `active` y caducidad
 * obligatoria (≤ 24 h). No crea contratos, facturas, suscripciones ni cargos, y no toca los módulos del tenant.
 *
 * Límites (listas cerradas, ampliables SOLO por PR):
 *  - empresas: TEMPORARY_CAPABILITY_TENANTS; capacidades: TEMPORARY_CAPABILITY_IDS.
 *  - cerrada por completo en el entorno `production`.
 *  - una fila por (empresa, capacidad, sede): si otra fuente (suscripción o prueba) ya tiene esa capacidad, se rechaza.
 *
 * Limitación conocida (no autoconcesión): el registro NO conoce a los usuarios de cada empresa (viven en la base de datos
 * del tenant), así que no puede comprobarse que quien concede no sea usuario de la empresa. Lo mitigan: la lista cerrada de
 * empresas de prueba, el permiso específico (solo superadmin/admin) y el registro de cada acción con su operador.
 */
import { capability } from "../catalog/capabilities";
import type { CapabilityEvent, CapabilityGrant } from "../_core/capabilities/model";
import { COMPANY_WIDE } from "../_core/capabilities/model";
import type { CapabilityStore } from "../_core/capabilities/store";

export const MAX_TEMP_CAPABILITY_HOURS = 24;
export const TEMPORARY_CAPABILITY_TENANTS: readonly string[] = ["alta-correo-20261024c"];
export const TEMPORARY_CAPABILITY_IDS: readonly string[] = ["accounting-general"];
export const TEMPORARY_SOURCE = "operator";
export const EXPIRY_ACTOR = "system:expiry";
export const EXPIRY_REASON = "caducidad automática";

export type TempCapErrorCode = "forbidden" | "invalid" | "not_found" | "conflict" | "unavailable";
export class TempCapError extends Error {
  constructor(
    public code: TempCapErrorCode,
    message: string,
  ) {
    super(message);
  }
  get status() {
    return { forbidden: 403, invalid: 400, not_found: 404, conflict: 409, unavailable: 404 }[this.code];
  }
}

/** Entorno normalizado (trim + minúsculas); `null` si no está definido (desarrollo local). */
export const normalizeEnvironment = (v: string | null | undefined): string | null => (v ?? "").trim().toLowerCase() || null;
export const isProduction = (env: string | null) => env === "production";

export interface TemporaryCapabilitiesDeps {
  store: CapabilityStore;
  now?: () => number;
  /** Entorno (inyectable en pruebas); por defecto RAILWAY_ENVIRONMENT_NAME en cada llamada. */
  environment?: () => string | null | undefined;
  /** Registro de operador adicional (auditoría del registro de empresas). */
  audit?: (tenantId: string, actor: string, action: string, details: Record<string, unknown>) => Promise<void>;
}

const isoMinute = (ms: number) => new Date(ms).toISOString().slice(0, 16) + "Z";
class SkipSweep extends Error {}

const grantView = (g: CapabilityGrant) => ({ capabilityId: g.capabilityId, status: g.status, validUntil: g.validUntil, source: g.source, updatedAt: g.updatedAt, updatedBy: g.updatedBy });
const eventView = (e: CapabilityEvent) => ({ capabilityId: e.capabilityId, fromStatus: e.fromStatus, toStatus: e.toStatus, actor: e.actor, reason: e.reason, at: e.at });

export class TemporaryCapabilities {
  private now: () => number;
  constructor(private d: TemporaryCapabilitiesDeps) {
    this.now = d.now ?? Date.now;
  }
  environment(): string | null {
    return normalizeEnvironment(this.d.environment ? this.d.environment() : process.env.RAILWAY_ENVIRONMENT_NAME);
  }
  /** Herramienta abierta en este entorno. */
  open(): boolean {
    return !isProduction(this.environment());
  }
  assertOpen() {
    if (!this.open()) throw new TempCapError("forbidden", "La concesión temporal de capacidades está cerrada en production");
  }
  eligible(tenantId: string) {
    return TEMPORARY_CAPABILITY_TENANTS.includes(tenantId);
  }
  allowedCapabilities() {
    return TEMPORARY_CAPABILITY_IDS.map((id) => ({ id, name: capability(id)?.name ?? id }));
  }
  /** Comprobaciones previas comunes (entorno cerrado, empresa y capacidad autorizadas). */
  precheck(tenantId: string, capabilityId: string) {
    this.assertOpen();
    if (!this.eligible(tenantId)) throw new TempCapError("forbidden", "Esta empresa no está autorizada para concesiones temporales de capacidades");
    if (!TEMPORARY_CAPABILITY_IDS.includes(capabilityId)) throw new TempCapError("forbidden", "Esta capacidad no está autorizada para concesiones temporales");
  }

  async view(tenantId: string, canGrant = true) {
    const enabled = this.open() && canGrant;
    const eligible = this.eligible(tenantId);
    const base = { enabled, environment: this.environment(), maxHours: MAX_TEMP_CAPABILITY_HOURS, allowedCapabilities: this.allowedCapabilities(), eligible };
    if (!enabled || !eligible) return { ...base, grants: [], events: [] };
    const [grants, events] = await Promise.all([this.d.store.list(tenantId), this.d.store.events(tenantId, 200)]);
    return {
      ...base,
      grants: grants.filter((g) => g.source === TEMPORARY_SOURCE).map(grantView),
      events: events.filter((e) => e.source === TEMPORARY_SOURCE).map(eventView),
    };
  }

  async grant(tenantId: string, input: { capabilityId: string; reason: string; expiresAt: number }, actor: string) {
    this.precheck(tenantId, input.capabilityId);
    const now = this.now();
    if (!Number.isFinite(input.expiresAt) || input.expiresAt <= now) throw new TempCapError("invalid", "La caducidad debe ser una fecha futura");
    if (input.expiresAt > now + MAX_TEMP_CAPABILITY_HOURS * 3_600_000) throw new TempCapError("invalid", `La caducidad no puede superar ${MAX_TEMP_CAPABILITY_HOURS} horas`);
    const reason = input.reason.trim();
    const events = await this.d.store.apply(
      tenantId,
      [{ capabilityId: input.capabilityId, siteId: COMPANY_WIDE, status: "active", validUntil: input.expiresAt, source: TEMPORARY_SOURCE }],
      {
        actor,
        reason: `temporal hasta ${isoMinute(input.expiresAt)} · ${reason}`,
        now,
        // Dentro de la transacción (empresa bloqueada): dos concesiones simultáneas → una gana, la otra 409
        guard: (current) => {
          const cur = current.find((g) => g.capabilityId === input.capabilityId && g.siteId === COMPANY_WIDE);
          if (!cur) return;
          if (cur.source !== TEMPORARY_SOURCE) throw new TempCapError("conflict", "La capacidad ya la concede otra fuente (suscripción o prueba): no se modifica desde esta herramienta");
          if (cur.status === "active" && cur.validUntil !== null && cur.validUntil > now) throw new TempCapError("conflict", "Ya hay una concesión temporal vigente: suspéndela antes de conceder de nuevo");
        },
      },
    );
    const event = events[0];
    if (!event) throw new TempCapError("conflict", "Ya hay una concesión idéntica");
    await this.d.audit?.(tenantId, actor, "capability.temporary_granted", { capabilityId: input.capabilityId, expiresAt: input.expiresAt, reason, fromStatus: event.fromStatus, toStatus: event.toStatus });
    return { grant: await this.read(tenantId, input.capabilityId), event: eventView(event) };
  }

  async suspend(tenantId: string, capabilityId: string, reasonIn: string, actor: string) {
    this.precheck(tenantId, capabilityId);
    const reason = reasonIn.trim();
    const now = this.now();
    let validUntil: number | null = null;
    // La concesión debe existir, ser de operador y no estar ya suspendida: se comprueba con el bloqueo de la empresa
    const check = (current: CapabilityGrant[]) => {
      const g = current.find((x) => x.capabilityId === capabilityId && x.siteId === COMPANY_WIDE);
      if (!g || g.source !== TEMPORARY_SOURCE) throw new TempCapError("not_found", "No hay concesión temporal de esa capacidad en la empresa");
      if (g.status === "suspended") throw new TempCapError("conflict", "La concesión ya está suspendida");
      validUntil = g.validUntil;
    };
    const cur = (await this.d.store.list(tenantId)).find((x) => x.capabilityId === capabilityId && x.siteId === COMPANY_WIDE);
    check(cur ? [cur] : []);
    const events = await this.d.store.apply(
      tenantId,
      [{ capabilityId, siteId: COMPANY_WIDE, status: "suspended", validUntil, source: TEMPORARY_SOURCE }],
      { actor, reason: `suspendida manualmente · ${reason}`, now, guard: check },
    );
    const event = events[0];
    if (!event) throw new TempCapError("conflict", "La concesión ya está suspendida");
    await this.d.audit?.(tenantId, actor, "capability.temporary_suspended", { capabilityId, reason, fromStatus: event.fromStatus, toStatus: event.toStatus });
    return { grant: await this.read(tenantId, capabilityId), event: eventView(event) };
  }

  private async read(tenantId: string, capabilityId: string) {
    const g = (await this.d.store.list(tenantId)).find((x) => x.capabilityId === capabilityId && x.siteId === COMPANY_WIDE)!;
    return grantView(g);
  }

  /**
   * Barrido de caducidad: pasa a `suspended` las concesiones de operador activas y vencidas, con evento `system:expiry`.
   * Idempotente (lo ya suspendido no se toca) y seguro con varios procesos (la comprobación se repite dentro de la transacción).
   */
  async sweep(): Promise<number> {
    const now = this.now();
    let n = 0;
    for (const g of await this.d.store.expiredOperatorGrants(now)) {
      try {
        const ev = await this.d.store.apply(
          g.tenantId,
          [{ capabilityId: g.capabilityId, siteId: g.siteId, status: "suspended", validUntil: g.validUntil, source: TEMPORARY_SOURCE }],
          {
            actor: EXPIRY_ACTOR,
            reason: EXPIRY_REASON,
            now,
            guard: (current) => {
              const c = current.find((x) => x.capabilityId === g.capabilityId && x.siteId === g.siteId);
              if (!c || c.source !== TEMPORARY_SOURCE || c.status !== "active" || c.validUntil === null || c.validUntil > now) throw new SkipSweep();
            },
          },
        );
        n += ev.length;
      } catch (e) {
        if (!(e instanceof SkipSweep)) throw e;
      }
    }
    return n;
  }
}
