/**
 * Prueba autónoma de 15 días — servicio. No envía correos ni aprovisiona por sí mismo y nunca
 * suspende ni borra nada: `dueForReview` INFORMA de lo vencido; marcar «vencida» lo hace una persona
 * o la tarea programada (`scheduler.ts`, apagada por defecto), y vencer solo deja la cuenta en solo
 * lectura (las licencias ya caducan solas al final de la prueba).
 *
 * Seguridad:
 *  - Verificación de correo con token aleatorio (256 bits) del que solo se guarda el hash; caduca.
 *  - Reenvío del enlace: token nuevo (el anterior deja de valer), con espera mínima y máximo diario.
 *  - Una prueba abierta por correo (también impuesto por la BD), también entre alias +etiqueta del
 *    mismo buzón, y alta idempotente por clave. Una solicitud sin verificar con el enlace caducado no
 *    bloquea el correo: se anula al volver a registrarse o la anula la tarea programada.
 *  - Límites contra el abuso: por dominio de correo, por IP (hash), de aprovisionamientos en curso y
 *    dominios de correo desechable conocidos (lista corta ampliable por configuración).
 *  - Cada cambio exige la versión leída y queda auditado.
 */
import crypto from "node:crypto";
import { TERMINAL, nextState, type TrialAction, type TrialState } from "./machine";
import { TrialConflict, type TrialPatch, type TrialRequest, type TrialStore } from "./store";
import { canonicalMailbox, mailboxOf } from "./mailbox";

export { canonicalMailbox, mailboxOf };

export const TRIAL_DAYS = 15;
const DAY = 86_400_000;

export interface TrialLimits {
  /** Pruebas creadas por dominio de correo en 30 días. */
  perDomain30d: number;
  /** Altas por IP (hash) en 24 h. */
  perIp24h: number;
  /** Aprovisionamientos simultáneos en curso. */
  concurrentProvisioning: number;
  /**
   * Un aprovisionamiento sin cambios durante este tiempo se da por interrumpido (caída del proceso): deja de
   * contar para `concurrentProvisioning` y la tarea programada lo retoma.
   */
  provisioningStaleMs: number;
  /** Validez del enlace de verificación. */
  verificationTtlMs: number;
  /** Ampliaciones aprobables y días máximos por ampliación. */
  maxExtensions: number;
  maxExtensionDays: number;
  /** Espera mínima entre dos envíos del enlace de verificación (alta o reenvío). */
  resendCooldownMs: number;
  /** Reenvíos del enlace por solicitud en 24 h. */
  resendPer24h: number;
  /**
   * Vida máxima de una solicitud sin verificar: pasado este plazo ya no se renueva el enlace y la
   * solicitud se anula (libera el correo para registrarse de nuevo).
   */
  pendingMaxAgeMs: number;
}
export const DEFAULT_LIMITS: TrialLimits = {
  perDomain30d: 3,
  perIp24h: 5,
  concurrentProvisioning: 3,
  provisioningStaleMs: 15 * 60_000,
  verificationTtlMs: 24 * 60 * 60 * 1000,
  maxExtensions: 1,
  maxExtensionDays: 15,
  resendCooldownMs: 2 * 60_000,
  resendPer24h: 3,
  pendingMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
};
/** Dominios de correo personal: el límite por dominio no se les aplica (sí el de IP y el de correo). */
const PERSONAL_DOMAINS = new Set(["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com", "live.com", "protonmail.com", "yahoo.es", "hotmail.es"]);
/**
 * Correo desechable muy conocido (lista corta a propósito; se amplía con `blockedDomains`, p. ej. desde
 * `CP_TRIAL_BLOCKED_DOMAINS`). No pretende ser exhaustiva: los límites por IP y dominio siguen aplicando.
 */
export const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "sharklasers.com",
  "10minutemail.com",
  "yopmail.com",
  "temp-mail.org",
  "tempmail.com",
  "trashmail.com",
  "getnada.com",
  "dispostable.com",
  "maildrop.cc",
  "throwawaymail.com",
]);

/** Dominios adicionales a rechazar desde el entorno (`CP_TRIAL_BLOCKED_DOMAINS`, separados por comas). */
export function blockedDomainsFromEnv(env: NodeJS.ProcessEnv): string[] {
  return (env.CP_TRIAL_BLOCKED_DOMAINS ?? "").split(",").map((x) => x.trim().toLowerCase()).filter((x) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(x));
}

export class TrialError extends Error {
  constructor(
    public readonly code: "invalid_input" | "invalid_state" | "not_found" | "limit" | "conflict" | "forbidden",
    message: string,
  ) {
    super(message);
    this.name = "TrialError";
  }
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const EMAIL_RE = /^[^\s@]{1,64}@([a-z0-9-]+(\.[a-z0-9-]+)+)$/;

export interface SubscriptionLookup {
  /** Existe la suscripción y su tenant (si lo tiene). */
  get(id: number): Promise<{ id: number; tenantId: string | null; status: string } | null>;
}

export class TrialService {
  private now: () => number;
  private limits: TrialLimits;
  private blocked: ReadonlySet<string>;
  constructor(private d: { store: TrialStore; subscriptions?: SubscriptionLookup; now?: () => number; limits?: Partial<TrialLimits>; blockedDomains?: string[] }) {
    this.now = d.now ?? Date.now;
    this.limits = { ...DEFAULT_LIMITS, ...d.limits };
    this.blocked = new Set(Array.from(DISPOSABLE_DOMAINS).concat((d.blockedDomains ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean)));
  }

  /** Solicitud sin verificar cuyo enlace ya caducó (no bloquea el correo: se puede anular). */
  isStalePending(t: TrialRequest, now = this.now()) {
    return t.state === "pending_verification" && (t.verificationExpiresAt ?? 0) <= now;
  }

  /**
   * Prueba abierta de ese buzón (mismo correo, alias +etiqueta o variante de Gmail con puntos). Las solicitudes
   * sin verificar con el enlace caducado se anulan aquí mismo (`expire_verification`) y no cuentan.
   */
  private async openFor(email: string, actor: string) {
    const { base, domain } = mailboxOf(email);
    for (let i = 0; i < 5; i++) {
      const open = (await this.d.store.openByEmail(email)) ?? (await this.d.store.openByMailbox(canonicalMailbox(email), { base, domain }));
      if (!open || !this.isStalePending(open)) return open;
      try {
        await this.move(open.id, open.version, "expire_verification", actor, () => ({ verificationTokenHash: null, verificationExpiresAt: null }), "enlace caducado sin verificar");
      } catch (e) {
        // Otra petición la cambió a la vez: se vuelve a mirar
        if (!(e instanceof TrialError && e.code === "conflict")) throw e;
      }
    }
    throw new TrialError("conflict", "Ya hay una solicitud de prueba en curso para este correo");
  }

  /**
   * Registro desde la web (cuando se conecte). Idempotente por `idempotencyKey`; devuelve el token
   * de verificación EN CLARO solo al crearla (para que el remitente lo envíe por correo) y nunca lo
   * guarda.
   */
  async register(input: { email: string; companyName: string; configuration: { plan: string | null; addons: string[] }; idempotencyKey: string; ip?: string | null }) {
    const email = input.email.trim().toLowerCase();
    const m = EMAIL_RE.exec(email);
    if (!m || email.length > 254) throw new TrialError("invalid_input", "Correo no válido");
    const company = input.companyName.trim();
    if (company.length < 2 || company.length > 160) throw new TrialError("invalid_input", "Nombre de empresa entre 2 y 160 caracteres");
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(input.idempotencyKey)) throw new TrialError("invalid_input", "Clave de idempotencia no válida");
    const addons = input.configuration.addons ?? [];
    if (addons.length > 30 || addons.some((a) => !/^[a-z0-9][a-z0-9-]{0,62}$/.test(a)) || (input.configuration.plan !== null && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(input.configuration.plan))) {
      throw new TrialError("invalid_input", "Configuración no válida");
    }

    const domain = m[1];
    if (this.blocked.has(domain)) throw new TrialError("invalid_input", "Usa una dirección de correo permanente (de tu empresa o personal)");

    const again = await this.d.store.byIdempotencyKey(input.idempotencyKey);
    if (again) return { trial: again, created: false as const, verificationToken: null };
    // Un buzón, una prueba abierta: no se revela el estado de la existente
    if (await this.openFor(email, "system:trial")) throw new TrialError("conflict", "Ya hay una solicitud de prueba en curso para este correo");

    const now = this.now();
    const ipHash = input.ip ? sha256(`trial-ip:${input.ip}`) : null;
    if (!PERSONAL_DOMAINS.has(domain) && (await this.d.store.count({ emailDomain: domain, since: now - 30 * DAY })) >= this.limits.perDomain30d) {
      throw new TrialError("limit", "Se ha alcanzado el número de pruebas para este dominio; contacta con ventas");
    }
    if (ipHash && (await this.d.store.count({ ipHash, since: now - DAY })) >= this.limits.perIp24h) {
      throw new TrialError("limit", "Demasiadas solicitudes desde esta conexión; inténtalo más tarde");
    }
    const token = crypto.randomBytes(32).toString("base64url");
    try {
      const trial = await this.d.store.insert(
        {
          email,
          emailDomain: domain,
          companyName: company,
          configuration: { plan: input.configuration.plan, addons },
          state: "pending_verification",
          verificationTokenHash: sha256(token),
          verificationExpiresAt: now + this.limits.verificationTtlMs,
          verifiedAt: null,
          tenantId: null,
          startsAt: null,
          endsAt: null,
          extensionsUsed: 0,
          extensionRequestedAt: null,
          extensionReason: null,
          suspendedReason: null,
          convertedSubscriptionId: null,
          idempotencyKey: input.idempotencyKey,
          ipHash,
          createdAt: now,
        },
        "web",
      );
      return { trial, created: true as const, verificationToken: token };
    } catch (e) {
      // Dos altas simultáneas: la BD decide
      if (e instanceof TrialConflict && e.code === "duplicate_key") {
        const t = await this.d.store.byIdempotencyKey(input.idempotencyKey);
        if (t) return { trial: t, created: false as const, verificationToken: null };
      }
      if (e instanceof TrialConflict && e.code === "duplicate_email") throw new TrialError("conflict", "Ya hay una solicitud de prueba en curso para este correo");
      throw e;
    }
  }

  private async move(id: number, expectedVersion: number, action: TrialAction, actor: string, patch: (t: TrialRequest) => TrialPatch, detail: string | null = null) {
    const t = await this.must(id);
    if (t.version !== expectedVersion) throw new TrialError("conflict", "La solicitud cambió mientras tanto; recarga");
    const to = nextState(t.state, action);
    if (!to) throw new TrialError("invalid_state", `No se puede «${action}» desde «${t.state}»`);
    try {
      return await this.d.store.transition(id, expectedVersion, { ...patch(t), state: to }, { action, fromState: t.state, detail, actor, at: this.now() });
    } catch (e) {
      if (e instanceof TrialConflict) throw new TrialError("conflict", e.message);
      throw e;
    }
  }

  /** Verificación del correo: token correcto (comparación en tiempo constante) y no caducado. */
  async verify(id: number, token: string) {
    const t = await this.must(id);
    if (t.state !== "pending_verification" || !t.verificationTokenHash) throw new TrialError("invalid_state", "Esta solicitud no está pendiente de verificación");
    const a = Buffer.from(sha256(token), "hex");
    const b = Buffer.from(t.verificationTokenHash, "hex");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new TrialError("forbidden", "Enlace de verificación no válido");
    if ((t.verificationExpiresAt ?? 0) < this.now()) throw new TrialError("forbidden", "El enlace de verificación ha caducado");
    return this.move(id, t.version, "verify", "web", () => ({ verifiedAt: this.now(), verificationTokenHash: null, verificationExpiresAt: null }));
  }

  /**
   * Reenvío del enlace de verificación. Busca la solicitud por correo (web) o por id (operador) y, si
   * está pendiente, emite un token NUEVO (el anterior deja de valer) con validez completa, también si el
   * enlace ya había caducado, mientras la solicitud no supere `pendingMaxAgeMs` (si la supera, se anula
   * y el correo queda libre para registrarse de nuevo).
   *
   * Idempotente por correo: dentro de la espera mínima (`resendCooldownMs`) desde el último envío no se
   * genera nada (dos clics o dos peticiones simultáneas ⇒ un solo enlace nuevo). Máximo
   * `resendPer24h` reenvíos por solicitud en 24 h. El resultado es para el llamante interno; la ruta
   * pública responde siempre lo mismo y no revela si el correo existe.
   */
  async resendVerification(by: { email: string } | { trialId: number }, actor: string): Promise<{ trial: TrialRequest | null; verificationToken: string | null; outcome: "resent" | "not_found" | "not_pending" | "cooldown" | "limit" | "expired" }> {
    let t: TrialRequest | null;
    if ("trialId" in by) t = await this.d.store.get(by.trialId);
    else {
      const email = by.email.trim().toLowerCase();
      if (!EMAIL_RE.test(email) || email.length > 254) return { trial: null, verificationToken: null, outcome: "not_found" };
      t = await this.d.store.openByEmail(email);
    }
    if (!t) return { trial: null, verificationToken: null, outcome: "not_found" };
    if (t.state !== "pending_verification") return { trial: t, verificationToken: null, outcome: "not_pending" };
    const now = this.now();
    if (t.createdAt + this.limits.pendingMaxAgeMs <= now) {
      const out = await this.expireVerification(t.id, t.version, actor).catch((e) => {
        if (e instanceof TrialError && (e.code === "conflict" || e.code === "invalid_state")) return null;
        throw e;
      });
      return { trial: out, verificationToken: null, outcome: "expired" };
    }
    const resends = (await this.d.store.events(t.id)).filter((e) => e.action === "resend_verification");
    const lastIssued = Math.max(t.createdAt, ...resends.map((e) => e.createdAt));
    if (now - lastIssued < this.limits.resendCooldownMs) return { trial: t, verificationToken: null, outcome: "cooldown" };
    if (resends.filter((e) => e.createdAt > now - DAY).length >= this.limits.resendPer24h) return { trial: t, verificationToken: null, outcome: "limit" };
    const token = crypto.randomBytes(32).toString("base64url");
    try {
      const trial = await this.move(t.id, t.version, "resend_verification", actor, () => ({ verificationTokenHash: sha256(token), verificationExpiresAt: now + this.limits.verificationTtlMs }), "enlace nuevo");
      return { trial, verificationToken: token, outcome: "resent" };
    } catch (e) {
      // Otra petición simultánea ya renovó el enlace: se trata como un clic repetido
      if (e instanceof TrialError && e.code === "conflict") return { trial: t, verificationToken: null, outcome: "cooldown" };
      throw e;
    }
  }

  /**
   * Anula una solicitud sin verificar cuyo enlace caducó (libera el correo). Solo si de verdad está
   * pendiente y con el enlace caducado o la solicitud superó su vida máxima.
   */
  async expireVerification(id: number, expectedVersion: number, actor: string) {
    const t = await this.must(id);
    const now = this.now();
    if (t.state !== "pending_verification" || (!this.isStalePending(t, now) && t.createdAt + this.limits.pendingMaxAgeMs > now)) {
      throw new TrialError("invalid_state", "La solicitud no está pendiente con el enlace caducado");
    }
    return this.move(id, expectedVersion, "expire_verification", actor, () => ({ verificationTokenHash: null, verificationExpiresAt: null }), "enlace caducado sin verificar");
  }

  /** Clave del aviso de vencimiento: incluye la fecha de fin (una ampliación vuelve a avisar). */
  static noticeKey(t: { endsAt: number }, daysLeft: number) {
    return `expiry:${t.endsAt}:${daysLeft}`;
  }
  /** ¿Ya se encoló ese aviso para esta prueba? */
  async noticeQueued(id: number, key: string) {
    return (await this.d.store.events(id)).some((e) => e.action === "notice_queued" && e.detail === key);
  }
  /** Deja constancia de un aviso encolado (sin cambiar estado ni versión). */
  async recordNotice(id: number, key: string, actor: string) {
    await this.d.store.note(id, { action: "notice_queued", detail: key, actor, at: this.now() });
  }

  /** Límites efectivos (para la tarea programada). */
  get effectiveLimits(): Readonly<TrialLimits> {
    return this.limits;
  }

  /**
   * Pide el aprovisionamiento (no lo ejecuta). Limita los aprovisionamientos simultáneos; los interrumpidos
   * (sin cambios durante `provisioningStaleMs`) no cuentan.
   */
  async requestProvisioning(id: number, expectedVersion: number, actor: string) {
    const t = await this.must(id);
    if (t.state === "provisioning") return t; // idempotente
    if ((await this.d.store.count({ state: "provisioning", updatedSince: this.now() - this.limits.provisioningStaleMs })) >= this.limits.concurrentProvisioning) {
      throw new TrialError("limit", "Hay demasiados aprovisionamientos en curso; inténtalo en unos minutos");
    }
    return this.move(id, expectedVersion, "request_provisioning", actor, () => ({}));
  }

  /** El aprovisionamiento terminó: empieza la prueba de 15 días. Un tenant, una prueba. */
  async markProvisioned(id: number, expectedVersion: number, tenantId: string, actor: string) {
    if (!/^[a-z][a-z0-9-]{1,62}$/.test(tenantId)) throw new TrialError("invalid_input", "Identificador de tenant no válido");
    const now = this.now();
    return this.move(id, expectedVersion, "provisioned", actor, () => ({ tenantId, startsAt: now, endsAt: now + TRIAL_DAYS * DAY }), `tenant ${tenantId}`);
  }

  /** Fallo de aprovisionamiento: vuelve a «verificada» para reintentar; sin tenant a medias. */
  async markProvisioningFailed(id: number, expectedVersion: number, reason: string, actor: string) {
    return this.move(id, expectedVersion, "provisioning_failed", actor, () => ({ tenantId: null }), reason.slice(0, 300));
  }

  async requestExtension(id: number, expectedVersion: number, reason: string) {
    if (!reason.trim()) throw new TrialError("invalid_input", "Indica el motivo de la ampliación");
    return this.move(id, expectedVersion, "request_extension", "cliente", () => ({ extensionRequestedAt: this.now(), extensionReason: reason.trim().slice(0, 300) }));
  }

  /** Ampliación aprobada por una persona (máximo de ampliaciones y de días). */
  async approveExtension(id: number, expectedVersion: number, days: number, actor: string) {
    const t = await this.must(id);
    if (!Number.isInteger(days) || days < 1 || days > this.limits.maxExtensionDays) throw new TrialError("invalid_input", `Entre 1 y ${this.limits.maxExtensionDays} días`);
    if (t.extensionsUsed >= this.limits.maxExtensions) throw new TrialError("limit", "Ya se usaron las ampliaciones permitidas");
    const base = Math.max(t.endsAt ?? this.now(), this.now());
    return this.move(id, expectedVersion, "approve_extension", actor, (x) => ({ endsAt: base + days * DAY, extensionsUsed: x.extensionsUsed + 1, extensionRequestedAt: null }), `+${days} días`);
  }

  /** Marca como vencida una prueba cuyo plazo ya pasó. Lo decide una persona: nada lo llama solo. */
  async markExpired(id: number, expectedVersion: number, actor: string) {
    const t = await this.must(id);
    if (t.endsAt === null || t.endsAt > this.now()) throw new TrialError("invalid_state", "La prueba todavía no ha vencido");
    return this.move(id, expectedVersion, "mark_expired", actor, () => ({}));
  }

  async suspend(id: number, expectedVersion: number, reason: string, actor: string) {
    if (!reason.trim()) throw new TrialError("invalid_input", "Indica el motivo de la suspensión");
    return this.move(id, expectedVersion, "suspend", actor, () => ({ suspendedReason: reason.trim().slice(0, 300) }), reason.trim().slice(0, 300));
  }

  /** Reactivar exige que quede plazo (o ampliarlo antes). */
  async reactivate(id: number, expectedVersion: number, actor: string) {
    const t = await this.must(id);
    if (t.endsAt === null || t.endsAt <= this.now()) throw new TrialError("invalid_state", "La prueba ha vencido: amplíala o conviértela en suscripción");
    return this.move(id, expectedVersion, "reactivate", actor, () => ({ suspendedReason: null }));
  }

  /** Conversión en suscripción: debe existir y, si tiene tenant, ser el de la prueba. */
  async convert(id: number, expectedVersion: number, subscriptionId: number, actor: string) {
    const t = await this.must(id);
    const sub = await this.d.subscriptions?.get(subscriptionId);
    if (!sub) throw new TrialError("invalid_input", "La suscripción no existe");
    if (sub.status === "canceled") throw new TrialError("invalid_state", "La suscripción está cancelada");
    if (sub.tenantId && t.tenantId && sub.tenantId !== t.tenantId) throw new TrialError("invalid_input", "La suscripción es de otro tenant");
    return this.move(id, expectedVersion, "convert", actor, () => ({ convertedSubscriptionId: subscriptionId }), `suscripción #${subscriptionId}`);
  }

  async reject(id: number, expectedVersion: number, reason: string, actor: string) {
    return this.move(id, expectedVersion, "reject", actor, () => ({}), reason.slice(0, 300));
  }
  async cancel(id: number, expectedVersion: number, reason: string, actor: string) {
    return this.move(id, expectedVersion, "cancel", actor, () => ({}), reason.slice(0, 300));
  }

  /** Informe para revisión humana: pruebas vencidas y ampliaciones pendientes. NO cambia nada. */
  async dueForReview() {
    const now = this.now();
    const [expired, extensions] = await Promise.all([
      this.d.store.list({ states: ["active"], endsBefore: now }),
      this.d.store.list({ states: ["active", "expired"], extensionRequested: true }),
    ]);
    return { generatedAt: now, expired, extensionRequests: extensions, note: "Informe: no se suspende ni se elimina nada automáticamente." };
  }

  async must(id: number) {
    const t = await this.d.store.get(id);
    if (!t) throw new TrialError("not_found", "Solicitud no encontrada");
    return t;
  }

  /** Vista segura (sin hash de token ni IP). */
  static view(t: TrialRequest) {
    const { verificationTokenHash: _h, ipHash: _ip, idempotencyKey: _k, ...rest } = t;
    return { ...rest, terminal: TERMINAL.has(t.state as TrialState) };
  }
}
