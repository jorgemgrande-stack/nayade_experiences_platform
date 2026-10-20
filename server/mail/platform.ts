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
import type { WithdrawalNotifier } from "../withdrawals/service";
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
    private o: { verifyUrl?: string | null; pricingUrl?: string | null } = {},
  ) {
    this.t = platformTemplates({ supportEmail: policy.supportEmail });
  }

  send(tenantId: string | null, idempotencyKey: string, category: MailCategory, to: string, c: MailContent): Promise<SendResult> {
    return this.service.send({ tenantId: tenantId || PLATFORM_TENANT, idempotencyKey, category, to, ...c, sender: { lane: "platform" } });
  }

  /** Avisos del desistimiento de consumidores (acuse y resolución), idempotentes por referencia y estado. */
  withdrawalNotifier(): WithdrawalNotifier {
    const queued = (r: SendResult) => ({ queued: r.status !== "skipped" && r.status !== "failed" });
    return {
      receipt: async (to, r) => queued(await this.send(r.tenantId, `withdrawal:${r.reference}:receipt`, "withdrawal_receipt", to, this.t.withdrawalReceipt({ reference: r.reference, requestedAt: r.requestedAt, withinTerm: r.assessment.withinTerm, deadlineAt: r.assessment.deadlineAt }))),
      resolution: async (to, r) => queued(await this.send(r.tenantId, `withdrawal:${r.reference}:${r.status}`, "withdrawal_resolution", to, this.t.withdrawalResolution({ reference: r.reference, status: r.status, note: r.resolution?.note ?? null }))),
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
        await this.send(i.tenantId, `trial-welcome:${i.tenantId}:${short(i.inviteToken)}`, "trial_activated", to, this.t.trialActivated({ host: i.domain, setPasswordUrl: url }));
      },
      expiryNotice: async (to, i) => {
        // La fecha de fin forma parte de la clave: tras una ampliación se vuelve a avisar del nuevo fin
        await this.send(PLATFORM_TENANT, `trial:${i.trialId}:expiry:${i.endsAt}:${i.daysLeft}`, "trial_expiry", to, this.t.trialExpiry({ endsAt: i.endsAt, daysLeft: i.daysLeft, pricingUrl: this.o.pricingUrl }));
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
  return { mailer: new PlatformMailer(service, policy, { verifyUrl: env.CP_TRIAL_VERIFY_URL?.trim() || null, pricingUrl: env.CP_TRIAL_PRICING_URL?.trim() || null }), reason: null, policy };
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
