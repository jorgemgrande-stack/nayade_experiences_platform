/**
 * Experiencia de recuperación de una empresa con el panel en consulta (shared/subscriptionRecovery.ts): qué aviso ve
 * y a qué circuito existente lleva «Reactivar mi plan» en cada estado, el aviso al intentar guardar, que el servidor
 * sigue bloqueando la escritura (capabilityRouteGuard) y que solo una suscripción aplicada la desbloquea, empresa a
 * empresa. Datos sintéticos; sin red ni Stripe.
 */
import { describe, it, expect } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { blockedNotice, isPanelReadOnlyState, isPaymentPending, isReadOnlyBlockError, resolveRecovery, type RecoveryInput } from "../shared/subscriptionRecovery";
import { buildSubscriptionOverview } from "./subscriptionOverview";
import { buildPlanComparison, type PanelPlanInfo } from "../shared/subscriptionPlans";
import { capabilityRouteGuard } from "./_core/capabilities/routeGuard";
import { CapabilityAccess } from "./_core/capabilities/access";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import type { CapabilityGrant } from "./_core/capabilities/model";
import { runWithTenant } from "./_core/tenant";

const NOW = Date.UTC(2026, 10, 9, 10);
const DAY = 86_400_000;
type State = NonNullable<RecoveryInput["overview"]>["state"];
const ov = (state: State, plan: string | null = "essential") => ({ licensing: "capabilities" as const, state, plan: plan ? { key: plan } : null });
const paid = { contract: { state: "active" }, billing: { status: "active" } };
const pastDue = { contract: { state: "past_due" }, billing: { status: "past_due" } };
const g = (over: Partial<CapabilityGrant>): CapabilityGrant => ({ tenantId: "acme", capabilityId: "crm-contacts", siteId: "", status: "active", validUntil: null, source: "operator", updatedAt: 0, updatedBy: "t", ...over });

describe("aviso único: estado real y destino del botón", () => {
  it("prueba finalizada: «Tu periodo de prueba ha finalizado» y contratación del plan probado (Checkout existente)", () => {
    const v = resolveRecovery({ overview: ov("trial_expired"), isAdmin: true, conversionEnabled: true })!;
    expect(v).toMatchObject({ kind: "trial_ended", readOnly: true, title: "Tu periodo de prueba ha finalizado" });
    expect(v.cta).toEqual({ label: "Contratar mi plan", action: { type: "link", href: "/admin/suscripcion?contratar=essential#contratar" } });
    expect(v.secondary).toBe("Puedes seguir consultando tu información mientras tanto.");
    // Sin contratación en línea (o un plan que no se contrata desde la prueba): al comparador
    expect(resolveRecovery({ overview: ov("trial_expired"), isAdmin: true, conversionEnabled: false })!.cta!.action).toEqual({ type: "link", href: "/admin/suscripcion#planes" });
    expect(resolveRecovery({ overview: ov("trial_expired", "enterprise"), isAdmin: true, conversionEnabled: true })!.cta!.action).toEqual({ type: "link", href: "/admin/suscripcion#planes" });
    // Quien no es de la administración no contrata: sin botón y con la indicación
    const staff = resolveRecovery({ overview: ov("trial_expired"), isAdmin: false, conversionEnabled: true })!;
    expect(staff.cta).toBeNull();
    expect(staff.secondary).toMatch(/administración/);
  });

  it("suscripción terminada o cancelada: textos del encargo y «Reactivar mi plan» al comparador", () => {
    for (const state of ["read_only", "cancelled"] as const) {
      const v = resolveRecovery({ overview: ov(state), contract: paid, isAdmin: true })!;
      expect(v).toMatchObject({
        kind: "subscription_ended",
        readOnly: true,
        title: "Tu suscripción ha finalizado",
        text: "Tus datos siguen disponibles. Reactiva tu plan para volver a gestionar tu negocio con todas tus herramientas.",
        cta: { label: "Reactivar mi plan", action: { type: "link", href: "/admin/suscripcion#planes" } },
        secondary: "Puedes seguir consultando tu información mientras tanto.",
      });
    }
  });

  it("pago pendiente: portal de facturación de Stripe para la propietaria; si no, la página de suscripción; nunca un Checkout nuevo", () => {
    expect(isPaymentPending(pastDue)).toBe(true);
    expect(isPaymentPending({ contract: null, billing: { status: "unpaid" } })).toBe(true);
    expect(isPaymentPending(paid)).toBe(false);
    // Pedido suspendido al acabar la gracia por impago, con cobro manual (sin estado de Stripe): pago pendiente, no restricción
    expect(resolveRecovery({ overview: ov("suspended"), contract: { contract: { state: "suspended" }, billing: { status: null } }, isAdmin: true })!.kind).toBe("payment_pending");
    const owner = resolveRecovery({ overview: ov("suspended"), contract: pastDue, isAdmin: true, portalEnabled: true })!;
    expect(owner).toMatchObject({ kind: "payment_pending", readOnly: true, title: "Tu suscripción está pendiente de pago" });
    expect(owner.cta).toEqual({ label: "Reactivar mi plan", action: { type: "portal", fallbackHref: "/admin/suscripcion" } });
    const admin = resolveRecovery({ overview: ov("read_only"), contract: pastDue, isAdmin: true, portalEnabled: false })!;
    expect(admin.cta).toEqual({ label: "Ver mi suscripción", action: { type: "link", href: "/admin/suscripcion" } });
    expect(admin.secondary).toMatch(/propietaria/);
    // En periodo de gracia (aún activa): aviso de pago, sin bloquear nada
    const grace = resolveRecovery({ overview: ov("active"), contract: pastDue, isAdmin: true, portalEnabled: true })!;
    expect(grace).toMatchObject({ kind: "payment_pending", readOnly: false, title: "Tienes un pago pendiente", cta: { label: "Actualizar el pago" } });
  });

  it("restricción administrativa: explicación y soporte, sin ningún pago", () => {
    const v = resolveRecovery({ overview: ov("suspended"), contract: paid, isAdmin: true, portalEnabled: true, conversionEnabled: true })!;
    expect(v).toMatchObject({ kind: "restricted", tone: "danger", title: "Tu cuenta está restringida temporalmente" });
    expect(v.cta).toEqual({ label: "Contactar con soporte", action: { type: "link", href: "/admin/soporte" } });
    // Sin contrato (alta asistida suspendida): también soporte, también para el equipo
    expect(resolveRecovery({ overview: ov("suspended"), contract: null, isAdmin: false })!.cta!.action).toEqual({ type: "link", href: "/admin/soporte" });
  });

  it("panel en consulta solo en prueba o suscripción terminada o restringida (decide si el menú repite «Solo lectura»)", () => {
    for (const st of ["trial_expired", "read_only", "cancelled", "suspended"]) expect(isPanelReadOnlyState(st)).toBe(true);
    for (const st of ["active", "trial", "pending", "none", undefined]) expect(isPanelReadOnlyState(st)).toBe(false);
  });

  it("sin aviso: activa, en prueba, pendiente de activar, instalación propia o mientras carga", () => {
    for (const state of ["active", "trial", "pending", "none"] as const) expect(resolveRecovery({ overview: ov(state), contract: paid, isAdmin: true })).toBeNull();
    expect(resolveRecovery({ overview: { licensing: "legacy", state: "none", plan: null }, isAdmin: true })).toBeNull();
    expect(resolveRecovery({ overview: null, isAdmin: true })).toBeNull();
  });
});

describe("aviso al intentar crear, editar o guardar", () => {
  const body = (status: string) => ({ error: { json: { message: "crm-contacts está en solo lectura", code: -32003, data: { code: "FORBIDDEN", httpStatus: 403, capability: "crm-contacts", status } } } });

  it("reconoce solo el rechazo tipado de escritura en consulta", () => {
    expect(isReadOnlyBlockError({ data: { code: "FORBIDDEN", httpStatus: 403, capability: "crm-contacts", status: "read_only" } })).toBe(true);
    expect(isReadOnlyBlockError({ shape: { data: { code: "FORBIDDEN", httpStatus: 403, capability: "crm-contacts", status: "expired" } } })).toBe(true);
    expect(isReadOnlyBlockError(body("expired"))).toBe(true);
    // No contratado, suspendido, otros 403 o errores sin datos: no es este aviso
    expect(isReadOnlyBlockError(body("not_contracted"))).toBe(false);
    expect(isReadOnlyBlockError(body("suspended"))).toBe(false);
    expect(isReadOnlyBlockError({ data: { code: "FORBIDDEN", httpStatus: 403 } })).toBe(false);
    expect(isReadOnlyBlockError(new Error("x"))).toBe(false);
    expect(isReadOnlyBlockError(null)).toBe(false);
  });

  it("mensaje contextual con la misma acción que el aviso único", () => {
    const ended = blockedNotice(resolveRecovery({ overview: ov("read_only"), isAdmin: true }));
    expect(ended).toEqual({ title: "No se pueden guardar cambios", description: expect.stringMatching(/^Tu suscripción ha finalizado/), action: { label: "Reactivar mi plan", href: "/admin/suscripcion#planes" } });
    const trial = blockedNotice(resolveRecovery({ overview: ov("trial_expired"), isAdmin: true, conversionEnabled: true }));
    expect(trial.action).toEqual({ label: "Contratar mi plan", href: "/admin/suscripcion?contratar=essential#contratar" });
    const payment = blockedNotice(resolveRecovery({ overview: ov("suspended"), contract: pastDue, isAdmin: true, portalEnabled: true }));
    expect(payment.action).toEqual({ label: "Reactivar mi plan", href: "/admin/suscripcion" });
    expect(blockedNotice(resolveRecovery({ overview: ov("suspended"), isAdmin: true })).action).toEqual({ label: "Contactar con soporte", href: "/admin/soporte" });
    expect(blockedNotice(resolveRecovery({ overview: ov("read_only"), isAdmin: false })).action).toBeNull();
    // Una función suelta en solo lectura con el plan en vigor
    expect(blockedNotice(null)).toEqual({ title: "Esta función está en solo lectura", description: expect.any(String), action: { label: "Ver mi suscripción", href: "/admin/suscripcion" } });
  });
});

describe("estado de la empresa a partir de sus licencias", () => {
  const trialGrants = (tenantId: string) => [g({ tenantId, capabilityId: "crm-contacts", source: "trial:7", validUntil: NOW - DAY }), g({ tenantId, capabilityId: "crm-leads", source: "trial:7", validUntil: NOW - DAY })];
  const paidGrants = (tenantId: string) => [g({ tenantId, capabilityId: "crm-contacts", source: "subscription:9" }), g({ tenantId, capabilityId: "crm-leads", source: "subscription:9" })];

  it("prueba vencida → aviso; reactivación aplicada por el webhook (licencias de la suscripción, sin caducidad) → sin aviso", () => {
    const before = buildSubscriptionOverview({ mode: "multi", enforcing: true, grants: trialGrants("acme"), now: NOW });
    expect(before.state).toBe("trial_expired");
    expect(resolveRecovery({ overview: before, isAdmin: true, conversionEnabled: true })!.kind).toBe("trial_ended");
    const after = buildSubscriptionOverview({ mode: "multi", enforcing: true, grants: paidGrants("acme"), now: NOW });
    expect(after.state).toBe("active");
    expect(after.readOnly).toEqual([]);
    expect(resolveRecovery({ overview: after, contract: paid, isAdmin: true })).toBeNull();
  });

  it("suscripción terminada (solo lectura con plazo) → «Tu suscripción ha finalizado» y el plan anterior se puede volver a contratar", () => {
    const ended = buildSubscriptionOverview({ mode: "multi", enforcing: true, grants: [g({ status: "read_only", source: "subscription:9", validUntil: NOW + 20 * DAY }), g({ capabilityId: "crm-leads", status: "read_only", source: "subscription:9", validUntil: NOW + 20 * DAY })], now: NOW });
    expect(ended.state).toBe("read_only");
    expect(ended.trial).toBeNull();
    expect(resolveRecovery({ overview: ended, isAdmin: true })!.title).toBe("Tu suscripción ha finalizado");
    const plan = (key: string): PanelPlanInfo => ({ key, name: key, commercialStatus: "available", assisted: false, offerLabel: null, limits: [] }) as unknown as PanelPlanInfo;
    const cards = buildPlanComparison({ plans: [plan("essential"), plan("business")], currentPlanKey: "essential", state: "read_only", isAdmin: true, conversion: null, planChange: null });
    expect(cards[0]).toMatchObject({ isCurrent: true, currentLabel: "Tu plan anterior", cta: { kind: "contact", request: "contract" } });
    // Con la suscripción en vigor el plan actual sigue siendo «Tu plan actual» (sin cambios)
    expect(buildPlanComparison({ plans: [plan("essential")], currentPlanKey: "essential", state: "active", isAdmin: true, conversion: null, planChange: null })[0].cta).toEqual({ kind: "current" });
  });
});

describe("el servidor sigue bloqueando la escritura, empresa a empresa", () => {
  async function serve(access: CapabilityAccess) {
    const app = express();
    // El tenant lo pone el servidor (aquí, una cabecera de la prueba en lugar del dominio)
    app.use((req, _res, next) => runWithTenant(String(req.headers["x-tenant"]), () => next()));
    app.use("/api/trpc", capabilityRouteGuard(() => access));
    app.use("/api/trpc", (_req, res) => void res.json({ ok: true }));
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const call = (method: string, path: string, tenant: string) =>
      new Promise<{ status: number; json: any }>((resolve) => {
        const req = http.request({ host: "127.0.0.1", port, path, method, headers: { "x-tenant": tenant } }, (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, json: b ? JSON.parse(b) : null }));
        });
        req.end();
      });
    return { call, close: () => new Promise<void>((r) => server.close(() => r())) };
  }

  it("consulta sí, guardar no (con el error tipado del aviso); la reactivación de una empresa no desbloquea otra", async () => {
    const store = new MemoryCapabilityStore();
    const expiredTrial = [{ capabilityId: "crm-contacts", siteId: "", status: "active" as const, validUntil: NOW - DAY, source: "trial:1" }];
    await store.apply("empresa-a", expiredTrial, { actor: "t", reason: null, now: NOW - 30 * DAY });
    await store.apply("empresa-b", expiredTrial, { actor: "t", reason: null, now: NOW - 30 * DAY });
    const access = new CapabilityAccess(store, { enforce: true, now: () => NOW });
    const s = await serve(access);
    try {
      expect((await s.call("GET", "/api/trpc/crm.clients.list", "empresa-a")).status).toBe(200);
      const blocked = await s.call("POST", "/api/trpc/crm.clients.create", "empresa-a");
      expect(blocked.status).toBe(403);
      expect(isReadOnlyBlockError(blocked.json)).toBe(true);
      // Volver del navegador desde Stripe no cambia nada: sin licencias nuevas sigue bloqueada
      access.invalidate("empresa-a");
      expect((await s.call("POST", "/api/trpc/crm.clients.create", "empresa-a")).status).toBe(403);
      // El webhook aplica la suscripción de la empresa A (licencias sin caducidad)
      await store.apply("empresa-a", [{ capabilityId: "crm-contacts", siteId: "", status: "active", validUntil: null, source: "subscription:42" }], { actor: "stripe", reason: null, now: NOW });
      access.invalidate("empresa-a");
      expect((await s.call("POST", "/api/trpc/crm.clients.create", "empresa-a")).status).toBe(200);
      // La B sigue en consulta: ni lo de A ni el aviso de A la desbloquean
      const other = await s.call("POST", "/api/trpc/crm.clients.create", "empresa-b");
      expect(other.status).toBe(403);
      expect(isReadOnlyBlockError(other.json)).toBe(true);
      expect((await s.call("GET", "/api/trpc/crm.clients.list", "empresa-b")).status).toBe(200);
    } finally {
      await s.close();
    }
  });
});
