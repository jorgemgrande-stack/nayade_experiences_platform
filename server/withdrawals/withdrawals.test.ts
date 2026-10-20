/**
 * Desistimiento de consumidores: evaluación (plazo en hora de Madrid, ampliación sin información precontractual,
 * ejecución inmediata y parte proporcional), servicio (justificante, idempotencia, una abierta por contrato,
 * gestión administrativa y avisos) y rutas HTTP (ámbito propio del Core y rutas de operador). Nunca hay reembolsos
 * ni bajas automáticas: el servicio no tiene acceso a Stripe.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { authenticate, hashToken } from "../controlPlane/auth";
import { MemoryCommercialEventLog } from "../commercialEvents/log";
import type { CommercialOrder, OrderPayment } from "../orchestrator/types";
import type { BuyerProfile, ConsentRecord } from "../stripe/buyerProfile";
import { assessWithdrawal, endOfMadridDay, withdrawalDeadline } from "./assessment";
import { MemoryWithdrawalStore, type WithdrawalRequest } from "./store";
import { WithdrawalError, WithdrawalService } from "./service";
import { createWithdrawalAdminRouter, createWithdrawalCommerceRouter } from "./api";

const DAY = 86_400_000;
const CONTRACT_AT = Date.UTC(2026, 9, 20, 10); // 20/10/2026 12:00 en Madrid (CEST)
const consent = (o: Partial<ConsentRecord> = {}): ConsentRecord => ({ source: "web", terms: { version: "v1", at: CONTRACT_AT }, privacy: null, precontract: { version: "pre1", at: CONTRACT_AT }, immediateExecution: { at: CONTRACT_AT }, evidence: "0".repeat(16), ...o });
const consumer = (c = consent()) => ({ type: "consumer" as const, consent: c });

describe("evaluación del desistimiento", () => {
  it("plazo: final del día 14 en hora de Madrid (con el cambio de horario de por medio)", () => {
    // 20/10 + 14 días = 03/11/2026, ya en horario de invierno (UTC+1): 23:59:59,999 en Madrid = 22:59:59,999 UTC
    expect(withdrawalDeadline(CONTRACT_AT, false)).toBe(Date.UTC(2026, 10, 3, 22, 59, 59, 999));
    // En verano (UTC+2)
    expect(endOfMadridDay(2026, 7, 1)).toBe(Date.UTC(2026, 6, 1, 21, 59, 59, 999));
    // Un contrato a las 23:30 de Madrid cuenta desde ESE día civil, no desde el siguiente en UTC
    expect(withdrawalDeadline(Date.UTC(2026, 0, 10, 22, 30), false)).toBe(Date.UTC(2026, 0, 24, 22, 59, 59, 999));
  });

  it("sin información precontractual constante: el plazo se amplía 12 meses (art. 105)", () => {
    const a = assessWithdrawal({ buyer: consumer(consent({ precontract: null })), contractAt: CONTRACT_AT, paid: null, period: null }, CONTRACT_AT + 200 * DAY);
    expect(a).toMatchObject({ applicability: "applicable", extended: true, withinTerm: true });
    expect(a.deadlineAt).toBe(Date.UTC(2027, 10, 3, 22, 59, 59, 999));
  });

  it("empresa o profesional: no hay desistimiento legal (cancelación ordinaria)", () => {
    expect(assessWithdrawal({ buyer: { type: "business", consent: consent() }, contractAt: CONTRACT_AT, paid: null, period: null }, CONTRACT_AT).applicability).toBe("not_consumer");
    expect(assessWithdrawal({ buyer: null, contractAt: CONTRACT_AT, paid: null, period: null }, CONTRACT_AT).applicability).toBe("not_consumer");
  });

  it("sin contrato de pago (prueba gratuita): no aplica", () => {
    expect(assessWithdrawal({ buyer: consumer(), contractAt: null, paid: null, period: null }, CONTRACT_AT).applicability).toBe("no_paid_contract");
  });

  it("ejecución inmediata: propuesta = lo pagado menos la parte proporcional prestada; sin ella, todo", () => {
    const period = { start: CONTRACT_AT, end: CONTRACT_AT + 30 * DAY };
    const paid = { amountCents: 3509, currency: "EUR" };
    const a = assessWithdrawal({ buyer: consumer(), contractAt: CONTRACT_AT, paid, period }, CONTRACT_AT + 3 * DAY);
    expect(a).toMatchObject({ withinTerm: true, immediateExecution: true, proportionalCents: 351, refundProposalCents: 3158, currency: "EUR", fullyPerformed: false });
    const b = assessWithdrawal({ buyer: consumer(consent({ immediateExecution: null })), contractAt: CONTRACT_AT, paid, period }, CONTRACT_AT + 3 * DAY);
    expect(b).toMatchObject({ immediateExecution: false, proportionalCents: 0, refundProposalCents: 3509 });
    expect(b.summary).toMatch(/Propuesta de reembolso: 35,09 EUR/);
  });

  it("fuera de plazo: se evalúa igual (lo decide una persona) y lo indica", () => {
    const a = assessWithdrawal({ buyer: consumer(), contractAt: CONTRACT_AT, paid: null, period: null }, CONTRACT_AT + 15 * DAY);
    expect(a).toMatchObject({ applicability: "applicable", withinTerm: false });
    expect(a.summary).toMatch(/^Fuera del plazo/);
  });
});

// ── Servicio ──────────────────────────────────────────────────────────────────

const order = (o: Partial<CommercialOrder> & { id: number }): CommercialOrder =>
  ({ reference: `PED-${o.id}`, idempotencyKey: `k${o.id}`, payloadHash: "h", kind: "new", state: "active", companyId: 7, leadRequestId: null, trialId: null, previousOrderId: null, request: { plan: "essential", interval: "month", items: [] }, quote: null, contractId: null, subscriptionId: null, tenantId: "particular-ana", confirmation: { kind: "payment", ref: "1", actor: "system:stripe", reason: null, at: CONTRACT_AT, contractable: "x" }, graceEndsAt: null, attempts: 0, lastError: null, ...o }) as CommercialOrder;

function setup(o: { buyer?: Pick<BuyerProfile, "type" | "consent"> | null; orders?: CommercialOrder[]; queued?: boolean } = {}) {
  let clock = CONTRACT_AT + 2 * DAY;
  const orders = o.orders ?? [order({ id: 100 })];
  const payments: OrderPayment[] = [{ id: 1, orderId: 100, idempotencyKey: "p1", purpose: "initial", periodStart: CONTRACT_AT, amountCents: 3509, currency: "EUR", status: "succeeded", provider: "stripe", mode: "live", providerRef: "in_1", dueAt: null, createdAt: CONTRACT_AT, settledAt: CONTRACT_AT }];
  const store = new MemoryWithdrawalStore();
  const events = new MemoryCommercialEventLog("live");
  const sent: Array<{ kind: string; to: string; ref: string; status: string }> = [];
  const svc = new WithdrawalService({
    store,
    crmStore: { list: async (_e: string, f: { tenantId?: string }) => (f.tenantId === "particular-ana" ? [{ id: 7 }] : []) } as never,
    orders: { list: async () => orders, get: async (id) => orders.find((x) => x.id === id) ?? null, payments: async (id) => payments.filter((p) => p.orderId === id) },
    buyers: { buyerProfile: async (id) => (id === 100 ? ((o.buyer === undefined ? consumer() : o.buyer) as BuyerProfile | null) : null) },
    notify: {
      receipt: async (to: string, r: WithdrawalRequest) => (sent.push({ kind: "receipt", to, ref: r.reference, status: r.status }), { queued: o.queued ?? true }),
      resolution: async (to: string, r: WithdrawalRequest) => (sent.push({ kind: "resolution", to, ref: r.reference, status: r.status }), { queued: true }),
    },
    events,
    now: () => clock,
  });
  return { svc, store, events, sent, advance: (ms: number) => void (clock += ms) };
}
const KEY = "clave-desistimiento-0001";

describe("servicio de desistimiento", () => {
  it("particular dentro de plazo: botón disponible; la solicitud da un justificante, avisa y registra el evento", async () => {
    const { svc, store, events, sent } = setup();
    expect(await svc.status("particular-ana")).toMatchObject({ available: true, assessment: { applicability: "applicable", withinTerm: true }, request: null });
    const r = await svc.request("particular-ana", { idempotencyKey: KEY, requestedBy: "user:5", contactEmail: "Ana@Example.com" }, "customer:particular-ana/user:5");
    expect(r.created).toBe(true);
    expect(r.receipt).toMatchObject({ reference: expect.stringMatching(/^DS-20261022-[0-9A-F]{6}$/), requestedAt: CONTRACT_AT + 2 * DAY, status: "received", withinTerm: true, receiptSent: true });
    expect(r.receipt.text).toMatch(/dentro del plazo/);
    expect(sent).toEqual([{ kind: "receipt", to: "ana@example.com", ref: r.receipt.reference, status: "received" }]);
    const [row] = store.rows;
    expect(row).toMatchObject({ contractOrderId: 100, orderId: 100, channel: "platform", assessment: { refundProposalCents: expect.any(Number) } });
    expect(await store.events(row.id)).toEqual([expect.objectContaining({ action: "requested", toStatus: "received", actor: "customer:particular-ana/user:5" })]);
    expect((await events.list({})).map((e) => [e.type, e.source])).toEqual([["order.withdrawal_requested", "customer"]]);
    // Con la solicitud abierta, el botón ya no se ofrece y se ve su estado
    expect(await svc.status("particular-ana")).toMatchObject({ available: false, request: { reference: r.receipt.reference, status: "received" } });
  });

  it("la misma petición repetida devuelve el mismo justificante; otra distinta con una abierta, conflicto", async () => {
    const { svc, sent } = setup();
    const a = await svc.request("particular-ana", { idempotencyKey: KEY, requestedBy: "user:5", contactEmail: "ana@example.com" }, "c");
    const b = await svc.request("particular-ana", { idempotencyKey: KEY, requestedBy: "user:5", contactEmail: "ana@example.com" }, "c");
    expect(b).toMatchObject({ created: false, receipt: { reference: a.receipt.reference } });
    expect(sent).toHaveLength(1);
    await expect(svc.request("particular-ana", { idempotencyKey: "otra-clave-000000001", requestedBy: "user:5", contactEmail: "ana@example.com" }, "c")).rejects.toMatchObject({ code: "conflict" });
  });

  it("con el correo apagado el acuse no cuenta como enviado (el justificante queda en la cuenta)", async () => {
    const { svc } = setup({ queued: false });
    const r = await svc.request("particular-ana", { idempotencyKey: KEY, requestedBy: "user:5", contactEmail: "ana@example.com" }, "c");
    expect(r.receipt.receiptSent).toBe(false);
  });

  it("fuera de plazo: no se ofrece el botón, pero una solicitud se registra igualmente (no se pierde una reclamación)", async () => {
    const { svc, advance } = setup();
    advance(20 * DAY);
    expect(await svc.status("particular-ana")).toMatchObject({ available: false, assessment: { withinTerm: false } });
    const r = await svc.request("particular-ana", { idempotencyKey: KEY, requestedBy: "user:5", contactEmail: "ana@example.com" }, "c");
    expect(r.receipt).toMatchObject({ withinTerm: false });
    expect(r.receipt.text).toMatch(/fuera del plazo/);
  });

  it("empresa: no aplica (409) y se remite a la cancelación ordinaria; datos no válidos, 400", async () => {
    const { svc } = setup({ buyer: { type: "business", consent: consent() } });
    expect(await svc.status("particular-ana")).toMatchObject({ available: false, assessment: { applicability: "not_consumer" } });
    await expect(svc.request("particular-ana", { idempotencyKey: KEY, requestedBy: "user:5", contactEmail: "a@b.example" }, "c")).rejects.toMatchObject({ code: "not_applicable" });
    await expect(setup().svc.request("particular-ana", { idempotencyKey: KEY, requestedBy: "user:5", contactEmail: "no-es-correo" }, "c")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(setup().svc.status("Otra Empresa")).rejects.toBeInstanceOf(WithdrawalError);
  });

  it("tras un cambio de plan, el contrato del que se desiste es el pedido que lo celebró", async () => {
    const { svc, store } = setup({ orders: [order({ id: 100, state: "superseded" }), order({ id: 120, kind: "change", previousOrderId: 100 })] });
    await svc.request("particular-ana", { idempotencyKey: KEY, requestedBy: "user:5", contactEmail: "ana@example.com" }, "c");
    expect(store.rows[0]).toMatchObject({ orderId: 120, contractOrderId: 100 });
  });

  it("gestión: revisar → aceptar (con motivo) → completar con la referencia del reembolso manual; transiciones inválidas y versión obsoleta, rechazadas", async () => {
    const { svc, store, sent, events } = setup();
    const { receipt } = await svc.request("particular-ana", { idempotencyKey: KEY, requestedBy: "user:5", contactEmail: "ana@example.com" }, "c");
    const id = store.rows[0].id;
    await expect(svc.decide(id, "complete", { note: "Reembolso hecho", expectedVersion: 1 }, "operator:jorge")).rejects.toMatchObject({ code: "invalid_state" });
    await expect(svc.decide(id, "accept", { note: "", expectedVersion: 1 }, "operator:jorge")).rejects.toMatchObject({ code: "invalid_input" });
    const v2 = await svc.decide(id, "review", { expectedVersion: 1 }, "operator:jorge");
    expect(v2).toMatchObject({ status: "under_review", version: 2 });
    await expect(svc.decide(id, "accept", { note: "Dentro de plazo", expectedVersion: 1 }, "operator:jorge")).rejects.toMatchObject({ code: "conflict" });
    const v3 = await svc.decide(id, "accept", { note: "Dentro de plazo: se reembolsan 31,58 EUR", expectedVersion: 2 }, "operator:jorge");
    expect(v3).toMatchObject({ status: "accepted", resolution: { note: "Dentro de plazo: se reembolsan 31,58 EUR", decidedBy: "operator:jorge", refundReference: null } });
    const v4 = await svc.decide(id, "complete", { note: "Reembolso emitido a mano en Stripe y suscripción dada de baja", refundReference: "re_123", expectedVersion: 3 }, "operator:jorge");
    expect(v4).toMatchObject({ status: "completed", resolution: { refundReference: "re_123" } });
    expect((await store.events(id)).map((e) => e.action)).toEqual(["requested", "review", "accept", "complete"]);
    expect(sent.map((s) => `${s.kind}:${s.status}`)).toEqual(["receipt:received", "resolution:accepted", "resolution:completed"]);
    expect((await events.list({})).map((e) => e.toState)).toEqual(["received", "accepted", "completed"]);
    expect(receipt.reference).toBe(v4.reference);
  });

  it("rechazo con motivo: queda cerrada y se puede presentar otra", async () => {
    const { svc, store } = setup();
    await svc.request("particular-ana", { idempotencyKey: KEY, requestedBy: "user:5", contactEmail: "ana@example.com" }, "c");
    await svc.decide(store.rows[0].id, "reject", { note: "Duplicada por error del cliente", expectedVersion: 1 }, "operator:jorge");
    await expect(svc.request("particular-ana", { idempotencyKey: "otra-clave-000000001", requestedBy: "user:5", contactEmail: "ana@example.com" }, "c")).resolves.toMatchObject({ created: true });
  });
});

// ── HTTP ──────────────────────────────────────────────────────────────────────

describe("rutas HTTP del desistimiento", () => {
  let server: http.Server;
  let base = "";
  const CORE = "token-del-core-0000000000000000000000";
  const CORE_PURCHASE_ONLY = "token-compras-000000000000000000000000";
  const OPERATOR = "token-operador-00000000000000000000000";
  beforeEach(async () => {
    const { svc } = setup();
    const app = express();
    app.use(express.json());
    const router = express.Router();
    router.use(
      authenticate([
        { id: "core", sha256: hashToken(CORE), scopes: ["commerce:withdrawal"], actorType: "crm" },
        { id: "core-compras", sha256: hashToken(CORE_PURCHASE_ONLY), scopes: ["commerce:purchase"], actorType: "crm" },
        { id: "ops", sha256: hashToken(OPERATOR), scopes: ["orders:read", "orders:write"], actorType: "operator" },
      ]),
    );
    router.use("/commerce", createWithdrawalCommerceRouter(svc));
    router.use("/withdrawals", createWithdrawalAdminRouter(svc));
    app.use("/cp/v1", router);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/cp/v1`;
  });
  afterEach(() => new Promise<void>((r) => server.close(() => r())));
  const call = async (method: string, path: string, token: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: (await r.json()) as Record<string, any> };
  };

  it("el Core con su ámbito propio consulta y desiste; un token solo de compras no puede; el tenant se valida", async () => {
    expect((await call("GET", "/commerce/tenants/particular-ana/withdrawal", CORE_PURCHASE_ONLY)).status).toBe(403);
    expect((await call("GET", "/commerce/tenants/particular-ana/withdrawal", CORE)).body.withdrawal).toMatchObject({ available: true });
    expect((await call("GET", "/commerce/tenants/NO..VALIDO/withdrawal", CORE)).status).toBe(400);
    const r = await call("POST", "/commerce/tenants/particular-ana/withdrawal", CORE, { idempotencyKey: KEY, requestedBy: "user:5", contactEmail: "ana@example.com" });
    expect(r.status).toBe(201);
    expect(r.body.receipt.reference).toMatch(/^DS-/);
    expect((await call("POST", "/commerce/tenants/particular-ana/withdrawal", CORE, { idempotencyKey: KEY, requestedBy: "user:5", contactEmail: "ana@example.com" })).status).toBe(200);
    // El Core no gestiona solicitudes
    expect((await call("GET", "/withdrawals", CORE)).status).toBe(403);
  });

  it("operadores: listan, ven el historial, deciden; registran una solicitud recibida por otro canal", async () => {
    const created = await call("POST", "/withdrawals", OPERATOR, { tenantId: "particular-ana", contactEmail: "ana@example.com", statement: "Llamó por teléfono", idempotencyKey: "soporte-telefono-0001" });
    expect(created.status).toBe(201);
    const list = await call("GET", "/withdrawals?status=received", OPERATOR);
    expect(list.body.withdrawals).toEqual([expect.objectContaining({ channel: "support", requestedBy: "operator:ops" })]);
    const id = list.body.withdrawals[0].id;
    expect((await call("POST", `/withdrawals/${id}/decision`, OPERATOR, { action: "accept", note: "Dentro de plazo", expectedVersion: 1 })).body.withdrawal).toMatchObject({ status: "accepted" });
    expect((await call("GET", `/withdrawals/${id}`, OPERATOR)).body.events.map((e: { action: string }) => e.action)).toEqual(["requested", "accept"]);
    expect((await call("POST", `/withdrawals/${id}/decision`, OPERATOR, { action: "accept", note: "otra vez", expectedVersion: 2 })).status).toBe(409);
  });
});
