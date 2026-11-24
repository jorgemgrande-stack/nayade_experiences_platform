import { describe, expect, it, vi } from "vitest";
import { createBillingNotifier, claimsCharge, type BillingNoticeEvent } from "./billingNotices";

const base = () => {
  const sent: Array<{ key: string; title: string; lines: string[] }> = [];
  const send = vi.fn(async (key: string, title: string, lines: string[]) => void sent.push({ key, title, lines }));
  const notify = createBillingNotifier({
    subscriptions: { get: async () => ({ id: 8, reference: "SUB-2026-000008", companyId: 14, tenantId: "t12", contractId: 12, status: "active", interval: "month" }) },
    crmStore: { get: async (e: string) => (e === "companies" ? { id: 14, name: "Quantum Soulrise", tenantId: "t12" } : { id: 12, reference: "CT-2026-000012" }) },
    billing: { plan: async () => ({ subscriptionId: 8, termsId: 9, currency: "EUR", items: [{ key: "a", name: "Elephant Core Business", product: { kind: "catalog", productKey: "business" }, amountCents: 5200, interval: "month", taxRateBp: 2100 }], oneOffs: [], recurringNetCents: 5200 }) as never },
    send,
    crmUrl: "https://admin.example.test/",
  });
  return { sent, send, notify };
};
const at = Date.UTC(2026, 10, 24, 11, 30);
const paid = { id: "in_1", number: "LV-1", subtotalCents: 5200, taxCents: 1092, totalCents: 6292, amountPaidCents: 6292, currency: "eur" };

describe("avisos internos a Dirección", () => {
  it("un cobro solo se anuncia con factura pagada de importe mayor que cero", async () => {
    const { notify, send } = base();
    await notify({ kind: "first_charge", key: "invoice:in_0", subscriptionId: 8, at, invoice: { ...paid, id: "in_0", totalCents: 0, amountPaidCents: 0, subtotalCents: 0, taxCents: 0 } });
    await notify({ kind: "recurring_charge", key: "invoice:in_x", subscriptionId: 8, at, invoice: null });
    expect(send).not.toHaveBeenCalled();
    expect(claimsCharge("method_confirmed")).toBe(false);
  });

  it("el primer cobro identifica empresa, contrato, importes, estados y enlace al expediente", async () => {
    const { notify, sent } = base();
    await notify({ kind: "first_charge", key: "invoice:in_1", subscriptionId: 8, at, stripeStatus: "active", invoice: paid });
    expect(sent).toHaveLength(1);
    expect(sent[0].key).toBe("first_charge:invoice:in_1");
    const text = sent[0].lines.join("\n");
    expect(sent[0].title).toContain("Quantum Soulrise");
    expect(text).toMatch(/Primer cobro real confirmado/);
    expect(text).toMatch(/CT-2026-000012/);
    expect(text).toMatch(/SUB-2026-000008/);
    expect(text).toMatch(/Elephant Core Business/);
    expect(text).toMatch(/Importe efectivamente cobrado: 62,92/);
    expect(text).toMatch(/Estado de la suscripción: Activa y al corriente/);
    expect(text).toMatch(/Estado de la plataforma: activa \(t12\)/);
    expect(text).toMatch(/https:\/\/admin\.example\.test\/#\/comercial\/suscripciones\/8/);
  });

  it("el método de pago en prueba no menciona ningún importe cobrado y explica que aún no se cobra", async () => {
    const { notify, sent } = base();
    await notify({ kind: "method_confirmed", key: "stripe:sub_1", subscriptionId: 8, at, stripeStatus: "trialing", trialEnd: Date.UTC(2026, 10, 28, 20, 53) });
    const text = sent[0].lines.join("\n");
    expect(text).not.toMatch(/Importe efectivamente cobrado/);
    expect(text).toMatch(/En prueba gratuita/);
    expect(text).toMatch(/primer cobro previsto/);
  });

  it("un fallo del correo o de la lectura nunca lanza (no frena el procesamiento financiero)", async () => {
    const { send, notify } = base();
    send.mockRejectedValueOnce(new Error("proveedor caído"));
    await expect(notify({ kind: "payment_failed", key: "stripe:sub_1:past_due:in_9", subscriptionId: 8, at, stripeStatus: "past_due" } as BillingNoticeEvent)).resolves.toBeUndefined();
  });
});
