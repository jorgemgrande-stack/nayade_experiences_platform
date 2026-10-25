/**
 * Servicio de correo transaccional: bandeja de salida persistente + proveedor detrás de un puerto.
 *
 *   send() → [política: remitente, guarda, modo, sandbox, supresión, límites] → fila en la bandeja
 *          → intento inmediato (dispatch) → accepted | pending con espera | failed
 *   drain() → reintentos vencidos (backoff limitado, MAIL_MAX_ATTEMPTS)
 *   applyEvent() → eventos del proveedor (webhook): delivered, rebotes, bloqueo, queja, baja
 *
 * Garantías:
 *  - Idempotencia por (empresa, clave): un reintento o un doble clic devuelve el mismo mensaje, no otro.
 *  - Un servicio ligado a una empresa (`tenantId`) no acepta ni despacha mensajes de otra.
 *  - En off/sandbox nada sale hacia destinatarios no autorizados (se guarda como «skipped», sin cuerpo).
 *  - Los registros llevan ids, categorías y estados; nunca direcciones, asuntos, cuerpos ni tokens. Al
 *    llegar a un estado final se borran el cuerpo y la dirección completa (queda la enmascarada y la huella).
 */
import crypto from "node:crypto";
import { opsLog } from "../_core/ops/log";
import { recordFailure } from "../_core/ops/failureAlerts";
import { backoffMs, maskRecipient, normalizeEmail, recipientAllowed, recipientHash, scopeAllows, senderFor, type MailPolicy } from "./policy";
import type { MailStore } from "./store";
import { MailProviderError, type EnqueueInput, type MailLane, type MailProviderPort, type MailStatus, type OutboxRow, type ProviderEvent } from "./types";

/** `fromEmail`: dirección propia de la empresa cuando envía por su SMTP (ver mail/ownSmtp.ts). */
export type SenderIdentity = { lane: "tenant"; brandName: string; replyTo: string | null; fromEmail?: string | null } | { lane: "platform" };

export interface SendInput extends EnqueueInput {
  sender: SenderIdentity;
  /** Comprobación adicional del contenido (p. ej. enlaces prohibidos): devuelve el motivo para no enviar. */
  guard?: (html: string) => string | null;
  /**
   * Si se alcanza un límite por hora, retener el mensaje (pendiente, `reason = rate_limited_deferred`) para la siguiente
   * franja en vez de descartarlo. Solo lo piden los avisos internos que no se pueden perder (solicitudes de la web).
   */
  deferOnRateLimit?: boolean;
}

/** Motivo de un mensaje retenido por el límite por hora (sale solo al abrirse la siguiente franja). */
export const RATE_DEFERRED = "rate_limited_deferred";

export interface SendResult {
  id: number | null;
  status: MailStatus;
  reason: string | null;
  duplicate: boolean;
}

export interface MailServiceDeps {
  lane: MailLane;
  store: MailStore;
  provider: MailProviderPort | null;
  policy: MailPolicy;
  /** Si se indica, el servicio solo trabaja con mensajes de esta empresa. */
  tenantId?: string;
  now?: () => number;
  log?: (level: "info" | "warn" | "error", event: string, data: Record<string, unknown>) => void;
}

const KEY_RE = /^[A-Za-z0-9:._-]{1,160}$/;
const HOUR = 3_600_000;

/** Clave por contenido (si el llamante no da una): el mismo aviso idéntico en 10 minutos es un duplicado. */
export function contentKey(category: string, to: string, subject: string, html: string, now: number): string {
  const h = crypto.createHash("sha256").update(`${category}\n${to.trim().toLowerCase()}\n${subject}\n${html}`).digest("hex").slice(0, 40);
  return `auto:${category}:${h}:${Math.floor(now / 600_000)}`;
}

/** Referencia opaca para el proveedor (vuelve en los webhooks): carril, empresa e id. Sin datos personales. */
export function mailRef(lane: MailLane, tenantId: string, id: number): string {
  return `es1.${lane === "tenant" ? "t" : "p"}.${tenantId}.${id}`;
}
export function parseMailRef(ref: string | null | undefined): { lane: MailLane; tenantId: string; id: number } | null {
  const m = /^es1\.([tp])\.([a-z0-9][a-z0-9_-]{0,62})\.(\d{1,15})$/.exec((ref ?? "").trim());
  return m ? { lane: m[1] === "t" ? "tenant" : "platform", tenantId: m[2], id: Number(m[3]) } : null;
}

/** Cambios de estado permitidos por un evento del proveedor (nunca hacia atrás). */
const EVENT_TRANSITIONS: Record<string, { to: MailStatus | null; from: MailStatus[]; suppress?: string }> = {
  delivered: { to: "delivered", from: ["accepted", "soft_bounced"] },
  soft_bounce: { to: "soft_bounced", from: ["accepted"] },
  deferred: { to: "soft_bounced", from: ["accepted"] },
  hard_bounce: { to: "bounced", from: ["accepted", "soft_bounced", "delivered"], suppress: "hard_bounce" },
  invalid: { to: "bounced", from: ["accepted", "soft_bounced"], suppress: "invalid" },
  blocked: { to: "blocked", from: ["accepted", "soft_bounced"] },
  spam: { to: "complained", from: ["accepted", "soft_bounced", "delivered"], suppress: "complaint" },
  unsubscribed: { to: null, from: [], suppress: "unsubscribed" },
  error: { to: "failed", from: ["accepted"] },
};

export class MailService {
  private now: () => number;
  private log: NonNullable<MailServiceDeps["log"]>;
  constructor(private d: MailServiceDeps) {
    this.now = d.now ?? Date.now;
    this.log = d.log ?? ((level, event, data) => opsLog(level, "Mail", event, data));
  }

  get lane() {
    return this.d.lane;
  }
  get mode() {
    return this.d.policy.mode;
  }

  private assertTenant(tenantId: string) {
    if (this.d.tenantId && tenantId !== this.d.tenantId) throw new Error("Mensaje de otra empresa: rechazado");
  }

  /** Decide si el mensaje puede salir; `null` = pendiente de envío. */
  private async decide(input: SendInput, to: string, hash: string, sender: ReturnType<typeof senderFor>): Promise<string | null> {
    if (!sender) return "sender_unavailable";
    const guarded = input.guard?.(input.html) ?? null;
    if (guarded) return guarded;
    if (this.d.policy.mode === "off") return "mode_off";
    if (!recipientAllowed(this.d.policy, to)) return "sandbox_recipient_not_allowed";
    // Ámbito (MAIL_SCOPE_TENANTS / MAIL_SCOPE_CATEGORIES): fuera de él no sale nada, aunque el modo lo permita
    if (!scopeAllows(this.d.policy, input.tenantId, input.category)) return "scope_not_allowed";
    if (await this.d.store.isSuppressed(input.tenantId, hash)) return "suppressed";
    const since = this.now() - HOUR;
    if ((await this.d.store.countSince(input.tenantId, since)) >= this.d.policy.limits.tenantPerHour) return "rate_limited_tenant";
    if ((await this.d.store.countSince(input.tenantId, since, hash)) >= this.d.policy.limits.recipientPerHour) return "rate_limited_recipient";
    return null;
  }

  async send(input: SendInput): Promise<SendResult> {
    this.assertTenant(input.tenantId);
    const now = this.now();
    const to = normalizeEmail(input.to);
    if (!to) {
      this.log("warn", "not_queued", { lane: this.d.lane, tenantId: input.tenantId, category: input.category, reason: "invalid_recipient" });
      return { id: null, status: "skipped", reason: "invalid_recipient", duplicate: false };
    }
    const key = KEY_RE.test(input.idempotencyKey) ? input.idempotencyKey : contentKey(input.category, to, input.subject, input.html, now);
    const hash = recipientHash(to);
    const sender = senderFor(this.d.policy, input.sender);
    const skip = await this.decide(input, to, hash, sender);
    // Copias: solo las autorizadas y no suprimidas; el resto se descarta sin enviarle nada
    const cc: string[] = [];
    if (!skip)
      for (const raw of input.cc ?? []) {
        const c = normalizeEmail(raw);
        if (c && c !== to && !cc.includes(c) && recipientAllowed(this.d.policy, c) && !(await this.d.store.isSuppressed(input.tenantId, recipientHash(c)))) cc.push(c);
      }
    // Límite por hora alcanzado con `deferOnRateLimit`: no se descarta; se retiene y sale solo en la siguiente franja con
    // hueco (escalonado, como mucho el límite por hora), sin avalanchas al reabrirse
    const limits = this.d.policy.limits;
    const defer = !!input.deferOnRateLimit && !!this.d.provider && (skip === "rate_limited_recipient" || skip === "rate_limited_tenant");
    let deferUntil: number | null = null;
    if (defer) {
      const since = now - HOUR;
      const [n, cap] = skip === "rate_limited_tenant" ? [await this.d.store.countSince(input.tenantId, since), limits.tenantPerHour] : [await this.d.store.countSince(input.tenantId, since, hash), limits.recipientPerHour];
      deferUntil = now + HOUR * (1 + Math.floor(Math.max(0, n - cap) / cap));
      this.log("warn", "rate_limit_deferred", { lane: this.d.lane, tenantId: input.tenantId, category: input.category, limit: skip, inMs: deferUntil - now });
      recordFailure("mail.rate_limited_deferred", input.tenantId);
    }
    const status: MailStatus = defer ? "pending" : skip ? "skipped" : this.d.provider ? "pending" : "failed";
    const reason = defer ? RATE_DEFERRED : (skip ?? (this.d.provider ? null : "no_provider"));
    const keep = status === "pending";
    const { row, created } = await this.d.store.insert({
      tenantId: input.tenantId,
      idempotencyKey: key,
      category: input.category,
      status,
      reason,
      recipientHash: hash,
      recipientMasked: maskRecipient(to),
      toEmail: keep ? to : null,
      cc: keep ? cc : [],
      senderName: sender?.from.name ?? "",
      senderEmail: sender?.from.email ?? "",
      replyTo: sender?.replyTo ?? null,
      subject: input.subject.replace(/[\r\n]+/g, " ").slice(0, 400),
      html: keep ? input.html : null,
      text: keep ? (input.text ?? null) : null,
      attachments: keep ? (input.attachments ?? []) : [],
      nextAttemptAt: keep ? (deferUntil ?? now) : null,
      createdAt: now,
    });
    if (!created) {
      this.log("info", "duplicate", { lane: this.d.lane, tenantId: row.tenantId, id: row.id, category: row.category, status: row.status });
      return { id: row.id, status: row.status, reason: row.reason, duplicate: true };
    }
    await this.d.store.addEvent({ outboxId: row.id, tenantId: row.tenantId, kind: status === "pending" ? "queued" : status, providerEventId: null, detail: reason, at: now });
    this.log(status === "failed" ? "error" : "info", "queued", { lane: this.d.lane, tenantId: row.tenantId, id: row.id, category: row.category, status, reason, mode: this.d.policy.mode, ccDropped: (input.cc?.length ?? 0) - cc.length });
    if (status === "failed") recordFailure("mail.send_failed", row.tenantId);
    if (status !== "pending") return { id: row.id, status, reason, duplicate: false };
    const after = await this.dispatch(row.id);
    return { id: row.id, status: after?.status ?? "pending", reason: after?.reason ?? null, duplicate: false };
  }

  /** Un intento de envío de un mensaje (si está pendiente y vencido). */
  async dispatch(id: number): Promise<OutboxRow | null> {
    const now = this.now();
    const row = await this.d.store.claim(id, now, this.d.policy.retry.lockMs);
    if (!row) return this.d.store.get(id);
    if (this.d.tenantId && row.tenantId !== this.d.tenantId) {
      // Nunca se envía un mensaje de otra empresa desde este servicio: se devuelve a la cola
      await this.d.store.settle(id, { status: "pending", nextAttemptAt: row.nextAttemptAt }, now);
      return null;
    }
    const fail = async (status: "failed", code: string) => {
      await this.d.store.settle(id, { status, reason: code, lastError: code, purge: true }, now);
      await this.d.store.addEvent({ outboxId: id, tenantId: row.tenantId, kind: "failed", providerEventId: null, detail: code, at: now });
      this.log("error", "send_failed", { lane: this.d.lane, tenantId: row.tenantId, id, category: row.category, attempts: row.attempts, code });
      recordFailure("mail.send_failed", row.tenantId);
    };
    if (!this.d.provider) {
      await fail("failed", "no_provider");
      return this.d.store.get(id);
    }
    if (!row.toEmail || row.html === null) {
      await fail("failed", "content_missing");
      return this.d.store.get(id);
    }
    // El modo puede haber cambiado desde que se encoló (p. ej. vuelta a off): se revalida
    if (!recipientAllowed(this.d.policy, row.toEmail)) {
      await this.d.store.settle(id, { status: "skipped", reason: this.d.policy.mode === "off" ? "mode_off" : "sandbox_recipient_not_allowed", purge: true }, now);
      return this.d.store.get(id);
    }
    if (!scopeAllows(this.d.policy, row.tenantId, row.category)) {
      await this.d.store.settle(id, { status: "skipped", reason: "scope_not_allowed", purge: true }, now);
      return this.d.store.get(id);
    }
    try {
      const r = await this.d.provider.send({
        from: { name: row.senderName, email: row.senderEmail },
        replyTo: row.replyTo,
        to: row.toEmail,
        cc: row.cc.filter((c) => recipientAllowed(this.d.policy, c)),
        subject: row.subject,
        html: row.html,
        text: row.text ?? undefined,
        attachments: row.attachments,
        tag: row.category,
        ref: mailRef(this.d.lane, row.tenantId, id),
        idempotencyKey: `${row.tenantId}:${row.idempotencyKey}`.slice(0, 200),
      });
      await this.d.store.settle(id, { status: "accepted", reason: null, provider: this.d.provider.name, providerMessageId: r.messageId, purge: true }, now);
      await this.d.store.addEvent({ outboxId: id, tenantId: row.tenantId, kind: "accepted", providerEventId: null, detail: this.d.provider.name, at: now });
      this.log("info", "accepted", { lane: this.d.lane, tenantId: row.tenantId, id, category: row.category, provider: this.d.provider.name, attempts: row.attempts });
    } catch (e) {
      const err = e instanceof MailProviderError ? e : new MailProviderError("internal_error", true);
      if (err.retryable && row.attempts < this.d.policy.retry.maxAttempts) {
        const next = now + backoffMs(this.d.policy, row.attempts);
        await this.d.store.settle(id, { status: "pending", lastError: err.code, nextAttemptAt: next, provider: this.d.provider.name }, now);
        await this.d.store.addEvent({ outboxId: id, tenantId: row.tenantId, kind: "retry_scheduled", providerEventId: null, detail: err.code, at: now });
        this.log("warn", "retry_scheduled", { lane: this.d.lane, tenantId: row.tenantId, id, category: row.category, attempts: row.attempts, code: err.code, inMs: next - now });
      } else await fail("failed", err.code);
    }
    return this.d.store.get(id);
  }

  /** Reintentos vencidos (y reservas caducadas). Devuelve cuántos se intentaron. */
  async drain(limit = 20): Promise<number> {
    const ids = await this.d.store.due(this.d.tenantId ?? null, this.now(), limit);
    for (const id of ids) await this.dispatch(id);
    return ids.length;
  }

  /**
   * Evento del proveedor ya AUTENTICADO por el webhook. Se localiza el mensaje por la referencia (y se
   * exige que el messageId coincida) o por el messageId; cada evento se aplica una vez.
   */
  async applyEvent(ev: ProviderEvent): Promise<"applied" | "duplicate" | "ignored"> {
    const ref = parseMailRef(ev.ref);
    let row: OutboxRow | null = null;
    if (ref) {
      if (ref.lane !== this.d.lane) return "ignored";
      if (this.d.tenantId && ref.tenantId !== this.d.tenantId) return "ignored";
      row = await this.d.store.get(ref.id);
      if (row && (row.tenantId !== ref.tenantId || (ev.messageId && row.providerMessageId && row.providerMessageId !== ev.messageId))) return "ignored";
    } else if (ev.messageId) row = await this.d.store.findByMessageId(ev.messageId);
    if (!row || (this.d.tenantId && row.tenantId !== this.d.tenantId)) return "ignored";
    const rule = EVENT_TRANSITIONS[ev.kind];
    if (!rule) return "ignored";
    const now = this.now();
    const fresh = await this.d.store.addEvent({ outboxId: row.id, tenantId: row.tenantId, kind: `provider_${ev.kind}`, providerEventId: ev.eventId, detail: ev.reason, at: now });
    if (!fresh) return "duplicate";
    if (rule.to) await this.d.store.setStatusIf(row.id, rule.from, rule.to, ev.kind, now);
    if (rule.suppress) {
      const email = normalizeEmail(ev.email ?? "");
      await this.d.store.suppress(row.tenantId, email ? recipientHash(email) : row.recipientHash, rule.suppress, now);
    }
    // Avisos al equipo (incidencia deduplicada): una queja siempre; los rebotes permanentes si se repiten
    if (ev.kind === "spam") recordFailure("mail.complaint", row.tenantId);
    else if (ev.kind === "hard_bounce" || ev.kind === "invalid") recordFailure("mail.hard_bounce", row.tenantId);
    this.log("info", "provider_event", { lane: this.d.lane, tenantId: row.tenantId, id: row.id, kind: ev.kind, suppressed: !!rule.suppress });
    return "applied";
  }
}
