/**
 * Facturación fiscal automática (DF-2) con un servicio externo sintético de 1.000 € + 21 % IVA cobrado el día 1:
 * proforma cinco días antes (nunca retroactiva), contraste con Stripe, una sola factura con número correlativo, PDF y
 * envío idempotente, crédito solo con impago real y bloqueos cuando falta un dato.
 */
import { describe, it, expect } from "vitest";
import { chargeInstant } from "../external/schedule";
import type { ExternalEvent, ExternalSubscription } from "../external/types";
import { ISSUER } from "../stripe/issuer";
import { creditIssueDate, documentName, InvoicingAutomation, invoicePdfBlocks, PROFORMA_LEGEND, renderInvoicePdf } from "./delivery";
import type { CompanyFiscal } from "./rules";
import { InvoicingService } from "./service";
import { MemoryInvoicingStore } from "./store";
import type { FiscalParty } from "./types";

const TZ = "Europe/Madrid";
const NOV = chargeInstant("2026-11-01", 8, TZ);
const DEC = chargeInstant("2026-12-01", 8, TZ);
const DAY = 86_400_000;
const ISSUER_PARTY: FiscalParty = { legalName: ISSUER.legalName, taxId: ISSUER.taxId, address: `${ISSUER.address.line1}, ${ISSUER.address.line2}`, postalCode: ISSUER.address.postalCode, city: ISSUER.address.city, country: "ES" };
const CLIENT: CompanyFiscal = { name: "Cliente", legalName: "CLIENTE SINTÉTICO SL", taxId: "B12345674", address: "Calle Ejemplo 1", postalCode: "18006", city: "Granada", country: "ES", billingEmail: "facturas@cliente.example" };
const external = (p: Partial<ExternalSubscription> = {}): ExternalSubscription =>
  ({ id: 1, contractId: 9, companyId: 7, serviceKey: "svc", serviceName: "Servicio gestionado", amountCents: 100_000, currency: "EUR", taxRateBp: 2100, interval: "month", billingDay: 1, billingHour: 8, timezone: TZ, graceDays: 5, firstChargeAt: NOV, externalRef: null, status: "active", endsAt: null, ...p }) as ExternalSubscription;
const paid = (inv: string, at: number, periodStart: number): ExternalEvent => ({ id: 0, externalId: 1, kind: "invoice_paid", ref: inv, detail: { periodStart, baseCents: 100_000, taxCents: 21_000, totalCents: 121_000, paymentRef: `stripe:in:${inv}` }, actor: "system:stripe", at });
const failed = (inv: string, at: number, periodStart: number): ExternalEvent => ({ id: 0, externalId: 1, kind: "invoice_payment_failed", ref: inv, detail: { periodStart, totalCents: 121_000, paymentRef: `stripe:in:${inv}` }, actor: "system:stripe", at });

function setup(o: { issueEnabled?: boolean; company?: CompanyFiscal; x?: Partial<ExternalSubscription>; stripe?: Record<string, { status: string; amountPaid: number; currency: string } | null> } = {}) {
  let now = NOV - 3 * DAY;
  const store = new MemoryInvoicingStore();
  const events: ExternalEvent[] = [];
  const xs = [external(o.x)];
  const issueEnabled = o.issueEnabled ?? true;
  const svc = new InvoicingService({ store, external: { list: async () => xs, events: async () => events }, company: async () => o.company ?? CLIENT, issuer: ISSUER_PARTY, seriesCode: "EB", issueEnabled, proformaLeadDays: 5, now: () => now });
  const sent: Array<{ key: string; category: string; to: string; subject: string; attachment: string; pdf: string }> = [];
  const keys = new Set<string>();
  const auto = new InvoicingAutomation({
    svc,
    store,
    issueEnabled,
    stripeInvoice: async (id) => (o.stripe && id in o.stripe ? o.stripe[id] : { status: "paid", amountPaid: 121_000, currency: "EUR" }),
    delivery: {
      send: async (m) => {
        const duplicate = keys.has(m.key);
        keys.add(m.key);
        if (!duplicate) sent.push({ key: m.key, category: m.category, to: m.to, subject: m.content.subject, attachment: m.attachments[0].name, pdf: Buffer.from(m.attachments[0].content!, "base64").subarray(0, 5).toString() });
        return { status: "pending", duplicate };
      },
      recipient: async (inv) => inv.customer?.email ?? null,
      issuer: ISSUER_PARTY,
      supportEmail: null,
    },
    now: () => now,
  });
  return { store, svc, auto, events, sent, xs, at: (t: number) => (now = t) };
}

describe("proforma previa al cobro", () => {
  it("cinco días antes nace el borrador y su proforma (sin número, con la leyenda); una sola vez", async () => {
    const t = setup();
    t.at(NOV - 6 * DAY);
    expect((await t.svc.generateExternal("system")).created).toEqual([]);
    t.at(NOV - 5 * DAY + 60_000);
    const r = await t.svc.generateExternal("system");
    expect(r.created).toHaveLength(1);
    const pro = await t.auto.sendProformas();
    expect(pro).toEqual({ sent: 1, skipped: [] });
    expect(t.sent).toEqual([{ key: "invoicing:proforma:external:1:2026-11:121000", category: "quote_sent", to: "facturas@cliente.example", subject: "Proforma de noviembre de 2026 · Big Elephant", attachment: `proforma-2026-11-${r.created[0].id}.pdf`, pdf: "%PDF-" }]);
    expect((await t.store.list({}))[0]).toMatchObject({ status: "draft", number: null });
    expect((await t.auto.sendProformas()).sent).toBe(0);
    expect(t.sent).toHaveLength(1);
    // Antes del cobro no se expide nada
    expect(await t.auto.issueDue()).toEqual({ issued: [], waiting: 0, blocked: [] });
  });

  it("nunca una proforma retroactiva: un periodo ya vencido no la recibe", async () => {
    const t = setup();
    t.at(NOV + 3_600_000);
    await t.svc.generateExternal("system");
    expect(await t.auto.sendProformas()).toEqual({ sent: 0, skipped: [] });
    expect(t.sent).toEqual([]);
  });

  it("ni borrador ni proforma de un periodo posterior al fin del contrato", async () => {
    const t = setup({ x: { endsAt: DEC } });
    t.at(DEC - 3 * DAY);
    const r = await t.svc.generateExternal("system");
    expect(r.created.map((c) => c.sourceKey)).toEqual(["external:1:2026-11"]);
  });
});

describe("factura definitiva tras el cobro", () => {
  it("cobro confirmado y contrastado con Stripe: una factura EB-2026-00001, su PDF y su envío; repetir no duplica nada", async () => {
    const t = setup();
    t.at(NOV + 3_600_000);
    await t.svc.generateExternal("system");
    t.events.push(paid("in_nov", NOV + 3_700_000, NOV));
    await t.svc.generateExternal("system");
    const r = await t.auto.issueDue();
    expect(r.issued).toEqual([{ id: 1, number: "EB-2026-00001", totalCents: 121_000, delivery: "pending" }]);
    const inv = (await t.store.list({}))[0];
    expect(inv).toMatchObject({ status: "issued", number: "EB-2026-00001", issueDate: "2026-11-01", paymentStatus: "paid", paymentRef: "stripe:in:in_nov", customer: { legalName: "CLIENTE SINTÉTICO SL", taxId: "B12345674" }, issuer: { taxId: "B26987875" } });
    expect(inv.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.sent).toEqual([{ key: "invoicing:invoice:1:EB-2026-00001", category: "invoice_available", to: "facturas@cliente.example", subject: "Factura EB-2026-00001 de Big Elephant", attachment: "factura-EB-2026-00001.pdf", pdf: "%PDF-" }]);
    expect(await t.auto.issueDue()).toEqual({ issued: [], waiting: 0, blocked: [] });
    expect(await t.auto.redeliver()).toBe(0);
    expect(t.sent).toHaveLength(1);
    // La mensualidad siguiente lleva el número siguiente
    t.at(DEC + 3_600_000);
    await t.svc.generateExternal("system");
    t.events.push(paid("in_dec", DEC + 3_700_000, DEC));
    await t.svc.generateExternal("system");
    expect((await t.auto.issueDue()).issued.map((x) => x.number)).toEqual(["EB-2026-00002"]);
  });

  it("si Stripe no confirma el mismo importe, o no se puede leer, no se expide: queda bloqueada", async () => {
    for (const [stripe, reason] of [
      [{ in_nov: { status: "paid", amountPaid: 100_000, currency: "EUR" } }, /no casa/],
      [{ in_nov: { status: "open", amountPaid: 0, currency: "EUR" } }, /no casa/],
      [{ in_nov: null }, /no se pudo contrastar/],
    ] as const) {
      const t = setup({ stripe });
      t.at(NOV + 3_600_000);
      await t.svc.generateExternal("system");
      t.events.push(paid("in_nov", NOV + 3_700_000, NOV));
      await t.svc.generateExternal("system");
      const r = await t.auto.issueDue();
      expect(r.issued).toEqual([]);
      expect(r.blocked[0].reason).toMatch(reason);
      expect((await t.store.list({}))[0].status).toBe("draft");
      expect(t.sent).toEqual([]);
    }
  });

  it("datos fiscales del cliente incompletos: no se expide y se dice qué falta", async () => {
    const t = setup({ company: { ...CLIENT, taxId: "B12345670" } });
    t.at(NOV + 3_600_000);
    await t.svc.generateExternal("system");
    t.events.push(paid("in_nov", NOV + 3_700_000, NOV));
    await t.svc.generateExternal("system");
    const r = await t.auto.issueDue();
    expect(r.issued).toEqual([]);
    expect(r.blocked[0].reason).toMatch(/NIF/);
  });

  it("con la emisión real apagada en el entorno no se expide nada", async () => {
    const t = setup({ issueEnabled: false });
    t.at(NOV + 3_600_000);
    await t.svc.generateExternal("system");
    t.events.push(paid("in_nov", NOV + 3_700_000, NOV));
    await t.svc.generateExternal("system");
    expect(await t.auto.issueDue()).toEqual({ issued: [], waiting: 0, blocked: [] });
  });
});

describe("cargo extraordinario", () => {
  it("proforma en cuanto nace el borrador (antes del enlace de pago); factura al cobrar por el enlace, sin contraste de factura de Stripe", async () => {
    const t = setup();
    t.at(NOV + 10 * DAY);
    const lines = [{ position: 1, concept: "Migración de datos", quantity: 1, unitCents: 50_000, baseCents: 50_000, taxRateBp: 2100, taxCents: 10_500 }];
    const { invoice } = await t.store.insertDraft({ sourceKey: "charge:5", kind: "invoice", paymentStatus: "pending", companyId: 7, billingRef: "charge:5", paymentRef: null, originalInvoiceId: null, operationDate: "2026-11-11", periodStart: null, periodEnd: null, periodLabel: null, currency: "EUR", baseCents: 50_000, taxCents: 10_500, totalCents: 60_500, customer: { legalName: CLIENT.legalName!, taxId: CLIENT.taxId!, address: CLIENT.address!, postalCode: CLIENT.postalCode!, city: CLIENT.city!, country: "ES", email: "facturas@cliente.example" }, notes: null, createdBy: "operator", createdAt: NOV + 10 * DAY, lines });
    expect(await t.auto.sendProformas()).toEqual({ sent: 1, skipped: [] });
    expect(t.sent[0]).toMatchObject({ key: "invoicing:proforma:charge:5:60500", category: "quote_sent", subject: "Proforma de Migración de datos · Big Elephant" });
    expect(await t.auto.issueDue()).toEqual({ issued: [], waiting: 1, blocked: [] });
    // Cobrado por el enlace de Stripe (la sesión ya se releyó al confirmar el pago)
    await t.store.setPayment(invoice.id, { paymentStatus: "paid", paymentRef: "stripe:pi:pi_cargo", paidAt: NOV + 10 * DAY + 1 }, NOV + 10 * DAY + 1);
    const r = await t.auto.issueDue();
    expect(r.issued).toEqual([{ id: invoice.id, number: "EB-2026-00001", totalCents: 60_500, delivery: "pending" }]);
    expect(await t.auto.sendProformas()).toEqual({ sent: 0, skipped: [] });
    expect(t.sent.map((x) => x.category)).toEqual(["quote_sent", "invoice_available"]);
  });
});

describe("operaciones a crédito", () => {
  it("con el cobro fallido, se expide el día 10 del mes siguiente y queda pendiente de cobro", async () => {
    const t = setup();
    t.at(NOV + 3_600_000);
    await t.svc.generateExternal("system");
    t.events.push(failed("in_nov", NOV + 3_700_000, NOV));
    await t.svc.generateExternal("system");
    expect(await t.auto.issueDue()).toEqual({ issued: [], waiting: 1, blocked: [] });
    t.at(chargeInstant("2026-12-10", 9, TZ));
    const r = await t.auto.issueDue();
    expect(r.issued.map((x) => x.number)).toEqual(["EB-2026-00001"]);
    expect((await t.store.get(r.issued[0].id))!).toMatchObject({ paymentStatus: "failed", issueDate: "2026-12-10" });
  });

  it("sin ningún intento de cobro no se expide sola (puede ser una baja tras la proforma)", async () => {
    const t = setup();
    t.at(NOV + 3_600_000);
    await t.svc.generateExternal("system");
    t.at(chargeInstant("2026-12-10", 9, TZ));
    const r = await t.auto.issueDue();
    expect(r.issued).toEqual([]);
    expect(r.blocked.find((b) => b.id === 1)!.reason).toMatch(/sin cobro ni intento/);
  });

  it("plazo de crédito con cambio de año", () => {
    expect(creditIssueDate("2026-11-01")).toBe("2026-12-10");
    expect(creditIssueDate("2026-12-01")).toBe("2027-01-10");
  });
});

describe("documento", () => {
  it("la proforma lleva la leyenda y ningún número; la factura, número, fecha de expedición y datos de las partes", async () => {
    const t = setup();
    t.at(NOV + 3_600_000);
    await t.svc.generateExternal("system");
    const draft = (await t.store.list({}))[0];
    const pb = JSON.stringify(invoicePdfBlocks(draft, ISSUER_PARTY, { proforma: true }));
    expect(pb).toContain(PROFORMA_LEGEND);
    expect(pb).not.toContain("Fecha de expedición");
    expect(documentName(draft, true)).toBe(`proforma-2026-11-${draft.id}.pdf`);
    t.events.push(paid("in_nov", NOV + 3_700_000, NOV));
    await t.svc.generateExternal("system");
    await t.auto.issueDue();
    const inv = (await t.store.list({}))[0];
    const ib = JSON.stringify(invoicePdfBlocks(inv, ISSUER_PARTY));
    for (const s of ["EB-2026-00001", "Fecha de expedición", "01/11/2026", "B26987875", "B12345674", "CLIENTE SINTÉTICO SL", "Base imponible", "21 %"]) expect(ib).toContain(s);
    expect(ib).not.toContain(PROFORMA_LEGEND);
    const pdf = await renderInvoicePdf(inv, ISSUER_PARTY);
    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe("%PDF-");
  });
});
