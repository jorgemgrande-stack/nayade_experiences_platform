/**
 * Onboarding de un cliente desde su ficha comercial: valida empresa, contacto administrador,
 * subdominio y módulos; aprovisiona la plataforma (reanudable: un reintento continúa donde se
 * quedó), inicia la prueba si hay plan y facturación (los cobros siguen apagados) y enlaza la
 * empresa con su tenant. Las reglas de aprovisionamiento y facturación son las de sus servicios.
 */
import type { Actor } from "../_core/tenantRegistry/service";
import type { TenantRegistryReader } from "../_core/tenantRegistry/store";
import type { ProvisioningService } from "../_core/provisioning/service";
import { ProvisioningError, TENANT_ID_RE, type ProvisionResult } from "../_core/provisioning/types";
import { withAdminInviteDelivery, type AdminInviteDelivery } from "../controlPlane/adminInviteDelivery";
import type { SubscriptionService } from "../_core/billing/service";
import { BillingError, type Subscription } from "../_core/billing/types";
import type { CrmService } from "./service";
import type { CrmStore } from "./store";
import { CrmError, type Company } from "./types";
import { isNonWildcardPlatformDomain } from "../_core/tenantRegistry/platformDomains";

const MODULE_RE = /^[a-z][a-z0-9_]{1,31}$/;
const DEFAULT_TRIAL_DAYS = 15;
const NON_ROUTABLE_WARNING =
  "El dominio de plataforma de este entorno no admite subdominios automáticos: la empresa queda creada pero su dirección no responde hasta configurar el comodín del entorno (*.live.bigelephant.es en live).";

export interface OnboardingDeps {
  store: CrmStore;
  crm: CrmService;
  provisioning: Pick<ProvisioningService, "run" | "status">;
  registry: Pick<TenantRegistryReader, "getTenant">;
  billing?: Pick<SubscriptionService, "startTrial">;
  /** Dominio base: el subdominio del cliente es `<tenantId>.<platformDomain>`. */
  platformDomain: string;
  /** Entrega de la invitación por correo desde el Core; si sale, el enlace no se devuelve al operador. */
  deliverInvite?: (tenantId: string, adminEmail: string, actor: Actor) => Promise<AdminInviteDelivery>;
}

export interface OnboardingInput {
  tenantId: string;
  adminContactId: number;
  planId?: string;
  modules?: string[];
  templateId?: string;
  trialDays?: number;
}

export interface OnboardingResult {
  /** `completed`: plataforma creada; `incomplete`: el alta falló en un paso (reintentable). */
  status: "completed" | "incomplete";
  provisioning: ProvisionResult;
  subscription: Subscription | null;
  /** Avisos no bloqueantes (p. ej. facturación no configurada o la prueba ya existía). */
  notes: string[];
  company: Company;
  domain: string;
}

export class CrmOnboarding {
  constructor(private d: OnboardingDeps) {}

  config() {
    const routable = !isNonWildcardPlatformDomain(this.d.platformDomain);
    return {
      platformDomain: this.d.platformDomain,
      billing: Boolean(this.d.billing),
      defaultTrialDays: DEFAULT_TRIAL_DAYS,
      // Bajo un dominio sin comodín (p. ej. up.railway.app) la empresa queda registrada pero no se puede abrir
      subdomainsRoutable: routable,
      ...(routable ? {} : { subdomainWarning: NON_ROUTABLE_WARNING }),
    };
  }

  /** Disponibilidad del identificador/subdominio (sin efectos). */
  async check(tenantId: string, companyId?: number): Promise<{ available: boolean; reason: string | null; domain: string }> {
    const domain = `${tenantId}.${this.d.platformDomain}`;
    if (!TENANT_ID_RE.test(tenantId)) {
      return { available: false, reason: "Formato no válido: minúsculas, números y guiones (3–42), empezando por letra", domain };
    }
    const owner = (await this.d.store.list("companies", { tenantId }))[0];
    if (owner && owner.id !== companyId) return { available: false, reason: `Asignado a la empresa #${owner.id}`, domain };
    if (await this.d.registry.getTenant(tenantId)) {
      const rec = await this.d.provisioning.status(tenantId);
      const company = companyId ? await this.d.store.get("companies", companyId) : null;
      const resumable = rec && rec.status !== "completed" && company && rec.request.displayName === company.name;
      if (!resumable) return { available: false, reason: "Identificador en uso", domain };
      return { available: true, reason: "Alta pendiente de esta empresa: se reanudará", domain };
    }
    return { available: true, reason: null, domain };
  }

  async onboard(companyId: number, input: OnboardingInput, actor: Actor): Promise<OnboardingResult> {
    const company = await this.d.store.get("companies", companyId);
    if (!company) throw new CrmError("not_found", "Empresa no encontrada");
    if (company.status !== "active") throw new CrmError("invalid_state", "La empresa no está activa");
    if (company.tenantId) throw new CrmError("conflict", `La empresa ya tiene plataforma (${company.tenantId})`);

    const contact = await this.d.store.get("contacts", input.adminContactId);
    if (!contact || contact.companyId !== companyId) throw new CrmError("invalid_input", "El administrador debe ser un contacto de la empresa");
    if (contact.status !== "active" || !contact.email) throw new CrmError("invalid_input", "El administrador necesita estar activo y tener correo");

    const modules = Array.from(new Set((input.modules ?? []).map((m) => m.trim()).filter(Boolean)));
    const bad = modules.find((m) => !MODULE_RE.test(m));
    if (bad) throw new CrmError("invalid_input", `Módulo no válido: ${bad}`);
    const trialDays = input.trialDays ?? DEFAULT_TRIAL_DAYS;
    if (!Number.isInteger(trialDays) || trialDays < 1 || trialDays > 90) throw new CrmError("invalid_input", "Días de prueba fuera de rango (1–90)");

    const avail = await this.check(input.tenantId, companyId);
    if (!avail.available) throw new CrmError(TENANT_ID_RE.test(input.tenantId) ? "conflict" : "invalid_input", avail.reason ?? "Identificador no disponible");

    const notes: string[] = [];
    if (isNonWildcardPlatformDomain(this.d.platformDomain)) notes.push(NON_ROUTABLE_WARNING);
    if (input.planId && !this.d.billing) notes.push("Facturación no configurada: no se inicia la prueba del plan");

    let provisioning: ProvisionResult;
    try {
      provisioning = await this.d.provisioning.run(
        {
          tenantId: input.tenantId,
          displayName: company.name,
          adminEmail: contact.email,
          adminName: contact.name,
          platformDomain: this.d.platformDomain,
          modules,
          trialDays,
          templateId: input.templateId,
          brand: { name: company.name, ...(company.email ? { email: company.email } : {}), ...(company.phone ? { phone: company.phone } : {}) },
        },
        actor,
      );
    } catch (e) {
      if (e instanceof ProvisioningError) {
        throw new CrmError(e.code === "invalid_request" ? "invalid_input" : "conflict", e.message);
      }
      throw e;
    }

    const author = `${actor.type}:${actor.id}`;
    if (provisioning.status !== "completed") {
      await this.d.crm.log("company", companyId, "note", `Alta de plataforma incompleta (${provisioning.failedStep ?? "pendiente"}): reintentar`, author);
      return { status: "incomplete", provisioning, subscription: null, notes, company, domain: avail.domain };
    }

    const deliver = this.d.deliverInvite;
    provisioning = await withAdminInviteDelivery(provisioning, deliver ? () => deliver(input.tenantId, contact.email!, actor) : null);
    if (provisioning.adminInvite?.delivery === "email") notes.push(`Invitación enviada por correo a ${contact.email}`);

    let subscription: Subscription | null = null;
    if (input.planId && this.d.billing) {
      try {
        subscription = await this.d.billing.startTrial({ tenantId: input.tenantId, planId: input.planId, modules });
      } catch (e) {
        // La plataforma ya existe: un fallo de facturación no deshace el alta; se informa
        if (e instanceof BillingError) notes.push(`Prueba no iniciada: ${e.message}`);
        else throw e;
      }
    }
    const linked = await this.d.store.update("companies", companyId, { tenantId: input.tenantId, updatedAt: Date.now() });
    await this.d.crm.log(
      "company",
      companyId,
      "note",
      `Alta de plataforma: ${provisioning.domain ?? avail.domain} (administrador ${contact.name}${subscription ? `, prueba del plan ${subscription.planId}` : ""})`,
      author,
    );
    return { status: "completed", provisioning, subscription, notes, company: linked, domain: provisioning.domain ?? avail.domain };
  }
}
