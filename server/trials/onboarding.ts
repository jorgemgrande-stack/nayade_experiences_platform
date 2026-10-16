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
import { nextState } from "./machine";
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
  licensing: Pick<LicensingService, "apply"> & Partial<Pick<LicensingService, "list" | "setStatus">>;
  /** Id del precio aprobado vigente de un producto (catálogo publicado). */
  priceOf: (productKey: string, kind: "monthly" | "yearly") => Promise<number | null>;
  notify: TrialNotifier;
  /**
   * Invitación nueva para el propietario si la original se perdió (alta reanudada) y aún no definió
   * su contraseña; `null` si ya entró. Opcional: sin él no se puede reenviar el acceso.
   */
  reissueInvite?: (tenantId: string) => Promise<string | null>;
  now?: () => number;
}

/** Longitud máxima de un identificador de tenant (TENANT_ID_RE del aprovisionamiento). */
const TENANT_ID_MAX = 42;

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
  const prefix = `t${trialId}`;
  // El aprovisionamiento admite como mucho 42 caracteres: se recorta el nombre, nunca el número
  const cut = slug.slice(0, Math.max(0, TENANT_ID_MAX - prefix.length - 1)).replace(/-+$/g, "");
  // Sin letras aprovechables (p. ej. solo símbolos) el identificador «t7» sería demasiado corto
  return `${prefix}-${cut || "empresa"}`;
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

  /**
   * Activa (o reanuda) la prueba. Idempotente y recuperable. Las activaciones simultáneas de la misma
   * prueba (verificación repetida, operador a la vez) se serializan en este proceso: la segunda
   * reanuda sobre lo que dejó la primera y no crea nada dos veces.
   */
  async activate(trialId: number, actor: string) {
    const prev = this.inflight.get(trialId) ?? Promise.resolve();
    const mine = prev.then(() => this.activateSerialized(trialId, actor));
    const tail = mine.catch(() => undefined);
    this.inflight.set(trialId, tail);
    try {
      return await mine;
    } finally {
      if (this.inflight.get(trialId) === tail) this.inflight.delete(trialId);
    }
  }

  /**
   * Reenvía al propietario el acceso a su plataforma: invitación nueva (la anterior queda anulada)
   * mientras no haya definido su contraseña. Si ya la definió, no se envía nada: que use «¿Olvidaste
   * tu contraseña?» en su propio dominio.
   */
  async resendAccess(trialId: number) {
    const t = await this.d.trials.must(trialId);
    if (!t.tenantId || !["active", "expired", "suspended", "converted"].includes(t.state)) throw new TrialError("invalid_state", "La prueba todavía no tiene plataforma");
    if (!this.d.reissueInvite) throw new TrialError("invalid_state", "El reenvío de acceso no está disponible");
    const token = await this.d.reissueInvite(t.tenantId);
    if (!token) return { sent: false as const, reason: "already_accepted" as const };
    await this.d.notify.welcome(t.email, { tenantId: t.tenantId, domain: `${t.tenantId}.${this.d.platformDomain}`, inviteToken: token });
    return { sent: true as const };
  }

  /** Estado actual de una prueba (sin datos personales), para respuestas públicas. */
  async stateOf(trialId: number) {
    return (await this.d.trials.must(trialId)).state;
  }

  private inflight = new Map<number, Promise<unknown>>();

  private async activateSerialized(trialId: number, actor: string) {
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
      // La invitación del administrador solo existe en la ejecución que lo creó. Si el alta ya estaba
      // completada (la prueba se quedó a medias tras ella), se emite una nueva para no dejar al
      // propietario sin acceso.
      // Un fallo aquí no deshace la activación: el acceso se puede reenviar después (resendAccess)
      const inviteToken = result.adminInviteToken ?? (this.d.reissueInvite ? await this.d.reissueInvite(tenantId).catch(() => null) : null);
      if (inviteToken) await this.d.notify.welcome(t.email, { tenantId, domain, inviteToken });
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
   * Suspensión (decisión humana, con motivo): la prueba pasa a «suspendida» y sus licencias quedan
   * suspendidas (la empresa no puede entrar a operar). Nada se borra. Primero se comprueban el estado y
   * la versión, luego las licencias (idempotente) y por último la transición: si algo falla a medias,
   * repetir la petición termina el trabajo sin duplicar nada.
   */
  async suspend(trialId: number, o: { reason: string; expectedVersion: number; actor: string }) {
    const t = await this.d.trials.must(trialId);
    if (t.version !== o.expectedVersion) throw new TrialError("conflict", "La solicitud cambió mientras tanto; recarga");
    if (!nextState(t.state, "suspend")) throw new TrialError("invalid_state", `No se puede suspender una prueba en «${t.state}»`);
    if (!o.reason.trim() || o.reason.trim().length < 5) throw new TrialError("invalid_input", "Indica el motivo de la suspensión (mínimo 5 caracteres)");
    if (t.tenantId) {
      if (!this.d.licensing.list || !this.d.licensing.setStatus) throw new TrialError("invalid_state", "La gestión de licencias no está disponible");
      const reason = `Suspensión de la prueba #${t.id}: ${o.reason.trim()}`.slice(0, 300);
      for (const g of await this.d.licensing.list(t.tenantId)) {
        if (g.status === "active" || g.status === "read_only") await this.d.licensing.setStatus(t.tenantId, g.capabilityId, "suspended", { actor: o.actor, reason, siteId: g.siteId });
      }
    }
    return this.d.trials.suspend(t.id, t.version, o.reason, o.actor);
  }

  /**
   * Reactivación: exige que quede plazo (si no, ampliar o convertir). Reaplica las licencias de la
   * suscripción de la prueba (vuelven a «activas» con la caducidad del final de la prueba).
   */
  async reactivate(trialId: number, o: { expectedVersion: number; actor: string }) {
    const t = await this.d.trials.must(trialId);
    if (t.version !== o.expectedVersion) throw new TrialError("conflict", "La solicitud cambió mientras tanto; recarga");
    if (!nextState(t.state, "reactivate")) throw new TrialError("invalid_state", `No se puede reactivar una prueba en «${t.state}»`);
    if (t.endsAt === null || t.endsAt <= this.now()) throw new TrialError("invalid_state", "La prueba ha vencido: amplíala o conviértela en suscripción");
    let licencesChanged = 0;
    if (t.tenantId) {
      const company = await this.d.companies.byTenant(t.tenantId);
      const sub = company ? (await this.d.subscriptions.list({ companyId: company.id })).find((s) => s.status !== "canceled") : undefined;
      if (!sub) throw new TrialError("invalid_state", "La prueba no tiene suscripción: no se pueden reactivar sus licencias");
      licencesChanged = (await this.d.licensing.apply(sub.id, { activate: true, actor: o.actor, reason: `Reactivación de la prueba #${t.id}` })).applied.length;
    }
    return { trial: await this.d.trials.reactivate(t.id, t.version, o.actor), licencesChanged };
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
