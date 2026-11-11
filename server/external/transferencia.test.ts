/**
 * Pago por transferencia de una nota de cobro de un cliente externo (CRM 0050), con los mismos datos que la operación
 * real #3 de Nextair (base 1.487,60 € + IVA 312,40 € = 1.800,00 €) pero SINTÉTICOS: nunca se toca la real. Stripe es el
 * doble de pruebas (nunca se cobra ni se caduca nada real).
 *
 * Cubre: justificante PDF obligatorio (solo comprobaciones de seguridad), almacén privado y acceso, estados de la
 * operación y de la nota de cobro, idempotencia (doble envío), concurrencia con el webhook de Stripe en los dos órdenes,
 * rechazo si Stripe ya cobró, caducidad del enlace de Stripe, cobro tardío de Stripe señalado y no contado, rectificación
 * y anulación auditadas, métricas por medio y permisos de las rutas.
 */
import { describe, it, expect } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { ChargeService, MemoryChargeStore } from "../invoicing/charges";
import { ChargePaymentService, MemoryChargePaymentStore, type DuplicateCharge } from "../invoicing/chargePayments";
import { MemoryReceiptStore, parseReceipt, receiptsOnFinanceDocuments } from "../invoicing/transferReceipts";
import { MemoryInvoicingStore } from "../invoicing/store";
import type { CompanyFiscal } from "../invoicing/rules";
import { MemoryStripeStore } from "../stripe/store";
import { FakeStripeGateway } from "../stripe/testing";
import type { GwCheckoutSession } from "../stripe/gateway";
import { authenticate, hashToken, type Scope } from "../controlPlane/auth";
import { chargeCollected, revenueMetrics } from "../revenue/metrics";
import { ExternalOperationsService, MemoryOperationStore } from "./operations";
import { EXTERNAL_UPLOAD_PATHS, createExternalOperationsRouter } from "./operationsApi";

const NEXTAIR: CompanyFiscal & { id: number; tenantId: string | null } = { id: 7, name: "Nextair (prueba)", legalName: "NEXTAIR PRUEBA SL", taxId: "B00000000", address: "Calle de Prueba 1", postalCode: "18006", city: "Granada", country: "ES", tenantId: null };
const T = Date.UTC(2026, 10, 11, 9);
const PDF = Buffer.from("%PDF-1.4\n% justificante de prueba\n1 0 obj<<>>endobj\n%%EOF\n");
const pdf = (name = "transferencia-nextair.pdf", buf = PDF) => ({ filename: name, contentBase64: buf.toString("base64") });
const OP = { companyId: 7, kind: "one_off" as const, title: "Asesoría implementación Integración turísticas V1", taxRateBp: 2100, dueDate: "2026-11-30", lines: [{ key: "l1", concept: "Asesoría implementación Integración turísticas V1", category: "service" as const, pricing: "fixed" as const, quantity: 1, unitCents: 148_760 }] };

/** Doble de Stripe que también caduca las sesiones de pago único (como `checkout.sessions.expire`). */
class Gw extends FakeStripeGateway {
  failExpire = false;
  async expireCheckoutSession(id: string): Promise<GwCheckoutSession> {
    const s = this.paymentSessions.get(id);
    if (!s) return super.expireCheckoutSession(id);
    this.calls.push({ op: "checkout.sessions.expire", input: id });
    if (this.failExpire) throw new Error("Stripe no responde");
    if (s.status !== "open") throw new Error("Only Checkout Sessions with a status of open can be expired");
    this.paymentSessions.set(id, { ...s, status: "expired", url: null });
    return { id, status: "expired", paymentStatus: "unpaid", url: null, customerId: s.customerId, subscriptionId: null, clientReferenceId: null, metadata: s.metadata, expiresAt: s.expiresAt };
  }
  /** Stripe cobra la sesión aunque aquí ya se diera por cerrada (carrera con el cliente pagando). */
  payAnyway(id: string) {
    const s = this.paymentSessions.get(id)!;
    this.paymentSessions.set(id, { ...s, status: "complete", paymentStatus: "paid", paymentIntentId: `pi_tarde_${id}`, url: null });
  }
}

function setup(o: { receipts?: boolean } = {}) {
  let now = T;
  const company = async (id: number) => (id === 7 ? NEXTAIR : null);
  const invoices = new MemoryInvoicingStore();
  const chargeStore = new MemoryChargeStore();
  const charges = new ChargeService({ charges: chargeStore, invoices, company, now: () => now });
  const gw = new Gw();
  const store = new MemoryChargePaymentStore();
  const receipts = new MemoryReceiptStore();
  const duplicates: DuplicateCharge[] = [];
  const payments = new ChargePaymentService({ payments: store, charges, invoices, company, gateway: gw, stripeStore: new MemoryStripeStore("test"), mode: "test", namespace: "beta", urls: { success: "https://admin.example/ok", cancel: "https://admin.example/ko" }, now: () => now, receipts: o.receipts === false ? undefined : receipts, onDuplicate: async (x) => void duplicates.push(x) });
  const ops = new MemoryOperationStore();
  const svc = new ExternalOperationsService({ store: ops, company, charges, invoices, payments, namespace: "beta", now: () => now });
  return { svc, ops, invoices, gw, store, receipts, payments, duplicates, setNow: (t: number) => (now = t) };
}

/** Operación emitida con su enlace de pago de Stripe abierto (como la #3 real). */
async function issuedWithLink(t: ReturnType<typeof setup>) {
  const { operation, periods } = await t.svc.create(OP, "operator:ana");
  const p = await t.svc.issue(operation.id, periods[0].id, "operator:jefa");
  await t.svc.paymentLink(operation.id, p.id, "operator:jefa");
  const sid = (await t.payments.list(p.chargeId!)).find((x) => x.kind === "stripe_link")!.stripeSessionId!;
  return { opId: operation.id, pid: p.id, chargeId: p.chargeId!, invoiceId: p.invoiceId!, sid };
}
const transfer = (k = "form-key-0001", o: Record<string, unknown> = {}) => ({ amountCents: 180_000, receivedOn: "2026-11-10", reference: "TRF NEXTAIR 1800", receipt: pdf(), idempotencyKey: k, confirmed: true as const, ...o });

describe("pago por transferencia de una nota de cobro", () => {
  it("1.800,00 € con PDF: operación y nota pagadas, movimiento por transferencia, enlace de Stripe caducado y justificante visible", async () => {
    const t = setup();
    const x = await issuedWithLink(t);
    const before = await t.svc.detail(x.opId);
    expect(before.operation.display.state).toBe("pending");
    expect(before.periods[0].payment).toMatchObject({ state: "pending", pendingCents: 180_000, transfers: true, movements: [] });
    expect(before.operation.totals).toMatchObject({ baseCents: 148_760, taxCents: 31_240, totalCents: 180_000 });

    const out = await t.svc.transferPayment(x.opId, x.pid, transfer(), "operator:jorge");
    expect(out.replay).toBe(false);
    expect(out.stripe).toEqual([{ sessionId: x.sid, outcome: "expired" }]);
    // El enlace se caduca en Stripe (por la pasarela) y aquí queda anulado
    expect(t.gw.calls.filter((c) => c.op === "checkout.sessions.expire").map((c) => c.input)).toEqual([x.sid]);
    expect(t.gw.paymentSessions.get(x.sid)!.status).toBe("expired");

    const d = await t.svc.detail(x.opId);
    expect(d.operation.display).toEqual({ state: "active", label: "Pagado" });
    expect(d.periods[0].payment).toMatchObject({ state: "paid", method: "bank_transfer", pendingCents: 0, link: null, paidAt: Date.parse("2026-11-10T12:00:00Z") });
    expect(d.periods[0].payment.movements).toEqual([expect.objectContaining({ method: "bank_transfer", status: "paid", totalCents: 180_000, receivedOn: "2026-11-10", reference: "TRF NEXTAIR 1800", createdBy: "operator:jorge", receiptDocumentId: 1 })]);
    // Factura cobrada por la transferencia, una sola vez
    expect(await t.invoices.get(x.invoiceId)).toMatchObject({ paymentStatus: "paid", paymentRef: expect.stringMatching(/^transfer:\d+$/) });
    // Trazabilidad: operador, fecha, importe, medio, operación y documento
    const ev = d.events.find((e) => e.kind === "paid_transfer")!;
    expect(ev).toMatchObject({ actor: "operator:jorge", operationId: x.opId, detail: { totalCents: 180_000, method: "bank_transfer", receivedOn: "2026-11-10", receiptDocumentId: 1, receipt: { filename: "transferencia-nextair.pdf", sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }, stripeLinks: [{ sessionId: x.sid, outcome: "expired" }] } });
    // Justificante: solo el de este cargo
    const r = await t.svc.transferReceipt(x.opId, x.pid, 1);
    expect(r.content.equals(PDF)).toBe(true);
    expect(r.doc).toMatchObject({ mime: "application/pdf", chargeId: x.chargeId });
    await expect(t.svc.transferReceipt(x.opId, x.pid, 99)).rejects.toMatchObject({ code: "not_found" });
    // Ya pagada: otro registro se rechaza
    await expect(t.svc.transferPayment(x.opId, x.pid, transfer("form-key-0002"), "operator:jorge")).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("PDF obligatorio y solo comprobaciones de seguridad (tipo y tamaño); confirmación expresa; solo el total (sin pagos parciales)", async () => {
    const t = setup();
    const x = await issuedWithLink(t);
    const go = (o: Record<string, unknown>) => t.svc.transferPayment(x.opId, x.pid, transfer("form-key-0003", o) as never, "operator:jorge");
    await expect(go({ receipt: null })).rejects.toMatchObject({ code: "invalid_input", message: expect.stringMatching(/obligatorio/) });
    await expect(go({ receipt: pdf("x.pdf", Buffer.from("<html>no soy un pdf</html>")) })).rejects.toMatchObject({ code: "invalid_input", message: expect.stringMatching(/PDF/) });
    await expect(go({ receipt: { filename: "x.pdf", contentBase64: "no-es-base64!" } })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(go({ receipt: pdf("x.pdf", Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)])) })).rejects.toMatchObject({ code: "invalid_input", message: expect.stringMatching(/10 MB/) });
    await expect(go({ confirmed: false })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(go({ amountCents: 90_000 })).rejects.toMatchObject({ code: "invalid_input", message: expect.stringMatching(/1\.800,00\s€.*parciales/) });
    await expect(go({ receivedOn: "2026-11-12" })).rejects.toMatchObject({ code: "invalid_input", message: expect.stringMatching(/futura/) });
    await expect(go({ receivedOn: "2026-02-30" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(go({ idempotencyKey: "x" })).rejects.toMatchObject({ code: "invalid_input" });
    // Nada ha cambiado: ni pago, ni documento, ni enlace caducado
    expect(t.store.rows.filter((r) => r.kind === "offline")).toHaveLength(0);
    expect(t.receipts.rows).toHaveLength(0);
    expect(t.gw.paymentSessions.get(x.sid)!.status).toBe("open");
    // El contenido del PDF no se lee: un PDF cualquiera vale (es la prueba que aporta el administrador)
    expect(parseReceipt(pdf("sin-extension", Buffer.from("%PDF-1.7 cualquier cosa"))).filename).toBe("sin-extension.pdf");
    // Sin almacén de justificantes no se registra ninguna transferencia
    const n = setup({ receipts: false });
    const y = await issuedWithLink(n);
    await expect(n.svc.transferPayment(y.opId, y.pid, transfer(), "operator:jorge")).rejects.toMatchObject({ code: "unavailable" });
  });

  it("idempotencia: el doble envío (seguido o a la vez) deja un solo pago, un justificante y un evento", async () => {
    const t = setup();
    const x = await issuedWithLink(t);
    const [a, b] = await Promise.all([t.svc.transferPayment(x.opId, x.pid, transfer("dbl-click-0001"), "operator:jorge"), t.svc.transferPayment(x.opId, x.pid, transfer("dbl-click-0001"), "operator:jorge")]);
    expect([a.replay, b.replay].sort()).toEqual([false, true]);
    const c = await t.svc.transferPayment(x.opId, x.pid, transfer("dbl-click-0001"), "operator:jorge");
    expect(c.replay).toBe(true);
    expect(t.store.rows.filter((r) => r.kind === "offline")).toHaveLength(1);
    expect(t.receipts.rows).toHaveLength(1);
    expect((await t.svc.detail(x.opId)).events.filter((e) => e.kind === "paid_transfer")).toHaveLength(1);
    // Otra clave con la nota ya pagada: rechazo
    await expect(t.svc.transferPayment(x.opId, x.pid, transfer("dbl-click-0002"), "operator:jorge")).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("Stripe ya confirmó el cobro: registrar otra vez el total se rechaza", async () => {
    const t = setup();
    const x = await issuedWithLink(t);
    t.gw.completePaymentSession(x.sid, "paid");
    expect(await t.payments.handleSession(x.sid)).toBe("Cargo cobrado");
    await expect(t.svc.transferPayment(x.opId, x.pid, transfer(), "operator:jorge")).rejects.toMatchObject({ code: "invalid_state", message: expect.stringMatching(/Stripe ya confirmó/) });
    expect(t.store.rows.filter((r) => r.kind === "offline")).toHaveLength(0);
    expect((await t.svc.detail(x.opId)).periods[0].payment).toMatchObject({ state: "paid", method: "stripe" });
  });

  it("Stripe cobró pero el webhook aún no ha llegado: se registra ese cobro y la transferencia se rechaza", async () => {
    const t = setup();
    const x = await issuedWithLink(t);
    t.gw.completePaymentSession(x.sid, "paid");
    await expect(t.svc.transferPayment(x.opId, x.pid, transfer(), "operator:jorge")).rejects.toMatchObject({ code: "invalid_state", message: expect.stringMatching(/Stripe ya ha cobrado/) });
    expect(await t.invoices.get(x.invoiceId)).toMatchObject({ paymentStatus: "paid", paymentRef: expect.stringMatching(/^stripe:pi:/) });
    expect(t.receipts.rows).toHaveLength(0);
    // El webhook que llega después no cambia nada
    expect(await t.payments.handleSession(x.sid)).toBe("Ya registrado");
    expect(t.duplicates).toHaveLength(0);
  });

  it("concurrencia con el webhook de Stripe, en los dos órdenes: un solo cobro contabilizado", async () => {
    for (const first of ["transfer", "stripe"] as const) {
      const t = setup();
      const x = await issuedWithLink(t);
      t.gw.completePaymentSession(x.sid, "paid");
      const tr = () => t.svc.transferPayment(x.opId, x.pid, transfer(), "operator:jorge").then(() => "ok", (e) => e.code);
      const st = () => t.payments.handleSession(x.sid);
      const results = first === "transfer" ? await Promise.all([tr(), st()]) : (await Promise.all([st(), tr()])).reverse();
      expect(results[0]).toBe("invalid_state");
      expect(["Cargo cobrado", "Ya registrado"]).toContain(results[1]);
      expect(t.store.rows.filter((r) => r.status === "paid")).toHaveLength(1);
      expect(t.store.rows.filter((r) => r.settlesChargeId === x.chargeId)).toHaveLength(1);
      expect(t.duplicates).toHaveLength(0);
      expect((await t.invoices.get(x.invoiceId))!.paymentRef).toMatch(/^stripe:/);
    }
  });

  it("cobro de Stripe tardío tras la transferencia: queda señalado para revisar y reembolsar, nunca se cuenta dos veces", async () => {
    const t = setup();
    const x = await issuedWithLink(t);
    await t.svc.transferPayment(x.opId, x.pid, transfer(), "operator:jorge");
    // El cliente pagó en Stripe justo antes de que caducara (o Stripe no respondió a la caducidad)
    t.gw.payAnyway(x.sid);
    const msg = await t.payments.handleSession(x.sid);
    expect(msg).toMatch(/Cobro duplicado/);
    expect(t.duplicates).toEqual([expect.objectContaining({ sessionId: x.sid, paymentIntentId: `pi_tarde_${x.sid}`, amountTotalCents: 180_000, settledBy: expect.objectContaining({ method: "bank_transfer" }) })]);
    // Repetir el webhook no avisa otra vez ni cambia nada
    expect(await t.payments.handleSession(x.sid)).toMatch(/ya señalado/);
    expect(t.duplicates).toHaveLength(1);
    expect(await t.invoices.get(x.invoiceId)).toMatchObject({ paymentStatus: "paid", paymentRef: expect.stringMatching(/^transfer:/) });
    const d = await t.svc.detail(x.opId);
    expect(d.periods[0].payment.movements.map((m) => [m.method, m.status])).toEqual([["bank_transfer", "paid"], ["stripe", "duplicate"]]);
    // Métricas: un solo cobro (el de la transferencia)
    const m = chargeCollected(await t.payments.collectedBetween(T - 30 * 86_400_000, T));
    expect(m).toMatchObject({ count: 1, grossCents: 180_000, netCents: 148_760, taxCents: 31_240, byMethod: { bank_transfer: { count: 1, grossCents: 180_000 }, stripe: { count: 0, grossCents: 0 } } });
  });

  it("Stripe no responde al caducar el enlace: la transferencia se consolida igual y un cobro posterior queda como duplicado", async () => {
    const t = setup();
    const x = await issuedWithLink(t);
    t.gw.failExpire = true;
    const out = await t.svc.transferPayment(x.opId, x.pid, transfer(), "operator:jorge");
    expect(out.stripe).toEqual([{ sessionId: x.sid, outcome: "expire_failed" }]);
    expect((await t.svc.detail(x.opId)).periods[0].payment.state).toBe("paid");
    t.gw.completePaymentSession(x.sid, "paid");
    expect(await t.payments.handleSession(x.sid)).toMatch(/Cobro duplicado/);
    expect(t.duplicates).toHaveLength(1);
  });

  it("rectificación y anulación auditadas: el historial conserva el original y el antes y el después", async () => {
    const t = setup();
    const x = await issuedWithLink(t);
    await t.svc.transferPayment(x.opId, x.pid, transfer(), "operator:jorge");
    const pay = t.store.rows.find((r) => r.method === "bank_transfer")!;
    await expect(t.svc.rectifyTransfer(x.opId, x.pid, pay.id, { reason: "x", receivedOn: "2026-11-09" }, "operator:jorge")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(t.svc.rectifyTransfer(x.opId, x.pid, pay.id, { reason: "Sin cambios reales" }, "operator:jorge")).rejects.toMatchObject({ code: "invalid_input" });
    await t.svc.rectifyTransfer(x.opId, x.pid, pay.id, { reason: "El banco la abonó el día 9", receivedOn: "2026-11-09", receipt: pdf("extracto-corregido.pdf") }, "operator:jorge");
    expect(t.receipts.rows).toHaveLength(2); // el justificante anterior se conserva
    expect(await t.invoices.get(x.invoiceId)).toMatchObject({ paidAt: Date.parse("2026-11-09T12:00:00Z") });
    const ev = (await t.svc.detail(x.opId)).events.find((e) => e.kind === "transfer_rectified")!;
    expect(ev).toMatchObject({ actor: "operator:jorge", detail: { reason: "El banco la abonó el día 9", before: { receivedOn: "2026-11-10", receiptDocumentId: 1 }, after: { receivedOn: "2026-11-09", receiptDocumentId: 2 } } });
    await expect(t.svc.transferReceipt(x.opId, x.pid, 1)).resolves.toBeTruthy();

    // Anulación: el pago queda anulado (no se borra) y la nota vuelve a pendiente
    await expect(t.svc.voidTransfer(x.opId, x.pid, pay.id, { reason: "no" }, "operator:jorge")).rejects.toMatchObject({ code: "invalid_input" });
    await t.svc.voidTransfer(x.opId, x.pid, pay.id, { reason: "Registrada en la nota equivocada" }, "operator:jorge");
    const d = await t.svc.detail(x.opId);
    expect(d.periods[0].payment).toMatchObject({ state: "pending", pendingCents: 180_000 });
    expect(d.periods[0].payment.movements).toEqual([expect.objectContaining({ id: pay.id, status: "voided", voidedBy: "operator:jorge", voidReason: "Registrada en la nota equivocada" })]);
    expect(d.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["paid_transfer", "transfer_rectified", "transfer_voided"]));
    await expect(t.svc.voidTransfer(x.opId, x.pid, pay.id, { reason: "Otra vez la misma" }, "operator:jorge")).rejects.toMatchObject({ code: "invalid_state" });
    // Se puede registrar de nuevo, bien hecha (con otra clave)
    await t.svc.transferPayment(x.opId, x.pid, transfer("form-key-0009", { receivedOn: "2026-11-09" }), "operator:jorge");
    expect((await t.svc.detail(x.opId)).periods[0].payment.state).toBe("paid");
    expect(chargeCollected(await t.payments.collectedBetween(T - 86_400_000 * 30, T)).count).toBe(1);
  });

  it("métricas del panel: los cobros únicos por medio, sin duplicados ni anulados", () => {
    const base = { amountCents: 148_760, totalCents: 180_000 };
    const m = revenueMetrics({
      external: [],
      events: new Map(),
      now: T,
      charges: [
        { ...base, kind: "offline", method: "bank_transfer", status: "paid" },
        { ...base, kind: "stripe_link", method: null, status: "paid" },
        { ...base, kind: "offline", method: null, status: "paid" },
        { ...base, kind: "stripe_link", method: null, status: "duplicate" },
        { ...base, kind: "offline", method: "bank_transfer", status: "voided" },
      ],
    });
    expect(m.charges).toEqual({ count: 3, grossCents: 540_000, netCents: 446_280, taxCents: 93_720, byMethod: { bank_transfer: { count: 1, grossCents: 180_000 }, stripe: { count: 1, grossCents: 180_000 }, other: { count: 1, grossCents: 180_000 } } });
    // Las facturas de las suscripciones siguen aparte
    expect(m.collected.grossCents).toBe(0);
    expect(revenueMetrics({ external: [], events: new Map(), now: T }).charges).toBeUndefined();
  });

  it("almacén privado: los justificantes van a fin_documents con su propio tipo y no se sirven documentos de las finanzas", async () => {
    const docs: Array<{ id: number; ownerType: string; ownerId: number; filename: string; mime: string; sizeBytes: number; sha256: string; uploadedBy: string; createdAt: number; content: Buffer }> = [{ id: 1, ownerType: "expense", ownerId: 3, filename: "factura.pdf", mime: "application/pdf", sizeBytes: 3, sha256: "x", uploadedBy: "u", createdAt: 1, content: Buffer.from("%PDF") }];
    const port = {
      insertDocument: async (d: never, content: Buffer) => {
        const row = { ...(d as object), id: docs.length + 1, content } as (typeof docs)[number];
        docs.push(row);
        return row;
      },
      getDocument: async (id: number) => docs.find((d) => d.id === id) ?? null,
      getDocumentContent: async (id: number) => docs.find((d) => d.id === id)?.content ?? null,
    };
    const r = receiptsOnFinanceDocuments(port);
    const put = await r.put(5, parseReceipt(pdf()), "operator:jorge", T);
    expect(docs.at(-1)).toMatchObject({ ownerType: "charge_receipt", ownerId: 5, mime: "application/pdf" });
    expect(await r.get(put.id)).toMatchObject({ chargeId: 5 });
    // Un documento de las finanzas (gasto) no es un justificante: no se sirve por aquí
    expect(await r.get(1)).toBeNull();
    expect(await r.content(1)).toBeNull();
  });
});

describe("rutas: permisos, justificante privado y cuerpo grande", () => {
  const TOKENS: Record<string, Scope[]> = {
    "admin-token-aaaaaaaaaaaaaaaa": ["crm:read", "orders:write", "orders:approve", "billing:write", "billing:read"],
    "sales-token-aaaaaaaaaaaaaaaa": ["crm:read", "orders:write", "billing:read"],
    "approve-only-token-aaaaaaaaa": ["crm:read", "orders:approve"],
  };
  async function serve(t: ReturnType<typeof setup>) {
    const app = express();
    app.use("/cp/v1", authenticate(Object.entries(TOKENS).map(([tok, scopes]) => ({ id: tok.split("-")[0], sha256: hashToken(tok), scopes, actorType: "operator" as const }))));
    app.use("/cp/v1/external-ops", createExternalOperationsRouter(t.svc));
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as AddressInfo).port;
    const call = (method: string, path: string, token: string, body?: unknown) =>
      new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
        const data = body === undefined ? undefined : JSON.stringify(body);
        const req = http.request({ host: "127.0.0.1", port, path: `/cp/v1/external-ops${path}`, method, headers: { authorization: `Bearer ${token}`, ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } }, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.on("error", reject);
        if (data) req.write(data);
        req.end();
      });
    return { call, close: () => new Promise<void>((r) => server.close(() => r())) };
  }

  it("registrar exige orders:approve y billing:write; ver el justificante, orders:approve; el PDF sale sin caché", async () => {
    const t = setup();
    const x = await issuedWithLink(t);
    const s = await serve(t);
    try {
      const path = `/${x.opId}/periods/${x.pid}/transfer`;
      expect((await s.call("POST", path, "sales-token-aaaaaaaaaaaaaaaa", transfer())).status).toBe(403);
      expect((await s.call("POST", path, "approve-only-token-aaaaaaaaa", transfer())).status).toBe(403);
      expect((await s.call("POST", path, "admin-token-aaaaaaaaaaaaaaaa", { ...transfer(), confirmed: false })).status).toBe(400);
      // Un PDF de 3 MB (más que el lector general de 256 KB): esta ruta lee su propio cuerpo
      const big = await s.call("POST", path, "admin-token-aaaaaaaaaaaaaaaa", transfer("big-pdf-key-01", { receipt: pdf("grande.pdf", Buffer.concat([PDF, Buffer.alloc(3 * 1024 * 1024, 0x20)])) }));
      expect(big.status).toBe(200);
      const out = JSON.parse(big.body.toString("utf8"));
      expect(out.period.payment).toMatchObject({ state: "paid", method: "bank_transfer" });
      const docId = out.period.payment.movements[0].receiptDocumentId;
      const rec = `/${x.opId}/periods/${x.pid}/receipts/${docId}`;
      expect((await s.call("GET", rec, "sales-token-aaaaaaaaaaaaaaaa")).status).toBe(403);
      const got = await s.call("GET", rec, "approve-only-token-aaaaaaaaa");
      expect(got.status).toBe(200);
      expect(got.headers).toMatchObject({ "content-type": "application/pdf", "cache-control": "no-store", "x-content-type-options": "nosniff", "content-disposition": 'attachment; filename="grande.pdf"' });
      expect(got.body.subarray(0, 5).toString()).toBe("%PDF-");
      // Anular también exige los dos permisos
      const pay = out.period.payment.movements[0].id;
      expect((await s.call("POST", `/${x.opId}/periods/${x.pid}/transfers/${pay}/void`, "approve-only-token-aaaaaaaaa", { reason: "Registrada por error" })).status).toBe(403);
      expect((await s.call("POST", `/${x.opId}/periods/${x.pid}/transfers/${pay}/void`, "admin-token-aaaaaaaaaaaaaaaa", { reason: "Registrada por error" })).status).toBe(200);
    } finally {
      await s.close();
    }
  });

  it("solo las rutas con justificante quedan fuera del lector general de JSON", () => {
    expect(EXTERNAL_UPLOAD_PATHS.test("/cp/v1/external-ops/3/periods/4/transfer")).toBe(true);
    expect(EXTERNAL_UPLOAD_PATHS.test("/cp/v1/external-ops/3/periods/4/transfers/9/rectify")).toBe(true);
    expect(EXTERNAL_UPLOAD_PATHS.test("/cp/v1/external-ops/3/periods/4/transfers/9/void")).toBe(false);
    expect(EXTERNAL_UPLOAD_PATHS.test("/cp/v1/external-ops/3/periods/4/offline-payment")).toBe(false);
    expect(EXTERNAL_UPLOAD_PATHS.test("/cp/v1/external-ops")).toBe(false);
  });
});
