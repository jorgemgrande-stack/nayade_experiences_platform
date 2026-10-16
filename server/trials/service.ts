/**
 * Prueba autónoma de 15 días — servicio (PREPARACIÓN). No está conectado a ninguna ruta pública, no
 * envía correos, no aprovisiona por sí mismo y nunca suspende ni borra nada automáticamente:
 * `dueForReview` solo INFORMA de lo vencido para que una persona decida.
 *
 * Seguridad:
 *  - Verificación de correo con token aleatorio (256 bits) del que solo se guarda el hash; caduca.
 *  - Una prueba abierta por correo (también impuesto por la BD) y alta idempotente por clave.
 *  - Límites contra el abuso: por dominio de correo, por IP (hash) y de aprovisionamientos en curso.
 *  - Cada cambio exige la versión leída y queda auditado.
 */
import crypto from "node:crypto";
import { TERMINAL, nextState, type TrialAction, type TrialState } from "./machine";
import { TrialConflict, type TrialPatch, type TrialRequest, type TrialStore } from "./store";

export const TRIAL_DAYS = 15;
const DAY = 86_400_000;

export interface TrialLimits {
  /** Pruebas creadas por dominio de correo en 30 días. */
  perDomain30d: number;
  /** Altas por IP (hash) en 24 h. */
  perIp24h: number;
  /** Aprovisionamientos simultáneos en curso. */
  concurrentProvisioning: number;
  /** Validez del enlace de verificación. */
  verificationTtlMs: number;
  /** Ampliaciones aprobables y días máximos por ampliación. */
  maxExtensions: number;
  maxExtensionDays: number;
}
export const DEFAULT_LIMITS: TrialLimits = {
  perDomain30d: 3,
  perIp24h: 5,
  concurrentProvisioning: 3,
  verificationTtlMs: 24 * 60 * 60 * 1000,
  maxExtensions: 1,
  maxExtensionDays: 15,
};
/** Dominios de correo personal: el límite por dominio no se les aplica (sí el de IP y el de correo). */
const PERSONAL_DOMAINS = new Set(["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com", "live.com", "protonmail.com", "yahoo.es", "hotmail.es"]);

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
  constructor(private d: { store: TrialStore; subscriptions?: SubscriptionLookup; now?: () => number; limits?: Partial<TrialLimits> }) {
    this.now = d.now ?? Date.now;
    this.limits = { ...DEFAULT_LIMITS, ...d.limits };
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

    const again = await this.d.store.byIdempotencyKey(input.idempotencyKey);
    if (again) return { trial: again, created: false as const, verificationToken: null };
    // Un correo, una prueba abierta: no se revela el estado de la existente
    if (await this.d.store.openByEmail(email)) throw new TrialError("conflict", "Ya hay una solicitud de prueba en curso para este correo");

    const now = this.now();
    const domain = m[1];
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

  /** Pide el aprovisionamiento (no lo ejecuta). Limita los aprovisionamientos simultáneos. */
  async requestProvisioning(id: number, expectedVersion: number, actor: string) {
    const t = await this.must(id);
    if (t.state === "provisioning") return t; // idempotente
    if ((await this.d.store.count({ state: "provisioning" })) >= this.limits.concurrentProvisioning) {
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
