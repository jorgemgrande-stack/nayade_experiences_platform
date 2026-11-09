/**
 * Experiencia de recuperación de una empresa con el panel en consulta (shared/subscriptionRecovery.ts): qué aviso ve
 * y a qué circuito existente lleva «Reactivar mi plan» en cada estado, el aviso al intentar guardar, que el servidor
 * sigue bloqueando la escritura (capabilityRouteGuard) y que solo una suscripción aplicada la desbloquea, empresa a
 * empresa. Datos sintéticos; sin red ni Stripe.
 */
import { describe, it, expect, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { blockedNotice, exportAccountNotice, isPanelReadOnlyState, isPaymentPending, isReadOnlyBlockError, readOnlyBlockStatus, resolveRecovery, subscriptionEndedText, type RecoveryInput } from "../shared/subscriptionRecovery";
import { errorToastMessage } from "../client/src/lib/errorMessage";
import { buildSubscriptionOverview } from "./subscriptionOverview";
import { buildPlanComparison, type PanelPlanInfo } from "../shared/subscriptionPlans";
import { capabilityRouteGuard } from "./_core/capabilities/routeGuard";
import { CapabilityAccess } from "./_core/capabilities/access";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { decide, type CapabilityGrant } from "./_core/capabilities/model";
import { GRACE_DAYS, READ_ONLY_DAYS } from "./orchestrator/service";
import { lifecyclePolicyFromEnv } from "./lifecycle/policy";
import { runWithTenant } from "./_core/tenant";

const NOW = Date.UTC(2026, 10, 9, 10);
const DAY = 86_400_000;
type State = NonNullable<RecoveryInput["overview"]>["state"];
const OPEN = { available: true, until: null, endedAt: null };
const ov = (state: State, plan: string | null = "essential") => ({ licensing: "capabilities" as const, state, plan: plan ? { key: plan } : null, consultation: OPEN });
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

describe("textos de consulta según el derecho real (subscription.overview.consultation)", () => {
  const CAPS = ["crm-contacts", "crm-leads"];
  const grants = (over: Partial<CapabilityGrant>) => CAPS.map((capabilityId) => g({ capabilityId, source: "subscription:9", ...over }));
  const overview = (gs: CapabilityGrant[]) => buildSubscriptionOverview({ mode: "multi", enforcing: true, grants: gs, now: NOW });
  const REACTIVATE = { label: "Reactivar mi plan", action: { type: "link", href: "/admin/suscripcion#planes" } };
  const EXPORT = "La persona propietaria de la empresa puede exportar los datos desde «Suscripción».";

  it("suscripción terminada con la consulta vigente: lo dice con la fecha de fin (READ_ONLY_DAYS) y mantiene «Reactivar mi plan»", () => {
    const o = overview(grants({ status: "read_only", validUntil: NOW + 30 * DAY }));
    expect(o.state).toBe("read_only");
    expect(o.consultation).toEqual({ available: true, until: NOW + 30 * DAY, endedAt: null });
    const v = resolveRecovery({ overview: o, isAdmin: true })!;
    expect(v).toMatchObject({
      kind: "subscription_ended",
      readOnly: true,
      canConsult: true,
      title: "Tu suscripción ha finalizado",
      text: "Tus datos siguen disponibles. Reactiva tu plan para volver a gestionar tu negocio con todas tus herramientas.",
      secondary: "Puedes consultar tu información en solo lectura hasta el 9 de diciembre de 2026 a las 11:00.",
      cta: REACTIVATE,
    });
    expect(resolveRecovery({ overview: o, isAdmin: false })).toMatchObject({
      cta: null,
      secondary: "Pide a la administración de tu empresa que reactive el plan. Puedes consultar tu información en solo lectura hasta el 9 de diciembre de 2026 a las 11:00.",
    });
    // Con varios plazos se anuncia el más próximo
    const mixed = overview([g({ status: "read_only", source: "subscription:9", validUntil: NOW + 30 * DAY }), g({ capabilityId: "crm-leads", status: "read_only", source: "subscription:9", validUntil: NOW + 3 * DAY })]);
    expect(mixed.consultation.until).toBe(NOW + 3 * DAY);
  });

  it("consulta vencida: no promete consulta; da la fecha en que terminó, la exportación y el mismo CTA", () => {
    const o = overview(grants({ status: "read_only", validUntil: NOW - 2 * DAY }));
    expect(o.state).toBe("read_only");
    expect(o.consultation).toEqual({ available: false, until: null, endedAt: NOW - 2 * DAY });
    const v = resolveRecovery({ overview: o, isAdmin: true })!;
    expect(v).toMatchObject({
      kind: "subscription_ended",
      canConsult: false,
      title: "Tu suscripción ha finalizado",
      text: "Tus datos se conservan. Reactiva tu plan para volver a gestionar tu negocio con todas tus herramientas.",
      secondary: `El plazo de consulta terminó el 7 de noviembre de 2026. ${EXPORT}`,
      cta: REACTIVATE,
    });
    expect(`${v.text} ${v.secondary}`).not.toMatch(/consultando|puedes consultar|siguen disponibles/i);
    expect(resolveRecovery({ overview: o, isAdmin: false })!.secondary).toBe("Pide a la administración de tu empresa que reactive el plan. El plazo de consulta terminó el 7 de noviembre de 2026.");
    // El aviso al guardar tampoco promete consulta y lleva a reactivar
    expect(blockedNotice(v)).toEqual({ title: "No se pueden guardar cambios", description: "Tu suscripción ha finalizado. Reactiva tu plan para volver a crear y editar; tus datos se conservan.", action: { label: "Reactivar mi plan", href: "/admin/suscripcion#planes" } });
  });

  it("cancelada (licencias canceladas por el motor tras el plazo): sin consulta, exportación y reactivación", () => {
    const o = overview(grants({ status: "cancelled", validUntil: NOW - 2 * DAY }));
    expect(o.state).toBe("cancelled");
    expect(o.consultation).toEqual({ available: false, until: null, endedAt: null });
    expect(resolveRecovery({ overview: o, isAdmin: true })).toMatchObject({
      kind: "subscription_ended",
      canConsult: false,
      text: "Tus datos se conservan. Reactiva tu plan para volver a gestionar tu negocio con todas tus herramientas.",
      secondary: `La consulta del panel ya no está disponible. ${EXPORT}`,
      cta: REACTIVATE,
    });
  });

  it("prueba vencida: consulta sin plazo («mientras tanto») y la contratación del plan probado", () => {
    const o = overview(CAPS.map((capabilityId) => g({ capabilityId, source: "trial:7", validUntil: NOW - DAY })));
    expect(o.state).toBe("trial_expired");
    expect(o.consultation).toEqual({ available: true, until: null, endedAt: null });
    expect(resolveRecovery({ overview: o, isAdmin: true, conversionEnabled: true })).toMatchObject({
      kind: "trial_ended",
      text: "Tus datos siguen disponibles. Contrata tu plan para volver a gestionar tu negocio con todas tus herramientas.",
      secondary: "Puedes seguir consultando tu información mientras tanto.",
      cta: { label: "Contratar mi plan", action: { type: "link", href: "/admin/suscripcion?contratar=essential#contratar" } },
    });
  });

  it("pago pendiente tras la gracia (licencias suspendidas): no promete consulta y mantiene el portal de pago", () => {
    const o = overview(grants({ status: "suspended" }));
    expect(o.state).toBe("suspended");
    expect(o.consultation).toEqual({ available: false, until: null, endedAt: null });
    const owner = resolveRecovery({ overview: o, contract: pastDue, isAdmin: true, portalEnabled: true })!;
    expect(owner).toMatchObject({
      kind: "payment_pending",
      canConsult: false,
      title: "Tu suscripción está pendiente de pago",
      text: "Tus datos se conservan. Actualiza tu método de pago para volver a gestionar tu negocio con todas tus herramientas.",
      secondary: `Mientras tanto no se puede consultar la información del panel. ${EXPORT}`,
      cta: { label: "Reactivar mi plan", action: { type: "portal", fallbackHref: "/admin/suscripcion" } },
    });
    expect(resolveRecovery({ overview: o, contract: pastDue, isAdmin: true, portalEnabled: false })).toMatchObject({ secondary: "Solo la persona propietaria de la empresa puede actualizar el pago.", cta: { label: "Ver mi suscripción" } });
    // En la gracia (licencias activas) nada cambia
    const grace = resolveRecovery({ overview: overview(grants({})), contract: pastDue, isAdmin: true, portalEnabled: true })!;
    expect(grace).toMatchObject({ readOnly: false, canConsult: true, text: "Actualiza tu método de pago para seguir gestionando tu negocio sin interrupciones.", cta: { label: "Actualizar el pago" } });
  });

  it("suspensión administrativa: no promete consulta y lleva a soporte", () => {
    const o = overview(grants({ status: "suspended", source: "operator" }));
    const v = resolveRecovery({ overview: o, contract: paid, isAdmin: true })!;
    expect(v).toMatchObject({
      kind: "restricted",
      canConsult: false,
      text: "Tus datos se conservan. Nuestro equipo de soporte te explicará el motivo y cómo restablecer el acceso.",
      secondary: `Mientras dure la restricción no se puede consultar la información del panel. ${EXPORT}`,
      cta: { label: "Contactar con soporte", action: { type: "link", href: "/admin/soporte" } },
    });
    expect(blockedNotice(v)).toMatchObject({ description: "Tu cuenta está restringida temporalmente. Nuestro equipo de soporte te ayudará a restablecer el acceso.", action: { label: "Contactar con soporte", href: "/admin/soporte" } });
  });

  it("casos límite del cálculo: sin aplicación de licencias, licencias de sede, mezclas, `validUntil == now` y medianoche", () => {
    // Sin aplicar licencias (CAPABILITY_ENFORCEMENT apagado) el acceso lo permite todo: no se dice que no se puede consultar
    const lax = buildSubscriptionOverview({ mode: "multi", enforcing: false, grants: grants({ status: "read_only", validUntil: NOW - DAY }), now: NOW });
    expect(lax.consultation).toEqual({ available: true, until: null, endedAt: null });
    // Una licencia de sede no da consulta de empresa (el guardián no pasa sede), como en effectiveStatus
    const site = [g({ status: "read_only", source: "subscription:9", validUntil: NOW - DAY }), g({ siteId: "centro", status: "active", source: "subscription:9" })];
    expect(overview(site).consultation).toEqual({ available: false, until: null, endedAt: NOW - DAY });
    // Mezcla: una capacidad legible con plazo y otra vencida → se consulta, con el plazo de la legible
    const mixed = [g({ status: "read_only", source: "subscription:9", validUntil: NOW + 5 * DAY }), g({ capabilityId: "crm-leads", status: "read_only", source: "subscription:9", validUntil: NOW - DAY })];
    expect(overview(mixed).consultation).toEqual({ available: true, until: NOW + 5 * DAY, endedAt: null });
    // Prueba caducada y solo lectura con plazo en la misma capacidad: manda la activa (sin plazo), como en decide()
    const both = [g({ source: "trial:7", validUntil: NOW - DAY }), g({ status: "read_only", source: "subscription:9", validUntil: NOW + DAY })];
    expect(overview(both).consultation).toEqual({ available: true, until: null, endedAt: null });
    // Justo en el vencimiento (decide(): `validUntil <= now`) ya no hay consulta
    expect(overview(grants({ status: "read_only", validUntil: NOW })).consultation).toEqual({ available: false, until: null, endedAt: NOW });
    // El plazo se anuncia con la hora peninsular: 23:30 UTC del 9 es la madrugada del 10 en Madrid
    const night = overview(grants({ status: "read_only", validUntil: Date.UTC(2026, 11, 9, 23, 30) }));
    expect(resolveRecovery({ overview: night, isAdmin: true })!.secondary).toBe("Puedes consultar tu información en solo lectura hasta el 10 de diciembre de 2026 a las 00:30.");
  });

  it("sin el dato de consulta del servidor no se promete nada", () => {
    for (const state of ["read_only", "trial_expired", "suspended"] as const) {
      const v = resolveRecovery({ overview: { licensing: "capabilities", state, plan: { key: "essential" } }, contract: paid, isAdmin: true })!;
      expect(v.canConsult).toBeNull();
      expect(`${v.text} ${v.secondary}`).not.toMatch(/consultando|puedes consultar|siguen disponibles/i);
    }
  });

  it("la consulta anunciada es la que concede decide(): el guardián, los plazos y la retención no cambian", async () => {
    // Plazos y conservación: los mismos valores de siempre
    expect(READ_ONLY_DAYS).toBe(30);
    expect(GRACE_DAYS).toBe(7);
    expect(lifecyclePolicyFromEnv({}).retentionDays).toBe(30);
    // En cada caso, `available` coincide con la lectura que permite el motor de licencias
    for (const gs of [grants({ status: "read_only", validUntil: NOW + DAY }), grants({ status: "read_only", validUntil: NOW - DAY }), grants({ status: "suspended" }), grants({ status: "cancelled" }), grants({ validUntil: NOW - DAY, source: "trial:7" })]) {
      expect(overview(gs).consultation.available).toBe(CAPS.some((id) => decide(gs, id, { write: false, now: NOW }).allowed));
    }
    // El guardián: dentro del plazo se consulta y no se guarda; vencido, tampoco se consulta
    const store = new MemoryCapabilityStore();
    await store.apply("dentro", [{ capabilityId: "crm-contacts", siteId: "", status: "read_only", validUntil: NOW + DAY, source: "subscription:1" }], { actor: "t", reason: null, now: NOW - DAY });
    await store.apply("vencida", [{ capabilityId: "crm-contacts", siteId: "", status: "read_only", validUntil: NOW - DAY, source: "subscription:2" }], { actor: "t", reason: null, now: NOW - 2 * DAY });
    const access = new CapabilityAccess(store, { enforce: true, now: () => NOW });
    const app = express();
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
    try {
      expect((await call("GET", "/api/trpc/crm.clients.list", "dentro")).status).toBe(200);
      const write = await call("POST", "/api/trpc/crm.clients.create", "dentro");
      expect(write.status).toBe(403);
      expect(write.json.error.json.data.status).toBe("read_only");
      const read = await call("GET", "/api/trpc/crm.clients.list", "vencida");
      expect(read.status).toBe(403);
      expect(read.json.error.json.data.status).toBe("expired");
      expect((await call("POST", "/api/trpc/crm.clients.create", "vencida")).status).toBe(403);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe("pantallas de «Suscripción», «Exportar mis datos» y el aviso de error: misma regla de consulta", () => {
  const until = { available: true, until: NOW + 30 * DAY, endedAt: null };
  const ended = { available: false, until: null, endedAt: NOW - 2 * DAY };
  const closed = { available: false, until: null, endedAt: null };

  it("«Suscripción» con la suscripción terminada: fecha y hora si la consulta sigue, sin promesa si no", () => {
    expect(subscriptionEndedText(until)).toBe("Tu suscripción ha finalizado. Puedes consultar tus datos en solo lectura hasta el 9 de diciembre de 2026 a las 11:00: reactiva tu plan para volver a crear y editar.");
    expect(subscriptionEndedText(OPEN)).toBe("Tu suscripción ha finalizado. Tus datos siguen disponibles en solo lectura: reactiva tu plan para volver a crear y editar.");
    expect(subscriptionEndedText(ended)).toBe("Tu suscripción ha finalizado y el plazo de consulta terminó el 7 de noviembre de 2026. Tus datos se conservan: la persona propietaria puede exportarlos, y puedes reactivar tu plan para volver a trabajar.");
    expect(subscriptionEndedText(closed)).toMatch(/^Tu suscripción ha finalizado y la consulta del panel ya no está disponible\. Tus datos se conservan/);
    expect(subscriptionEndedText(undefined)).toBe("Tu suscripción ha finalizado. Tus datos se conservan: reactiva tu plan para volver a crear y editar.");
    for (const c of [ended, closed, undefined]) expect(subscriptionEndedText(c)).not.toMatch(/siguen disponibles|puedes consultar/i);
  });

  it("«Exportar mis datos»: cada estado con su consulta real; la exportación se ofrece siempre", () => {
    expect(exportAccountNotice("trial", OPEN)).toBe("Estás en la prueba gratuita: puedes exportar tus datos cuando quieras.");
    expect(exportAccountNotice("trial_expired", OPEN)).toBe("Tu prueba ha terminado y la cuenta está en solo lectura: puedes seguir exportando tus datos.");
    expect(exportAccountNotice("read_only", until)).toBe("Tu cuenta está en solo lectura hasta el 9 de diciembre de 2026 a las 11:00: hasta entonces puedes consultar tus datos. La exportación sigue disponible también después.");
    expect(exportAccountNotice("read_only", OPEN)).toBe("Tu cuenta está en solo lectura: puedes consultar y exportar tus datos.");
    // Plazo vencido: ya no promete «hasta el <fecha pasada> puedes consultar»
    expect(exportAccountNotice("read_only", ended)).toBe("El periodo de solo lectura terminó el 7 de noviembre de 2026. Puedes seguir exportando tus datos mientras la cuenta no se archive: te recomendamos descargarlos cuanto antes.");
    // Suspendida: decide() no deja leer; antes decía «el panel sigue disponible para consultar»
    expect(exportAccountNotice("suspended", closed)).toBe("Tu suscripción está suspendida: mientras tanto no se puede consultar la información del panel, pero puedes exportar tus datos.");
    expect(exportAccountNotice("suspended", undefined)).toBe("Tu suscripción está suspendida: puedes exportar tus datos.");
    expect(exportAccountNotice("cancelled", closed)).toBe("El periodo de solo lectura ha terminado. Puedes seguir exportando tus datos mientras la cuenta no se archive: te recomendamos descargarlos cuanto antes.");
    expect(exportAccountNotice("active", OPEN)).toBeNull();
    for (const [s, c] of [["read_only", ended], ["suspended", closed], ["suspended", undefined], ["cancelled", closed]] as const) {
      expect(exportAccountNotice(s, c)).not.toMatch(/consultar y|puedes consultar|disponible para consultar/i);
      expect(exportAccountNotice(s, c)).toMatch(/exportar|exportando/);
    }
  });

  it("con las licencias reales: el resumen del servidor da el texto correcto en cada pantalla", () => {
    const o = (gs: CapabilityGrant[]) => buildSubscriptionOverview({ mode: "multi", enforcing: true, grants: gs, now: NOW });
    const suspended = o([g({ status: "suspended", source: "subscription:9" })]);
    expect(exportAccountNotice(suspended.state, suspended.consultation)).toMatch(/no se puede consultar/);
    const expired = o([g({ status: "read_only", source: "subscription:9", validUntil: NOW - 2 * DAY })]);
    expect(subscriptionEndedText(expired.consultation)).toMatch(/el plazo de consulta terminó el 7 de noviembre de 2026/);
    expect(exportAccountNotice(expired.state, expired.consultation)).toMatch(/^El periodo de solo lectura terminó el 7 de noviembre de 2026/);
  });

  it("aviso de error al guardar: solo `read_only` promete consulta; `expired` no", () => {
    const err = (status: string) => ({ data: { code: "FORBIDDEN", httpStatus: 403, capability: "crm-contacts", status } });
    expect(readOnlyBlockStatus(err("read_only"))).toBe("read_only");
    expect(readOnlyBlockStatus(err("expired"))).toBe("expired");
    expect(readOnlyBlockStatus(err("suspended"))).toBeNull();
    expect(readOnlyBlockStatus(null)).toBeNull();
    vi.stubGlobal("window", { location: { pathname: "/admin/crm" } });
    try {
      expect(errorToastMessage(err("read_only"))).toBe("Tu plan está en solo lectura: puedes consultar tus datos, pero no hacer cambios.");
      expect(errorToastMessage(err("expired"))).toBe("Tu plan no permite hacer cambios ahora mismo. Revisa el estado de tu suscripción.");
    } finally {
      vi.unstubAllGlobals();
    }
    // Fuera del panel, el mensaje neutro de siempre
    expect(errorToastMessage(err("expired"))).toBe("Esta acción no está disponible ahora mismo.");
  });
});
