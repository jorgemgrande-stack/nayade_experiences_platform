/**
 * Activación de un contrato: crea el tenant (aprovisionamiento) y arranca su suscripción.
 * Los cobros siguen desactivados mientras no haya proveedor de pagos configurado.
 */
import type { Actor } from "../_core/tenantRegistry/service";
import type { ProvisioningService } from "../_core/provisioning/service";
import type { SubscriptionService } from "../_core/billing/service";
import type { ContractActivationPort } from "./service";

export function slugifyTenantId(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const id = /^[a-z]/.test(base) ? base : `t-${base}`;
  return id.length >= 3 ? id.replace(/-+$/, "") : `${id}-co`;
}

export function createContractActivation(deps: {
  provisioning: ProvisioningService;
  billing?: SubscriptionService;
  platformDomain: string;
  actor: Actor;
  /** Plantilla de sitio por defecto. */
  templateId?: string;
}): ContractActivationPort {
  return {
    async activate({ contract, company, contact }) {
      if (!contact?.email) throw new Error("El contrato necesita un contacto con correo para crear al administrador");
      const tenantId = company.tenantId ?? slugifyTenantId(company.name);
      const r = await deps.provisioning.run(
        {
          tenantId,
          displayName: company.name,
          adminEmail: contact.email,
          adminName: contact.name,
          platformDomain: deps.platformDomain,
          modules: contract.modules,
          templateId: deps.templateId,
        },
        deps.actor,
      );
      if (r.status !== "completed") {
        throw new Error(`El alta no se completó (${r.failedStep ?? "pendiente"}): ${r.error ?? "reintentar"}`);
      }
      if (deps.billing && contract.planId) {
        try {
          await deps.billing.startTrial({ tenantId, planId: contract.planId, modules: contract.modules });
        } catch (e) {
          // Ya tenía suscripción (reactivación): no es un error del alta
          if (!(e instanceof Error) || !/ya tiene una suscripción/i.test(e.message)) throw e;
        }
      }
      return { tenantId };
    },
  };
}
