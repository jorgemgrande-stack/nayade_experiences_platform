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
import { opsLog } from "../_core/ops/log";
import { nextState } from "./machine";
import { TrialError, TrialService } from "./service";
import type { TrialRequest } from "./store";

const DAY = 86_400_000;
export const ESSENTIAL_PLAN = "essential";
export const TRIAL_PLAN_DAYS = 15;
/** Avisos antes del vencimiento (días): 7, 3 y 1 días antes y el día del fin (D-16; prueba de 15 días). */
export const NOTICE_DAYS = [7, 3, 1, 0] as const;

export interface TrialNotifier {
  /** Enlace de verificación; `resend`: es un reenvío (token nuevo, el anterior ya no vale). */
  verification(to: string, link: { trialId: number; token: string; resend?: boolean }): Promise<void>;
  /** Bienvenida con el acceso; `endsAt`: fin de la prueba si sigue activa (se muestra en el correo). */
  welcome(to: string, info: { tenantId: string; domain: string | null; inviteToken: string; endsAt?: number | null }): Promise<void>;
  /** Aviso de vencimiento: `daysLeft` 3 y 1 antes; 0 cuando la prueba ya ha terminado (solo lectura). */
  expiryNotice(to: string, info: { trialId: number; endsAt: number; daysLeft: number }): Promise<void>;
  /**
   * Cambio decidido por el equipo (ampliación, pausa o reactivación). `version`: la de la prueba tras el cambio
   * (clave de idempotencia: una transición, un aviso). Opcional: un notificador sin él no avisa.
   */
  statusNotice?(to: string, info: TrialStatusNotice): Promise<void>;
}

export interface TrialStatusNotice {
  trialId: number;
  version: number;
  kind: "extended" | "suspended" | "reactivated";
  endsAt: number | null;
  domain: string | null;
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

  /**
   * Alta asistida por operador (beta privada): crea la solicitud de una empresa invitada, la da por
   * verificada (el operador responde de la dirección de correo) y la activa. No depende del registro
   * público ni envía correos: devuelve el enlace de acceso del propietario para entregarlo por un canal
   * acordado. Idempotente por `idempotencyKey`, como el registro.
   */
  async registerByOperator(input: { email: string; companyName: string; idempotencyKey: string }, actor: string) {
    const r = await this.d.trials.register({ email: input.email, companyName: input.companyName, configuration: { plan: ESSENTIAL_PLAN, addons: [] }, idempotencyKey: input.idempotencyKey, ip: null });
    if (r.created && r.verificationToken) await this.d.trials.verify(r.trial.id, r.verificationToken);
    const t = await this.d.trials.must(r.trial.id);
    if (t.state === "pending_verification") throw new TrialError("conflict", "Esa solicitud ya existe y está pendiente de que el interesado verifique su correo");
    let inviteToken: string | null = null;
    const out = await this.activate(t.id, actor, (token) => void (inviteToken = token));
    const accessUrl = out.domain && inviteToken ? `https://${out.domain}/establecer-contrasena?token=${encodeURIComponent(inviteToken)}` : null;
    return { ...out, accessUrl };
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
  async activate(trialId: number, actor: string, onInvite?: (token: string) => void) {
    const prev = this.inflight.get(trialId) ?? Promise.resolve();
    const mine = prev.then(() => this.activateSerialized(trialId, actor, onInvite));
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
    await this.d.notify.welcome(t.email, { tenantId: t.tenantId, domain: `${t.tenantId}.${this.d.platformDomain}`, inviteToken: token, endsAt: t.state === "active" ? t.endsAt : null });
    return { sent: true as const };
  }

  /** Estado actual de una prueba (sin datos personales), para respuestas públicas. */
  async stateOf(trialId: number) {
    return (await this.d.trials.must(trialId)).state;
  }

  private inflight = new Map<number, Promise<unknown>>();

  private async activateSerialized(trialId: number, actor: string, onInvite?: (token: string) => void) {
    let t = await this.d.trials.must(trialId);
    if (!["verified", "provisioning", "active"].includes(t.state)) throw new TrialError("invalid_state", `La prueba está en «${t.state}»: no se puede activar`);
    const tenantId = t.tenantId ?? trialTenantId(t.id, t.companyName);
    let domain: string | null = null;

    // 0. Antes de crear nada: sin tarifa Essential aprobada la prueba no podría tener suscripción ni licencias, y se
    // quedaría una plataforma a medias con la bienvenida ya enviada. La prueba sigue verificada y se puede reintentar.
    if (t.state === "verified" && !(await this.d.priceOf(ESSENTIAL_PLAN, "monthly"))) throw new TrialError("invalid_state", "Essential no tiene tarifa mensual aprobada y publicada");

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
      if (inviteToken) {
        onInvite?.(inviteToken);
        await this.d.notify.welcome(t.email, { tenantId, domain, inviteToken, endsAt: t.endsAt });
      }
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

  /** Pruebas activas que necesitan aviso hoy (7, 3, 1 y 0 días antes del vencimiento). No envía nada. */
  async noticesDue(listActive: () => Promise<Array<{ id: number; email: string; endsAt: number | null }>>) {
    const now = this.now();
    return (await listActive())
      .filter((t) => t.endsAt !== null)
      .map((t) => ({ ...t, daysLeft: Math.max(0, Math.ceil((t.endsAt! - now) / DAY)) }))
      .filter((t) => (NOTICE_DAYS as readonly number[]).includes(t.daysLeft));
  }

  /** Envío EXPLÍCITO de avisos (lo lanza una persona o un proceso autorizado). */
  async sendNotices(due: Array<{ id: number; email: string; endsAt: number | null; daysLeft: number }>) {
    for (const t of due) {
      await this.d.notify.expiryNotice(t.email, { trialId: t.id, endsAt: t.endsAt!, daysLeft: t.daysLeft });
      // Constancia para que la tarea programada no repita el mismo aviso
      await this.d.trials.recordNotice(t.id, TrialService.noticeKey({ endsAt: t.endsAt! }, t.daysLeft), "operator");
    }
    return { sent: due.length };
  }

  /**
   * Reenvío del enlace de verificación (web por correo, operador por id). Solo se envía si se emitió un
   * token nuevo; el resultado detallado es para el operador: la ruta pública no lo muestra.
   */
  async resendVerification(by: { email: string } | { trialId: number }, actor: string) {
    const r = await this.d.trials.resendVerification(by, actor);
    if (r.verificationToken && r.trial) await this.d.notify.verification(r.trial.email, { trialId: r.trial.id, token: r.verificationToken, resend: true });
    return { outcome: r.outcome, state: r.trial?.state ?? null, verificationExpiresAt: r.outcome === "resent" ? (r.trial?.verificationExpiresAt ?? null) : null };
  }

  /**
   * Vencimiento (operador; también lo hace la tarea programada): las licencias ya caducaron (solo lectura). Nada se
   * borra. Envía el aviso de vencimiento (0 días) con la misma constancia que la tarea programada, así que nunca se
   * repite; si el aviso falla, el vencimiento queda hecho igualmente.
   */
  async expire(trialId: number, actor: string) {
    const t = await this.d.trials.must(trialId);
    const expired = await this.d.trials.markExpired(t.id, t.version, actor);
    if (expired.endsAt !== null) {
      const key = TrialService.noticeKey({ endsAt: expired.endsAt }, 0);
      try {
        if (!(await this.d.trials.noticeQueued(expired.id, key))) {
          await this.d.notify.expiryNotice(expired.email, { trialId: expired.id, endsAt: expired.endsAt, daysLeft: 0 });
          await this.d.trials.recordNotice(expired.id, key, actor);
        }
      } catch (e) {
        opsLog("warn", "Trials", "expiry_notice_failed", { trialId: expired.id, error: e instanceof Error ? e.name : "error" });
      }
    }
    return expired;
  }

  /** Ampliación aprobada por el equipo: nuevo fin y aviso a la persona solicitante. */
  async approveExtension(trialId: number, o: { expectedVersion: number; days: number; actor: string }) {
    const t = await this.d.trials.approveExtension(trialId, o.expectedVersion, o.days, o.actor);
    await this.tellStatus(t, "extended");
    return t;
  }

  /** Aviso de un cambio decidido por el equipo. Un fallo del aviso nunca deshace el cambio. */
  private async tellStatus(t: TrialRequest, kind: TrialStatusNotice["kind"]) {
    if (!this.d.notify.statusNotice) return;
    try {
      await this.d.notify.statusNotice(t.email, { trialId: t.id, version: t.version, kind, endsAt: kind === "suspended" ? null : t.endsAt, domain: t.tenantId ? `${t.tenantId}.${this.d.platformDomain}` : null });
    } catch (e) {
      opsLog("warn", "Trials", "status_notice_failed", { trialId: t.id, kind, error: e instanceof Error ? e.name : "error" });
    }
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
    const suspended = await this.d.trials.suspend(t.id, t.version, o.reason, o.actor);
    await this.tellStatus(suspended, "suspended");
    return suspended;
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
    const trial = await this.d.trials.reactivate(t.id, t.version, o.actor);
    await this.tellStatus(trial, "reactivated");
    return { trial, licencesChanged };
  }

  // La conversión a pago no se hace aquí: es un pedido del orquestador (POST /orders con el cobro, o la
  // excepción administrativa tipificada de POST /trials/:id/convert, que también crea y aprueba un pedido).
}
