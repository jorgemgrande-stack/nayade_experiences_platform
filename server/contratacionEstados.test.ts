/**
 * Contrato de estados del panel (`PanelActivation`) para la contratación de módulos: cobros fallidos y caducados,
 * suspensión e impago, baja programada (de toda la suscripción o de un módulo) y su vencimiento, y reactivación.
 * Orquestador real en memoria (server/contratacionFixture.ts). Datos sintéticos; nada se cobra.
 */
import { describe, expect, it } from "vitest";
import { activationFromOrders, NO_ACTIVATION } from "./commerce/panelActivation";
import type { CommercialOrder, OrderEvent, OrderPayment, OrderState } from "./orchestrator/types";
import { ACTOR, contratacion, DAY, PRODUCT } from "./contratacionFixture";

const NOW = Date.UTC(2026, 10, 1, 12);
const T = "t9-demo";
let seq = 0;
const order = (state: OrderState, keys: string[], o: Partial<CommercialOrder> = {}) =>
  ({ id: ++seq, state, tenantId: T, companyId: 1, request: { items: keys.map((key) => ({ key })) }, confirmation: null, createdAt: NOW - 3600_000, updatedAt: NOW - 60_000, ...o }) as unknown as CommercialOrder;
const ev = (orderId: number, kind: string, detail: Record<string, unknown> | null = null) => ({ id: ++seq, orderId, kind, detail, createdAt: NOW - 1000 }) as unknown as OrderEvent;

describe("contrato PanelActivation (función pura)", () => {
  it("suspendido → «suspended» (nunca «active»); impago en gracia → «active» con pago «overdue»", () => {
    seq = 0;
    const s = activationFromOrders([order("suspended", [PRODUCT])], T, NOW);
    expect(s.get(PRODUCT)).toMatchObject({ state: "suspended", payment: "overdue", renewal: "active", activeUntil: null, canReactivate: false });
    const p = activationFromOrders([order("past_due", [PRODUCT], { confirmation: { kind: "payment" } as CommercialOrder["confirmation"] })], T, NOW);
    expect(p.get(PRODUCT)).toMatchObject({ state: "active", payment: "overdue", error: null });
    const a = activationFromOrders([order("active", [PRODUCT], { confirmation: { kind: "payment" } as CommercialOrder["confirmation"] })], T, NOW);
    expect(a.get(PRODUCT)).toEqual({ ...NO_ACTIVATION, state: "active", payment: "confirmed", renewal: "active", updatedAt: NOW - 60_000 });
  });

  it("baja programada: «active» hasta la fecha de Stripe; solo la baja a fin de periodo se puede deshacer", () => {
    seq = 0;
    const o = order("cancel_scheduled", [PRODUCT]);
    const end = NOW + 10 * DAY;
    const atEnd = activationFromOrders([o], T, NOW, { billing: { cancelAt: null, cancelAtPeriodEnd: true, currentPeriodEnd: end } }).get(PRODUCT);
    expect(atEnd).toMatchObject({ state: "active", activeUntil: end, renewal: "cancelled", canReactivate: true });
    const fixed = activationFromOrders([o], T, NOW, { billing: { cancelAt: end - DAY, cancelAtPeriodEnd: false, currentPeriodEnd: end } }).get(PRODUCT);
    expect(fixed).toMatchObject({ state: "active", activeUntil: end - DAY, canReactivate: false });
    // Sin Stripe: la suscripción interna; si no, la fecha que dejó la baja en su evento
    expect(activationFromOrders([o], T, NOW, { subscription: { cancelAt: end, currentPeriodEnd: end } }).get(PRODUCT)).toMatchObject({ activeUntil: end, canReactivate: false });
    expect(activationFromOrders([o], T, NOW, { events: new Map([[o.id, [ev(o.id, "cancel", { cancelAt: end - 2 * DAY })]]]) }).get(PRODUCT)).toMatchObject({ activeUntil: end - 2 * DAY });
  });

  it("módulo retirado con la partida vigente: «active» con su fecha de fin; un cambio de precio no es una baja", () => {
    seq = 0;
    const end = NOW + 5 * DAY;
    const items = [
      { productKey: "business", family: "core_plan" as const, effectiveFrom: NOW - 30 * DAY, effectiveTo: null },
      { productKey: PRODUCT, family: "addon" as const, effectiveFrom: NOW - 30 * DAY, effectiveTo: end },
      { productKey: "connect-tax", family: "addon" as const, effectiveFrom: NOW - 30 * DAY, effectiveTo: end },
      { productKey: "connect-tax", family: "addon" as const, effectiveFrom: end, effectiveTo: null },
    ];
    const m = activationFromOrders([order("active", ["connect-tax"])], T, NOW, { items });
    expect(m.get(PRODUCT)).toMatchObject({ state: "active", activeUntil: end, renewal: "cancelled", canReactivate: false });
    expect(m.get("connect-tax")).toMatchObject({ state: "active", activeUntil: null, renewal: "active" });
    // Pasada la fecha, ya no está vigente
    expect(activationFromOrders([order("active", ["connect-tax"])], T, end + 1, { items }).has(PRODUCT)).toBe(false);
  });

  it("cobros: pendiente, intento fallido visible, rechazos tipificados y pedidos antiguos sin motivo", () => {
    seq = 0;
    const base = order("active", []);
    const c = order("contracted", [PRODUCT]);
    const failed = { purpose: "change", status: "failed" } as OrderPayment;
    expect(activationFromOrders([base, c], T, NOW).get(PRODUCT)).toMatchObject({ state: "pending", payment: "pending", error: null, retryable: false });
    expect(activationFromOrders([base, c], T, NOW, { payments: new Map([[c.id, [failed]]]) }).get(PRODUCT)).toMatchObject({ state: "pending", payment: "failed", error: { kind: "payment", transient: true }, retryable: true });
    const r = order("rejected", [PRODUCT]);
    const by = (code: string | null) => activationFromOrders([base, r], T, NOW, { events: new Map([[r.id, [ev(r.id, "reject", code ? { reason: "x", code } : { reason: "x" })]]]) }).get(PRODUCT);
    expect(by("payment_failed")).toMatchObject({ state: "error", payment: "failed", error: { kind: "payment", transient: false }, retryable: true });
    expect(by("payment_reversed")).toMatchObject({ payment: "failed", error: { kind: "payment" } });
    expect(by("payment_expired")).toMatchObject({ payment: "expired", error: { kind: "payment" } });
    expect(by("expired")).toMatchObject({ state: "error", payment: "expired", error: { kind: "payment" } });
    expect(by("activation")).toMatchObject({ payment: null, error: { kind: "activation" } });
    expect(by("conflict")).toMatchObject({ error: { kind: "activation" } });
    expect(by(null)).toMatchObject({ state: "error", payment: null, error: { kind: "payment", transient: false }, retryable: true });
  });
});

describe("contratación de un módulo en el orquestador y su reflejo en el panel", () => {
  it("cobro fallido visible; rechazo tipificado («payment_failed», «expired»); el plan base no cambia", async () => {
    const c = await contratacion();
    const base = await c.baseOrder("Cobro Fallido SL");
    const t = base.tenantId!;
    const { order: ch, payment } = await c.contractModule(base);
    expect(await c.activationOf(t)).toMatchObject({ state: "pending", payment: "pending", error: null });
    await c.paymentEvent(payment, "payment.failed");
    expect(await c.activationOf(t)).toMatchObject({ state: "pending", payment: "failed", error: { kind: "payment" }, retryable: true });
    await expect(c.svc.reject(ch.id, { reason: "Pago rechazado", code: "nope" as never }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    await c.svc.reject(ch.id, { reason: "Pago rechazado por el banco", code: "payment_failed" }, ACTOR);
    expect((await c.svc.detail(ch.id)).rejectCode).toBe("payment_failed");
    expect(await c.activationOf(t)).toMatchObject({ state: "error", payment: "failed", error: { kind: "payment", transient: false }, retryable: true });
    expect((await c.access(t)).allowed).toBe(false);
    // Otra compra, caducada por inactividad
    const again = await c.contractModule(base);
    await c.svc.reject(again.order.id, { reason: "Sin cobro en 30 días", code: "expired" }, ACTOR);
    expect(await c.activationOf(t)).toMatchObject({ state: "error", payment: "expired" });
    expect(await c.planOf(t)).toBe("business");
    expect(await c.corePlan(base.subscriptionId!)).toBe("business");
  });

  it("impago: «active»+«overdue» en la gracia, «suspended» sin acceso tras ella y «active» al pagar; el plan no cambia", async () => {
    const c = await contratacion();
    const base = await c.baseOrder("Impago People SL");
    const t = base.tenantId!;
    const { order: ch, payment } = await c.contractModule(base);
    await c.paymentEvent(payment, "payment.succeeded");
    expect((await c.svc.must(ch.id)).state).toBe("active");
    expect(await c.activationOf(t)).toMatchObject({ state: "active", payment: "confirmed", renewal: "active" });
    c.t.clock = Date.UTC(2026, 10, 16, 10);
    expect(await c.svc.review(ACTOR)).toMatchObject({ renewed: 1, pastDue: 1 });
    expect(await c.activationOf(t)).toMatchObject({ state: "active", payment: "overdue" });
    expect((await c.access(t)).allowed).toBe(true);
    c.t.clock += 8 * DAY;
    expect((await c.svc.review(ACTOR)).suspended).toBe(1);
    expect(await c.activationOf(t)).toMatchObject({ state: "suspended", payment: "overdue" });
    expect(await c.access(t)).toMatchObject({ allowed: false, status: "suspended" });
    expect(await c.corePlan(ch.subscriptionId!)).toBe("business");
    // Regularización (payment_recovered): vuelve sola a «active»
    const renewal = (await c.orders.payments(ch.id)).find((p) => p.purpose === "renewal" && p.status === "pending")!;
    await c.paymentEvent(renewal, "payment.succeeded");
    expect(await c.activationOf(t)).toMatchObject({ state: "active", payment: "confirmed" });
    expect(await c.access(t)).toEqual({ allowed: true, status: "active" });
    expect(await c.planOf(t)).toBe("business");
  });

  it("baja programada de toda la suscripción: «active» con fecha de fin hasta el vencimiento; después «none» y solo lectura", async () => {
    const c = await contratacion();
    const base = await c.baseOrder("Baja People SL", [PRODUCT]);
    const t = base.tenantId!;
    const cs = await c.svc.cancel(base.id, { reason: "Baja solicitada por el cliente" }, ACTOR);
    expect(cs.order.state).toBe("cancel_scheduled");
    const sub = (await c.subsStore.get(base.subscriptionId!))!;
    expect(await c.activationOf(t)).toMatchObject({ state: "active", activeUntil: sub.cancelAt, renewal: "cancelled", canReactivate: false });
    expect(await c.planOf(t)).toBe("business");
    c.t.clock = sub.cancelAt! - 60_000;
    await c.svc.review(ACTOR);
    expect(await c.activationOf(t)).toMatchObject({ state: "active" });
    expect(await c.access(t)).toEqual({ allowed: true, status: "active" });
    c.t.clock = sub.cancelAt! + 60_000;
    expect((await c.svc.review(ACTOR)).cancelled).toBe(1);
    expect((await c.svc.must(base.id)).state).toBe("cancelled");
    expect(await c.activationOf(t)).toEqual(NO_ACTIVATION);
    expect(await c.access(t, false)).toEqual({ allowed: true, status: "read_only" });
    expect((await c.access(t, true)).allowed).toBe(false);
  });

  it("baja programada en Stripe a fin de periodo: se puede reactivar (transición «reactivate») y vuelve a renovarse", async () => {
    const c = await contratacion();
    const base = await c.baseOrder("Reactiva People SL", [PRODUCT]);
    const t = base.tenantId!;
    const end = Date.UTC(2026, 10, 16, 9);
    await c.svc.applyExternalBilling(base.id, { status: "active", cancelAt: end }, "system:stripe");
    c.setBilling({ cancelAt: null, cancelAtPeriodEnd: true, currentPeriodEnd: end });
    expect(await c.activationOf(t)).toMatchObject({ state: "active", activeUntil: end, renewal: "cancelled", canReactivate: true });
    // Una fecha fijada por el equipo (no «a fin de periodo») no se deshace desde el panel
    c.setBilling({ cancelAt: end, cancelAtPeriodEnd: false, currentPeriodEnd: end });
    expect(await c.activationOf(t)).toMatchObject({ activeUntil: end, canReactivate: false });
    const r = await c.svc.applyExternalBilling(base.id, { status: "active", cancelAt: null }, "system:stripe");
    expect(r.changed).toContain("reactivate");
    c.setBilling({ cancelAt: null, cancelAtPeriodEnd: false, currentPeriodEnd: end });
    expect(await c.activationOf(t)).toMatchObject({ state: "active", activeUntil: null, renewal: "active", canReactivate: false });
    expect(await c.corePlan(base.subscriptionId!)).toBe("business");
  });

  it("baja de un módulo en un cambio: sigue «active» con su fecha de fin mientras la licencia es vigente, nunca «none»", async () => {
    const c = await contratacion();
    const base = await c.baseOrder("Reduce People SL", [PRODUCT]);
    const t = base.tenantId!;
    const ch = (await c.changeWith(base, [])).order;
    const r = await c.svc.accept(ch.id, { signatureRef: "firma-reduce", approvalReason: "Aprobado por producto" }, ACTOR);
    expect(r.order).toMatchObject({ state: "active", confirmation: { kind: "inherited" } });
    const item = (await c.subsStore.items(base.subscriptionId!)).find((i) => i.productKey === PRODUCT)!;
    expect(item.effectiveTo).toBeGreaterThan(c.t.clock);
    expect(await c.access(t)).toEqual({ allowed: true, status: "active" });
    expect(await c.activationOf(t)).toMatchObject({ state: "active", activeUntil: item.effectiveTo, renewal: "cancelled", canReactivate: false });
    expect(await c.planOf(t)).toBe("business");
    expect(await c.corePlan(base.subscriptionId!)).toBe("business");
    // Vencida la partida: la renovación de la suscripción desactiva la licencia y el panel deja de mostrarla
    c.t.clock = item.effectiveTo! + 60_000;
    await c.svc.review(ACTOR);
    expect((await c.activationOf(t)).state).toBe("none");
    expect((await c.access(t)).allowed).toBe(false);
    expect(await c.corePlan(base.subscriptionId!)).toBe("business");
  });
});
