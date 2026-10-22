/**
 * Comunicaciones transaccionales: catálogo versionado (todas las plantillas pedidas, ids estables, solo
 * transaccional, sin secretos ni enlaces externos) y despachador de eventos comerciales sobre la bandeja de salida
 * real (idempotencia, corte, sin destinatario, reintentos con abandono y MAIL_MODE=off sin enviar nada).
 */
import { describe, it, expect } from "vitest";
import { MemoryCommercialEventLog } from "./commercialEvents/log";
import type { CommercialEventDraft } from "./commercialEvents/types";
import { MemoryCrmStore } from "./crm/store";
import { CrmService } from "./crm/service";
import { MemoryOrderStore } from "./orchestrator/store";
import { DEFAULT_MAIL_LOGO_URL, mailPolicyFromEnv } from "./mail/policy";
import { memoryProvider } from "./mail/providers";
import { MailService } from "./mail/service";
import { MemoryMailStore } from "./mail/store";
import { PlatformMailer } from "./mail/platform";
import { TEMPLATE_CATALOG, catalogView, type Vars } from "./notifications/catalog";
import { NotificationDispatcher } from "./notifications/dispatcher";
import { DEFAULT_FAILURE_RULES } from "./_core/ops/failureAlerts";

const NOW = Date.UTC(2026, 9, 20, 9);
const REQUIRED = [
  "trial.verification", "trial.started", "trial.reminder", "trial.ended",
  "subscription.signup_received", "subscription.contract_confirmed", "subscription.initial_payment", "subscription.payment_action_required", "subscription.renewal_paid",
  "subscription.payment_failed", "subscription.dunning_reminder", "subscription.suspended", "subscription.recovered", "subscription.plan_changed", "subscription.cancellation", "subscription.ended",
  "module.purchase_requested", "module.activated", "module.quantity_changed", "module.removal_scheduled", "module.removal_effective", "module.purchase_failed",
  "billing.invoice_available", "billing.refund_recorded", "billing.credit_note", "billing.incident",
  "support.ticket_received", "support.ticket_replied", "support.ticket_resolved", "support.ticket_reopened",
  "security.password_changed", "security.new_login", "security.mfa_changed",
];
const allVars: Vars = { reference: "PED-1", host: "acme.elephant.test", productName: "Elephant People", plan: "business", direction: "up", effectiveFrom: NOW, effectiveTo: NOW, metric: "users", quantity: 2, amountCents: 1900, currency: "EUR", full: true, readOnlyUntil: NOW };

describe("catálogo de comunicaciones", () => {
  it("todas las plantillas pedidas, con id estable único, versión, disparador, destinatario, variables y condiciones", () => {
    const ids = TEMPLATE_CATALOG.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(REQUIRED));
    for (const t of TEMPLATE_CATALOG) {
      expect(t.id).toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(t.version).toBeGreaterThanOrEqual(1);
      expect(t.audience).toBe("transactional");
      expect(t.trigger && t.sendWhen && t.suppressWhen && t.idempotency).toBeTruthy();
      if (t.status === "active") {
        expect(t.events?.length).toBeGreaterThan(0);
        expect(typeof t.render).toBe("function");
      }
    }
    expect(JSON.stringify(catalogView())).not.toContain("render");
  });

  it("ninguna plantilla lleva secretos, recuperación de contraseña, invitaciones ni enlaces fuera de la plataforma", () => {
    for (const t of TEMPLATE_CATALOG) {
      expect(t.variables.join(",")).not.toMatch(/token|password|invite|secret/i);
      if (!t.render) continue;
      const c = t.render(Object.fromEntries(t.variables.map((k) => [k, allVars[k] ?? null])), { supportEmail: "soporte@bigelephant.es" });
      expect(c.subject.length).toBeGreaterThan(5);
      const body = `${c.html}\n${c.text}`;
      expect(body).not.toMatch(/establecer-contrasena|recuperar-contrasena|nueva-contrasena|token=|http:\/\//);
      // Enlaces solo a la plataforma; la única imagen es el logotipo oficial (no es un enlace)
      const images = Array.from(c.html.matchAll(/<img src="([^"]+)"/g), (m) => m[1]);
      expect(images).toEqual([DEFAULT_MAIL_LOGO_URL]);
      for (const url of body.split(DEFAULT_MAIL_LOGO_URL).join("").match(/https:\/\/[^\s"<]+/g) ?? []) expect(url.startsWith("https://acme.elephant.test/")).toBe(true);
      expect(body).toContain("No es publicidad");
      // Sin las variables, la plantilla no falla ni muestra «undefined»
      expect(JSON.stringify(t.render({}, { supportEmail: null }))).not.toContain("undefined");
    }
  });
});

describe("despachador de eventos comerciales", () => {
  const ev = (key: string, type: CommercialEventDraft["type"], over: Partial<CommercialEventDraft> = {}): CommercialEventDraft => ({
    key,
    type,
    aggregate: { type: "subscription", id: "1", version: 1 },
    correlationId: "c",
    tenantId: "acme",
    companyId: 1,
    orderId: null,
    subscriptionId: 1,
    trialId: null,
    paymentId: null,
    stripeRef: null,
    fromState: null,
    toState: null,
    actor: "system:test",
    occurredAt: NOW,
    data: {},
    ...over,
  });

  async function setup(o: { send?: (...a: unknown[]) => Promise<unknown>; mode?: string } = {}) {
    const log = new MemoryCommercialEventLog("test");
    const crmStore = new MemoryCrmStore();
    const crm = new CrmService({ store: crmStore, now: () => NOW });
    const c = await crm.createCompany({ name: "Acme SL" }, "operator:test");
    await crm.createContact(c.id, { name: "Ana", email: "ana@acme.example", isPrimary: true }, "operator:test");
    const orders = new MemoryOrderStore();
    const sent: Array<{ key: string; category: string; to: string; subject: string }> = [];
    const store = new MemoryMailStore();
    const provider = memoryProvider();
    const policy = mailPolicyFromEnv({ MAIL_MODE: o.mode ?? "sandbox", MAIL_SENDING_DOMAIN: "bigelephant.es", MAIL_SANDBOX_ALLOWLIST: "acme.example" } as NodeJS.ProcessEnv);
    const mailer = new PlatformMailer(new MailService({ lane: "platform", store, provider, policy, now: () => NOW }), policy);
    const dispatcher = new NotificationDispatcher({
      queue: log,
      send:
        (o.send as never) ??
        (async (t, k, cat, to, content) => {
          sent.push({ key: k, category: cat, to, subject: content.subject });
          return mailer.send(t, k, cat, to, content);
        }),
      crmStore,
      orders,
      hostOf: async () => "acme.elephant.test",
      productName: async (k) => (k === "connect-people" ? "Elephant People" : null),
      supportEmail: "soporte@bigelephant.es",
      since: NOW - 1000,
      now: () => NOW,
      maxAttempts: 2,
    });
    return { log, dispatcher, sent, store, provider, orders, companyId: c.id, crmStore };
  }

  it("cada evento con plantilla sale una vez a su contacto de facturación; sin plantilla queda omitido; repetir no duplica", async () => {
    const s = await setup();
    await s.log.append(null, [
      ev("e1", "subscription.module_added", { data: { after: { item: "connect-people", quantity: 1 } } }),
      ev("e2", "subscription.quantity_changed", { data: { before: { metric: "users", quantity: 2 }, after: { metric: "users", quantity: 1, direction: "down", effectiveFrom: NOW + 86_400_000 } } }),
      ev("e3", "order.cancelled", { companyId: s.companyId, data: { readOnlyUntil: NOW + 30 * 86_400_000 } }),
      ev("e4", "access.read_only_started", { companyId: s.companyId, data: { readOnlyUntil: NOW + 30 * 86_400_000 } }),
      ev("e5", "refund.recorded", { data: { deltaCents: 1900, currency: "EUR", full: false } }),
      ev("e6", "payment.succeeded"),
    ]);
    expect(await s.dispatcher.run()).toEqual({ done: 4, skipped: 2, retried: 0, dead: 0 });
    expect(s.sent.map((x) => [x.key.split(":")[1], x.to])).toEqual([
      ["module.activated", "ana@acme.example"],
      ["module.quantity_changed", "ana@acme.example"],
      ["access.read_only_started", "ana@acme.example"],
      ["billing.refund_recorded", "ana@acme.example"],
    ]);
    expect(s.sent[0].subject).toBe("Elephant People ya está activo");
    expect(s.sent[1].subject).toBe("Reducción programada");
    expect(s.provider.sent).toHaveLength(4);
    // Ya despachados: nada más; aunque se repita el envío, la bandeja no duplica (misma clave)
    expect(await s.dispatcher.run()).toEqual({ done: 0, skipped: 0, retried: 0, dead: 0 });
    await s.dispatcher.dispatchEvent((await s.log.list({}))[0]);
    expect(s.provider.sent).toHaveLength(4);
  });

  it("compra fallida solo para compras de la plataforma; hechos anteriores al corte y sin contacto no se avisan", async () => {
    const s = await setup();
    const base = { payloadHash: "h", kind: "change" as const, state: "rejected" as const, companyId: s.companyId, leadRequestId: null, trialId: null, previousOrderId: 1, request: { plan: "essential", interval: "month" as const, items: [] }, quote: null, contractId: null, subscriptionId: 1, tenantId: "acme", confirmation: null, graceEndsAt: null, attempts: 0, lastError: null, createdAt: NOW, createdBy: "x" };
    const p = (await s.orders.insert({ ...base, idempotencyKey: "purchase-acme-aaaaaaaaaaaaaaaaaaaa" })).order;
    const q = (await s.orders.insert({ ...base, idempotencyKey: "stripe-plan-1-business-month-1" })).order;
    await s.log.append(null, [
      ev("r1", "order.rejected", { orderId: p.id }),
      ev("r2", "order.rejected", { orderId: q.id }),
      ev("old", "subscription.module_added", { occurredAt: NOW - 86_400_000, data: { after: { item: "connect-people" } } }),
      ev("nobody", "subscription.module_added", { companyId: 999, data: { after: { item: "connect-people" } } }),
    ]);
    expect(await s.dispatcher.run()).toEqual({ done: 1, skipped: 3, retried: 0, dead: 0 });
    expect(s.sent.map((x) => x.key)).toEqual([`notif:module.purchase_failed:v1:r1`]);
  });

  it("aviso previo al archivado: con la fecha y la exportación; sin empresa en el evento, la enlazada a su plataforma", async () => {
    const s = await setup();
    await s.crmStore.update("companies", s.companyId, { tenantId: "t9-acme" });
    const archiveAt = NOW + 7 * 86_400_000;
    await s.log.append(null, [
      ev("a1", "access.archive_notice", { companyId: null, tenantId: "t9-acme", subscriptionId: null, trialId: 9, data: { day: 83, archiveAt } }),
      ev("a2", "access.archive_notice", { companyId: null, tenantId: "sin-empresa", subscriptionId: null, trialId: 10, data: { day: 83, archiveAt } }),
    ]);
    expect(await s.dispatcher.run()).toEqual({ done: 1, skipped: 1, retried: 0, dead: 0 });
    expect(s.sent.map((x) => [x.key.split(":")[1], x.to])).toEqual([["access.archive_notice", "ana@acme.example"]]);
    expect(s.sent[0].subject).toBe("Tu cuenta se archivará el 27 de octubre de 2026");
  });

  it("un fallo se reintenta y al agotar los intentos queda abandonado con alerta", async () => {
    let calls = 0;
    const s = await setup({ send: async () => { calls++; throw new Error("bandeja caída"); } });
    await s.log.append(null, [ev("f1", "billing_dummy" as never), ev("f2", "coverage.lost", { companyId: 1 })]);
    expect(await s.dispatcher.run()).toEqual({ done: 0, skipped: 1, retried: 1, dead: 0 });
    // El reintento no vence hasta pasar la espera
    expect(await s.dispatcher.run()).toEqual({ done: 0, skipped: 0, retried: 0, dead: 0 });
    const later = new NotificationDispatcher({ ...(s.dispatcher as unknown as { d: ConstructorParameters<typeof NotificationDispatcher>[0] }).d, now: () => NOW + 3_600_000 });
    expect(await later.run()).toEqual({ done: 0, skipped: 0, retried: 0, dead: 1 });
    expect(calls).toBe(2);
    // La alerta del abandono tiene regla (sin ella recordFailure la descartaría en silencio)
    expect(DEFAULT_FAILURE_RULES["notifications.dead"]).toBeTruthy();
  });

  it("MAIL_MODE=off: el aviso queda registrado como omitido y no sale nada", async () => {
    const s = await setup({ mode: "off" });
    await s.log.append(null, [ev("o1", "subscription.module_added", { data: { after: { item: "connect-people" } } })]);
    expect((await s.dispatcher.run()).done).toBe(1);
    expect(s.provider.sent).toHaveLength(0);
    expect(s.store.rows).toEqual([expect.objectContaining({ status: "skipped", category: "module_activated" })]);
  });
});
