/**
 * Prueba gratuita de Essential (15 días) de punta a punta: orquesta lo que ya existe sin duplicarlo.
 *
 *   registro (antiabuso, idempotente) → verificación del correo → aprovisionamiento de la plataforma
 *   (con su usuario administrador) → empresa en el CRM → suscripción Essential en prueba (sin tarjeta
 *   ni cobro: modo sombra) → licencias Essential con caducidad al final de la prueba → avisos →
 *   vencimiento (solo lectura, los datos se conservan) → conversión.
 *
 * Recuperable: `activate` puede repetirse tras cualquier fallo y retoma desde el paso pendiente (el
 * aprovisionamiento es idempotente por tenant, la empresa se busca por su plataforma, la suscripción
 * viva se reutiliza y las licencias se aplican de forma idempotente). Nada se borra.
 *
 * Comunicaciones: SOLO a través del puerto `notify`. En producción no se conecta a ningún envío real
 * hasta que se autorice (la ruta pública está apagada por defecto). Nunca se registran tokens.
 */
import type { ProvisionRequest, ProvisionResult } from "../_core/provisioning/types";
import type { LicensingService } from "../licensing/service";
import type { SubscriptionService } from "../subscriptions/service";
import { TrialError, type TrialService } from "./service";

const DAY = 86_400_000;
export const ESSENTIAL_PLAN = "essential";
export const TRIAL_PLAN_DAYS = 15;
/** Avisos antes del vencimiento (días). */
export const NOTICE_DAYS = [3, 1, 0] as const;

export interface TrialNotifier {
  verification(to: string, link: { trialId: number; token: string }): Promise<void>;
  welcome(to: string, info: { tenantId: string; domain: string | null; inviteToken: string }): Promise<void>;
  expiryNotice(to: string, info: { trialId: number; endsAt: number; daysLeft: number }): Promise<void>;
}

export interface CompanyPort {
  byTenant(tenantId: string): Promise<{ id: number } | null>;
  create(input: { name: string; email: string; tenantId: string }, actor: string): Promise<{ id: number }>;
}

export interface TrialOnboardingDeps {
  trials: TrialService;
  provision: (req: ProvisionRequest) => Promise<ProvisionResult>;
  platformDomain: string;
  companies: CompanyPort;
  subscriptions: Pick<SubscriptionService, "create" | "list" | "detail" | "endTrial" | "changePlan">;
  licensing: Pick<LicensingService, "apply">;
  /** Id del precio aprobado vigente de un producto (catálogo publicado). */
  priceOf: (productKey: string, kind: "monthly" | "yearly") => Promise<number | null>;
  notify: TrialNotifier;
  now?: () => number;
}

/** Identificador de plataforma estable para una prueba: `t<id>-<empresa>`. */
export function trialTenantId(trialId: number, companyName: string): string {
  const slug = companyName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return `t${trialId}${slug ? `-${slug}` : ""}`;
}

export class TrialOnboardingService {
  private now: () => number;
  constructor(private d: TrialOnboardingDeps) {
    this.now = d.now ?? Date.now;
  }

  /** Registro público: crea la solicitud y envía el enlace de verificación (solo si es nueva). */
  async register(input: { email: string; companyName: string; idempotencyKey: string; ip?: string | null }) {
    const r = await this.d.trials.register({ email: input.email, companyName: input.companyName, configuration: { plan: ESSENTIAL_PLAN, addons: [] }, idempotencyKey: input.idempotencyKey, ip: input.ip ?? null });
    if (r.created && r.verificationToken) await this.d.notify.verification(r.trial.email, { trialId: r.trial.id, token: r.verificationToken });
    return { trialId: r.trial.id, created: r.created, state: r.trial.state };
  }

  /** Verificación; con `autoProvision` activa la prueba en el acto. */
  async verify(trialId: number, token: string, o: { autoProvision: boolean }) {
    const t = await this.d.trials.verify(trialId, token);
    if (!o.autoProvision) return { trial: t, activation: null, activationError: null };
    try {
      return { trial: t, activation: await this.activate(trialId, "system:trial"), activationError: null };
    } catch (e) {
      // El correo YA está verificado: la activación queda pendiente y se reintenta (es recuperable)
      return { trial: await this.d.trials.must(trialId), activation: null, activationError: e instanceof Error ? e.message : "error" };
    }
  }

  /** Activa (o reanuda) la prueba. Idempotente y recuperable. */
  async activate(trialId: number, actor: string) {
    let t = await this.d.trials.must(trialId);
    if (!["verified", "provisioning", "active"].includes(t.state)) throw new TrialError("invalid_state", `La prueba está en «${t.state}»: no se puede activar`);
    const tenantId = t.tenantId ?? trialTenantId(t.id, t.companyName);
    let domain: string | null = null;

    // 1. Plataforma (con su administrador)
    if (t.state === "verified") t = await this.d.trials.requestProvisioning(t.id, t.version, actor);
    if (t.state === "provisioning") {
      let result: ProvisionResult;
      try {
        result = await this.d.provision({ tenantId, displayName: t.companyName, adminEmail: t.email, platformDomain: this.d.platformDomain, trialDays: TRIAL_PLAN_DAYS });
      } catch (e) {
        await this.d.trials.markProvisioningFailed(t.id, t.version, e instanceof Error ? e.message : "error", actor);
        throw e;
      }
      if (result.status !== "completed") {
        await this.d.trials.markProvisioningFailed(t.id, t.version, result.error ?? `alta ${result.status}`, actor);
        throw new TrialError("invalid_state", `El alta de la plataforma no terminó (${result.status}${result.failedStep ? `, paso ${result.failedStep}` : ""}); se puede reintentar`);
      }
      domain = result.domain ?? null;
      t = await this.d.trials.markProvisioned(t.id, t.version, tenantId, actor);
      // La invitación del administrador solo existe en la ejecución que lo creó
      if (result.adminInviteToken) await this.d.notify.welcome(t.email, { tenantId, domain, inviteToken: result.adminInviteToken });
    }

    // 2. Empresa en el CRM (enlazada a la plataforma)
    const company = (await this.d.companies.byTenant(tenantId)) ?? (await this.d.companies.create({ name: t.companyName, email: t.email, tenantId }, actor));

    // 3. Suscripción Essential en prueba (sin tarjeta ni cobro)
    const live = (await this.d.subscriptions.list({ companyId: company.id })).find((s) => s.status !== "canceled");
    let subscription = live;
    if (!subscription) {
      const priceId = await this.d.priceOf(ESSENTIAL_PLAN, "monthly");
      if (!priceId) throw new TrialError("invalid_state", "Essential no tiene tarifa mensual aprobada y publicada");
      subscription = await this.d.subscriptions.create(
        { companyId: company.id, tenantId, interval: "month", trialDays: Math.max(1, Math.ceil(((t.endsAt ?? this.now() + TRIAL_PLAN_DAYS * DAY) - this.now()) / DAY)), plan: { productKey: ESSENTIAL_PLAN, priceId }, reason: `Prueba gratuita #${t.id}` },
        actor,
      );
    }

    // 4. Licencias Essential con caducidad al final de la prueba
    const licences = await this.d.licensing.apply(subscription.id, { activate: true, actor, reason: `Prueba gratuita #${t.id}` });
    return { trial: t, tenantId, domain, companyId: company.id, subscriptionId: subscription.id, licencesChanged: licences.applied.length, capabilities: licences.desired.length };
  }

  /** Pruebas activas que necesitan aviso hoy (3, 1 y 0 días antes del vencimiento). No envía nada. */
  async noticesDue(listActive: () => Promise<Array<{ id: number; email: string; endsAt: number | null }>>) {
    const now = this.now();
    return (await listActive())
      .filter((t) => t.endsAt !== null)
      .map((t) => ({ ...t, daysLeft: Math.max(0, Math.ceil((t.endsAt! - now) / DAY)) }))
      .filter((t) => (NOTICE_DAYS as readonly number[]).includes(t.daysLeft));
  }

  /** Envío EXPLÍCITO de avisos (lo lanza una persona o un proceso autorizado). */
  async sendNotices(due: Array<{ id: number; email: string; endsAt: number | null; daysLeft: number }>) {
    for (const t of due) await this.d.notify.expiryNotice(t.email, { trialId: t.id, endsAt: t.endsAt!, daysLeft: t.daysLeft });
    return { sent: due.length };
  }

  /** Vencimiento (decisión humana): las licencias ya caducaron (solo lectura). Nada se borra. */
  async expire(trialId: number, actor: string) {
    const t = await this.d.trials.must(trialId);
    return this.d.trials.markExpired(t.id, t.version, actor);
  }

  /**
   * Conversión: termina la prueba de la suscripción (pasa a activa), opcionalmente cambia de plan con
   * su tarifa aprobada, reaplica licencias (sin caducidad) y cierra la prueba como convertida.
   */
  async convert(trialId: number, o: { plan?: string; actor: string }) {
    const t = await this.d.trials.must(trialId);
    if (!t.tenantId) throw new TrialError("invalid_state", "La prueba no tiene plataforma");
    const company = await this.d.companies.byTenant(t.tenantId);
    if (!company) throw new TrialError("invalid_state", "No se encuentra la empresa de la prueba");
    let sub = (await this.d.subscriptions.list({ companyId: company.id })).find((s) => s.status !== "canceled");
    if (!sub) throw new TrialError("invalid_state", "La prueba no tiene suscripción");
    if (sub.status === "trialing") sub = (await this.d.subscriptions.endTrial(sub.id, { reason: `Conversión de la prueba #${t.id}` }, sub.version, o.actor)).subscription;
    if (o.plan && o.plan !== ESSENTIAL_PLAN) {
      const priceId = await this.d.priceOf(o.plan, sub.interval === "year" ? "yearly" : "monthly");
      if (!priceId) throw new TrialError("invalid_input", `El plan «${o.plan}» no tiene tarifa aprobada`);
      sub = (await this.d.subscriptions.changePlan(sub.id, { plan: { productKey: o.plan, priceId }, reason: `Conversión de la prueba #${t.id}` }, sub.version, o.actor)).subscription;
    }
    const licences = await this.d.licensing.apply(sub.id, { activate: true, actor: o.actor, reason: `Conversión de la prueba #${t.id}` });
    const fresh = await this.d.trials.must(trialId);
    const converted = await this.d.trials.convert(fresh.id, fresh.version, sub.id, o.actor);
    return { trial: converted, subscriptionId: sub.id, licencesChanged: licences.applied.length };
  }
}
