/**
 * Recuperación de las activaciones tras el cobro y vencimiento de pedidos sin cobro: clasificación de errores,
 * reintentos progresivos y agotamiento, idempotencia ante reintentos repetidos y concurrentes, botón «Reintentar»
 * (orquestador y ruta del Core), conciliación diaria y tareas periódicas. Orquestador real en memoria
 * (server/contratacionFixture.ts). Datos sintéticos; nada se cobra.
 */
import http from "node:http";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import { authenticate, hashToken } from "./controlPlane/auth";
import { createPanelRetryRouter } from "./commerce/panelActivation";
import { SubscriptionError } from "./subscriptions/types";
import { CrmError } from "./crm/types";
import {
  activationRecovery,
  classifyStepError,
  LATE_RETRY_MS,
  MAX_ACTIVATION_ATTEMPTS,
  MAX_ACTIVATION_WINDOW_MS,
  orderRecoveryPolicyFromEnv,
  RETRY_DELAYS_MS,
  startOrderRecovery,
  STALE_ACTIVATION_MS,
} from "./orchestrator/recovery";
import { OrderError, type CommercialOrder, type OrderEvent } from "./orchestrator/types";
import { memoryLock } from "./trials/scheduler";
import { ACTOR, CAPABILITY, contratacion, DAY, PRODUCT, type Contratacion } from "./contratacionFixture";

const MIN = 60_000;
const net = (msg = "connect ETIMEDOUT 10.0.0.1:3306") => Object.assign(new Error(msg), { code: "ETIMEDOUT" });
const recovery = (o: CommercialOrder, ev: readonly OrderEvent[]) => activationRecovery(o, ev);

/** Pedido de compra del módulo con el cobro VERIFICADO (los fallos inyectados se aplican en la activación). */
async function paidModule(c: Contratacion, name: string, arm: () => void = () => undefined) {
  const base = await c.baseOrder(name);
  const { order, payment } = await c.contractModule(base);
  arm();
  await c.paymentEvent(payment, "payment.succeeded");
  return { base, order: await c.svc.must(order.id), t: base.tenantId! };
}
/** Comprobaciones de idempotencia: una suscripción, una partida viva del módulo, una licencia y un solo cobro. */
async function noDuplicates(c: Contratacion, base: CommercialOrder, orderId: number) {
  const subs = (await c.subsStore.list({ companyId: base.companyId })).filter((s) => s.status !== "canceled");
  expect(subs).toHaveLength(1);
  const live = (await c.subsStore.items(subs[0].id)).filter((i) => i.productKey === PRODUCT && (i.effectiveTo === null || i.effectiveTo > c.t.clock));
  expect(live).toHaveLength(1);
  expect((await c.caps.list(base.tenantId!)).filter((g) => g.capabilityId === CAPABILITY)).toHaveLength(1);
  expect((await c.orders.payments(orderId)).filter((p) => p.purpose !== "renewal")).toHaveLength(1);
  expect(await c.corePlan(subs[0].id)).toBe("business");
}

describe("clasificación de los fallos de un paso", () => {
  it("red, tiempo agotado, bloqueo, concurrencia y servicio no disponible son transitorios; validación y datos, definitivos", () => {
    expect(classifyStepError(net())).toEqual({ transient: true, retryable: true });
    expect(classifyStepError(Object.assign(new Error("Deadlock found"), { code: "ER_LOCK_DEADLOCK" }))).toMatchObject({ transient: true });
    expect(classifyStepError(new SubscriptionError("version_conflict", "La suscripción cambió"))).toMatchObject({ transient: true });
    expect(classifyStepError(new OrderError("unavailable", "El alta de plataformas no está configurada"))).toMatchObject({ transient: true });
    expect(classifyStepError(Object.assign(new Error("Servicio no disponible"), { status: 503 }))).toMatchObject({ transient: true });
    expect(classifyStepError(new Error("fallo", { cause: net() }))).toMatchObject({ transient: true });
    expect(classifyStepError(new Error("desconocido"))).toMatchObject({ transient: true });
    expect(classifyStepError(new OrderError("invalid_state", "«x» no está publicado"))).toEqual({ transient: false, retryable: true });
    expect(classifyStepError(new CrmError("invalid_input", "Datos no válidos"))).toEqual({ transient: false, retryable: true });
    expect(classifyStepError(Object.assign(new Error("Bad Request"), { status: 400 }))).toMatchObject({ transient: false });
    expect(classifyStepError(new TypeError("Cannot read properties of undefined"))).toMatchObject({ transient: false });
    // Sin base de pago: reintentar no es seguro
    expect(classifyStepError(new OrderError("forbidden", "Sin confirmación"))).toEqual({ transient: false, retryable: false });
  });
});

describe("reintentos progresivos (función pura)", () => {
  const T0 = Date.UTC(2026, 10, 2, 9);
  const o = { state: "subscribed", confirmation: { kind: "payment", ref: "1", actor: "x", reason: null, at: T0 } } as CommercialOrder;
  const fail = (at: number, detail: Record<string, unknown> = { transient: true, retryable: true }) => ({ kind: "step_failed", toState: "subscribed", detail, createdAt: at }) as OrderEvent;

  it("1, 5, 15 y 60 minutos y después cada 6 horas; al décimo fallo, agotado", () => {
    const ev: OrderEvent[] = [];
    let at = T0;
    const waits: number[] = [];
    for (let n = 1; n <= MAX_ACTIVATION_ATTEMPTS; n++) {
      ev.push(fail(at));
      const r = recovery(o, ev)!;
      if (n < MAX_ACTIVATION_ATTEMPTS) {
        expect(r).toMatchObject({ attempts: n, failed: false, exhausted: false, retryable: true });
        waits.push(r.nextRetryAt! - at);
        at = r.nextRetryAt!;
      } else expect(r).toMatchObject({ attempts: n, failed: true, exhausted: true, nextRetryAt: null, transient: true, retryable: true });
    }
    expect(waits).toEqual([...RETRY_DELAYS_MS, ...Array(MAX_ACTIVATION_ATTEMPTS - 1 - RETRY_DELAYS_MS.length).fill(LATE_RETRY_MS)]);
    expect(RETRY_DELAYS_MS).toEqual([1 * MIN, 5 * MIN, 15 * MIN, 60 * MIN]);
  });

  it("agotado también al pasar 72 h desde el cobro; definitivo al primer fallo; los fallos antiguos sin clase cuentan como transitorios", () => {
    expect(recovery(o, [fail(T0 + MAX_ACTIVATION_WINDOW_MS - 30_000)])).toMatchObject({ failed: true, exhausted: true });
    expect(recovery(o, [fail(T0, { transient: false, retryable: true })])).toMatchObject({ failed: true, exhausted: false, transient: false, retryable: true, nextRetryAt: null });
    expect(recovery(o, [fail(T0, { transient: false, retryable: false, code: "payment_reversed" })])).toMatchObject({ failed: true, retryable: false, code: "payment_reversed" });
    expect(recovery(o, [fail(T0, { step: "subscribed", error: "x" })])).toMatchObject({ failed: false, transient: true, nextRetryAt: T0 + MIN });
    // Los fallos anteriores al cobro no cuentan; fuera de la activación, no aplica
    expect(recovery(o, [fail(T0 - 1)])).toMatchObject({ attempts: 0, retryable: false, nextRetryAt: null });
    expect(recovery({ ...o, state: "contracted" }, [fail(T0)])).toBeNull();
  });
});

describe("recuperación automática con el orquestador", () => {
  it("fallo transitorio: «processing» con próximo reintento; antes de tiempo no se reintenta; después se activa sin duplicar nada", async () => {
    const c = await contratacion({ processing: recovery });
    const { base, order, t } = await paidModule(c, "Transitorio SL", () => c.faults.licensing.push(net()));
    expect(order.state).toBe("subscribed");
    const paidAt = c.t.clock;
    expect(await c.activationOf(t)).toMatchObject({ state: "processing", payment: "confirmed", error: null, retryable: true, nextRetryAt: paidAt + MIN });
    expect((await c.access(t)).allowed).toBe(false);
    c.t.clock = paidAt + 30_000;
    expect((await c.svc.recoverActivations(ACTOR)).resumed).toBe(0);
    c.t.clock = paidAt + MIN;
    expect(await c.svc.recoverActivations(ACTOR)).toMatchObject({ resumed: 1, activated: 1, failed: 0 });
    expect((await c.svc.must(order.id)).state).toBe("active");
    expect(await c.activationOf(t)).toMatchObject({ state: "active", payment: "confirmed", nextRetryAt: null });
    expect(await c.access(t)).toEqual({ allowed: true, status: "active" });
    await noDuplicates(c, base, order.id);
    // Repetir no hace nada
    expect((await c.svc.recoverActivations(ACTOR)).resumed).toBe(0);
  });

  it("transitorios agotados: «Error de activación» reintentable; ya no se reintenta solo; «Reintentar» lo activa", async () => {
    const c = await contratacion({ processing: recovery });
    const { base, order, t } = await paidModule(c, "Agotado SL", () => {
      for (let i = 0; i < MAX_ACTIVATION_ATTEMPTS + 2; i++) c.faults.licensing.push(net());
    });
    for (let n = 1; n < MAX_ACTIVATION_ATTEMPTS; n++) {
      const r = (await c.svc.recovery(order.id))!;
      expect(r).toMatchObject({ attempts: n, failed: false });
      c.t.clock = r.nextRetryAt!;
      expect((await c.svc.recoverActivations(ACTOR)).resumed).toBe(1);
    }
    expect(await c.svc.recovery(order.id)).toMatchObject({ attempts: MAX_ACTIVATION_ATTEMPTS, exhausted: true, failed: true });
    expect(await c.activationOf(t)).toMatchObject({ state: "error", error: { kind: "activation", transient: true }, retryable: true, nextRetryAt: null, payment: "confirmed" });
    c.t.clock += 7 * DAY;
    expect((await c.svc.recoverActivations(ACTOR)).resumed).toBe(0);
    expect((await c.svc.reconcile(ACTOR, { maxIdleMs: 30 * DAY })).activations.resumed).toBe(0);
    // Ventana de error: el producto nunca vuelve a «none» por sí solo; sin acceso hasta la licencia real
    expect((await c.access(t)).allowed).toBe(false);
    c.faults.licensing.length = 0;
    const r = await c.svc.retryActivation(t, { key: PRODUCT }, "service:core");
    expect(r).toMatchObject({ status: "active", error: null });
    expect(await c.activationOf(t)).toMatchObject({ state: "active" });
    await noDuplicates(c, base, order.id);
  });

  it("fallo definitivo: «Error de activación» al primer fallo, sin reintentos automáticos; «Reintentar» con límite de frecuencia", async () => {
    const c = await contratacion({ processing: recovery });
    const { base, order, t } = await paidModule(c, "Definitivo SL", () => c.faults.activate.push(new OrderError("invalid_state", "Datos de la empresa incompletos"), new OrderError("invalid_state", "Datos de la empresa incompletos")));
    expect((await c.svc.must(order.id)).state).toBe("licensed");
    expect(await c.activationOf(t)).toMatchObject({ state: "error", error: { kind: "activation", transient: false }, retryable: true, nextRetryAt: null });
    c.t.clock += DAY;
    expect((await c.svc.recoverActivations(ACTOR)).resumed).toBe(0);
    // Primer «Reintentar»: vuelve a fallar (sigue el dato mal); el segundo inmediato se limita
    const r1 = await c.svc.retryActivation(t, { key: PRODUCT }, "service:core");
    expect(r1).toMatchObject({ status: "resumed", error: expect.stringMatching(/incompletos/) });
    const r2 = await c.svc.retryActivation(t, { key: PRODUCT }, "service:core");
    expect(r2).toMatchObject({ status: "throttled", retryAt: c.t.clock + MIN });
    c.t.clock += MIN;
    expect(await c.svc.retryActivation(t, {}, "service:core")).toMatchObject({ status: "active" });
    // Un segundo clic tras activarse: nada que hacer
    expect(await c.svc.retryActivation(t, { key: PRODUCT }, "service:core")).toMatchObject({ status: "active" });
    await noDuplicates(c, base, order.id);
  });

  it("cobro revertido: nunca se reintenta ni se activa; el panel lo muestra como pago fallido y no reintentable", async () => {
    const c = await contratacion({ processing: recovery });
    const { order, t } = await paidModule(c, "Revertido SL", () => void (c.faults.coverageHeld = true));
    expect((await c.svc.must(order.id)).state).toBe("confirmed");
    expect(await c.activationOf(t)).toMatchObject({ state: "error", payment: "failed", error: { kind: "payment", transient: false }, retryable: false });
    c.t.clock += DAY;
    expect((await c.svc.recoverActivations(ACTOR)).resumed).toBe(0);
    await expect(c.svc.retryActivation(t, { key: PRODUCT }, "service:core")).rejects.toMatchObject({ code: "invalid_state" });
    expect((await c.access(t)).allowed).toBe(false);
  });

  it("reintentos concurrentes: dos «Reintentar» y dos avances a la vez no duplican suscripción, partida, licencia ni cobro", async () => {
    const c = await contratacion({ processing: recovery });
    // Falla al enlazar la suscripción DESPUÉS de añadir la partida: el reintento reaplica el cambio
    const { base, order, t } = await paidModule(c, "Concurrente SL", () => c.faults.subscribe.push(net()));
    expect((await c.svc.must(order.id)).state).toBe("confirmed");
    c.t.clock += 2 * MIN;
    const both = await Promise.all([c.svc.retryActivation(t, { key: PRODUCT }, "service:core"), c.svc.retryActivation(t, { key: PRODUCT }, "service:core")]);
    expect(both.map((x) => x.status).sort()).toEqual(["active", "in_progress"]);
    expect((await c.svc.must(order.id)).state).toBe("active");
    await noDuplicates(c, base, order.id);

    // Avances simultáneos de otro pedido (webhook, tarea y operador a la vez)
    const d = await contratacion({ processing: recovery });
    const x = await paidModule(d, "Simultaneo SL", () => d.faults.licensing.push(net()));
    d.t.clock += 2 * MIN;
    const out = await Promise.all([d.svc.advance(x.order.id, ACTOR), d.svc.advance(x.order.id, ACTOR), d.svc.recoverActivations(ACTOR), d.svc.reconcile(ACTOR, { maxIdleMs: 30 * DAY })]);
    expect(out[0].order.state).toBe("active");
    expect(out[1].order.state).toBe("active");
    await noDuplicates(d, x.base, x.order.id);
    expect((await d.orders.events(x.order.id)).filter((e) => e.kind === "activate")).toHaveLength(1);
  });

  it("solo pedidos de ESA empresa: otra empresa no puede reintentar ni ver el pedido", async () => {
    const c = await contratacion({ processing: recovery });
    const a = await paidModule(c, "Empresa A SL", () => c.faults.activate.push(new OrderError("invalid_state", "Dato incompleto")));
    const b = await c.baseOrder("Empresa B SL");
    await expect(c.svc.retryActivation(b.tenantId!, { key: PRODUCT }, "service:core")).rejects.toMatchObject({ code: "not_found" });
    await expect(c.svc.retryActivation(b.tenantId!, {}, "service:core")).rejects.toMatchObject({ code: "invalid_state" });
    await expect(c.svc.retryActivation("no-existe", {}, "service:core")).rejects.toMatchObject({ code: "not_found" });
    expect((await c.svc.must(a.order.id)).state).toBe("licensed");
  });
});

describe("conciliación diaria", () => {
  it("reanuda un pedido atascado sin fallos (proceso caído a medias) y vence los pedidos sin cobro inactivos", async () => {
    const c = await contratacion({ processing: recovery });
    // Atascado: confirmado por aprobación registrada y nada más (como si el proceso cayera tras confirmar)
    const s = await c.baseOrder("Atascado SL");
    const ch = (await c.changeWith(s, [PRODUCT])).order;
    await c.svc.accept(ch.id, { signatureRef: "firma-atascado", approvalReason: "Aprobado por producto" }, ACTOR);
    const cur = await c.svc.must(ch.id);
    await c.orders.transition(cur.id, cur.version, { state: "confirmed", confirmation: { kind: "admin_approval", ref: null, actor: ACTOR, reason: "Cliente piloto aprobado", at: c.t.clock } }, { kind: "confirm", detail: null, actor: ACTOR, at: c.t.clock });
    expect((await c.svc.recoverActivations(ACTOR)).resumed).toBe(0); // aún no lleva STALE_ACTIVATION_MS quieto
    // Pedido de cambio sin cobro (preparado a mano) y otro con un cobro en curso: solo vence el primero
    const idle = await c.baseOrder("Sin Cobro SL");
    const manual = (await c.changeWith(idle, [PRODUCT])).order;
    await c.svc.accept(manual.id, { signatureRef: "firma-manual", approvalReason: "Aprobado por producto" }, ACTOR);
    const paying = await c.baseOrder("Pagando SL");
    const withPayment = await c.contractModule(paying);
    c.t.clock += STALE_ACTIVATION_MS;
    expect((await c.svc.reconcile(ACTOR, { maxIdleMs: 30 * DAY })).activations).toMatchObject({ resumed: 1, activated: 1 });
    expect((await c.svc.must(ch.id)).state).toBe("active");
    expect((await c.svc.must(manual.id)).state).toBe("contracted"); // aún dentro del plazo
    c.t.clock += 30 * DAY;
    // Modo «report» (por defecto): solo informa del candidato; ningún pedido cambia (ni estado, ni versión, ni eventos)
    const snapshot = async () => JSON.stringify(await Promise.all([manual.id, withPayment.order.id].map(async (id) => [await c.svc.must(id), (await c.orders.events(id)).length])));
    const before = await snapshot();
    const report = await c.svc.reconcile(ACTOR, { maxIdleMs: 30 * DAY });
    expect(report.expiry).toMatchObject({ mode: "report", candidates: 1, expired: 0, errors: [] });
    expect(await c.svc.reconcile(ACTOR, { maxIdleMs: 30 * DAY, expiryMode: "report" })).toMatchObject({ expiry: { candidates: 1, expired: 0 } });
    expect(await snapshot()).toBe(before);
    expect(await c.activationOf(idle.tenantId!)).toMatchObject({ state: "pending" });
    // Modo «apply»: lo rechaza con el motivo «expired»
    const r = await c.svc.reconcile(ACTOR, { maxIdleMs: 30 * DAY, expiryMode: "apply" });
    expect(r.expiry).toMatchObject({ mode: "apply", candidates: 1, expired: 1, errors: [] });
    expect(await c.svc.detail(manual.id)).toMatchObject({ order: { state: "rejected" }, rejectCode: "expired" });
    expect((await c.svc.must(withPayment.order.id)).state).toBe("contracted");
    expect(await c.activationOf(idle.tenantId!)).toMatchObject({ state: "error", payment: "expired", error: { kind: "payment" }, retryable: true });
    expect((await c.access(idle.tenantId!)).allowed).toBe(false);
    expect(await c.corePlan(idle.subscriptionId!)).toBe("business");
    // Repetirla no repite nada
    expect((await c.svc.reconcile(ACTOR, { maxIdleMs: 30 * DAY, expiryMode: "apply" })).expiry.expired).toBe(0);
  });
});

describe("tareas periódicas", () => {
  it("política por entorno: encendida por defecto, intervalos con mínimo y máximo, vencimiento configurable", () => {
    expect(orderRecoveryPolicyFromEnv({} as NodeJS.ProcessEnv)).toEqual({ enabled: true, intervalMs: MIN, reconcileMs: DAY, expiryDays: 30, expiryMode: "report" });
    expect(orderRecoveryPolicyFromEnv({ CP_ORDERS_RECOVERY_ENABLED: "0", CP_ORDERS_RECOVERY_INTERVAL_MS: "5", CP_ORDERS_RECONCILE_INTERVAL_MS: "10", CP_ORDERS_EXPIRY_DAYS: "0", CP_ORDERS_EXPIRY_MODE: "apply" } as NodeJS.ProcessEnv)).toEqual({ enabled: false, intervalMs: 30_000, reconcileMs: 3600_000, expiryDays: 0, expiryMode: "apply" });
    expect(orderRecoveryPolicyFromEnv({ CP_ORDERS_RECOVERY_INTERVAL_MS: "x", CP_ORDERS_EXPIRY_DAYS: "-3" } as NodeJS.ProcessEnv)).toMatchObject({ intervalMs: MIN, expiryDays: 30, expiryMode: "report" });
    expect(orderRecoveryPolicyFromEnv({ CP_ORDERS_EXPIRY_MODE: "aplicar" } as NodeJS.ProcessEnv).expiryMode).toBe("report");
  });

  it("una réplica por tick (bloqueo), fallo registrado sin romper, temporizadores con unref; apagada no arranca", async () => {
    const calls: string[] = [];
    const logs: string[] = [];
    let fail = false;
    const orchestrator = {
      recoverActivations: async () => {
        calls.push("tick");
        if (fail) throw new Error("BD caída");
        return { resumed: 1, activated: 1, failed: 0, errors: [] };
      },
      reconcile: async (_a: string, o: { maxIdleMs: number; expiryMode?: string }) => {
        calls.push(`daily:${o.maxIdleMs}:${o.expiryMode}`);
        return { activations: { resumed: 0, activated: 0, failed: 0, errors: [] }, expiry: { candidates: 2, expired: 0, errors: [] } };
      },
    };
    const unref = vi.fn();
    const timers = { setInterval: vi.fn(() => ({ unref })), clearInterval: vi.fn(), setTimeout: vi.fn(() => ({ unref })), clearTimeout: vi.fn() } as never;
    const lock = memoryLock();
    const s = startOrderRecovery({ orchestrator, policy: { enabled: true, intervalMs: MIN, reconcileMs: DAY, expiryDays: 30, expiryMode: "report" as const }, lock, timers, log: (_l, e) => void logs.push(e) });
    expect(unref).toHaveBeenCalledTimes(3);
    await s.tick();
    await s.daily();
    expect(calls).toEqual(["tick", `daily:${30 * DAY}:report`]);
    // Otra réplica tiene el bloqueo: no hace nada
    const held = await lock.acquire("cp:orders:recovery");
    await s.tick();
    expect(calls).toHaveLength(2);
    await held!();
    fail = true;
    await expect(s.tick()).resolves.toBeUndefined();
    expect(logs).toEqual(["recovery_tick", "reconcile", "recovery_failed"]);
    expect(lock.held.size).toBe(0);
    s.stop();
    expect(startOrderRecovery({ orchestrator, policy: { enabled: false, intervalMs: MIN, reconcileMs: DAY, expiryDays: 30, expiryMode: "report" as const } }).enabled).toBe(false);
  });
});

describe("ruta del Core POST /commerce/tenants/:t/activation/retry", () => {
  const CORE = "core-token-recuperacion-aaaaaaaaaaaaaaaaaa";
  const SUPPORT = "support-token-recuperacion-bbbbbbbbbbbbbbb";
  const serve = (c: Contratacion) => {
    const app = express();
    app.use(authenticate([
      { id: "core", sha256: hashToken(CORE), scopes: ["commerce:purchase"] },
      { id: "soporte", sha256: hashToken(SUPPORT), scopes: ["commerce:support"] },
    ]));
    app.use("/commerce", createPanelRetryRouter({ retry: (t, b, who) => c.svc.retryActivation(t, b, who), now: () => c.t.clock }));
    const server = http.createServer(app);
    return new Promise<{ call: (t: string, body: unknown, token?: string) => Promise<{ status: number; json: any }>; close: () => void }>((resolve) =>
      server.listen(0, "127.0.0.1", () => {
        const port = (server.address() as { port: number }).port;
        const call = (t: string, body: unknown, token = CORE) =>
          fetch(`http://127.0.0.1:${port}/commerce/tenants/${t}/activation/retry`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json() }));
        resolve({ call, close: () => server.close() });
      }),
    );
  };

  it("exige commerce:purchase, solo su empresa, limita la frecuencia y es idempotente", async () => {
    const c = await contratacion({ processing: recovery });
    const { order, t } = await paidModule(c, "Ruta SL", () => c.faults.activate.push(new OrderError("invalid_state", "Dato incompleto")));
    const other = await c.baseOrder("Otra Ruta SL");
    const s = await serve(c);
    try {
      expect((await s.call(t, { key: PRODUCT }, SUPPORT)).status).toBe(403);
      expect((await s.call(t, { key: "Mal Formado" })).status).toBe(400);
      expect((await s.call(other.tenantId!, { key: PRODUCT })).status).toBe(404);
      const ok = await s.call(t, { key: PRODUCT });
      expect(ok).toMatchObject({ status: 200, json: { status: "active", orderId: order.id, state: "active" } });
      expect((await s.call(t, { key: PRODUCT })).status).toBe(429);
      c.t.clock += 10_000;
      expect(await s.call(t, { key: PRODUCT })).toMatchObject({ status: 200, json: { status: "active" } });
      c.t.clock += 10_000;
      expect((await s.call(t, {})).status).toBe(409);
    } finally {
      s.close();
    }
  });
});
