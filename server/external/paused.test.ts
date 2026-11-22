/**
 * CARACTERIZACIÓN del estado de la suscripción de Stripe en los servicios de clientes externos
 * (`ExternalService.handleSubscription`, server/external/service.ts ~856): sin tocar código de producción.
 *
 * Aquí el estado de la SUSCRIPCIÓN solo distingue «canceled/incomplete_expired» (→ canceled); unpaid y paused se
 * deducen de la FACTURA (open → past_due con margen, paid → active). Es el camino que difiere del de los pedidos
 * (server/stripe/events.ts), donde paused se trata como unpaid.
 */
import { describe, it, expect } from "vitest";
import { CrmService } from "../crm/service";
import { MemoryCrmStore } from "../crm/store";
import type { GwSubscription } from "../stripe/gateway";
import { FakeStripeGateway } from "../stripe/testing";
import { ExternalService } from "./service";
import { MemoryExternalStore, type NewExternal } from "./store";

const T = Date.UTC(2027, 0, 1, 8);
const urls = { acceptance: "https://admin.example/a", setupSuccess: "https://admin.example/ok", setupCancel: "https://admin.example/ko", portalReturn: "https://admin.example" };

async function world() {
  const crmStore = new MemoryCrmStore();
  const crm = new CrmService({ store: crmStore, now: () => T });
  const store = new MemoryExternalStore();
  const gw = new FakeStripeGateway();
  const svc = new ExternalService({ store, crm, crmStore, gateway: gw, mode: "test", namespace: "local", urls, now: () => T });
  const base: NewExternal = {
    contractId: 1, companyId: 7, serviceKey: "skinet", serviceName: "SkiNet", amountCents: 100_000, currency: "EUR", taxRateBp: 2100, interval: "month", intervalCount: 1,
    durationPeriods: null, endsAt: null, baseAmountCents: null, adjustment: null, billingDay: 1, billingHour: 8, timezone: "Europe/Madrid", graceDays: 5, firstChargeAt: Date.UTC(2026, 10, 1, 7),
    externalRef: "skicenter:ficticio", status: "active", stripeCustomerId: "cus_x", stripeSetupSessionId: null, stripePaymentMethodId: "pm_x", stripeSubscriptionId: "sub_x", stripeTestClockId: null,
    lastInvoiceId: null, lastInvoiceStatus: null, currentPeriodStart: null, currentPeriodEnd: null, graceUntil: null, decisionReason: null, createdBy: "operator:test", createdAt: T,
  };
  const x = await store.insert(base);
  const sub = (status: GwSubscription["status"], latestInvoiceId: string | null): GwSubscription => ({ id: "sub_x", customerId: "cus_x", status, cancelAt: null, cancelAtPeriodEnd: false, currentPeriodEnd: Math.floor(T / 1000) + 30 * 86_400, latestInvoiceId, priceIds: [], metadata: { es_external_id: String(x.id), es_env: "local" } });
  const invoice = (status: "paid" | "open") => gw.addInvoice("sub_x", "cus_x", "subscription_cycle", status, 100_000);
  const row = async () => (await store.get(x.id))!;
  const kinds = async () => (await store.events(x.id)).map((e) => e.kind);
  return { svc, store, gw, sub, invoice, row, kinds };
}

describe("servicios externos: estado de la suscripción de Stripe (paused, unpaid, active, past_due)", () => {
  it("past_due con factura abierta: past_due con margen de pago y un solo evento aunque se repita", async () => {
    const w = await world();
    const inv = w.invoice("open");
    await w.svc.handleSubscription(w.sub("past_due", inv));
    expect(await w.row()).toMatchObject({ status: "past_due", lastInvoiceId: inv, lastInvoiceStatus: "open" });
    expect((await w.row()).graceUntil).not.toBeNull();
    // El repetido reescribe los mismos datos (devuelve «past_due → past_due») pero no duplica el evento de la factura
    expect(await w.svc.handleSubscription(w.sub("past_due", inv))).toBe("past_due → past_due");
    expect((await w.kinds()).filter((k) => k === "invoice_payment_failed")).toHaveLength(1);
  });

  it("unpaid y paused con factura abierta: se tratan igual que past_due (NO suspenden; el estado de la suscripción no se mira)", async () => {
    // DIVERGENCIA: en pedidos (events.ts:549) paused y unpaid suspenden al instante; aquí la suscripción solo cuenta
    // si es canceled/incomplete_expired y el resto se deduce de la factura: unpaid y paused quedan en past_due.
    for (const st of ["unpaid", "paused"] as const) {
      const w = await world();
      const inv = w.invoice("open");
      await w.svc.handleSubscription(w.sub(st, inv));
      expect(await w.row()).toMatchObject({ status: "past_due", lastInvoiceStatus: "open" });
    }
  });

  it("unpaid y paused SIN factura que valore (sin factura o de importe 0): no cambian nada", async () => {
    // DIVERGENCIA: una suscripción paused/unpaid sin factura de importe no mueve el servicio; en pedidos sí suspendería.
    for (const st of ["unpaid", "paused"] as const) {
      const w = await world();
      expect(await w.svc.handleSubscription(w.sub(st, null))).toMatch(/^Sin cambios/);
      expect((await w.row()).status).toBe("active");
    }
  });

  it("active con factura pagada: active, graceUntil a null; duplicado sin efecto", async () => {
    const w = await world();
    const open = w.invoice("open");
    await w.svc.handleSubscription(w.sub("past_due", open));
    const paid = w.invoice("paid");
    await w.svc.handleSubscription(w.sub("active", paid));
    expect(await w.row()).toMatchObject({ status: "active", graceUntil: null, lastInvoiceId: paid, lastInvoiceStatus: "paid" });
    await w.svc.handleSubscription(w.sub("active", paid));
    expect((await w.kinds()).filter((k) => k === "invoice_paid")).toHaveLength(1);
  });

  it("fuera de orden: el servicio aplica la suscripción que se le ENTREGA (no relee otra); una atrasada haría retroceder a past_due", async () => {
    const w = await world();
    const open = w.invoice("open");
    const paid = w.invoice("paid");
    await w.svc.handleSubscription(w.sub("active", paid));
    expect((await w.row()).status).toBe("active");
    // Si se le entregara una suscripción atrasada (aún apuntando a la factura abierta), retrocedería. En producción no
    // ocurre: el procesador (stripe/events.ts handleSubscription) relee la suscripción en Stripe antes de llamar aquí, así
    // que este test solo fija el contrato del servicio, no un fallo alcanzable por el webhook.
    await w.svc.handleSubscription(w.sub("past_due", open));
    expect((await w.row()).status).toBe("past_due");
  });

  it("canceled / incomplete_expired: canceled, con cualquier factura", async () => {
    for (const st of ["canceled", "incomplete_expired"] as const) {
      const w = await world();
      await w.svc.handleSubscription(w.sub(st, null));
      expect((await w.row()).status).toBe("canceled");
    }
  });
});
