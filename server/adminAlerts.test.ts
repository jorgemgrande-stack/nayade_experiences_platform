/** Alertas administrativas (familia D): catálogo, plantillas, reglas, idempotencia, agrupación, fuentes y pruebas. */
import { describe, expect, it } from "vitest";
import { ADMIN_ALERTS, alertById, type AlertFacts } from "./adminAlerts/catalog";
import { AdminAlertService, DEFAULT_ADMIN_RECIPIENT, DEFAULT_TEST_RECIPIENT, defaultAdminSettings, normalizeAdminSettings, type AlertMailer } from "./adminAlerts/service";
import { MemoryAdminAlertStore } from "./adminAlerts/store";
import { CommercialEventWatcher, commercialEventAlerts, externalEventAlerts, incidentAlert, suspensionNear, teamResponded, ticketDeadlines, withExternalAlerts } from "./adminAlerts/sources";
import { runAlertCycle } from "./adminAlerts/runtime";
import { MemorySettingsStore } from "./crm/leadNotices";
import { MemoryExternalStore } from "./external/store";
import type { ExternalSubscription } from "./external/types";
import type { CommercialEvent } from "./commercialEvents/types";
import type { Incident } from "./_core/ops/incidents";
import type { Ticket, TicketEvent } from "./_core/support/tickets";
import type { CommercialOrder } from "./orchestrator/types";
import type { MailCategory, MailContent } from "./mail/types";

const H = 3600_000;
const T0 = Date.UTC(2026, 9, 30, 10);

function fakeMailer(mode = "sandbox") {
  const sent: Array<{ key: string; to: string; category: MailCategory; c: MailContent }> = [];
  const keys = new Set<string>();
  const m: AlertMailer = {
    policy: { mode },
    send: async (_t, key, category, to, c) => {
      const duplicate = keys.has(key);
      if (!duplicate) (keys.add(key), sent.push({ key, to, category, c }));
      return { status: "pending", reason: null, duplicate, id: sent.length } as never;
    },
  };
  return { m, sent };
}

function setup(o: { now?: () => number; env?: string[] } = {}) {
  const store = new MemoryAdminAlertStore();
  const settings = new MemorySettingsStore();
  const { m, sent } = fakeMailer();
  let now = T0;
  const svc = new AdminAlertService({ store, settings, mailer: m, envRecipients: o.env ?? [], crmUrl: "https://admin.bigelephant.example", environment: "pruebas", now: o.now ?? (() => now) });
  return { svc, store, settings, sent, tick: (ms: number) => (now += ms) };
}

const facts = (key: string, extra: Partial<AlertFacts> = {}): AlertFacts => ({ key, occurredAt: T0, tenantId: "empresa-demo", companyId: 42, company: "Empresa Demo, S.L.", summary: "Hecho de prueba.", status: { label: "Estado", tone: "info" }, link: "#/comercial/contrataciones/42", ...extra });

describe("catálogo de alertas administrativas", () => {
  it("42 alertas numeradas, ids únicos, críticas bloqueadas y pendientes con motivo", () => {
    expect(ADMIN_ALERTS).toHaveLength(42);
    expect(ADMIN_ALERTS.map((a) => a.n)).toEqual(Array.from({ length: 42 }, (_, i) => i + 1));
    expect(new Set(ADMIN_ALERTS.map((a) => a.id)).size).toBe(42);
    for (const a of ADMIN_ALERTS) {
      expect(a.locked, a.id).toBe(a.severity === "critical");
      if (a.state === "pendiente") expect(a.pending?.length, a.id).toBeGreaterThan(40);
    }
    expect(ADMIN_ALERTS.filter((a) => a.state === "pendiente").map((a) => a.n)).toEqual([32, 34, 39, 42]);
  });
  it("cada plantilla: familia D, banda interna, datos operativos, enlace https al CRM y texto plano", () => {
    const { svc } = setup();
    for (const a of ADMIN_ALERTS) {
      const p = svc.preview(a.id, { test: true })!;
      expect(p.subject, a.id).toMatch(/^\[PRUEBA\] \[(Info|Importante|CRÍTICO)\] /);
      expect(p.html, a.id).toContain("Administración Big Elephant · Aviso interno");
      for (const label of ["Qué ha sucedido", "Empresa o cliente", "Fecha y hora", "Prioridad", "Requiere intervención"]) expect(p.text, a.id).toContain(label);
      expect(p.html, a.id).toContain("Abrir el expediente en el CRM");
      for (const x of [p.subject, p.html, p.text]) expect(x, a.id).not.toMatch(/undefined|NaN|\[object |\bnull\b/);
      for (const m of p.html.matchAll(/href="([^"]+)"/g)) expect(m[1], a.id).toMatch(/^https:\/\//);
      expect(p.text, a.id).toContain("Aviso interno para la administración de Big Elephant");
      expect(p.html, a.id).toContain("@media (max-width:620px)");
    }
  });
});

describe("ajustes", () => {
  it("por defecto: administracion@bigelephant.es, pruebas a jorgemgrande@gmail.com y todo activo", () => {
    const s = defaultAdminSettings();
    expect(s.recipients).toEqual([DEFAULT_ADMIN_RECIPIENT]);
    expect(s.testRecipient).toBe(DEFAULT_TEST_RECIPIENT);
    expect(Object.values(s.rules).every((r) => r.enabled)).toBe(true);
  });
  it("una crítica no se puede desactivar ni rebajar (ni guardando ni con un ajuste antiguo)", async () => {
    const { svc } = setup();
    const s = defaultAdminSettings();
    s.rules["admin.dispute"] = { ...s.rules["admin.dispute"], enabled: false };
    await expect(svc.save(s, 0, "operator:1")).rejects.toThrow(/críticas no se pueden desactivar/);
    const n = normalizeAdminSettings({ ...s, rules: { "admin.dispute": { enabled: false, severity: "info", extraRecipients: [], frequencyMinutes: 30 } } });
    expect(n.rules["admin.dispute"]).toMatchObject({ enabled: true, severity: "critical" });
  });
  it("varios destinatarios y destinatarios adicionales por alerta, validados y con historial", async () => {
    const { svc } = setup();
    const s = defaultAdminSettings();
    s.recipients = [DEFAULT_ADMIN_RECIPIENT, "direccion@bigelephant.es"];
    s.rules["admin.payment_failed"].extraRecipients = ["cobros@bigelephant.es"];
    const saved = await svc.save(s, 0, "operator:1");
    expect(saved.version).toBe(1);
    expect(svc.recipientsOf(saved.settings, "admin.payment_failed")).toEqual([DEFAULT_ADMIN_RECIPIENT, "direccion@bigelephant.es", "cobros@bigelephant.es"]);
    await expect(svc.save({ ...s, recipients: ["no-es-un-correo"] }, 1, "operator:1")).rejects.toThrow(/no válido/);
    expect((await svc.history()).map((h) => h.version)).toEqual([1]);
  });
});

describe("envío de alertas", () => {
  it("un hecho, un aviso por destinatario: repetir el hecho no duplica", async () => {
    const { svc, sent } = setup({ env: ["equipo@bigelephant.es"] });
    expect(await svc.raise("admin.first_charge", facts("pago:1"))).toEqual({ status: "sent", recipients: 2 });
    expect(await svc.raise("admin.first_charge", facts("pago:1"))).toEqual({ status: "duplicate", recipients: 0 });
    expect(sent.map((s) => s.to)).toEqual([DEFAULT_ADMIN_RECIPIENT, "equipo@bigelephant.es"]);
    expect(sent[0].key).toMatch(/^admin:admin\.first_charge:/);
    expect(sent[0].c.subject).toBe("[Importante] Primer cobro realizado · Empresa Demo, S.L.");
    expect(sent[0].c.html).toContain("https://admin.bigelephant.example/#/comercial/contrataciones/42");
  });
  it("desactivada: queda en el historial sin correo; las pendientes nunca se envían", async () => {
    const { svc, sent, store } = setup();
    const s = defaultAdminSettings();
    s.rules["admin.renewal_paid"].enabled = false;
    await svc.save(s, 0, "operator:1");
    expect((await svc.raise("admin.renewal_paid", facts("r:1"))).status).toBe("disabled");
    expect((await svc.raise("admin.deploy_failed", facts("d:1"))).status).toBe("unknown_alert");
    expect(sent).toHaveLength(0);
    expect((await store.list({})).map((r) => r.status)).toEqual(["disabled"]);
  });
  it("no repite el aviso a quien ya recibe otro aviso del mismo hecho", async () => {
    const { svc, sent } = setup();
    await svc.raise("admin.lead_request", facts("lead:1", { skipRecipients: [DEFAULT_ADMIN_RECIPIENT] }));
    expect(sent).toHaveLength(0);
  });
  it("agrupación: dentro de la ventana se agrupa y sale un único resumen al vencer", async () => {
    const { svc, sent, tick } = setup();
    expect((await svc.raise("admin.renewal_paid", facts("r:1", { tenantId: "a" }))).status).toBe("sent");
    tick(5 * 60_000);
    expect((await svc.raise("admin.renewal_paid", facts("r:2", { tenantId: "b" }))).status).toBe("grouped");
    expect((await svc.raise("admin.renewal_paid", facts("r:3", { tenantId: "c" }))).status).toBe("grouped");
    expect((await svc.flush()).digests).toBe(0);
    tick(60 * 60_000);
    expect((await svc.flush()).digests).toBe(1);
    expect((await svc.flush()).digests).toBe(0);
    expect(sent.map((s) => s.c.subject)).toEqual(["[Info] Renovación cobrada · Empresa Demo, S.L.", "[Resumen] 2 × Renovación cobrada"]);
  });
  it("las críticas nunca se agrupan", async () => {
    const { svc, sent } = setup();
    const s = defaultAdminSettings();
    s.rules["admin.dispute"].frequencyMinutes = 60;
    await svc.save(s, 0, "operator:1");
    await svc.raise("admin.dispute", facts("d:1"));
    await svc.raise("admin.dispute", facts("d:2"));
    expect(sent).toHaveLength(2);
  });
  it("escalado: el tercer hecho en 24 h de la misma empresa sube un nivel de prioridad", async () => {
    const { svc, sent } = setup();
    await svc.raise("admin.payment_failed", facts("f:1"));
    await svc.raise("admin.payment_failed", facts("f:2"));
    await svc.raise("admin.payment_failed", facts("f:3"));
    expect(sent.map((s) => s.c.subject.split("]")[0])).toEqual(["[Importante", "[Importante", "[CRÍTICO"]);
    expect(sent[2].c.text).toContain("se ha repetido 3 veces en 24 horas");
  });
  it("pruebas: solo al destinatario de pruebas, marcadas y sin registrar hechos", async () => {
    const { svc, sent, store } = setup();
    await expect(svc.test(DEFAULT_ADMIN_RECIPIENT, null, "operator:1")).rejects.toThrow(/destinatario de pruebas/);
    const r = await svc.test(DEFAULT_TEST_RECIPIENT, null, "operator:1");
    expect(r.results).toHaveLength(42);
    expect(new Set(sent.map((s) => s.to))).toEqual(new Set([DEFAULT_TEST_RECIPIENT]));
    expect(sent.every((s) => s.c.subject.startsWith("[PRUEBA]"))).toBe(true);
    expect(await store.list({})).toHaveLength(0);
    // Enlaces al CRM real configurado, al listado de la sección (el expediente de ejemplo no existe)
    const ctas = sent.map((s) => s.c.html.match(/href="(https:\/\/admin\.bigelephant\.example\/#\/[^"]*)"/)?.[1]);
    expect(ctas.every(Boolean)).toBe(true);
    expect(ctas).toContain("https://admin.bigelephant.example/#/comercial/contrataciones");
    expect(ctas).toContain("https://admin.bigelephant.example/#/clientes");
    expect(ctas.some((u) => /\/(42|9|12|7|empresa-demo)$/.test(u!))).toBe(false);
  });
  it("sin correo de plataforma: el hecho se registra como no disponible y nada falla", async () => {
    const svc = new AdminAlertService({ store: new MemoryAdminAlertStore(), settings: new MemorySettingsStore(), mailer: null, crmUrl: null });
    expect((await svc.raise("admin.first_charge", facts("x"))).status).toBe("unavailable");
  });
});

// ── Fuentes ──

let seq = 0;
const ev = (type: CommercialEvent["type"], data: Record<string, unknown> = {}, extra: Partial<CommercialEvent> = {}): CommercialEvent =>
  ({ id: ++seq, key: `k:${seq}`, type, schemaVersion: 1, environment: "live", source: "stripe", actor: "system", tenantId: "nextair-demo", companyId: 7, correlationId: "order:9", causationId: null, aggregate: { type: "order", id: "9", version: 1 }, orderId: 9, subscriptionId: 3, trialId: null, paymentId: null, stripeRef: null, fromState: null, toState: null, data, occurredAt: T0, dispatchStatus: "pending", ...extra }) as CommercialEvent;
const ctx = { company: "Cliente Ficticio, S.L.", reference: "PED-2026-0009" };

describe("eventos comerciales → alertas", () => {
  it("cada hito de una contratación es una alerta distinta (contrato ≠ suscripción ≠ primer cobro ≠ activa)", () => {
    const ids = [
      ev("order.contracted", { kind: "new" }),
      ev("order.confirmed", { kind: "new", basis: "payment", firstPeriodCents: 12100, currency: "eur" }),
      ev("order.subscribed", { kind: "new" }),
      ev("payment.succeeded", { purpose: "initial", amountCents: 12100, currency: "EUR", provider: "stripe_live", mode: "live" }),
    ].flatMap((e) => commercialEventAlerts(e, ctx).map((a) => a.id));
    expect(ids).toEqual(["admin.contract_accepted", "admin.plan_contracted", "admin.subscription_created", "admin.first_charge"]);
    expect(commercialEventAlerts(ev("order.contracted", { kind: "new" }), ctx)[0].facts.summary).toMatch(/aún no está creada en Stripe/);
  });
  it("los cambios no son contrataciones nuevas; un cobro de cambio no es el primer cobro", () => {
    expect(commercialEventAlerts(ev("order.confirmed", { kind: "change" }), ctx)).toEqual([]);
    expect(commercialEventAlerts(ev("payment.succeeded", { purpose: "change", amountCents: 100 }), ctx)).toEqual([]);
  });
  it("cobros: fallo, gracia, suspensión, recuperación, reembolso y disputa con importe y enlace", () => {
    const m = (e: CommercialEvent) => commercialEventAlerts(e, ctx)[0];
    expect(m(ev("renewal.failed", { amountCents: 12100, currency: "EUR" }))).toMatchObject({ id: "admin.payment_failed", facts: { amount: { cents: 12100, currency: "EUR" }, link: "#/comercial/cobros-en-riesgo" } });
    expect(m(ev("order.past_due", { graceEndsAt: T0 + 7 * 24 * H })).facts.details?.[0].label).toBe("Fin de la gracia");
    expect(m(ev("order.suspended")).id).toBe("admin.subscription_suspended");
    expect(m(ev("order.recovered")).id).toBe("admin.payment_recovered");
    expect(m(ev("refund.recorded", { deltaCents: 500, currency: "EUR", full: false })).facts.amount).toEqual({ cents: 500, currency: "EUR" });
    expect(m(ev("dispute.status_changed", { amountCents: 12100, currency: "EUR" }, { toState: "needs_response" })).id).toBe("admin.dispute");
  });
  it("el lector empieza en el último evento (nunca avisa de hechos pasados) y luego avisa una vez", async () => {
    const log: CommercialEvent[] = [ev("order.suspended"), ev("order.suspended")];
    const store = new MemoryAdminAlertStore();
    const raised: string[] = [];
    const w = new CommercialEventWatcher({ events: { list: async (f) => log.filter((e) => e.id > (f.afterId ?? 0)) }, store, raise: async (id) => void raised.push(id), latestId: async () => log[log.length - 1].id, context: async () => ctx });
    expect(await w.tick()).toEqual({ read: 0, raised: 0 });
    log.push(ev("renewal.paid", { amountCents: 100, currency: "EUR" }));
    expect((await w.tick()).raised).toBe(1);
    expect((await w.tick()).raised).toBe(0);
    expect(raised).toEqual(["admin.renewal_paid"]);
  });
});

const incident = (o: Partial<Incident>): Incident => ({ id: 1, dedupeKey: "x", tenantId: null, kind: "x", severity: "warning", title: "Incidencia", details: {}, status: "open", openedAt: T0, lastSeenAt: T0, occurrences: 1, acknowledgedBy: null, resolvedAt: null, resolvedBy: null, ...o });

describe("incidencias → alertas", () => {
  it("clasifica por tipo y no repite lo que ya cubren los eventos comerciales", () => {
    const id = (o: Partial<Incident>, e: "opened" | "escalated" = "opened") => incidentAlert(incident(o), e)?.id ?? null;
    expect(id({ dedupeKey: "rate:stripe.webhook_invalid_signature" })).toBe("admin.security_incident");
    expect(id({ dedupeKey: "rate:stripe.gateway_error" })).toBe("admin.integration_error");
    expect(id({ dedupeKey: "rate:mail.send_failed", severity: "critical" })).toBe("admin.integration_error");
    expect(id({ dedupeKey: "rate:stripe.items_drift", severity: "critical" })).toBe("admin.billing_error");
    expect(id({ dedupeKey: "backup.stale:empresa" })).toBe("admin.backup_failed");
    expect(id({ dedupeKey: "quota:empresa:users:month", severity: "warning" })).toBe("admin.quota_near");
    expect(id({ dedupeKey: "quota:empresa:users:month", severity: "critical" })).toBe("admin.quota_reached");
    expect(id({ dedupeKey: "rate:provisioning.failed", severity: "critical" })).toBe("admin.provisioning_failed");
    expect(id({ dedupeKey: "algo.nuevo", severity: "critical" })).toBe("admin.critical_incident");
    expect(id({ dedupeKey: "tenant.suspended:empresa" })).toBeNull();
    expect(id({ dedupeKey: "rate:stripe.dispute_open" })).toBeNull();
    expect(incidentAlert(incident({ dedupeKey: "rate:stripe.gateway_error" }), "resolved")).toBeNull();
    expect(incidentAlert(incident({ dedupeKey: "rate:stripe.gateway_error" }), "escalated")?.facts.severity).toBe("critical");
  });
});

describe("servicios externos → alertas", () => {
  const x = { id: 5, contractId: 1, companyId: 7, serviceName: "Servicio Ficticio", amountCents: 100_000, currency: "EUR", firstChargeAt: T0 + 24 * H } as ExternalSubscription;
  it("aceptado, tarjeta autorizada, programada, primer cobro y siguientes, sin confundir los hitos", () => {
    const a = (kind: string, ref: string, detail: Record<string, unknown> = {}, first = false) => externalEventAlerts({ externalId: 5, kind, ref, detail, actor: "system", at: T0 }, x, "Cliente Ficticio, S.L.", first).map((r) => r.id);
    expect(a("accepted", "1")).toEqual(["admin.contract_accepted"]);
    expect(a("payment_method_authorized", "cs_1")).toEqual(["admin.payment_method_authorized"]);
    expect(a("scheduled", "sub_1", { firstChargeAt: T0 + 24 * H })).toEqual(["admin.subscription_created"]);
    expect(a("invoice_paid", "in_1", { amountPaid: 121_000 }, true)).toEqual(["admin.first_charge"]);
    expect(a("invoice_paid", "in_2", { amountPaid: 121_000 }, false)).toEqual(["admin.renewal_paid"]);
    expect(a("acceptance_email", "1")).toEqual([]);
  });
  it("el almacén envuelto avisa solo de hechos NUEVOS y distingue el primer cobro", async () => {
    const store = new MemoryExternalStore();
    const sub = await store.insert({ contractId: 1, companyId: 7, serviceKey: "svc", serviceName: "Servicio Ficticio", amountCents: 100_000, currency: "EUR", taxRateBp: 2100, interval: "month", billingDay: 1, billingHour: 8, timezone: "Europe/Madrid", graceDays: 7, firstChargeAt: T0, externalRef: null } as never, T0);
    const raised: string[] = [];
    const w = withExternalAlerts(store, { raise: async (id) => void raised.push(id), companyName: async () => "Cliente Ficticio, S.L." });
    const paid = (ref: string) => w.event({ externalId: sub.id, kind: "invoice_paid", ref, detail: { amountPaid: 121_000 }, actor: "system:stripe", at: T0 });
    await paid("in_1");
    await paid("in_1");
    await paid("in_2");
    await new Promise((r) => setTimeout(r, 10));
    expect(raised).toEqual(["admin.first_charge", "admin.renewal_paid"]);
    expect((await w.get(sub.id))?.serviceName).toBe("Servicio Ficticio");
  });
});

describe("revisión periódica", () => {
  it("gracia: avisa con 48 h o menos, una vez por fecha de fin", () => {
    const o = (id: number, graceEndsAt: number) => ({ id, state: "past_due", graceEndsAt, tenantId: "t", companyId: 1, reference: `PED-${id}` }) as CommercialOrder;
    const out = suspensionNear([o(1, T0 + 47 * H), o(2, T0 + 72 * H), o(3, T0 - H)], T0);
    expect(out.map((a) => a.facts.key)).toEqual([`order:1:grace:${T0 + 47 * H}`]);
  });
  it("tickets: sin respuesta al vencer el plazo y escalado al doble; una respuesta del equipo lo para", () => {
    const t = (id: number, ageH: number): Ticket => ({ id, tenantId: "t", title: "Asunto", description: "d", category: "general", priority: "normal", status: "open", requester: "cliente@ejemplo.example", assignee: null, createdBy: "tenant:t", createdAt: T0 - ageH * H, updatedAt: T0, resolvedAt: null });
    const reply: TicketEvent = { id: 1, ticketId: 3, at: T0, actor: "operator:1", kind: "comment", fromValue: null, toValue: null, comment: "Hola", internal: false };
    const out = ticketDeadlines([{ ticket: t(1, 25), events: [] }, { ticket: t(2, 49), events: [] }, { ticket: t(3, 60), events: [reply] }, { ticket: t(4, 2), events: [] }], T0, 24);
    expect(out.map((a) => a.id)).toEqual(["admin.ticket_unanswered", "admin.ticket_escalated"]);
    expect(teamResponded(t(3, 1), [{ ...reply, internal: true }])).toBe(false);
  });
  it("el ciclo completo ejecuta cada parte y sigue aunque una falle", async () => {
    const { svc } = setup();
    const out = await runAlertCycle({ alerts: svc, pastDueOrders: async () => { throw new Error("x"); }, openTickets: async () => [] });
    expect(out).toMatchObject({ grace: "error", tickets: 0, digests: 0 });
  });
});

describe("compatibilidad", () => {
  it("todas las alertas conectadas tienen fuente y las pendientes no", () => {
    for (const a of ADMIN_ALERTS) expect(a.source === "—", a.id).toBe(a.state === "pendiente");
    expect(alertById("admin.nope")).toBeNull();
  });
});

// ── Integración con el remitente de la plataforma (bandeja real en memoria) ──
import { MailService } from "./mail/service";
import { MemoryMailStore } from "./mail/store";
import { memoryProvider } from "./mail/providers";
import { mailPolicyFromEnv } from "./mail/policy";
import { PlatformMailer } from "./mail/platform";
import { IncidentService, MemoryIncidentStore } from "./_core/ops/incidents";
import { MemoryTicketStore, TicketService } from "./_core/support/tickets";

describe("remitente de la plataforma con alertas administrativas", () => {
  const build = () => {
    const mailStore = new MemoryMailStore();
    const policy = mailPolicyFromEnv({ MAIL_MODE: "sandbox", MAIL_SENDING_DOMAIN: "bigelephant.es", MAIL_SANDBOX_ALLOWLIST: "bigelephant.es,example.com" } as NodeJS.ProcessEnv);
    const platform = new PlatformMailer(new MailService({ lane: "platform", store: mailStore, provider: memoryProvider(), policy, now: () => T0 }), policy, { opsRecipients: ["equipo@bigelephant.es"] });
    const alerts = new AdminAlertService({ store: new MemoryAdminAlertStore(), settings: new MemorySettingsStore(), mailer: platform, envRecipients: platform.opsRecipients, crmUrl: "https://admin.bigelephant.example", now: () => T0 });
    platform.setAdminAlerts(alerts);
    return { mailStore, platform };
  };
  it("los avisos internos antiguos ya no salen: los sustituyen las alertas (sin duplicar el hecho)", async () => {
    const { mailStore, platform } = build();
    const incidents = new IncidentService(new MemoryIncidentStore(), platform.incidentNotifier(), () => T0);
    await incidents.raise({ dedupeKey: "rate:mail.send_failed", kind: "rate", severity: "critical", title: "Correo: fallos de envío repetidos" });
    const keys = mailStore.rows.map((r) => r.idempotencyKey);
    expect(keys.some((k) => k.startsWith("ops:"))).toBe(false);
    expect(keys.filter((k) => k.startsWith("admin:admin.integration_error:"))).toHaveLength(2);
  });
  it("ticket urgente: alerta a la administración y nada al cliente", async () => {
    const { mailStore, platform } = build();
    const tickets = new TicketService(new MemoryTicketStore(), async () => true, () => T0, platform.ticketNotifier());
    const t = await tickets.create({ tenantId: "empresa-demo", title: "Caída", description: "No funciona", requester: "cliente@example.com" }, "tenant:empresa-demo");
    await tickets.setPriority(t.id, "urgent", "operator:1");
    const rows = mailStore.rows.map((r) => r.idempotencyKey.split(":").slice(0, 2).join(":"));
    expect(rows.filter((k) => k === "admin:admin.ticket_urgent")).toHaveLength(2);
    expect(rows.filter((k) => k === "admin:admin.ticket_created")).toHaveLength(2);
    // Al cliente solo el acuse de recibo, nunca el cambio de prioridad
    expect(mailStore.rows.filter((r) => r.idempotencyKey.startsWith(`ticket:${t.id}:`)).map((r) => r.idempotencyKey.split(":")[2])).toEqual(["received"]);
  });
});

describe("activación perezosa (migración aplicada después de arrancar)", () => {
  it("sin tablas no hace nada y los avisos antiguos siguen; al aparecer, se activa en el siguiente ciclo", async () => {
    let tables = false;
    const svc = new AdminAlertService({ store: new MemoryAdminAlertStore(), settings: new MemorySettingsStore(), mailer: fakeMailer().m, crmUrl: null, tablesReady: async () => tables });
    expect(await svc.checkReady()).toBe(false);
    expect(svc.active()).toBe(false);
    expect((await svc.raise("admin.first_charge", facts("p:1"))).status).toBe("unavailable");
    expect(await runAlertCycle({ alerts: svc })).toEqual({ ready: "no" });
    tables = true;
    expect((await runAlertCycle({ alerts: svc })).digests).toBe(0);
    expect(svc.active()).toBe(true);
    expect((await svc.raise("admin.first_charge", facts("p:1"))).status).toBe("sent");
  });
});
