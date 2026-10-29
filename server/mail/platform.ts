/**
 * Correo de PLATAFORMA (Elephant Source) en el plano de control: bandeja de salida en la base del CRM
 * comercial (db/crm/migrations/0011) y avisos conectados a los eventos que ya existen:
 *  - prueba gratuita (`TrialNotifier`): verificación de correo, activación (bienvenida), aviso de vencimiento;
 *  - alta asistida (contrato del CRM): bienvenida de la empresa con el enlace del administrador;
 *  - orquestador comercial: solicitud de alta recibida (web), pago confirmado (real en live, de PRUEBA en
 *    pruebas), factura disponible, renovación cobrada, contratación confirmada, impago, reactivación y
 *    cancelación.
 * Ningún evento cambia su lógica: el aviso se encola después y un fallo nunca rompe el flujo.
 * Ningún aviso lleva contraseñas: la bienvenida solo lleva el enlace personal de un solo uso para crearla.
 *
 * El webhook de Brevo (un único URL por cuenta) llega aquí y actualiza también las bandejas de las
 * empresas: `tenantLaneResolver` abre su base con la DSN del registro, solo para aplicar eventos.
 */
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import type { TenantRegistryReader } from "../_core/tenantRegistry/store";
import { choosePublicDomain } from "../_core/tenantIdentity";
import { opsLog } from "../_core/ops/log";
import type { CrmStore } from "../crm/store";
import { isStripeProvider, STRIPE_LIVE_PAYMENT_PROVIDER, type OrderNotifier } from "../orchestrator/service";
import type { OrderStore } from "../orchestrator/store";
import type { OrderPayment, PaymentMode } from "../orchestrator/types";
import type { TrialNotifier } from "../trials/onboarding";
import type { UsageNotice } from "../commerce/usageNotices";
import type { WithdrawalNotifier } from "../withdrawals/service";
import type { IncidentNotifier } from "../_core/ops/incidents";
import type { TicketNotifier } from "../_core/support/tickets";
import type { ExternalMail } from "../external/service";
import { mailPolicyFromEnv, type MailPolicy } from "./policy";
import { mailProviderFromEnv } from "./providers";
import { MailService, type SendResult } from "./service";
import { MysqlMailStore } from "./store";
import { platformTemplates } from "./templates";
import type { MailCategory, MailContent, MailProviderPort } from "./types";

export const PLATFORM_TENANT = "platform";
/** Prefijo de la aceptación registrada por la contratación en línea (`server/stripe/selfService.ts`). */
export const SELF_SERVICE_SIGNATURE_PREFIX = "web-terms:";
const short = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
type OrderMail = { kind: MailCategory; key: string; content: MailContent };

export class PlatformMailer {
  readonly t: ReturnType<typeof platformTemplates>;
  constructor(
    readonly service: MailService,
    readonly policy: MailPolicy,
    private o: { verifyUrl?: string | null; pricingUrl?: string | null; opsRecipients?: string[] } = {},
  ) {
    this.t = platformTemplates({ supportEmail: policy.supportEmail });
  }

  send(tenantId: string | null, idempotencyKey: string, category: MailCategory, to: string, c: MailContent, o: { deferOnRateLimit?: boolean } = {}): Promise<SendResult> {
    return this.service.send({ tenantId: tenantId || PLATFORM_TENANT, idempotencyKey, category, to, ...c, sender: { lane: "platform" }, ...(o.deferOnRateLimit ? { deferOnRateLimit: true } : {}) });
  }

  /** Destinatarios internos del equipo (CP_ALERT_EMAIL). Vacío: no hay avisos internos por correo. */
  get opsRecipients(): readonly string[] {
    return this.o.opsRecipients ?? [];
  }

  /** Aviso interno a cada destinatario del equipo (una clave por hecho y destinatario: repetir no duplica). */
  async opsNotice(key: string, title: string, lines: string[]): Promise<void> {
    for (const to of this.opsRecipients) await this.send(PLATFORM_TENANT, `ops:${key}:${short(to)}`, "operational", to, this.t.opsNotice({ title, lines }));
  }

  /** Clientes externos (server/external): invitación al contrato para el representante y aviso interno de la aceptación. */
  externalMail(): ExternalMail {
    return {
      invite: async (to, key, i) => {
        const r = await this.send(PLATFORM_TENANT, key, "contract_invitation", to, this.t.contractInvitation(i));
        return { status: r.status, reason: r.reason, duplicate: r.duplicate, id: r.id };
      },
      status: (id) => this.service.status(id),
      opsNotice: (key, title, lines) => this.opsNotice(key, title, lines),
      paymentSetup: async (to, key, i) => {
        const r = await this.send(PLATFORM_TENANT, key, "contract_invitation", to, this.t.contractPaymentSetup(i));
        return { status: r.status, reason: r.reason, duplicate: r.duplicate, id: r.id };
      },
    };
  }

  /** Incidencias operativas por correo al equipo (se suma al webhook): al abrir, reabrir y escalar. */
  incidentNotifier(): IncidentNotifier {
    return {
      notify: async (i, event) => {
        if (event === "resolved") return;
        const sev = i.severity === "critical" ? "CRÍTICA" : i.severity === "warning" ? "Aviso" : "Info";
        await this.opsNotice(`incident:${i.id}:${event}:${i.occurrences ?? 0}`, `Incidencia ${sev}: ${i.title}`, [`Estado: ${event === "opened" ? "abierta" : event === "reopened" ? "reabierta" : "escalada"}.`, `Incidencia #${i.id}${i.tenantId ? ` · empresa ${i.tenantId}` : ""}.`]);
      },
    };
  }

  /** Tickets de soporte: aviso a quien lo abrió (si es un correo) y aviso interno de ticket nuevo. */
  ticketNotifier(): TicketNotifier {
    const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    return async (t, kind, n) => {
      const ticketRef = `T-${t.id}`;
      if (kind === "received") await this.opsNotice(`ticket:${t.id}:created`, `Nuevo ticket ${ticketRef} (${t.priority})`, [`Empresa: ${t.tenantId}.`, `Asunto: ${t.title.slice(0, 120)}.`]);
      if (!t.requester || !EMAIL.test(t.requester)) return;
      await this.send(t.tenantId, `ticket:${t.id}:${kind}:${n}`, "operational", t.requester, this.t.supportTicket({ kind, ticketRef, subject: t.title }));
    };
  }

  /** Avisos del desistimiento de consumidores (acuse y resolución), idempotentes por referencia y estado. */
  withdrawalNotifier(): WithdrawalNotifier {
    const queued = (r: SendResult) => ({ queued: r.status !== "skipped" && r.status !== "failed" });
    return {
      receipt: async (to, r) => {
        // Aviso interno: hay una solicitud que resolver (sin datos del consumidor más allá de la referencia)
        await this.opsNotice(`withdrawal:${r.reference}`, `Desistimiento recibido ${r.reference}`, [`Empresa: ${r.tenantId ?? "—"}. ${r.assessment.withinTerm ? "Dentro de plazo." : "Fuera de plazo."}`, "Pendiente de resolución en Operaciones → Desistimientos."]);
        return queued(await this.send(r.tenantId, `withdrawal:${r.reference}:receipt`, "withdrawal_receipt", to, this.t.withdrawalReceipt({ reference: r.reference, requestedAt: r.requestedAt, withinTerm: r.assessment.withinTerm, deadlineAt: r.assessment.deadlineAt })));
      },
      resolution: async (to, r) => queued(await this.send(r.tenantId, `withdrawal:${r.reference}:${r.status}`, "withdrawal_resolution", to, this.t.withdrawalResolution({ reference: r.reference, status: r.status, note: r.resolution?.note ?? null }))),
    };
  }

  /** Avisos de consumo al 80 % / 100 % de un límite del plan (idempotentes por su clave). */
  usageNotifier(): (to: string, n: UsageNotice) => Promise<void> {
    return async (to, n) => {
      await this.send(n.tenantId, n.key, "usage_threshold", to, this.t.usageThreshold({ label: n.label, periodLabel: n.periodLabel, used: n.used, limit: n.limit, level: n.level, hard: n.hard, host: n.host }));
    };
  }

  /** Avisos de la prueba gratuita por la bandeja de salida (sustituye al notificador SMTP propio). */
  trialNotifier(): TrialNotifier {
    const verifyBase = this.o.verifyUrl ?? null;
    return {
      verification: async (to, l) => {
        if (!verifyBase) return void opsLog("warn", "Mail", "not_queued", { category: "email_verification", reason: "verify_url_missing", trialId: l.trialId });
        const url = `${verifyBase}${verifyBase.includes("?") ? "&" : "?"}id=${l.trialId}&token=${encodeURIComponent(l.token)}`;
        // Clave por token: cada enlace nuevo (alta o reenvío) es un mensaje distinto, y el mismo enlace, uno solo
        const content = l.resend ? this.t.emailVerificationResent({ verifyUrl: url }) : this.t.emailVerification({ verifyUrl: url });
        await this.send(PLATFORM_TENANT, `trial:${l.trialId}:verification:${short(l.token)}`, "email_verification", to, content);
      },
      welcome: async (to, i) => {
        const url = i.domain ? `https://${i.domain}/establecer-contrasena?token=${encodeURIComponent(i.inviteToken)}` : null;
        await this.send(i.tenantId, `trial-welcome:${i.tenantId}:${short(i.inviteToken)}`, "trial_activated", to, this.t.trialActivated({ host: i.domain, setPasswordUrl: url, endsAt: i.endsAt ?? null }));
      },
      expiryNotice: async (to, i) => {
        // La fecha de fin forma parte de la clave: tras una ampliación se vuelve a avisar del nuevo fin
        await this.send(PLATFORM_TENANT, `trial:${i.trialId}:expiry:${i.endsAt}:${i.daysLeft}`, "trial_expiry", to, this.t.trialExpiry({ endsAt: i.endsAt, daysLeft: i.daysLeft, pricingUrl: this.o.pricingUrl }));
      },
      // Una transición, un aviso: la versión de la prueba tras el cambio forma parte de la clave
      statusNotice: async (to, i) => {
        await this.send(PLATFORM_TENANT, `trial:${i.trialId}:status:${i.kind}:v${i.version}`, "trial_status", to, this.t.trialStatus({ kind: i.kind, endsAt: i.endsAt, host: i.domain }));
      },
    };
  }

  /** Bienvenida del alta asistida (contrato del CRM → plataforma creada). */
  assistedWelcome() {
    return async (to: string, i: { tenantId: string; companyName: string; domain: string | null; inviteToken: string }) => {
      const url = i.domain ? `https://${i.domain}/establecer-contrasena?token=${encodeURIComponent(i.inviteToken)}` : null;
      await this.send(i.tenantId, `assisted-welcome:${i.tenantId}:${short(i.inviteToken)}`, "tenant_welcome", to, this.t.tenantWelcome({ companyName: i.companyName, host: i.domain, setPasswordUrl: url }));
    };
  }

  /**
   * Avisos del orquestador comercial. Destinatario: contacto principal activo de la empresa del pedido.
   *
   * `mode` es el modo de cobro del entorno (el del orquestador; por defecto «test»). Un pago solo se
   * anuncia como REAL si el entorno es live y el pago es de Stripe en modo live; en cualquier otro caso
   * sale el texto de prueba. Así nunca sale el texto de prueba en live ni el real en pruebas.
   *
   * Claves idempotentes: `order:<id>:<acción>:<versión>` para los cambios de estado (como siempre) y
   * `order:<id>:<categoría>:p<pago>` para los avisos de un cobro (la versión del pedido no cambia con él).
   */
  orderNotifier(d: { crmStore: Pick<CrmStore, "list" | "get">; orders: Pick<OrderStore, "payments">; reader?: Pick<TenantRegistryReader, "listDomains"> | null; mode?: PaymentMode }): OrderNotifier {
    const mode: PaymentMode = d.mode ?? "test";
    const hostOf = async (tenantId: string | null) => (tenantId && d.reader ? (choosePublicDomain(await d.reader.listDomains(tenantId))?.domain ?? null) : null);
    const livePayment = (p: OrderPayment) => mode === "live" && p.mode === "live" && p.provider === STRIPE_LIVE_PAYMENT_PROVIDER;
    const invoiceOf = (orderId: number, reference: string | null, p: OrderPayment): OrderMail => ({
      kind: "invoice_available",
      key: `order:${orderId}:invoice_available:p${p.id}`,
      content: this.t.invoiceAvailable({ reference, invoiceRef: p.providerRef, amountCents: p.amountCents, currency: p.currency, test: !livePayment(p) }),
    });
    return async ({ order, action, detail }) => {
      const signup = action === "sign" && typeof detail?.signatureRef === "string" && detail.signatureRef.startsWith(SELF_SERVICE_SIGNATURE_PREFIX);
      const wanted =
        signup ||
        (action === "confirm" && detail?.basis === "payment") ||
        ["activate", "payment_failed", "payment_recovered", "reactivate", "cancel", "payment_recorded"].includes(action);
      if (!wanted) return;
      const paymentOf = async () => (await d.orders.payments(order.id)).find((p) => p.id === Number(detail?.paymentId)) ?? null;
      const stateKey = (kind: MailCategory) => ({ kind, key: `order:${order.id}:${action}:${order.version}` });
      const mails: OrderMail[] = [];
      if (signup) {
        const company = await d.crmStore.get("companies", order.companyId);
        mails.push({ ...stateKey("signup_received"), content: this.t.signupReceived({ companyName: company?.name ?? "tu empresa", reference: order.reference, test: mode !== "live" }) });
      } else if (action === "confirm") {
        const pay = await paymentOf();
        if (!pay) return;
        mails.push(
          livePayment(pay)
            ? { ...stateKey("payment_confirmed"), content: this.t.paymentConfirmed({ reference: order.reference, amountCents: pay.amountCents, currency: pay.currency }) }
            : { ...stateKey("test_payment_confirmed"), content: this.t.testPaymentConfirmed({ reference: order.reference, amountCents: pay.amountCents, currency: pay.currency }) },
        );
        if (isStripeProvider(pay.provider)) mails.push(invoiceOf(order.id, order.reference, pay));
      } else if (action === "payment_recorded") {
        const pay = await paymentOf();
        if (!pay || pay.status !== "succeeded") return;
        if (pay.purpose === "renewal")
          mails.push({
            kind: "renewal_confirmed",
            key: `order:${order.id}:renewal_confirmed:p${pay.id}`,
            content: this.t.renewalConfirmed({ reference: order.reference, amountCents: pay.amountCents, currency: pay.currency, periodStart: pay.periodStart, host: await hostOf(order.tenantId), test: !livePayment(pay) }),
          });
        if (isStripeProvider(pay.provider)) mails.push(invoiceOf(order.id, order.reference, pay));
      } else if (action === "activate") {
        const company = await d.crmStore.get("companies", order.companyId);
        mails.push({ ...stateKey("contract_confirmed"), content: this.t.contractConfirmed({ companyName: company?.name ?? "tu empresa", reference: order.reference, host: await hostOf(order.tenantId) }) });
        // Aviso interno de nuevo cliente (alta o conversión de prueba; un cambio de plan no es un cliente nuevo)
        if (order.kind !== "change")
          await this.opsNotice(`customer:${order.id}`, `Nuevo cliente activo${order.reference ? ` · ${order.reference}` : ""}`, [`Empresa: ${company?.name ?? `#${order.companyId}`}${order.tenantId ? ` (${order.tenantId})` : ""}.`, `Plan: ${order.request?.plan ?? "—"} · ${order.request?.interval === "year" ? "anual" : "mensual"} · ${mode === "live" ? "LIVE" : "pruebas"}.`]);
      } else if (action === "payment_failed") {
        mails.push({ ...stateKey("payment_failed"), content: this.t.paymentFailed({ reference: order.reference, graceEndsAt: order.graceEndsAt, host: await hostOf(order.tenantId) }) });
      } else if (action === "payment_recovered" || action === "reactivate") {
        mails.push({ ...stateKey("subscription_reactivated"), content: this.t.subscriptionReactivated({ reference: order.reference, reason: action === "reactivate" ? "cancel_undone" : "payment_recovered", host: await hostOf(order.tenantId) }) });
      } else {
        mails.push({ ...stateKey("cancellation"), content: this.t.cancellation({ reference: order.reference, cancelAt: typeof detail?.cancelAt === "number" ? detail.cancelAt : null }) });
      }
      if (!mails.length) return;
      const contacts = (await d.crmStore.list("contacts", { companyId: order.companyId })).filter((c) => c.status !== "inactive" && c.email);
      const to = (contacts.find((c) => c.isPrimary) ?? contacts[0])?.email ?? null;
      if (!to) return void opsLog("warn", "Mail", "not_queued", { category: mails[0].kind, reason: "no_contact", orderId: order.id });
      for (const m of mails) await this.send(order.tenantId, m.key, m.kind, to, m.content);
    };
  }
}

/**
 * Destinatarios internos del equipo (CP_ALERT_EMAIL, separados por comas; máximo 5). Un valor que no es un correo
 * impide arrancar (nunca se envía a medias a una dirección mal escrita).
 */
export function opsRecipientsFromEnv(env: NodeJS.ProcessEnv): string[] {
  const list = (env.CP_ALERT_EMAIL ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (list.length > 5) throw new Error("CP_ALERT_EMAIL admite como mucho 5 direcciones");
  for (const e of list) if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) throw new Error("CP_ALERT_EMAIL contiene una dirección no válida");
  return Array.from(new Set(list));
}

/** Correo de plataforma desde el entorno, o `null` con el motivo (sin migración, sin pool). */
export async function platformMailFromEnv(
  pool: Pick<mysql.Pool, "query"> | null,
  env: NodeJS.ProcessEnv,
  o: { provider?: MailProviderPort | null; now?: () => number } = {},
): Promise<{ mailer: PlatformMailer | null; reason: string | null; policy: MailPolicy }> {
  const policy = mailPolicyFromEnv(env);
  if (!pool) return { mailer: null, reason: "crm_not_configured", policy };
  const ready = await pool.query("SELECT 1 FROM mail_outbox LIMIT 0").then(() => true, () => false);
  if (!ready) return { mailer: null, reason: "crm_migration_0011_missing", policy };
  const provider = o.provider !== undefined ? o.provider : mailProviderFromEnv(env);
  const service = new MailService({ lane: "platform", store: new MysqlMailStore(pool), provider, policy, now: o.now });
  return { mailer: new PlatformMailer(service, policy, { verifyUrl: env.CP_TRIAL_VERIFY_URL?.trim() || null, pricingUrl: env.CP_TRIAL_PRICING_URL?.trim() || null, opsRecipients: opsRecipientsFromEnv(env) }), reason: null, policy };
}

/**
 * Servicios de las bandejas de las EMPRESAS para aplicar eventos del webhook (sin proveedor: no envían).
 * Pools pequeños por empresa (1 conexión) con un máximo de 20 abiertos (se cierra el más antiguo).
 */
export function tenantLaneResolver(d: { dsnOf: (tenantId: string) => Promise<string | null>; policy: MailPolicy; max?: number }) {
  const pools = new Map<string, mysql.Pool>();
  const max = d.max ?? 20;
  const resolve = async (tenantId: string): Promise<MailService | null> => {
    let pool = pools.get(tenantId);
    if (!pool) {
      const dsn = await d.dsnOf(tenantId);
      if (!dsn) return null;
      pool = mysql.createPool({ uri: dsn, connectionLimit: 1, maxIdle: 0, idleTimeout: 30_000 });
      pools.set(tenantId, pool);
      if (pools.size > max) {
        const [oldest, p] = pools.entries().next().value as [string, mysql.Pool];
        pools.delete(oldest);
        void p.end().catch(() => undefined);
      }
    }
    return new MailService({ lane: "tenant", store: new MysqlMailStore(pool), provider: null, policy: d.policy, tenantId });
  };
  return Object.assign(resolve, { close: async () => void (await Promise.all(Array.from(pools.values()).map((p) => p.end().catch(() => undefined)))) });
}
