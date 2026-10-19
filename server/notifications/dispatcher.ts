/**
 * Despachador de comunicaciones transaccionales: lee los eventos comerciales pendientes de notificar
 * (`commercial_events.dispatch_status`, 0015), elige las plantillas `active` del catálogo que los atienden, resuelve
 * el destinatario y las variables PERMITIDAS, y encola el correo en la bandeja de salida existente (PlatformMailer →
 * MailService: idempotencia, supresión, límites y MAIL_MODE). No duplica servicios: el correo, la cola y los
 * reintentos de entrega son los de server/mail.
 *
 *  - Un evento sin plantilla queda `skipped`; con plantilla y enviado (o descartado por la bandeja: MAIL_MODE=off,
 *    suprimido…) queda `done`. Un fallo se reintenta con espera creciente; al agotar los intentos, `dead` y alerta.
 *  - Clave de idempotencia por plantilla, versión y evento: repetir el despacho nunca duplica un correo.
 *  - Nunca avisa de hechos anteriores al corte (`since`).
 *  - Solo audiencia transaccional; variables fuera de la lista de la plantilla no llegan a la plantilla.
 */
import { opsLog } from "../_core/ops/log";
import { recordFailure } from "../_core/ops/failureAlerts";
import type { CommercialEventDispatchQueue } from "../commercialEvents/log";
import type { CommercialEvent } from "../commercialEvents/types";
import type { CrmStore } from "../crm/store";
import type { OrderStore } from "../orchestrator/store";
import type { MailCategory, MailContent } from "../mail/types";
import { activeTemplates, type TemplateSpec, type Vars } from "./catalog";

export const DISPATCH_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000];
const LEASE_MS = 2 * 60_000;
/** Prefijos de pedido de las compras y reducciones desde la plataforma (server/stripe/purchases.ts). */
const PLATFORM_PURCHASE = /^purchase-/;

export interface DispatcherDeps {
  queue: CommercialEventDispatchQueue;
  send: (tenantId: string | null, idempotencyKey: string, category: MailCategory, to: string, c: MailContent) => Promise<unknown>;
  crmStore: Pick<CrmStore, "list" | "get">;
  orders?: Pick<OrderStore, "get">;
  /** Dominio público de la empresa (para el enlace a su panel), o null. */
  hostOf?: (tenantId: string) => Promise<string | null>;
  /** Nombre comercial de un producto del catálogo. */
  productName?: (key: string) => Promise<string | null>;
  supportEmail: string | null;
  /**
   * Corte (ms): los eventos anteriores nunca se notifican (quedan `skipped`). Al activar el despachador sobre una BD
   * con eventos acumulados, nadie recibe avisos de hechos pasados.
   */
  since: number;
  now?: () => number;
  maxAttempts?: number;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const scalar = (v: unknown): string | number | boolean | null => (typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : null);

export class NotificationDispatcher {
  private now: () => number;
  constructor(private d: DispatcherDeps) {
    this.now = d.now ?? Date.now;
  }

  /** Variables candidatas de un evento (después se filtran por las permitidas de cada plantilla). */
  private async varsOf(e: CommercialEvent): Promise<Vars> {
    const data = obj(e.data);
    const after = obj(data.after);
    const before = obj(data.before);
    const order = e.orderId && this.d.orders ? await this.d.orders.get(e.orderId) : null;
    const item = scalar(after.item) ?? scalar(before.item) ?? scalar(after.plan);
    const v: Vars = {
      reference: order?.reference ?? null,
      host: e.tenantId && this.d.hostOf ? await this.d.hostOf(e.tenantId).catch(() => null) : null,
      productName: typeof item === "string" ? ((this.d.productName ? await this.d.productName(item).catch(() => null) : null) ?? item) : null,
      plan: scalar(after.plan),
      direction: scalar(after.direction),
      effectiveFrom: scalar(after.effectiveFrom),
      effectiveTo: scalar(after.effectiveTo),
      metric: scalar(after.metric) ?? scalar(before.metric),
      quantity: scalar(after.quantity),
      amountCents: scalar(data.deltaCents) ?? scalar(data.amountRefundedCents),
      currency: scalar(data.currency),
      full: scalar(data.full),
      readOnlyUntil: scalar(data.validUntil) ?? scalar(data.readOnlyUntil),
    };
    // La dirección de un cambio de cantidad se deduce si el evento no la trae (alta = sube, baja a 0 = baja)
    if (e.type === "subscription.quantity_changed" && v.direction === null) v.direction = typeof after.quantity === "number" && after.quantity > 0 ? "up" : "down";
    return v;
  }

  /** ¿La plantilla aplica a ESTE evento? (filtros que no caben en el tipo de evento). */
  private async applies(t: TemplateSpec, e: CommercialEvent): Promise<boolean> {
    if (t.audience !== "transactional") return false;
    // Con periodo de solo lectura, el aviso es el de solo lectura (lleva la fecha): uno solo
    if (t.id === "subscription.ended") return typeof obj(e.data).readOnlyUntil !== "number";
    if (t.id === "module.purchase_failed") {
      const o = e.orderId && this.d.orders ? await this.d.orders.get(e.orderId) : null;
      return !!o && o.kind === "change" && PLATFORM_PURCHASE.test(o.idempotencyKey);
    }
    return true;
  }

  private async recipient(e: CommercialEvent): Promise<string | null> {
    if (!e.companyId) return null;
    const contacts = (await this.d.crmStore.list("contacts", { companyId: e.companyId })).filter((c) => c.status !== "inactive" && c.email);
    return (contacts.find((c) => c.isPrimary) ?? contacts[0])?.email ?? null;
  }

  /** Envía las plantillas de un evento. Devuelve cuántas se encolaron. */
  async dispatchEvent(e: CommercialEvent): Promise<{ sent: number; reason: string | null }> {
    if (e.occurredAt < this.d.since) return { sent: 0, reason: "before_cutoff" };
    const candidates = activeTemplates(e.type);
    const templates: TemplateSpec[] = [];
    for (const t of candidates) if (await this.applies(t, e)) templates.push(t);
    if (!templates.length) return { sent: 0, reason: "no_template" };
    const to = await this.recipient(e);
    if (!to) {
      opsLog("warn", "Notifications", "no_recipient", { eventId: e.id, type: e.type });
      return { sent: 0, reason: "no_recipient" };
    }
    const all = await this.varsOf(e);
    let sent = 0;
    for (const t of templates) {
      const allowed: Vars = {};
      for (const k of t.variables) allowed[k] = all[k] ?? null;
      const content = t.render!(allowed, { supportEmail: this.d.supportEmail });
      await this.d.send(e.tenantId, `notif:${t.id}:v${t.version}:${e.key}`.slice(0, 190), t.category, to, content);
      sent++;
    }
    return { sent, reason: null };
  }

  /** Procesa hasta `limit` eventos pendientes. */
  async run(limit = 50): Promise<{ done: number; skipped: number; retried: number; dead: number }> {
    const out = { done: 0, skipped: 0, retried: 0, dead: 0 };
    const max = this.d.maxAttempts ?? DISPATCH_BACKOFF_MS.length + 1;
    for (const e of await this.d.queue.claimDispatch(this.now(), limit, LEASE_MS)) {
      try {
        const r = await this.dispatchEvent(e);
        const status = r.sent ? "done" : "skipped";
        await this.d.queue.finishDispatch(e.id, { status, attempts: e.dispatchAttempts + (r.sent ? 1 : 0), nextAttemptAt: null });
        out[status]++;
      } catch (err) {
        const attempts = e.dispatchAttempts + 1;
        if (attempts >= max) {
          await this.d.queue.finishDispatch(e.id, { status: "dead", attempts, nextAttemptAt: null });
          recordFailure("notifications.dead");
          opsLog("error", "Notifications", "dead", { eventId: e.id, type: e.type, attempts, error: err instanceof Error ? err.name : "error" });
          out.dead++;
        } else {
          await this.d.queue.finishDispatch(e.id, { status: "pending", attempts, nextAttemptAt: this.now() + DISPATCH_BACKOFF_MS[Math.min(attempts - 1, DISPATCH_BACKOFF_MS.length - 1)] });
          opsLog("warn", "Notifications", "retry", { eventId: e.id, type: e.type, attempts });
          out.retried++;
        }
      }
    }
    return out;
  }
}
