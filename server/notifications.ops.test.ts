/**
 * Comunicaciones del lanzamiento que completan el catálogo: avisos internos al equipo (incidencias, nuevos clientes,
 * desistimientos, tickets), avisos de tickets al solicitante, aviso de seguridad tras cambiar la contraseña y
 * reparto con Stripe (sin duplicados). Todo por la bandeja de salida, idempotente y sin tokens.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MailService } from "./mail/service";
import { MemoryMailStore } from "./mail/store";
import { memoryProvider } from "./mail/providers";
import { mailPolicyFromEnv } from "./mail/policy";
import { PlatformMailer, opsRecipientsFromEnv } from "./mail/platform";
import { IncidentService, MemoryIncidentStore } from "./_core/ops/incidents";
import { MemoryTicketStore, TicketService } from "./_core/support/tickets";
import { TEMPLATE_CATALOG } from "./notifications/catalog";
import { passwordChangedEmail } from "./passwordReset";

const NOW = Date.UTC(2026, 9, 22, 9);
let store: MemoryMailStore;
let provider: ReturnType<typeof memoryProvider>;
const mailer = (ops: string[] = ["equipo@bigelephant.es"]) => {
  const policy = mailPolicyFromEnv({ MAIL_MODE: "sandbox", MAIL_SENDING_DOMAIN: "bigelephant.es", MAIL_SANDBOX_ALLOWLIST: "bigelephant.es,example.com" } as NodeJS.ProcessEnv);
  return new PlatformMailer(new MailService({ lane: "platform", store, provider, policy, now: () => NOW }), policy, { opsRecipients: ops });
};
beforeEach(() => {
  store = new MemoryMailStore();
  provider = memoryProvider();
});

describe("destinatarios internos (CP_ALERT_EMAIL)", () => {
  it("lista validada, sin duplicados y como mucho 5; una dirección mal escrita impide arrancar", () => {
    expect(opsRecipientsFromEnv({})).toEqual([]);
    expect(opsRecipientsFromEnv({ CP_ALERT_EMAIL: " Equipo@BigElephant.es , equipo@bigelephant.es,ops@bigelephant.es" })).toEqual(["equipo@bigelephant.es", "ops@bigelephant.es"]);
    expect(() => opsRecipientsFromEnv({ CP_ALERT_EMAIL: "no-es-correo" })).toThrow(/no válida/);
    expect(() => opsRecipientsFromEnv({ CP_ALERT_EMAIL: "a@x.es,b@x.es,c@x.es,d@x.es,e@x.es,f@x.es" })).toThrow(/5/);
  });
});

describe("incidencias por correo al equipo", () => {
  it("al abrir y al escalar se avisa una vez; repetir sin escalar no inunda; resolver no avisa", async () => {
    const m = mailer();
    const svc = new IncidentService(new MemoryIncidentStore(), m.incidentNotifier());
    await svc.raise({ dedupeKey: "rate:stripe.gateway_error", kind: "rate", severity: "warning", title: "Stripe: errores de la pasarela" });
    await svc.raise({ dedupeKey: "rate:stripe.gateway_error", kind: "rate", severity: "warning", title: "Stripe: errores de la pasarela" });
    const i = await svc.raise({ dedupeKey: "rate:stripe.gateway_error", kind: "rate", severity: "critical", title: "Stripe: errores de la pasarela" });
    await svc.resolve(i.id, "operator:jorge");
    const rows = store.rows.filter((r) => r.category === "operational");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.toEmail === "equipo@bigelephant.es" || r.toEmail === null)).toBe(true);
    expect(rows.map((r) => r.subject)).toEqual(["[Big Elephant] Incidencia Aviso: Stripe: errores de la pasarela", "[Big Elephant] Incidencia CRÍTICA: Stripe: errores de la pasarela"]);
  });

  it("sin destinatarios internos no se envía nada (el webhook sigue siendo el canal)", async () => {
    const svc = new IncidentService(new MemoryIncidentStore(), mailer([]).incidentNotifier());
    await svc.raise({ dedupeKey: "x", kind: "x", severity: "critical", title: "Algo" });
    expect(store.rows).toEqual([]);
  });
});

describe("tickets: aviso al solicitante y al equipo", () => {
  it("recibido (y aviso interno), respuesta pública sí, nota interna no, resuelto y reabierto; sin enlaces", async () => {
    const m = mailer();
    const svc = new TicketService(new MemoryTicketStore(), async () => true, () => NOW, m.ticketNotifier());
    const t = await svc.create({ tenantId: "acme", title: "No puedo exportar", description: "Error al exportar", requester: "ana@example.com" }, "user:ana@example.com");
    await svc.comment(t.id, "Nota interna del equipo", "operator:jorge", { internal: true });
    await svc.comment(t.id, "Ya está corregido", "operator:jorge");
    await svc.comment(t.id, "Gracias", "user:ana@example.com");
    await svc.setStatus(t.id, "resolved", "operator:jorge");
    await svc.setStatus(t.id, "open", "user:ana@example.com");
    const toAna = store.rows.filter((r) => r.idempotencyKey.startsWith(`ticket:${t.id}:`)).map((r) => r.idempotencyKey.split(":")[2]);
    expect(toAna).toEqual(["received", "replied", "resolved", "reopened"]);
    expect(store.rows.filter((r) => r.idempotencyKey.startsWith("ops:ticket:"))).toHaveLength(1);
    await new MailService({ lane: "platform", store, provider, policy: mailPolicyFromEnv({ MAIL_MODE: "sandbox", MAIL_SENDING_DOMAIN: "bigelephant.es", MAIL_SANDBOX_ALLOWLIST: "bigelephant.es,example.com" } as NodeJS.ProcessEnv), now: () => NOW }).drain(50);
    const body = provider.sent.map((x) => `${x.subject}\n${x.text}`).join("\n");
    expect(body).not.toMatch(/token=|contrasena|Nota interna/);
  });

  it("un solicitante que no es un correo no recibe avisos (y el ticket se crea igual)", async () => {
    const svc = new TicketService(new MemoryTicketStore(), async () => true, () => NOW, mailer([]).ticketNotifier());
    await expect(svc.create({ tenantId: "acme", title: "X", description: "Y", requester: "Ana" }, "user:1")).resolves.toMatchObject({ status: "open" });
    expect(store.rows).toEqual([]);
  });
});

describe("aviso de seguridad tras cambiar la contraseña (Core)", () => {
  it("fecha y hora de Madrid, sin enlaces ni tokens, y el nombre escapado", () => {
    const m = passwordChangedEmail("Ana <script>", new Date(NOW));
    expect(m.subject).toMatch(/Tu contraseña se ha cambiado/);
    // Sin enlaces de acción ni tokens: solo los del pie corporativo (ayuda y textos legales de www.bigelephant.es)
    const links = Array.from(`${m.html}\n${m.text}`.matchAll(/https?:\/\/[^\s"<)]+/g), (x) => x[0]).filter((u) => !u.startsWith("https://www.bigelephant.es"));
    expect(links).toEqual([]);
    expect(`${m.html}\n${m.text}`).not.toMatch(/token/);
    expect(m.html).toContain("Ana &lt;script&gt;");
    expect(m.text).toMatch(/22 de octubre de 2026/);
  });
});

describe("catálogo completo y sin duplicados con Stripe", () => {
  it("cada comunicación del lanzamiento tiene responsable; lo que envía Stripe no lo envía Elephant", () => {
    const by = Object.fromEntries(TEMPLATE_CATALOG.map((t) => [t.id, t]));
    for (const id of ["trial.ended", "support.ticket_received", "support.ticket_replied", "support.ticket_resolved", "security.password_changed", "consumer.withdrawal_receipt", "consumer.withdrawal_resolution", "ops.incident", "ops.new_customer", "ops.withdrawal_requested", "ops.ticket_created"])
      expect(by[id]?.status, id).toBe("legacy");
    for (const id of ["subscription.payment_action_required", "subscription.dunning_reminder", "billing.invoice_document"]) expect(by[id]).toMatchObject({ sentBy: "stripe", status: "legacy" });
    // El fin de la prueba sale una sola vez: por el aviso de vencimiento con 0 días, no por el despachador
    expect(TEMPLATE_CATALOG.filter((t) => t.status === "active" && t.events?.includes("trial.expired"))).toEqual([]);
  });
});
