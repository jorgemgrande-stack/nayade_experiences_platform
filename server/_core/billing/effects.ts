/**
 * Efectos reales de la facturación sobre la plataforma: estado del tenant en el registro,
 * licencias de módulos y cuotas. Todas las acciones quedan auditadas en `tenant_events`
 * con actor `crm`.
 */
import type { TenantEffects } from "./ports";
import type { TenantRegistryService, Actor } from "../tenantRegistry/service";
import type { EntitlementAdmin } from "../modules/mysqlEntitlements";
import type { QuotaAdmin } from "../erm/mysqlQuotas";
import type { TenantRegistryReader } from "../tenantRegistry/store";
import { canTransition } from "../tenantRegistry/lifecycle";
import type { TenantStatus } from "../tenantRegistry/contract";

const BILLING_ACTOR: Actor = { type: "crm", id: "billing" };

export class RegistryTenantEffects implements TenantEffects {
  constructor(
    private registry: TenantRegistryService,
    private reader: Pick<TenantRegistryReader, "getTenant">,
    private entitlements: EntitlementAdmin,
    private quotas: QuotaAdmin,
  ) {}

  async setTenantStatus(
    tenantId: string,
    status: "trial" | "active" | "grace" | "suspended" | "archived",
    reason?: string,
  ): Promise<void> {
    const t = await this.reader.getTenant(tenantId);
    if (!t || t.status === status) return;
    const to = status as TenantStatus;
    // El ciclo de vida es una tabla cerrada: una transición no permitida no se fuerza
    if (!canTransition(t.status, to)) return;
    const needsReason = to === "suspended" || to === "archived";
    await this.registry.setStatus(tenantId, to, BILLING_ACTOR, needsReason ? { reason: reason ?? "billing" } : {});
  }

  async grantModule(tenantId: string, moduleId: string, validUntil: Date | null): Promise<void> {
    await this.entitlements.grant(tenantId, moduleId, BILLING_ACTOR, { validUntil });
  }

  async setModuleStatus(tenantId: string, moduleId: string, status: "active" | "suspended"): Promise<void> {
    await this.entitlements.setStatus(tenantId, moduleId, status, BILLING_ACTOR);
  }

  async revokeModule(tenantId: string, moduleId: string): Promise<void> {
    await this.entitlements.revoke(tenantId, moduleId, BILLING_ACTOR);
  }

  async setQuota(
    tenantId: string,
    q: { metric: string; period: "minute" | "hour" | "day" | "month"; limit: number },
  ): Promise<void> {
    await this.quotas.set({ tenantId, ...q, enforcement: "hard" }, BILLING_ACTOR);
  }
}
